export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      data.error?.message ?? "Não foi possível concluir a solicitação.",
      response.status,
      data.error?.code,
    );
  return data as T;
}
export function scanToken(id: string) {
  return typeof window !== "undefined"
    ? sessionStorage.getItem(`sonda:${id}`)
    : null;
}
export function tokenQuery(id: string) {
  const token = scanToken(id);
  return token ? `?token=${encodeURIComponent(token)}` : "";
}
export interface Finding {
  id: string;
  ruleId: string;
  category: string;
  status: string;
  severity: string;
  title: string;
  description: string;
  recommendation: string;
  evidenceJson: unknown;
  documentationUrl: string;
}
export interface Scan {
  id: string;
  normalizedUrl: string;
  finalUrl?: string;
  status: string;
  progress: number;
  score: number | null;
  coverage: number | null;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  steps: { id: number; name: string; status: string }[];
  scoringVersion?: string;
}
export interface Report extends Scan {
  mode?: "HTTP_ONLY";
  findings: Finding[];
  resources: {
    sanitizedUrl: string;
    resourceType: string;
    origin: string;
    responseStatus: number | null;
    protocol: string;
    isThirdParty: boolean;
  }[];
  evidence: { id: string; type: string }[];
  context: {
    cookies?: unknown[];
    redirects?: string[];
    privacy?: unknown;
    seo?: unknown;
    performance?: unknown;
  } | null;
}
