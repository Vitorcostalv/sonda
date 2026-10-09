import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { normalizeUrl, resolveDestination } from "@sonda/scanner/security";
import { evaluateRules, calculateScore } from "@sonda/scanner/rules";
import {
  sanitizeUrl,
  type AuditContext,
  type CookieMeta,
  type RuleResult,
} from "@sonda/contracts";
import { load } from "cheerio";
export interface HttpResponse {
  url: string;
  status: number;
  headers: Record<string, string[]>;
  html: string;
  cookies: CookieMeta[];
}
export async function pinnedRequest(
  url: URL,
  signal: AbortSignal,
): Promise<HttpResponse> {
  const { host, addresses } = await resolveDestination(url);
  const pinned = addresses.find((a) => a.family === 4) ?? addresses[0];
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: "GET",
        agent: false,
        signal,
        timeout: 10000,
        headers: {
          "User-Agent":
            "SONDA/0.1 Passive HTTP audit (+https://github.com/Vitorcostalv/sonda)",
          Accept: "text/html",
        },
        lookup: (_hostname, _options, callback) =>
          callback(null, pinned.address, pinned.family),
        ...(url.protocol === "https:"
          ? { rejectUnauthorized: true, servername: host }
          : {}),
      },
      (response) => {
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) {
            request.destroy(new Error("RESPONSE_TOO_LARGE"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const headers: Record<string, string[]> = {};
          const cookies: CookieMeta[] = [];
          for (let i = 0; i < response.rawHeaders.length; i += 2) {
            const name = response.rawHeaders[i].toLowerCase(),
              value = response.rawHeaders[i + 1];
            if (name === "set-cookie") {
              const [first, ...attrs] = value.split(";");
              const attributes = new Map(
                attrs.map((a) => {
                  const pos = a.indexOf("=");
                  return pos < 0
                    ? [a.trim().toLowerCase(), ""]
                    : [
                        a.slice(0, pos).trim().toLowerCase(),
                        a.slice(pos + 1).trim(),
                      ];
                }),
              );
              cookies.push({
                name: first.split("=")[0].trim().slice(0, 100),
                domain: attributes.get("domain") ?? host,
                path: attributes.get("path") ?? "/",
                secure: attributes.has("secure"),
                httpOnly: attributes.has("httponly"),
                sameSite: attributes.get("samesite")
                  ? ({ lax: "Lax", strict: "Strict", none: "None" }[
                      attributes.get("samesite")!.toLowerCase() as
                        "lax" | "strict" | "none"
                    ] ?? "Invalid")
                  : "",
                overHttps: url.protocol === "https:",
              });
            } else if (
              [
                "strict-transport-security",
                "content-security-policy",
                "content-security-policy-report-only",
                "x-content-type-options",
                "x-frame-options",
                "referrer-policy",
                "permissions-policy",
                "location",
                "content-type",
              ].includes(name)
            )
              (headers[name] ??= []).push(value.slice(0, 8192));
          }
          resolve({
            url: sanitizeUrl(url.href),
            status: response.statusCode ?? 0,
            headers,
            html: Buffer.concat(chunks).toString("utf8"),
            cookies: cookies.slice(0, 100),
          });
        });
        response.on("error", reject);
      },
    );
    request.on("socket", (socket) => {
      socket.once("connect", () => {
        const actual = socket.remoteAddress?.replace(/^::ffff:/, "");
        if (actual !== pinned.address.replace(/^::ffff:/, ""))
          request.destroy(new Error("REMOTE_ADDRESS_MISMATCH"));
      });
    });
    request.on("timeout", () => request.destroy(new Error("HTTP_TIMEOUT")));
    request.on("error", reject);
    request.end();
  });
}
export async function auditHttp(
  input: string,
  onStep: (name: string) => Promise<void>,
  signal: AbortSignal,
  fetcher = pinnedRequest,
) {
  const initial = normalizeUrl(input),
    testedAt = new Date().toISOString();
  const context: AuditContext = {
    initialUrl: sanitizeUrl(initial.href),
    finalUrl: sanitizeUrl(initial.href),
    headers: {},
    tls: initial.protocol === "https:" ? "unknown" : "not-applicable",
    httpUpgrade: "untested",
    redirects: [],
    cookies: [],
    resources: [],
    collected: false,
    testedAt,
  };
  let response: HttpResponse | undefined;
  try {
    await onStep("Resolvendo DNS e validando destino");
    let current = initial;
    for (let i = 0; i < 8; i++) {
      signal.throwIfAborted();
      context.redirects.push(sanitizeUrl(current.href));
      await onStep(
        i === 0 ? "Inspecionando HTTPS" : "Verificando redirecionamento",
      );
      response = await fetcher(current, signal);
      context.cookies.push(...response.cookies);
      if (
        [301, 302, 303, 307, 308].includes(response.status) &&
        response.headers.location?.[0]
      ) {
        current = normalizeUrl(
          new URL(response.headers.location[0], current).href,
        );
        if (i === 7) throw new Error("REDIRECT_LIMIT");
        continue;
      }
      context.finalUrl = sanitizeUrl(current.href);
      context.headers = response.headers;
      delete context.headers.location;
      context.tls = current.protocol === "https:" ? "valid" : "not-applicable";
      context.collected = true;
      break;
    }
    if (initial.protocol === "http:" && context.finalUrl.startsWith("https:"))
      context.httpUpgrade = "yes";
    if (initial.protocol === "https:") {
      await onStep("Verificando HTTP para HTTPS");
      const http = new URL(initial);
      http.protocol = "http:";
      try {
        const probe = await fetcher(http, signal);
        if (
          [301, 302, 303, 307, 308].includes(probe.status) &&
          probe.headers.location?.[0]
        ) {
          const dest = normalizeUrl(
            new URL(probe.headers.location[0], http).href,
          );
          await resolveDestination(dest);
          context.httpUpgrade = dest.protocol === "https:" ? "yes" : "no";
        } else context.httpUpgrade = "no";
      } catch {
        context.httpUpgrade = "untested";
      }
    }
    await onStep("Analisando headers e cookies HTTP");
    context.cookies = [
      ...new Map(
        context.cookies.map((c) => [`${c.domain}|${c.path}|${c.name}`, c]),
      ).values(),
    ].slice(0, 100);
    await onStep("Inspecionando HTML sem executar scripts");
    if (
      response?.headers["content-type"]?.some((v) => v.includes("text/html"))
    ) {
      const $ = load(response.html);
      const canonical = $('link[rel="canonical"]').attr("href");
      context.seo = {
        title: $("title").text().slice(0, 300),
        description:
          $('meta[name="description"]').attr("content")?.slice(0, 500) ?? null,
        canonical: canonical
          ? sanitizeUrl(new URL(canonical, context.finalUrl).href)
          : null,
        viewport: $('meta[name="viewport"]').attr("content") ?? null,
        openGraph: !!$('meta[property="og:title"]').length,
        h1Count: $("h1").length,
        imagesWithoutAlt: $("img:not([alt])").length,
        robots: $('meta[name="robots"]').attr("content") ?? null,
        robotsTxt: "NOT_TESTED",
        sitemap: "NOT_TESTED",
      };
      context.privacy = {
        cookiesInHttpResponses: context.cookies.length,
        privacyLink: $("a")
          .toArray()
          .some((a) => /privacy|privacidade/i.test($(a).text())),
        personalForms: $('input[type="email"], input[type="tel"]').length,
        consentControl: "NOT_TESTED",
        storage: "NOT_TESTED",
      };
    }
  } catch (error) {
    context.browserError =
      error instanceof Error
        ? "HTTP_COLLECTION_FAILED"
        : "HTTP_COLLECTION_FAILED";
    const code = (error as { code?: string }).code ?? "";
    if (/CERT|TLS|SSL/.test(code)) context.tls = "invalid";
  }
  await onStep("Consolidando resultados HTTP");
  const findings = await evaluateRules(context);
  for (const finding of findings)
    if (["SEC-011", "SEC-013"].includes(finding.ruleId)) {
      finding.status = "INCONCLUSIVE";
      finding.severity = "INFO";
      finding.description =
        "Verificação exige observar recursos no navegador. O modo HTTP não executa scripts ou carrega subrecursos.";
      finding.justification = finding.description;
      finding.evidence = { mode: "HTTP_ONLY", browserExecuted: false };
    }
  const extra = (
    ruleId: string,
    category: RuleResult["category"],
    title: string,
    status: RuleResult["status"],
    evidence: unknown,
    description: string,
  ): RuleResult => ({
    ruleId,
    category,
    title,
    status,
    evidence,
    description,
    justification: description,
    severity: status === "WARN" ? "LOW" : "INFO",
    weight: 0,
    testedAt,
    recommendation:
      "Confirme manualmente no contexto do site; para verificações de navegador, conecte o runner isolado.",
    documentationUrl: "https://developer.mozilla.org/en-US/docs/Web",
  });
  findings.push(
    extra(
      "SEO-001",
      "seo",
      "Metadados do HTML recebido",
      context.seo
        ? context.seo.title && context.seo.description
          ? "PASS"
          : "WARN"
        : "INCONCLUSIVE",
      context.seo ?? {},
      "Inspeção do HTML original. Conteúdo renderizado por JavaScript, robots.txt e sitemap não são verificados.",
    ),
  );
  findings.push(
    extra(
      "PRIV-001",
      "privacy",
      "Sinais de privacidade no HTTP",
      context.privacy ? "INFO" : "INCONCLUSIVE",
      context.privacy ?? {},
      "Cookies somente das respostas HTTP. Não observa scripts, storage ou consentimento e não certifica LGPD.",
    ),
  );
  for (const [ruleId, category, title] of [
    ["A11Y-001", "accessibility", "Acessibilidade axe-core"],
    ["PERF-001", "performance", "Performance Lighthouse"],
  ] as const)
    findings.push(
      extra(
        ruleId,
        category,
        title,
        "INCONCLUSIVE",
        { mode: "HTTP_ONLY" },
        "Não executado no modo HTTP. Nenhuma nota foi gerada.",
      ),
    );
  return {
    context,
    findings,
    scoring: calculateScore(findings),
    mode: "HTTP_ONLY" as const,
  };
}
