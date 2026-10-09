/* global sessionStorage */
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
const recoveryPath = "storage/live-verification.json";
const browser = await chromium.launch();
const page = await browser.newPage({
  baseURL: process.env.LIVE_URL ?? "https://sonda-snowy.vercel.app",
  viewport: { width: 1440, height: 1000 },
});
try {
  await page.goto(process.env.LIVE_URL ?? "https://sonda-snowy.vercel.app");
  await expect(
    page.getByText("Diagnóstico HTTP ativo", { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  let saved;
  try {
    saved = JSON.parse(await readFile(recoveryPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!saved) {
    await page.getByLabel("URL do website").fill("https://example.com");
    await page.getByRole("button", { name: "Iniciar diagnóstico" }).click();
    await expect(page).toHaveURL(/reports\//, { timeout: 90000 });
    const id = page.url().split("/reports/")[1];
    const token = await page.evaluate(
      (scanId) => sessionStorage.getItem(`sonda:${scanId}`),
      id,
    );
    saved = { id, token };
    await mkdir("storage", { recursive: true });
    await writeFile(recoveryPath, JSON.stringify(saved), { mode: 0o600 });
  } else {
    await page.evaluate(
      ({ id, token }) => sessionStorage.setItem(`sonda:${id}`, token),
      saved,
    );
    await page.goto(`/reports/${saved.id}`);
  }
  const { id, token } = saved;
  const report = await page.request
    .get(`/api/v1/scans/${id}/report?token=${token}`)
    .then((r) => r.json());
  if (report.status !== "COMPLETED")
    throw Error("Live HTTP collection failed: " + report.errorCode);
  expect(report.mode).toBe("HTTP_ONLY");
  expect(report.findings).toHaveLength(17);
  expect(report.findings.find((f) => f.ruleId === "SEC-011").status).toBe(
    "INCONCLUSIVE",
  );
  expect(report).not.toHaveProperty("capabilityHash");
  const denied = await page.request.get(`/api/v1/scans/${id}/report`);
  expect(denied.status()).toBe(404);
  const pdf = await page.request.get(
    `/api/v1/scans/${id}/export/pdf?token=${token}`,
  );
  if (pdf.status() !== 200)
    throw Error(`PDF export failed with HTTP ${pdf.status()}`);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  await page.getByLabel("Pesquisar achados").fill("SEC-004");
  await page.getByRole("button", { name: /SEC-004/ }).click();
  await expect(
    page.getByRole("heading", { name: "Evidência observada" }),
  ).toBeVisible();
  await mkdir("docs/assets", { recursive: true });
  await page.screenshot({
    path: "docs/assets/report-http-live.png",
    fullPage: true,
  });
  console.log(
    JSON.stringify(
      {
        url: page.url(),
        status: report.status,
        mode: report.mode,
        findings: report.findings.length,
        score: report.score,
        coverage: report.coverage,
        pdf: pdf.status(),
        unauthorizedRead: denied.status(),
      },
      null,
      2,
    ),
  );
  await unlink(recoveryPath);
} finally {
  await browser.close();
}
