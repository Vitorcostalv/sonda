import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { db } from "@sonda/db";
import { storage } from "@sonda/storage";
import {
  scanInput,
  credentials,
  projectInput,
  sanitizeUrl,
} from "@sonda/contracts";
import { approvedTarget, resolveDestination } from "@sonda/scanner/security";
const scrypt = promisify(scryptCallback);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const uuid = z.string().uuid();
const token = () => randomBytes(32).toString("hex");
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const result = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${result.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(key, "hex");
  return (
    expected.length === derived.length && timingSafeEqual(expected, derived)
  );
}
export async function buildApp() {
  const app = Fastify({
    logger: {
      redact: [
        "req.headers.cookie",
        "req.headers.authorization",
        "req.body.password",
        "req.url",
      ],
      level: process.env.LOG_LEVEL ?? "info",
    },
    bodyLimit: 8192,
    trustProxy: false,
  });
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 1,
  });
  const queue = new Queue("scans", {
    connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" },
  });
  const origin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  await app.register(cookie);
  await app.register(cors, { origin, credentials: true });
  await app.register(helmet);
  await app.register(rateLimit, { redis, max: 60, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: { info: { title: "SONDA API", version: "1.0.0" } },
  });
  if (process.env.NODE_ENV !== "production")
    await app.register(swaggerUi, { routePrefix: "/docs" });
  app.addHook("preHandler", async (req, reply) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin !== origin
    )
      return reply.code(403).send({
        error: { code: "ORIGIN_REJECTED", message: "Origem não autorizada." },
      });
  });
  app.setErrorHandler((error, _req, reply) => {
    const e = error as Error & { statusCode?: number; code?: string };
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Dados inválidos.",
          fields: error.flatten().fieldErrors,
        },
      });
    if (e.code === "DESTINATION_BLOCKED")
      return reply
        .code(400)
        .send({ error: { code: e.code, message: e.message } });
    if (e.statusCode && e.statusCode < 500)
      return reply
        .code(e.statusCode)
        .send({ error: { code: "REQUEST_REJECTED", message: e.message } });
    app.log.error({ code: e.code }, "Request failed");
    return reply.code(503).send({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Serviço temporariamente indisponível.",
      },
    });
  });
  async function user(req: FastifyRequest) {
    const raw = req.cookies.sonda_session;
    if (!raw) return null;
    const session = await db.session.findUnique({
      where: { tokenHash: hash(raw) },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return session && session.expiresAt > new Date() ? session.user : null;
  }
  async function requireUser(req: FastifyRequest) {
    const u = await user(req);
    if (!u)
      throw Object.assign(new Error("Entre na sua conta para continuar."), {
        statusCode: 401,
      });
    return u;
  }
  async function authorizedScan(
    req: FastifyRequest,
    id: string,
    overrideToken?: string,
  ) {
    uuid.parse(id);
    const scan = await db.scan.findUnique({
      where: { id },
      include: { steps: { orderBy: { id: "asc" } } },
    });
    if (!scan || scan.expiresAt < new Date())
      throw Object.assign(new Error("Relatório não encontrado ou expirado."), {
        statusCode: 404,
      });
    const u = await user(req);
    if (u?.id === scan.requestedBy) return scan;
    const query = req.query as Record<string, string>;
    const capability =
      overrideToken ??
      req.headers.authorization?.replace(/^Bearer /, "") ??
      query.token;
    if (
      capability &&
      hash(capability) === scan.capabilityHash &&
      !scan.requestedBy
    )
      return scan;
    if (capability) {
      const share = await db.shareLink.findUnique({
        where: { tokenHash: hash(capability) },
      });
      if (
        share?.scanId === id &&
        !share.revokedAt &&
        share.expiresAt > new Date()
      )
        return scan;
    }
    throw Object.assign(
      new Error("Relatório não encontrado ou acesso revogado."),
      { statusCode: 404 },
    );
  }
  const publicScan = (s: Awaited<ReturnType<typeof authorizedScan>>) => {
    const {
      capabilityHash: _capabilityHash,
      activeKey: _activeKey,
      contextJson: _context,
      ...safe
    } = s;
    return safe;
  };
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_req, reply) => {
    try {
      await db.$queryRaw`SELECT 1`;
      await redis.ping();
      return {
        status: "ready",
        publicScans:
          process.env.PUBLIC_SCANS_ENABLED === "true" &&
          process.env.NETWORK_ISOLATION_VERIFIED === "true",
      };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });
  app.post(
    "/api/v1/auth/register",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const input = credentials.parse(req.body);
      const email = input.email.toLowerCase();
      if (await db.user.findUnique({ where: { email } }))
        return reply.code(409).send({
          error: {
            code: "ACCOUNT_EXISTS",
            message: "Não foi possível criar esta conta.",
          },
        });
      const u = await db.user.create({
        data: {
          email,
          name: input.name ?? email.split("@")[0],
          passwordHash: await passwordHash(input.password),
        },
      });
      const raw = token();
      await db.session.create({
        data: {
          userId: u.id,
          tokenHash: hash(raw),
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      });
      reply.setCookie("sonda_session", raw, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 604800,
      });
      return { user: { id: u.id, name: u.name, email: u.email } };
    },
  );
  app.post(
    "/api/v1/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const input = credentials.parse(req.body);
      const u = await db.user.findUnique({
        where: { email: input.email.toLowerCase() },
      });
      const ok = await verifyPassword(
        input.password,
        u?.passwordHash ??
          "00000000000000000000000000000000:" + "00".repeat(64),
      );
      if (!u || !ok)
        return reply.code(401).send({
          error: {
            code: "INVALID_CREDENTIALS",
            message: "E-mail ou senha inválidos.",
          },
        });
      const raw = token();
      await db.session.create({
        data: {
          userId: u.id,
          tokenHash: hash(raw),
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      });
      reply.setCookie("sonda_session", raw, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 604800,
      });
      return { user: { id: u.id, name: u.name, email: u.email } };
    },
  );
  app.get("/api/v1/auth/me", async (req) => ({ user: await user(req) }));
  app.post("/api/v1/auth/logout", async (req, reply) => {
    if (req.cookies.sonda_session)
      await db.session.deleteMany({
        where: { tokenHash: hash(req.cookies.sonda_session) },
      });
    reply.clearCookie("sonda_session", { path: "/" });
    return { ok: true };
  });
  app.post(
    "/api/v1/scans",
    {
      schema: {
        body: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string", maxLength: 2048 },
            projectId: { type: "string", format: "uuid" },
          },
          additionalProperties: false,
        },
      },
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    },
    async (req, reply) => {
      const input = scanInput.parse(req.body),
        url = approvedTarget(input.url);
      const fixture =
        !!process.env.FIXTURE_URL &&
        url.origin === new URL(process.env.FIXTURE_URL).origin;
      if (
        !fixture &&
        (process.env.PUBLIC_SCANS_ENABLED !== "true" ||
          process.env.NETWORK_ISOLATION_VERIFIED !== "true")
      )
        return reply.code(503).send({
          error: {
            code: "PUBLIC_SCANS_DISABLED",
            message:
              "Diagnósticos públicos aguardam a configuração do scanner com isolamento de rede.",
          },
        });
      if (!fixture) await resolveDestination(url);
      const u = await user(req);
      if (input.projectId) {
        const project = await db.project.findFirst({
          where: {
            id: input.projectId,
            ownerId: u?.id ?? "00000000-0000-0000-0000-000000000000",
          },
        });
        if (!project)
          return reply.code(404).send({
            error: {
              code: "PROJECT_NOT_FOUND",
              message: "Projeto não encontrado.",
            },
          });
      }
      const actor = u?.id ?? hash(req.ip);
      const budgetKey = `scan-budget:${actor}:${new Date().toISOString().slice(0, 10)}`;
      const count = await redis.incr(budgetKey);
      if (count === 1) await redis.expire(budgetKey, 86400);
      if (count > (u ? 20 : 3))
        return reply.code(429).send({
          error: {
            code: "DAILY_LIMIT",
            message: "Limite diário de diagnósticos atingido.",
          },
        });
      const activeKey = hash(`${actor}:${sanitizeUrl(url.href)}`);
      if (await db.scan.findUnique({ where: { activeKey } }))
        return reply.code(409).send({
          error: {
            code: "SCAN_IN_PROGRESS",
            message: "Já existe um diagnóstico em andamento para este destino.",
          },
        });
      const capability = token();
      const scan = await db.scan.create({
        data: {
          originalUrl: sanitizeUrl(url.href),
          normalizedUrl: sanitizeUrl(url.href),
          requestedBy: u?.id,
          projectId: input.projectId,
          capabilityHash: hash(capability),
          activeKey,
          expiresAt: new Date(Date.now() + (u ? 90 : 7) * 86400000),
        },
      });
      try {
        await queue.add(
          "audit",
          { scanId: scan.id },
          {
            jobId: scan.id,
            attempts: 1,
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        );
      } catch {
        await db.scan.update({
          where: { id: scan.id },
          data: {
            status: "FAILED",
            activeKey: null,
            errorCode: "QUEUE_UNAVAILABLE",
            finishedAt: new Date(),
          },
        });
        throw new Error("QUEUE_UNAVAILABLE");
      }
      return reply.code(202).send({
        id: scan.id,
        token: u ? undefined : capability,
        status: "QUEUED",
      });
    },
  );
  app.get("/api/v1/scans", async (req) => {
    const u = await requireUser(req);
    const input = z
      .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
      .parse(req.query);
    const scans = await db.scan.findMany({
      where: { requestedBy: u.id, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      take: 20,
      skip: (input.page - 1) * 20,
      include: { steps: { orderBy: { id: "asc" } } },
    });
    return { items: scans.map(publicScan), page: input.page };
  });
  app.get("/api/v1/scans/:id", async (req) =>
    publicScan(await authorizedScan(req, (req.params as { id: string }).id)),
  );
  app.delete("/api/v1/scans/:id", async (req, reply) => {
    const u = await requireUser(req);
    const s = await authorizedScan(req, (req.params as { id: string }).id);
    if (s.requestedBy !== u.id)
      return reply
        .code(403)
        .send({ error: { code: "FORBIDDEN", message: "Acesso negado." } });
    if (["RUNNING", "QUEUED"].includes(s.status))
      return reply.code(409).send({
        error: {
          code: "SCAN_ACTIVE",
          message: "Cancele o diagnóstico antes de excluir.",
        },
      });
    const files = await db.scanEvidence.findMany({ where: { scanId: s.id } });
    for (const e of files) await storage.delete(e.storageKey);
    await db.scan.delete({ where: { id: s.id } });
    return { ok: true };
  });
  app.post("/api/v1/scans/:id/cancel", async (req) => {
    const s = await authorizedScan(req, (req.params as { id: string }).id);
    await db.scan.updateMany({
      where: { id: s.id, status: { in: ["QUEUED", "RUNNING"] } },
      data: {
        status: "CANCELLED",
        activeKey: null,
        finishedAt: new Date(),
        errorCode: "CANCELLED",
      },
    });
    return { ok: true };
  });
  app.get("/api/v1/scans/:id/events", async (req, reply) => {
    const s = await authorizedScan(req, (req.params as { id: string }).id);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
    });
    let ended = false;
    let busy = false;
    let last = Number(req.headers["last-event-id"] ?? 0);
    const close = () => {
      ended = true;
      clearInterval(timer);
      clearTimeout(lifetime);
      reply.raw.end();
    };
    const send = async () => {
      if (ended || busy) return;
      busy = true;
      try {
        const current = await authorizedScan(req, s.id);
        for (const event of current.steps.filter((step) => step.id > last)) {
          reply.raw.write(
            `id: ${event.id}\nevent: step\ndata: ${JSON.stringify(event)}\n\n`,
          );
          last = event.id;
        }
        reply.raw.write(
          `event: state\ndata: ${JSON.stringify(publicScan(current))}\n\n`,
        );
        if (["COMPLETED", "FAILED", "CANCELLED"].includes(current.status))
          close();
        else reply.raw.write(": heartbeat\n\n");
      } catch {
        close();
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void send(), 1500);
    const lifetime = setTimeout(close, 5 * 60000);
    reply.raw.on("close", close);
    await send();
  });
  app.get("/api/v1/scans/:id/findings", async (req) => {
    const s = await authorizedScan(req, (req.params as { id: string }).id);
    const q = z
      .object({
        severity: z
          .enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"])
          .optional(),
        category: z.string().max(30).optional(),
        search: z.string().max(100).optional(),
        page: z.coerce.number().int().min(1).max(1000).default(1),
      })
      .parse(req.query);
    return {
      items: await db.finding.findMany({
        where: {
          scanId: s.id,
          severity: q.severity,
          category: q.category,
          OR: q.search
            ? [
                { title: { contains: q.search, mode: "insensitive" } },
                { ruleId: { contains: q.search, mode: "insensitive" } },
              ]
            : undefined,
        },
        take: 50,
        skip: (q.page - 1) * 50,
        orderBy: { ruleId: "asc" },
      }),
      page: q.page,
    };
  });
  async function report(req: FastifyRequest) {
    const s = await authorizedScan(req, (req.params as { id: string }).id);
    return {
      ...publicScan(s),
      findings: await db.finding.findMany({
        where: { scanId: s.id },
        orderBy: { ruleId: "asc" },
      }),
      resources: await db.networkResource.findMany({
        where: { scanId: s.id },
        take: 120,
      }),
      evidence: await db.scanEvidence.findMany({
        where: { scanId: s.id },
        select: { id: true, type: true },
      }),
      context: s.contextJson,
    };
  }
  app.get("/api/v1/scans/:id/report", report);
  app.get("/api/v1/scans/:id/export/json", async (req, reply) => {
    const data = await report(req);
    reply.header(
      "Content-Disposition",
      `attachment; filename="sonda-${data.id}.json"`,
    );
    return data;
  });
  app.get("/api/v1/scans/:id/export/pdf", async (req, reply) => {
    const data = await report(req);
    const document = new PDFDocument({ margin: 48 });
    const chunks: Buffer[] = [];
    const ready = new Promise<Buffer>((resolve, reject) => {
      document.on("data", (c: Buffer) => chunks.push(c));
      document.on("end", () => resolve(Buffer.concat(chunks)));
      document.on("error", reject);
    });
    document.fontSize(26).text("SONDA");
    document
      .fontSize(10)
      .text(data.normalizedUrl)
      .text(
        `Status: ${data.status} | Score: ${data.score ?? "indisponivel"} | Cobertura: ${data.coverage ?? 0}%`,
      )
      .moveDown();
    for (const f of data.findings) {
      document.fontSize(13).text(`${f.ruleId} - ${f.title}`);
      document
        .fontSize(10)
        .text(`${f.status} / ${f.severity}`)
        .text(f.description)
        .text(f.recommendation)
        .moveDown();
    }
    document.text(
      "Auditoria passiva de escopo limitado. Ausencia de achados nao comprova seguranca.",
    );
    document.end();
    reply
      .type("application/pdf")
      .header(
        "Content-Disposition",
        `attachment; filename="sonda-${data.id}.pdf"`,
      );
    return await ready;
  });
  app.get("/api/v1/scans/:id/evidence/:evidenceId", async (req, reply) => {
    const params = req.params as { id: string; evidenceId: string };
    const s = await authorizedScan(req, params.id);
    const evidence = await db.scanEvidence.findFirst({
      where: { id: uuid.parse(params.evidenceId), scanId: s.id },
    });
    if (!evidence)
      return reply.code(404).send({
        error: { code: "NOT_FOUND", message: "Evidência não encontrada." },
      });
    return reply
      .type("image/png")
      .header("Cache-Control", "private, no-store")
      .send(await storage.get(evidence.storageKey));
  });
  app.post("/api/v1/scans/:id/shares", async (req) => {
    const u = await requireUser(req),
      s = await authorizedScan(req, (req.params as { id: string }).id);
    if (s.requestedBy !== u.id)
      throw Object.assign(new Error("Acesso negado."), { statusCode: 403 });
    const raw = token();
    const share = await db.shareLink.create({
      data: {
        scanId: s.id,
        tokenHash: hash(raw),
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    return { id: share.id, token: raw, expiresAt: share.expiresAt };
  });
  app.get("/api/v1/scans/:id/shares", async (req) => {
    const u = await requireUser(req),
      s = await authorizedScan(req, (req.params as { id: string }).id);
    if (s.requestedBy !== u.id)
      throw Object.assign(new Error("Acesso negado."), { statusCode: 403 });
    return {
      items: await db.shareLink.findMany({
        where: { scanId: s.id },
        select: { id: true, expiresAt: true, revokedAt: true },
      }),
    };
  });
  app.delete("/api/v1/scans/:id/shares/:shareId", async (req) => {
    const u = await requireUser(req),
      s = await authorizedScan(req, (req.params as { id: string }).id);
    if (s.requestedBy !== u.id)
      throw Object.assign(new Error("Acesso negado."), { statusCode: 403 });
    await db.shareLink.updateMany({
      where: {
        id: uuid.parse((req.params as { shareId: string }).shareId),
        scanId: s.id,
      },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  });
  app.get("/api/v1/projects", async (req) => {
    const u = await requireUser(req);
    const q = z
      .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
      .parse(req.query);
    return {
      items: await db.project.findMany({
        where: { ownerId: u.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        skip: (q.page - 1) * 20,
        include: { _count: { select: { scans: true } } },
      }),
    };
  });
  app.post("/api/v1/projects", async (req) => {
    const u = await requireUser(req),
      input = projectInput.parse(req.body);
    const url = approvedTarget(input.url);
    return db.project.create({
      data: {
        ownerId: u.id,
        name: input.name,
        normalizedUrl: sanitizeUrl(url.href),
      },
    });
  });
  async function project(req: FastifyRequest) {
    const u = await requireUser(req);
    const p = await db.project.findFirst({
      where: {
        id: uuid.parse((req.params as { id: string }).id),
        ownerId: u.id,
      },
    });
    if (!p)
      throw Object.assign(new Error("Projeto não encontrado."), {
        statusCode: 404,
      });
    return p;
  }
  app.get("/api/v1/projects/:id", project);
  app.patch("/api/v1/projects/:id", async (req) => {
    const p = await project(req),
      input = projectInput.parse(req.body);
    return db.project.update({
      where: { id: p.id },
      data: {
        name: input.name,
        normalizedUrl: sanitizeUrl(approvedTarget(input.url).href),
      },
    });
  });
  app.delete("/api/v1/projects/:id", async (req) => {
    const p = await project(req);
    await db.project.delete({ where: { id: p.id } });
    return { ok: true };
  });
  app.get("/api/v1/projects/:id/scans", async (req) => {
    const p = await project(req),
      u = await requireUser(req);
    const q = z
      .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
      .parse(req.query);
    return {
      items: await db.scan
        .findMany({
          where: {
            projectId: p.id,
            requestedBy: u.id,
            expiresAt: { gt: new Date() },
          },
          take: 20,
          skip: (q.page - 1) * 20,
          orderBy: { createdAt: "desc" },
          include: { steps: true },
        })
        .then((scans) => scans.map(publicScan)),
    };
  });
  app.get("/api/v1/comparisons", async (req) => {
    const q = z
      .object({
        base: uuid,
        target: uuid,
        baseToken: z
          .string()
          .regex(/^[a-f\d]{64}$/)
          .optional(),
        targetToken: z
          .string()
          .regex(/^[a-f\d]{64}$/)
          .optional(),
      })
      .parse(req.query);
    const base = await authorizedScan(req, q.base, q.baseToken),
      target = await authorizedScan(req, q.target, q.targetToken);
    if (base.normalizedUrl !== target.normalizedUrl)
      throw Object.assign(new Error("Compare diagnósticos do mesmo destino."), {
        statusCode: 400,
      });
    const [a, b] = await Promise.all([
      db.finding.findMany({ where: { scanId: base.id } }),
      db.finding.findMany({ where: { scanId: target.id } }),
    ]);
    return {
      base: publicScan(base),
      target: publicScan(target),
      changes: b.map((f) => ({
        ruleId: f.ruleId,
        title: f.title,
        before: a.find((x) => x.ruleId === f.ruleId)?.status ?? "NOT_TESTED",
        after: f.status,
        changed: a.find((x) => x.ruleId === f.ruleId)?.status !== f.status,
      })),
    };
  });
  app.addHook("onClose", async () => {
    await queue.close();
    await redis.quit();
  });
  return app;
}
