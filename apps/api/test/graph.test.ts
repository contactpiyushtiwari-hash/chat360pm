import { describe, expect, it } from 'vitest';
import { GraphClient } from '../src/graph/client';
import { GraphDocStore, encodePath } from '../src/graph/drive-store';
import { GraphMailer } from '../src/graph/mailer';
import { appTokenProvider } from '../src/graph/tokens';
import { GraphUserGraph } from '../src/graph/user-graph';
import { GraphWorkbookGateway, parseAddress } from '../src/graph/workbook';
import { GraphError } from '../src/http/errors';
import { PreconditionFailedError } from '../src/ports';
import { redact, redactText } from '../src/observability/redact';

/**
 * Contract tests: they pin the HTTP requests our adapters send to Microsoft Graph and how we
 * interpret documented responses. They do not prove behaviour against a live tenant.
 */
interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function mockFetch(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    let body: unknown = init?.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        /* keep string */
      }
    }
    const call = { url, method: init?.method ?? 'GET', headers, body };
    calls.push(call);
    return handler(call);
  };
  return { calls, fetchImpl };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const client = (fetchImpl: (u: string, i?: RequestInit) => Promise<Response>) =>
  new GraphClient({ token: async () => 'tok', fetch: fetchImpl, sleep: async () => undefined });

describe('GraphClient', () => {
  it('retries 429 honouring Retry-After, then succeeds', async () => {
    let n = 0;
    const waits: number[] = [];
    const { fetchImpl, calls } = mockFetch(() =>
      ++n < 3
        ? json(429, { error: { code: 'TooManyRequests' } }, { 'Retry-After': '2' })
        : json(200, { ok: true }),
    );
    const g = new GraphClient({
      token: async () => 'tok',
      fetch: fetchImpl,
      sleep: async (ms) => void waits.push(ms),
    });
    expect(await g.json({ path: '/me' })).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([2000, 2000]);
    expect(calls[0]!.headers.authorization).toBe('Bearer tok');
  });

  it('does not retry when retries is 0 and surfaces Graph error codes', async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      json(
        503,
        { error: { code: 'serviceNotAvailable', message: 'down' } },
        { 'request-id': 'r1' },
      ),
    );
    const g = client(fetchImpl);
    await expect(g.json({ path: '/x', retries: 0 })).rejects.toMatchObject({
      status: 503,
      code: 'serviceNotAvailable',
      requestId: 'r1',
    });
    expect(calls).toHaveLength(1);
  });

  it('chains batch requests with dependsOn when sequential and splits at 20', async () => {
    const { fetchImpl, calls } = mockFetch((c) => {
      const reqs = (c.body as { requests: { id: string }[] }).requests;
      return json(200, { responses: reqs.map((r) => ({ id: r.id, status: 200, body: {} })) });
    });
    const g = client(fetchImpl);
    const reqs = Array.from({ length: 25 }, (_, i) => ({
      id: `r${i}`,
      method: 'PATCH',
      url: '/x',
      body: { v: i },
    }));
    const out = await g.batch(reqs, true);
    expect(out.size).toBe(25);
    expect(calls).toHaveLength(2);
    const first = (calls[0]!.body as { requests: { id: string; dependsOn?: string[] }[] }).requests;
    expect(first).toHaveLength(20);
    expect(first[0]!.dependsOn).toBeUndefined();
    expect(first[1]!.dependsOn).toEqual(['r0']);
  });
});

