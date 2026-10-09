# Contribuições assistidas

- Preserve TypeScript strict e a separação entre coleta, avaliação e UI.
- Nunca invente scans, screenshots, notas ou aprovações para satisfazer uma interface.
- Mantenha scans públicos bloqueados sem barreira de rede nativa comprovada. Não confie somente em page.route ou na validação inicial.
- Nunca persista valores de cookies, autenticação, senha em claro ou parâmetros sensíveis. Não exponha capacidade/tokenHash em respostas ou logs.
- Toda rota de relatório/evidência/export/share deve verificar proprietário ou capacidade limitada. UUID não é autorização.
- Não implemente exploração, força bruta, login no alvo, envio de formulário ou POST para recursos do website.
- Uma alteração em regras exige testes semânticos e documentação; altere a versão ao mudar pesos ou algoritmo.
- Execute lint, typecheck e testes relevantes. Mudanças de rede exigem o teste containerizado em Linux.
- Diferencie testes ignorados de aprovados e documentação planejada de comportamento verificado.
- Nunca faça deploy do runner dentro da Vercel ou distribua credenciais de banco para o ambiente de navegação.
