import { cellRef } from '@chat360/core/workbook';
import type { CellWrite, WorkbookGateway, WorkbookTable, WorkbookWrite } from '../ports';
import { batchError, type GraphClient } from './client';

/** Parses `'Sheet Name'!A5:Q20` into sheet and first/last rows and columns. */
export function parseAddress(address: string) {
  const m = /^(?:'?(.*?)'?!)?\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(address);
  if (!m) throw new Error(`Unrecognised range address ${address}`);
  const col = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  return {
    sheet: (m[1] ?? '').replace(/''/g, "'"),
    firstCol: col(m[2]!),
    firstRow: Number(m[3]),
    lastCol: col(m[4] ?? m[2]!),
    lastRow: Number(m[5] ?? m[3]),
  };
}

/**
 * Excel operations through the Graph workbook API, inside a persistent workbook session.
 * Reads use one $batch; writes use sequential $batch calls (Excel rejects parallel writes).
 */
export class GraphWorkbookGateway implements WorkbookGateway {
  constructor(
    private readonly graph: GraphClient,
    private readonly driveId: string,
  ) {}

  private base(itemId: string) {
    return `/drives/${encodeURIComponent(this.driveId)}/items/${encodeURIComponent(itemId)}/workbook`;
  }

  private async withSession<T>(
    itemId: string,
    fn: (headers: Record<string, string>) => Promise<T>,
  ): Promise<T> {
    const s = await this.graph.json<{ id: string }>({
      method: 'POST',
      path: `${this.base(itemId)}/createSession`,
      body: { persistChanges: true },
    });
    const headers = { 'workbook-session-id': s.id };
    try {
      return await fn(headers);
    } finally {
      await this.graph
        .raw({ method: 'POST', path: `${this.base(itemId)}/closeSession`, headers, retries: 0 })
        .catch(() => undefined);
    }
  }

  async readTables(itemId: string, tables: string[]): Promise<WorkbookTable[]> {
    return this.withSession(itemId, async (headers) => {
      const res = await this.graph.batch(
        tables.map((t) => ({
          id: t,
          method: 'GET',
          url: `${this.base(itemId)}/tables/${encodeURIComponent(t)}/range?$select=address,formulas`,
          headers,
        })),
        false,
      );
      // A table missing from an older workbook (404) is skipped so the other tables still sync.
      return tables.flatMap((t) => {
        const r = res.get(t);
        if (r?.status === 404) return [];
        if (!r || r.status >= 400) throw batchError(r?.status ?? 500, r?.body);
        const body = r.body as { address: string; formulas: unknown[][] };
        const a = parseAddress(body.address);
        return [
          {
            name: t,
            sheet: a.sheet,
            headers: (body.formulas[0] ?? []).map((h) => String(h)),
            rows: body.formulas.slice(1),
            firstDataRow: a.firstRow + 1,
          },
        ];
      });
    });
  }

  async write(itemId: string, writes: WorkbookWrite[], cells: CellWrite[]) {
    const results = new Map<string, { table: string; ok: boolean; error?: string }>();
    if (!writes.some((w) => w.patches.length || w.appends.length) && cells.length === 0) return [];
    return this.withSession(itemId, async (headers) => {
      const reqs: {
        id: string;
        method: string;
        url: string;
        body: unknown;
        headers: Record<string, string>;
        table: string;
      }[] = [];
      const sheetUrl = (sheet: string) =>
        `${this.base(itemId)}/worksheets/${encodeURIComponent(sheet)}`;
      for (const w of writes) {
        results.set(w.table, { table: w.table, ok: true });
        w.patches.forEach((p, i) => {
          const end = cellRef(p.row, p.values.length);
          reqs.push({
            id: `${w.table}-p${i}`,
            method: 'PATCH',
            url: `${sheetUrl(w.sheet)}/range(address='A${p.row}:${end}')`,
            body: { values: [p.values] },
            headers,
            table: w.table,
          });
        });
        if (w.appends.length) {
          reqs.push({
            id: `${w.table}-add`,
            method: 'POST',
            url: `${this.base(itemId)}/tables/${encodeURIComponent(w.table)}/rows`,
            body: { values: w.appends },
            headers,
            table: w.table,
          });
        }
      }
      cells.forEach((c, i) => {
        reqs.push({
          id: `cells-${i}`,
          method: 'PATCH',
          url: `${sheetUrl(c.sheet)}/range(address='${c.address}')`,
          body: { values: c.values },
          headers,
          table: '_cells',
        });
      });
      const res = await this.graph.batch(reqs, true);
      for (const r of reqs) {
        const out = res.get(r.id);
        if (!out || out.status >= 400) {
          const err = batchError(out?.status ?? 424, out?.body);
          const cur = results.get(r.table) ?? { table: r.table, ok: true };
          results.set(r.table, {
            table: r.table,
            ok: false,
            error: cur.error ?? `${err.code}: ${err.message}`,
          });
        }
      }
      return [...results.values()];
    });
  }
}
