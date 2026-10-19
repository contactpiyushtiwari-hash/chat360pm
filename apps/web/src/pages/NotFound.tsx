import { ButtonLink, PageHeader } from '../components/ui';

/** Custom 404 for unknown routes. Deliberately reveals nothing about what exists. */
export function NotFoundPage({ what = 'page' }: { what?: string }) {
  return (
    <div className="not-found">
      <PageHeader title="Page not found" />
      <p className="lead">This {what} does not exist, or you do not have access to it.</p>
      <p className="muted">Check the link, or go back to your dashboard.</p>
      <div className="row">
        <ButtonLink to="/" variant="primary">
          Go to dashboard
        </ButtonLink>
        <ButtonLink to="/projects">View projects</ButtonLink>
      </div>
    </div>
  );
}
