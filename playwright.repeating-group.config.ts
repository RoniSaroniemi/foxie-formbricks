import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/playwright",
  testMatch: /repeating-group\..*\.spec\.ts$/,
  fullyParallel: false,
  retries: 0,
  timeout: 120000,
  reporter: [["html", { outputFolder: "playwright-report/repeating-group", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/serve-static-proof.mjs --port 4174",
    url: "http://127.0.0.1:4174/poc/repeating-group/proof.html",
    reuseExistingServer: true,
    timeout: 120000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
