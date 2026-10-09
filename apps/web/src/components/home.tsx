"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Globe2,
  ShieldCheck,
  Fingerprint,
  Accessibility,
  Gauge,
  Search,
  ArrowUpRight,
  LockKeyhole,
  Layers3,
  Check,
  LoaderCircle,
  Radio,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { ErrorState } from "./ui";
const inputSchema = z.object({
  url: z
    .string()
    .trim()
    .min(3, "Informe a URL de um site público.")
    .max(2048)
    .refine((v) => {
      try {
        const u = new URL(v.includes("://") ? v : `https://${v}`);
        return (
          ["http:", "https:"].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          u.hostname.includes(".")
        );
      } catch {
        return false;
      }
    }, "Informe uma URL HTTP ou HTTPS válida, sem credenciais."),
});
const modules = [
  {
    icon: ShieldCheck,
    n: "01",
    name: "Segurança",
    tag: "13 REGRAS",
    text: "HTTPS, headers, cookies e recursos externos. Cada sinal, com sua evidência.",
    tone: "mint",
  },
  {
    icon: Fingerprint,
    n: "02",
    name: "Privacidade",
    tag: "OBSERVAÇÃO PASSIVA",
    text: "Cookies, trackers e sinais de consentimento antes de qualquer interação.",
    tone: "blue",
  },
  {
    icon: Accessibility,
    n: "03",
    name: "Acessibilidade",
    tag: "AXE-CORE",
    text: "Barreiras identificáveis por automação, com contexto para revisão manual.",
    tone: "purple",
  },
  {
    icon: Gauge,
    n: "04",
    name: "Performance",
    tag: "LABORATÓRIO",
    text: "Módulo preparado para Lighthouse. Indica indisponibilidade quando não executado.",
    tone: "amber",
  },
  {
    icon: Search,
    n: "05",
    name: "SEO técnico",
    tag: "ESTRUTURA & METADADOS",
    text: "Titles, descrições, hierarquia e metadados que dão estrutura à sua página.",
    tone: "pink",
  },
];
export function Home() {
  const router = useRouter();
  const [error, setError] = useState<unknown>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof inputSchema>>({
    resolver: zodResolver(inputSchema),
  });
  async function submit(input: z.infer<typeof inputSchema>) {
    setError(undefined);
    try {
      const result = await api<{ id: string; token?: string }>("/scans", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (result.token)
        sessionStorage.setItem(`sonda:${result.id}`, result.token);
      router.push(`/scan/${result.id}`);
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div className="home">
      <div className="page-eyebrow">
        <span className="tiny-cross">+</span> DIAGNÓSTICO DE WEBSITES{" "}
        <span className="eyebrow-line" />
        <span className="mono">SONDA / 001</span>
      </div>
      <section className="hero">
        <div className="hero-content">
          <div className="outline-tag">
            <Radio size={13} />
            <span>VISIBILIDADE É O PRIMEIRO PASSO.</span>
          </div>
          <h1>
            O que seu site
            <br />
            deixa <em>passar?</em>
          </h1>
          <p className="hero-description">
            Olhe além da superfície. Investigue a segurança e a qualidade do seu
            website com evidências reais e um diagnóstico que aponta o próximo
            passo.
          </p>
          <div className="hero-features">
            <span>
              <Check size={14} /> Sem instalar nada no site
            </span>
            <span>
              <Check size={14} /> Análise não destrutiva
            </span>
          </div>
        </div>
        <div className="radar-panel" aria-hidden="true">
          <div className="radar-coord top">
            OBSERVATION FIELD <span>01 / ACTIVE</span>
          </div>
          <div className="radar">
            <div className="radar-ring ring1" />
            <div className="radar-ring ring2" />
            <div className="radar-ring ring3" />
            <div className="radar-ring ring4" />
            <div className="radar-cross horizontal" />
            <div className="radar-cross vertical" />
            <div className="radar-sweep" />
            <div className="radar-core">
              <ShieldCheck size={35} strokeWidth={1.2} />
            </div>
            <span className="blip b1" />
            <span className="blip b2" />
            <span className="blip b3" />
            <span className="radar-label rl1">HTTPS / TLS</span>
            <span className="radar-label rl2">HEADERS</span>
            <span className="radar-label rl3">COOKIES</span>
            <span className="radar-axis north">N</span>
            <span className="radar-axis east">E</span>
          </div>
          <div className="radar-coord bottom">
            <span>PASSIVE INSPECTION</span>
            <span className="mint">+ SINAIS, NÃO SUPOSIÇÕES</span>
          </div>
        </div>
      </section>
      <section className="scan-console">
        <div className="console-heading">
          <div>
            <span className="mint mono">01</span>
            <h2>Comece pelo endereço.</h2>
          </div>
          <span className="mono muted">SEM CONTA · ACESSO PÚBLICO</span>
        </div>
        <form onSubmit={handleSubmit(submit)} noValidate>
          <label htmlFor="url" className="sr-only">
            URL do website
          </label>
          <div className={`url-input ${errors.url ? "invalid" : ""}`}>
            <Globe2 size={21} />
            <input
              id="url"
              placeholder="https://seusite.com.br"
              autoComplete="url"
              {...register("url")}
              aria-invalid={!!errors.url}
              aria-describedby="url-help"
            />
            <button
              className="button primary"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <LoaderCircle size={17} className="spin" />
                  Conectando…
                </>
              ) : (
                <>
                  Iniciar diagnóstico <ArrowRight size={18} />
                </>
              )}
            </button>
          </div>
          {errors.url && (
            <p className="field-error" role="alert">
              {errors.url.message}
            </p>
          )}
          <div className="console-foot" id="url-help">
            <span>
              <LockKeyhole size={13} /> Apenas páginas públicas. Nenhum login ou
              formulário é enviado.
            </span>
            <span>
              1 página por análise <span className="mint">↗</span>
            </span>
          </div>
        </form>
        {Boolean(error) && <ErrorState error={error} />}
      </section>
      <section className="modules-section">
        <div className="section-heading">
          <div>
            <span className="section-kicker mono">
              AMPLITUDE DO DIAGNÓSTICO
            </span>
            <h2>Cinco perspectivas. Um site.</h2>
          </div>
          <span className="text-link">
            Veja o que observamos <ArrowUpRight size={16} />
          </span>
        </div>
        <div className="modules-grid">
          {modules.map(({ icon: Icon, n, name, tag, text, tone }) => (
            <article className={`module ${tone}`} key={n}>
              <div className="module-top">
                <span className="module-icon">
                  <Icon size={22} strokeWidth={1.5} />
                </span>
                <span className="mono">/{n}</span>
              </div>
              <h3>{name}</h3>
              <p>{text}</p>
              <div className="module-tag mono">{tag}</div>
            </article>
          ))}
        </div>
      </section>
      <section className="how-section">
        <div className="how-intro">
          <span className="section-kicker mono">DA URL À EVIDÊNCIA</span>
          <h2>
            Menos ruído.
            <br />
            Mais clareza.
          </h2>
          <p>
            Um processo transparente do primeiro request ao relatório final.
          </p>
        </div>
        <div className="how-steps">
          {[
            {
              icon: Globe2,
              title: "Informe o destino",
              text: "Envie a URL pública. Validamos o endereço e o escopo antes de começar.",
            },
            {
              icon: Layers3,
              title: "Acompanhe a investigação",
              text: "O scanner coleta evidências no modo disponível. Você acompanha as etapas reais.",
            },
            {
              icon: ShieldCheck,
              title: "Entenda os sinais",
              text: "Receba achados com contexto, evidências e recomendações para agir.",
            },
          ].map(({ icon: Icon, title, text }, i) => (
            <div className="how-step" key={title}>
              <span className="step-number mono">0{i + 1}</span>
              <Icon size={20} />
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="limitation">
        <ShieldCheck size={20} />
        <p>
          <strong>Transparência faz parte do diagnóstico.</strong> A SONDA
          observa uma página, em um momento específico. Resultados automatizados
          não comprovam segurança, conformidade com a LGPD ou acessibilidade
          completa. Verificações inconclusivas permanecem visíveis.
        </p>
        <span className="mono">
          ESCOPO
          <br />
          LIMITADO
        </span>
      </div>
    </div>
  );
}
