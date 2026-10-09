"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Radio, ArrowRight } from "lucide-react";
import { api, tokenQuery, type Scan } from "@/lib/api";
import { ErrorState, LoadingState } from "./ui";
export function ScanProgress({ id }: { id: string }) {
  const router = useRouter();
  const [streamState, setStreamState] = useState<Scan>();
  const [connected, setConnected] = useState(false);
  const [actionError, setActionError] = useState<unknown>();
  const query = useQuery({
    queryKey: ["scan", id],
    queryFn: () => api<Scan>(`/scans/${id}${tokenQuery(id)}`),
    retry: false,
  });
  useEffect(() => {
    const stream = new EventSource(
      `/api/v1/scans/${id}/events${tokenQuery(id)}`,
    );
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.addEventListener("state", (event) => {
      const state = JSON.parse((event as MessageEvent).data) as Scan;
      setStreamState(state);
      if (state.status === "COMPLETED") {
        stream.close();
        router.replace(`/reports/${id}`);
      }
      if (["FAILED", "CANCELLED"].includes(state.status)) stream.close();
    });
    return () => stream.close();
  }, [id, router]);
  if (query.isLoading) return <LoadingState />;
  if (query.error)
    return (
      <div className="page-content">
        <ErrorState error={query.error} />
      </div>
    );
  const scan = streamState ?? query.data;
  if (!scan) return null;
  return (
    <div className="page-content">
      <div className="page-title">
        <div>
          <span className="section-kicker mono">OBSERVAÇÃO EM TEMPO REAL</span>
          <h1>Seguindo os sinais.</h1>
          <p className="mono">{scan.normalizedUrl}</p>
        </div>
        <span className="outline-tag">
          <Radio size={14} />
          {connected ? "Conectado via SSE" : "Reconectando ao scanner"}
        </span>
      </div>
      <div className="panel">
        <div className="progress-header">
          <strong>{scan.status}</strong>
          <span className="mono">{scan.progress}%</span>
        </div>
        <div className="progress-bar">
          <i style={{ width: `${scan.progress}%` }} />
        </div>
        <ul className="timeline">
          {scan.steps.map((s) => (
            <li key={s.id}>
              <CheckCircle2 size={17} />
              {s.name}
              <span className="mono">{s.status}</span>
            </li>
          ))}
        </ul>
        {!scan.steps.length && (
          <p className="connection-note">
            Diagnóstico aguardando um worker disponível.
          </p>
        )}
        {["FAILED", "CANCELLED"].includes(scan.status) && (
          <ErrorState
            error={
              new Error(
                scan.status === "CANCELLED"
                  ? "Diagnóstico cancelado."
                  : `O scanner não concluiu a navegação (${scan.errorCode ?? "SCANNER_FAILED"}). Nenhuma aprovação é presumida.`,
              )
            }
          />
        )}
        <div className="action-row">
          {["QUEUED", "RUNNING"].includes(scan.status) && (
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  await api(`/scans/${id}/cancel${tokenQuery(id)}`, {
                    method: "POST",
                  });
                  await query.refetch();
                } catch (e) {
                  setActionError(e);
                }
              }}
            >
              Cancelar diagnóstico
            </button>
          )}
          {["COMPLETED", "FAILED"].includes(scan.status) && (
            <Link className="button primary" href={`/reports/${id}`}>
              Abrir relatório <ArrowRight size={16} />
            </Link>
          )}
          <Link className="button secondary" href="/">
            Novo diagnóstico
          </Link>
        </div>
        {Boolean(actionError) && <ErrorState error={actionError} />}
      </div>
      <div className="notice">
        Etapas e eventos vêm do backend e podem ser recuperados após reconexão.
        Uma etapa concluída indica coleta executada; o resultado de cada regra
        aparece no relatório.
      </div>
    </div>
  );
}
