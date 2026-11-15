// Reencaminha /api/* da página (servida pelo http-server) para o dev-server
// com a D1 simulada (porta 4174) e recolhe erros de JavaScript da página.
async function useMockApi(page) {
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    const response = await route.fetch({ url: 'http://127.0.0.1:4174' + u.pathname + u.search });
    await route.fulfill({ response });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

module.exports = { useMockApi };
