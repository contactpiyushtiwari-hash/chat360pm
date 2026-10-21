import { useState } from 'react';
import { financeTotal, type ProjectFinance } from '@chat360/core';
import { put } from '../lib/api';
import { fmtInstant, fmtMoney } from '../lib/format';
import { useAction } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { ProjectView } from '../lib/types';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  InlineError,
  Input,
  TextArea,
  useToast,
} from './ui';

/** Column names as used in Chat360's tracker (also the Excel Finance sheet headers). */
export const FINANCE_LABELS = {
  raisedOverdue: 'Amount Raised and Overdue (for Go-Live)',
  raisable: 'Amount that can be raised on immediate basis',
  total: 'Total',
  toBeRaised: 'Amount to be raised',
} as const;

export function FinanceTab({ p, reload }: { p: ProjectView; reload: () => Promise<void> }) {
  const { nameOf } = useSession();
  const [editing, setEditing] = useState(false);
  const f = p.finance;
  if (!f)
    return (
      <EmptyState title="Finance is not available">
        You do not have access to this project’s commercial figures.
      </EmptyState>
    );
  const money = (n: number) => fmtMoney(n, f.currency);
  const items: [string, number, string?][] = [
    [
      FINANCE_LABELS.raisedOverdue,
      f.raisedOverdueForGoLive,
      f.raisedOverdueForGoLive > 0 ? 'stat-alert' : '',
    ],
    [FINANCE_LABELS.raisable, f.raisableImmediately],
    [FINANCE_LABELS.total, financeTotal(f)],
    [FINANCE_LABELS.toBeRaised, f.toBeRaised],
  ];
  return (
    <Card
      title="Finance"
      actions={
        p.permissions.editFinance && (
          <Button variant="primary" onClick={() => setEditing(true)}>
            Update figures
          </Button>
        )
      }
    >
      <div className="stats">
        {items.map(([label, value, cls]) => (
          <div key={label} className={`stat ${cls ?? ''}`}>
            <span className="stat-value money">{money(value)}</span>
            <span className="stat-label">{label}</span>
          </div>
        ))}
      </div>
      <p className="hint">
        Total = {FINANCE_LABELS.raisedOverdue} + {FINANCE_LABELS.raisable}. Currency {f.currency}.{' '}
        {f.updatedAt
          ? `Last updated ${fmtInstant(f.updatedAt)} by ${nameOf(f.updatedBy)}.`
          : 'Not updated yet.'}
      </p>
      {f.remarks && <p className="pre">{f.remarks}</p>}
      <p className="notice">
        These figures also appear on the <strong>Finance</strong> sheet of the Excel tracker, which
        anyone with access to the project folder can open.
      </p>
      {editing && (
        <FinanceDialog
          p={p}
          f={f}
          onClose={() => setEditing(false)}
          onDone={async () => {
            setEditing(false);
            await reload();
          }}
        />
      )}
    </Card>
  );
}

const toNumber = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(/,/g, '')));

function FinanceDialog({
  p,
  f,
  onClose,
  onDone,
}: {
  p: ProjectView;
  f: ProjectFinance;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    currency: f.currency,
    raisedOverdueForGoLive: String(f.raisedOverdueForGoLive),
    raisableImmediately: String(f.raisableImmediately),
    toBeRaised: String(f.toBeRaised),
    remarks: f.remarks,
  });
  const set = <K extends keyof typeof form>(k: K, v: string) => setForm((x) => ({ ...x, [k]: v }));
  const total = toNumber(form.raisedOverdueForGoLive) + toNumber(form.raisableImmediately);
  const save = useAction(async () => {
    await put(`/api/projects/${p.id}/finance`, {
      currency: form.currency.trim().toUpperCase(),
      raisedOverdueForGoLive: toNumber(form.raisedOverdueForGoLive),
      raisableImmediately: toNumber(form.raisableImmediately),
      toBeRaised: toNumber(form.toBeRaised),
      remarks: form.remarks,
      expectedUpdatedAt: f.updatedAt,
    });
    toast('success', 'Finance updated. The Excel Finance sheet will update in the background.');
    onDone();
  });
  const e = save.error?.fields ?? {};
  const amount = (
    key: 'raisedOverdueForGoLive' | 'raisableImmediately' | 'toBeRaised',
    label: string,
  ) => (
    <Field label={label} required error={e[key]}>
      {(a) => (
        <Input
          {...a}
          inputMode="decimal"
          value={form[key]}
          onChange={(x) => set(key, x.target.value)}
        />
      )}
    </Field>
  );
  return (
    <Dialog
      open
      title="Update finance"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.pending} onClick={() => void save.run()}>
            Save
          </Button>
        </>
      }
    >
      <InlineError error={save.error && !Object.keys(e).length ? save.error : null} />
      <Field label="Currency" required error={e.currency} hint="3-letter code, e.g. INR, USD.">
        {(a) => (
          <Input
            {...a}
            maxLength={3}
            value={form.currency}
            onChange={(x) => set('currency', x.target.value.toUpperCase())}
          />
        )}
      </Field>
      {amount('raisedOverdueForGoLive', FINANCE_LABELS.raisedOverdue)}
      {amount('raisableImmediately', FINANCE_LABELS.raisable)}
      <p className="hint">
        {FINANCE_LABELS.total}:{' '}
        <strong>
          {Number.isFinite(total)
            ? fmtMoney(total, /^[A-Z]{3}$/.test(form.currency) ? form.currency : 'INR')
            : '—'}
        </strong>{' '}
        (calculated)
      </p>
      {amount('toBeRaised', FINANCE_LABELS.toBeRaised)}
      <Field label="Remarks" error={e.remarks}>
        {(a) => (
          <TextArea {...a} value={form.remarks} onChange={(x) => set('remarks', x.target.value)} />
        )}
      </Field>
    </Dialog>
  );
}
