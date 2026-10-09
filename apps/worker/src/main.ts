import { Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { db, Prisma } from "@sonda/db";
import { storage } from "@sonda/storage";
import type { AuditContext, RuleResult, Score } from "@sonda/contracts";
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const worker = new Worker<{ scanId: string }>(
  "scans",
  async (job) => {
    const s = await db.scan.findUniqueOrThrow({
      where: { id: job.data.scanId },
    });
    if (s.status === "CANCELLED") return;
    await db.scan.update({
      where: { id: s.id },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    const cancellation = setInterval(() => {
      void db.scan
        .findUnique({ where: { id: s.id }, select: { status: true } })
        .then((state) => {
          if (state?.status === "CANCELLED") controller.abort();
        })
        .catch(() => controller.abort());
    }, 1000);
    try {
      await db.scanStep.create({
        data: {
          scanId: s.id,
          name: "Validando URL",
          status: "PASS",
          finishedAt: new Date(),
        },
      });
      const response = await fetch(
        `${process.env.RUNNER_URL ?? "http://localhost:4100"}/audit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.RUNNER_TOKEN ?? ""}`,
          },
          body: JSON.stringify({ url: s.normalizedUrl }),
          signal: controller.signal,
        },
      );
      if (!response.ok || !response.body) throw new Error("RUNNER_UNAVAILABLE");
      let buffer = "",
        result:
          | {
              context: AuditContext;
              findings: RuleResult[];
              scoring: Score;
              screenshot?: string;
            }
          | undefined;
      let progress = 0;
      const decoder = new TextDecoder();
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        if (buffer.length > 10 * 1024 * 1024)
          throw new Error("RESULT_TOO_LARGE");
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const event = JSON.parse(line) as {
            step?: string;
            result?: typeof result;
            error?: string;
          };
          if (event.error) throw new Error(event.error);
          if (event.step) {
            progress = Math.min(95, progress + 7);
            await db.$transaction([
              db.scanStep.create({
                data: {
                  scanId: s.id,
                  name: event.step,
                  status: "PASS",
                  finishedAt: new Date(),
                },
              }),
              db.scan.update({ where: { id: s.id }, data: { progress } }),
            ]);
          }
          if (event.result) result = event.result;
        }
      }
      if (!result) throw new Error("NO_RESULT");
      controller.signal.throwIfAborted();
      let storageKey: string | undefined;
      if (result.screenshot) {
        storageKey = `${randomUUID()}.png`;
        await storage.put(storageKey, Buffer.from(result.screenshot, "base64"));
      }
      const { browserError: _browserError, ...safeContext } = result.context;
      await db.$transaction(async (tx) => {
        const current = await tx.scan.findUniqueOrThrow({
          where: { id: s.id },
        });
        if (current.status === "CANCELLED") throw new Error("CANCELLED");
        await tx.finding.createMany({
          data: result!.findings.map((f) => ({
            scanId: s.id,
            ruleId: f.ruleId,
            category: f.category,
            status: f.status,
            severity: f.severity,
            title: f.title,
            description: f.description,
            evidenceJson: json(f.evidence),
            recommendation: f.recommendation,
            documentationUrl: f.documentationUrl,
            weight: f.weight,
          })),
        });
        await tx.networkResource.createMany({
          data: result!.context.resources.map((r) => ({
            scanId: s.id,
            sanitizedUrl: r.url,
            resourceType: r.type,
            origin: r.origin,
            responseStatus: r.status,
            protocol: r.protocol,
            isThirdParty: r.thirdParty,
          })),
        });
        if (storageKey)
          await tx.scanEvidence.create({
            data: { scanId: s.id, type: "SCREENSHOT", storageKey },
          });
        await tx.scanStep.create({
          data: {
            scanId: s.id,
            name: "Gerando relatório",
            status: "PASS",
            finishedAt: new Date(),
          },
        });
        await tx.scan.update({
          where: { id: s.id },
          data: {
            status: result!.context.collected ? "COMPLETED" : "FAILED",
            progress: 100,
            score: result!.scoring.score,
            coverage: result!.scoring.coverage,
            scoringVersion: result!.scoring.version,
            contextJson: json(safeContext),
            finalUrl: result!.context.finalUrl,
            finishedAt: new Date(),
            activeKey: null,
            errorCode: result!.context.collected ? null : "NAVIGATION_FAILED",
          },
        });
      });
    } catch (error) {
      await db.scan.updateMany({
        where: { id: s.id, status: { not: "CANCELLED" } },
        data: {
          status: "FAILED",
          activeKey: null,
          finishedAt: new Date(),
          errorCode: controller.signal.aborted
            ? "TIMEOUT"
            : error instanceof Error &&
                error.message === "PUBLIC_SCANS_DISABLED"
              ? "PUBLIC_SCANS_DISABLED"
              : "SCANNER_FAILED",
        },
      });
      throw new Error("AUDIT_FAILED");
    } finally {
      clearTimeout(timeout);
      clearInterval(cancellation);
    }
  },
  {
    connection: { url: process.env.REDIS_URL ?? "redis://localhost:6379" },
    concurrency: 1,
    lockDuration: 120000,
  },
);
worker.on("failed", (_job, error) =>
  console.error("Worker job failed:", error.message),
);
async function cleanup() {
  const expired = await db.scan.findMany({
    where: {
      expiresAt: { lt: new Date() },
      status: { notIn: ["QUEUED", "RUNNING"] },
    },
    include: { evidence: true },
    take: 100,
  });
  for (const scan of expired) {
    for (const file of scan.evidence) await storage.delete(file.storageKey);
    await db.scan.delete({ where: { id: scan.id } });
  }
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.scan.updateMany({
    where: {
      status: { in: ["QUEUED", "RUNNING"] },
      createdAt: { lt: new Date(Date.now() - 15 * 60000) },
    },
    data: {
      status: "FAILED",
      activeKey: null,
      errorCode: "STALE_JOB",
      finishedAt: new Date(),
    },
  });
}
const retention = setInterval(
  () => void cleanup().catch(() => console.error("Retention unavailable")),
  3600000,
);
void cleanup().catch(() => console.error("Retention unavailable"));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(retention);
    void worker.close().then(() => db.$disconnect());
  });
