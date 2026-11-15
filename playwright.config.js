// Playwright — E2E contra o build local (dist/ servido por http-server na 4173).
// A API de produção está atrás do Cloudflare Access e usa secrets server-side,
// por isso /api/* é reencaminhado para o dev-server com a D1 simulada em memória
// (MOCK_D1=1, scripts/mock-d1.js): os handlers reais correm contra SQLite com
// dados de exemplo. As escritas ficam isoladas nesse SQLite (zero produção).
const CHROME = process.env.CHROME_PATH; // opcional: Chrome do sistema em dev local

module.exports = {
  testDir: './e2e',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    locale: 'pt-PT',
    screenshot: 'only-on-failure',
    launchOptions: CHROME ? { executablePath: CHROME } : {},
  },
  webServer: [
    // No CI o job já arranca o http-server na 4173: reutiliza-o.
    { command: 'npx http-server dist -p 4173 -s', port: 4173, reuseExistingServer: true, timeout: 30000 },
    { command: 'node scripts/dev-server.js', port: 4174, reuseExistingServer: !process.env.CI, timeout: 30000,
      env: { MOCK_D1: '1', PORT: '4174' } },
  ],
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
};
