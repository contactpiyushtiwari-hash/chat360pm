import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  accessSubjectOf,
  buildHandoverSummary,
  can,
  financeOf,
  financeTotal,
  updateFinance,
  updateFinanceSchema,
} from '../src';
import { desiredRows, FINANCE_HEADERS, generateTracker } from '../src/workbook';
import { config, ctx, newProject, people } from './fixtures';

const input = {
  currency: 'INR',
  raisedOverdueForGoLive: 250000,
  raisableImmediately: 120000.5,
  toBeRaised: 400000,
  remarks: 'Milestone 2 invoice pending client PO',
};

describe('project finance', () => {
  it('starts empty and computes Total = raised & overdue + raisable immediately', () => {
    const p = newProject('blank');
    expect(financeOf(p)).toMatchObject({
      currency: 'INR',
      raisedOverdueForGoLive: 0,
      toBeRaised: 0,
      updatedAt: null,
    });
    updateFinance(p, input, ctx(people.pm));
    expect(financeTotal(financeOf(p))).toBe(370000.5);
    expect(p.audit.at(-1)).toMatchObject({ action: 'finance.updated' });
  });

  it('only PM, Sales POC and Delivery Head can edit; CSM can view; tech and FDE cannot see it', () => {
    const p = newProject('blank');
    const s = accessSubjectOf(p);
    const today = '2026-10-19';
    expect(can(people.sales, 'finance.edit', s, today)).toBe(true);
    expect(can(people.head, 'finance.edit', s, today)).toBe(true);
    expect(can(people.csm, 'finance.view', s, today)).toBe(true);
    expect(can(people.csm, 'finance.edit', s, today)).toBe(false);
    expect(can(people.tech, 'finance.view', s, today)).toBe(false);
    expect(can(people.fde, 'finance.view', s, today)).toBe(false);
    expect(can(people.admin, 'finance.view', s, today)).toBe(false);
    expect(() => updateFinance(p, input, ctx(people.tech))).toThrow(/Only the PM, Sales POC/);
    expect(() => updateFinance(p, input, ctx(people.sales))).not.toThrow();
  });

  it('validates amounts and currency', () => {
    expect(updateFinanceSchema.safeParse(input).success).toBe(true);
    expect(updateFinanceSchema.safeParse({ ...input, raisableImmediately: -1 }).success).toBe(
      false,
    );
    expect(updateFinanceSchema.safeParse({ ...input, toBeRaised: 1.234 }).success).toBe(false);
    expect(updateFinanceSchema.safeParse({ ...input, currency: 'rupees' }).success).toBe(false);
  });

  it('detects stale edits', () => {
    const p = newProject('blank');
    updateFinance(p, input, ctx(people.pm));
    expect(() =>
      updateFinance(p, { ...input, toBeRaised: 1, expectedUpdatedAt: null }, ctx(people.sales)),
    ).toThrow(/changed by someone else/);
  });

  it('is written to the Finance sheet with a Total formula and included in handovers', () => {
    const p = newProject('blank');
    updateFinance(p, input, ctx(people.pm));
    const rows = desiredRows(p, config(), '2026-10-19', (id) => id ?? '');
    expect(rows.tblFinance).toEqual([
      expect.objectContaining({
        key: p.id,
        values: expect.objectContaining({
          [FINANCE_HEADERS.raisedOverdue]: 250000,
          [FINANCE_HEADERS.toBeRaised]: 400000,
        }),
      }),
    ]);
    const files = unzipSync(
      generateTracker(p, {
        config: config(),
        today: '2026-10-19',
        nameOf: (id) => id ?? '',
        generatedAt: '2026-10-19T10:00:00.000Z',
      }),
    );
    const table = Object.keys(files)
      .map((f) => strFromU8(files[f]!))
      .find((x) => x.includes('name="tblFinance"'))!;
    expect(table).toContain(
      'tblFinance[[#This Row],[Amount Raised and Overdue (for Go-Live)]]+tblFinance[[#This Row],[Amount that can be raised on immediate basis]]',
    );
    expect(buildHandoverSummary(p, '2026-10-19', 'now').finance).toMatchObject({
      total: 370000.5,
      toBeRaised: 400000,
    });
  });
});
