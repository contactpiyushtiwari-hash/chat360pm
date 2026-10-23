import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { GLOBAL_ROLE_LABELS } from '@chat360/core';
import { post } from '../lib/api';
import { useMe, useSession } from '../lib/session';

interface NavItem {
  to: string;
  label: string;
  show?: boolean;
}

export function Layout() {
  const me = useMe();
  const { refresh } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    setOpen(false);
    // Announce the new page to screen readers and keyboard users without jumping the scroll.
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [loc.pathname]);

  const items: NavItem[] = [
    { to: '/', label: 'Dashboard' },
    { to: '/today', label: 'My Tasks Today' },
    { to: '/projects', label: 'Projects' },
    { to: '/escalations', label: 'Escalations' },
    { to: '/transfers', label: 'Transfers' },
    { to: '/analytics', label: 'Analytics' },
    { to: '/email', label: 'Email' },
    { to: '/support', label: 'Support' },
    { to: '/admin', label: 'Admin', show: me.permissions.admin },
  ];

  async function signOut() {
    try {
      await post('/api/auth/logout');
      await refresh();
      nav('/login?signedOut=1');
    } catch {
      nav('/login?signedOut=1');
    }
  }

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {me.environment !== 'production' && (
        <div className="env-banner" role="note">
          {me.environment === 'development'
            ? 'Development environment — in-memory demo data; nothing is sent.'
            : 'Staging environment'}
        </div>
      )}
      <header className="topbar">
        <button
          type="button"
          className="icon-btn menu-btn"
          aria-label="Open navigation"
          aria-expanded={open}
          aria-controls="sidenav"
          onClick={() => setOpen((v) => !v)}
        >
          ☰
        </button>
        <NavLink to="/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Chat360 <span className="brand-sub">Project Ops</span>
        </NavLink>
        <div className="topbar-right">
          <NavLink to="/account" className="user-chip" title="Account">
            <span className="avatar" aria-hidden="true">
              {me.user.displayName.slice(0, 1)}
            </span>
            <span className="user-name">
              {me.user.displayName}
              <span className="user-role">
                {me.user.roles.map((r) => GLOBAL_ROLE_LABELS[r]).join(', ') || 'No role assigned'}
              </span>
            </span>
          </NavLink>
          <button type="button" className="btn btn-ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <div className="body">
        <nav id="sidenav" className={`sidenav ${open ? 'sidenav-open' : ''}`} aria-label="Main">
          <ul>
            {items
              .filter((i) => i.show !== false)
              .map((i) => (
                <li key={i.to}>
                  <NavLink
                    to={i.to}
                    end={i.to === '/'}
                    className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}
                  >
                    {i.label}
                  </NavLink>
                </li>
              ))}
          </ul>
          {!me.onboarding.complete && (
            <NavLink to="/welcome" className="nav-onboarding">
              Finish setup ({me.onboarding.missingRequired.length} left)
            </NavLink>
          )}
        </nav>
        {open && <div className="nav-scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
        <main id="main" className="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
