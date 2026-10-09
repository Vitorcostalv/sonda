import type {
  AuditCategory,
  AuditContext,
  AuditRule,
  RuleResult,
  RuleStatus,
  Severity,
  Score,
} from "@sonda/contracts";
const docs = "https://developer.mozilla.org/en-US/docs/Web/HTTP/";
type Verdict = {
  status: RuleStatus;
  severity?: Severity;
  evidence?: unknown;
  reason: string;
};
const header = (c: AuditContext, n: string) => c.headers[n.toLowerCase()] ?? [];
export function parseCsp(value: string) {
  const directives = new Map<string, string[]>();
  const malformed: string[] = [];
  for (const part of value.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (!name) continue;
    if (!/^[a-z][a-z\d-]*$/i.test(name)) {
      malformed.push(name);
      continue;
    }
    if (directives.has(name.toLowerCase())) {
      malformed.push(`duplicate:${name}`);
      continue;
    }
    directives.set(name.toLowerCase(), sources);
  }
  return { directives, malformed };
}
function make(
  id: number,
  category: AuditCategory,
  weight: number,
  title: string,
  recommendation: string,
  path: string,
  evaluate: (c: AuditContext) => Verdict,
): AuditRule {
  const ruleId = `SEC-${String(id).padStart(3, "0")}`;
  return {
    id: ruleId,
    category,
    weight,
    async evaluate(c) {
      let v: Verdict;
      if (!c.collected && ![1, 12].includes(id))
        v = {
          status: "INCONCLUSIVE",
          reason: "Coleta interrompida; esta verificação não foi concluída.",
        };
      else v = evaluate(c);
      return {
        ruleId,
        category,
        weight,
        title,
        status: v.status,
        severity: v.severity ?? "INFO",
        description: v.reason,
        justification: v.reason,
        evidence: v.evidence ?? {},
        recommendation,
        documentationUrl: docs + path,
        testedAt: c.testedAt,
      };
    },
  };
}
const session = (name: string) =>
  /(?:^|[_-])(session|sess|sid|auth|token|jwt)(?:$|[_-])|^(connect\.sid|PHPSESSID|JSESSIONID)$/i.test(
    name,
  );
const cookieEvidence = (c: AuditContext) =>
  c.cookies.map(({ name, domain, path, secure, httpOnly, sameSite }) => ({
    name,
    domain,
    path,
    secure,
    httpOnly,
    sameSite,
    possibleSession: session(name),
  }));
const policies = (c: AuditContext) =>
  header(c, "content-security-policy")
    .flatMap((v) => v.split(","))
    .map(parseCsp);
