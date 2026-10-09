import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { collectAudit } from "@sonda/scanner";
const app = Fastify({ bodyLimit: 4096 });
let active = false;
if (!process.env.RUNNER_TOKEN || process.env.RUNNER_TOKEN.length < 32)
  throw new Error("RUNNER_TOKEN must contain at least 32 characters");
app.get("/health/live", async () => ({ status: "ok" }));
app.post("/audit", async (req, reply) => {
  const supplied = Buffer.from(
      req.headers.authorization?.replace(/^Bearer /, "") ?? "",
    ),
    expected = Buffer.from(process.env.RUNNER_TOKEN!);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return reply.code(401).send({ error: "UNAUTHORIZED" });
  if (active) return reply.code(429).send({ error: "BUSY" });
  const input = z
    .object({ url: z.string().max(2048) })
    .strict()
    .safeParse(req.body);
  if (!input.success) return reply.code(400).send({ error: "INVALID_INPUT" });
  active = true;
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-store",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 85000);
  reply.raw.on("close", () => controller.abort());
  try {
    const result = await collectAudit(input.data.url, {
      allowFixture: true,
      signal: controller.signal,
      onStep: async (step) => {
        reply.raw.write(JSON.stringify({ step }) + "\n");
      },
    });
    reply.raw.write(
      JSON.stringify({
        result: {
          ...result,
          screenshot: result.screenshot?.toString("base64"),
        },
      }) + "\n",
    );
  } catch {
    reply.raw.write(JSON.stringify({ error: "SCANNER_UNAVAILABLE" }) + "\n");
  } finally {
    clearTimeout(timeout);
    active = false;
    reply.raw.end();
  }
});
await app.listen({ host: "0.0.0.0", port: 4100 });
