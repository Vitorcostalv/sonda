"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ImageIcon, Share2 } from "lucide-react";
import { api, tokenQuery, type Report as ReportData } from "@/lib/api";
import {
  ErrorState,
  LoadingState,
  EmptyState,
  ScoreGauge,
  CoverageIndicator,
  FindingCard,
  ExportMenu,
  EvidenceViewer,
} from "./ui";
export function Report({
  id,
  securityOnly = false,
}: {
  id: string;
  securityOnly?: boolean;
}) {
  const params = useSearchParams();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const token = params.get("token");
    if (token && /^[a-f\d]{64}$/.test(token)) {
      sessionStorage.setItem(`sonda:${id}`, token);
      window.history.replaceState({}, "", window.location.pathname);
    }
    setReady(true);
  }, [id, params]);
  const query = useQuery({
    queryKey: ["report", id],
    queryFn: () => api<ReportData>(`/scans/${id}/report${tokenQuery(id)}`),
    enabled: ready,
    retry: false,
  });
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState(securityOnly ? "security" : "");
  const [share, setShare] = useState("");
  const [actionError, setActionError] = useState<unknown>();
  const [links, setLinks] = useState<
    { id: string; revokedAt: string | null; expiresAt: string }[]
  >([]);
  if (query.isLoading || !ready) return <LoadingState />;
  if (query.error)
    return (
      <div className="page-content">
        <ErrorState error={query.error} />
        <Link className="button secondary" href="/">
          Voltar ao início
        </Link>
      </div>
    );
  const r = query.data;
  if (!r) return null;
  const findings = r.findings.filter(
    (f) =>
      (!severity || f.severity === severity) &&
      (!category ||
        (category === "security"
          ? f.ruleId.startsWith("SEC-")
          : f.category === category)) &&
      (!search ||
        `${f.title} ${f.ruleId}`.toLowerCase().includes(search.toLowerCase())),
  );
  const duration =
    r.startedAt && r.finishedAt
      ? Math.round(
          (new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) /
            1000,
        )
      : null;
  return (
    <div className="page-content">
      <div className="page-title">
        <div>
          <span className="section-kicker mono">
            RELATÓRIO TÉCNICO · {r.status}
          </span>
          <h1>O que encontramos.</h1>
          <p className="mono">{r.normalizedUrl}</p>
          <p>
            {new Date(r.createdAt).toLocaleString("pt-BR")}
            {duration !== null && ` · ${duration}s de análise`} ·{" "}
            {r.scoringVersion ?? "Nota não calculada"}
          </p>
        </div>
        <ExportMenu id={id} query={tokenQuery(id)} />
      </div>
      {r.status !== "COMPLETED" && (
        <div className="notice">
          Esta análise não foi concluída. Dados ausentes e verificações
          inconclusivas não equivalem a resultados aprovados.
        </div>
      )}
      <div className="report-overview">
        <div className="panel score-panel">
          <ScoreGauge score={r.status === "COMPLETED" ? r.score : null} />
          <div className="score-copy">
            <h2>Nota técnica de segurança</h2>
            <p>
              Média ponderada das regras aplicáveis. Não representa
              probabilidade de proteção contra ataques.
            </p>
            <CoverageIndicator coverage={r.coverage} />
          </div>
        </div>
        <div className="panel screenshot-panel">
          {r.evidence[0] ? (
            <img
              alt="Captura real da página pública analisada"
              src={`/api/v1/scans/${id}/evidence/${r.evidence[0].id}${tokenQuery(id)}`}
            />
          ) : (
            <EmptyState
              title="Captura indisponível"
              message="O scanner não produziu uma evidência visual nesta análise."
            />
          )}
        </div>
      </div>
      <div className="category-summary">
        {["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].map((level) => (
          <span key={level}>
            {level}:{" "}
            {
              r.findings.filter(
                (f) =>
                  f.severity === level && ["FAIL", "WARN"].includes(f.status),
              ).length
            }
          </span>
        ))}
      </div>
      <div className="action-row">
        <Link
          href={`/reports/${id}/security`}
          className="button secondary small"
        >
          Segurança detalhada
        </Link>
        <Link href={`/compare?target=${id}`} className="button secondary small">
          Comparar com outra análise
        </Link>
        <button
          className="button secondary small"
          onClick={async () => {
            try {
              const result = await api<{ token: string }>(
                `/scans/${id}/shares`,
                { method: "POST" },
              );
              setShare(
                `${location.origin}/reports/${id}?token=${result.token}`,
              );
              const list = await api<{ items: typeof links }>(
                `/scans/${id}/shares`,
              );
              setLinks(list.items);
            } catch (e) {
              setActionError(e);
            }
          }}
        >
          <Share2 size={14} />
          Criar link por 7 dias
        </button>
        <button
          className="button secondary small"
          onClick={async () => {
            try {
              const list = await api<{ items: typeof links }>(
                `/scans/${id}/shares`,
              );
              setLinks(list.items);
            } catch (e) {
              setActionError(e);
            }
          }}
        >
          Gerenciar links
        </button>
      </div>
      {share && (
        <div className="notice">
          <span>Link de acesso: </span>
          <input
            aria-label="Link de compartilhamento"
            readOnly
            value={share}
            onFocus={(e) => e.target.select()}
            style={{
              width: "100%",
              background: "transparent",
              border: 0,
              color: "var(--accent)",
            }}
          />
        </div>
      )}
      {links.length > 0 && (
        <div className="panel">
          {links.map((link) => (
            <div key={link.id} className="share-row">
              <span className="mono">
                {link.revokedAt
                  ? "Revogado"
                  : `Expira ${new Date(link.expiresAt).toLocaleDateString("pt-BR")}`}
              </span>
              {!link.revokedAt && (
                <button
                  className="link-button"
                  onClick={async () => {
                    try {
                      await api(`/scans/${id}/shares/${link.id}`, {
                        method: "DELETE",
                      });
                      setLinks(
                        links.map((l) =>
                          l.id === link.id
                            ? { ...l, revokedAt: new Date().toISOString() }
                            : l,
                        ),
                      );
                      setShare("");
                    } catch (e) {
                      setActionError(e);
                    }
                  }}
                >
                  Revogar acesso
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {Boolean(actionError) && <ErrorState error={actionError} />}
      <h2 className="section-subtitle">
        Achados e verificações{" "}
        <span className="mono muted">/ {findings.length}</span>
      </h2>
      <div className="filter-row">
        <label className="sr-only" htmlFor="finding-search">
          Pesquisar achados
        </label>
        <input
          id="finding-search"
          placeholder="Pesquisar por regra ou título…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Filtrar severidade"
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
        >
          <option value="">Todas as severidades</option>
          {["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Filtrar categoria"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">Todas as categorias</option>
          <option value="security">Segurança</option>
          {[
            "transport",
            "headers",
            "cookies",
            "resources",
            "privacy",
            "accessibility",
            "performance",
            "seo",
          ].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      {findings.map((f) => (
        <FindingCard key={f.id} finding={f} />
      ))}
      {!findings.length && (
        <EmptyState
          title="Nenhum resultado neste filtro"
          message="Ajuste os filtros para consultar outras verificações."
        />
      )}
      {!securityOnly && (
        <>
          <section className="panel">
            <h2>Recursos de rede observados</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Recurso</th>
                    <th>Tipo</th>
                    <th>HTTP</th>
                    <th>Terceiro</th>
                  </tr>
                </thead>
                <tbody>
                  {r.resources.map((resource, i) => (
                    <tr key={i}>
                      <td className="mono">{resource.sanitizedUrl}</td>
                      <td>{resource.resourceType}</td>
                      <td>{resource.responseStatus ?? "—"}</td>
                      <td>{resource.isThirdParty ? "Sim" : "Não"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!r.resources.length && <p>Nenhum recurso foi coletado.</p>}
          </section>
          <section className="panel">
            <h2>Cookies · metadados minimizados</h2>
            <EvidenceViewer evidence={r.context?.cookies ?? []} />
          </section>
          <section className="panel">
            <h2>Cadeia de redirecionamentos</h2>
            <EvidenceViewer evidence={r.context?.redirects ?? []} />
          </section>
        </>
      )}
      <div className="notice">
        <ImageIcon
          size={15}
          style={{ verticalAlign: "middle", marginRight: 8 }}
        />{" "}
        Uma página pública, sem autenticação ou interação. Nenhum valor de
        cookie é armazenado. Ausência de achados não comprova segurança.
      </div>
    </div>
  );
}
