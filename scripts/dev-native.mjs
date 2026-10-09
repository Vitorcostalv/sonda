import { spawn } from "node:child_process";
import { resolve } from "node:path";
const child = spawn(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["--filter", "@sonda/web", "dev"],
  {
    shell: process.platform === "win32",
    stdio: "inherit",
    env: { ...process.env, NATIVE_STORAGE_DIR: resolve("storage/native") },
  },
);
child.on("exit", (code) => process.exit(code ?? 0));
