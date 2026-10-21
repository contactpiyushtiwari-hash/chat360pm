import { addDays, daysBetween, toExcelSerial, weekStart } from '../dates';
import type { OrgConfig, Project } from '../types';
import {
  SHEETS,
  desiredRows,
  headerBlock,
  trackerTables,
  FINANCE_HEADERS,
  type CellValue,
  type ColumnDef,
  type NameOf,
  type TableDef,
} from './tracker';
import {
  DXF,
  STYLE,
  cellRef,
  colLetter,
  toStorageFormula,
  writeXlsx,
  type CellSpec,
  type SheetSpec,
  type StyleId,
} from './xlsx';

/** Rows pre-covered by data validation / conditional formatting beyond the initial data. */
const FORMAT_ROWS = 1000;
const GANTT_FORMULA_ROWS = 300;

function styleFor(col: ColumnDef): StyleId {
  switch (col.type) {
    case 'date':
      return STYLE.date;
    case 'percent':
      return STYLE.percent;
    case 'money':
      return STYLE.money;
    case 'number':
      return STYLE.integer;
    case 'longtext':
      return STYLE.textWrap;
    default:
      // Text format stops Excel turning values like WBS "1.10" into the number 1.1.
      return STYLE.text;
  }
}

export function columnLetter(def: TableDef, header: string): string {
  const i = def.columns.findIndex((c) => c.header === header);
  if (i < 0) throw new Error(`Column ${header} not in ${def.name}`);
  return colLetter(i + 1);
}

/** Cell values for a new table row, including formula text for calculated columns. */
export function rowCells(def: TableDef, values: Record<string, CellValue>, storageForm: boolean) {
  return def.columns.map((c) => {
    if (c.formula) {
      return { formula: storageForm ? toStorageFormula(c.formula, def.name) : `=${c.formula}` };
    }
    return values[c.header] ?? '';
  });
}

function addTable(sheet: SheetSpec, def: TableDef, rows: { values: Record<string, CellValue> }[]) {
  const r0 = def.headerRow;
  def.columns.forEach((c, i) =>
    sheet.cells.push({ row: r0, col: i + 1, value: c.header, style: STYLE.header }),
  );
  const data = rows.length ? rows : [{ values: {} }];
  data.forEach((row, ri) => {
    const cells = rowCells(def, row.values, true);
    cells.forEach((value, ci) => {
      const col = def.columns[ci]!;
      sheet.cells.push({
        row: r0 + 1 + ri,
        col: ci + 1,
        value: value as CellSpec['value'],
        style: styleFor(col),
      });
    });
  });
  const last = cellRef(r0 + data.length, def.columns.length);
  sheet.tables.push({
    name: def.name,
    ref: `${cellRef(r0, 1)}:${last}`,
    columns: def.columns.map((c) => ({
      name: c.header,
      ...(c.formula ? { calculatedFormula: toStorageFormula(c.formula, def.name) } : {}),
    })),
  });
  const first = r0 + 1;
  const end = r0 + FORMAT_ROWS;
  def.columns.forEach((c, i) => {
    if (c.list) {
      const L = colLetter(i + 1);
      sheet.validations.push({ sqref: `${L}${first}:${L}${end}`, list: c.list });
    }
  });
  def.columns.forEach((c, i) => {
    while (sheet.colWidths.length < i + 1) sheet.colWidths.push(10);
    sheet.colWidths[i] = Math.max(sheet.colWidths[i]!, c.width);
  });
}

function statusFormats(sheet: SheetSpec, def: TableDef, header = 'Status') {
  const L = columnLetter(def, header);
  const first = def.headerRow + 1;
  const range = `${L}${first}:${L}${def.headerRow + FORMAT_ROWS}`;
  sheet.conditionalFormats.push(
    { sqref: range, formula: `$${L}${first}="Completed"`, dxf: DXF.completed },
    { sqref: range, formula: `$${L}${first}="Blocked"`, dxf: DXF.blocked },
  );
}

function newSheet(name: string, title: string, freezeAt: string): SheetSpec {
  return {
    name,
    cells: [
      { row: 1, col: 1, value: title, style: STYLE.title },
      {
        row: 3,
        col: 1,
        value:
          'Managed by Chat360 Project Operations. Rows are matched by ID; edit tasks in the app. Extra columns and rows you add are preserved.',
        style: STYLE.note,
      },
    ],
    colWidths: [],
    freezeAt,
    validations: [],
    conditionalFormats: [],
    tables: [],
  };
}

