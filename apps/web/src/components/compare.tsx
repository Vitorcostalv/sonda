"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, scanToken, type Scan } from "@/lib/api";
import { ErrorState } from "./ui";
export function CompareView() {
  const params = useSearchParams();
  const [data, setData] = useState<{
    base: Scan;
    target: Scan;
    changes: {
      ruleId: string;
      title: string;
      before: string;
      after: string;
      changed: boolean;
    }[];
  }>();
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  return (
    <div className="page-content">
      <div className="page-title">
        <div>
          <span className="section-kicker mono">ANÁLISE COMPARATIVA</span>
          <h1>O que mudou?</h1>
          <p>
            Compare duas análises autorizadas do mesmo website, regra por regra.
          </p>
        </div>
      </div>
      <form
        className="panel form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(undefined);
          const form = new FormData(e.currentTarget),
            base = String(form.get("base")),
            target = String(form.get("target"));
          try {
            const a = scanToken(base),
              b = scanToken(target);
            setData(
              await api(
                `/comparisons?base=${encodeURIComponent(base)}&target=${encodeURIComponent(target)}${a ? `&baseToken=${a}` : ""}${b ? `&targetToken=${b}` : ""}`,
              ),
            );
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          ID da análise anterior
          <input name="base" required placeholder="UUID da análise base" />
        </label>
        <label>
          ID da análise atual
          <input
            name="target"
            required
            defaultValue={params.get("target") ?? ""}
            placeholder="UUID da análise atual"
          />
        </label>
        <button className="button primary" disabled={busy}>
          {busy ? "Consultando…" : "Comparar resultados"}
        </button>
      </form>
      {Boolean(error) && <ErrorState error={error} />}{" "}
      {data && (
        <div className="panel">
          <h2>
            Nota {data.base.score ?? "—"} → {data.target.score ?? "—"}
          </h2>
          <p>
            Cobertura: {data.base.coverage ?? 0}% → {data.target.coverage ?? 0}%
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Regra</th>
                  <th>Antes</th>
                  <th>Depois</th>
                  <th>Alteração</th>
                </tr>
              </thead>
              <tbody>
                {data.changes.map((change) => (
                  <tr key={change.ruleId}>
                    <td>
                      {change.ruleId} · {change.title}
                    </td>
                    <td>{change.before}</td>
                    <td>{change.after}</td>
                    <td className={change.changed ? "mint" : ""}>
                      {change.changed ? "Alterado" : "Sem alteração"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
