import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import PDFDocument from "pdfkit";
import type { NextRequest } from "next/server";
import {
  credentials,
  projectInput,
  scanInput,
  sanitizeUrl,
} from "@sonda/contracts";
import { normalizeUrl } from "@sonda/scanner/security";
import { auditHttp } from "./http-audit";
import { nativeStore, ConflictError, type ObjectStore } from "./store";
import type { Report } from "@/lib/api";
const digest = (s: string) => createHash("sha256").update(s).digest("hex"),
  secret = () => randomBytes(32).toString("hex");
const scrypt = promisify(scryptCallback),
  idSchema = z.string().uuid();
type User = { id: string; name: string; email: string };
type StoredUser = User & { passwordHash: string };
type Project = {
  id: string;
  ownerId: string;
  name: string;
  normalizedUrl: string;
  createdAt: string;
  updatedAt: string;
};
type NativeReport = Report & {
  requestedBy: string | null;
  projectId: string | null;
  capabilityHash: string;
  expiresAt: string;
  mode: "HTTP_ONLY";
};
type Share = {
  id: string;
  scanId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
};
class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
async function hashPassword(p: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + ((await scrypt(p, salt, 64)) as Buffer).toString("hex");
}
async function checkPassword(p: string, hash: string) {
  const [salt, key] = hash.split(":");
  const value = (await scrypt(p, salt ?? "dummy-salt", 64)) as Buffer,
    expected = Buffer.from(key ?? "00".repeat(64), "hex");
  return value.length === expected.length && timingSafeEqual(value, expected);
}
const json = (v: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(v, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
export function safeNativeReport(value: NativeReport) {
  const {
    capabilityHash: _capabilityHash,
    requestedBy: _requestedBy,
    expiresAt: _expiresAt,
    ...safe
  } = value;
  return safe;
}
async function mutate<T>(
  store: ObjectStore,
  key: string,
  update: (value: T) => T,
) {
  for (let i = 0; i < 5; i++) {
    const existing = await store.read<T>(key);
    if (!existing)
      throw new HttpError(404, "NOT_FOUND", "Registro não encontrado.");
    const next = update(existing.value);
    try {
      await store.write(key, next, { etag: existing.etag });
      return next;
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  throw new HttpError(
    409,
    "CONFLICT",
    "Uma atualização simultânea ocorreu. Tente novamente.",
  );
}
async function quota(store: ObjectStore, key: string, max: number) {
  for (let i = 0; i < 5; i++) {
    const found = await store.read<{ count: number; expiresAt: string }>(key);
    if ((found?.value.count ?? 0) >= max)
      throw new HttpError(
        429,
        "RATE_LIMIT",
        "Limite de uso atingido. Tente novamente após o período de espera.",
      );
    try {
      await store.write(
        key,
        {
          count: (found?.value.count ?? 0) + 1,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
        { create: !found, etag: found?.etag },
      );
      return;
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  throw new HttpError(429, "RATE_LIMIT", "Muitas solicitações simultâneas.");
}
export async function handleNative(
  request: NextRequest,
  path: string[],
  schedule: (task: () => Promise<void>) => void,
  store: ObjectStore = nativeStore,
) {
  try {
    if (path[0] === "health")
      return json({ status: "ready", publicScans: true, mode: "HTTP_ONLY" });
    const route = path.slice(1),
      method = request.method;
    const actorIp =
      process.env.VERCEL === "1"
        ? (request.headers.get("x-vercel-forwarded-for") ??
          "unknown-vercel-client")
        : "local-development";
    async function user(): Promise<User | null> {
      const token = request.cookies.get("sonda_session")?.value;
      if (!token) return null;
      const session = await store.read<{ user: User; expiresAt: string }>(
        `sessions/${digest(token)}.json`,
      );
      if (!session || new Date(session.value.expiresAt) < new Date())
        return null;
      return session.value.user;
    }
    async function requireUser() {
      const value = await user();
      if (!value)
        throw new HttpError(
          401,
          "LOGIN_REQUIRED",
          "Entre na sua conta para continuar.",
        );
      return value;
    }
    async function authorize(id: string, override?: string) {
      idSchema.parse(id);
      const stored = await store.read<NativeReport>(`scans/${id}.json`);
      if (!stored || new Date(stored.value.expiresAt) < new Date())
        throw new HttpError(
          404,
          "NOT_FOUND",
          "Relatório não encontrado ou expirado.",
        );
      const s = stored.value,
        u = await user(),
        cap =
          override ??
          request.headers.get("authorization")?.replace(/^Bearer /, "") ??
          request.nextUrl.searchParams.get("token");
      async function fresh() {
        if (
          ["QUEUED", "RUNNING"].includes(s.status) &&
          Date.now() - new Date(s.createdAt).getTime() > 90000
        )
          return mutate<NativeReport>(store, `scans/${s.id}.json`, (r) =>
            ["QUEUED", "RUNNING"].includes(r.status)
              ? {
                  ...r,
                  status: "FAILED",
                  errorCode: "INTERRUPTED_JOB",
                  finishedAt: new Date().toISOString(),
                }
              : r,
          );
        return s;
      }
      if (u?.id === s.requestedBy) return fresh();
      if (cap && digest(cap) === s.capabilityHash && !s.requestedBy)
        return fresh();
      if (cap) {
        const shared = await store.read<Share>(`shares/${digest(cap)}.json`);
        if (
          shared?.value.scanId === id &&
          !shared.value.revokedAt &&
          new Date(shared.value.expiresAt) > new Date()
        )
          return fresh();
      }
      throw new HttpError(
        404,
        "NOT_FOUND",
        "Relatório não encontrado ou acesso revogado.",
      );
    }
    async function project(id: string) {
      const u = await requireUser();
      idSchema.parse(id);
      const p = await store.read<Project>(`projects/${u.id}/${id}.json`);
      if (!p) throw new HttpError(404, "NOT_FOUND", "Projeto não encontrado.");
      return p.value;
    }
    async function accountScans(u: User) {
      const keys = await store.keys(`history/${u.id}/`);
      const items = await Promise.all(
        keys.map(async (key) => {
          const ref = await store.read<{ id: string }>(key);
          return ref
            ? store.read<NativeReport>(`scans/${ref.value.id}.json`)
            : null;
        }),
      );
      return items
        .flatMap((s) =>
          s && new Date(s.value.expiresAt) > new Date()
            ? [safeNativeReport(s.value)]
            : [],
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    if (route[0] === "maintenance") {
      const expected = process.env.CRON_SECRET,
        supplied = request.headers
          .get("authorization")
          ?.replace(/^Bearer /, "");
      if (
        !expected ||
        !supplied ||
        supplied.length !== expected.length ||
        !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
      )
        throw new HttpError(401, "UNAUTHORIZED", "Acesso negado.");
      let removed = 0;
      for (const prefix of [
        "scans/",
        "sessions/",
        "budgets/",
        "locks/",
        "shares/",
      ]) {
        for (const key of (await store.keys(prefix)).slice(0, 150)) {
          const record = await store.read<{
            expiresAt?: string;
            requestedBy?: string;
            id?: string;
          }>(key);
          if (
            record?.value.expiresAt &&
            new Date(record.value.expiresAt) < new Date()
          ) {
            await store.remove(key);
            if (
              prefix === "scans/" &&
              record.value.requestedBy &&
              record.value.id
            )
              await store.remove(
                `history/${record.value.requestedBy}/${record.value.id}.json`,
              );
            removed++;
          }
        }
      }
      return json({ removed });
    }
    if (route[0] === "auth") {
      if (route[1] === "me") return json({ user: await user() });
      if (route[1] === "logout" && method === "POST") {
        const token = request.cookies.get("sonda_session")?.value;
        if (token) await store.remove(`sessions/${digest(token)}.json`);
        return json({ ok: true }, 200, {
          "Set-Cookie":
            "sonda_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure",
        });
      }
      if (["register", "login"].includes(route[1]) && method === "POST") {
        await quota(
          store,
          `budgets/auth-${digest(actorIp)}-${new Date().toISOString().slice(0, 10)}.json`,
          20,
        );
        const input = credentials.parse(await request.json()),
          email = input.email.toLowerCase(),
          key = `users/${digest(email)}.json`;
        let record = (await store.read<StoredUser>(key))?.value;
        if (route[1] === "register") {
          if (record)
            throw new HttpError(
              409,
              "ACCOUNT_EXISTS",
              "Não foi possível criar esta conta.",
            );
          record = {
            id: randomUUID(),
            email,
            name: input.name ?? email.split("@")[0],
            passwordHash: await hashPassword(input.password),
          };
          await store.write(key, record, { create: true });
        } else {
          const ok = await checkPassword(
            input.password,
            record?.passwordHash ?? "dummy-salt:" + "00".repeat(64),
          );
          if (!record || !ok)
            throw new HttpError(
              401,
              "INVALID_CREDENTIALS",
              "E-mail ou senha inválidos.",
            );
        }
        const { passwordHash: _passwordHash, ...u } = record;
        const token = secret();
        await store.write(
          `sessions/${digest(token)}.json`,
          {
            user: u,
            expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          },
          { create: true },
        );
        return json({ user: u }, 200, {
          "Set-Cookie": `sonda_session=${token}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
        });
      }
    }
    if (route[0] === "projects") {
      const u = await requireUser();
      if (route.length === 1) {
        if (method === "GET") {
          const keys = await store.keys(`projects/${u.id}/`);
          const scans = await accountScans(u);
          const items = await Promise.all(
            keys.map(async (k) => {
              const p = (await store.read<Project>(k))!.value;
              return {
                ...p,
                _count: {
                  scans: scans.filter((s) => s.projectId === p.id).length,
                },
              };
            }),
          );
          return json({ items });
        }
        if (method === "POST") {
          const input = projectInput.parse(await request.json()),
            url = normalizeUrl(input.url);
          const value: Project = {
            id: randomUUID(),
            ownerId: u.id,
            name: input.name,
            normalizedUrl: sanitizeUrl(url.href),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          await store.write(`projects/${u.id}/${value.id}.json`, value, {
            create: true,
          });
          return json(value, 201);
        }
      }
      const p = await project(route[1]);
      if (route[2] === "scans")
        return json({
          items: (await accountScans(u))
            .filter((s) => s.projectId === p.id)
            .slice(0, 20),
        });
      if (method === "GET") return json(p);
      if (method === "PATCH") {
        const input = projectInput.parse(await request.json()),
          url = normalizeUrl(input.url);
        const next = {
          ...p,
          name: input.name,
          normalizedUrl: sanitizeUrl(url.href),
          updatedAt: new Date().toISOString(),
        };
        await store.write(`projects/${u.id}/${p.id}.json`, next);
        return json(next);
      }
      if (method === "DELETE") {
        await store.remove(`projects/${u.id}/${p.id}.json`);
        return json({ ok: true });
      }
    }
    if (route[0] === "scans") {
      if (route.length === 1 && method === "GET") {
        const u = await requireUser();
        const page = z.coerce
          .number()
          .int()
          .min(1)
          .max(10000)
          .parse(request.nextUrl.searchParams.get("page") ?? 1);
        return json({
          items: (await accountScans(u)).slice((page - 1) * 20, page * 20),
          page,
        });
      }
      if (route.length === 1 && method === "POST") {
        const input = scanInput.parse(await request.json()),
          url = normalizeUrl(input.url),
          u = await user();
        if (input.projectId) await project(input.projectId);
        const actor = u?.id ?? digest(actorIp),
          day = new Date().toISOString().slice(0, 10);
        await quota(store, `budgets/scans-${actor}-${day}.json`, u ? 20 : 3);
        await quota(store, `budgets/ip-${digest(actorIp)}-${day}.json`, 30);
        const lock = `locks/${digest(actor + url.href)}.json`,
          old = await store.read<{ expiresAt: string }>(lock);
        if (old && new Date(old.value.expiresAt) > new Date())
          throw new HttpError(
            409,
            "SCAN_IN_PROGRESS",
            "Já existe um diagnóstico em andamento para este destino.",
          );
        await store.write(
          lock,
          { expiresAt: new Date(Date.now() + 90000).toISOString() },
          { create: !old, etag: old?.etag },
        );
        const id = randomUUID(),
          cap = secret(),
          createdAt = new Date().toISOString();
        const record: NativeReport = {
          id,
          normalizedUrl: sanitizeUrl(url.href),
          status: "QUEUED",
          progress: 0,
          score: null,
          coverage: null,
          createdAt,
          steps: [],
          findings: [],
          resources: [],
          evidence: [],
          context: null,
          requestedBy: u?.id ?? null,
          projectId: input.projectId ?? null,
          capabilityHash: digest(cap),
          expiresAt: new Date(
            Date.now() + (u ? 90 : 7) * 86400000,
          ).toISOString(),
          mode: "HTTP_ONLY",
        };
        await store.write(`scans/${id}.json`, record, { create: true });
        if (u)
          await store.write(
            `history/${u.id}/${id}.json`,
            { id },
            { create: true },
          );
        schedule(async () => {
          const controller = new AbortController(),
            timeout = setTimeout(() => controller.abort(), 45000);
          try {
            await mutate<NativeReport>(store, `scans/${id}.json`, (r) => ({
              ...r,
              status: "RUNNING",
              startedAt: new Date().toISOString(),
            }));
            const result = await auditHttp(
              url.href,
              async (name) => {
                await mutate<NativeReport>(store, `scans/${id}.json`, (r) => {
                  if (r.status === "CANCELLED") {
                    controller.abort();
                    throw Error("CANCELLED");
                  }
                  return {
                    ...r,
                    progress: Math.min(90, r.progress + 9),
                    steps: [
                      ...r.steps,
                      { id: r.steps.length + 1, name, status: "PASS" },
                    ],
                  };
                });
              },
              controller.signal,
            );
            const { browserError: _browserError, ...context } = result.context;
            await mutate<NativeReport>(store, `scans/${id}.json`, (r) =>
              r.status === "CANCELLED"
                ? r
                : {
                    ...r,
                    status: result.context.collected ? "COMPLETED" : "FAILED",
                    progress: 100,
                    finalUrl: result.context.finalUrl,
                    score: result.context.collected
                      ? result.scoring.score
                      : null,
                    coverage: result.scoring.coverage,
                    scoringVersion: result.scoring.version,
                    finishedAt: new Date().toISOString(),
                    errorCode: result.context.collected
                      ? undefined
                      : "HTTP_COLLECTION_FAILED",
                    context,
                    findings: result.findings.map((f) => ({
                      id: randomUUID(),
                      ruleId: f.ruleId,
                      title: f.title,
                      category: f.category,
                      status: f.status,
                      severity: f.severity,
                      description: f.description,
                      recommendation: f.recommendation,
                      evidenceJson: f.evidence,
                      documentationUrl: f.documentationUrl,
                    })),
                    steps: [
                      ...r.steps,
                      {
                        id: r.steps.length + 1,
                        name: "Gerando relatório HTTP",
                        status: "PASS",
                      },
                    ],
                  },
            );
          } catch {
            await mutate<NativeReport>(store, `scans/${id}.json`, (r) =>
              r.status === "CANCELLED"
                ? r
                : {
                    ...r,
                    status: "FAILED",
                    errorCode: controller.signal.aborted
                      ? "TIMEOUT"
                      : "HTTP_SCANNER_FAILED",
                    finishedAt: new Date().toISOString(),
                  },
            ).catch(() => {});
          } finally {
            clearTimeout(timeout);
            await store.remove(lock);
          }
        });
        return json(
          {
            id,
            token: u ? undefined : cap,
            status: "QUEUED",
            mode: "HTTP_ONLY",
          },
          202,
        );
      }
      const scan = await authorize(route[1]);
      if (route[2] === "cancel" && method === "POST") {
        const u = await user(),
          cap =
            request.headers.get("authorization")?.replace(/^Bearer /, "") ??
            request.nextUrl.searchParams.get("token");
        if (
          scan.requestedBy
            ? u?.id !== scan.requestedBy
            : !cap || digest(cap) !== scan.capabilityHash
        )
          throw new HttpError(
            403,
            "FORBIDDEN",
            "Somente o solicitante pode cancelar esta análise.",
          );
        await mutate<NativeReport>(store, `scans/${scan.id}.json`, (r) =>
          ["QUEUED", "RUNNING"].includes(r.status)
            ? {
                ...r,
                status: "CANCELLED",
                finishedAt: new Date().toISOString(),
              }
            : r,
        );
        return json({ ok: true });
      }
      if (route[2] === "shares") {
        const u = await requireUser();
        if (u.id !== scan.requestedBy)
          throw new HttpError(403, "FORBIDDEN", "Acesso negado.");
        if (method === "POST") {
          const cap = secret(),
            value: Share = {
              id: randomUUID(),
              scanId: scan.id,
              tokenHash: digest(cap),
              expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
              revokedAt: null,
            };
          await store.write(`shares/${digest(cap)}.json`, value, {
            create: true,
          });
          await store.write(
            `scan-shares/${scan.id}/${value.id}.json`,
            { key: `shares/${digest(cap)}.json` },
            { create: true },
          );
          return json({ id: value.id, token: cap, expiresAt: value.expiresAt });
        }
        const keys = await store.keys(`scan-shares/${scan.id}/`);
        const shares = await Promise.all(
          keys.map(async (k) => {
            const ref = (await store.read<{ key: string }>(k))?.value;
            return ref ? store.read<Share>(ref.key) : null;
          }),
        );
        if (method === "GET")
          return json({
            items: shares.flatMap((s) =>
              s
                ? [
                    {
                      id: s.value.id,
                      expiresAt: s.value.expiresAt,
                      revokedAt: s.value.revokedAt,
                    },
                  ]
                : [],
            ),
          });
        if (method === "DELETE") {
          const matched = shares.find((s) => s?.value.id === route[3]);
          if (matched)
            await store.write(
              `shares/${matched.value.tokenHash}.json`,
              { ...matched.value, revokedAt: new Date().toISOString() },
              { etag: matched.etag },
            );
          return json({ ok: true });
        }
      }
      if (route[2] === "events") {
        let stopped = false;
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            const encoder = new TextEncoder();
            let last = Number(request.headers.get("last-event-id") ?? 0);
            for (
              let i = 0;
              i < 30 && !stopped && !request.signal.aborted;
              i++
            ) {
              try {
                const current = await authorize(scan.id);
                for (const step of current.steps.filter((s) => s.id > last)) {
                  controller.enqueue(
                    encoder.encode(
                      `id: ${step.id}\nevent: step\ndata: ${JSON.stringify(step)}\n\n`,
                    ),
                  );
                  last = step.id;
                }
                controller.enqueue(
                  encoder.encode(
                    `event: state\ndata: ${JSON.stringify(safeNativeReport(current))}\n\n`,
                  ),
                );
                if (
                  ["COMPLETED", "FAILED", "CANCELLED"].includes(current.status)
                )
                  break;
                await new Promise((resolve) => setTimeout(resolve, 1500));
              } catch {
                break;
              }
            }
            if (!stopped) controller.close();
          },
          cancel() {
            stopped = true;
          },
        });
        return new Response(body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-store",
            "X-Accel-Buffering": "no",
          },
        });
      }
      if (route[2] === "findings") {
        const params = request.nextUrl.searchParams;
        return json({
          items: scan.findings.filter(
            (f) =>
              (!params.get("severity") ||
                f.severity === params.get("severity")) &&
              (!params.get("category") ||
                f.category === params.get("category")) &&
              (!params.get("search") ||
                `${f.ruleId} ${f.title}`
                  .toLowerCase()
                  .includes(params.get("search")!.toLowerCase())),
          ),
          page: 1,
        });
      }
      if (route[2] === "export" && route[3] === "pdf") {
        const document = new PDFDocument({ margin: 48 }),
          chunks: Buffer[] = [];
        const ready = new Promise<Buffer>((resolve) => {
          document.on("data", (chunk: Buffer) => chunks.push(chunk));
          document.on("end", () => resolve(Buffer.concat(chunks)));
        });
        document.fontSize(24).text("SONDA - Diagnostico HTTP");
        document
          .fontSize(10)
          .text(scan.normalizedUrl)
          .text(
            `Status ${scan.status} | Nota ${scan.score ?? "indisponivel"} | Cobertura ${scan.coverage ?? 0}%`,
          )
          .text("Modo HTTP: sem navegador, scripts, axe ou Lighthouse.")
          .moveDown();
        for (const f of scan.findings) {
          document.fontSize(12).text(`${f.ruleId} - ${f.title}`);
          document
            .fontSize(10)
            .text(`${f.status} / ${f.severity}`)
            .text(f.description)
            .text(f.recommendation)
            .moveDown();
        }
        document.end();
        return new Response(new Uint8Array(await ready), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="sonda-${scan.id}.pdf"`,
            "Cache-Control": "private, no-store",
          },
        });
      }
      if (method === "DELETE" && route.length === 2) {
        const u = await requireUser();
        if (u.id !== scan.requestedBy)
          throw new HttpError(403, "FORBIDDEN", "Acesso negado.");
        if (["QUEUED", "RUNNING"].includes(scan.status))
          throw new HttpError(
            409,
            "SCAN_ACTIVE",
            "Cancele o diagnóstico antes de excluir.",
          );
        await store.remove(`scans/${scan.id}.json`);
        await store.remove(`history/${u.id}/${scan.id}.json`);
        for (const key of await store.keys(`scan-shares/${scan.id}/`)) {
          const ref = await store.read<{ key: string }>(key);
          if (ref) await store.remove(ref.value.key);
          await store.remove(key);
        }
        return json({ ok: true });
      }
      if (
        method === "GET" &&
        (!route[2] ||
          route[2] === "report" ||
          (route[2] === "export" && route[3] === "json"))
      )
        return json(
          safeNativeReport(scan),
          200,
          route[2] === "export"
            ? {
                "Content-Disposition": `attachment; filename="sonda-${scan.id}.json"`,
              }
            : {},
        );
    }
    if (route[0] === "comparisons") {
      const params = request.nextUrl.searchParams,
        base = await authorize(
          params.get("base") ?? "",
          params.get("baseToken") ?? undefined,
        ),
        target = await authorize(
          params.get("target") ?? "",
          params.get("targetToken") ?? undefined,
        );
      if (base.normalizedUrl !== target.normalizedUrl)
        throw new HttpError(
          400,
          "DIFFERENT_TARGETS",
          "Compare diagnósticos do mesmo destino.",
        );
      return json({
        base: safeNativeReport(base),
        target: safeNativeReport(target),
        changes: target.findings.map((f) => ({
          ruleId: f.ruleId,
          title: f.title,
          before:
            base.findings.find((v) => v.ruleId === f.ruleId)?.status ??
            "NOT_TESTED",
          after: f.status,
          changed:
            base.findings.find((v) => v.ruleId === f.ruleId)?.status !==
            f.status,
        })),
      });
    }
    throw new HttpError(404, "NOT_FOUND", "Rota não encontrada.");
  } catch (error) {
    if (error instanceof z.ZodError)
      return json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Dados inválidos. Verifique os campos enviados.",
          },
        },
        400,
      );
    if (error instanceof HttpError)
      return json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "DESTINATION_BLOCKED"
    )
      return json(
        { error: { code: "DESTINATION_BLOCKED", message: error.message } },
        400,
      );
    if (error instanceof ConflictError)
      return json(
        {
          error: {
            code: "CONFLICT",
            message: "Solicitação simultânea ou registro já existente.",
          },
        },
        409,
      );
    console.error(
      "Native API unavailable:",
      error instanceof Error ? error.name : "unknown",
    );
    return json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Serviço temporariamente indisponível. Tente novamente.",
        },
      },
      503,
    );
  }
}
