import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { hashPreparedApplicationPayload, type PreparedPaperApplication } from "../paper/preparedApplication.js";
import { AUDIT_EVENTS_FILE_NAME, VIRTUAL_DECISIONS_FILE_NAME, VIRTUAL_TRADES_FILE_NAME } from "./artifactPaths.js";
import { assertPaperExecutionLogBatchHeld, sealPaperExecutionLogBatch } from "./paperExecutionLogLocks.js";
import { readPreparedPaperApplication } from "./preparedPaperApplicationFiles.js";

export interface PaperExecutionLogPaths { audit: string; decision: string; trade: string }
const roles = ["audit", "decision", "trade"] as const;
const emptyHash = bytesHash(Buffer.alloc(0));
const prefixSchema = z.object({ exists: z.boolean(), byteLength: z.number().int().nonnegative().safe(), hash: sha256HashSchema }).strict()
  .refine((prefix) => prefix.exists || (prefix.byteLength === 0 && prefix.hash === emptyHash), "absent log prefix must be empty");
const prefixesSchema = z.object({ audit: prefixSchema, decision: prefixSchema, trade: prefixSchema }).strict();
const planSchema = z.object({ schemaVersion: z.literal("paper_application_log_plan.v1"), applicationHash: sha256HashSchema,
  before: prefixesSchema, planHash: sha256HashSchema }).strict();
const receiptSchema = z.object({ schemaVersion: z.literal("paper_application_log_receipt.v1"), applicationHash: sha256HashSchema,
  planHash: sha256HashSchema, after: prefixesSchema, receiptHash: sha256HashSchema }).strict();
export type PaperApplicationLogPlan = z.infer<typeof planSchema>;
export type PaperApplicationLogReceipt = z.infer<typeof receiptSchema>;
type Prefix = z.infer<typeof prefixSchema>;

/** Paths come from trusted repository configuration, NEVER from the stored receipt. */
export function defaultPaperExecutionLogPaths(portfolioPath: string): PaperExecutionLogPaths {
  const root = dirname(resolve(portfolioPath));
  return { audit: join(root, AUDIT_EVENTS_FILE_NAME), decision: join(root, VIRTUAL_DECISIONS_FILE_NAME), trade: join(root, VIRTUAL_TRADES_FILE_NAME) };
}
export function capturePaperExecutionLogPaths(paths: PaperExecutionLogPaths): PaperExecutionLogPaths {
  return Object.freeze({ audit: resolve(required(paths.audit)), decision: resolve(required(paths.decision)), trade: resolve(required(paths.trade)) });
}
export function paperApplicationLogPlanPath(portfolioPath: string, hash: string): string {
  return join(`${portfolioPath}.application-log-plans`, `${sha256HashSchema.parse(hash).slice(7)}.json`);
}
export function paperApplicationLogReceiptPath(portfolioPath: string, hash: string): string {
  return join(`${portfolioPath}.application-log-receipts`, `${sha256HashSchema.parse(hash).slice(7)}.json`);
}

/** Must run under both the configured log batch and the matching portfolio revision lock. */
export async function preparePaperApplicationLogPlan(portfolioPath: string, applicationHash: string,
  paths: PaperExecutionLogPaths): Promise<PaperApplicationLogPlan> {
  paths = capturePaperExecutionLogPaths(paths);
  await assertPaperExecutionLogBatchHeld(Object.values(paths));
  await readPreparedPaperApplication(portfolioPath, applicationHash);
  const before = {} as PaperApplicationLogPlan["before"];
  for (const role of roles) {
    const value = await readLog(paths[role], true);
    // An opaque valid JSON prefix is preserved, not promoted to authenticated historical trading lineage.
    parseLines(value.bytes, false);
    before[role] = prefix(value);
  }
  await assertPaperExecutionLogBatchHeld(Object.values(paths));
  const payload = { schemaVersion: "paper_application_log_plan.v1" as const, applicationHash, before };
  const plan = planSchema.parse({ ...payload, planHash: hashPreparedApplicationPayload(payload) });
  await writeExclusive(paperApplicationLogPlanPath(portfolioPath, plan.planHash), plan);
  return plan;
}

/** Confirms the EXACT expected suffix of every log before writing a log-completion receipt.
 * This is not a portfolio commit marker; the portfolio revision is written afterwards.
 */
export async function completePaperApplicationLogs(portfolioPath: string, planHash: string,
  paths: PaperExecutionLogPaths): Promise<PaperApplicationLogReceipt> {
  paths = capturePaperExecutionLogPaths(paths);
  await sealPaperExecutionLogBatch(Object.values(paths));
  const plan = await readPaperApplicationLogPlan(portfolioPath, planHash);
  const application = await readPreparedPaperApplication(portfolioPath, plan.applicationHash);
  const after = {} as PaperApplicationLogReceipt["after"];
  for (const role of roles) {
    const value = await readLog(paths[role], true);
    verifySuffix(application, role, plan.before[role], value);
    after[role] = prefix(value);
  }
  await assertPaperExecutionLogBatchHeld(Object.values(paths));
  const payload = { schemaVersion: "paper_application_log_receipt.v1" as const, applicationHash: plan.applicationHash, planHash, after };
  const receipt = receiptSchema.parse({ ...payload, receiptHash: hashPreparedApplicationPayload(payload) });
  await writeExclusive(paperApplicationLogReceiptPath(portfolioPath, receipt.receiptHash), receipt);
  return receipt;
}

