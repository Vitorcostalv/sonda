import { test, expect } from "@playwright/test";
test("homepage, URL validation, honest scanner unavailability and mobile navigation", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /O que seu site/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Iniciar diagnóstico" }).click();
  await expect(page.locator(".field-error")).toContainText("Informe a URL");
  if (!process.env.E2E_FULL_STACK) {
    await page.getByLabel("URL do website").fill("https://example.com");
    await page.getByRole("button", { name: "Iniciar diagnóstico" }).click();
    await expect(page.locator(".error-state")).toContainText("scanner");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("link", { name: "Meus projetos" }).click();
  await expect(
    page.getByRole("heading", { name: "Destinos sob observação." }),
  ).toBeVisible();
});
test("full authorized fixture workflow with report filters and export", async ({
  page,
}) => {
  test.skip(!process.env.E2E_FULL_STACK, "Requires Docker services");
  await page.goto("/");
  const email = `sonda-${Date.now()}@example.com`;
  await page.goto("/login");
  await page.getByRole("button", { name: "Ainda não tenho uma conta" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("SONDA QA");
  await page.getByLabel("E-mail").fill(email);
  await page
    .getByLabel("Senha", { exact: true })
    .fill("fixture-password-long-2026");
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/");
  await page.getByLabel("URL do website").fill("http://172.30.20.4:8080");
  await page.getByRole("button", { name: "Iniciar diagnóstico" }).click();
  await expect(page).toHaveURL(/reports\//, { timeout: 90000 });
  await expect(
    page.getByRole("heading", { name: "O que encontramos." }),
  ).toBeVisible();
  await page.getByLabel("Pesquisar achados").fill("SEC-004");
  await page.getByRole("button", { name: /SEC-004/ }).click();
  await expect(
    page.getByRole("heading", { name: "Evidência observada", exact: true }),
  ).toBeVisible();
  const exported = await page.request.get(
    new URL(
      "/api/v1/scans/" + page.url().split("/reports/")[1] + "/export/json",
      page.url(),
    ).href,
  );
  expect(exported.ok()).toBe(true);
  await page.screenshot({
    path: "test-results/report-real.png",
    fullPage: true,
  });
});
