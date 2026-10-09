# Privacidade e retenção

O deploy atual usa Vercel Blob **privado**, região São Paulo (gru1), com nomes não controlados pelo website e acesso apenas pelo servidor autorizado. No modo HTTP não há screenshot, storage do website ou execução de scripts. Leitura expirados é bloqueada imediatamente; limpeza física é diária em lotes pelo cron autenticado. Detalhes em [modo sem Docker](native-vercel.md). As referências a limpeza horária/screenshot abaixo correspondem ao modo de worker/navegador opcional.

Persistimos URL sanitizada, horários, usuário quando autenticado, estados, achados, atributos de cookie, origens/URLs de recursos sanitizadas e screenshot público. Valores de cookies, tokens em claro, cabeçalhos de autorização, queries e dados de formulários não são armazenados no relatório.

Local/sessionStorage são contabilizados pelo número de chaves, sem seus nomes ou valores. Dados de formulário são observados somente como existência de campos de e-mail/telefone. Consentimento/política de privacidade são sinais heurísticos do DOM. Não há conclusão de conformidade legal nem certificação LGPD.

URLs podem conter informação sensível em path ou hostname: sanitização remove query, fragmento e userinfo, mas não tem como identificar todo segredo arbitrário no path. Evite URLs com tokens no caminho. Títulos/meta descriptions e screenshots públicos também podem conter informações pessoais publicadas pelo website. Não envie páginas pessoais ou privadas.

Capacidades anônimas ficam no sessionStorage deste navegador, enviadas apenas à API SONDA. Tokens de sessão têm cookie HttpOnly; seus hashes são armazenados. Links compartilhados exibem token uma única vez e expiram em 7 dias; o relatório remove o token da barra de endereço após leitura inicial.

Retenção: anônimo 7 dias, conta 90 dias, sessão 7 dias. A autorização bloqueia registros expirados imediatamente; limpeza do worker remove dados/evidências de hora em hora, em lotes de até 100. Storage S3 também deve ter política de lifecycle. Um proprietário pode excluir scans concluídos no dashboard, com remoção de evidências e registros em cascata.

Para produção: defina controlador, canal de contato, região de armazenamento, base legal e política de privacidade do operador. Esses dados dependem do operador da instalação e não são inventados pelo projeto.
