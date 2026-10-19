import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { post } from '../lib/api';
import { useAction, useResource } from '../lib/hooks';
import { useMe } from '../lib/session';
import { track } from '../lib/telemetry';
import type { ProjectListItem } from '../lib/types';
import {
  Button,
  Card,
  Checkbox,
  Field,
  InlineError,
  Input,
  KeyValue,
  PageHeader,
  Select,
  TextArea,
  useToast,
} from '../components/ui';
import { ConnectOutlook } from '../components/ConnectOutlook';

interface Template {
  id: string;
  label: string;
  audience: string;
  subject: string;
  body: string;
}
interface Preview {
  preview: {
    from: string;
    to: string[];
    cc: string[];
    subject: string;
    body: string;
    attachments: string[];
  };
  externalRecipients: string[];
  requiresExternalConfirmation: boolean;
  previewToken: string;
}
const split = (s: string) =>
  s
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

export function EmailPage() {
  const me = useMe();
  const toast = useToast();
  const [params] = useSearchParams();
  const [projectId, setProjectId] = useState(params.get('projectId') ?? '');
  const projects = useResource<{ projects: ProjectListItem[] }>('/api/projects');
  const templates = useResource<{ templates: Template[] }>(
    me.outlookConsent ? `/api/email/templates${projectId ? `?projectId=${projectId}` : ''}` : null,
  );
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [includeLink, setIncludeLink] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmExternal, setConfirmExternal] = useState(false);
  useEffect(() => setPreview(null), [to, cc, subject, body, includeLink, projectId]);

  const draft = () => ({
    projectId: projectId || null,
    templateId: null,
    to: split(to),
    cc: split(cc),
    subject,
    body,
    includeWorkbookLink: includeLink,
  });
  const doPreview = useAction(async () => {
    setPreview(await post<Preview>('/api/email/preview', draft()));
    setConfirmExternal(false);
    track('email_preview_opened');
  });
  const send = useAction(async () => {
    await post('/api/email/send', {
      ...draft(),
      previewToken: preview!.previewToken,
      confirmExternal,
    });
    toast('success', 'Outlook accepted the email for delivery.');
    setPreview(null);
    setSubject('');
    setBody('');
    setTo('');
    setCc('');
  });

  if (!me.outlookConsent)
    return (
      <>
        <PageHeader title="Email" />
        <ConnectOutlook returnTo={`/email${projectId ? `?projectId=${projectId}` : ''}`} />
      </>
    );
  const f = doPreview.error?.fields ?? {};
  return (
    <div className="narrow">
      <PageHeader
        title="Compose email"
        subtitle="Sent from your own Outlook mailbox. You always see a preview and confirm before anything is sent."
      />
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
              onChange={(e) => {
                const t = templates.data?.templates.find((x) => x.id === e.target.value);
                if (t) {
                  setSubject(t.subject);
                  setBody(t.body);
                }
              }}
            >
              <option value="">Choose a template (optional)</option>
              {templates.data?.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} ({t.audience})
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="To"
          required
          error={f.to ?? f['to.0']}
          hint="Comma-separated email addresses."
        >
          {(a) => <Input {...a} value={to} onChange={(e) => setTo(e.target.value)} />}
        </Field>
        <Field label="Cc" error={f.cc}>
          {(a) => <Input {...a} value={cc} onChange={(e) => setCc(e.target.value)} />}
        </Field>
        <Field label="Subject" required error={f.subject}>
          {(a) => <Input {...a} value={subject} onChange={(e) => setSubject(e.target.value)} />}
        </Field>
        <Field label="Message" required error={f.body}>
          {(a) => (
            <TextArea {...a} rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
          )}
        </Field>
        {projectId && (
          <Checkbox
            label="Include a link to the project's Excel tracker"
            checked={includeLink}
            onChange={setIncludeLink}
            hint="Recipients need OneDrive access to open it."
          />
        )}
        <InlineError error={doPreview.error && !Object.keys(f).length ? doPreview.error : null} />
        <div className="form-actions">
          <Button
            variant="primary"
            loading={doPreview.pending}
            onClick={() => void doPreview.run()}
          >
            Preview
          </Button>
        </div>
      </Card>
      {preview && (
        <Card title="Preview — this is exactly what will be sent">
          <KeyValue
            items={[
              ['From', preview.preview.from],
              ['To', preview.preview.to.join(', ')],
              ['Cc', preview.preview.cc.join(', ') || '—'],
              ['Subject', preview.preview.subject],
              [
                'Attachments',
                preview.preview.attachments.length
                  ? preview.preview.attachments.join(', ')
                  : 'None',
              ],
            ]}
          />
          <pre className="email-preview">{preview.preview.body}</pre>
          {preview.requiresExternalConfirmation && (
            <Checkbox
              label={
                <>
                  Send to <strong>{preview.externalRecipients.length} external recipient(s)</strong>
                  : {preview.externalRecipients.join(', ')}
                </>
              }
              checked={confirmExternal}
              onChange={setConfirmExternal}
            />
          )}
          <InlineError error={send.error} />
          <div className="form-actions">
            <Button onClick={() => setPreview(null)}>Edit</Button>
            <Button
              variant="primary"
              disabled={preview.requiresExternalConfirmation && !confirmExternal}
              loading={send.pending}
              onClick={() => void send.run()}
            >
              Send email
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
