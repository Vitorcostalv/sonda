import { createServer, request } from "node:http";
import { connect } from "node:net";
import { normalizeUrl, resolveDestination } from "@sonda/scanner/security";
// DNS is resolved once per connection; sockets use only the selected validated literal IP.
// TLS is tunneled, so Chromium validates the certificate against the original hostname.
const server = createServer(async (req, res) => {
  try {
    if (!["GET", "HEAD"].includes(req.method ?? ""))
      throw new Error("METHOD_BLOCKED");
    const url = normalizeUrl(req.url ?? "");
    if (url.protocol !== "http:") throw new Error("PROTOCOL_BLOCKED");
    const { addresses } = await resolveDestination(url);
    const destination = addresses[0];
    const headers: Record<string, string | string[] | undefined> = {
      ...req.headers,
      host: url.host,
    };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    delete headers.authorization;
    delete headers.cookie;
    const upstream = request(
      {
        hostname: destination.address,
        family: destination.family,
        port: 80,
        path: url.pathname + url.search,
        method: req.method,
        headers,
        timeout: 15000,
      },
      (response) => {
        if (upstream.socket?.remoteAddress !== destination.address) {
          upstream.destroy();
          res.destroy();
          return;
        }
        res.writeHead(response.statusCode ?? 502, response.headers);
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 5 * 1024 * 1024) {
            upstream.destroy();
            res.destroy();
          }
        });
        response.pipe(res);
      },
    );
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    upstream.end();
  } catch {
    res.writeHead(403);
    res.end("Destination blocked");
  }
});
let tunnels = 0;
server.on("connect", async (req, client, head) => {
  if (++tunnels > 64) {
    tunnels--;
    client.end("HTTP/1.1 429 Too Many Requests\r\n\r\n");
    return;
  }
  let released = false;
  const release = () => {
    if (!released) {
      tunnels--;
      released = true;
    }
  };
  client.once("close", release);
  client.on("error", release);
  try {
    const authority = req.url ?? "";
    if (!/^([a-z\d.-]+|\[[a-f\d:]+\]):443$/i.test(authority))
      throw new Error("INVALID_CONNECT");
    const url = normalizeUrl(`https://${authority}`);
    const { addresses } = await resolveDestination(url);
    const destination = addresses[0];
    const upstream = connect({
      host: destination.address,
      family: destination.family,
      port: 443,
      timeout: 15000,
    });
    upstream.on("connect", () => {
      if (upstream.remoteAddress !== destination.address) {
        upstream.destroy();
        client.destroy();
        return;
      }
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    let bytes = 0;
    upstream.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 20 * 1024 * 1024) {
        upstream.destroy();
        client.destroy();
      }
    });
    upstream.on("timeout", () => {
      upstream.destroy();
      client.destroy();
    });
    upstream.on("error", () => client.destroy());
    client.on("close", () => upstream.destroy());
    setTimeout(() => {
      upstream.destroy();
      client.destroy();
    }, 85000).unref();
  } catch {
    client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    release();
  }
});
server.maxConnections = 80;
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(4200, "0.0.0.0");
