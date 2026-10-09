# Entrega SONDA · 9 de outubro de 2026

## Atualização solicitada: sem Docker

Foi implementado e provisionado um segundo modo de execução, nativo da Vercel: auditoria HTTP real em funções Next.js e armazenamento privado Vercel Blob, com conta/sessão, projetos, histórico, SSE persistido, exportação JSON/PDF, comparação e compartilhamento revogável. Não exige serviços instalados pelo usuário. Domínio publicado: https://sonda-snowy.vercel.app. Repositório: https://github.com/Vitorcostalv/sonda.

Navegador, screenshot, mixed content, scripts externos, axe e Lighthouse permanecem explicitamente indisponíveis/inconclusivos nesse modo. A nota é provisória com cobertura limitada. Banco usado nesse modo é storage privado de objetos, não PostgreSQL; execução usa Next.js after, não BullMQ. Essas diferenças são declaradas, não equivalências artificiais com a especificação original.

Resultados posteriores: 113 testes locais aprovados, 2 testes da API completa ignorados localmente. Leitura/gravação condicional de Blob privado verificada com dados temporários removidos. Na aplicação publicada, o fluxo real de example.com concluiu com 17 resultados, nota provisória 38 e 80% de cobertura (valores do momento da coleta). Relatório sem capacidade retornou 404; exportação PDF retornou 200 e arquivo com assinatura %PDF. Filtro e expansão da evidência funcionaram no navegador. Screenshots reais estão em `docs/assets/`, incluindo `report-http-live.png`. CI Linux já aprovou lint/typecheck/test/build/E2E frontend/audit e secret scanning; integração do backend completo ainda em execução.

As seções abaixo documentam também o backend completo opcional; não são requisitos de instalação para o modo publicado sem Docker.

## 1. Arquitetura

Monorepo pnpm/Turbo com 9 pacotes de aplicação/infra e bibliotecas. Next.js frontend, Fastify API, BullMQ worker, runner isolado Playwright/axe, proxy egress com IP pinning, Prisma/PostgreSQL e Redis, storage local/S3. [Arquitetura detalhada](architecture.md).

## 2. Implementado

13 regras SEC independentes com evidências, pontuação determinística versionada/cobertura, Chromium real com cookie minimizado, screenshot PNG, privacidade inicial, SEO inicial e axe-core. API com conta/sessão, proprietário/capacidade, fila, steps persistidos, SSE recuperável, cancelamento, timeout, orçamento/duplicidade, relatórios, JSON/PDF, projetos, comparação, compartilhamento revogável, limpeza de retenção. Todas as rotas frontend da especificação são presentes, responsivas e usam API real. Migração SQL, Docker Compose de alvo aprovado, perfil público fechado por padrão, CI e documentação.

## 3. Parcial

- Proteção de rede: nftables nativo e proxy implementados; perfil público ainda requer verificação no host final.
- OpenAPI: interface e schemas iniciais; não contém contratos completos de resposta para todas as rotas.
- SEO: DOM da página e recursos quebrados observáveis, sem consultar robots.txt/sitemap.
- MDN: adapter real testável, cache/timeout/status externo; ainda não chamado no pipeline.
- Limite de dados: request, memory, time, screenshots e limites por resposta/túnel; falta contabilidade agregada de bytes no gateway.
- UI de projetos/histórico: API paginada; dashboard possui paginação, lista de projetos e histórico do projeto mostram primeira página.
- Auth: segura por senha/sessão, sem recuperação de senha, verificação de e-mail ou MFA.

## 4. Não implementado

Lighthouse efetivo (sempre INCONCLUSIVE), marcação visual por seletor de achado, gestão de equipes, configuração de retenção pela UI, infraestrutura pública de API/worker/banco/Redis/S3 automaticamente provisionada. Não são apresentados como funcionando.

## 5. Arquivos principais

