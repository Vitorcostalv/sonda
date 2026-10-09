# Threat model

| Ameaça                                   | Controle implementado                                                  | Limite/residual                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| URL para localhost/metadata/rede privada | WHATWG + ipaddr + todos os endereços DNS validados                     | Necessário testar a barreira real no host público                           |
| DNS rebinding e TOCTOU                   | Proxy conecta IP validado literal e confere remoteAddress              | Resolver/upstream e gateway precisam de operação confiável                  |
| Redirect ou subrecurso SSRF              | Proxy compartilhado para todas as conexões + nftables externo          | WebSockets/TLS são túneis; somente IP/porta são controlados no proxy        |
| Bypass de page.route                     | OUTPUT kernel permite apenas proxy/fixture                             | Namespace/kernel/daemon Docker são parte do perímetro confiável             |
| Exploit do Chromium                      | Sandbox público, container, usuário limitado, sem secrets DB/Redis     | Atualização de Chromium e revisão de seccomp são contínuas                  |
| Exfiltração de cookie/senha              | Não há autenticação no alvo; cookies persistem só como atributos       | Nome de cookie e screenshot público ainda podem conter dados                |
| Leitura de relatório de terceiro         | Proprietário ou capacidade secreta com expiração/revogação             | Link compartilhado é uma capacidade; proteja logs e URL                     |
| Abuso de recursos                        | Rate limits Redis, orçamento diário, concorrência, timeout, memory/CPU | Falta contabilidade agregada de bytes e quota distribuída de proxy          |
| CSRF                                     | Origin estrita, CORS, cookies SameSite                                 | XSS no frontend continua relevante; CSP permite inline para hidratação Next |
| Dependência comprometida                 | Lockfile, audit CI, secret scanning                                    | Audit não prova integridade de toda cadeia de fornecimento                  |
| Resultado enganoso                       | Estados inconclusivos e cobertura separada                             | Determinação contextual automática é limitada e exige revisão humana        |

Alvos só podem ser websites públicos; operações são passivas. Scanner não é ferramenta de pentest e não testa exploração. Fixture local é exceção explícita para desenvolvimento, limitada a uma origem controlada e página raiz na entrada.
