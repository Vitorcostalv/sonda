import { z } from "zod";
export const categories = [
  "transport",
  "headers",
  "cookies",
  "resources",
  "privacy",
  "accessibility",
  "performance",
  "seo",
] as const;
export type AuditCategory = (typeof categories)[number];
export const statuses = [
  "PASS",
  "FAIL",
  "WARN",
  "INFO",
  "NOT_APPLICABLE",
  "INCONCLUSIVE",
  "ERROR",
] as const;
export type RuleStatus = (typeof statuses)[number];
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
export interface RuleResult {
  ruleId: string;
  category: AuditCategory;
  status: RuleStatus;
  severity: Severity;
  title: string;
  description: string;
  evidence: unknown;
  recommendation: string;
  documentationUrl: string;
  testedAt: string;
  weight: number;
  justification: string;
}
export interface CookieMeta {
  name: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  overHttps: boolean;
}
export interface Resource {
  url: string;
  type: string;
  origin: string;
  status: number | null;
  protocol: string;
  thirdParty: boolean;
  outcome: "loaded" | "blocked" | "failed" | "pending";
  integrity?: string;
  provider?: string;
}
export interface AuditContext {
  initialUrl: string;
  finalUrl: string;
  headers: Record<string, string[]>;
  tls: "valid" | "invalid" | "unknown" | "not-applicable";
  httpUpgrade: "yes" | "no" | "untested";
  redirects: string[];
  cookies: CookieMeta[];
  resources: Resource[];
  browserError?: string;
  collected: boolean;
  testedAt: string;
  seo?: Record<string, unknown>;
  privacy?: Record<string, unknown>;
  accessibility?: unknown;
  performance?: Record<string, unknown>;
}
export interface AuditRule {
  id: string;
  category: AuditCategory;
  weight: number;
  evaluate(context: AuditContext): Promise<RuleResult>;
}
export interface Score {
  score: number | null;
  coverage: number;
  version: string;
  completed: number;
  applicable: number;
  provisional: boolean;
}
export const scanInput = z
  .object({
    url: z.string().trim().min(1).max(2048),
    projectId: z.string().uuid().optional(),
  })
  .strict();
export const credentials = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(12).max(128),
    name: z.string().min(1).max(80).optional(),
  })
  .strict();
export const projectInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    url: z.string().max(2048),
  })
  .strict();
export function sanitizeUrl(raw: string): string {
  const url = new URL(raw);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}
