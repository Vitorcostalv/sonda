"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { ArrowRight, Plus, Trash2, LoaderCircle } from "lucide-react";
import { api, type Scan } from "@/lib/api";
import { ErrorState, LoadingState, EmptyState } from "./ui";
type User = { id: string; name: string; email: string };
export function Login() {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const router = useRouter(),
    client = useQueryClient();
  return (
    <div className="page-content">
      <div className="panel auth-panel">
        <span className="section-kicker mono">SEU OBSERVATÓRIO</span>
        <h1>{register ? "Crie sua conta." : "Bem-vindo de volta."}</h1>
        <p>
          Salve projetos, consulte o histórico e controle o acesso aos
          relatórios.
        </p>
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(undefined);
            const form = new FormData(e.currentTarget);
            try {
              await api(`/auth/${register ? "register" : "login"}`, {
                method: "POST",
                body: JSON.stringify({
                  email: form.get("email"),
                  password: form.get("password"),
                  ...(register ? { name: form.get("name") } : {}),
                }),
              });
              await client.invalidateQueries({ queryKey: ["me"] });
              router.push("/dashboard");
            } catch (error) {
              setError(error);
            } finally {
              setBusy(false);
            }
          }}
        >
          {register && (
            <label>
              Nome
              <input name="name" required maxLength={80} autoComplete="name" />
            </label>
          )}
          <label>
            E-mail
            <input type="email" name="email" required autoComplete="email" />
          </label>
          <label>
            Senha
            <input
              type="password"
              name="password"
              minLength={12}
              maxLength={128}
              required
              autoComplete={register ? "new-password" : "current-password"}
            />
          </label>
          <p>Use no mínimo 12 caracteres.</p>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : register ? (
              "Criar conta"
            ) : (
              "Entrar"
            )}
            <ArrowRight size={16} />
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setRegister(!register);
              setError(undefined);
            }}
          >
            {register ? "Já tenho uma conta" : "Ainda não tenho uma conta"}
          </button>
        </form>
        {Boolean(error) && <ErrorState error={error} />}
      </div>
    </div>
  );
}
function NeedLogin() {
  return (
    <div className="panel">
      <h2>Seu histórico começa aqui.</h2>
      <p>Entre para guardar projetos e consultar seus diagnósticos.</p>
      <div className="action-row">
        <Link className="button primary" href="/login">
          Entrar na conta <ArrowRight size={15} />
        </Link>
        <Link className="button secondary" href="/">
          Analisar sem conta
        </Link>
      </div>
    </div>
  );
}
export function ScanHistory({
  scans,
  onDelete,
}: {
  scans: Scan[];
  onDelete?: (id: string) => Promise<void>;
}) {
  return (
    <div>
      {scans.map((scan) => (
        <div className="history-row" key={scan.id}>
          <Link
            href={
              ["QUEUED", "RUNNING"].includes(scan.status)
                ? `/scan/${scan.id}`
                : `/reports/${scan.id}`
            }
          >
            <h3>{scan.normalizedUrl}</h3>
            <p>
              {new Date(scan.createdAt).toLocaleString("pt-BR")} · {scan.status}
            </p>
          </Link>
          <div className="action-row" style={{ marginTop: 0 }}>
            <span className="badge">
              Nota {scan.score ?? "—"} · {scan.coverage ?? 0}% cobertura
            </span>
            {onDelete && !["QUEUED", "RUNNING"].includes(scan.status) && (
              <button
                className="icon-button"
                aria-label={`Excluir análise de ${scan.normalizedUrl}`}
                onClick={() => void onDelete(scan.id)}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
export function Dashboard() {
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: User | null }>("/auth/me"),
    retry: false,
  });
  const query = useQuery({
    queryKey: ["scans", page],
    queryFn: () => api<{ items: Scan[] }>(`/scans?page=${page}`),
    enabled: !!me.data?.user,
    retry: false,
  });
  const [error, setError] = useState<unknown>();
  return (
    <div className="page-content">
      <div className="page-title">
        <div>
          <span className="section-kicker mono">WORKSPACE / VISÃO GERAL</span>
          <h1>Seu campo de observação.</h1>
          <p>Diagnósticos reais, organizados em um só lugar.</p>
        </div>
        <Link className="button primary" href="/">
          Novo diagnóstico <Plus size={16} />
        </Link>
      </div>
      {me.isLoading ? (
        <LoadingState />
      ) : me.error ? (
        <ErrorState error={me.error} />
      ) : !me.data?.user ? (
        <NeedLogin />
      ) : query.isLoading ? (
        <LoadingState />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : (
        <>
          <div className="summary-grid">
            <div className="summary-stat">
              <small>Análises nesta página</small>
              <strong>{query.data?.items.length ?? 0}</strong>
            </div>
            <div className="summary-stat">
              <small>Diagnósticos concluídos nesta página</small>
              <strong>
                {query.data?.items.filter((s) => s.status === "COMPLETED")
                  .length ?? 0}
              </strong>
            </div>
            <div className="summary-stat">
              <small>Última nota disponível</small>
              <strong>
                {query.data?.items.find((s) => s.score !== null)?.score ?? "—"}
              </strong>
            </div>
          </div>
          {!!query.data?.items.some((s) => s.score !== null) && (
            <div className="panel">
              <h2>Notas técnicas no tempo</h2>
              <div className="chart">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={query.data.items
                      .filter((s) => s.score !== null)
                      .slice()
                      .reverse()
                      .map((s) => ({
                        date: new Date(s.createdAt).toLocaleDateString("pt-BR"),
                        score: s.score,
                      }))}
                  >
                    <XAxis dataKey="date" stroke="#91a4b3" fontSize={10} />
                    <YAxis domain={[0, 100]} stroke="#91a4b3" fontSize={10} />
                    <Tooltip
                      contentStyle={{
                        background: "#111a22",
                        borderColor: "#2a3946",
                        color: "#e8f0f5",
                      }}
                    />
                    <Area dataKey="score" stroke="#42d6c4" fill="#42d6c418" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <div className="panel">
            <h2>Histórico de diagnósticos</h2>
            {query.data?.items.length ? (
              <ScanHistory
                scans={query.data.items}
                onDelete={async (id) => {
                  try {
                    await api(`/scans/${id}`, { method: "DELETE" });
                    await client.invalidateQueries({ queryKey: ["scans"] });
                  } catch (e) {
                    setError(e);
                  }
                }}
              />
            ) : (
              <EmptyState
                title="Nenhuma análise por aqui"
                message="Inicie um diagnóstico para registrar os primeiros sinais."
              />
            )}
            <div className="action-row">
              <button
                className="button secondary small"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Anterior
              </button>
              <span className="mono">Página {page}</span>
              <button
                className="button secondary small"
                disabled={(query.data?.items.length ?? 0) < 20}
                onClick={() => setPage(page + 1)}
              >
                Próxima
              </button>
            </div>
            {Boolean(error) && <ErrorState error={error} />}
          </div>
        </>
      )}
    </div>
  );
}
type Project = {
  id: string;
  name: string;
  normalizedUrl: string;
  _count: { scans: number };
};
export function Projects() {
  const client = useQueryClient();
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<{ items: Project[] }>("/projects"),
    retry: false,
  });
  return (
    <div className="page-content">
      <div className="page-title">
        <div>
          <span className="section-kicker mono">WORKSPACE / PROJETOS</span>
          <h1>Destinos sob observação.</h1>
          <p>Organize websites e mantenha um histórico por projeto.</p>
        </div>
      </div>
      {query.isLoading ? (
        <LoadingState />
      ) : query.error ? (
        <>
          <ErrorState error={query.error} />
          <Link className="button primary" href="/login">
            Entrar
          </Link>
        </>
      ) : (
        <>
          <form
            className="panel form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(undefined);
              const form = new FormData(e.currentTarget);
              const element = e.currentTarget;
              try {
                await api("/projects", {
                  method: "POST",
                  body: JSON.stringify({
                    name: form.get("name"),
                    url: form.get("url"),
                  }),
                });
                element.reset();
                await client.invalidateQueries({ queryKey: ["projects"] });
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>Novo projeto</h2>
            <label>
              Nome
              <input
                name="name"
                required
                maxLength={100}
                placeholder="Meu website"
              />
            </label>
            <label>
              URL pública
              <input name="url" required placeholder="https://seusite.com.br" />
            </label>
            <button className="button primary" disabled={busy}>
              Salvar projeto <Plus size={16} />
            </button>
            {Boolean(error) && <ErrorState error={error} />}
          </form>
          <div className="project-grid">
            {query.data?.items.map((project) => (
              <Link
                className="panel project-card"
                key={project.id}
                href={`/projects/${project.id}`}
              >
                <h2>{project.name}</h2>
                <p className="mono">{project.normalizedUrl}</p>
                <small>
                  {project._count.scans} diagnósticos{" "}
                  <ArrowRight size={12} style={{ display: "inline" }} />
                </small>
              </Link>
            ))}
          </div>
          {!query.data?.items.length && (
            <EmptyState
              title="Nenhum projeto salvo"
              message="Adicione uma URL para criar o seu primeiro projeto."
            />
          )}
        </>
      )}
    </div>
  );
}
export function ProjectDetail({ id }: { id: string }) {
  const router = useRouter();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["project", id],
    queryFn: () => api<Project>(`/projects/${id}`),
    retry: false,
  });
  const scans = useQuery({
    queryKey: ["project-scans", id],
    queryFn: () => api<{ items: Scan[] }>(`/projects/${id}/scans`),
    enabled: !!query.data,
    retry: false,
  });
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false);
  if (query.isLoading) return <LoadingState />;
  if (query.error)
    return (
      <div className="page-content">
        <ErrorState error={query.error} />
      </div>
    );
  const project = query.data;
  if (!project) return null;
  return (
    <div className="page-content">
      <div className="page-title">
        <div>
          <span className="section-kicker mono">HISTÓRICO DO PROJETO</span>
          <h1>{project.name}</h1>
          <p className="mono">{project.normalizedUrl}</p>
        </div>
        <button
          className="button primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await api<{ id: string }>("/scans", {
                method: "POST",
                body: JSON.stringify({
                  url: project.normalizedUrl,
                  projectId: id,
                }),
              });
              router.push(`/scan/${result.id}`);
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Novo diagnóstico <Plus size={16} />
        </button>
      </div>
      <div className="action-row">
        <button
          className="button secondary small"
          onClick={() => setEditing(!editing)}
        >
          Editar projeto
        </button>
        <button
          className="button secondary small danger-button"
          onClick={async () => {
            try {
              await api(`/projects/${id}`, { method: "DELETE" });
              await client.invalidateQueries({ queryKey: ["projects"] });
              router.push("/projects");
            } catch (e) {
              setError(e);
            }
          }}
        >
          Excluir projeto
        </button>
      </div>
      {editing && (
        <form
          className="panel form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            try {
              await api(`/projects/${id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  name: data.get("name"),
                  url: data.get("url"),
                }),
              });
              await query.refetch();
              setEditing(false);
            } catch (e) {
              setError(e);
            }
          }}
        >
          <label>
            Nome
            <input name="name" defaultValue={project.name} required />
          </label>
          <label>
            URL
            <input name="url" defaultValue={project.normalizedUrl} required />
          </label>
          <button className="button primary">Salvar alterações</button>
        </form>
      )}
      {Boolean(error) && <ErrorState error={error} />}
      <div className="panel">
        <h2>Análises anteriores</h2>
        {scans.isLoading ? (
          <LoadingState />
        ) : scans.error ? (
          <ErrorState error={scans.error} />
        ) : scans.data?.items.length ? (
          <ScanHistory scans={scans.data.items} />
        ) : (
          <EmptyState
            title="Ainda sem diagnósticos"
            message="Inicie a primeira análise deste projeto."
          />
        )}
      </div>
    </div>
  );
}
export function Settings() {
  const router = useRouter(),
    client = useQueryClient();
  const [error, setError] = useState<unknown>();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: User | null }>("/auth/me"),
    retry: false,
  });
  return (
    <div className="page-content">
      <div className="page-title">
        <div>
          <span className="section-kicker mono">WORKSPACE / CONFIGURAÇÕES</span>
          <h1>Controle e transparência.</h1>
        </div>
      </div>
      <div className="panel">
        <h2>Sua conta</h2>
        {me.isLoading ? (
          <LoadingState />
        ) : me.error ? (
          <ErrorState error={me.error} />
        ) : me.data?.user ? (
          <>
            <p>
              {me.data.user.name} · {me.data.user.email}
            </p>
            <div className="action-row">
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await api("/auth/logout", { method: "POST" });
                    client.clear();
                    router.push("/");
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                Sair da conta
              </button>
            </div>
          </>
        ) : (
          <NeedLogin />
        )}
        {Boolean(error) && <ErrorState error={error} />}
      </div>
      <div className="panel">
        <h2>Retenção e privacidade</h2>
        <p>
          Relatórios anônimos expiram em 7 dias. Relatórios da conta expiram em
          90 dias. Links compartilhados expiram em 7 dias e podem ser revogados
          no relatório. Exclua seus diagnósticos no dashboard. Cookies são
          registrados apenas como metadados, sem valores.
        </p>
      </div>
      <div className="panel">
        <h2>Limites do diagnóstico</h2>
        <p>
          O scanner observa uma página pública, com até 120 requests, no máximo
          8 navegações e 90 segundos por trabalho. Formulários, autenticação e
          requisições de escrita são bloqueados. Scans públicos dependem de uma
          barreira externa de rede verificada.
        </p>
      </div>
    </div>
  );
}
