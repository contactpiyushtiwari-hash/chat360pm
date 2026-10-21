import { strToU8, zipSync } from 'fflate';

/**
 * Minimal SpreadsheetML (OOXML) writer. It supports exactly what the tracker needs:
 * shared strings, fixed cell styles, formulas, tables (with calculated columns),
 * list data validation, formula-based conditional formatting, column widths and freeze panes.
 * Element order follows the CT_Worksheet schema sequence, which Excel enforces.
 */

export const STYLE = {
  default: 0,
  header: 1,
  date: 2,
  title: 3,
  label: 4,
  percent: 5,
  wrap: 6,
  weekHeader: 7,
  integer: 8,
  note: 9,
  text: 10,
  textWrap: 11,
  money: 12,
} as const;
export type StyleId = (typeof STYLE)[keyof typeof STYLE];

export const DXF = { overdue: 0, completed: 1, blocked: 2, bar: 3, milestone: 4 } as const;
export type DxfId = (typeof DXF)[keyof typeof DXF];

export type CellInput = string | number | { formula: string };

export interface CellSpec {
  row: number;
  col: number;
  value: CellInput;
  style?: StyleId;
}

export interface TableSpec {
  name: string;
  /** Inclusive range including the header row, e.g. `A5:Q6`. */
  ref: string;
  columns: { name: string; calculatedFormula?: string }[];
}

export interface SheetSpec {
  name: string;
  cells: CellSpec[];
  colWidths: number[];
  /** Top-left cell of the scrollable pane, e.g. `C6` freezes rows 1-5 and columns A-B. */
  freezeAt?: string;
  validations: { sqref: string; list: readonly string[] }[];
  conditionalFormats: { sqref: string; formula: string; dxf: DxfId }[];
  tables: TableSpec[];
  merges?: string[];
}

export function colLetter(col: number): string {
  let s = '';
  let n = col;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export const cellRef = (row: number, col: number) => `${colLetter(col)}${row}`;

export function escapeXml(s: string): string {
  return (
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Strip control characters that are illegal in XML 1.0.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  );
}

/** Converts `[@Col]` / `[@[Col Name]]` table shorthand into the storage form Excel's file format requires. */
export function toStorageFormula(formula: string, table: string): string {
  return formula
    .replace(/\[@\[([^\]]+)\]\]/g, (_, c: string) => `${table}[[#This Row],[${c}]]`)
    .replace(/\[@([^[\]]+)\]/g, (_, c: string) => `${table}[[#This Row],[${c}]]`);
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd-mmm-yyyy"/><numFmt numFmtId="165" formatCode="dd-mmm"/></numFmts>
<fonts count="5">
<font><sz val="10"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><color rgb="FF1F2A44"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="10"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="9"/><color rgb="FF5B6475"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F2A44"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD0D5DD"/></left><right style="thin"><color rgb="FFD0D5DD"/></right><top style="thin"><color rgb="FFD0D5DD"/></top><bottom style="thin"><color rgb="FFD0D5DD"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="165" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" textRotation="90"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="5">
<dxf><font><color rgb="FF9B1C1C"/></font><fill><patternFill><bgColor rgb="FFFDE2E1"/></patternFill></fill></dxf>
<dxf><font><color rgb="FF14532D"/></font><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill></fill></dxf>
<dxf><font><color rgb="FF7C4A03"/></font><fill><patternFill><bgColor rgb="FFFEF3C7"/></patternFill></fill></dxf>
<dxf><fill><patternFill><bgColor rgb="FF3B82F6"/></patternFill></fill></dxf>
<dxf><fill><patternFill><bgColor rgb="FF1F2A44"/></patternFill></fill></dxf>
</dxfs>
<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;

class SharedStrings {
  private index = new Map<string, number>();
  readonly list: string[] = [];
  count = 0;
  id(s: string): number {
    this.count++;
    let i = this.index.get(s);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(s);
      this.index.set(s, i);
    }
    return i;
  }
  xml(): string {
    const items = this.list
      .map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`)
      .join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="${NS}" count="${this.count}" uniqueCount="${this.list.length}">${items}</sst>`;
  }
}

