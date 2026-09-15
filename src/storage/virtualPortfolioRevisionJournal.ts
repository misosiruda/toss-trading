import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { z } from "zod";
import { sha256HashSchema, virtualPortfolioSchema, type VirtualPortfolio } from "../domain/schemas.js";
import { readPreparedPaperApplication } from "./preparedPaperApplicationFiles.js";
import { capturePaperExecutionLogPaths, readPaperApplicationLogReceipts, type PaperExecutionLogPaths } from "./paperApplicationLogReceipts.js";

const legacyEntrySchema = z.object({
  schemaVersion: z.literal("paper_portfolio_revision.v1"),
  sequence: z.number().int().positive().safe(),
  previousRevisionHash: sha256HashSchema.nullable(),
  previousPortfolioHash: sha256HashSchema,
  portfolio: virtualPortfolioSchema,
  revisionHash: sha256HashSchema
}).strict();
const entrySchema = z.discriminatedUnion("schemaVersion", [legacyEntrySchema,
  legacyEntrySchema.extend({ schemaVersion: z.literal("paper_portfolio_revision.v2"), applicationHash: sha256HashSchema }).strict(),
  legacyEntrySchema.extend({ schemaVersion: z.literal("paper_portfolio_revision.v3"), applicationHash: sha256HashSchema,
    logReceiptHash: sha256HashSchema }).strict()]);

export interface VirtualPortfolioRevisionSnapshot {
  portfolio: VirtualPortfolio | null;
  /** Null explicitly denotes a pre-journal legacy value, not verified accounting lineage. */
  revisionHash: string | null;
}

export const virtualPortfolioRevisionSnapshotSchema = z.object({
  portfolio: virtualPortfolioSchema.nullable(), revisionHash: sha256HashSchema.nullable()
}).strict();

export interface PortfolioRevisionJournalHead extends VirtualPortfolioRevisionSnapshot {
  sequence: number;
}

/** Internal storage operations: the caller must hold the matching portfolio lock throughout. */
export async function readPortfolioRevisionJournal(path: string, portfolio: VirtualPortfolio | null,
  portfolioPath?: string, executionLogPaths?: PaperExecutionLogPaths): Promise<PortfolioRevisionJournalHead> {
  executionLogPaths = executionLogPaths && capturePaperExecutionLogPaths(executionLogPaths);
  let bytes: Buffer;
  try { bytes = await readFile(path); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { portfolio, revisionHash: null, sequence: 0 };
    throw error;
  }
  const raw = bytes.toString("utf8");
  if (!bytes.equals(Buffer.from(raw, "utf8")) || !raw.endsWith("\n") || raw.length === 0) {
    throw new Error("paper portfolio revision journal has invalid UTF-8 or a torn entry");
  }
  const entries = raw.slice(0, -1).split("\n").map((line) => {
    const entry = entrySchema.parse(JSON.parse(line));
    if (line !== JSON.stringify(entry)) throw new Error("paper portfolio revision entry is not canonical");
    return entry;
  });
  const logHashes = entries.flatMap((entry) => entry.schemaVersion === "paper_portfolio_revision.v3" ? [entry.logReceiptHash] : []);
  if (logHashes.length && (!portfolioPath || !executionLogPaths)) throw new Error("paper application log source configuration is required");
  const logReceipts = logHashes.length ? await readPaperApplicationLogReceipts(portfolioPath!, logHashes, executionLogPaths!) : [];
  let receiptIndex = 0;
  let previous: z.infer<typeof entrySchema> | null = null;
  for (const entry of entries) {
    const { revisionHash, ...payload } = entry;
    if (revisionHash !== hashPortfolioRevisionPayload(payload)) throw new Error("paper portfolio revision hash mismatch");
    if (entry.sequence !== (previous?.sequence ?? 0) + 1 || entry.previousRevisionHash !== (previous?.revisionHash ?? null) ||
      (previous !== null && entry.previousPortfolioHash !== hashPortfolioRevisionPayload(previous.portfolio))) {
      throw new Error("paper portfolio revision predecessor mismatch");
    }
    if (entry.schemaVersion !== "paper_portfolio_revision.v1") {
      if (!portfolioPath) throw new Error("paper application source path is required");
      const application = await readPreparedPaperApplication(portfolioPath, entry.applicationHash);
      if (application.expectedSnapshot.revisionHash !== entry.previousRevisionHash ||
        hashPortfolioRevisionPayload(application.expectedSnapshot.portfolio) !== entry.previousPortfolioHash ||
        hashPortfolioRevisionPayload(application.portfolio) !== hashPortfolioRevisionPayload(entry.portfolio)) {
        throw new Error("paper revision application origin mismatch");
      }
      if (entry.schemaVersion === "paper_portfolio_revision.v3") {
        const receipt = logReceipts[receiptIndex++]!;
        if (receipt.applicationHash !== entry.applicationHash) throw new Error("paper revision log receipt origin mismatch");
      }
    }
    previous = entry;
  }
  if (previous === null || hashPortfolioRevisionPayload(previous.portfolio) !== hashPortfolioRevisionPayload(portfolio)) {
    throw new Error("paper portfolio differs from its revision journal head");
  }
  return { portfolio, revisionHash: previous.revisionHash, sequence: previous.sequence };
}

/** Appends before legacy projection replacement. Any failure from this point needs a recovery barrier. */
export async function appendPortfolioRevision(path: string, head: PortfolioRevisionJournalHead, portfolio: VirtualPortfolio,
  applicationHash?: string, logReceiptHash?: string): Promise<void> {
  if (logReceiptHash !== undefined && applicationHash === undefined) throw new Error("paper log receipt requires application origin");
  const payload = {
    schemaVersion: applicationHash === undefined ? "paper_portfolio_revision.v1" as const
      : logReceiptHash === undefined ? "paper_portfolio_revision.v2" as const : "paper_portfolio_revision.v3" as const,
    sequence: head.sequence + 1,
    previousRevisionHash: head.revisionHash,
    previousPortfolioHash: hashPortfolioRevisionPayload(head.portfolio),
    portfolio,
    ...(applicationHash === undefined ? {} : { applicationHash }),
    ...(logReceiptHash === undefined ? {} : { logReceiptHash })
  };
  const entry = entrySchema.parse({ ...payload, revisionHash: hashPortfolioRevisionPayload(payload) });
  const handle = await open(path, head.sequence === 0 ? "wx" : "a");
  try { await handle.writeFile(`${JSON.stringify(entry)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
}

/** Complete JSON value digest; object ordering does not change the logical portfolio value. */
export function hashPortfolioRevisionPayload(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item !== null && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, canonical(child)])) : item;
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}
