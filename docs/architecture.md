# Arquitetura implementada

O frontend Next.js envia chamadas de mesma origem por uma rota proxy a uma API Fastify configurada em `API_URL`. TanStack Query mantém estado de leitura, e SSE transmite o estado de scans. Frontend e contratos não importam Prisma, Redis ou Chromium, portanto o build independe desses serviços.

A API valida URL/entrada, identifica usuário ou cria capacidade anônima, limita uso, persiste um Scan e enfileira sua UUID. BullMQ garante identidade estável do job, e `Scan.activeKey` tem índice único para evitar jobs ativos duplicados por ator/destino. Falhas de enqueue marcam o registro como `FAILED`.

O worker usa banco, Redis e storage, mas não abre o navegador. Ele chama um runner com token de serviço e recebe NDJSON: eventos de coleta e resultado final. Steps são persistidos no PostgreSQL. O SSE recupera steps usando `Last-Event-ID` e envia snapshots, com heartbeat e encerramento de conexão após 5 minutos para nova autenticação. Reconexões recebem o estado atual. Não há polling do frontend para progresso.

O runner tem um job ativo por processo. O worker tem concorrência 1 compatível com esse limite. Cancelamento é observado pelo worker a cada segundo, aborta a conexão do runner e fecha o navegador. Timeout do worker: 90s; runner: 85s. O runner não recebe credenciais de persistência e seu resultado é minimizado antes de voltar ao worker.

A coleta Playwright fornece headers autorizados, cookies somente como atributos, navegações e recursos. Cada regra avalia o mesmo contexto sem navegar novamente. Axe-core executa na página observada; SEO e privacidade consultam DOM sem interação. O teste HTTP adicional em scans HTTPS é explicitamente separado do resultado TLS.

No Compose a rede `control` contém serviços de dados e runner; `browser` é interna e contém runner, fixture e, no perfil público, proxy. Firewall OUTPUT do runner permite somente respostas estabelecidas, loopback, proxy com IP/porta fixa e fixture controlada. Não há Docker socket ou diretório sensível montado. Política de saída do proxy bloqueia IPs privados/reservados/metadata e IPv6. A conexão do proxy usa IP literal selecionado de um conjunto DNS validado.

Prisma possui FKs e exclusão em cascata para dados de scans/usuários. Projetos excluídos desvinculam scans, preservando sua propriedade. Evidências são servidas mediante a mesma autorização do relatório. Storage S3 usa SDK oficial com credenciais fornecidas pelo ambiente, nunca pelo cliente.

O backend ainda precisa ser hospedado em infraestrutura de contêineres para a implantação pública funcionar. A Vercel atende somente o frontend. Veja [deploy](deployment.md).
