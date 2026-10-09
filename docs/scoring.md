# Pontuação SONDA v1

Versionamento: `sonda-weighted-v1`. Somente SEC-001…013 participam; módulos adicionais têm peso zero e não são misturados à nota de segurança.

| Regra              | Peso |
| ------------------ | ---: |
| HTTPS              |   15 |
| HSTS               |   10 |
| CSP                |   15 |
| nosniff            |    6 |
| Referrer-Policy    |    4 |
| Permissions-Policy |    3 |
| Frame protection   |    8 |
| Cookie Secure      |    8 |
| Cookie HttpOnly    |    7 |
| Cookie SameSite    |    7 |
| Mixed content      |   12 |
| Redirects          |    8 |
| Scripts            |    5 |

Pesos são declarados por regra em `packages/scanner/src/rules.ts` e podem ser configurados ali sob controle de versão. Alterações exigem mudança de `version` e testes. Não são parâmetros controláveis pelo visitante.

`NOT_APPLICABLE` sai do denominador. `ERROR`/`INCONCLUSIVE` permanecem no denominador de cobertura e não recebem crédito. Regras concluídas `PASS`/`INFO` recebem multiplicador 1, `WARN` recebe 0,5 e `FAIL` recebe 0. Cobertura é peso concluído / peso aplicável × 100. Nota é soma dos pesos concluídos multiplicados / peso concluído × 100, arredondada.

Nota é nula quando a cobertura é inferior a 70% ou não há regra aplicável concluída. Abaixo de 100% a nota é provisória; a UI mostra cobertura junto à nota. A UI não apresenta nota para scan não concluído. `INFO` representa observação contextual que não foi considerada um defeito (por exemplo cookie de preferência sem HttpOnly), nunca uma verificação não executada.

Status e severidade são eixos independentes. A severidade explica o impacto de um achado; o peso explica sua contribuição técnica na versão do algoritmo. A nota não é probabilidade de ataque nem certificado de segurança.