`apps/{web,api,worker,runner,egress}`, `packages/{contracts,db,scanner,storage}`, `infra/`, `tests/`, `.github/workflows/ci.yml`, `docs/`. Screenshots reais da interface: `docs/assets/`.

## 6. Execução

Sem Docker: `pnpm install`, `pnpm dev:native`, ou acessar o site publicado. Fullstack opcional: configurar `.env` local e `docker compose up --build -d --wait`; analisar `http://172.30.20.4:8080/`. `node scripts/check-network.mjs`. Testes: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm audit --prod --audit-level=high`. Detalhes no README.

## 7. Resultados observados no Windows

- Typecheck: 9 pacotes aprovados.
- Build Next.js: aprovado, todas as rotas geradas.
- Vitest: 113 aprovados, 2 testes da API completa ignorados por dependência de serviços Docker.
- Scanner: navegação real Chromium na fixture, 17 resultados, cookies sem valores, axe-core executado e screenshot real.
- E2E frontend: 1 aprovado, 1 fluxo completo ignorado até ambiente fullstack.
- Auditoria de dependências de produção: nenhuma vulnerabilidade conhecida após atualização de swagger-ui/static e override deepmerge-ts 8.0.2.
- Docker: binário ausente no ambiente Windows; testes fullstack e firewall enviados ao CI Linux. Resultados de CI/publicação serão registrados ao concluir execução.

## 8. Riscos conhecidos

Perfil público não verificado na infraestrutura final; browser/kernel devem ser atualizados; CSP do frontend permite inline para hidratação Next; proxy Vercel altera identidade IP vista pelo backend; compartilhamento usa token de capacidade em URL; paths e screenshots públicos podem conter PII publicada; limite agregado de tráfego ainda incompleto. Consulte threat-model.md.

## 9. Produção do modo completo opcional

O modo HTTP já está disponível na Vercel e dispensa essa infraestrutura. Para habilitar o navegador completo: hospedagem Linux para API/worker/runner/egress, PostgreSQL e Redis, TLS/ingress, segredo runner, storage privado e backups, gateway com origem/IP autenticados, validação do sandbox e rede, depois flags de scans públicos. Na Vercel, conectar API_URL e WEB_ORIGIN quando esse backend existir.

## 10. Checklist de conclusão

| Critério                          | Estado verificável                                         |
| --------------------------------- | ---------------------------------------------------------- |
| Monorepo compila                  | Sim                                                        |
| Frontend/backend comunicam        | Implementado; prova fullstack depende do CI                |
| Banco/migrações funcionam         | Prisma gera cliente/SQL; execução PostgreSQL depende do CI |
| Worker executa jobs reais         | Implementado; execução fila/persistência depende do CI     |
| 13 regras SEC                     | Sim, testadas                                              |
| SSRF efetivo e teste de rede      | Código/barreira/testes presentes; execução Linux pendente  |
| SSE real                          | Implementado; validação fullstack pendente                 |
| Relatórios persistidos            | Implementado; validação fullstack pendente                 |
| Exportações                       | Implementadas; validação fullstack pendente                |
| Dashboard com dados reais         | Sim, sem seed/mock; sem backend informa erro               |
| Autorização de privados           | Implementada no servidor; teste fullstack pendente         |
| Adicionais reais ou indisponíveis | Sim; Lighthouse explicitamente inconclusivo                |
| Testes passando                   | Locais aprovados; infraestrutura ignorada, não aprovada    |
| Build produção                    | Sim                                                        |
| Docker funcionando                | Não verificado localmente; CI pendente                     |
| README fiel                       | Sim, limites explícitos                                    |
| Minimização de dados              | Valores de cookies ausentes no teste real                  |
| Sem botões com ações fictícias    | Ações ligadas à API; erros de disponibilidade explícitos   |

O projeto ainda não cumpre todos os critérios para ser declarado completo para produção. Pendências são explicitadas; nenhum resultado de análise ou disponibilidade foi inventado.
