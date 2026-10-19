import { strFromU8, unzipSync } from 'fflate';
import type { TableSnapshot } from './sync';

/**
 * Reads the tables back out of an .xlsx produced by `writeXlsx` (shared strings, numbers, formulas).
 * Used by the in-memory workbook gateway (local development and tests), not for arbitrary files.
 */
export interface ReadTable extends TableSnapshot {
  name: string;
  sheet: string;
  headerRow: number;
  firstCol: number;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseRef(ref: string) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`Bad cell ref ${ref}`);
  return { col: colNumber(m[1]!), row: Number(m[2]) };
}

export function readXlsxTables(bytes: Uint8Array): ReadTable[] {
  const files = unzipSync(bytes);
  const text = (n: string) => (files[n] ? strFromU8(files[n]!) : '');
  const strings = [
    ...text('xl/sharedStrings.xml').matchAll(/<si><t[^>]*>([\s\S]*?)<\/t><\/si>/g),
  ].map((m) => decode(m[1]!));
  const sheetNames = [...text('xl/workbook.xml').matchAll(/<sheet name="([^"]+)"/g)].map((m) =>
    decode(m[1]!),
  );
  const out: ReadTable[] = [];
  sheetNames.forEach((sheet, i) => {
    const xml = text(`xl/worksheets/sheet${i + 1}.xml`);
    const cells = new Map<string, unknown>();
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, attrs, inner = ''] = m;
      const f = /<f>([\s\S]*?)<\/f>/.exec(inner);
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      if (f) cells.set(ref!, `=${decode(f[1]!)}`);
      else if (v && / t="s"/.test(attrs!)) cells.set(ref!, strings[Number(v[1])] ?? '');
      else if (v) cells.set(ref!, Number(v[1]));
    }
    const rels = text(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`);
    for (const r of rels.matchAll(/Target="\.\.\/tables\/(table\d+\.xml)"/g)) {
      const t = text(`xl/tables/${r[1]}`);
      const name = /name="([^"]+)"/.exec(t)![1]!;
      const [a, b] = /ref="([^"]+)"/.exec(t)![1]!.split(':');
      const start = parseRef(a!);
      const end = parseRef(b!);
      const grid: unknown[][] = [];
      for (let row = start.row; row <= end.row; row++) {
        const line: unknown[] = [];
        for (let col = start.col; col <= end.col; col++) {
          let letters = '';
          let n = col;
          while (n > 0) {
            letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
            n = Math.floor((n - 1) / 26);
          }
          line.push(cells.get(`${letters}${row}`) ?? '');
        }
        grid.push(line);
      }
      out.push({
        name,
        sheet,
        headerRow: start.row,
        firstCol: start.col,
        headers: (grid[0] ?? []).map(String),
        rows: grid.slice(1),
        firstDataRow: start.row + 1,
      });
    }
  });
  return out;
}
