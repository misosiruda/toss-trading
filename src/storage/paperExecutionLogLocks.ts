import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export interface PaperExecutionLogLockOptions { lockTimeoutMs?: number; lockRetryDelayMs?: number }
interface Scope {
  keys: Set<string>;
  queues: Map<string, Promise<void>>;
  accepting: boolean;
  active: boolean;
  dirty: boolean;
  failed: boolean;
  failure: unknown;
  assertOwned(): Promise<void>;
}
interface Lease { release(): Promise<void>; assertOwned(): Promise<void> }
const scopes = new AsyncLocalStorage<Scope>();

/** Cooperating writers only. Readers remain forensic views, not committed transaction snapshots.
 * Acquire all log locks before a portfolio lock. Never call providers or nest batches here.
 * Failure after an append starts retains every acquired log barrier for explicit offline recovery.
 */
export async function withPaperExecutionLogBatch<T>(paths: readonly string[], operation: () => Promise<T>,
  options: PaperExecutionLogLockOptions = {}): Promise<T> {
  if (scopes.getStore()) throw new Error("paper execution log batches must not be nested");
  if (!paths.length) throw new Error("paper execution log batch requires paths");
  const timeout = positive(options.lockTimeoutMs ?? 5000), retry = positive(options.lockRetryDelayMs ?? 10);
  const canonical = await Promise.all(paths.map(canonicalPath));
  const keys = canonical.map(pathKey);
  if (new Set(keys).size !== keys.length) throw new Error("paper execution log paths must be distinct");
  canonical.sort((a, b) => pathKey(a) < pathKey(b) ? -1 : pathKey(a) > pathKey(b) ? 1 : 0);
  const leases: Lease[] = [];
  const scope: Scope = { keys: new Set(keys), queues: new Map(), accepting: true, active: true, dirty: false, failed: false, failure: undefined,
    async assertOwned() { for (const lease of leases) await lease.assertOwned(); } };
  let result!: T;
  try {
    for (const path of canonical) leases.push(await acquire(`${path}.paper-log.lock`, timeout, retry));
    try { result = await scopes.run(scope, operation); }
    catch (error) { fail(scope, error); }
    finally {
      scope.accepting = false;
      await Promise.all(scope.queues.values());
      scope.active = false;
    }
    for (const lease of leases) await lease.assertOwned();
    if (scope.failed) throw scope.failure;
    return result;
  } catch (error) { fail(scope, error); throw error; }
  finally {
    scope.accepting = false; scope.active = false;
    if (!(scope.failed && scope.dirty)) {
      // No fallible sync after releasing the last barrier. A crash may resurrect a lock.
      for (const lease of leases.reverse()) await lease.release();
    }
  }
}

/** Serializes even concurrent append calls inherited from the same batch context. */
export async function withPaperExecutionLogAppend(path: string, operation: () => Promise<void>,
  options: PaperExecutionLogLockOptions = {}): Promise<void> {
  const inherited = scopes.getStore();
  if (inherited && (!inherited.accepting || !inherited.active)) throw new Error("paper execution log scope has expired");
  const key = pathKey(await canonicalPath(path));
  if (inherited) {
    if (!inherited.accepting || !inherited.active) throw new Error("paper execution log scope has expired");
    if (!inherited.keys.has(key)) throw new Error("paper execution log append is outside the held batch");
    return enqueue(inherited, key, operation);
  }
  return withPaperExecutionLogBatch([path], () => enqueue(scopes.getStore()!, key, operation), options);
}

function enqueue(scope: Scope, key: string, operation: () => Promise<void>): Promise<void> {
  if (!scope.keys.has(key)) throw new Error("paper execution log path changed while acquiring locks");
  const pending = (scope.queues.get(key) ?? Promise.resolve()).then(async () => {
    if (!scope.active) throw new Error("paper execution log scope has expired");
    if (scope.failed) throw scope.failure;
    await scope.assertOwned();
    scope.dirty = true;
    await operation();
  });
  scope.queues.set(key, pending.catch((error) => { fail(scope, error); }));
  return pending;
}
function fail(scope: Scope, error: unknown) { if (!scope.failed) { scope.failed = true; scope.failure = error; } }
function pathKey(path: string) { return process.platform === "win32" ? path.toLowerCase() : path; }
async function canonicalPath(path: string): Promise<string> {
  if (!path) throw new Error("paper execution log path is required");
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  const canonical = join(await realpath(dirname(absolute)), basename(absolute));
  try {
    const info = await lstat(canonical);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error("paper execution log must be an unaliased regular file");
  } catch (error) { if (!isCode(error, "ENOENT")) throw error; }
  return canonical;
}
async function acquire(path: string, timeout: number, retry: number): Promise<Lease> {
  const deadline = performance.now() + timeout;
  while (true) {
    try { await mkdir(path); break; }
    catch (error) {
      if (!(isCode(error, "EEXIST") || (process.platform === "win32" && isCode(error, "EPERM")))) throw error;
      if (performance.now() >= deadline) throw new Error("paper execution log lock is unavailable", { cause: error });
      await new Promise((done) => setTimeout(done, Math.max(1, Math.min(retry, deadline - performance.now()))));
    }
  }
  const token = randomUUID(), owner = join(path, token);
  // Initialization failures deliberately retain the directory; no abandoned lock takeover.
  const handle = await open(owner, "wx");
  try { await handle.writeFile(`${token}\n`); await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(path); await syncDirectory(dirname(path));
  const assertOwned = async () => {
    const entries = await readdir(path);
    if (entries.length !== 1 || entries[0] !== token || await readFile(owner, "utf8") !== `${token}\n`) {
      throw new Error("paper execution log lock ownership changed");
    }
  };
  return { assertOwned, async release() { await assertOwned(); await unlink(owner); await rmdir(path); } };
}
async function syncDirectory(path: string) {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r"); }
  catch (error) { if (unsupported(error)) return; throw error; }
  try { await handle.sync(); } catch (error) { if (!unsupported(error)) throw error; }
  finally { await handle.close(); }
}
function unsupported(error: unknown) { return process.platform === "win32" && isCode(error, "EPERM"); }
function isCode(error: unknown, code: string) { return error instanceof Error && "code" in error && error.code === code; }
function positive(value: number) { if (!Number.isSafeInteger(value) || value <= 0) throw new Error("paper execution log lock option must be a positive safe integer"); return value; }
