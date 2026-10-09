import { NextRequest } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function proxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const base = process.env.API_URL;
  if (!base)
    return Response.json(
      {
        error: {
          code: "BACKEND_NOT_CONFIGURED",
          message:
            "O scanner ainda não está conectado. Configure a API e os workers para iniciar diagnósticos.",
        },
      },
      { status: 503 },
    );
  const { path } = await params;
  if (
    path.some(
      (p) => p === "." || p === ".." || p.includes("/") || p.includes("\\"),
    )
  )
    return Response.json(
      { error: { code: "INVALID_PATH", message: "Rota inválida." } },
      { status: 400 },
    );
  const allowed = ["v1", "health"];
  if (!allowed.includes(path[0]))
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Rota inválida." } },
      { status: 404 },
    );
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin !== request.nextUrl.origin)
      return Response.json(
        {
          error: { code: "ORIGIN_REJECTED", message: "Origem não autorizada." },
        },
        { status: 403 },
      );
  }
  const url = new URL(
    path[0] === "health" ? `/${path.join("/")}` : `/api/${path.join("/")}`,
    base,
  );
  url.search = request.nextUrl.search;
  const headers = new Headers();
  for (const key of [
    "content-type",
    "cookie",
    "authorization",
    "last-event-id",
  ]) {
    const v = request.headers.get(key);
    if (v) headers.set(key, v);
  }
  headers.set("origin", process.env.WEB_ORIGIN ?? request.nextUrl.origin);
  try {
    const response = await fetch(url, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method)
        ? undefined
        : await request.text(),
      redirect: "manual",
      signal: request.signal,
      cache: "no-store",
    });
    const returned = new Headers();
    for (const key of [
      "content-type",
      "content-disposition",
      "cache-control",
      "set-cookie",
      "x-accel-buffering",
    ]) {
      const v = response.headers.get(key);
      if (v) returned.set(key, v);
    }
    returned.set("Cache-Control", "no-store");
    return new Response(response.body, {
      status: response.status,
      headers: returned,
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "API_UNAVAILABLE",
          message:
            "Não foi possível conectar ao scanner. Tente novamente mais tarde.",
        },
      },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
