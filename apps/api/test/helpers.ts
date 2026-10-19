import { createApp } from '../src/app';
import { memoryDeps, type MemoryDeps } from '../dev/memory-deps';
import { seedDemo } from '../dev/seed';

export interface Client {
  get(path: string): Promise<Response>;
  post(path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  patch(path: string, body?: unknown): Promise<Response>;
  put(path: string, body?: unknown): Promise<Response>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json<T = any>(res: Response | Promise<Response>): Promise<T>;
}

export async function setup(opts: Parameters<typeof memoryDeps>[0] = {}) {
  const deps = memoryDeps(opts);
  const seeded = await seedDemo(deps);
  const app = createApp(deps);
  let n = 0;
  function client(cookie: string | null = null): Client {
    const jar = { cookie };
    const req = async (
      method: string,
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) => {
      const res = await app.request(path, {
        method,
        headers: {
          ...(method !== 'GET'
            ? {
                'X-Requested-With': 'chat360',
                'Content-Type': 'application/json',
                'Idempotency-Key': `test-key-${++n}-${Date.now()}`,
              }
            : {}),
          ...(jar.cookie ? { Cookie: jar.cookie } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const set = res.headers.get('set-cookie');
      if (set) {
        const m = /c360_session=([^;]*)/.exec(set);
        if (m) jar.cookie = m[1] ? `c360_session=${m[1]}` : null;
      }
      return res;
    };
    return {
      get: (p) => req('GET', p),
      post: (p, b, h) => req('POST', p, b ?? {}, h),
      patch: (p, b) => req('PATCH', p, b ?? {}),
      put: (p, b) => req('PUT', p, b ?? {}),
      json: async (r) => (await r).json() as never,
    };
  }
  async function as(userId: string) {
    const c = client();
    const res = await c.post('/api/auth/dev-login', { userId });
    if (res.status !== 200) throw new Error(`dev-login failed for ${userId}: ${res.status}`);
    return c;
  }
  return { deps, app, client, as, projects: seeded.projects };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const readJson = async (res: Response): Promise<any> => res.json();

export type Ctx = Awaited<ReturnType<typeof setup>>;
export type { MemoryDeps };
