import { it, expect } from "vitest";
const base = process.env.INTEGRATION_API_URL ?? "http://localhost:4000";
const origin = "http://localhost:3000";
const live = it.runIf(process.env.RUN_API_INTEGRATION === "true");
live(
  "real queue → isolated browser → PostgreSQL → SSE → exports → ownership",
  async () => {
    const response = await fetch(base + "/api/v1/scans", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ url: "http://172.30.20.4:8080" }),
    });
    expect(response.status).toBe(202);
    const scan = (await response.json()) as { id: string; token: string };
    const duplicate = await fetch(base + "/api/v1/scans", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ url: "http://172.30.20.4:8080" }),
    });
    expect(duplicate.status).toBe(409);
    expect((await fetch(`${base}/api/v1/scans/${scan.id}/report`)).status).toBe(
      404,
    );
    const stream = await fetch(
      `${base}/api/v1/scans/${scan.id}/events?token=${scan.token}`,
    );
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const events = await stream.text();
    expect(events).toContain("Gerando relatório");
    expect(events).toContain("COMPLETED");
    const report = (await fetch(
      `${base}/api/v1/scans/${scan.id}/report?token=${scan.token}`,
    ).then((r) => r.json())) as {
      status: string;
      findings: unknown[];
      evidence: { id: string }[];
    };
    expect(report.status).toBe("COMPLETED");
    expect(report.findings).toHaveLength(17);
    expect(JSON.stringify(report)).not.toContain("fixture-only-value");
    const screenshot = await fetch(
      `${base}/api/v1/scans/${scan.id}/evidence/${report.evidence[0].id}?token=${scan.token}`,
    );
    expect(screenshot.headers.get("content-type")).toBe("image/png");
    const pdf = await fetch(
      `${base}/api/v1/scans/${scan.id}/export/pdf?token=${scan.token}`,
    );
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect((await pdf.text()).startsWith("%PDF")).toBe(true);
    const exported = await fetch(
      `${base}/api/v1/scans/${scan.id}/export/json?token=${scan.token}`,
    ).then((r) => r.json());
    expect(exported).not.toHaveProperty("capabilityHash");
  },
  120000,
);
live("origin enforcement and invalid URLs fail closed", async () => {
  expect(
    (
      await fetch(base + "/api/v1/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await fetch(base + "/api/v1/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ url: "http://127.0.0.1" }),
      })
    ).status,
  ).toBe(400);
});
