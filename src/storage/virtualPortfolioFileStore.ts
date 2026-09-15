import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rmdir, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseWithSchema, virtualPortfolioSchema, type VirtualPortfolio } from "../domain/schemas.js";
import { appendPortfolioRevision, readPortfolioRevisionJournal, virtualPortfolioRevisionSnapshotSchema, type PortfolioRevisionJournalHead,
  type VirtualPortfolioRevisionSnapshot } from "./virtualPortfolioRevisionJournal.js";
export type { VirtualPortfolioRevisionSnapshot } from "./virtualPortfolioRevisionJournal.js";

export class VirtualPortfolioStateChangedError extends Error {
  constructor() { super("paper portfolio state changed before application"); }
}

/** Shared by existing paper writers. Revision history is not a multi-artifact accounting transaction. */
export class FileVirtualPortfolioStore {
  private readonly filePath: string;
  private readonly lockPath: string;
  private readonly revisionPath: string;
  private readonly timeoutMs: number;
  private readonly retryMs: number;
  constructor(filePath: string, options: { lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {
    if (!filePath) throw new Error("paper portfolio file path is required");
    this.filePath = resolve(filePath);
    this.lockPath = `${this.filePath}.lock`;
    this.revisionPath = `${this.filePath}.revisions.jsonl`;
    this.timeoutMs = positiveInteger(options.lockTimeoutMs ?? 5000);
    this.retryMs = positiveInteger(options.lockRetryDelayMs ?? 10);
  }

  read(): Promise<VirtualPortfolio | null> {
    return this.withLock(async () => (await this.readStoredSnapshot()).portfolio);
  }

  readSnapshot(): Promise<VirtualPortfolioRevisionSnapshot> {
    return this.withLock(async () => {
      const { portfolio, revisionHash } = await this.readStoredSnapshot();
      return { portfolio, revisionHash };
    });
  }

  async write(portfolio: VirtualPortfolio): Promise<void> {
    const captured = parseWithSchema(virtualPortfolioSchema, portfolio, "virtualPortfolio");
    await this.withLock(async (assertOwned, preserveBarrier) =>
      this.writeStored(captured, await this.readStoredSnapshot(), assertOwned, preserveBarrier));
  }

  /** Never re-enter this store from operation. No provider/network call belongs inside this lock.
   * Other files are NOT rolled back on failure. Callback/portfolio commit failure preserves the lock
   * as a recovery barrier so a retry cannot apply the same trade against an unchanged portfolio.
   */
  async withExclusiveUpdate<T>(expected: VirtualPortfolio | null,
    operation: () => Promise<{ portfolio: VirtualPortfolio; result: T }>): Promise<T> {
    const captured = expected === null ? null : parseWithSchema(virtualPortfolioSchema, expected, "expectedVirtualPortfolio");
    return this.update(captured, undefined, operation);
  }

  /** Captures the whole observation before waiting. Every successful write advances the revision, even HOLD. */
  async withExclusiveSnapshotUpdate<T>(expected: VirtualPortfolioRevisionSnapshot,
    operation: () => Promise<{ portfolio: VirtualPortfolio; result: T }>): Promise<T> {
    const captured = virtualPortfolioRevisionSnapshotSchema.parse(expected);
    return this.update(captured.portfolio, captured.revisionHash, operation);
  }

  private async update<T>(captured: VirtualPortfolio | null, expectedRevision: string | null | undefined,
    operation: () => Promise<{ portfolio: VirtualPortfolio; result: T }>): Promise<T> {
    return this.withLock(async (assertOwned, preserveBarrier) => {
      const stored = await this.readStoredSnapshot();
      if (!isDeepStrictEqual(stored.portfolio, captured) ||
        (expectedRevision !== undefined && expectedRevision !== stored.revisionHash)) throw new VirtualPortfolioStateChangedError();
      try {
        const next = await operation();
        const portfolio = parseWithSchema(virtualPortfolioSchema, next.portfolio, "virtualPortfolio");
        if (captured !== null && portfolio.portfolioId !== captured.portfolioId) throw new Error("paper portfolio update changes portfolio identity");
        await this.writeStored(portfolio, stored, assertOwned, preserveBarrier);
        return next.result;
      } catch (error) { preserveBarrier(); throw error; }
    });
  }

  private async readStoredSnapshot(): Promise<PortfolioRevisionJournalHead> {
    return readPortfolioRevisionJournal(this.revisionPath, await this.readStored());
  }

  private async readStored(): Promise<VirtualPortfolio | null> {
    let bytes: Buffer;
    try { bytes = await readFile(this.filePath); }
    catch (error) { if (isCode(error, "ENOENT")) return null; throw error; }
    const raw = bytes.toString("utf8");
    if (!Buffer.from(raw, "utf8").equals(bytes)) throw new Error("paper portfolio file is not valid UTF-8");
    // Keep the existing JSON object format, including legacy formatting and field ordering.
    return parseWithSchema(virtualPortfolioSchema, JSON.parse(raw), "virtualPortfolio");
  }

  private async writeStored(portfolio: VirtualPortfolio, head: PortfolioRevisionJournalHead,
    assertOwned: () => Promise<void>, preserveBarrier: () => void) {
    const temporary = `${this.filePath}.tmp-${randomUUID()}`;
    const handle = await open(temporary, "wx");
    try {
      try { await handle.writeFile(`${JSON.stringify(portfolio, null, 2)}\n`, "utf8"); await handle.sync(); }
      finally { await handle.close(); }
      await assertOwned();
      try {
        await appendPortfolioRevision(this.revisionPath, head, portfolio);
        await syncDirectory(dirname(this.revisionPath));
        await assertOwned();
        await rename(temporary, this.filePath);
        await syncDirectory(dirname(this.filePath));
      } catch (error) { preserveBarrier(); throw error; }
    } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  }

  private async withLock<T>(operation: (assertOwned: () => Promise<void>, preserveBarrier: () => void) => Promise<T>): Promise<T> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const deadline = performance.now() + this.timeoutMs;
    while (true) {
      try { await mkdir(this.lockPath); break; }
      catch (error) {
        if (!(isCode(error, "EEXIST") || (process.platform === "win32" && isCode(error, "EPERM")))) throw error;
        if (performance.now() >= deadline) throw new Error("paper portfolio lock is unavailable", { cause: error });
        await new Promise((done) => setTimeout(done, Math.max(1, Math.min(this.retryMs, deadline - performance.now()))));
      }
    }
    const token = randomUUID(), ownerPath = join(this.lockPath, token);
    // Failed initialization remains a barrier. Recovery requires ALL cooperating readers/writers stopped.
    const handle = await open(ownerPath, "wx");
    try { await handle.writeFile(`${token}\n`); await handle.sync(); } finally { await handle.close(); }
    await syncDirectory(this.lockPath);
    await syncDirectory(dirname(this.lockPath));
    const assertOwned = async () => {
      if (!isDeepStrictEqual(await readdir(this.lockPath), [token]) || await readFile(ownerPath, "utf8") !== `${token}\n`) {
        throw new Error("paper portfolio lock ownership changed");
      }
    };
    let preserveBarrier = false;
    try { await assertOwned(); return await operation(assertOwned, () => { preserveBarrier = true; }); }
    finally {
      // Only delete this owner's unique file; a foreign file prevents non-recursive directory removal.
      // Cooperating processes never replace an active directory. Out-of-band online takeover is unsupported.
      // Portfolio durability is completed while locked. Do not perform fallible I/O after removing the
      // barrier: a failed cleanup sync must not turn a committed unchanged portfolio into a retryable error.
      // A crash may resurrect unflushed lock deletion; that is a fail-closed barrier, not lost portfolio data.
      if (!preserveBarrier) {
        await assertOwned(); await unlink(ownerPath); await rmdir(this.lockPath);
      }
    }
  }
}

async function syncDirectory(path: string) {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r"); }
  catch (error) { if (unsupportedDirectorySync(error)) return; throw error; }
  try { await handle.sync(); }
  catch (error) { if (!unsupportedDirectorySync(error)) throw error; }
  finally { await handle.close(); }
}
function unsupportedDirectorySync(error: unknown) { return process.platform === "win32" && isCode(error, "EPERM"); }
function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
function positiveInteger(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("paper portfolio lock option must be a positive safe integer");
  return value;
}