describe('GraphDocStore (OneDrive eTag concurrency)', () => {
  it('reads via metadata + pre-authenticated download URL without sending the token there', async () => {
    const { fetchImpl, calls } = mockFetch((c) => {
      if (c.url.startsWith('https://download.example')) return json(200, { hello: 'world' });
      return json(200, {
        id: 'i1',
        eTag: '"e1"',
        webUrl: 'w',
        name: 'project.json',
        '@microsoft.graph.downloadUrl': 'https://download.example/x',
      });
    });
    const store = new GraphDocStore(client(fetchImpl), 'drive-1', 'Chat360 Ops', fetchImpl);
    const doc = await store.getJson('Projects/PRJ 1/project.json');
    expect(doc).toEqual({ data: { hello: 'world' }, etag: '"e1"' });
    expect(calls[0]!.url).toContain(
      '/drives/drive-1/root:/Chat360%20Ops/Projects/PRJ%201/project.json',
    );
    expect(calls[1]!.headers.authorization).toBeUndefined();
  });

  it('returns null for 404', async () => {
    const { fetchImpl } = mockFetch(() => json(404, { error: { code: 'itemNotFound' } }));
    const store = new GraphDocStore(client(fetchImpl), 'd', 'R', fetchImpl);
    expect(await store.getJson('missing.json')).toBeNull();
  });

  it('sends If-Match on update and maps 412 to PreconditionFailedError', async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      json(412, { error: { code: 'resourceModified' } }),
    );
    const store = new GraphDocStore(client(fetchImpl), 'd', 'R', fetchImpl);
    await expect(store.putJson('a.json', { x: 1 }, { ifMatch: '"e1"' })).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    expect(calls[0]!.method).toBe('PUT');
    expect(calls[0]!.headers['if-match']).toBe('"e1"');
    expect(calls[0]!.url).toMatch(/:\/content$/);
  });

  it('creates with conflictBehavior=fail and maps 409 to PreconditionFailedError', async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      json(409, { error: { code: 'nameAlreadyExists' } }),
    );
    const store = new GraphDocStore(client(fetchImpl), 'd', 'R', fetchImpl);
    await expect(
      store.putFile('t.xlsx', new Uint8Array([1]), 'application/x', { ifNoneMatch: '*' }),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
    expect(calls[0]!.url).toContain('@microsoft.graph.conflictBehavior=fail');
    expect(calls[0]!.headers['if-match']).toBeUndefined();
  });

  it('encodes path segments safely', () => {
    expect(encodePath('/a b/c#d/../e')).toBe('a%20b/c%23d/../e');
  });
});

describe('GraphWorkbookGateway', () => {
  it('parses table range addresses including quoted sheet names', () => {
    expect(parseAddress("'Gantt Chart'!A5:K18")).toEqual({
      sheet: 'Gantt Chart',
      firstCol: 1,
      firstRow: 5,
      lastCol: 11,
      lastRow: 18,
    });
    expect(parseAddress('WBS!$A$5:$Q$9')).toMatchObject({ sheet: 'WBS', firstRow: 5, lastRow: 9 });
  });

  it('reads tables in one batch inside a workbook session and closes it', async () => {
    const { fetchImpl, calls } = mockFetch((c) => {
      if (c.url.endsWith('/createSession')) return json(201, { id: 'sess-1' });
      if (c.url.endsWith('/closeSession')) return new Response(null, { status: 204 });
      return json(200, {
        responses: [
          {
            id: 'tblWBS',
            status: 200,
            body: {
              address: 'WBS!A5:B6',
              formulas: [
                ['WBS ID', 'Task ID'],
                ['1.1', 'T-0001'],
              ],
            },
          },
        ],
      });
    });
    const gw = new GraphWorkbookGateway(client(fetchImpl), 'drive-1');
    const [t] = await gw.readTables('item-1', ['tblWBS']);
    expect(t).toMatchObject({
      sheet: 'WBS',
      headers: ['WBS ID', 'Task ID'],
      rows: [['1.1', 'T-0001']],
      firstDataRow: 6,
    });
    const batch = calls.find((c) => c.url.endsWith('/$batch'))!;
    const req = (batch.body as { requests: { url: string; headers: Record<string, string> }[] })
      .requests[0]!;
    expect(req.url).toContain('/drives/drive-1/items/item-1/workbook/tables/tblWBS/range');
    expect(req.headers['workbook-session-id']).toBe('sess-1');
    expect(calls.at(-1)!.url).toMatch(/closeSession$/);
  });

  it('reports per-table write failures from batch responses', async () => {
    const { fetchImpl } = mockFetch((c) => {
      if (c.url.endsWith('/createSession')) return json(201, { id: 's' });
      if (c.url.endsWith('/closeSession')) return new Response(null, { status: 204 });
      const reqs = (c.body as { requests: { id: string }[] }).requests;
      return json(200, {
        responses: reqs.map((r) => ({
          id: r.id,
          status: r.id.startsWith('tblAPIs') ? 409 : 200,
          body: r.id.startsWith('tblAPIs')
            ? { error: { code: 'EditModeCannotAcquireLock', message: 'locked' } }
            : {},
        })),
      });
    });
    const gw = new GraphWorkbookGateway(client(fetchImpl), 'd');
    const res = await gw.write(
      'i',
      [
        { sheet: 'WBS', table: 'tblWBS', patches: [{ row: 6, values: ['a'] }], appends: [] },
        { sheet: 'API List Pending', table: 'tblAPIs', patches: [], appends: [['x']] },
      ],
      [],
    );
    expect(res).toEqual([
      { table: 'tblWBS', ok: true },
      { table: 'tblAPIs', ok: false, error: 'EditModeCannotAcquireLock: locked' },
    ]);
  });
});

