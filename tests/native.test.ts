import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { NextRequest } from "../apps/web/node_modules/next/server.js";
import { FileStore, ConflictError } from "../apps/web/src/server/store";
import { handleNative } from "../apps/web/src/server/native-api";
import {
  auditHttp,
  type HttpResponse,
} from "../apps/web/src/server/http-audit";
const response = (url: string): HttpResponse => ({
  url,
  status: 200,
  headers: {
    "content-type": ["text/html"],
    "content-security-policy": [
      "default-src 'none'; script-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
    ],
    "x-content-type-options": ["nosniff"],
    "referrer-policy": ["strict-origin-when-cross-origin"],
  },
  cookies: [],
  html: '<!doctype html><html><head><title>Fixture</title><meta name="description" content="controlled fixture"></head><body><h1>Fixture</h1></body></html>',
});
it("HTTP-only mode reports missing browser coverage explicitly", async () => {
  const steps: string[] = [];
  const result = await auditHttp(
    "http://example.com",
    async (step) => {
      steps.push(step);
    },
    new AbortController().signal,
    async (url) => response(url.href),
  );
  expect(result.mode).toBe("HTTP_ONLY");
  expect(result.context.collected).toBe(true);
  expect(result.findings).toHaveLength(17);
  expect(result.findings.find((f) => f.ruleId === "SEC-011")?.status).toBe(
    "INCONCLUSIVE",
  );
  expect(result.findings.find((f) => f.ruleId === "SEC-013")?.status).toBe(
    "INCONCLUSIVE",
  );
  expect(result.findings.find((f) => f.ruleId === "A11Y-001")?.status).toBe(
    "INCONCLUSIVE",
  );
  expect(result.scoring.coverage).toBeLessThan(100);
  expect(result.context.seo?.title).toBe("Fixture");
  expect(steps.length).toBeGreaterThan(3);
});
it("HTTP redirects cannot reach a private destination", async () => {
  let calls = 0;
  const result = await auditHttp(
    "http://example.com",
    async () => {},
    new AbortController().signal,
    async (url) => {
      calls++;
      return {
        ...response(url.href),
        status: 302,
        headers: { location: ["http://169.254.169.254/"] },
      };
    },
  );
  expect(calls).toBe(1);
  expect(result.context.collected).toBe(false);
  expect(result.scoring.score).toBeNull();
});
it("native accounts and reports enforce ownership, share revocation and private storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "sonda-native-")),
    store = new FileStore(root);
  const tasks: Array<() => Promise<void>> = [];
  const invoke = async (
    path: string,
    method = "GET",
    body?: unknown,
    cookie?: string,
  ) =>
    handleNative(
      new NextRequest("http://localhost:3000/api/v1" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      ["v1", ...path.slice(1).split("/")],
      (task) => tasks.push(task),
      store,
    );
  try {
    const created = await invoke("/auth/register", "POST", {
      email: "native@example.com",
      password: "fixture-password-long-2026",
      name: "QA Native",
    });
    expect(created.status).toBe(200);
    const cookie = created.headers.get("set-cookie")!.split(";")[0],
      u = await created.json();
    expect(
      await invoke("/auth/me", "GET", undefined, cookie).then((r) => r.json()),
    ).toMatchObject({ user: { id: u.user.id } });
    const login = await invoke("/auth/login", "POST", {
      email: "native@example.com",
      password: "wrong-long-password",
    });
    expect(login.status).toBe(401);
    const scanId = randomUUID();
    await store.write(`scans/${scanId}.json`, {
      id: scanId,
      normalizedUrl: "https://example.com/",
      status: "COMPLETED",
      progress: 100,
      score: null,
      coverage: 84,
      createdAt: new Date().toISOString(),
      steps: [],
      findings: [],
      resources: [],
      evidence: [],
      context: null,
      requestedBy: u.user.id,
      projectId: null,
      capabilityHash: createHash("sha256")
        .update("synthetic-test-capability")
        .digest("hex"),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      mode: "HTTP_ONLY",
    });
    expect((await invoke(`/scans/${scanId}/report`)).status).toBe(404);
    const owned = await invoke(
      `/scans/${scanId}/report`,
      "GET",
      undefined,
      cookie,
    );
    expect(owned.status).toBe(200);
    expect(await owned.json()).not.toHaveProperty("capabilityHash");
    const shared = await invoke(
      `/scans/${scanId}/shares`,
      "POST",
      undefined,
      cookie,
    ).then((r) => r.json());
    const readShared = () =>
      handleNative(
        new NextRequest(
          `http://localhost:3000/api/v1/scans/${scanId}/report?token=${shared.token}`,
        ),
        ["v1", "scans", scanId, "report"],
        () => {},
        store,
      );
    expect((await readShared()).status).toBe(200);
    expect(
      (
        await invoke(
          `/scans/${scanId}/shares/${shared.id}`,
          "DELETE",
          undefined,
          cookie,
        )
      ).status,
    ).toBe(200);
    expect((await readShared()).status).toBe(404);
    expect(
      (await invoke("/scans", "POST", { url: "http://127.0.0.1" }, cookie))
        .status,
    ).toBe(400);
    const object = await store.read(
      "users/" +
        createHash("sha256").update("native@example.com").digest("hex") +
        ".json",
    );
    expect(JSON.stringify(object)).not.toContain("fixture-password-long-2026");
    await expect(
      store.write(`scans/${scanId}.json`, {}, { create: true }),
    ).rejects.toBeInstanceOf(ConflictError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
