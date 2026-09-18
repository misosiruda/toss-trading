import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { createFundamentalEvidenceRecord, parseFundamentalEvidenceRecord, type FundamentalEvidencePayload, type FundamentalEvidenceRecord } from "./fundamentalEvidenceSource.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

export const FUNDAMENTAL_EVIDENCE_FILE_NAME = "fundamental-evidence-records.jsonl";
const entrySchema = z.object({ schemaVersion: z.literal("fundamental_evidence_entry.v1"), record: z.unknown(), appendStartedAt: offsetQualifiedIsoDateTimeSchema,
  previousCommitHash: sha256HashSchema.nullable(), entryHash: sha256HashSchema }).strict();
const commitSchema = z.object({ schemaVersion: z.literal("fundamental_evidence_commit.v1"), entryHash: sha256HashSchema,
  committedAt: offsetQualifiedIsoDateTimeSchema, commitHash: sha256HashSchema }).strict();
export function createFundamentalEvidencePaths(baseDir: string) { const dir = resolve(baseDir); return { recordsPath: join(dir, FUNDAMENTAL_EVIDENCE_FILE_NAME), lockPath: join(dir, `.${FUNDAMENTAL_EVIDENCE_FILE_NAME}.lock`) }; }

export class FundamentalEvidenceFileRepository {
  private readonly paths: ReturnType<typeof createFundamentalEvidencePaths>;
  constructor(baseDir: string) { this.paths = createFundamentalEvidencePaths(baseDir); }
  async readAll(): Promise<readonly FundamentalEvidenceRecord[]> {
    return this.withLock(() => this.readAllUnlocked());
  }
  async append(value: FundamentalEvidencePayload & { createdAt: string }): Promise<FundamentalEvidenceRecord> {
    const record = createFundamentalEvidenceRecord(value);
    return this.withLock(async () => {
      const records = await this.readAllUnlocked(); const existing = records.find((item) => item.evidenceRef === record.evidenceRef);
      if (existing) { if (!isDeepStrictEqual(existing, record)) throw new Error("fundamental evidence reference collision"); return existing; }
      const previousCommitHash = await this.lastCommitHash();
      const appendStartedAt = record.createdAt;
      const payloadWithoutHash = { schemaVersion: "fundamental_evidence_entry.v1" as const, record, appendStartedAt, previousCommitHash };
      const payload = { ...payloadWithoutHash, entryHash: hashCanonicalPayload(payloadWithoutHash) };
      const markerWithoutHash = { schemaVersion: "fundamental_evidence_commit.v1" as const, entryHash: payload.entryHash, committedAt: record.createdAt };
      const marker = { ...markerWithoutHash, commitHash: hashCanonicalPayload(markerWithoutHash) };
      await mkdir(dirname(this.paths.recordsPath), { recursive: true }); const handle = await open(this.paths.recordsPath, "a");
      try { await handle.writeFile(`${JSON.stringify(payload)}\n${JSON.stringify(marker)}\n`); await handle.sync(); } finally { await handle.close(); }
      return record;
    });
  }
  private async readAllUnlocked(): Promise<readonly FundamentalEvidenceRecord[]> {
    let raw: string; try { raw = await readFile(this.paths.recordsPath, "utf8"); } catch (error) { if (isCode(error, "ENOENT")) return []; throw error; }
    if (raw && !raw.endsWith("\n")) throw new Error("fundamental evidence journal has a torn final line");
    const lines = raw ? raw.trimEnd().split("\n") : []; if (lines.length % 2) throw new Error("fundamental evidence journal has an incomplete pair");
    const records: FundamentalEvidenceRecord[] = []; let generation: string | null = null;
    for (let i = 0; i < lines.length; i += 2) {
      const value: unknown = JSON.parse(lines[i]!); const entry = entrySchema.parse(value); const record = parseFundamentalEvidenceRecord(entry.record);
      const { entryHash, ...payload } = entry;
      if (!isDeepStrictEqual(value, entry) || entryHash !== hashCanonicalPayload(payload) || entry.previousCommitHash !== generation) throw new Error("fundamental evidence entry hash or predecessor mismatch");
      const markerValue: unknown = JSON.parse(lines[i + 1]!); const marker = commitSchema.parse(markerValue); const { commitHash, ...markerPayload } = marker;
      if (!isDeepStrictEqual(markerValue, marker) || marker.entryHash !== entryHash || commitHash !== hashCanonicalPayload(markerPayload)) throw new Error("fundamental evidence commit hash mismatch");
      records.push(record); generation = marker.commitHash;
    }
    return records;
  }
  private async lastCommitHash(): Promise<string | null> { try { const raw = await readFile(this.paths.recordsPath, "utf8"); if (!raw.trim()) return null; const lines = raw.trimEnd().split("\n"); return commitSchema.parse(JSON.parse(lines.at(-1)!)).commitHash; } catch (error) { if (isCode(error, "ENOENT")) return null; throw error; } }
  private async withLock<T>(operation: () => Promise<T>): Promise<T> { await mkdir(dirname(this.paths.recordsPath), { recursive: true }); let handle; try { handle = await open(this.paths.lockPath, "wx"); } catch (error) { throw new Error("fundamental evidence repository lock is unavailable", { cause: error }); } try { return await operation(); } finally { await handle.close(); await unlink(this.paths.lockPath).catch(() => undefined); } }
}
function isCode(error: unknown, code: string): boolean { return error instanceof Error && "code" in error && error.code === code; }
