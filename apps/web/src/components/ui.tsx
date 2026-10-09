"use client";
import {
  AlertTriangle,
  LoaderCircle,
  SearchX,
  ChevronDown,
  Download,
  ExternalLink,
} from "lucide-react";
import { useState } from "react";
import type { Finding } from "@/lib/api";
export function ErrorState({ error }: { error: unknown }) {
  return (
    <div role="alert" className="error-state">
      <AlertTriangle size={19} />
      <div>
        <strong>Não foi possível continuar</strong>
        <p>
          {error instanceof Error
            ? error.message
            : "Serviço indisponível. Tente novamente."}
        </p>
      </div>
    </div>
  );
}
export function LoadingState() {
  return (
    <div className="empty-state" role="status">
      <LoaderCircle className="spin" size={28} />
      <p>Consultando dados…</p>
    </div>
  );
}
export function EmptyState({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="empty-state">
      <SearchX size={32} />
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  );
}
export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`badge severity-${severity.toLowerCase()}`}>
      {(
        {
          CRITICAL: "Crítico",
          HIGH: "Alto",
          MEDIUM: "Médio",
          LOW: "Baixo",
          INFO: "Informativo",
        } as Record<string, string>
      )[severity] ?? severity}
    </span>
  );
}
export function CoverageIndicator({ coverage }: { coverage: number | null }) {
  return (
    <div className="coverage">
      <span>
        Cobertura das regras <b>{coverage ?? 0}%</b>
      </span>
      <div>
        <i style={{ width: `${coverage ?? 0}%` }} />
      </div>
      <small>Verificações concluídas, ponderadas pelo peso técnico.</small>
    </div>
  );
}
export function ScoreGauge({ score }: { score: number | null }) {
  return (
    <div
      className="score-gauge"
      style={{ "--score": score ?? 0 } as React.CSSProperties}
    >
      <div>
        <strong>{score ?? "—"}</strong>
        <span>{score === null ? "Indisponível" : "de 100 pontos"}</span>
      </div>
    </div>
  );
}
export function EvidenceViewer({ evidence }: { evidence: unknown }) {
  return (
    <pre className="evidence mono">{JSON.stringify(evidence, null, 2)}</pre>
  );
}
export function FindingCard({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="finding">
      <button
        className="finding-heading"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span
          className={`rule-status ${finding.status === "PASS" ? "pass" : ["FAIL", "WARN"].includes(finding.status) ? "warn" : "neutral"}`}
        >
          {finding.status}
        </span>
        <span className="finding-title">
          <small className="mono">
            {finding.ruleId} · {finding.category}
          </small>
          <strong>{finding.title}</strong>
        </span>
        <SeverityBadge severity={finding.severity} />
        <ChevronDown size={18} className={open ? "rotated" : ""} />
      </button>
      {open && (
        <div className="finding-detail">
          <p>{finding.description}</p>
          <h4>Recomendação</h4>
          <p>{finding.recommendation}</p>
          <h4>Evidência observada</h4>
          <EvidenceViewer evidence={finding.evidenceJson} />
          <a href={finding.documentationUrl} target="_blank" rel="noreferrer">
            Documentação da regra <ExternalLink size={13} />
          </a>
        </div>
      )}
    </article>
  );
}
export function ExportMenu({ id, query }: { id: string; query: string }) {
  return (
    <div className="export-menu">
      <a
        className="button secondary small"
        href={`/api/v1/scans/${id}/export/json${query}`}
      >
        <Download size={15} />
        JSON
      </a>
      <a
        className="button secondary small"
        href={`/api/v1/scans/${id}/export/pdf${query}`}
      >
        <Download size={15} />
        PDF
      </a>
    </div>
  );
}
