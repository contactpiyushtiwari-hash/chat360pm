import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, nav, shot, signInAs } from './helpers';

// Browser emulation of a phone viewport. This is not a substitute for real-device testing.
test.describe.serial('mobile layout (emulated)', () => {
  test('navigation drawer, today view and tables fit the screen', async ({ page }) => {
    await page.goto('/login');
    await expectNoHorizontalOverflow(page);
    await signInAs(page, /Tara Tech/);
    await expectNoHorizontalOverflow(page);
    await shot(page, 'mobile-dashboard');
    await nav(page, 'My Tasks Today');
    await expect(page.getByRole('heading', { name: 'My Tasks Today' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, 'mobile-today');
    const btn = page.getByRole('button', { name: 'Completed' }).first();
    if (await btn.isVisible()) {
      const box = await btn.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await nav(page, 'Projects');
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole('link', { name: /Northwind Retail/ }).click();
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, 'mobile-project');
  });
});
