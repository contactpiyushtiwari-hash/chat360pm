import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { confirmTask, createTask, toExcelSerial } from '../src';
import {
  SHEETS,
  desiredRows,
  generateTracker,
  hashKey,
  hashValues,
  normalizeCell,
  planTableSync,
  toStorageFormula,
  trackerTables,
  weekendMask,
  type TableSnapshot,
} from '../src/workbook';
import { config, ctx, newProject, people } from './fixtures';

const nameOf = (id: string | null) => (id ? id.toUpperCase() : '');
const opts = {
  config: config(),
  today: '2026-10-19',
  nameOf,
  generatedAt: '2026-10-19T10:00:00.000Z',
};

describe('tracker generation', () => {
  const p = newProject();
  const files = unzipSync(generateTracker(p, opts));
  const text = (name: string) => strFromU8(files[name]!);

  it('has the six required sheets plus Finance, in order', () => {
    const names = [...text('xl/workbook.xml').matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual([...SHEETS]);
  });

  it('defines one Excel table per data set with stable names', () => {
    const tables = Object.keys(files).filter((f) => f.startsWith('xl/tables/'));
    expect(tables).toHaveLength(8);
    const names = tables.map((f) => /name="(tbl\w+)"/.exec(text(f))![1]);
    expect(names.sort()).toEqual(
      [
        'tblAPIs',
        'tblEscalationLog',
        'tblEscalationMatrix',
        'tblFinance',
        'tblGantt',
        'tblLastWeek',
        'tblThisWeek',
        'tblWBS',
      ].sort(),
    );
    const wbs = tables.map(text).find((x) => x.includes('name="tblWBS"'))!;
    expect(wbs).toContain(`ref="A5:Q${5 + p.tasks.length}"`);
    expect(wbs).toContain('<calculatedColumnFormula>');
  });

  it('includes freeze panes, validations, conditional formats and formulas', () => {
    const wbs = text('xl/worksheets/sheet2.xml');
    expect(wbs).toContain('state="frozen"');
    expect(wbs).toMatch(
      /<dataValidation type="list"[^>]*>.*Not Started,In Progress,Blocked,Completed,Cancelled/,
    );
    expect(wbs).toContain('<conditionalFormatting');
    expect(wbs).toContain(
      'NETWORKDAYS.INTL(tblWBS[[#This Row],[Current Due]],TODAY(),&quot;0000011&quot;)',
    );
    const gantt = text('xl/worksheets/sheet1.xml');
    expect(gantt).toContain('$F$2-WEEKDAY($F$2,3)');
  });

  it('stores task data and never invents manager names', () => {
    const sst = text('xl/sharedStrings.xml');
    expect(sst).toContain('T-0001');
    expect(sst).toContain('Production go-live');
    expect(sst).toContain('Unassigned'.length ? 'PM1' : '');
  });

  it('writes dates as serial numbers and escapes XML', () => {
    const wbs = text('xl/worksheets/sheet2.xml');
    expect(wbs).toContain(`<v>${toExcelSerial(p.tasks[0]!.plannedStart)}</v>`);
  });
});

describe('formula helpers', () => {
  it('converts shorthand references to storage form', () => {
    expect(toStorageFormula('IF([@Status]="X",[@[Current Due]],"")', 'tblWBS')).toBe(
      'IF(tblWBS[[#This Row],[Status]]="X",tblWBS[[#This Row],[Current Due]],"")',
    );
  });
  it('builds weekend masks from working days', () => {
    expect(weekendMask([1, 2, 3, 4, 5])).toBe('0000011');
    expect(weekendMask([1, 2, 3, 4, 5, 6])).toBe('0000001');
  });
});

describe('sync planning', () => {
  const def = trackerTables(config()).find((t) => t.name === 'tblAPIs')!;
  const headers = def.columns.map((c) => c.header);
  const managed = def.columns.filter((c) => !c.formula).map((c) => c.header);
  const rowFrom = (v: Record<string, unknown>) =>
    headers.map((h) => (h === 'Days to Target' ? '=IF(...)' : (v[h] ?? '')));
  const desired = [
    {
      key: 'API-001',
      values: { 'API ID': 'API-001', 'API Name': 'CRM', Readiness: 'In Progress' },
    },
    {
      key: 'API-002',
      values: { 'API ID': 'API-002', 'API Name': 'Payments', Readiness: 'Not Started' },
    },
  ];
  const hashOf = (v: Record<string, unknown>) =>
    hashValues(managed.map((h) => normalizeCell(v[h])));

  it('appends missing rows, reusing a blank first row, with formula text', () => {
    const snap: TableSnapshot = { headers, rows: [headers.map(() => '')], firstDataRow: 6 };
    const plan = planTableSync(def, snap, desired, {}, { now: 'n' });
    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0]!.row).toBe(6);
    expect(plan.appends).toHaveLength(1);
    expect(plan.appends[0]![headers.indexOf('Days to Target')]).toMatch(/^=IF\(/);
    expect(Object.keys(plan.hashes)).toEqual([
      hashKey('tblAPIs', 'API-001'),
      hashKey('tblAPIs', 'API-002'),
    ]);
  });

  it('updates changed rows matched by key, keeping user columns and formulas', () => {
    const excelRow = [
      ...rowFrom({ 'API ID': 'API-001', 'API Name': 'CRM', Readiness: 'Not Started' }),
      'user note',
    ];
    const snap: TableSnapshot = {
      headers: [...headers, 'My Column'],
      rows: [excelRow],
      firstDataRow: 6,
    };
    const last = {
      [hashKey('tblAPIs', 'API-001')]: hashOf({
        'API ID': 'API-001',
        'API Name': 'CRM',
        Readiness: 'Not Started',
      }),
    };
    const plan = planTableSync(def, snap, [desired[0]!], last, { now: 'n' });
    expect(plan.conflicts).toEqual([]);
    expect(plan.patches).toHaveLength(1);
    const v = plan.patches[0]!.values;
    expect(v[headers.indexOf('Readiness')]).toBe('In Progress');
    expect(v[headers.indexOf('Days to Target')]).toBe('=IF(...)');
    expect(v.at(-1)).toBe('user note');
  });

  it('reports a conflict instead of overwriting a row edited in Excel', () => {
    const edited = rowFrom({
      'API ID': 'API-001',
      'API Name': 'CRM (renamed by hand)',
      Readiness: 'Ready',
    });
    const last = {
      [hashKey('tblAPIs', 'API-001')]: hashOf({
        'API ID': 'API-001',
        'API Name': 'CRM',
        Readiness: 'Not Started',
      }),
    };
    const snap: TableSnapshot = { headers, rows: [edited], firstDataRow: 6 };
    const plan = planTableSync(def, snap, [desired[0]!], last, { now: 'n' });
    expect(plan.patches).toEqual([]);
    expect(plan.conflicts[0]).toMatchObject({
      rowKey: 'API-001',
      excelValues: { 'API Name': 'CRM (renamed by hand)' },
    });
    expect(plan.hashes[hashKey('tblAPIs', 'API-001')]).toBe(last[hashKey('tblAPIs', 'API-001')]);
    const forced = planTableSync(def, snap, [desired[0]!], last, {
      now: 'n',
      force: new Set(['API-001']),
    });
    expect(forced.patches).toHaveLength(1);
  });

  it('never touches rows without an app key and never deletes', () => {
    const foreign = rowFrom({ 'API Name': 'Added by a human' });
    const old = rowFrom({ 'API ID': 'API-009', 'API Name': 'Old' });
    const snap: TableSnapshot = { headers, rows: [foreign, old], firstDataRow: 6 };
    const plan = planTableSync(def, snap, [], {}, { now: 'n' });
    expect(plan.patches).toEqual([]);
    expect(plan.appends).toEqual([]);
    expect(plan.stats.preservedForeignRows).toBe(1);
  });

  it('refuses to write when a managed column was removed or renamed', () => {
    const snap: TableSnapshot = {
      headers: headers.filter((h) => h !== 'Readiness'),
      rows: [],
      firstDataRow: 6,
    };
    const plan = planTableSync(def, snap, desired, {}, { now: 'n' });
    expect(plan.schemaError).toMatch(/Readiness/);
    expect(plan.appends).toEqual([]);
  });
});

