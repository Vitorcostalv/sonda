import { chromium, type Browser, type Request } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { getDomain } from "tldts";
import {
  sanitizeUrl,
  type AuditContext,
  type Resource,
  type CookieMeta,
  type RuleResult,
} from "@sonda/contracts";
import { approvedTarget } from "./security";
import { evaluateRules, calculateScore } from "./rules";
export { evaluateRules, calculateScore } from "./rules";
export const providerCatalog = {
  version: "2026-10-09",
  providers: [
    {
      domain: "google-analytics.com",
      name: "Google Analytics",
      kind: "analytics",
    },
    {
      domain: "googletagmanager.com",
      name: "Google Tag Manager",
      kind: "analytics",
    },
    { domain: "doubleclick.net", name: "Google Ads", kind: "advertising" },
    { domain: "connect.facebook.net", name: "Meta", kind: "analytics" },
  ],
};
function cookieMetadata(raw: string, url: string): CookieMeta {
  const [first, ...parts] = raw.split(";");
  const name = first.slice(0, first.indexOf("=")).trim().slice(0, 100);
  const attr = new Map(
    parts.map((s) => {
      const pos = s.indexOf("=");
      return pos < 0
        ? [s.trim().toLowerCase(), ""]
        : [s.slice(0, pos).trim().toLowerCase(), s.slice(pos + 1).trim()];
    }),
  );
  return {
    name,
    domain: attr.get("domain") ?? new URL(url).hostname,
    path: attr.get("path") ?? "/",
    secure: attr.has("secure"),
    httpOnly: attr.has("httponly"),
    sameSite: attr.get("samesite")
      ? ({ strict: "Strict", lax: "Lax", none: "None" }[
          attr.get("samesite")!.toLowerCase() as "strict" | "lax" | "none"
        ] ?? "Invalid")
      : "",
    overHttps: url.startsWith("https:"),
  };
}
export interface ScanOptions {
  onStep?: (name: string) => Promise<void>;
  signal?: AbortSignal;
  allowFixture?: boolean;
}
export async function collectAudit(input: string, options: ScanOptions = {}) {
  const url = approvedTarget(input);
  const fixture =
    !!process.env.FIXTURE_URL &&
    url.origin === new URL(process.env.FIXTURE_URL).origin;
  if (
    !fixture &&
    (process.env.PUBLIC_SCANS_ENABLED !== "true" ||
      process.env.NETWORK_ISOLATION_VERIFIED !== "true" ||
      !process.env.EGRESS_PROXY)
  )
    throw new Error("PUBLIC_SCANS_DISABLED");
  if (fixture && !options.allowFixture)
    throw new Error("FIXTURE_NOT_AUTHORIZED");
  const c: AuditContext = {
    initialUrl: sanitizeUrl(url.href),
    finalUrl: sanitizeUrl(url.href),
    headers: {},
    tls: url.protocol === "https:" ? "unknown" : "not-applicable",
    httpUpgrade: "untested",
    redirects: [],
    cookies: [],
    resources: [],
    collected: false,
    testedAt: new Date().toISOString(),
  };
  let browser: Browser | undefined;
  let screenshot: Buffer | undefined;
  const step = async (name: string) => {
    options.signal?.throwIfAborted();
    await options.onStep?.(name);
  };
  try {
    await step("Inicializando navegador");
    browser = await chromium.launch({
      headless: true,
      chromiumSandbox: !fixture,
      proxy: !fixture ? { server: process.env.EGRESS_PROXY! } : undefined,
      args: !fixture
        ? [
            "--disable-quic",
            "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
          ]
        : [],
      timeout: 20000,
    });
    const context = await browser.newContext({
      ignoreHTTPSErrors: false,
      acceptDownloads: false,
      serviceWorkers: "block",
      permissions: [],
      viewport: { width: 1440, height: 960 },
    });
    const abort = () => void browser?.close();
    options.signal?.addEventListener("abort", abort, { once: true });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(30000);
    const resources = new Map<Request, Resource>();
    let requestCount = 0;
    let redirects = 0;
    let responseBytes = 0;
    const pending: Promise<void>[] = [];
    await context.route("**/*", async (route) => {
      const request = route.request();
      requestCount++;
      try {
        const dest = new URL(request.url());
        if (
          requestCount > 120 ||
          !["http:", "https:"].includes(dest.protocol) ||
          !["GET", "HEAD"].includes(request.method())
        )
          return await route.abort();
        if (fixture) {
          if (dest.origin !== url.origin) return await route.abort();
        } else approvedTarget(dest.href);
        if (
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame() &&
          ++redirects > 8
        )
          return await route.abort();
        await route.continue();
      } catch {
        await route.abort();
      }
    });
    page.on("request", (request) => {
      try {
        const u = new URL(request.url());
        if (!["http:", "https:"].includes(u.protocol)) return;
        const provider = providerCatalog.providers.find(
          (p) => u.hostname === p.domain || u.hostname.endsWith("." + p.domain),
        );
        const r: Resource = {
          url: sanitizeUrl(u.href),
          type: request.resourceType(),
          origin: u.origin,
          protocol: u.protocol,
          status: null,
          thirdParty:
            (getDomain(u.hostname) ?? u.hostname) !==
            (getDomain(url.hostname) ?? url.hostname),
          outcome: "pending",
          provider: provider
            ? `${provider.name} (${provider.kind}; heurística)`
            : "unknown",
        };
        resources.set(request, r);
        if (
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame()
        )
          c.redirects.push(r.url);
      } catch {
        /* non-network URLs are excluded */
      }
    });
    page.on("requestfailed", (request) => {
      const r = resources.get(request);
      if (r)
        r.outcome = request.failure()?.errorText.includes("BLOCKED")
          ? "blocked"
          : "failed";
    });
    page.on("response", (response) => {
      pending.push(
        (async () => {
          const r = resources.get(response.request());
          if (r) {
            r.status = response.status();
            r.outcome = "loaded";
          }
          const entries = await response.headersArray();
          responseBytes += Number(
            entries.find((h) => h.name.toLowerCase() === "content-length")
              ?.value ?? 0,
          );
          if (responseBytes > 20 * 1024 * 1024) {
            await page.close();
            return;
          }
          for (const h of entries)
            if (h.name.toLowerCase() === "set-cookie" && c.cookies.length < 100)
              c.cookies.push(cookieMetadata(h.value, response.url()));
        })().catch(() => {}),
      );
    });
    await step("Navegando pela página");
    const response = await page.goto(url.href, {
      waitUntil: "domcontentloaded",
    });
    if (!response) throw new Error("NO_RESPONSE");
    await page.waitForTimeout(1200);
    await Promise.allSettled(pending);
    c.finalUrl = sanitizeUrl(page.url());
    await step("Analisando headers");
    for (const h of await response.headersArray()) {
      const name = h.name.toLowerCase();
      if (["set-cookie", "authorization", "proxy-authorization"].includes(name))
        continue;
      if (
        [
          "strict-transport-security",
          "content-security-policy",
          "content-security-policy-report-only",
          "x-frame-options",
          "x-content-type-options",
          "referrer-policy",
          "permissions-policy",
          "content-type",
        ].includes(name)
      )
        (c.headers[name] ??= []).push(h.value.slice(0, 8192));
    }
    await step("Inspecionando HTTPS");
    c.tls = page.url().startsWith("https:") ? "valid" : "not-applicable";
    if (url.protocol === "http:" && page.url().startsWith("https:"))
      c.httpUpgrade = "yes";
    if (!fixture && url.protocol === "https:") {
      const probe = await context.newPage();
      try {
        const http = new URL(url);
        http.protocol = "http:";
        await probe.goto(http.href, {
          timeout: 10000,
          waitUntil: "domcontentloaded",
        });
        c.httpUpgrade = probe.url().startsWith("https:") ? "yes" : "no";
      } catch {
        c.httpUpgrade = "untested";
      } finally {
        await probe.close();
      }
    }
    await step("Inspecionando cookies");
    const unique = new Map(
      c.cookies.map((k) => [`${k.domain}|${k.path}|${k.name}`, k]),
    );
    c.cookies = [...unique.values()];
    await step("Inspecionando recursos externos");
    const scripts = await page.locator("script[src]").evaluateAll((elements) =>
      elements.map((el) => ({
        src: (el as HTMLScriptElement).src,
        integrity: (el as HTMLScriptElement).integrity,
      })),
    );
    c.resources = [...resources.values()].slice(0, 120).map((r) => ({
      ...r,
      integrity: scripts.find((s) => sanitizeUrl(s.src) === r.url)?.integrity,
    }));
    await step("Verificando SEO e privacidade");
    const dom = await page.evaluate(() => ({
      title: document.title.slice(0, 300),
      description:
        document
          .querySelector('meta[name="description"]')
          ?.getAttribute("content")
          ?.slice(0, 500) ?? null,
      canonical:
        document.querySelector('link[rel="canonical"]')?.getAttribute("href") ??
        null,
      viewport:
        document
          .querySelector('meta[name="viewport"]')
          ?.getAttribute("content") ?? null,
      openGraph: !!document.querySelector('meta[property="og:title"]'),
      h1Count: document.querySelectorAll("h1").length,
      imagesWithoutAlt: document.querySelectorAll("img:not([alt])").length,
      robots:
        document
          .querySelector('meta[name="robots"]')
          ?.getAttribute("content") ?? null,
      privacyLink: !!Array.from(document.querySelectorAll("a")).find((a) =>
        /privacidade|privacy/i.test(a.textContent ?? ""),
      ),
      consentControl: !!Array.from(
        document.querySelectorAll('button,[role="button"]'),
      ).find((a) => /cookie|consent/i.test(a.textContent ?? "")),
      personalForms: document.querySelectorAll(
        'input[type="email"],input[type="tel"]',
      ).length,
      localStorageKeys: (() => {
        try {
          return localStorage.length;
        } catch {
          return null;
        }
      })(),
      sessionStorageKeys: (() => {
        try {
          return sessionStorage.length;
        } catch {
          return null;
        }
      })(),
    }));
    c.seo = {
      title: dom.title,
      description: dom.description,
      canonical: dom.canonical
        ? sanitizeUrl(new URL(dom.canonical, page.url()).href)
        : null,
      viewport: dom.viewport,
      openGraph: dom.openGraph,
      h1Count: dom.h1Count,
      imagesWithoutAlt: dom.imagesWithoutAlt,
      robots: dom.robots,
      brokenResources: c.resources.filter((r) => r.status && r.status >= 400)
        .length,
      robotsTxt: "NOT_TESTED",
      sitemap: "NOT_TESTED",
    };
    c.privacy = {
      privacyLink: dom.privacyLink,
      consentControl: dom.consentControl,
      personalForms: dom.personalForms,
      localStorageKeyCount: dom.localStorageKeys,
      sessionStorageKeyCount: dom.sessionStorageKeys,
      cookiesBeforeInteraction: c.cookies.length,
      knownTrackers: c.resources
        .filter((r) => r.provider?.includes("analytics"))
        .map((r) => r.origin),
    };
    await step("Verificando acessibilidade");
    try {
      const axe = await new AxeBuilder({ page }).analyze();
      c.accessibility = {
        violations: axe.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          help: v.help,
          helpUrl: v.helpUrl,
          nodes: v.nodes.slice(0, 15).map((n) => ({ target: n.target })),
        })),
        passes: axe.passes.length,
        incomplete: axe.incomplete.map((v) => v.id),
      };
    } catch {
      c.accessibility = {
        status: "ERROR",
        reason: "axe-core indisponível neste documento.",
      };
    }
    c.performance = {
      status: "INCONCLUSIVE",
      reason:
        "Lighthouse não executado. Métricas do navegador não substituem um teste Lighthouse isolado.",
      requests: requestCount,
    };
    await step("Capturando evidência");
    screenshot = await page.screenshot({ type: "png", fullPage: false });
    if (screenshot.length > 5 * 1024 * 1024) screenshot = undefined;
    c.collected = true;
    options.signal?.removeEventListener("abort", abort);
  } catch (error) {
    c.browserError =
      error instanceof Error
        ? error.message.slice(0, 160)
        : "NAVIGATION_FAILED";
    if (/CERT_|SSL_/i.test(c.browserError)) c.tls = "invalid";
  } finally {
    await browser?.close();
  }
  await step("Consolidando resultados");
  const findings = await evaluateRules(c);
  const additional: RuleResult[] = [];
  const extra = (
    id: string,
    category: RuleResult["category"],
    title: string,
    status: RuleResult["status"],
    evidence: unknown,
    description: string,
  ): RuleResult => ({
    ruleId: id,
    category,
    title,
    status,
    evidence,
    description,
    justification: description,
    severity: status === "WARN" ? "LOW" : "INFO",
    weight: 0,
    recommendation:
      "Revise as evidências e confirme manualmente no contexto do site.",
    documentationUrl:
      category === "accessibility"
        ? "https://www.w3.org/WAI/test-evaluate/"
        : "https://developer.mozilla.org/en-US/docs/Learn_web_development",
    testedAt: c.testedAt,
  });
  if (c.collected) {
    additional.push(
      extra(
        "SEO-001",
        "seo",
        "Metadados e estrutura",
        c.seo?.title && c.seo?.description && c.seo?.viewport ? "PASS" : "WARN",
        c.seo,
        "Inspeção limitada à página inicial. Robots e sitemap não foram consultados.",
      ),
    );
    additional.push(
      extra(
        "PRIV-001",
        "privacy",
        "Sinais de privacidade",
        "INFO",
        c.privacy,
        "Observações anteriores a qualquer interação; não constitui avaliação de conformidade LGPD.",
      ),
    );
    const a = c.accessibility as { status?: string; violations?: unknown[] };
    additional.push(
      extra(
        "A11Y-001",
        "accessibility",
        "Auditoria automatizada axe-core",
        a.status === "ERROR" ? "ERROR" : a.violations?.length ? "WARN" : "PASS",
        c.accessibility,
        "Testes automatizados não substituem uma auditoria manual.",
      ),
    );
  } else
    for (const [id, category, title] of [
      ["SEO-001", "seo", "SEO"],
      ["PRIV-001", "privacy", "Privacidade"],
      ["A11Y-001", "accessibility", "Acessibilidade"],
    ] as const)
      additional.push(
        extra(id, category, title, "INCONCLUSIVE", {}, "Coleta não concluída."),
      );
  additional.push(
    extra(
      "PERF-001",
      "performance",
      "Performance de laboratório",
      "INCONCLUSIVE",
      c.performance ?? {},
      "Lighthouse indisponível; nenhuma nota de performance foi calculada.",
    ),
  );
  return {
    context: c,
    findings: [...findings, ...additional],
    scoring: calculateScore(findings),
    screenshot,
  };
}
