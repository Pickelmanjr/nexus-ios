import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  timeout: 30000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      // An iPhone-sized viewport: the layout assertions depend on it.
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } }
    },
    {
      name: 'webkit',
      // WebKit is the engine WKWebView actually uses on the device.
      use: { ...devices['Desktop Safari'], viewport: { width: 390, height: 844 } }
    }
  ],
  webServer: {
    // Serve the real build, not the dev-server module graph.
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 120000
  }
});