export async function readPaperApplicationLogPlan(portfolioPath: string, hash: string): Promise<PaperApplicationLogPlan> {
  const plan = await readCanonical(paperApplicationLogPlanPath(portfolioPath, hash), planSchema);
  const { planHash, ...payload } = plan;
  if (planHash !== hash || planHash !== hashPreparedApplicationPayload(payload)) throw new Error("paper log plan hash mismatch");
  return plan;
}

/** Read-only replay also works behind a failed lock. Later append-only suffixes are allowed.
 * Configured paths are required; a manifest cannot redirect this reader to another file.
 */
export async function readPaperApplicationLogReceipt(portfolioPath: string, hash: string,
  paths: PaperExecutionLogPaths): Promise<PaperApplicationLogReceipt> {
  paths = capturePaperExecutionLogPaths(paths);
  const receipt = await readCanonical(paperApplicationLogReceiptPath(portfolioPath, hash), receiptSchema);
  const { receiptHash, ...payload } = receipt;
  if (receiptHash !== hash || receiptHash !== hashPreparedApplicationPayload(payload)) throw new Error("paper log receipt hash mismatch");
  const plan = await readPaperApplicationLogPlan(portfolioPath, receipt.planHash);
  if (plan.applicationHash !== receipt.applicationHash) throw new Error("paper log receipt application origin mismatch");
  const application = await readPreparedPaperApplication(portfolioPath, receipt.applicationHash);
  for (const role of roles) {
    const current = await readLog(paths[role], false), expected = receipt.after[role];
    verifyPrefix(expected, current);
    verifySuffix(application, role, plan.before[role], { exists: expected.exists, bytes: current.bytes.subarray(0, expected.byteLength) });
  }
  return receipt;
}

function verifySuffix(application: PreparedPaperApplication, role: typeof roles[number], before: Prefix,
  after: { exists: boolean; bytes: Buffer }) {
  verifyPrefix(before, after);
  const expected = role === "audit" ? application.auditEvents : role === "decision" ? [application.decision]
    : application.steps.flatMap((step) => step.trade ? [step.trade] : []);
  const actual = parseLines(after.bytes.subarray(before.byteLength), true);
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`paper application ${role} log suffix mismatch`);
}
function verifyPrefix(expected: Prefix, actual: { exists: boolean; bytes: Buffer }) {
  if ((expected.exists && !actual.exists) || actual.bytes.length < expected.byteLength ||
    bytesHash(actual.bytes.subarray(0, expected.byteLength)) !== expected.hash) throw new Error("paper application log prefix mismatch");
}
function prefix(value: { exists: boolean; bytes: Buffer }): Prefix {
  return { exists: value.exists, byteLength: value.bytes.length, hash: bytesHash(value.bytes) };
}
function bytesHash(bytes: Buffer) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function parseLines(bytes: Buffer, canonical: boolean): unknown[] {
  if (bytes.length === 0) return [];
  const raw = decode(bytes);
  if (!raw.endsWith("\n")) throw new Error("paper application log has a torn final line");
  return raw.slice(0, -1).split("\n").map((line) => {
    const value: unknown = JSON.parse(line);
    if (canonical && JSON.stringify(value) !== line) throw new Error("paper application log suffix is not canonical");
    return value;
  });
}
async function readLog(path: string, durable: boolean): Promise<{ exists: boolean; bytes: Buffer }> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try { info = await lstat(path); }
  catch (error) { if (isCode(error, "ENOENT")) return { exists: false, bytes: Buffer.alloc(0) }; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error("paper application log must be an unaliased regular file");
  const handle = await open(path, durable ? "r+" : "r");
  try {
    const bytes = await handle.readFile();
    if (durable) await handle.sync();
    return { exists: true, bytes };
  } finally { await handle.close(); }
}
async function writeExclusive(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "wx");
  try { await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  await syncDirectory(dirname(path)); await syncDirectory(dirname(dirname(path)));
}
async function readCanonical<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const raw = decode(await readFile(path)), value = schema.parse(JSON.parse(raw));
  if (raw !== `${JSON.stringify(value)}\n`) throw new Error("paper application log record is not canonical");
  return value;
}
function decode(bytes: Buffer) {
  const raw = bytes.toString("utf8");
  if (!bytes.equals(Buffer.from(raw, "utf8"))) throw new Error("paper application log bytes are not valid UTF-8");
  return raw;
}
async function syncDirectory(path: string) {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r"); } catch (error) { if (unsupported(error)) return; throw error; }
  try { await handle.sync(); } catch (error) { if (!unsupported(error)) throw error; }
  finally { await handle.close(); }
}
function unsupported(error: unknown) { return process.platform === "win32" && isCode(error, "EPERM"); }
function isCode(error: unknown, code: string) { return error instanceof Error && "code" in error && error.code === code; }
function required(value: string) { if (!value) throw new Error("paper execution log path is required"); return value; }
