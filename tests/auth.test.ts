import { it, expect } from "vitest";
import { passwordHash, verifyPassword } from "../apps/api/src/app";
it("passwords have per-user salts and reject incorrect credentials", async () => {
  const password = "long-passphrase-fixture-2026";
  const a = await passwordHash(password),
    b = await passwordHash(password);
  expect(a).not.toBe(b);
  expect(a).not.toContain(password);
  expect(await verifyPassword(password, a)).toBe(true);
  expect(await verifyPassword("wrong-long-password", a)).toBe(false);
  expect(await verifyPassword(password, "broken")).toBe(false);
});
