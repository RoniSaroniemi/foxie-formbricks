import { defineConfig, devices } from "@playwright/test";

const appUrl = process.env.REPEATING_GROUP_LOCAL_APP_URL ?? "http://127.0.0.1:3100";
const databaseUrl =
  process.env.REPEATING_GROUP_LOCAL_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/formbricks?schema=public";
const redisUrl = process.env.REPEATING_GROUP_LOCAL_REDIS_URL ?? "redis://127.0.0.1:6379";

process.env.DATABASE_URL = databaseUrl;
process.env.REDIS_URL = redisUrl;
process.env.NEXTAUTH_URL = appUrl;
process.env.WEBAPP_URL = appUrl;
process.env.NEXTAUTH_SECRET ??= "foxie-dev-secret-not-for-production-use";
process.env.ENCRYPTION_KEY ??=
  "d28e6bda55b45e988a68416305c74e8b10c2daf52ab315ae3b06a389bcc706fe";
process.env.CRON_SECRET ??= "foxie-dev-cron-secret";
process.env.EMAIL_VERIFICATION_DISABLED ??= "1";
process.env.PASSWORD_RESET_DISABLED ??= "1";

export default defineConfig({
  testDir: "./apps/web/playwright",
  testMatch: /repeating-group\.real-survey\.spec\.ts$/,
  fullyParallel: false,
  retries: 0,
  timeout: 180000,
  reporter: [["html", { outputFolder: "playwright-report/repeating-group-real", open: "never" }]],
  use: {
    baseURL: appUrl,
    trace: "on-first-retry",
    permissions: ["clipboard-read", "clipboard-write"],
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/start-local-formbricks-for-playwright.mjs",
    url: appUrl,
    reuseExistingServer: true,
    timeout: 300000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
