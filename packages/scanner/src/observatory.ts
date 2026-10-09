import { request } from "undici";
import { normalizeUrl, resolveDestination } from "./security";
const cache = new Map<string, { expires: number; result: unknown }>();
export async function observatory(hostname: string) {
  const url = normalizeUrl(`https://${hostname}`);
  if (url.hostname !== hostname || url.pathname !== "/")
    throw new Error("INVALID_HOSTNAME");
  await resolveDestination(url);
  const cached = cache.get(hostname);
  if (cached && cached.expires > Date.now())
    return {
      source: "MDN HTTP Observatory v2",
      cached: true,
      result: cached.result,
    };
  const response = await request(
    `https://observatory-api.mdn.mozilla.net/api/v2/scan?host=${encodeURIComponent(hostname)}`,
    {
      method: "POST",
      headersTimeout: 10000,
      bodyTimeout: 10000,
      signal: AbortSignal.timeout(15000),
    },
  );
  if (response.statusCode !== 200) {
    await response.body.dump();
    return {
      source: "MDN HTTP Observatory v2",
      status: "UNAVAILABLE",
      httpStatus: response.statusCode,
    };
  }
  const result = await response.body.json();
  if (cache.size > 1000) cache.clear();
  cache.set(hostname, { expires: Date.now() + 3600000, result });
  return {
    source: "MDN HTTP Observatory v2",
    cached: false,
    retrievedAt: new Date().toISOString(),
    result,
  };
}
