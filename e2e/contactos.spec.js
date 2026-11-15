const { test, expect } = require('@playwright/test');
const { useMockApi } = require('./helpers');

// Escrita isolada: o POST vai para o dev-server com a D1 simulada em memória.
test('regista um contacto e o contador da conta atualiza', async ({ page }) => {
  const errors = await useMockApi(page);
  await page.goto('/');
  const row = page.locator('tr[data-id="pt-top50-20"]');
  await expect(row).toBeVisible();
  const cnt = row.locator('[data-act="contacts"] .cnt');
  const before = (await cnt.count()) ? Number(await cnt.textContent()) : 0;

  await row.locator('[data-act="new-contact"]').click();
  const form = page.locator('#cf');
  await form.locator('[name="title"]').fill('Reunião de descoberta (E2E)');
  await form.locator('[name="contact_date"]').fill('2026-11-10');
  await form.locator('[name="decisions"]').fill('Avançar com proposta');
  await form.locator('#cf-save').click();

  await expect(page.locator('#toast')).toContainText('Contacto registado');
  await expect(cnt).toHaveText(String(before + 1));
  await expect(row.locator('.ic-last')).toContainText('Último');
  expect(errors).toEqual([]);
});
