import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
export class DestinationError extends Error {
  code = "DESTINATION_BLOCKED";
}
export function publicIp(address: string): boolean {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress())
      ip = (ip as ipaddr.IPv6).toIPv4Address();
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
export function normalizeUrl(input: string): URL {
  const raw = input.trim();
  if (
    /[\s\\]/u.test(raw) ||
    Array.from(raw).some((char) => char.charCodeAt(0) < 32)
  )
    throw new DestinationError("URL ambígua ou inválida.");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new DestinationError("Informe uma URL válida.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    url.hostname.endsWith(".")
  )
    throw new DestinationError(
      "Protocolo, porta ou credenciais não permitidos.",
    );
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    (!host.includes(".") && !host.includes(":")) ||
    /\.(localhost|local|internal|test|invalid|home|lan)$/i.test(host)
  )
    throw new DestinationError("Destino interno não permitido.");
  if (ipaddr.isValid(host) && !publicIp(host))
    throw new DestinationError("Endereço não público.");
  url.hash = "";
  url.search = "";
  return url;
}
export type Resolver = (
  host: string,
) => Promise<Array<{ address: string; family: number }>>;
export async function resolveDestination(
  url: URL,
  resolver: Resolver = (host) => lookup(host, { all: true, verbatim: true }),
) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolver(host);
  } catch {
    throw new DestinationError("Não foi possível resolver o destino.");
  }
  if (!addresses.length || addresses.some((a) => !publicIp(a.address)))
    throw new DestinationError("DNS contém destino não público.");
  return { host, addresses };
}
export function approvedTarget(input: string): URL {
  const fixture = process.env.FIXTURE_URL;
  if (fixture) {
    const u = new URL(input),
      f = new URL(fixture);
    if (
      u.origin === f.origin &&
      u.pathname === "/" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
    )
      return u;
  }
  return normalizeUrl(input);
}