export const securityRules: AuditRule[] = [
  make(
    1,
    "transport",
    15,
    "Transporte HTTPS",
    "Use HTTPS com certificado válido. Verifique o redirecionamento HTTP separadamente.",
    "Guides/Connection_management_in_HTTP_1.x",
    (c) => {
      if (c.tls === "invalid")
        return {
          status: "FAIL",
          severity: "HIGH",
          reason: "A conexão apresentou erro verificável de certificado.",
          evidence: { tls: c.tls },
        };
      if (
        c.redirects.some(
          (u, i) =>
            i > 0 &&
            c.redirects[i - 1].startsWith("https:") &&
            u.startsWith("http:"),
        )
      )
        return {
          status: "FAIL",
          severity: "HIGH",
          reason: "Foi observado downgrade de HTTPS para HTTP.",
          evidence: c.redirects,
        };
      if (c.tls === "unknown" || !c.collected)
        return {
          status: "INCONCLUSIVE",
          reason: "A conexão TLS não pôde ser confirmada.",
        };
      if (!c.finalUrl.startsWith("https:"))
        return {
          status: "FAIL",
          severity: "HIGH",
          reason: "O destino final utiliza HTTP.",
          evidence: { finalUrl: c.finalUrl },
        };
      if (c.httpUpgrade === "no")
        return {
          status: "WARN",
          severity: "MEDIUM",
          reason: "HTTPS válido, mas HTTP não redirecionou para HTTPS.",
          evidence: { tls: c.tls, httpUpgrade: c.httpUpgrade },
        };
      if (c.httpUpgrade === "untested")
        return {
          status: "WARN",
          severity: "LOW",
          reason: "HTTPS válido; redirecionamento de HTTP não verificado.",
          evidence: { tls: c.tls, httpUpgrade: c.httpUpgrade },
        };
      return {
        status: "PASS",
        reason: "TLS válido e redirecionamento HTTP para HTTPS observado.",
        evidence: { tls: c.tls, httpUpgrade: c.httpUpgrade },
      };
    },
  ),
  make(
    2,
    "headers",
    10,
    "Strict Transport Security",
    "Configure max-age positivo em HTTPS. Avalie todos os subdomínios antes de includeSubDomains ou preload.",
    "Reference/Headers/Strict-Transport-Security",
    (c) => {
      if (!c.finalUrl.startsWith("https:"))
        return {
          status: "NOT_APPLICABLE",
          reason: "HSTS não tem efeito sobre uma resposta HTTP.",
        };
      const values = header(c, "strict-transport-security");
      if (!values.length)
        return {
          status: "FAIL",
          severity: "MEDIUM",
          reason: "HSTS ausente na resposta HTTPS.",
        };
      const m = values[0].match(/(?:^|;)\s*max-age\s*=\s*(\d+)\s*(?:;|$)/i);
      if (!m || Number(m[1]) <= 0 || values.length > 1)
        return {
          status: "WARN",
          severity: "MEDIUM",
          reason: "HSTS malformado, desativado ou duplicado.",
          evidence: values,
        };
      return {
        status: Number(m[1]) < 15552000 ? "WARN" : "PASS",
        severity: Number(m[1]) < 15552000 ? "LOW" : "INFO",
        reason: "max-age válido; duração e escopo documentados.",
        evidence: {
          maxAge: Number(m[1]),
          includeSubDomains: /;\s*includesubdomains\b/i.test(values[0]),
          preload: /;\s*preload\b/i.test(values[0]),
        },
      };
    },
  ),
  make(
    3,
    "headers",
    15,
    "Content Security Policy",
    "Adote CSP efetiva com fontes explícitas. Prefira nonces ou hashes e teste em report-only antes de aplicar.",
    "Reference/Headers/Content-Security-Policy",
    (c) => {
      const ps = policies(c);
      if (!ps.length)
        return {
          status: "FAIL",
          severity: "MEDIUM",
          reason: header(c, "content-security-policy-report-only").length
            ? "Existe apenas CSP report-only, sem bloqueio efetivo."
            : "CSP efetiva ausente.",
        };
      if (ps.some((p) => p.malformed.length))
        return {
          status: "INCONCLUSIVE",
          reason: "CSP tem diretivas malformadas ou duplicadas.",
          evidence: ps.map((p) => p.malformed),
        };
      const risks = ps.map((p) => {
        const script =
          p.directives.get("script-src-elem") ??
          p.directives.get("script-src") ??
          p.directives.get("default-src");
        return {
          scriptUnrestricted: !script,
          wildcard: script?.some(
            (s) => s === "*" || s === "http:" || s === "https:",
          ),
          eval: (
            p.directives.get("script-src") ?? p.directives.get("default-src")
          )?.includes("'unsafe-eval'"),
          inline:
            script?.includes("'unsafe-inline'") &&
            !script.some((s) => /^'nonce-|^'sha(256|384|512)-/.test(s)),
          objectUnrestricted: !(
            p.directives.get("object-src") ?? p.directives.get("default-src")
          ),
          baseUnrestricted: !p.directives.has("base-uri"),
        };
      });
      // Multiple policies intersect: flag a weakness only when every effective policy permits it.
      const weak = ["scriptUnrestricted", "wildcard", "eval", "inline"].filter(
        (key) =>
          risks.every(
            (r) =>
              r[key as keyof typeof r] ||
              (key !== "scriptUnrestricted" && r.scriptUnrestricted),
          ),
      );
      return {
        status: weak.length ? "WARN" : "PASS",
        severity: weak.length ? "MEDIUM" : "INFO",
        reason: weak.length
          ? "As políticas efetivas permitem fontes ou execução ampla."
          : "Não foram identificadas permissões amplas de execução nas políticas observadas.",
        evidence: {
          policyCount: ps.length,
          weaknesses: weak,
          policies: header(c, "content-security-policy"),
          objectAndBaseReview: risks,
        },
      };
    },
  ),
  make(
    4,
    "headers",
    6,
    "Tipos de conteúdo",
    "Envie X-Content-Type-Options: nosniff para evitar interpretação incorreta do conteúdo.",
    "Reference/Headers/X-Content-Type-Options",
    (c) => {
      const v = header(c, "x-content-type-options");
      return {
        status:
          v.length === 1 && v[0].trim().toLowerCase() === "nosniff"
            ? "PASS"
            : "FAIL",
        severity:
          v.length === 1 && v[0].trim().toLowerCase() === "nosniff"
            ? "INFO"
            : "LOW",
        reason: v.length
          ? "Valor de X-Content-Type-Options inspecionado."
          : "Header nosniff ausente.",
        evidence: v,
      };
    },
  ),
  make(
    5,
    "headers",
    4,
    "Política de referência",
    "Prefira strict-origin-when-cross-origin, same-origin ou no-referrer conforme o uso do site.",
    "Reference/Headers/Referrer-Policy",
    (c) => {
      const all = header(c, "referrer-policy");
      if (!all.length)
        return {
          status: "INFO",
          reason:
            "Header ausente. Navegadores modernos adotam strict-origin-when-cross-origin por padrão.",
        };
      const valid = [
        "no-referrer",
        "same-origin",
        "strict-origin",
        "strict-origin-when-cross-origin",
        "origin",
        "origin-when-cross-origin",
        "no-referrer-when-downgrade",
        "unsafe-url",
      ];
      const tokens = all
        .join(",")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => valid.includes(s));
      if (!tokens.length)
        return {
          status: "WARN",
          severity: "LOW",
          reason: "Nenhum valor reconhecido; aplica-se o padrão do navegador.",
          evidence: all,
        };
      const v = tokens.at(-1);
      return {
        status: v === "unsafe-url" ? "WARN" : "PASS",
        severity: v === "unsafe-url" ? "LOW" : "INFO",
        reason: "Última política reconhecida avaliada.",
        evidence: { effective: v },
      };
    },
  ),
  make(
    6,
    "headers",
    3,
    "Permissões do navegador",
    "Restrinja câmera, microfone e geolocalização quando essas funcionalidades não forem necessárias.",
    "Reference/Headers/Permissions-Policy",
    (c) => {
      const v = header(c, "permissions-policy");
      if (!v.length)
        return {
          status: "INFO",
          reason:
            "Política não declarada. Ausência não comprova vulnerabilidade.",
        };
      const text = v.join(",");
      if (
        !/^[a-z-]+\s*=\s*(\*|\([^)]*\))(\s*,\s*[a-z-]+\s*=\s*(\*|\([^)]*\)))*\s*$/i.test(
          text,
        )
      )
        return {
          status: "INCONCLUSIVE",
          reason: "Sintaxe de Permissions-Policy não reconhecida.",
          evidence: v,
        };
      return {
        status: /(camera|microphone|geolocation)\s*=\s*\*/.test(text)
          ? "WARN"
          : "PASS",
        severity: /(camera|microphone|geolocation)\s*=\s*\*/.test(text)
          ? "LOW"
          : "INFO",
        reason:
          "Permissões explícitas inspecionadas; recomendações dependem do uso do site.",
        evidence: v,
      };
    },
  ),
  make(
    7,
    "headers",
    8,
    "Proteção contra enquadramento",
    "Configure frame-ancestors na CSP. Use X-Frame-Options para clientes legados se apropriado.",
    "Reference/Headers/X-Frame-Options",
    (c) => {
      const frames = policies(c)
        .map((p) => p.directives.get("frame-ancestors"))
        .filter((v): v is string[] => !!v);
      const x = header(c, "x-frame-options");
      if (frames.length)
        return {
          status: frames.every((v) => v.includes("*")) ? "WARN" : "PASS",
          severity: frames.every((v) => v.includes("*")) ? "MEDIUM" : "INFO",
          reason:
            "frame-ancestors tem precedência nos navegadores modernos; revise divergências com X-Frame-Options.",
          evidence: { frameAncestors: frames, xFrameOptions: x },
        };
      if (x.length === 1 && /^(DENY|SAMEORIGIN)$/i.test(x[0].trim()))
        return {
          status: "PASS",
          reason: "Proteção legada válida.",
          evidence: x,
        };
      return {
        status: "WARN",
        severity: "MEDIUM",
        reason: x.length
          ? "X-Frame-Options inválido ou conflitante."
          : "Nenhuma proteção de frame observada.",
        evidence: x,
      };
    },
  ),
  make(
    8,
    "cookies",
    8,
    "Cookies com Secure",
    "Use Secure em cookies transmitidos por HTTPS, priorizando cookies de sessão.",
    "Reference/Headers/Set-Cookie",
    (c) => {
      if (!c.cookies.length)
        return {
          status: "NOT_APPLICABLE",
          reason: "Nenhum cookie foi observado.",
        };
      const bad = c.cookies.filter((k) => !k.secure);
      return {
        status: bad.length ? "WARN" : "PASS",
        severity: bad.some((k) => session(k.name))
          ? "HIGH"
          : bad.length
            ? "LOW"
            : "INFO",
        reason: bad.length
          ? "Cookies sem Secure observados; finalidade inferida pelo nome."
          : "Todos os cookies observados têm Secure.",
        evidence: cookieEvidence(c),
      };
    },
  ),
  make(
    9,
    "cookies",
    7,
    "Cookies com HttpOnly",
    "Use HttpOnly nos cookies de sessão que não precisam de acesso por JavaScript.",
    "Reference/Headers/Set-Cookie",
    (c) => {
      if (!c.cookies.length)
        return {
          status: "NOT_APPLICABLE",
          reason: "Nenhum cookie foi observado.",
        };
      const bad = c.cookies.filter((k) => !k.httpOnly);
      return {
        status: bad.some((k) => session(k.name))
          ? "WARN"
          : bad.length
            ? "INFO"
            : "PASS",
        severity: bad.some((k) => session(k.name)) ? "MEDIUM" : "INFO",
        reason: bad.length
          ? "Cookies acessíveis por JavaScript observados; alguns usos legítimos exigem isso."
          : "Todos os cookies observados têm HttpOnly.",
        evidence: cookieEvidence(c),
      };
    },
  ),
  make(
    10,
    "cookies",
    7,
    "Contexto SameSite",
    "Use Lax ou Strict quando compatível; integrações cross-site podem exigir None com Secure.",
    "Reference/Headers/Set-Cookie",
    (c) => {
      if (!c.cookies.length)
        return {
          status: "NOT_APPLICABLE",
          reason: "Nenhum cookie foi observado.",
        };
      const invalid = c.cookies.filter(
        (k) =>
          (k.sameSite === "None" && !k.secure) ||
          (k.sameSite && !["Strict", "Lax", "None"].includes(k.sameSite)),
      );
      return {
        status: invalid.length
          ? "FAIL"
          : c.cookies.some((k) => !k.sameSite)
            ? "INFO"
            : "PASS",
        severity: invalid.length ? "MEDIUM" : "INFO",
        reason: invalid.length
          ? "SameSite inválido ou None sem Secure."
          : "SameSite inspecionado. Ausência usa comportamento padrão do navegador.",
        evidence: cookieEvidence(c),
      };
    },
  ),
  make(
    11,
    "resources",
    12,
    "Conteúdo misto",
    "Sirva recursos por HTTPS. Diferencie recursos carregados dos bloqueados ou atualizados pelo navegador.",
    "Guides/Mixed_content",
    (c) => {
      if (!c.finalUrl.startsWith("https:"))
        return {
          status: "NOT_APPLICABLE",
          reason: "Página HTTP; análise de conteúdo misto não se aplica.",
        };
      const mixed = c.resources.filter((r) => r.protocol === "http:");
      const loaded = mixed.filter((r) => r.outcome === "loaded");
      return {
        status: loaded.length ? "FAIL" : mixed.length ? "WARN" : "PASS",
        severity: loaded.some((r) =>
          ["script", "stylesheet", "document", "fetch", "xhr"].includes(r.type),
        )
          ? "HIGH"
          : mixed.length
            ? "LOW"
            : "INFO",
        reason: loaded.length
          ? "Recursos HTTP efetivamente carregados em página HTTPS."
          : mixed.length
            ? "Tentativas HTTP observadas, sem comprovação de carregamento inseguro."
            : "Nenhuma requisição HTTP observada no escopo.",
        evidence: mixed,
      };
    },
  ),
  make(
    12,
    "transport",
    8,
    "Cadeia de redirecionamentos",
    "Mantenha redirects curtos e sem downgrade. Mudança de domínio exige contexto e não indica malícia.",
    "Guides/Redirections",
    (c) => {
      const chain = c.redirects;
      if (c.browserError && !c.collected)
        return {
          status: "ERROR",
          reason: "Navegação interrompida; cadeia incompleta.",
          evidence: chain,
        };
      if (chain.some((u, i) => chain.indexOf(u) < i))
        return {
          status: "FAIL",
          severity: "MEDIUM",
          reason: "Loop de redirecionamento observado.",
          evidence: chain,
        };
      if (
        chain.some(
          (u, i) =>
            i > 0 && chain[i - 1].startsWith("https:") && u.startsWith("http:"),
        )
      )
        return {
          status: "FAIL",
          severity: "HIGH",
          reason: "Downgrade de HTTPS para HTTP.",
          evidence: chain,
        };
      const domains = new Set(chain.map((u) => new URL(u).hostname));
      return {
        status: chain.length > 6 ? "WARN" : domains.size > 1 ? "INFO" : "PASS",
        severity: chain.length > 6 ? "LOW" : "INFO",
        reason:
          chain.length > 6
            ? "Cadeia excessiva."
            : domains.size > 1
              ? "Mudança de domínio observada; pode ser legítima."
              : "Cadeia de navegação dentro dos limites.",
        evidence: chain,
      };
    },
  ),
  make(
    13,
    "resources",
    5,
    "Scripts de terceiros",
    "Revise fornecedores e minimize origens externas. Considere SRI para scripts estáticos compatíveis.",
    "Reference/Headers/Content-Security-Policy/script-src",
    (c) => {
      const scripts = c.resources.filter((r) => r.type === "script");
      const bad = scripts.filter(
        (r) => r.protocol === "http:" && r.outcome === "loaded",
      );
      const third = scripts.filter((r) => r.thirdParty);
      return {
        status: bad.length ? "FAIL" : third.length ? "INFO" : "PASS",
        severity: bad.length ? "HIGH" : "INFO",
        reason: bad.length
          ? "Script carregado por HTTP."
          : third.length
            ? "Scripts externos inventariados; origem ou ausência de SRI não comprova malícia."
            : "Nenhum script externo observado.",
        evidence: {
          origins: [...new Set(third.map((r) => r.origin))],
          scripts,
        },
      };
    },
  ),
];
export async function evaluateRules(c: AuditContext): Promise<RuleResult[]> {
  return Promise.all(
    securityRules.map(async (rule) => {
      try {
        return await rule.evaluate(c);
      } catch {
        return {
          ruleId: rule.id,
          category: rule.category,
          weight: rule.weight,
          status: "ERROR" as const,
          severity: "INFO" as const,
          title: rule.id,
          description: "Falha técnica na avaliação.",
          justification: "Falha técnica na avaliação.",
          evidence: {},
          recommendation: "Repita a análise.",
          documentationUrl: docs,
          testedAt: c.testedAt,
        };
      }
    }),
  );
}
export function calculateScore(results: RuleResult[]): Score {
  const applicable = results.filter(
    (r) => r.ruleId.startsWith("SEC-") && r.status !== "NOT_APPLICABLE",
  );
  const completed = applicable.filter(
    (r) => !["ERROR", "INCONCLUSIVE"].includes(r.status),
  );
  const total = applicable.reduce((n, r) => n + r.weight, 0),
    weight = completed.reduce((n, r) => n + r.weight, 0);
  const coverage = total ? Math.round((weight / total) * 100) : 0;
  const value = completed.reduce(
    (n, r) =>
      n + r.weight * (r.status === "FAIL" ? 0 : r.status === "WARN" ? 0.5 : 1),
    0,
  );
  return {
    score: coverage < 70 || !weight ? null : Math.round((value / weight) * 100),
    coverage,
    version: "sonda-weighted-v1",
    completed: completed.length,
    applicable: applicable.length,
    provisional: coverage < 100,
  };
}
