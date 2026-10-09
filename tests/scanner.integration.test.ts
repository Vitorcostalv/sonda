import { it, expect } from "vitest";
import { spawn } from "node:child_process";
import { collectAudit } from "../packages/scanner/src/index";
it("real Chromium observes approved fixture, minimizes cookies, runs axe and captures screenshot", async () => {
  const server = spawn(process.execPath, ["tests/fixtures/server.mjs"], {
    env: { ...process.env, PORT: "18080" },
    stdio: "ignore",
  });
  const previous = process.env.FIXTURE_URL;
  process.env.FIXTURE_URL = "http://127.0.0.1:18080";
  try {
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch("http://127.0.0.1:18080/health");
        if (r.ok) break;
      } catch {
        /* startup */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const steps: string[] = [];
    const result = await collectAudit(process.env.FIXTURE_URL, {
      allowFixture: true,
      onStep: async (s) => {
        steps.push(s);
      },
    });
    expect(result.context.collected).toBe(true);
    expect(result.findings).toHaveLength(17);
    expect(result.context.cookies.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.context)).not.toContain("fixture-only-value");
    expect(result.findings.find((f) => f.ruleId === "SEC-001")?.status).toBe(
      "FAIL",
    );
    expect(result.findings.find((f) => f.ruleId === "SEC-004")?.status).toBe(
      "PASS",
    );
    expect(result.findings.find((f) => f.ruleId === "PERF-001")?.status).toBe(
      "INCONCLUSIVE",
    );
    expect(result.context.accessibility).toHaveProperty("violations");
    expect(result.screenshot?.subarray(1, 4).toString()).toBe("PNG");
    expect(steps).toContain("Consolidando resultados");
  } finally {
    server.kill();
    if (previous === undefined) delete process.env.FIXTURE_URL;
    else process.env.FIXTURE_URL = previous;
  }
}, 45000);
it("arbitrary public scans remain disabled without verified infrastructure", async () => {
  await expect(collectAudit("https://example.com")).rejects.toThrow(
    "PUBLIC_SCANS_DISABLED",
  );
});