describe('desired rows', () => {
  it('derives weekly and escalation rows from project state', () => {
    const p = newProject('blank');
    const t = createTask(
      p,
      {
        title: 'X',
        phase: 'Build',
        description: '',
        ownerId: people.tech.id,
        priority: 'medium',
        plannedStart: '2026-10-19',
        plannedEnd: '2026-10-19',
        isMilestone: false,
        clientCommitment: false,
        dependencies: [],
        parentId: null,
      },
      ctx(people.pm),
    );
    confirmTask(
      p,
      t.id,
      {
        outcome: 'not_completed',
        reasonCategory: 'api_blocker',
        reason: 'API down',
        impact: '',
        nextAction: 'Retry',
        revisedEta: '2026-10-21',
      },
      ctx(people.tech),
    );
    const rows = desiredRows(p, config(), '2026-10-19', nameOf);
    expect(rows.tblThisWeek).toHaveLength(1);
    expect(rows.tblThisWeek![0]!.values['Revised ETA']).toBe(toExcelSerial('2026-10-21'));
    expect(rows.tblEscalationLog![0]!.values).toMatchObject({
      'Task ID': t.id,
      Manager: 'PM1',
      'Resolution Status': 'Open',
    });
    expect(rows.tblEscalationMatrix).toHaveLength(2);
  });
});

describe('generation ↔ sync round trip', () => {
  it('a freshly generated workbook needs no changes and has no conflicts', async () => {
    const { readXlsxTables, initialRowHashes } = await import('../src/workbook');
    const p = newProject();
    const cfg = config();
    const desired = desiredRows(p, cfg, '2026-10-19', nameOf);
    const defs = trackerTables(cfg);
    const hashes = initialRowHashes(defs, desired);
    const tables = readXlsxTables(generateTracker(p, opts));
    expect(tables.map((t) => t.name).sort()).toEqual(defs.map((d) => d.name).sort());
    for (const def of defs) {
      const snap = tables.find((t) => t.name === def.name)!;
      const plan = planTableSync(def, snap, desired[def.name]!, hashes, { now: 'n' });
      expect({
        table: def.name,
        patches: plan.patches.length,
        appends: plan.appends.length,
        conflicts: plan.conflicts.length,
      }).toEqual({
        table: def.name,
        patches: 0,
        appends: 0,
        conflicts: 0,
      });
    }
  });
});
