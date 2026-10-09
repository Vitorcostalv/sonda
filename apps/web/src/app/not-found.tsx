import Link from "next/link";
export default function NotFound() {
  return (
    <div className="page-content">
      <h1>Página não encontrada.</h1>
      <p>O endereço pode ter mudado ou o relatório expirou.</p>
      <Link className="button primary" href="/">
        Novo diagnóstico
      </Link>
    </div>
  );
}
