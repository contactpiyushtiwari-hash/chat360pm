import { useNavigate } from 'react-router';
import { GLOBAL_ROLE_LABELS, type OnboardingStatus } from '@chat360/core';
import { patch } from '../lib/api';
import { useAction } from '../lib/hooks';
import { useMe, useSession } from '../lib/session';
import { track } from '../lib/telemetry';
import { Badge, Button, ButtonLink, Card, InlineError, PageHeader } from '../components/ui';

export function WelcomePage() {
  const me = useMe();
  const { refresh } = useSession();
  const nav = useNavigate();
  const update = useAction(async (body: { completeSteps?: string[]; skipSteps?: string[] }) => {
    await patch<{ onboarding: OnboardingStatus }>('/api/me/onboarding', body);
    await refresh();
  });
  const s = me.onboarding;
  const roles = me.user.roles.map((r) => GLOBAL_ROLE_LABELS[r]);

  return (
    <div className="narrow">
      <PageHeader
        title={`Welcome, ${me.user.displayName.split(' ')[0]}`}
        subtitle={
          roles.length
            ? `Your roles: ${roles.join(', ')}`
            : 'An administrator has not assigned you a role yet.'
        }
      />
      {s.complete ? (
        <Card>
          <p>Setup is complete. You can revisit this checklist from your account page.</p>
          <Button variant="primary" onClick={() => nav('/')}>
            Go to dashboard
          </Button>
        </Card>
      ) : (
        <p className="muted">
          {s.missingRequired.length} required step(s) left. Optional steps can be skipped; required
          ones cannot.
        </p>
      )}
      <InlineError error={update.error} />
      <ol className="checklist">
        {s.steps.map((step) => (
          <li key={step.id} className={`check-item check-${step.state}`}>
            <div className="check-head">
              <span className="check-mark" aria-hidden="true">
                {step.state === 'done' ? '✓' : step.state === 'skipped' ? '–' : '○'}
              </span>
              <h2>{step.title}</h2>
              {step.required ? (
                <Badge value="required" label="Required" />
              ) : (
                <Badge value="optional" label="Optional" />
              )}
              <Badge
                value={
                  step.state === 'done' ? 'done' : step.state === 'skipped' ? 'neutral' : 'pending'
                }
                label={step.state}
              />
            </div>
            <p>{step.description}</p>
            <div className="row">
              {step.route && step.state !== 'done' && (
                <ButtonLink to={step.route}>Show me</ButtonLink>
              )}
              {step.verifiedBySystem
                ? step.state !== 'done' && (
                    <span className="hint">
                      {step.id === 'role_assigned'
                        ? 'Checked automatically once an administrator assigns your role.'
                        : 'Checked automatically when connected.'}
                    </span>
                  )
                : step.state !== 'done' && (
                    <Button
                      variant="primary"
                      loading={update.pending}
                      onClick={() => {
                        track('onboarding_step_viewed', { step: step.id });
                        void update.run({ completeSteps: [step.id] });
                      }}
                    >
                      Mark as understood
                    </Button>
                  )}
              {!step.required && step.state === 'pending' && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    track('tour_skipped', { step: step.id });
                    void update.run({ skipSteps: [step.id] });
                  }}
                >
                  Skip
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
