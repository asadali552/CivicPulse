import { expect, test } from '@playwright/test';

test('homepage has no horizontal overflow and exposes community navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/UrbanFix/i);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  const label = page.viewportSize().width < 640 ? 'Community' : 'Community Tasks';
  await expect(page.getByText(label, { exact: true }).filter({ visible: true })).toBeVisible();
});
