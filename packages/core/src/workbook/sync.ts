import type { SyncConflict } from '../types';
import { rowCells } from './generate';
import { normalizeCell, rowKey, type DesiredRow, type TableDef } from './tracker';

/** A table as read from Excel: header names and each data row's cell formulas/values. */
export interface TableSnapshot {
  headers: string[];
  /** Data rows (excluding header), as returned by Graph `range.formulas`. */
  rows: unknown[][];
  /** Worksheet row number of the first data row. */
  firstDataRow: number;
}

export interface SyncPlan {
  /** Full-width row rewrites (existing rows), by worksheet row number. */
  patches: { row: number; values: unknown[] }[];
  /** New rows to append to the table, full width. */
  appends: unknown[][];
  conflicts: SyncConflict[];
  /** Hashes for every app row that now matches Excel (written or verified). */
  hashes: Record<string, string>;
  schemaError?: string;
  stats: {
    unchanged: number;
    patched: number;
    appended: number;
    conflicted: number;
    preservedForeignRows: number;
  };
}

/** FNV-1a 32-bit; only used to detect change, not for security. */
export function hashValues(values: string[]): string {
  let h = 0x811c9dc5;
  const s = values.join('\u001f');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const hashKey = (table: string, key: string) => `${table}:${key}`;

/**
 * Computes the minimal, non-destructive changes to bring an Excel table in line with the app:
 * - rows are matched by key columns, never by position;
 * - cells in columns the app does not manage (formulas, user-added columns) are kept as-is;
 * - rows without an app key are never modified (blank rows may be reused);
 * - nothing is deleted;
 * - a row edited in Excel since the app last wrote it is reported as a conflict, not overwritten,
 *   unless its key is in `force`.
 */
export function planTableSync(
  def: TableDef,
  snapshot: TableSnapshot,
  desired: DesiredRow[],
  lastHashes: Record<string, string>,
  opts: { now: string; force?: Set<string> },
): SyncPlan {
  const plan: SyncPlan = {
    patches: [],
    appends: [],
    conflicts: [],
    // Rows not rewritten this time (conflicts, older weeks) keep their previous hash.
    hashes: Object.fromEntries(
      Object.entries(lastHashes).filter(([k]) => k.startsWith(`${def.name}:`)),
    ),
    stats: { unchanged: 0, patched: 0, appended: 0, conflicted: 0, preservedForeignRows: 0 },
  };
  const headerIndex = new Map(snapshot.headers.map((h, i) => [String(h).trim(), i]));
  const managed = def.columns.filter((c) => !c.formula).map((c) => c.header);
  const missing = managed.filter((h) => !headerIndex.has(h));
  if (missing.length) {
    plan.schemaError = `Columns missing or renamed in ${def.sheet}: ${missing.join(', ')}`;
    return plan;
  }
  const width = snapshot.headers.length;
  const cellOf = (row: unknown[], header: string) => row[headerIndex.get(header)!];
  const managedOf = (row: unknown[]) => managed.map((h) => normalizeCell(cellOf(row, h)));

  const existing = new Map<string, { row: unknown[]; sheetRow: number }>();
  const blankSlots: number[] = [];
  snapshot.rows.forEach((row, i) => {
    const key = rowKey(def.keyColumns.map((k) => cellOf(row, k) as string | number));
    const sheetRow = snapshot.firstDataRow + i;
    if (key.replace(/\|/g, '') === '') {
      if (managedOf(row).every((v) => v === '')) blankSlots.push(sheetRow);
      else plan.stats.preservedForeignRows++;
      return;
    }
    if (!existing.has(key)) existing.set(key, { row, sheetRow });
    else plan.stats.preservedForeignRows++;
  });

  for (const d of desired) {
    const hk = hashKey(def.name, d.key);
    const want = managed.map((h) => normalizeCell(d.values[h]));
    const wantHash = hashValues(want);
    const cur = existing.get(d.key);
    if (cur) {
      const have = managedOf(cur.row);
      const haveHash = hashValues(have);
      if (haveHash === wantHash) {
        plan.hashes[hk] = wantHash;
        plan.stats.unchanged++;
        continue;
      }
      const last = lastHashes[hk];
      const editedInExcel = last === undefined || last !== haveHash;
      if (editedInExcel && !opts.force?.has(d.key)) {
        const excelValues: Record<string, unknown> = {};
        const appValues: Record<string, unknown> = {};
        managed.forEach((h, i) => {
          if (have[i] !== want[i]) {
            excelValues[h] = cellOf(cur.row, h);
            appValues[h] = d.values[h] ?? '';
          }
        });
        plan.conflicts.push({
          key: hk,
          table: def.name,
          rowKey: d.key,
          detectedAt: opts.now,
          excelValues,
          appValues,
        });
        plan.stats.conflicted++;
        continue;
      }
      const values = Array.from({ length: width }, (_, i) => cur.row[i] ?? '');
      for (const h of managed) values[headerIndex.get(h)!] = d.values[h] ?? '';
      plan.patches.push({ row: cur.sheetRow, values });
      plan.hashes[hk] = wantHash;
      plan.stats.patched++;
    } else {
      const template = rowCells(def, d.values, false);
      const values: unknown[] = Array.from({ length: width }, () => '');
      def.columns.forEach((c, i) => {
        const idx = headerIndex.get(c.header);
        if (idx !== undefined) {
          const v = template[i];
          values[idx] = typeof v === 'object' && v !== null && 'formula' in v ? v.formula : v;
        }
      });
      const slot = blankSlots.shift();
      if (slot !== undefined) plan.patches.push({ row: slot, values });
      else plan.appends.push(values);
      plan.hashes[hk] = wantHash;
      plan.stats.appended++;
    }
  }
  return plan;
}

/** Hashes of the rows written at generation time, so the first sync recognises them as app-written. */
export function initialRowHashes(
  tables: TableDef[],
  desired: Record<string, DesiredRow[]>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of tables) {
    const managed = def.columns.filter((c) => !c.formula).map((c) => c.header);
    for (const d of desired[def.name] ?? []) {
      out[hashKey(def.name, d.key)] = hashValues(managed.map((h) => normalizeCell(d.values[h])));
    }
  }
  return out;
}
