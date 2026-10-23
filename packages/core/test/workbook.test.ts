import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { confirmTask, createTask, toExcelSerial } from '../src';
import {
  SHEETS,
  desiredRows,
  generateTracker,
  toStorageFormula,
  weekendMask,
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
