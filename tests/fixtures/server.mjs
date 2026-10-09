import { createServer } from "node:http";
const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.end("ok");
    return;
  }
  if (req.url === "/redirect") {
    res.writeHead(302, { Location: "/" });
    res.end();
    return;
  }
  if (req.url === "/app.js") {
    res.setHeader("Content-Type", "application/javascript");
    res.end('document.documentElement.dataset.fixture="observed"');
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
    "Set-Cookie": [
      "session=fixture-only-value; HttpOnly; SameSite=Lax; Path=/",
      "preference=fixture-only-value; Path=/",
    ],
  });
  res.end(
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Alvo de demonstração controlado SONDA"><title>SONDA · Alvo aprovado</title><script src="/app.js" defer></script></head><body><main><h1>Alvo de demonstração SONDA</h1><p>Esta página existe para testes reais e não representa um site de produção.</p><a href="/privacy">Política de privacidade</a><img src="/missing.png"><label>Email <input type="email"></label></main></body></html>',
  );
});
server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
