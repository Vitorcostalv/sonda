# Segurança operacional

**Modo publicado sem Docker:** auditor HTTP em Next.js com IP pinning e validação de destino/redirect/TLS; não executa código do website e não abre navegador. Essa mudança foi solicitada pelo usuário. O isolamento de kernel/navegador e as flags abaixo são específicos do backend completo opcional; não há alegação de que Vercel forneça nftables para funções. Limites, quotas, persistência privada e ausência explícita de verificações de navegador estão em [native-vercel.md](native-vercel.md).

**Não ative scans arbitrários apenas porque o validador passa.** O modo default permite somente a fixture explícita e não fornece acesso aberto a URLs internas. O modo público exige três condições no runner: `PUBLIC_SCANS_ENABLED=true`, `NETWORK_ISOLATION_VERIFIED=true` e `EGRESS_PROXY`. A API exige as duas flags também. Elas são um gate operacional, não atestado automático de proteção.

## Destinos e conexão

O parser WHATWG normaliza IPv4 decimal, hexadecimal e octal antes da validação por ipaddr.js. Apenas ranges `unicast` públicos são aceitos; endereços IPv4 mapeados em IPv6 são convertidos para classificação. Protocolos diferentes de HTTP/HTTPS, userinfo, backslashes, hostnames internos, porta não padrão e URLs ambíguas são rejeitados. Query e fragmento da URL de entrada são removidos.

Todos os IPs de uma resposta DNS precisam ser públicos. O proxy resolve antes de cada nova conexão e conecta a um IP literal validado, sem resolver novamente. Confere `remoteAddress`. CONNECT conserva a validação TLS no Chromium e aceita só porta 443. HTTP direto aceita somente GET/HEAD na porta 80. Os redirects e os subrecursos atravessam essa mesma barreira. O proxy não é publicado externamente.

O firewall é independente de TypeScript: instalado com nftables no namespace do container, depois os processos executam como usuários sem privilégios. O runner não possui rota liberada para banco, Redis, API, metadata ou internet direta. Public profile bloqueia IPv6 inclusive endereços especiais, aceitando limitação de cobertura em sites somente IPv6. O Compose público usa o perfil seccomp oficial Playwright para permitir o sandbox do Chromium. Nunca troque por `seccomp=unconfined`.

## Verificação antes da ativação pública

1. Rode o Compose de demonstração em Linux e `node scripts/check-network.mjs`.
2. Inspecione `nft list ruleset` nos containers e confirme que os processos de aplicação não retêm NET_ADMIN nem outros privilégios.
3. Rode o perfil público com flags ainda false e teste bloqueio direto e pelo proxy a IPs privados, metadata sintética, DNS rebinding, redirects/subrecursos controlados e IPv6. Valide IP real conectado com captura de tráfego.
4. Confirme `chromiumSandbox:true` funcional no kernel e seccomp selecionados; não rebaixe o sandbox para contornar falhas.
5. Configure TLS da API, origens, segredo do runner, storage privado, retenção e quotas do gateway. Revise o limite de memória/CPU.
6. Só então habilite as duas flags. As verificações completas do perfil público são uma pendência operacional, não foram executadas no ambiente Windows sem Docker.

## Aplicação

Senhas usam scrypt com salt aleatório. Tokens de sessão/capacidade/compartilhamento têm 256 bits e apenas SHA-256 persiste. Sessão usa HttpOnly, SameSite=Lax e Secure em produção. Mudanças exigem Origin igual ao frontend configurado. CORS é restrito. UUIDs não dão acesso. Compartilhamentos têm revogação e expiração verificadas em cada leitura; SSE revalida a autorização por snapshot.

Rate limit Redis: 60 requests/minuto por conexão/IP, 10 tentativas de scan/hora, login 10/15min e criação de conta 5/hora. Orçamento de scans por dia: 3 anônimos por IP, 20 por usuário. Atrás do proxy Next.js o IP visto é o servidor do frontend; configure um gateway autenticado para encaminhar identidade de IP antes de alta escala, sem habilitar trustProxy indiscriminadamente. Isso atualmente pode limitar diversos visitantes como um único IP.

Requisições do navegador são limitadas a GET/HEAD e 120 por scan; navegações: 8; limites declarados de conteúdo: 20 MiB; screenshot: 5 MiB. O proxy limita resposta HTTP a 5 MiB e túnel TLS a 20 MiB, sem descriptografar TLS. **O limite agregado real de bytes por scan precisa de um gateway com contabilidade de tráfego**, porque content-length ausente ou compressão não permitem esse controle completo no coletor. CPU/memória/tempo continuam limitados externamente.

Não há validação de e-mail, recuperação de senha, MFA ou gestão de equipes nesta versão. APIs não fazem escrita no site alvo. Nenhuma ausência de achado deve ser traduzida como ausência de vulnerabilidade.
