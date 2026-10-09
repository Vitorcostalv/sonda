import { it, expect, describe } from "vitest";
import {
  normalizeUrl,
  resolveDestination,
  publicIp,
} from "../packages/scanner/src/security";
import { sanitizeUrl } from "../packages/contracts/src/index";
describe("SSRF input and DNS policy", () => {
  it.each([
    "localhost",
    "http://127.0.0.1",
    "http://10.0.0.1",
    "http://172.16.0.1",
    "http://192.168.1.1",
    "http://169.254.169.254",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "http://2130706433",
    "http://0x7f000001",
    "http://0177.0.0.1",
    "file:///etc/passwd",
    "ftp://example.com",
    "http://user:pass@example.com",
    "http://example.com:8080",
    "http://service.internal",
    "https://example.com\\@localhost",
    "https://example.com.",
    "http://100.64.0.1",
    "http://224.0.0.1",
    "http://[fc00::1]",
  ])("blocks %s", (input) => expect(() => normalizeUrl(input)).toThrow());
  it("normalizes host and strips query and fragments", () =>
    expect(normalizeUrl("EXAMPLE.com/path?token=secret#private").href).toBe(
      "https://example.com/path",
    ));
  it.each([
    "127.0.0.1",
    "10.1.1.1",
    "169.254.1.1",
    "192.0.2.1",
    "198.51.100.4",
    "203.0.113.5",
    "::1",
    "fe80::1",
    "fc00::1",
    "ff02::1",
    "::ffff:10.0.0.1",
  ])("rejects non-public IP %s", (ip) => expect(publicIp(ip)).toBe(false));
  it("accepts globally routable addresses", () => {
    expect(publicIp("93.184.216.34")).toBe(true);
    expect(publicIp("2606:4700:4700::1111")).toBe(true);
  });
  it("rejects a mixed public/private DNS answer", async () =>
    await expect(
      resolveDestination(normalizeUrl("example.com"), async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ]),
    ).rejects.toThrow());
  it("fails closed on DNS failure", async () =>
    await expect(
      resolveDestination(normalizeUrl("example.com"), async () => {
        throw Error("DNS");
      }),
    ).rejects.toThrow());
  it("rejects redirect target via the same validator", async () =>
    await expect(
      resolveDestination(normalizeUrl("example.com"), async () => [
        { address: "127.0.0.1", family: 4 },
      ]),
    ).rejects.toThrow());
  it("rebinding second resolution is rejected", async () => {
    let calls = 0;
    const resolver = async () => [
      { address: ++calls === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 },
    ];
    const validated = await resolveDestination(
      normalizeUrl("example.com"),
      resolver,
    );
    expect(validated.addresses[0].address).toBe("93.184.216.34");
    await expect(
      resolveDestination(normalizeUrl("example.com"), resolver),
    ).rejects.toThrow();
  });
  it("sanitizes credentials and query tokens", () =>
    expect(
      sanitizeUrl("https://u:secret@example.com/path?token=secret#auth"),
    ).toBe("https://example.com/path"));
});