function sheetXml(sheet: SheetSpec, sst: SharedStrings, tableRelIds: string[]): string {
  const rows = new Map<number, CellSpec[]>();
  for (const c of sheet.cells) {
    const list = rows.get(c.row) ?? [];
    list.push(c);
    rows.set(c.row, list);
  }
  const rowXml = [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([r, cells]) => {
      const cs = cells
        .sort((a, b) => a.col - b.col)
        .map((c) => {
          const ref = cellRef(c.row, c.col);
          const s = c.style ? ` s="${c.style}"` : '';
          if (typeof c.value === 'number') return `<c r="${ref}"${s}><v>${c.value}</v></c>`;
          if (typeof c.value === 'string') {
            if (c.value === '') return `<c r="${ref}"${s}/>`;
            return `<c r="${ref}"${s} t="s"><v>${sst.id(c.value)}</v></c>`;
          }
          return `<c r="${ref}"${s}><f>${escapeXml(c.value.formula)}</f></c>`;
        })
        .join('');
      return `<row r="${r}">${cs}</row>`;
    })
    .join('');

  const freeze = sheet.freezeAt ? freezePane(sheet.freezeAt) : '<sheetView workbookViewId="0"/>';
  const cols = sheet.colWidths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');
  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : '';
  let priority = 1;
  const cf = sheet.conditionalFormats
    .map(
      (c) =>
        `<conditionalFormatting sqref="${c.sqref}"><cfRule type="expression" dxfId="${c.dxf}" priority="${priority++}"><formula>${escapeXml(c.formula)}</formula></cfRule></conditionalFormatting>`,
    )
    .join('');
  const dv = sheet.validations.length
    ? `<dataValidations count="${sheet.validations.length}">${sheet.validations
        .map(
          (v) =>
            `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Invalid value" error="Choose a value from the list." sqref="${v.sqref}"><formula1>${escapeXml(`"${v.list.join(',')}"`)}</formula1></dataValidation>`,
        )
        .join('')}</dataValidations>`
    : '';
  const tableParts = tableRelIds.length
    ? `<tableParts count="${tableRelIds.length}">${tableRelIds.map((id) => `<tablePart r:id="${id}"/>`).join('')}</tableParts>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS}" xmlns:r="${REL_NS}"><sheetViews>${freeze}</sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rowXml}</sheetData>${merges}${cf}${dv}<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>${tableParts}</worksheet>`;
}

function freezePane(topLeft: string): string {
  const m = /^([A-Z]+)(\d+)$/.exec(topLeft);
  if (!m) throw new Error(`Bad freeze ref ${topLeft}`);
  const colLetters = m[1]!;
  const row = Number(m[2]);
  let col = 0;
  for (const ch of colLetters) col = col * 26 + (ch.charCodeAt(0) - 64);
  const xSplit = col - 1;
  const ySplit = row - 1;
  const pane = xSplit > 0 && ySplit > 0 ? 'bottomRight' : ySplit > 0 ? 'bottomLeft' : 'topRight';
  const attrs = [
    xSplit > 0 ? `xSplit="${xSplit}"` : '',
    ySplit > 0 ? `ySplit="${ySplit}"` : '',
    `topLeftCell="${topLeft}"`,
    `activePane="${pane}"`,
    'state="frozen"',
  ]
    .filter(Boolean)
    .join(' ');
  return `<sheetView workbookViewId="0"><pane ${attrs}/><selection pane="${pane}" activeCell="${topLeft}" sqref="${topLeft}"/></sheetView>`;
}

function tableXml(t: TableSpec, id: number): string {
  const cols = t.columns
    .map((c, i) =>
      c.calculatedFormula
        ? `<tableColumn id="${i + 1}" name="${escapeXml(c.name)}"><calculatedColumnFormula>${escapeXml(c.calculatedFormula)}</calculatedColumnFormula></tableColumn>`
        : `<tableColumn id="${i + 1}" name="${escapeXml(c.name)}"/>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<table xmlns="${NS}" id="${id}" name="${t.name}" displayName="${t.name}" ref="${t.ref}" totalsRowShown="0"><autoFilter ref="${t.ref}"/><tableColumns count="${t.columns.length}">${cols}</tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`;
}

export interface WorkbookMeta {
  title: string;
  creator: string;
  created: string;
}

export function writeXlsx(sheets: SheetSpec[], meta: WorkbookMeta): Uint8Array {
  const sst = new SharedStrings();
  const files: Record<string, Uint8Array> = {};
  let tableId = 0;
  const overrides: string[] = [];

  sheets.forEach((sheet, i) => {
    const n = i + 1;
    const relIds: string[] = [];
    const rels: string[] = [];
    for (const t of sheet.tables) {
      tableId++;
      const rid = `rId${relIds.length + 1}`;
      relIds.push(rid);
      rels.push(
        `<Relationship Id="${rid}" Type="${REL_NS}/table" Target="../tables/table${tableId}.xml"/>`,
      );
      files[`xl/tables/table${tableId}.xml`] = strToU8(tableXml(t, tableId));
      overrides.push(
        `<Override PartName="/xl/tables/table${tableId}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`,
      );
    }
    files[`xl/worksheets/sheet${n}.xml`] = strToU8(sheetXml(sheet, sst, relIds));
    if (rels.length) {
      files[`xl/worksheets/_rels/sheet${n}.xml.rels`] = strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG_REL}">${rels.join('')}</Relationships>`,
      );
    }
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    );
  });

  const sheetEntries = sheets
    .map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  files['xl/workbook.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${NS}" xmlns:r="${REL_NS}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheetEntries}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
  );
  const wbRels = sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join('');
  const n = sheets.length;
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG_REL}">${wbRels}<Relationship Id="rId${n + 1}" Type="${REL_NS}/styles" Target="styles.xml"/><Relationship Id="rId${n + 2}" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
  );
  files['xl/styles.xml'] = strToU8(STYLES_XML);
  // Shared strings must be serialised after every sheet has registered its strings.
  files['xl/sharedStrings.xml'] = strToU8(sst.xml());
  files['docProps/core.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(meta.title)}</dc:title><dc:creator>${escapeXml(meta.creator)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${meta.created}</dcterms:created></cp:coreProperties>`,
  );
  files['docProps/app.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Chat360 Project Operations</Application></Properties>`,
  );
  files['_rels/.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL_NS}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  );
  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${overrides.join('')}</Types>`,
  );
  return zipSync(files, { level: 6 });
}
