import { describe, expect, it } from 'vitest';
import { readJson, setup, trackerText } from './helpers';

const figures = {
  currency: 'INR',
  raisedOverdueForGoLive: 425000,
  raisableImmediately: 75000.5,
  toBeRaised: 900000,
  remarks: 'Go-live invoice overdue by 10 days',
};

describe('project finance API', () => {
  it('Sales POC updates finance; the downloaded tracker shows it', async () => {
    const t = await setup();
    const id = t.projects[0]!;
    const sales = await t.as('demo-sales');
    const res = await sales.put(`/api/projects/${id}/finance`, figures);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.project.finance).toMatchObject({
      raisedOverdueForGoLive: 425000,
      updatedBy: 'demo-sales',
    });
    expect(body.project.permissions).toMatchObject({ viewFinance: true, editFinance: true });
    const xlsx = await trackerText(sales, id);
    expect(xlsx).toContain('<v>425000</v>');
    expect(xlsx).toContain('<v>900000</v>');
  });

  it('validates input and rejects edits from roles without finance rights', async () => {
    const t = await setup();
    const id = t.projects[0]!;
    const pm = await t.as('demo-pm1');
    expect(
      (await pm.put(`/api/projects/${id}/finance`, { ...figures, raisableImmediately: -5 })).status,
    ).toBe(422);
    const csm = await t.as('demo-csm');
    expect((await csm.put(`/api/projects/${id}/finance`, figures)).status).toBe(403);
    const tech = await t.as('demo-tech1');
    expect((await tech.put(`/api/projects/${id}/finance`, figures)).status).toBe(403);
  });

  it('hides amounts from technical staff everywhere: project, audit history and transfer snapshots', async () => {
    const t = await setup();
    const id = t.projects[0]!;
    const pm = await t.as('demo-pm1');
    await pm.put(`/api/projects/${id}/finance`, figures);
    await pm.post(`/api/projects/${id}/transfers`, {
      proposedPmId: null,
      reason: 'Leave',
      requestedEffectiveDate: '2026-12-01',
      submit: true,
    });
    const tech = await t.as('demo-tech1');
    const view = await readJson(await tech.get(`/api/projects/${id}`));
    expect(view.project.finance).toBeUndefined();
    expect(view.project.permissions.viewFinance).toBe(false);
    const raw = JSON.stringify(view);
    expect(raw).not.toContain('425000');
    expect(raw).not.toContain('900000');
    const history = JSON.stringify(await readJson(await tech.get(`/api/projects/${id}/history`)));
    expect(history).toContain('finance.updated');
    expect(history).not.toContain('425000');
    const xlsx = await trackerText(tech, id);
    expect(xlsx).toContain('Finance');
    expect(xlsx).not.toContain('425000');
    const csm = await t.as('demo-csm');
    expect((await readJson(await csm.get(`/api/projects/${id}`))).project.finance.toBeRaised).toBe(
      900000,
    );
  });

  it('reports per-currency totals only to people who may see them', async () => {
    const t = await setup();
    const head = await t.as('demo-head');
    const a = (await readJson(await head.get('/api/analytics'))).analytics;
    expect(a.finance).toEqual([
      expect.objectContaining({
        currency: 'INR',
        raisedOverdueForGoLive: 350000,
        raisableImmediately: 150000,
        total: 500000,
        toBeRaised: 600000,
      }),
    ]);
    const tech = await t.as('demo-tech1');
    expect((await readJson(await tech.get('/api/analytics'))).analytics.finance).toEqual([]);
  });
});
