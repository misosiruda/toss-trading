import type { BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname } from "node:path";

/** Capture one actual descriptor while its repository owns the writer lock.
 * This is a byte observation, not a domain-history token or a multi-file transaction.
 */
export async function readDurableRebalanceSource(path: string): Promise<{ raw: string; observedAt: string }> {
  let named;
  try { named = await lstat(path); }
  catch (error) {
    if (!missing(error)) throw error;
    await syncDirectory(dirname(path));
    const observedAt = new Date().toISOString();
    try { await lstat(path); }
    catch (again) { if (missing(again)) return { raw: "", observedAt }; throw again; }
    throw changed();
  }
  if (!named.isFile() || named.isSymbolicLink()) throw new Error("rebalance source must be a regular file");
  const handle = await open(path, "r+");
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n) throw new Error("rebalance source must be a regular single-link file");
    const bytes = await handle.readFile(), raw = bytes.toString("utf8");
    if (!Buffer.from(raw, "utf8").equals(bytes)) throw new Error("rebalance source contains invalid UTF-8");
    await handle.sync(); await syncDirectory(dirname(path));
    const observedAt = new Date().toISOString(), verified = Buffer.alloc(bytes.length);
    let offset = 0;
    while (offset < verified.length) {
      const { bytesRead } = await handle.read(verified, offset, verified.length - offset, offset);
      if (bytesRead === 0) throw changed();
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true }), currentPath = await lstat(path);
    if (!currentPath.isFile() || currentPath.isSymbolicLink()) throw changed();
    const namedHandle = await open(path, "r");
    try {
      if (before.size !== BigInt(bytes.length) || !bytes.equals(verified) || !sameStat(before, after) ||
        !sameStat(before, await namedHandle.stat({ bigint: true }))) throw changed();
    } finally { await namedHandle.close(); }
    return { raw, observedAt };
  } finally { await handle.close(); }
}

function sameStat(a: BigIntStats, b: BigIntStats) {
  return b.isFile() && a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.nlink === b.nlink;
}
function changed() { return new Error("rebalance source changed during durable observation"); }
function missing(error: unknown) { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
async function syncDirectory(path: string) {
  let handle;
  try { handle = await open(path, "r"); }
  catch (error) { if (unsupportedDirectorySync(error)) return; throw error; }
  try { await handle.sync(); }
  catch (error) { if (!unsupportedDirectorySync(error)) throw error; }
  finally { await handle.close(); }
}
function unsupportedDirectorySync(error: unknown) {
  return process.platform === "win32" && error instanceof Error && "code" in error && error.code === "EPERM";
}