export interface GenerateOptions {
  config: OrgConfig;
  today: string;
  nameOf: NameOf;
  generatedAt: string;
}

export function buildTrackerSheets(project: Project, opts: GenerateOptions): SheetSpec[] {
  const defs = trackerTables(opts.config);
  const byName = new Map(defs.map((d) => [d.name, d]));
  const rows = desiredRows(project, opts.config, opts.today, opts.nameOf);
  const hdr = headerBlock(project, opts.nameOf);
  const get = (n: string) => byName.get(n)!;

  // Sheet 1: Gantt Chart, with a week-by-week timeline drawn by conditional formatting.
  const g = get('tblGantt');
  const gantt = newSheet(SHEETS[0], hdr.title, 'D6');
  gantt.cells.push(
    { row: 2, col: 1, value: 'Project ID', style: STYLE.label },
    { row: 2, col: 2, value: hdr.projectId },
    { row: 2, col: 3, value: 'Project Manager', style: STYLE.label },
    { row: 2, col: 4, value: hdr.pm },
    { row: 2, col: 5, value: 'Start', style: STYLE.label },
    { row: 2, col: 6, value: toExcelSerial(hdr.start), style: STYLE.date },
    { row: 2, col: 7, value: 'Target Go-Live', style: STYLE.label },
    { row: 2, col: 8, value: toExcelSerial(hdr.goLive), style: STYLE.date },
  );
  addTable(gantt, g, rows.tblGantt!);
  const tl0 = g.columns.length + 2;
  const span = daysBetween(weekStart(project.startDate), addDays(project.targetGoLive, 7));
  const weeks = Math.min(52, Math.max(8, Math.ceil(span / 7) + 2));
  for (let w = 0; w < weeks; w++) {
    const col = tl0 + w;
    const prev = cellRef(g.headerRow, col - 1);
    gantt.cells.push({
      row: g.headerRow,
      col,
      value: { formula: w === 0 ? '$F$2-WEEKDAY($F$2,3)' : `${prev}+7` },
      style: STYLE.weekHeader,
    });
    gantt.colWidths[col - 1] = 3.2;
  }
  // Narrow spacer column between the table and the timeline.
  gantt.colWidths[tl0 - 2] = 2;
  {
    const r = g.headerRow + 1;
    const T = colLetter(tl0);
    const S = columnLetter(g, 'Planned Start');
    const E = columnLetter(g, 'Planned End');
    const R = columnLetter(g, 'Revised End');
    const Ty = columnLetter(g, 'Type');
    const end = `IF($${R}${r}<>"",$${R}${r},$${E}${r})`;
    const range = `${T}${r}:${colLetter(tl0 + weeks - 1)}${g.headerRow + GANTT_FORMULA_ROWS}`;
    gantt.conditionalFormats.push(
      {
        sqref: range,
        formula: `AND($${Ty}${r}="Milestone",${T}$${g.headerRow}<=${end},${T}$${g.headerRow}+6>=${end})`,
        dxf: DXF.milestone,
      },
      {
        sqref: range,
        formula: `AND($${S}${r}<>"",${T}$${g.headerRow}+6>=$${S}${r},${T}$${g.headerRow}<=${end})`,
        dxf: DXF.bar,
      },
    );
    const St = columnLetter(g, 'Status');
    gantt.conditionalFormats.push({
      sqref: `A${r}:${colLetter(g.columns.length)}${g.headerRow + FORMAT_ROWS}`,
      formula: `AND(${end}<>"",${end}<TODAY(),$${St}${r}<>"Completed",$${St}${r}<>"Cancelled")`,
      dxf: DXF.overdue,
    });
  }
  statusFormats(gantt, g);

  // Sheet 2: WBS.
  const w = get('tblWBS');
  const wbs = newSheet(SHEETS[1], hdr.title, 'E6');
  addTable(wbs, w, rows.tblWBS!);
  {
    const r = w.headerRow + 1;
    const Due = columnLetter(w, 'Current Due');
    const St = columnLetter(w, 'Status');
    wbs.conditionalFormats.push({
      sqref: `A${r}:${colLetter(w.columns.length)}${w.headerRow + FORMAT_ROWS}`,
      formula: `AND($${Due}${r}<>"",$${Due}${r}<TODAY(),$${St}${r}<>"Completed",$${St}${r}<>"Cancelled")`,
      dxf: DXF.overdue,
    });
  }
  statusFormats(wbs, w);

  // Sheet 3: API List Pending.
  const a = get('tblAPIs');
  const apis = newSheet(SHEETS[2], hdr.title, 'C6');
  addTable(apis, a, rows.tblAPIs!);
  {
    const r = a.headerRow + 1;
    const Rd = columnLetter(a, 'Readiness');
    const Td = columnLetter(a, 'Target Date');
    const range = `${Rd}${r}:${Rd}${a.headerRow + FORMAT_ROWS}`;
    apis.conditionalFormats.push(
      { sqref: range, formula: `$${Rd}${r}="Ready"`, dxf: DXF.completed },
      { sqref: range, formula: `$${Rd}${r}="Blocked"`, dxf: DXF.blocked },
      {
        sqref: `${Td}${r}:${Td}${a.headerRow + FORMAT_ROWS}`,
        formula: `AND($${Td}${r}<>"",$${Td}${r}<TODAY(),$${Rd}${r}<>"Ready")`,
        dxf: DXF.overdue,
      },
    );
  }

  // Sheet 4: Escalation Matrix (policy) and Escalation Log (instances).
  const m = get('tblEscalationMatrix');
  const l = get('tblEscalationLog');
  const esc = newSheet(SHEETS[3], hdr.title, 'A6');
  esc.cells.push({
    row: 4,
    col: 1,
    value: 'Escalation matrix (from the approved policy)',
    style: STYLE.label,
  });
  addTable(esc, m, rows.tblEscalationMatrix!);
  esc.cells.push({ row: l.headerRow - 1, col: 1, value: 'Escalation log', style: STYLE.label });
  addTable(esc, l, rows.tblEscalationLog!);
  {
    const r = l.headerRow + 1;
    const Rs = columnLetter(l, 'Resolution Status');
    const range = `${Rs}${r}:${Rs}${l.headerRow + FORMAT_ROWS}`;
    esc.conditionalFormats.push(
      { sqref: range, formula: `$${Rs}${r}="Open"`, dxf: DXF.overdue },
      { sqref: range, formula: `$${Rs}${r}="Resolved"`, dxf: DXF.completed },
    );
  }

  // Sheets 5 and 6: weekly history. Rows are keyed by (week, task) so past weeks are preserved.
  const lw = get('tblLastWeek');
  const last = newSheet(SHEETS[4], hdr.title, 'D6');
  addTable(last, lw, rows.tblLastWeek!);
  statusFormats(last, lw);
  {
    const r = lw.headerRow + 1;
    const Cf = columnLetter(lw, 'Carry Forward');
    last.conditionalFormats.push({
      sqref: `${Cf}${r}:${Cf}${lw.headerRow + FORMAT_ROWS}`,
      formula: `$${Cf}${r}="Yes"`,
      dxf: DXF.blocked,
    });
  }

  const tw = get('tblThisWeek');
  const thisWeek = newSheet(SHEETS[5], hdr.title, 'D6');
  addTable(thisWeek, tw, rows.tblThisWeek!);
  statusFormats(thisWeek, tw);

  // Sheet 7: Finance (commercial position). One row per project, total computed by Excel.
  const fin = get('tblFinance');
  const finance = newSheet(SHEETS[6], hdr.title, 'B6');
  finance.cells.push({
    row: 4,
    col: 1,
    value: 'Commercial figures: anyone who can open this workbook can see this sheet.',
    style: STYLE.note,
  });
  addTable(finance, fin, rows.tblFinance!);
  {
    const r = fin.headerRow + 1;
    const O = columnLetter(fin, FINANCE_HEADERS.raisedOverdue);
    finance.conditionalFormats.push({
      sqref: `${O}${r}:${O}${fin.headerRow + FORMAT_ROWS}`,
      formula: `$${O}${r}>0`,
      dxf: DXF.overdue,
    });
  }

  return [gantt, wbs, apis, esc, last, thisWeek, finance];
}

export function generateTracker(project: Project, opts: GenerateOptions): Uint8Array {
  return writeXlsx(buildTrackerSheets(project, opts), {
    title: `${project.clientName} — ${project.name} tracker`,
    creator: 'Chat360 Project Operations',
    created: opts.generatedAt.replace(/\.\d{3}Z$/, 'Z'),
  });
}
