import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120000,
  fullyParallel: false,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_EXTERNAL_SERVER
    ? undefined
    : {
        command: "pnpm --filter @sonda/web start",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
      },
  reporter: "list",
});
