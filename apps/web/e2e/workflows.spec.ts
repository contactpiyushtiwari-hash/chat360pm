import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, nav, shot, signInAs } from './helpers';

test.describe.serial('core workflows (desktop)', () => {
  test('sign-in page and dashboard', async ({ page }) => {
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fprojects/);
    await expect(page.getByRole('heading', { name: 'Developer sign-in' })).toBeVisible();
    await shot(page, 'login');
    await signInAs(page, /Priya PM/);
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await nav(page, 'Dashboard');
    await expect(page.getByText('Need your decision today')).toBeVisible();
    await shot(page, 'dashboard');
    await expectNoHorizontalOverflow(page);
  });

  test('signs in with email and password', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/login');
    await page.getByLabel('Work email').fill('demo-pm1@chat.io');
    await page.getByLabel('Password').fill('wrong password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
    await page.getByLabel('Password').fill('demo-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('admin adds an employee who sets their own password', async ({ page }) => {
    await signInAs(page, /Avery Admin/);
    await nav(page, 'Admin');
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Rio Recruit (demo)');
    await page.getByLabel('Work email').fill('rio.recruit@chat.io');
    await page.getByRole('group', { name: 'Roles' }).getByLabel('Tech Team').check();
    await page.getByRole('button', { name: 'Add and create set-password link' }).click();
    const link = await page.getByLabel('Set-password link').inputValue();
    expect(link).toMatch(/\/set-password#token=/);
    await shot(page, 'admin-add-user');

    await page.context().clearCookies();
    await page.goto(link);
    await expect(page).toHaveURL(/\/set-password$/);
    await page.getByLabel('New password').fill('rio picked a long password');
    await page.getByLabel('Repeat password').fill('rio picked a long password');
    await page.getByRole('button', { name: 'Save password and sign in' }).click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await page.goto('/account');
    await expect(page.getByText('rio.recruit@chat.io')).toBeVisible();
  });

  test('PM creates a project and downloads its Excel tracker', async ({ page }) => {
    await signInAs(page, /Priya PM/);
    await page.goto('/projects/new');
    await page.getByLabel('Client name').fill('Tailspin Toys');
    await page.getByLabel('Project name').fill('Returns Assistant');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Tara Tech (demo)').check();
    await page.getByLabel('FDE (bot builder)').selectOption({ label: 'Farah FDE (demo)' });
    await page
      .getByLabel('Delivery and Operations Head')
      .selectOption({ label: 'Devi Head (demo)' });
    await page.getByRole('button', { name: 'Next' }).click();
    const goLive = new Date(Date.now() + 45 * 86400_000).toISOString().slice(0, 10);
    await page.getByLabel('Target go-live').fill(goLive);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Tailspin Toys — Returns Assistant')).toBeVisible();
    await shot(page, 'project-wizard-review');
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByText(/^Project created\./)).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Download Excel tracker' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('Tailspin Toys - Returns Assistant - Tracker.xlsx');
    await page.getByRole('tab', { name: /Tasks/ }).click();
    await expect(
      page.getByRole('button', { name: /Commercial handover and SOW review/ }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Gantt' }).click();
    await expect(page.getByRole('img', { name: /Gantt chart/ })).toBeVisible();
    await shot(page, 'project-gantt');
    await page.getByRole('button', { name: 'Kanban' }).click();
    await expect(page.getByRole('region', { name: 'Not Started' })).toBeVisible();
  });

  test('task owner records "not completed" and the escalation reaches the PM', async ({ page }) => {
    await signInAs(page, /Tara Tech/);
    await nav(page, 'My Tasks Today');
    await shot(page, 'my-tasks-today');
    const card = page.locator('.task-card').first();
    await card.getByRole('button', { name: 'Not completed' }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('textbox', { name: 'Reason', exact: true })
      .fill('Waiting for sandbox credentials from client IT');
    await dialog.getByLabel('Next action').fill('Follow up with client IT on Monday');
    const eta = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    await dialog.getByLabel('Revised ETA').fill(eta);
    await shot(page, 'confirm-not-completed');
    await dialog.getByRole('button', { name: 'Submit and escalate' }).click();
    await expect(page.getByText(/Escalation ESC-\d+ raised/)).toBeVisible();

    await signInAs(page, /Priya PM/);
    await nav(page, 'Escalations');
    await expect(page.getByText('Waiting for sandbox credentials from client IT')).toBeVisible();
    await shot(page, 'escalations');
  });

  test('PM requests a transfer; Delivery Head approves; history is preserved', async ({ page }) => {
    await signInAs(page, /Priya PM/);
    await nav(page, 'Projects');
    await page.getByRole('link', { name: /Northwind Retail/ }).click();
    await page.getByRole('tab', { name: 'Transfers' }).click();
    await page.getByRole('button', { name: 'Request project transfer' }).click();
    const dialog = page.getByRole('dialog', { name: 'Request project transfer' });
    await dialog.getByLabel('Proposed new PM').selectOption({ label: 'Pavan PM (demo)' });
    await dialog.getByLabel('Reason').fill('Moving to the enterprise accounts team');
    await expect(dialog.getByText('Outstanding tasks')).toBeVisible();
    await shot(page, 'transfer-request');
    await dialog.getByRole('button', { name: 'Submit request' }).click();
    await expect(
      page.getByText('Transfer request submitted to the Delivery and Operations Head.'),
    ).toBeVisible();

    await signInAs(page, /Devi Head/);
    await nav(page, 'Transfers');
    await page
      .getByRole('link', { name: /Northwind Retail/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Approve…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve and reassign' }).click();
    await expect(page.getByText('Transfer Completed.')).toBeVisible();
    await shot(page, 'transfer-completed');
    await page.getByRole('link', { name: /Northwind Retail — WhatsApp Order Bot/ }).click();
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByText(/Priya PM \(demo\) → Pavan PM \(demo\)/)).toBeVisible();
  });

  test('Delivery Head reassigns a PM directly after reviewing the handover', async ({ page }) => {
    await signInAs(page, /Devi Head/);
    await page.goto('/projects');
    await page.getByRole('link', { name: /Contoso Insurance/ }).click();
    await page.getByRole('tab', { name: 'Transfers' }).click();
    await page.getByRole('button', { name: 'Change project PM' }).click();
    const d = page.getByRole('dialog', { name: 'Change project PM' });
    await d.getByLabel('New PM').selectOption({ label: 'Priya PM (demo)' });
    await d.getByLabel('Reason').fill('Rebalancing workload');
    await expect(d.getByRole('button', { name: 'Confirm reassignment' })).toBeDisabled();
    await d.getByLabel(/I have reviewed/).check();
    await shot(page, 'reassign-pm');
    await d.getByRole('button', { name: 'Confirm reassignment' }).click();
    await expect(page.getByText('Priya PM (demo) is now the PM.')).toBeVisible();
  });

  test('support request, analytics and 404', async ({ page }) => {
    await signInAs(page, /Tara Tech/);
    await nav(page, 'Support');
    await page.getByRole('button', { name: 'New request' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Category').selectOption({ label: 'Bug' });
    await d.getByLabel('Subject').fill('Tracker not updating');
    await d.getByLabel('Description').fill('The This Week sheet looks stale.');
    await d.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByRole('button', { name: 'Tracker not updating' })).toBeVisible();

    await signInAs(page, /Devi Head/);
    await nav(page, 'Analytics');
    await expect(page.getByText('Portfolio view')).toBeVisible();
    await shot(page, 'analytics');

    await page.goto('/this/does/not/exist');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.goto('/projects/PRJ-NOTREAL1');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });

  test('new employee sees onboarding and no project data', async ({ page }) => {
    await signInAs(page, /Nia Newhire/);
    await page.goto('/welcome');
    await expect(
      page.getByRole('heading', { name: 'Role assigned by an administrator' }),
    ).toBeVisible();
    await shot(page, 'onboarding');
    await nav(page, 'Projects');
    await expect(page.getByRole('heading', { name: 'No assigned projects' })).toBeVisible();
  });

  test('account deactivation request is protected for PMs with active projects', async ({
    page,
  }) => {
    await signInAs(page, /Pavan PM/);
    await page.goto('/account');
    await expect(page.getByText(/You are the PM of \d+ active project/)).toBeVisible();
    await page.getByRole('button', { name: 'Request deactivation…' }).click();
    const d = page.getByRole('dialog');
    await expect(d.getByRole('button', { name: 'Submit request' })).toBeDisabled();
    await d.getByLabel(/Type your email/).fill('demo-pm2@chat.io');
    await d.getByLabel(/I understand/).check();
    await d.getByRole('button', { name: 'Submit request' }).click();
    await expect(page.getByText(/Your active projects need a new PM first/)).toBeVisible();
    await shot(page, 'account-deactivation');
  });

  test('email drafts open in the user’s own mail app', async ({ page }) => {
    await signInAs(page, /Priya PM/);
    await nav(page, 'Email');
    await page
      .getByLabel('Project')
      .selectOption({ label: 'Northwind Retail — WhatsApp Order Bot' });
    await page
      .getByLabel('Template')
      .selectOption({ label: 'API / dependency follow-up (client)' });
    await expect(page.getByLabel('Subject')).toHaveValue(/Northwind Retail/);
    await page.getByLabel('To').fill('client@fabrikam.example');
    await shot(page, 'email-draft');
    await expect(page.getByRole('link', { name: 'Open in my email app' })).toHaveAttribute(
      'href',
      /^mailto:client@fabrikam\.example\?subject=Northwind%20Retail/,
    );
  });

  test('Sales POC updates project finance; technical staff do not see it', async ({ page }) => {
    await signInAs(page, /Sam Sales/);
    await nav(page, 'Projects');
    await page.getByRole('link', { name: /Northwind Retail/ }).click();
    await page.getByRole('tab', { name: 'Finance' }).click();
    await expect(
      page.getByText('Amount Raised and Overdue (for Go-Live)', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Update figures' }).click();
    const d = page.getByRole('dialog', { name: 'Update finance' });
    await d.getByLabel('Amount Raised and Overdue (for Go-Live)').fill('425000');
    await d.getByLabel('Amount that can be raised on immediate basis').fill('75000');
    await d.getByLabel('Amount to be raised').fill('900000');
    await expect(d.getByText('₹5,00,000.00')).toBeVisible();
    await d.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Finance updated.')).toBeVisible();
    await expect(page.getByText('₹9,00,000.00')).toBeVisible();
    await shot(page, 'project-finance');

    await signInAs(page, /Tara Tech/);
    await nav(page, 'Projects');
    await page.getByRole('link', { name: /Northwind Retail/ }).click();
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Finance' })).toHaveCount(0);
  });
});