describe('mail', () => {
  it('app-only notifications post to the configured mailbox, never retried', async () => {
    const { fetchImpl, calls } = mockFetch(() => new Response(null, { status: 202 }));
    const m = new GraphMailer(client(fetchImpl), 'ops-notify@chat.io');
    expect(await m.send({ to: ['a@chat.io'], subject: 's', body: 'b' })).toEqual({
      status: 'accepted',
    });
    expect(calls[0]!.url).toBe(
      'https://graph.microsoft.com/v1.0/users/ops-notify%40chat.io/sendMail',
    );
    expect(
      (calls[0]!.body as { message: { toRecipients: unknown[] } }).message.toRecipients,
    ).toEqual([{ emailAddress: { address: 'a@chat.io' } }]);
  });

  it('reports 503 as a retryable failure without retrying in place', async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      json(503, { error: { code: 'ServiceUnavailable' } }),
    );
    const m = new GraphMailer(client(fetchImpl), 'x@chat.io');
    expect(await m.send({ to: ['a@chat.io'], subject: 's', body: 'b' })).toEqual({
      status: 'failed',
      error: '503 ServiceUnavailable',
      retryable: true,
    });
    expect(calls).toHaveLength(1);
  });

  it('delegated calendar view requests the org timezone', async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      json(200, {
        value: [
          {
            id: 'e1',
            subject: 'S',
            start: { dateTime: '2026-10-19T10:00:00', timeZone: 'India Standard Time' },
            end: { dateTime: '2026-10-19T11:00:00', timeZone: 'India Standard Time' },
            isOnlineMeeting: true,
            onlineMeeting: { joinUrl: 'https://teams/x' },
          },
        ],
      }),
    );
    const ug = new GraphUserGraph(client(fetchImpl));
    const ev = await ug.listEvents('2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z', 'Asia/Kolkata');
    expect(ev[0]).toMatchObject({ id: 'e1', isOnline: true, joinUrl: 'https://teams/x' });
    expect(calls[0]!.headers.prefer).toBe('outlook.timezone="Asia/Kolkata"');
    expect(calls[0]!.url).toContain('/me/calendarView?');
  });
});

describe('app token provider', () => {
  it('caches the client-credentials token until near expiry', async () => {
    let now = 0;
    const { fetchImpl, calls } = mockFetch(() =>
      json(200, { access_token: 'a', expires_in: 3600 }),
    );
    const get = appTokenProvider(
      { tenantId: 't', clientId: 'c', clientSecret: 's' },
      fetchImpl,
      () => now,
    );
    expect(await get()).toBe('a');
    now = 3000_000;
    await get();
    expect(calls).toHaveLength(1);
    now = 3400_000;
    await get();
    expect(calls).toHaveLength(2);
    expect(String(calls[0]!.body)).toContain('grant_type=client_credentials');
  });

  it('throws a GraphError when Entra refuses', async () => {
    const { fetchImpl } = mockFetch(() => json(401, { error: 'invalid_client' }));
    await expect(
      appTokenProvider({ tenantId: 't', clientId: 'c', clientSecret: 's' }, fetchImpl)(),
    ).rejects.toBeInstanceOf(GraphError);
  });
});

describe('redaction', () => {
  it('masks emails, bearer tokens and JWTs, and drops sensitive keys', () => {
    expect(redactText('mail jane.doe@chat.io now')).toBe('mail j***@chat.io now');
    expect(redactText('Authorization: Bearer abc.def')).toBe('Authorization: Bearer [REDACTED]');
    expect(redact({ accessToken: 'x', nested: { body: 'secret email body', ok: 1 } })).toEqual({
      accessToken: '[REDACTED]',
      nested: { body: '[REDACTED]', ok: 1 },
    });
  });
});
