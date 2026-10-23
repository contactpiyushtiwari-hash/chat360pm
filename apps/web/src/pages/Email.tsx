import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useResource } from '../lib/hooks';
import { track } from '../lib/telemetry';
import type { ProjectListItem } from '../lib/types';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  TextArea,
  useToast,
} from '../components/ui';

interface Template {
  id: string;
  label: string;
  audience: string;
  subject: string;
  body: string;
}

/** Builds a mailto: link. Very long bodies can exceed what some mail apps accept; Copy covers that. */
export function mailtoHref(to: string, cc: string, subject: string, body: string) {
  const q = new URLSearchParams();
  if (cc.trim()) q.set('cc', cc.trim());
  if (subject) q.set('subject', subject);
  if (body) q.set('body', body);
  // URLSearchParams encodes spaces as '+', which mail apps show literally.
  return `mailto:${encodeURI(to.replace(/\s+/g, ''))}?${q.toString().replace(/\+/g, '%20')}`;
}

export function EmailPage() {
  const toast = useToast();
  const [params] = useSearchParams();
  const [projectId, setProjectId] = useState(params.get('projectId') ?? '');
  const projects = useResource<{ projects: ProjectListItem[] }>('/api/projects');
  const templates = useResource<{ templates: Template[] }>(
    `/api/email/templates${projectId ? `?projectId=${projectId}` : ''}`,
  );
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      toast('success', 'Subject and message copied.');
    } catch {
      toast('error', 'Copy failed. Select the text and copy it manually.');
    }
  };

  return (
    <div className="narrow">
      <PageHeader
        title="Email drafts"
        subtitle="Fill a template from project data, then send it from your own email app. Nothing is sent from here."
      />
      {templates.error && <ErrorState error={templates.error} onRetry={templates.reload} />}
      <Card>
        <Field label="Project">
          {(a) => (
            <Select {...a} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Not linked to a project</option>
              {projects.data?.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.clientName} — {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Template">
          {(a) => (
            <Select
              {...a}
              value=""
              disabled={templates.loading}
              onChange={(e) => {
                const t = templates.data?.templates.find((x) => x.id === e.target.value);
                if (t) {
                  setSubject(t.subject);
                  setBody(t.body);
                }
              }}
            >
              <option value="">
                {templates.loading ? 'Loading templates…' : 'Choose a template (optional)'}
              </option>
              {templates.data?.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} ({t.audience})
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="To" hint="Comma-separated email addresses.">
          {(a) => <Input {...a} value={to} onChange={(e) => setTo(e.target.value)} />}
        </Field>
        <Field label="Cc">
          {(a) => <Input {...a} value={cc} onChange={(e) => setCc(e.target.value)} />}
        </Field>
        <Field label="Subject">
          {(a) => <Input {...a} value={subject} onChange={(e) => setSubject(e.target.value)} />}
        </Field>
        <Field label="Message">
          {(a) => (
            <TextArea {...a} rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
          )}
        </Field>
        <div className="form-actions">
          <Button onClick={() => void copy()} disabled={!subject && !body}>
            Copy
          </Button>
          <a
            className="btn btn-primary"
            href={mailtoHref(to, cc, subject, body)}
            onClick={() => track('email_draft_opened')}
          >
            <span>Open in my email app</span>
          </a>
        </div>
      </Card>
    </div>
  );
}
