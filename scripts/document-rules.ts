import { mkdir, writeFile } from "node:fs/promises";
import { securityRules } from "../packages/scanner/src/rules";
import type { AuditContext } from "../packages/contracts/src/index";
async function main() {
  const context: AuditContext = {
    initialUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    headers: {},
    tls: "unknown",
    httpUpgrade: "untested",
    redirects: [],
    cookies: [],
    resources: [],
    collected: false,
    testedAt: new Date(0).toISOString(),
  };
  await mkdir("docs/rules", { recursive: true });
  const links: string[] = [];
  for (const rule of securityRules) {
    const result = await rule.evaluate(context);
    const content = [
      `# ${rule.id} · ${result.title}`,
      "",
      `Categoria: ${rule.category}. Peso: ${rule.weight}. Algoritmo: sonda-weighted-v1.`,
      "",
      "## Dados e resultado",
      "",
      "Avalia o contexto já coletado, sem navegar novamente. Coleta incompleta produz INCONCLUSIVE (ou erro técnico de navegação para HTTPS/redirects), nunca PASS por ausência de dados. Status e severidade são separados. Evidence é o conjunto observado e sanitizado; testedAt é o momento da coleta. Implementação: packages/scanner/src/rules.ts. Testes semânticos: tests/rules.test.ts.",
      "",
      "## Recomendação",
      "",
      result.recommendation,
      "",
      `[Documentação técnica](${result.documentationUrl})`,
      "",
      "## Limites",
      "",
      "Uma página, contexto público, sem interação. Heurísticas não comprovam vulnerabilidade explorável. Políticas de headers são inspecionadas, sem exploração; cookies não incluem valores; nenhum recurso externo é classificado como malicioso pela origem ou nome. Consulte docs/security.md e docs/scoring.md para critérios e limites.",
      "",
    ];
    await writeFile(`docs/rules/${rule.id}.md`, content.join("\n"));
    links.push(`- [${rule.id} · ${result.title}](${rule.id}.md)`);
  }
  await writeFile(
    "docs/rules/README.md",
    [
      "# Catálogo de regras",
      "",
      "Treze regras independentes, com pesos e identificadores estáveis. Testes cobrem contexto restritivo, falhas e estados não aplicáveis/inconclusivos conforme cada regra.",
      "",
      ...links,
      "",
    ].join("\n"),
  );
}
void main();
