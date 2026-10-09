# Operação sem Docker · modo HTTP

Este modo foi adicionado por solicitação do usuário. Funciona em Next.js/Vercel, sem PostgreSQL, Redis, BullMQ, Docker ou navegador. Persistência em Vercel Blob **privado**, com leitura consistente (`useCache:false`), gravação condicional por ETag, registros únicos e segredo somente no servidor. Em desenvolvimento local, `pnpm dev:native` usa arquivos em `/storage/native`; nunca utilize o FileStore para múltiplas instâncias de produção.

O scanner faz requisições GET passivas com Node HTTP/HTTPS. DNS é resolvido e todos os IPs são classificados antes da conexão; a conexão fixa um único IP validado pelo callback lookup e verifica remoteAddress. TLS usa validação padrão e hostname original. Todos os redirects são normalizados e revalidados, com máximo 8 e limite de 2 MiB por resposta. Não executa JavaScript, nem carrega subrecursos, nem autentica no alvo. Timeout de coleta: 45 segundos. O máximo da função é 60 segundos.

SEC-001…010 e SEC-012 usam dados HTTP observados. Cookies vêm somente de Set-Cookie e são minimizados, nunca de execução de scripts. SEC-011 (mixed content) e SEC-013 (recursos/scripts) são **INCONCLUSIVE**, assim como axe-core e Lighthouse. SEO analisa o HTML recebido, sem renderização por JavaScript, robots.txt ou sitemap. Privacidade mostra somente sinais estáticos e cookies HTTP. Score é provisório por cobertura limitada; não é certificação de segurança.

POST cria um registro persistido e usa Next.js `after` para continuar a auditoria no tempo de vida da função. SSE lê o estado real do storage, com reconexão e steps persistidos. Esse modelo não é uma fila durável de execução: se o runtime for interrompido, não há retry automático; registros ainda ativos após 90s tornam-se FAILED/INTERRUPTED_JOB na consulta autorizada. A URL não deve ser reutilizada como prova de sucesso sem consultar status.

Conta/sessão, projetos, histórico, comparação, compartilhamento revogável e JSON/PDF usam o mesmo contrato da interface. Senhas scrypt com salt; hashes de sessão/capacidade; Cookie HttpOnly/SameSite/Secure em produção. Mudanças exigem Origin da aplicação. Registros privados só são lidos pelo proprietário ou por share válido. Somente o solicitante pode cancelar.

Quotas diárias atômicas no storage: 3 anônimos por identidade de IP, 20 scans por usuário, 30 por IP e 20 tentativas de login/registro por IP. Em Vercel a identidade usa x-vercel-forwarded-for fornecido pelo ingress da plataforma; se ausente, todos ficam no mesmo bucket conservador. Em dev local, existe um único bucket. Limites de chamadas gerais/WAF e custos de storage devem ser acompanhados pelo operador.

## Configuração

Produção: `BLOB_READ_WRITE_TOKEN` (store privado conectado ao projeto) e `CRON_SECRET` (gerado e armazenado como segredo na Vercel). Nenhum valor é commitado. API_URL ausente seleciona modo nativo; API_URL presente seleciona a API/runner completo separado.

Cron diário `/api/v1/maintenance` às 09:00 UTC (06:00 São Paulo), autenticado por CRON_SECRET. Bloqueio de leitura expirados é imediato. Limpeza física ocorre em lotes de até 150 registros por prefixo/dia; em alto volume amplie paginação/operador. Relatórios anônimos 7 dias, conta 90 dias, sessão/share 7 dias. Históricos de scans removidos são limpos junto; índices de shares órfãos podem necessitar manutenção adicional. Dados da conta persistem até remoção pelo operador.

```sh
pnpm install
pnpm dev:native
```

O armazenamento privado Blob pertence à conta Vercel do usuário, região São Paulo (gru1). Não requer instalação na máquina do usuário. O modo de navegador isolado permanece disponível como alternativa separada na implementação original; não foi simulado ou habilitado na Vercel.

Fontes: [Next.js after](https://nextjs.org/docs/app/api-reference/functions/after), [Vercel Blob privado](https://vercel.com/docs/vercel-blob/private-storage), [leituras consistentes](https://vercel.com/changelog/vercel-blob-now-supports-consistent-reads-on-private-storage).
