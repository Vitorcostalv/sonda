# API v1

Origem `WEB_ORIGIN` é obrigatória para POST/PATCH/DELETE. JSON usa `Content-Type: application/json`. Erros: `{ "error": { "code": "...", "message": "..." } }`. OpenAPI disponível em `/docs` somente fora de produção. O schema de criação de scan consta no OpenAPI; a validação detalhada das demais entradas é feita por Zod. Schemas OpenAPI completos para todas as respostas ainda são pendentes.

| Método           | Endpoint                                  | Autorização/função                                      |
| ---------------- | ----------------------------------------- | ------------------------------------------------------- |
| POST             | /api/v1/auth/register                     | E-mail, senha ≥12, nome opcional; cria sessão           |
| POST             | /api/v1/auth/login                        | E-mail e senha; cria cookie HttpOnly                    |
| GET              | /api/v1/auth/me                           | Usuário atual ou null                                   |
| POST             | /api/v1/auth/logout                       | Revoga sessão                                           |
| POST             | /api/v1/scans                             | `{url, projectId?}`; retorna 202 `{id, token?, status}` |
| GET              | /api/v1/scans                             | Conta, página de 20 registros                           |
| GET              | /api/v1/scans/:id                         | Proprietário, capacidade anônima ou share válido        |
| GET              | /api/v1/scans/:id/events                  | SSE: step persistido e state; Last-Event-ID             |
| POST             | /api/v1/scans/:id/cancel                  | Cancela QUEUED/RUNNING                                  |
| DELETE           | /api/v1/scans/:id                         | Somente proprietário, scan encerrado                    |
| GET              | /api/v1/scans/:id/findings                | severity, category, search, page; 50 por página         |
| GET              | /api/v1/scans/:id/report                  | Relatório consolidado sanitizado                        |
| GET              | /api/v1/scans/:id/export/json             | Download sanitizado                                     |
| GET              | /api/v1/scans/:id/export/pdf              | PDF gerado no backend                                   |
| GET              | /api/v1/scans/:id/evidence/:evidenceId    | PNG com autorização e no-store                          |
| POST/GET         | /api/v1/scans/:id/shares                  | Proprietário: criar/listar shares                       |
| DELETE           | /api/v1/scans/:id/shares/:shareId         | Proprietário: revogar                                   |
| GET/POST         | /api/v1/projects                          | Sessão: listar/criar                                    |
| GET/PATCH/DELETE | /api/v1/projects/:id                      | Somente proprietário                                    |
| GET              | /api/v1/projects/:id/scans                | Somente proprietário; paginação                         |
| GET              | /api/v1/comparisons?base=UUID&target=UUID | Autoriza ambos; exige mesmo destino                     |
| GET              | /health/live                              | Processo vivo                                           |
| GET              | /health/ready                             | PostgreSQL e Redis disponíveis                          |

Capacidade em `Authorization: Bearer TOKEN` ou `?token=TOKEN` para EventSource, screenshot e download. Comparação anônima admite `baseToken` e `targetToken` distintos. O backend guarda apenas hashes. Conta não recebe token de capacidade de scan privado. Share funciona sem conta até revogação ou expiração.

Exemplo de alvo controlado:

```sh
curl -X POST http://localhost:4000/api/v1/scans \
  -H 'Origin: http://localhost:3000' \
  -H 'Content-Type: application/json' \
  -d '{"url":"http://172.30.20.4:8080/"}'
```

Não use UUID como credencial. Eventos retornam estado real, mesmo após desconexão. Conexão SSE dura no máximo 5 minutos e o cliente reconecta; isso pode depender dos limites do proxy de hospedagem.
