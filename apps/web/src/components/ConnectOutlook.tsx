import { Card } from './ui';

export function ConnectOutlook({ returnTo }: { returnTo: string }) {
  return (
    <Card title="Connect Outlook">
      <p>
        Email and calendar features act as you, using your own Outlook mailbox and calendar.
        Microsoft will ask you to allow <strong>Mail.Send</strong> and{' '}
        <strong>Calendars.ReadWrite</strong>.
      </p>
      <p className="hint">
        If your organisation requires admin approval for these permissions, the Microsoft page will
        say so; ask IT to approve the Chat360 Project Operations app.
      </p>
      <a
        className="btn btn-primary"
        href={`/api/auth/consent?returnTo=${encodeURIComponent(returnTo)}`}
      >
        Connect Outlook
      </a>
    </Card>
  );
}
