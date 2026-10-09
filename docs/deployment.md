# Deploy

## Frontend Vercel

Projeto Next.js com root directory `apps/web`, framework `nextjs`, install `pnpm install --frozen-lockfile`, build `pnpm --filter @sonda/web build`. O workspace raiz precisa estar disponível para resolver `@sonda/contracts`. Node 22.

Variáveis de runtime: `API_URL=https://api.seudominio` e `WEB_ORIGIN=https://frontend.seudominio`. Não coloque URL interna do banco no frontend. Sem API_URL, o frontend retorna 503 claro e não cria scans fictícios. Configure o mesmo WEB_ORIGIN na API para login e alterações passarem na política Origin.

Vercel é somente frontend. Não suporta a execução persistente do worker BullMQ ou navegador isolado desta arquitetura. SSE pelo proxy é sujeito ao tempo máximo de função do plano; o cliente reconecta e recupera estado. Para sessões ativas longas, planeje um gateway dedicado para SSE.

## Serviços de backend

Execute em Linux com Docker e capacidade real de configurar rede/nftables. PostgreSQL e Redis em rede de controle privada. A API exige HTTPS público ou gateway TLS e CORS/Origin do frontend. Runner e egress não devem ter portas expostas. Storage S3 privado, IAM limitado ao bucket SONDA, criptografia e lifecycle. API e worker compartilham credenciais de dados; runner recebe somente RUNNER_TOKEN e política de navegação.

```sh
docker compose -f docker-compose.yml -f infra/compose.public.yml up --build -d
```

O perfil continua com flags false. Não altere para true sem cumprir [verificações de segurança](security.md). A publicação frontend não habilita scans públicos automaticamente.

Antes de produção: revisão do firewall no kernel escolhido, teste de sandbox Chromium, ingress HTTPS para API, geração e rotação de secrets, backups PostgreSQL, Redis persistente, healthchecks/alertas, DNS dedicado, IP de cliente encaminhado por gateway autenticado, orçamento de tráfego agregado, teste de retenção/restauração e política de privacidade do operador.

## Integrações opcionais

S3: `S3_BUCKET`, `AWS_REGION`, IAM ou credenciais ambiente, `S3_ENDPOINT` para endpoint compatível. O SDK usa cadeia de credenciais padrão. Storage local é destinado ao Compose/dev e não a disco efêmero da Vercel.

MDN: adapter em `packages/scanner/src/observatory.ts`, timeout 15s, cache 1h, dados com origem/cached/retrievedAt. Ainda não é invocado pelo pipeline. Se for integrado, execute em serviço de backend com saída permitida exclusivamente ao domínio MDN, nunca use nota externa como substituição das regras locais. [API v2 oficial](https://developer.mozilla.org/en-US/observatory/docs/faq).

Lighthouse: não implementado; report informa INCONCLUSIVE. A instalação futura deve preservar isolamento e atribuir métricas de laboratório ao ambiente/versão.
