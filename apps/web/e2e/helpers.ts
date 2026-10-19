import { expect, type Page } from '@playwright/test';

export async function signInAs(page: Page, name: RegExp) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('button', { name }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

export async function shot(page: Page, name: string) {
  if (process.env.SCREENSHOTS)
    await page.screenshot({ path: `../../docs/screenshots/${name}.png`, fullPage: false });
}

/** Fails if the page scrolls horizontally (layout overflow). */
export async function expectNoHorizontalOverflow(page: Page) {
  await page.waitForTimeout(300); // let drawer transitions finish
  expect(await page.evaluate(() => window.scrollX), 'page scrolled horizontally').toBe(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(1);
}

/** Clicks a link in the main navigation (opening the drawer first on small screens). */
export async function nav(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Open navigation' });
  if (await menu.isVisible()) {
    if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  }
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name, exact: true })
    .click();
}
