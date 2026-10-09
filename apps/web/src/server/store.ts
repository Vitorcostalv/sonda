import { put, get, list, del, BlobPreconditionFailedError } from "@vercel/blob";
import { mkdir, readFile, writeFile, unlink, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
export interface ObjectStore {
  read<T>(key: string): Promise<{ value: T; etag: string } | null>;
  write(
    key: string,
    value: unknown,
    options?: { create?: boolean; etag?: string },
  ): Promise<void>;
  remove(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}
export class ConflictError extends Error {}
export class BlobStore implements ObjectStore {
  async read<T>(key: string) {
    const result = await get(key, { access: "private", useCache: false });
    if (!result) return null;
    return {
      value: JSON.parse(await new Response(result.stream).text()) as T,
      etag: result.blob.etag,
    };
  }
  async write(
    key: string,
    value: unknown,
    options: { create?: boolean; etag?: string } = {},
  ) {
    try {
      await put(key, JSON.stringify(value), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: !options.create,
        contentType: "application/json",
        ...(options.etag ? { ifMatch: options.etag } : {}),
        cacheControlMaxAge: 0,
      });
    } catch (e) {
      if (
        e instanceof BlobPreconditionFailedError ||
        (e instanceof Error && /already exists/i.test(e.message))
      )
        throw new ConflictError("CONFLICT");
      throw e;
    }
  }
  async remove(key: string) {
    await del(key);
  }
  async keys(prefix: string) {
    const result = await list({ prefix, limit: 1000 });
    return result.blobs.map((b) => b.pathname);
  }
}
export class FileStore implements ObjectStore {
  constructor(private root: string) {}
  private path(key: string) {
    if (!/^[a-zA-Z\d/_-]+\.json$/.test(key) || key.includes(".."))
      throw Error("INVALID_KEY");
    return resolve(this.root, key);
  }
  async read<T>(key: string) {
    try {
      const data = await readFile(this.path(key), "utf8");
      return {
        value: JSON.parse(data) as T,
        etag: createHash("sha256").update(data).digest("hex"),
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async write(
    key: string,
    value: unknown,
    options: { create?: boolean; etag?: string } = {},
  ) {
    const path = this.path(key);
    if (options.etag && (await this.read(key))?.etag !== options.etag)
      throw new ConflictError("CONFLICT");
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, JSON.stringify(value), {
        flag: options.create ? "wx" : "w",
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        throw new ConflictError("CONFLICT");
      throw e;
    }
  }
  async remove(key: string) {
    await unlink(this.path(key)).catch(() => {});
  }
  async keys(prefix: string) {
    try {
      const names = await readdir(this.root, { recursive: true });
      return names
        .filter(
          (n) =>
            n.replaceAll("\\", "/").startsWith(prefix) && n.endsWith(".json"),
        )
        .map((n) => n.replaceAll("\\", "/"));
    } catch {
      return [];
    }
  }
}
export const nativeStore: ObjectStore = process.env.NATIVE_STORAGE_DIR
  ? new FileStore(process.env.NATIVE_STORAGE_DIR)
  : new BlobStore();
