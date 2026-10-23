import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { newIdempotencyKey, post } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useAction, useResource } from '../lib/hooks';
import { useMe, useSession } from '../lib/session';
import {
  Button,
  Card,
  ErrorState,
  Field,
  InlineError,
  Input,
  KeyValue,
  PageHeader,
  Select,
  Skeleton,
  TextArea,
} from '../components/ui';
import { UserMultiSelect, UserSelect } from '../components/UserPicker';
import { NotFoundPage } from './NotFound';

interface Meta {
  templates: { id: string; label: string; description: string; taskCount: number }[];
  categories: string[];
  destinations: { id: string; label: string }[];
}

const STEPS = ['Basics', 'Team', 'Scope', 'Template & location', 'Review'] as const;
const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

export function ProjectNewPage() {
  const me = useMe();
  const { nameOf } = useSession();
  const nav = useNavigate();
  const meta = useResource<Meta>('/api/projects/templates');
  const [step, setStep] = useState(0);
  // One key for this wizard: a retried submit cannot create a second project.
  const [key] = useState(newIdempotencyKey);
  const [f, setF] = useState({
    clientName: '',
    name: '',
    category: '',
    pmId: me.user.roles.includes('pm') ? me.user.id : (null as string | null),
    techIds: [] as string[],
    fdeId: null as string | null,
    salesPocId: null as string | null,
    csmId: null as string | null,
    deliveryHeadId: null as string | null,
    startDate: me.today,
    targetGoLive: '',
    languages: 'English',
    integrations: '',
    qaUatWorkflow: 'Internal QA, then client UAT with sign-off',
    templateId: 'standard_bot',
    destinationId: 'default',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const create = useAction(async () => {
    const res = await post<{ project: { id: string } }>(
      '/api/projects',
      {
        ...f,
        category: f.category || meta.data?.categories[0],
        languages: splitList(f.languages),
        integrations: splitList(f.integrations),
      },
      key,
    );
    nav(`/projects/${res.project.id}?created=1`);
  });
  const errs = create.error?.fields ?? {};

  if (!me.permissions.createProject) return <NotFoundPage />;
  if (meta.loading) return <Skeleton lines={8} />;
  if (meta.error) return <ErrorState error={meta.error} onRetry={meta.reload} />;
  const m = meta.data!;
  const stepValid = [
    !!f.clientName.trim() && !!f.name.trim(),
    !!f.pmId,
    !!f.startDate && !!f.targetGoLive && f.targetGoLive >= f.startDate,
    !!f.templateId && !!f.destinationId,
    true,
  ];

  return (
    <div className="narrow">
      <PageHeader
        title="New project"
        subtitle="The wizard creates the project and its task plan from a template."
      />
      <ol className="stepper" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={i === step ? 'step-current' : i < step ? 'step-done' : ''}
            aria-current={i === step ? 'step' : undefined}
          >
            <span className="step-num">{i + 1}</span> {s}
          </li>
        ))}
      </ol>
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (step < STEPS.length - 1) setStep(step + 1);
            else void create.run();
          }}
        >
          {step === 0 && (
            <>
              <Field label="Client name" required error={errs.clientName}>
                {(p) => (
                  <Input
                    {...p}
                    value={f.clientName}
                    onChange={(e) => set('clientName', e.target.value)}
                    autoComplete="off"
                  />
                )}
              </Field>
              <Field label="Project name" required error={errs.name}>
                {(p) => (
                  <Input
                    {...p}
                    value={f.name}
                    onChange={(e) => set('name', e.target.value)}
                    autoComplete="off"
                  />
                )}
              </Field>
              <Field label="Category" required error={errs.category}>
                {(p) => (
                  <Select
                    {...p}
                    value={f.category || m.categories[0]}
                    onChange={(e) => set('category', e.target.value)}
                  >
                    {m.categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                )}
              </Field>
            </>
          )}
          {step === 1 && (
            <>
              <Field
                label="Project Manager"
                required
                error={errs.pmId}
                hint="Must hold the PM role."
              >
                {(p) => (
                  <UserSelect
                    {...p}
                    role="pm"
                    allowEmpty={false}
                    value={f.pmId}
                    onChange={(v) => set('pmId', v)}
                  />
                )}
              </Field>
              <UserMultiSelect
                legend="Tech team"
                role="tech"
                value={f.techIds}
                onChange={(v) => set('techIds', v)}
              />
              <Field label="FDE (bot builder)">
                {(p) => (
                  <UserSelect {...p} role="fde" value={f.fdeId} onChange={(v) => set('fdeId', v)} />
                )}
              </Field>
              <Field label="Sales POC">
                {(p) => (
                  <UserSelect
                    {...p}
                    role="sales_poc"
                    value={f.salesPocId}
                    onChange={(v) => set('salesPocId', v)}
                  />
                )}
              </Field>
              <Field label="Customer Success Manager">
                {(p) => (
                  <UserSelect {...p} role="csm" value={f.csmId} onChange={(v) => set('csmId', v)} />
                )}
              </Field>
              <Field
                label="Delivery and Operations Head"
                hint="Receives level-2 escalations and transfer requests for this project."
                error={errs.deliveryHeadId}
              >
                {(p) => (
                  <UserSelect
                    {...p}
                    role="delivery_head"
                    value={f.deliveryHeadId}
                    onChange={(v) => set('deliveryHeadId', v)}
                  />
                )}
              </Field>
            </>
          )}
          {step === 2 && (
            <>
              <div className="grid-2">
                <Field label="Start date" required error={errs.startDate}>
                  {(p) => (
                    <Input
                      {...p}
                      type="date"
                      value={f.startDate}
                      onChange={(e) => set('startDate', e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Target go-live" required error={errs.targetGoLive}>
                  {(p) => (
                    <Input
                      {...p}
                      type="date"
                      min={f.startDate}
                      value={f.targetGoLive}
                      onChange={(e) => set('targetGoLive', e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <Field label="Languages" hint="Comma separated.">
                {(p) => (
                  <Input
                    {...p}
                    value={f.languages}
                    onChange={(e) => set('languages', e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Integrations and dependencies"
                hint="Comma separated, e.g. CRM, payments. Never include credentials."
              >
                {(p) => (
                  <Input
                    {...p}
                    value={f.integrations}
                    onChange={(e) => set('integrations', e.target.value)}
                  />
                )}
              </Field>
              <Field label="QA / UAT workflow">
                {(p) => (
                  <TextArea
                    {...p}
                    value={f.qaUatWorkflow}
                    onChange={(e) => set('qaUatWorkflow', e.target.value)}
                  />
                )}
              </Field>
            </>
          )}
          {step === 3 && (
            <>
              <fieldset className="fieldset">
                <legend>Project template</legend>
                {m.templates.map((t) => (
                  <label key={t.id} className="radio-card">
                    <input
                      type="radio"
                      name="template"
                      checked={f.templateId === t.id}
                      onChange={() => set('templateId', t.id)}
                    />
                    <span>
                      <strong>{t.label}</strong>{' '}
                      <span className="hint">({t.taskCount} starter tasks)</span>
                      <span className="hint block">{t.description}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {m.destinations.length > 1 && (
                <Field label="Project group" required hint="Groups are set up by an administrator.">
                  {(p) => (
                    <Select
                      {...p}
                      value={f.destinationId}
                      onChange={(e) => set('destinationId', e.target.value)}
                    >
                      {m.destinations.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
            </>
          )}
          {step === 4 && (
            <>
              <KeyValue
                items={[
                  ['Client / project', `${f.clientName} — ${f.name}`],
                  ['Category', f.category || m.categories[0]],
                  ['PM', nameOf(f.pmId)],
                  ['Tech team', f.techIds.map(nameOf).join(', ') || '—'],
                  ['FDE / Sales / CSM', [f.fdeId, f.salesPocId, f.csmId].map(nameOf).join(' / ')],
                  ['Delivery Head', nameOf(f.deliveryHeadId)],
                  ['Dates', `${fmtDate(f.startDate)} → ${fmtDate(f.targetGoLive)}`],
                  [
                    'Template',
                    m.templates.find((t) => t.id === f.templateId)?.label ?? f.templateId,
                  ],
                ]}
              />
              <p className="hint">
                After creating, you can download the Excel tracker (Gantt, WBS, API List Pending,
                Escalation Matrix, Last Week Task, This Week Task, Finance) from the project page at
                any time. It always reflects the current project.
              </p>
            </>
          )}
          <InlineError error={create.error} />
          {Object.keys(errs).length > 0 && (
            <p className="field-error">
              Please fix the highlighted fields (check earlier steps too).
            </p>
          )}
          <div className="form-actions">
            {step > 0 ? (
              <Button onClick={() => setStep(step - 1)}>Back</Button>
            ) : (
              <Link to="/projects" className="btn btn-ghost">
                Cancel
              </Link>
            )}
            <Button
              type="submit"
              variant="primary"
              disabled={!stepValid[step]}
              loading={create.pending}
            >
              {step < STEPS.length - 1 ? 'Next' : 'Create project'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
