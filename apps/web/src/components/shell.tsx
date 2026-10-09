"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Radar,
  ScanLine,
  LayoutDashboard,
  FolderKanban,
  GitCompareArrows,
  Settings2,
  ArrowUpRight,
  Menu,
  X,
  ShieldCheck,
  Activity,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
const links = [
  { href: "/", label: "Novo diagnóstico", icon: ScanLine },
  { href: "/dashboard", label: "Visão geral", icon: LayoutDashboard },
  { href: "/projects", label: "Meus projetos", icon: FolderKanban },
  { href: "/compare", label: "Comparar análises", icon: GitCompareArrows },
];
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: { name: string } | null }>("/auth/me"),
    retry: false,
  });
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const r = await fetch("/api/health/ready");
      if (!r.ok) throw Error("offline");
      return r.json() as Promise<{
        status: string;
        publicScans: boolean;
        mode?: string;
      }>;
    },
    retry: false,
  });
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Ir para o conteúdo
      </a>
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <Link href="/" className="brand" aria-label="SONDA início">
          <Radar size={32} strokeWidth={1.5} />
          <span>
            SONDA<span className="brand-dot">.</span>
          </span>
        </Link>
        <div className="sidebar-label">OBSERVATÓRIO DIGITAL</div>
        <div className="workspace">
          <span className="workspace-icon">S</span>
          <div>
            Workspace pessoal
            <small>{data?.user?.name ?? "Acesso público"}</small>
          </div>
          <span className="workspace-label">01</span>
        </div>
        <div className="nav-label">EXPLORAR</div>
        <nav>
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`nav-link ${path === href ? "active" : ""}`}
            >
              <Icon size={18} />
              {label}
              {path === href && <span className="active-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="passive-note">
            <ShieldCheck size={19} />
            <strong>Observação, sem exploração.</strong>
            <p>
              Verificações passivas.
              <br />
              Nenhuma alteração no seu site.
            </p>
          </div>
          <Link className="nav-link" href="/settings">
            <Settings2 size={18} />
            Configurações
          </Link>
          <Link
            className="user-link"
            href={data?.user ? "/dashboard" : "/login"}
          >
            <span className="avatar">
              {data?.user?.name.slice(0, 1).toUpperCase() ?? "V"}
            </span>
            <div>
              {data?.user?.name ?? "Visitante"}
              <small>
                {data?.user ? "Sua conta" : "Entrar ou criar conta"}
              </small>
            </div>
            <ArrowUpRight size={16} />
          </Link>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            <strong>
              {links.find((l) => l.href === path)?.label ??
                (path.startsWith("/reports")
                  ? "Relatório técnico"
                  : path.startsWith("/scan")
                    ? "Diagnóstico em andamento"
                    : "Observatório")}
            </strong>
          </div>
          <div
            className={`service-status ${health?.status === "ready" ? "ready" : ""}`}
          >
            <span className="status-dot" />
            {health?.status === "ready"
              ? health.mode === "HTTP_ONLY"
                ? "Diagnóstico HTTP ativo"
                : health.publicScans
                  ? "Scanner conectado"
                  : "Modo de alvos aprovados"
              : "Scanner não conectado"}
          </div>
          <span className="version mono">v0.1</span>
        </header>
        <main id="main">{children}</main>
        <footer className="footer">
          <span>
            <Activity size={13} /> SONDA · Website Security & Quality Analyzer
          </span>
          <span>Feito para olhar mais fundo.</span>
        </footer>
      </div>
    </div>
  );
}
