# Entrega SONDA · 9 de outubro de 2026

## Atualização solicitada: sem Docker

Foi implementado e provisionado um segundo modo de execução, nativo da Vercel: auditoria HTTP real em funções Next.js e armazenamento privado Vercel Blob, com conta/sessão, projetos, histórico, SSE persistido, exportação JSON/PDF, comparação e compartilhamento revogável. Não exige serviços instalados pelo usuário. Domínio publicado: https://sonda-snowy.vercel.app. Repositório: https://github.com/Vitorcostalv/sonda.

Navegador, screenshot, mixed content, scripts externos, axe e Lighthouse permanecem explicitamente indisponíveis/inconclusivos nesse modo. A nota é provisória com cobertura limitada. Banco usado nesse modo é storage privado de objetos, não PostgreSQL; execução usa Next.js after, não BullMQ. Essas diferenças são declaradas, não equivalências artificiais com a especificação original.

Resultados posteriores: 113 testes locais aprovados, 2 testes da API completa ignorados localmente. Leitura/gravação condicional de Blob privado verificada com dados temporários removidos. Na aplicação publicada, o fluxo real de example.com concluiu com 17 resultados, nota provisória 38 e 80% de cobertura (valores do momento da coleta). Relatório sem capacidade retornou 404; exportação PDF retornou 200 e arquivo com assinatura %PDF. Filtro e expansão da evidência funcionaram no navegador. Screenshots reais estão em `docs/assets/`, incluindo `report-http-live.png`.

[CI Linux 38006409052](https://github.com/Vitorcostalv/sonda/actions/runs/38006409052): todos os jobs aprovados. Quality validou lint/typecheck/113 testes/build/E2E frontend/auditoria; Gitleaks aprovou o histórico. Integração com containers aprovou migração e inicialização, bloqueio nativo de rede (privados/metadata/internet direto), 2 testes da API completa e 2 E2Es. O teste da API percorreu fila → navegador real → PostgreSQL → SSE → screenshot/PDF/JSON → controle de acesso. Essa prova usa alvo local aprovado, não libera o perfil público de navegador em produção.

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
- Docker: binário ausente no ambiente Windows; no CI Linux o Compose, migrações, testes fullstack e firewall passaram. Nenhuma instalação Docker é necessária para usar a versão publicada.

## 8. Riscos conhecidos

Perfil público não verificado na infraestrutura final; browser/kernel devem ser atualizados; CSP do frontend permite inline para hidratação Next; proxy Vercel altera identidade IP vista pelo backend; compartilhamento usa token de capacidade em URL; paths e screenshots públicos podem conter PII publicada; limite agregado de tráfego ainda incompleto. Consulte threat-model.md.

## 9. Produção do modo completo opcional

O modo HTTP já está disponível na Vercel e dispensa essa infraestrutura. Para habilitar o navegador completo: hospedagem Linux para API/worker/runner/egress, PostgreSQL e Redis, TLS/ingress, segredo runner, storage privado e backups, gateway com origem/IP autenticados, validação do sandbox e rede, depois flags de scans públicos. Na Vercel, conectar API_URL e WEB_ORIGIN quando esse backend existir.

## 10. Checklist de conclusão

| Critério                          | Estado verificável                                                     |
| --------------------------------- | ---------------------------------------------------------------------- |
| Monorepo compila                  | Sim; local e CI                                                        |
| Frontend/backend comunicam        | Modo HTTP online e fullstack no CI                                     |
| Banco/migrações funcionam         | PostgreSQL no CI; Blob privado online                                  |
| Worker executa jobs reais         | Fila e persistência no CI; HTTP online usa after                       |
| 13 regras SEC                     | Testadas; HTTP declara 2 inconclusivas                                 |
| SSRF efetivo e teste de rede      | Validação unitária e barreira Linux aprovadas; perfil público pendente |
| SSE real                          | API fullstack no CI; fluxo HTTP online                                 |
| Relatórios persistidos            | PostgreSQL no CI e Blob online                                         |
| Exportações                       | PDF/JSON no CI; PDF online aprovado                                    |
| Dashboard com dados reais         | Sem seed/mock; usa API real                                            |
| Autorização de privados           | Teste fullstack aprovado; online sem capacidade retorna 404            |
| Adicionais reais ou indisponíveis | Axe/screenshot no CI; HTTP e Lighthouse declaram limites               |
| Testes passando                   | 113 unitários/integrados, 2 API e 2 E2E no CI                          |
| Build produção                    | Sim; Vercel Ready                                                      |
| Docker funcionando                | CI Linux aprovado; não necessário para modo publicado                  |
| README fiel                       | Sim, limites explícitos                                                |
| Minimização de dados              | Cookies sem valores no teste de navegador real                         |
| Sem botões com ações fictícias    | Ações ligadas à API; indisponibilidade explícita                       |

O projeto ainda não cumpre todos os critérios para ser declarado completo para produção. Pendências são explicitadas; nenhum resultado de análise ou disponibilidade foi inventado.
