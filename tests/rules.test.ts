import { describe, it, expect } from "vitest";
import type { AuditContext } from "../packages/contracts/src/index";
import {
  securityRules,
  evaluateRules,
  calculateScore,
  parseCsp,
} from "../packages/scanner/src/rules";
const base = (): AuditContext => ({
  initialUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  headers: {
    "strict-transport-security": ["max-age=31536000; includeSubDomains"],
    "content-security-policy": [
      "default-src 'none'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    ],
    "x-content-type-options": ["nosniff"],
    "referrer-policy": ["strict-origin-when-cross-origin"],
    "permissions-policy": ["camera=(), microphone=(), geolocation=()"],
  },
  tls: "valid",
  httpUpgrade: "yes",
  redirects: ["http://example.com/", "https://example.com/"],
  cookies: [
    {
      name: "session",
      domain: "example.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
      overHttps: true,
    },
  ],
  resources: [],
  collected: true,
  testedAt: "2026-10-09T12:00:00Z",
});
const rule = (n: number) => securityRules[n - 1];
describe("13 independent security rules", () => {
  for (let n = 1; n <= 13; n++)
    it(`SEC-${String(n).padStart(3, "0")} passes observed restrictive context`, async () => {
      expect((await rule(n).evaluate(base())).status).toBe("PASS");
    });
  for (let n = 2; n <= 13; n++)
    if (n !== 12)
      it(`SEC-${n} does not approve missing collection`, async () => {
        expect(
          (await rule(n).evaluate({ ...base(), collected: false })).status,
        ).toBe("INCONCLUSIVE");
      });
  it("invalid TLS is a verified failure", async () =>
    expect((await rule(1).evaluate({ ...base(), tls: "invalid" })).status).toBe(
      "FAIL",
    ));
  it("unknown TLS is inconclusive", async () =>
    expect((await rule(1).evaluate({ ...base(), tls: "unknown" })).status).toBe(
      "INCONCLUSIVE",
    ));
  it("does not claim an HTTP probe was performed", async () => {
    const r = await rule(1).evaluate({ ...base(), httpUpgrade: "untested" });
    expect(r.status).toBe("WARN");
    expect(r.description).toContain("não verificado");
  });
  it("HTTP is a transport failure", async () =>
    expect(
      (
        await rule(1).evaluate({
          ...base(),
          finalUrl: "http://example.com/",
          tls: "not-applicable",
        })
      ).status,
    ).toBe("FAIL"));
  it.each(["", "max-age=abc", "max-age=0", "max-age=-1"])(
    "malformed HSTS %s",
    async (value) =>
      expect(
        (
          await rule(2).evaluate({
            ...base(),
            headers: { "strict-transport-security": value ? [value] : [] },
          })
        ).status,
      ).not.toBe("PASS"),
  );
  it("HSTS on HTTP is not applicable", async () =>
    expect(
      (await rule(2).evaluate({ ...base(), finalUrl: "http://example.com/" }))
        .status,
    ).toBe("NOT_APPLICABLE"));
  it("CSP report-only does not enforce", async () =>
    expect(
      (
        await rule(3).evaluate({
          ...base(),
          headers: {
            "content-security-policy-report-only": ["default-src 'self'"],
          },
        })
      ).status,
    ).toBe("FAIL"));
  it("permissive CSP warns", async () =>
    expect(
      (
        await rule(3).evaluate({
          ...base(),
          headers: {
            "content-security-policy": [
              "default-src *; script-src * 'unsafe-eval' 'unsafe-inline'",
            ],
          },
        })
      ).status,
    ).toBe("WARN"));
  it("nonce suppresses contextual unsafe-inline warning", async () =>
    expect(
      (
        await rule(3).evaluate({
          ...base(),
          headers: {
            "content-security-policy": [
              "script-src 'nonce-abc' 'unsafe-inline'; object-src 'none'",
            ],
          },
        })
      ).status,
    ).toBe("PASS"));
  it("multiple policies are intersected", async () =>
    expect(
      (
        await rule(3).evaluate({
          ...base(),
          headers: {
            "content-security-policy": [
              "script-src * 'unsafe-eval'",
              "script-src 'none'",
            ],
          },
        })
      ).status,
    ).toBe("PASS"));
  it("malformed and duplicate CSP directives are inconclusive", async () => {
    expect(parseCsp("script-src *; script-src self").malformed).toHaveLength(1);
    expect(
      (
        await rule(3).evaluate({
          ...base(),
          headers: {
            "content-security-policy": ["script-src *; script-src self"],
          },
        })
      ).status,
    ).toBe("INCONCLUSIVE");
  });
  it("wrong nosniff fails", async () =>
    expect(
      (
        await rule(4).evaluate({
          ...base(),
          headers: { "x-content-type-options": ["invalid"] },
        })
      ).status,
    ).toBe("FAIL"));
  it("referrer default is informational", async () =>
    expect((await rule(5).evaluate({ ...base(), headers: {} })).status).toBe(
      "INFO",
    ));
  it("referrer last valid fallback wins", async () => {
    const r = await rule(5).evaluate({
      ...base(),
      headers: { "referrer-policy": ["unsafe-url, strict-origin, invalid"] },
    });
    expect(r.status).toBe("PASS");
    expect(r.evidence).toEqual({ effective: "strict-origin" });
  });
  it("unsafe-url warns", async () =>
    expect(
      (
        await rule(5).evaluate({
          ...base(),
          headers: { "referrer-policy": ["unsafe-url"] },
        })
      ).status,
    ).toBe("WARN"));
  it("missing permissions is not a vulnerability", async () =>
    expect((await rule(6).evaluate({ ...base(), headers: {} })).status).toBe(
      "INFO",
    ));
  it("permissions invalid syntax is inconclusive", async () =>
    expect(
      (
        await rule(6).evaluate({
          ...base(),
          headers: { "permissions-policy": ["camera=broken"] },
        })
      ).status,
    ).toBe("INCONCLUSIVE"));
  it("permissions broad sensitive scope warns", async () =>
    expect(
      (
        await rule(6).evaluate({
          ...base(),
          headers: { "permissions-policy": ["camera=*"] },
        })
      ).status,
    ).toBe("WARN"));
  it("legacy framing protection works", async () =>
    expect(
      (
        await rule(7).evaluate({
          ...base(),
          headers: { "x-frame-options": ["DENY"] },
        })
      ).status,
    ).toBe("PASS"));
  it("invalid ALLOW-FROM does not protect", async () =>
    expect(
      (
        await rule(7).evaluate({
          ...base(),
          headers: { "x-frame-options": ["ALLOW-FROM *"] },
        })
      ).status,
    ).toBe("WARN"));
  it("CSP framing wins over conflicting legacy header", async () =>
    expect(
      (
        await rule(7).evaluate({
          ...base(),
          headers: { ...base().headers, "x-frame-options": ["invalid"] },
        })
      ).status,
    ).toBe("PASS"));
  for (const n of [8, 9, 10])
    it(`SEC-${n} without cookies is not applicable`, async () =>
      expect((await rule(n).evaluate({ ...base(), cookies: [] })).status).toBe(
        "NOT_APPLICABLE",
      ));
  it("session cookie missing Secure gets contextual priority", async () => {
    const r = await rule(8).evaluate({
      ...base(),
      cookies: base().cookies.map((k) => ({ ...k, secure: false })),
    });
    expect(r.status).toBe("WARN");
    expect(r.severity).toBe("HIGH");
  });
  it("preference cookie without HttpOnly is informational", async () => {
    const r = await rule(9).evaluate({
      ...base(),
      cookies: base().cookies.map((k) => ({
        ...k,
        name: "theme",
        httpOnly: false,
      })),
    });
    expect(r.status).toBe("INFO");
    expect(r.severity).toBe("INFO");
  });
  it("session cookie without HttpOnly warns", async () =>
    expect(
      (
        await rule(9).evaluate({
          ...base(),
          cookies: base().cookies.map((k) => ({ ...k, httpOnly: false })),
        })
      ).status,
    ).toBe("WARN"));
  it("SameSite None with Secure is legitimate", async () =>
    expect(
      (
        await rule(10).evaluate({
          ...base(),
          cookies: base().cookies.map((k) => ({ ...k, sameSite: "None" })),
        })
      ).status,
    ).toBe("PASS"));
  it("SameSite None without Secure fails", async () =>
    expect(
      (
        await rule(10).evaluate({
          ...base(),
          cookies: base().cookies.map((k) => ({
            ...k,
            sameSite: "None",
            secure: false,
          })),
        })
      ).status,
    ).toBe("FAIL"));
  it("mixed content on HTTP is not applicable", async () =>
    expect(
      (await rule(11).evaluate({ ...base(), finalUrl: "http://example.com/" }))
        .status,
    ).toBe("NOT_APPLICABLE"));
  it("blocked mixed content is distinct from loaded insecure script", async () => {
    const resource = {
      url: "http://thirdparty.com/app.js",
      origin: "http://thirdparty.com",
      type: "script",
      protocol: "http:",
      thirdParty: true,
      status: null,
      outcome: "blocked" as const,
    };
    expect(
      (await rule(11).evaluate({ ...base(), resources: [resource] })).status,
    ).toBe("WARN");
    expect(
      (
        await rule(11).evaluate({
          ...base(),
          resources: [{ ...resource, outcome: "loaded", status: 200 }],
        })
      ).severity,
    ).toBe("HIGH");
  });
  it("redirect downgrade fails", async () =>
    expect(
      (
        await rule(12).evaluate({
          ...base(),
          redirects: ["https://example.com/", "http://example.com/"],
        })
      ).status,
    ).toBe("FAIL"));
  it("redirect loop fails", async () =>
    expect(
      (
        await rule(12).evaluate({
          ...base(),
          redirects: ["https://example.com/", "https://example.com/"],
        })
      ).status,
    ).toBe("FAIL"));
  it("domain change is informational", async () =>
    expect(
      (
        await rule(12).evaluate({
          ...base(),
          redirects: ["https://example.com/", "https://other.com/"],
        })
      ).status,
    ).toBe("INFO"));
  it("navigation failure stays technical", async () =>
    expect(
      (
        await rule(12).evaluate({
          ...base(),
          collected: false,
          browserError: "TIMEOUT",
        })
      ).status,
    ).toBe("ERROR"));
  it("third party without SRI is not labeled malicious", async () =>
    expect(
      (
        await rule(13).evaluate({
          ...base(),
          resources: [
            {
              url: "https://cdn.com/a.js",
              origin: "https://cdn.com",
              type: "script",
              protocol: "https:",
              thirdParty: true,
              status: 200,
              outcome: "loaded",
            },
          ],
        })
      ).status,
    ).toBe("INFO"));
  it("insecure loaded third-party script fails", async () =>
    expect(
      (
        await rule(13).evaluate({
          ...base(),
          resources: [
            {
              url: "http://cdn.com/a.js",
              origin: "http://cdn.com",
              type: "script",
              protocol: "http:",
              thirdParty: true,
              status: 200,
              outcome: "loaded",
            },
          ],
        })
      ).status,
    ).toBe("FAIL"));
});
describe("transparent scoring", () => {
  it("perfect applicable context gets 100 deterministically", async () => {
    const results = await evaluateRules(base());
    expect(calculateScore(results)).toMatchObject({
      score: 100,
      coverage: 100,
      version: "sonda-weighted-v1",
    });
    expect(calculateScore(results)).toEqual(calculateScore(results));
  });
  it("inconclusive coverage never gets artificial approval", async () =>
    expect(
      calculateScore(
        await evaluateRules({
          ...base(),
          collected: false,
          tls: "unknown",
          browserError: "TIMEOUT",
        }),
      ).score,
    ).toBeNull());
  it("not applicable cookies do not lower score", async () =>
    expect(
      calculateScore(await evaluateRules({ ...base(), cookies: [] })),
    ).toMatchObject({ score: 100, coverage: 100 }));
  it("weights influence penalty, not raw number of findings", async () => {
    const results = await evaluateRules(base());
    const high = results.map((r) =>
      r.ruleId === "SEC-001" ? { ...r, status: "FAIL" as const } : r,
    );
    const low = results.map((r) =>
      r.ruleId === "SEC-006" ? { ...r, status: "FAIL" as const } : r,
    );
    expect(calculateScore(high).score!).toBeLessThan(
      calculateScore(low).score!,
    );
  });
});
