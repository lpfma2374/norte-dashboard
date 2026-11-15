const { test, expect } = require('@playwright/test');
const { useMockApi } = require('./helpers');

// Dados de exemplo de scripts/mock-d1.js: 5 empresas do Norte (a Galp é de Lisboa e fica de fora).
test.describe('Norte Dashboard — contas', () => {
  let errors;
  test.beforeEach(async ({ page }) => { errors = await useMockApi(page); });
  test.afterEach(() => { expect(errors, 'erros de JavaScript na página').toEqual([]); });

  test('carrega KPIs, contexto e só as empresas do Norte', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#tbody tr[data-id]')).toHaveCount(5);
    await expect(page.locator('#hint')).toContainText('5 empresas do Norte');
    await expect(page.locator('#tbody')).not.toContainText('Galp');
    await expect(page.locator('#kpi-target [data-s]')).not.toHaveText('A carregar…');
    await expect(page).toHaveTitle('Norte Dashboard');
  });

  test('filtro por mercado e limpar filtros', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#tbody tr[data-id]')).toHaveCount(5);
    await page.locator('#f-market').selectOption('Manufacturing');
    await expect(page.locator('#tbody tr[data-id]')).toHaveCount(2);
    await expect(page.locator('#tbody .name')).toContainText(['Lactogal', 'Efacec']);
    await page.locator('#btn-reset').click();
    await expect(page.locator('#tbody tr[data-id]')).toHaveCount(5);
  });

  test('decisores: perfis LinkedIn válidos têm link, URLs perigosos não', async ({ page }) => {
    await page.goto('/');
    await page.locator('tr[data-id="pt-norte-01"] [data-act="decisors"]').click();
    const sheet = page.locator('.overlay .sheet').last();
    await expect(sheet.locator('.item')).toHaveCount(2);
    await expect(sheet.locator('a.ic[href^="https://"]')).toHaveCount(2);
    await sheet.locator('.close').click();

    await page.locator('tr[data-id="pt-top50-04"] [data-act="decisors"]').click();
    const sonae = page.locator('.overlay .sheet').last();
    await expect(sonae.locator('.item .t')).toHaveText('Marta Demo');
    await expect(sonae.locator('a[href^="javascript:"]')).toHaveCount(0);
  });

  test('abre a ficha de conta', async ({ page }) => {
    await page.goto('/');
    await page.locator('tr[data-id="pt-norte-01"] button.name').click();
    const sheet = page.locator('.overlay .sheet.wide');
    await expect(sheet.locator('h2')).toHaveText('Efacec');
    await expect(sheet).not.toContainText('A carregar a ficha de conta…');
  });
});
