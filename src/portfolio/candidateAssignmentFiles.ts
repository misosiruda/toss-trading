import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { bucketSelectionRequestObservationSchema, getDurableBucketSelectionRequestObservation,
  resolveObservedBucketSelectionRequestHistory, type VerifiedBucketSelectionRequestHistory } from "./bucketSelectionRequestFiles.js";
import { candidateAssignmentSchema, parseCandidateAssignment, resolveCandidateAssignmentSizingBinding, type CandidateAssignment } from "./candidateAssignment.js";
import { createCandidateAssignmentSetRecord, parseCandidateAssignmentSetRecord, resolveCandidateAssignmentSetBinding,
  type CandidateAssignmentSetRecord } from "./candidateAssignmentSet.js";
import { CandidateSizingInputFileRepository, getDurableCandidateSizingInputObservation,
  type VerifiedCandidateSizingInputHistory } from "./candidateSizingInputFiles.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

export const CANDIDATE_ASSIGNMENT_RECORDS_FILE_NAME = "candidate-assignment-records.jsonl";
const sourceSchema = z.object({ requestObservation: bucketSelectionRequestObservationSchema,
  sizingInputObservation: z.object({ originCount: z.number().int().nonnegative().safe().refine((value) => !Object.is(value, -0)),
    generationHash: sha256HashSchema.nullable(), observedAt: offsetQualifiedIsoDateTimeSchema }).strict() }).strict();
type Source = Readonly<z.infer<typeof sourceSchema>>;
const entrySchema = z.object({ schemaVersion: z.literal("candidate_assignment_entry.v1"), kind: z.enum(["assignment", "set"]),
  record: z.unknown(), source: sourceSchema, previousCommitHash: sha256HashSchema.nullable(),
  appendStartedAt: offsetQualifiedIsoDateTimeSchema, entryHash: sha256HashSchema }).strict();
const markerSchema = z.object({ schemaVersion: z.literal("candidate_assignment_commit.v1"), entryHash: sha256HashSchema,
  committedAt: offsetQualifiedIsoDateTimeSchema, commitHash: sha256HashSchema }).strict();
type RecordValue = { readonly kind: "assignment"; readonly record: CandidateAssignment } |
  { readonly kind: "set"; readonly record: CandidateAssignmentSetRecord };
export type VerifiedCandidateAssignmentOrigin = RecordValue & { readonly source: Source; readonly appendStartedAt: string;
  readonly committedAt: string; readonly entryHash: string; readonly commitHash: string };
export interface VerifiedCandidateAssignmentHistory {
  readonly origins: readonly VerifiedCandidateAssignmentOrigin[];
  readonly generationHash: string | null;
}
const observations = new WeakMap<VerifiedCandidateAssignmentHistory, string>();
export function getDurableCandidateAssignmentObservation(history: VerifiedCandidateAssignmentHistory): string {
  const observedAt = observations.get(history);
  if (observedAt === undefined) throw new Error("candidate assignment history lacks a durable observation lease");
  return observedAt;
}
export function createCandidateAssignmentPaths(baseDir: string) {
  return { recordsPath: join(baseDir, CANDIDATE_ASSIGNMENT_RECORDS_FILE_NAME),
    lockPath: join(baseDir, `.${CANDIDATE_ASSIGNMENT_RECORDS_FILE_NAME}.lock`), pendingPath: join(baseDir, ".candidate-assignment-pending.json") };
}

/** One append-only journal serializes assignment creation and per-request seal. Not eligibility, sizing or current capacity authority. */
export class CandidateAssignmentFileRepository {
  private readonly baseDir: string;
  private readonly paths: ReturnType<typeof createCandidateAssignmentPaths>;
  private readonly options: { lockTimeoutMs: number; lockRetryDelayMs: number };
  constructor(baseDir: string, options: { lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {
    this.baseDir = resolve(z.string().min(1).parse(baseDir));
    this.paths = createCandidateAssignmentPaths(this.baseDir);
    this.options = { lockTimeoutMs: positive(options.lockTimeoutMs ?? 5000), lockRetryDelayMs: positive(options.lockRetryDelayMs ?? 10) };
  }
  async readAll(): Promise<readonly VerifiedCandidateAssignmentOrigin[]> {
    return this.withDurableVerifiedHistory(async (history) => history.origins);
  }
  /** Holds request -> snapshot -> sizing input -> assignment locks. Consumers must not re-enter any of these repositories. */
  async withDurableVerifiedHistory<T>(operation: (history: VerifiedCandidateAssignmentHistory,
    inputs: VerifiedCandidateSizingInputHistory, requests: VerifiedBucketSelectionRequestHistory) => Promise<T>): Promise<T> {
    return this.withSources((inputs, requests) => this.withLock(async () => {
      const { history, observedAt } = await this.readUnderLock(inputs, requests);
      observations.set(history, observedAt);
      try { return await operation(history, inputs, requests); } finally { observations.delete(history); }
    }));
  }
  async appendAssignment(value: unknown): Promise<VerifiedCandidateAssignmentOrigin & { kind: "assignment" }> {
    const record = parseCandidateAssignment(value);
    return this.withSources((inputs, requests) => this.withLock(async () => {
      const { history, index } = await this.readUnderLock(inputs, requests);
      const existing = index.assignments.get(record.assignmentId);
      if (existing) {
        if (!isDeepStrictEqual(existing.record, record)) throw new Error("candidate assignment ID collision");
        return existing;
      }
      const result = await this.persist({ kind: "assignment", record }, inputs, requests, history, index);
      if (result.kind !== "assignment") throw new Error("unexpected candidate assignment entry kind");
      return result;
    }));
  }
  /** Caller supplies no assignment subset or allocation. Same request retry returns its already verified immutable set. */
  async sealRequest(requestId: string): Promise<VerifiedCandidateAssignmentOrigin & { kind: "set" }> {
    const id = candidateAssignmentSchema.shape.requestId.parse(requestId);
    return this.withSources((inputs, requests) => this.withLock(async () => {
      const { history, index } = await this.readUnderLock(inputs, requests);
      const existing = index.sets.get(id);
      if (existing) return existing;
      const request = requests.requests.find((item) => item.requestId === id);
      if (!request) throw new Error("candidate assignment request source is missing");
      const record = createCandidateAssignmentSetRecord({ request, assignments: index.byRequest.get(id) ?? [], createdAt: new Date().toISOString() });
      const result = await this.persist({ kind: "set", record }, inputs, requests, history, index);
      if (result.kind !== "set") throw new Error("unexpected candidate assignment entry kind");
      return result;
    }));
  }
  private withSources<T>(operation: (inputs: VerifiedCandidateSizingInputHistory, requests: VerifiedBucketSelectionRequestHistory) => Promise<T>) {
    return new CandidateSizingInputFileRepository(this.baseDir, this.options).withDurableVerifiedHistory(operation);
  }
  private async persist(value: RecordValue, inputs: VerifiedCandidateSizingInputHistory, requests: VerifiedBucketSelectionRequestHistory,
    history: VerifiedCandidateAssignmentHistory, index: ReturnType<typeof createIndex>): Promise<VerifiedCandidateAssignmentOrigin> {
    const source = freeze({ requestObservation: getDurableBucketSelectionRequestObservation(requests), sizingInputObservation: {
      originCount: inputs.origins.length, generationHash: inputs.generationHash, observedAt: getDurableCandidateSizingInputObservation(inputs) } });
    const appendStartedAt = new Date().toISOString();
    validate(value, source, appendStartedAt, inputs, requests, index);
    const previous = history.origins.at(-1);
    if (previous && Date.parse(appendStartedAt) < Date.parse(previous.committedAt)) throw new Error("candidate assignment append clock moved backwards");
    const payload = { schemaVersion: "candidate_assignment_entry.v1" as const, ...value, source, appendStartedAt, previousCommitHash: history.generationHash };
    const entryHash = hashCanonicalPayload(payload);
    const pending = await open(this.paths.pendingPath, "wx");
    try { await pending.writeFile(`${JSON.stringify({ entryHash })}\n`); await pending.sync(); } finally { await pending.close(); }
    await syncDirectory(this.baseDir);
    await appendLine(this.paths.recordsPath, { ...payload, entryHash });
    const committedAt = new Date().toISOString();
    if (Date.parse(committedAt) < Date.parse(appendStartedAt)) throw new Error("candidate assignment commit clock moved backwards");
    const marker = { schemaVersion: "candidate_assignment_commit.v1" as const, entryHash, committedAt };
    const commitHash = hashCanonicalPayload(marker);
    await appendLine(this.paths.recordsPath, { ...marker, commitHash });
    if (Date.now() < Date.parse(committedAt)) throw new Error("candidate assignment flush clock moved backwards");
    await unlink(this.paths.pendingPath);
    await syncDirectory(this.baseDir);
    return freeze({ ...value, source, appendStartedAt, committedAt, entryHash, commitHash });
  }
  private async readUnderLock(inputs: VerifiedCandidateSizingInputHistory, requests: VerifiedBucketSelectionRequestHistory) {
    try { await lstat(this.paths.pendingPath); throw new Error("candidate assignment pending append requires explicit recovery"); }
    catch (error) { if (!isCode(error, "ENOENT")) throw error; }
    const { raw, observedAt } = await readDurable(this.paths.recordsPath);
    if (Date.parse(observedAt) < Date.parse(getDurableCandidateSizingInputObservation(inputs))) throw new Error("candidate assignment observation clock moved backwards");
    if (raw && !raw.endsWith("\n")) throw new Error("candidate assignment torn final line");
    const lines = raw.split(/\r?\n/); lines.pop();
    const origins: VerifiedCandidateAssignmentOrigin[] = [], index = createIndex(inputs);
    let generationHash: string | null = null, previousTime: string | undefined;
    for (let line = 0; line < lines.length; line += 2) {
      try {
        const rawEntry: unknown = JSON.parse(lines[line]!);
        const entry = entrySchema.parse(rawEntry), { entryHash, ...payload } = entry;
        if (!isDeepStrictEqual(entry, rawEntry) || entryHash !== hashCanonicalPayload(payload) || entry.previousCommitHash !== generationHash) {
          throw new Error("candidate assignment entry hash or predecessor mismatch");
        }
        const rawMarker: unknown = JSON.parse(lines[line + 1] ?? "");
        const marker = markerSchema.parse(rawMarker), { commitHash, ...markerPayload } = marker;
        if (!isDeepStrictEqual(marker, rawMarker) || marker.entryHash !== entryHash || commitHash !== hashCanonicalPayload(markerPayload) ||
          Date.parse(marker.committedAt) < Date.parse(entry.appendStartedAt) || Date.parse(marker.committedAt) > Date.parse(observedAt) ||
          (previousTime !== undefined && Date.parse(entry.appendStartedAt) < Date.parse(previousTime))) throw new Error("candidate assignment commit hash or chronology mismatch");
        const value: RecordValue = entry.kind === "assignment" ? { kind: "assignment", record: parseCandidateAssignment(entry.record) } :
          { kind: "set", record: parseCandidateAssignmentSetRecord(entry.record) };
        validate(value, entry.source, entry.appendStartedAt, inputs, requests, index);
        const origin = freeze({ ...value, source: entry.source, appendStartedAt: entry.appendStartedAt,
          committedAt: marker.committedAt, entryHash, commitHash });
        if (origin.kind === "assignment") {
          index.assignments.set(origin.record.assignmentId, origin);
          const list = index.byRequest.get(origin.record.requestId) ?? [];
          list.push(origin.record); index.byRequest.set(origin.record.requestId, list);
        } else index.sets.set(origin.record.requestId, origin);
        origins.push(origin); generationHash = commitHash; previousTime = marker.committedAt;
      } catch (cause) { throw new Error(`candidate assignment corrupt entry at line ${line + 1}`, { cause }); }
    }
    return { history: freeze({ origins, generationHash }), index, observedAt };
  }
  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.baseDir, { recursive: true });
    let directory = await realpath(this.baseDir);
    while (true) { await syncDirectory(directory); const parent = dirname(directory); if (directory === parent) break; directory = parent; }
    const release = await acquireLock(this.paths.lockPath, this.options);
    try { return await operation(); } finally { await release(); }
  }
}

function createIndex(inputs: VerifiedCandidateSizingInputHistory) {
  return { assignments: new Map<string, VerifiedCandidateAssignmentOrigin & { kind: "assignment" }>(),
    sets: new Map<string, VerifiedCandidateAssignmentOrigin & { kind: "set" }>(), byRequest: new Map<string, CandidateAssignment[]>(),
    inputs: new Map(inputs.origins.map((origin, ordinal) => [origin.record.sizingInputRecordId, { origin, ordinal }])) };
}
function validate(value: RecordValue, source: Source, appendStartedAt: string, inputs: VerifiedCandidateSizingInputHistory,
  requests: VerifiedBucketSelectionRequestHistory, index: ReturnType<typeof createIndex>) {
  const observation = source.sizingInputObservation;
  const currentObservedAt = getDurableCandidateSizingInputObservation(inputs);
  const prefixEnd = observation.originCount === 0 ? null : inputs.origins[observation.originCount - 1]?.commitHash;
  if (observation.originCount > inputs.origins.length || prefixEnd !== observation.generationHash ||
    Date.parse(observation.observedAt) > Date.parse(currentObservedAt) || Date.parse(observation.observedAt) > Date.parse(appendStartedAt) ||
    Date.parse(source.requestObservation.observedAt) > Date.parse(appendStartedAt) || Date.parse(value.record.createdAt) > Date.parse(appendStartedAt) ||
    (observation.originCount > 0 && Date.parse(inputs.origins[observation.originCount - 1]!.committedAt) > Date.parse(observation.observedAt))) {
    throw new Error("candidate assignment sizing source prefix or chronology mismatch");
  }
  const request = resolveObservedBucketSelectionRequestHistory(requests, source.requestObservation).find((item) => item.requestId === value.record.requestId);
  if (!request) throw new Error("candidate assignment request source is missing");
  if (index.sets.has(request.requestId)) throw new Error("candidate assignment request is already sealed");
  if (value.kind === "assignment") {
    if (index.assignments.has(value.record.assignmentId)) throw new Error("candidate assignment duplicate identity");
    const actual = index.inputs.get(value.record.sizingInputRecordId);
    if (!actual || actual.ordinal >= observation.originCount) throw new Error("candidate assignment sizing input source is missing");
    resolveCandidateAssignmentSizingBinding({ assignment: value.record, sizingInput: actual.origin.record, request });
    if (Date.parse(actual.origin.committedAt) > Date.parse(value.record.createdAt)) throw new Error("candidate assignment predates actual sizing input commit");
  } else {
    resolveCandidateAssignmentSetBinding({ set: value.record, request, assignments: index.byRequest.get(request.requestId) ?? [] });
    // A set must be created after all of its actual assignment commits, not merely their declared createdAt.
    for (const assignment of index.byRequest.get(request.requestId) ?? []) {
      if (Date.parse(index.assignments.get(assignment.assignmentId)!.committedAt) > Date.parse(value.record.createdAt)) {
        throw new Error("candidate assignment set predates actual assignment commit");
      }
    }
  }
}
async function readDurable(path: string): Promise<{ raw: string; observedAt: string }> {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r+"); }
  catch (error) {
    if (!isCode(error, "ENOENT")) throw error;
    await syncDirectory(dirname(path)); const observedAt = new Date().toISOString();
    try { await lstat(path); } catch (recheck) { if (isCode(recheck, "ENOENT")) return { raw: "", observedAt }; throw recheck; }
    throw new Error("candidate assignment source appeared during observation");
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !(await lstat(path)).isFile()) throw new Error("candidate assignment source must be a regular file");
    const bytes = await handle.readFile(); await handle.sync(); await syncDirectory(dirname(path));
    const observedAt = new Date().toISOString(), checked = Buffer.alloc(bytes.length);
    let offset = 0;
    while (offset < checked.length) { const { bytesRead } = await handle.read(checked, offset, checked.length - offset, offset);
      if (!bytesRead) throw new Error("candidate assignment source changed during observation"); offset += bytesRead; }
    const after = await handle.stat({ bigint: true });
    if (!(await lstat(path)).isFile()) throw new Error("candidate assignment source must be a regular file");
    const namedHandle = await open(path, "r");
    let named; try { named = await namedHandle.stat({ bigint: true }); } finally { await namedHandle.close(); }
    if (!bytes.equals(checked) || before.size !== BigInt(bytes.length) || before.dev !== after.dev || before.ino !== after.ino ||
      before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || after.dev !== named.dev ||
      after.ino !== named.ino || after.size !== named.size || after.mtimeNs !== named.mtimeNs || after.ctimeNs !== named.ctimeNs) {
      throw new Error("candidate assignment source changed during observation");
    }
    const raw = bytes.toString("utf8"); if (!Buffer.from(raw, "utf8").equals(bytes)) throw new Error("candidate assignment invalid UTF-8");
    return { raw, observedAt };
  } finally { await handle.close(); }
}
async function appendLine(path: string, value: unknown) {
  const handle = await open(path, "a");
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(dirname(path));
}
async function syncDirectory(path: string) {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r"); } catch (error) { if (process.platform === "win32" && isCode(error, "EPERM")) return; throw error; }
  try { await handle.sync(); } catch (error) { if (!(process.platform === "win32" && isCode(error, "EPERM"))) throw error; }
  finally { await handle.close(); }
}
async function acquireLock(path: string, options: { lockTimeoutMs: number; lockRetryDelayMs: number }): Promise<() => Promise<void>> {
  const deadline = performance.now() + options.lockTimeoutMs; let lastError: unknown;
  while (performance.now() < deadline) {
    let handle: Awaited<ReturnType<typeof open>>;
    try { handle = await open(path, "wx"); } catch (error) {
      if (!(isCode(error, "EEXIST") || (process.platform === "win32" && isCode(error, "EPERM")))) throw error;
      lastError = error; await new Promise((done) => setTimeout(done, Math.min(options.lockRetryDelayMs, Math.max(0, deadline - performance.now())))); continue;
    }
    const token = `${randomUUID()}\n`;
    try { await handle.writeFile(token); await handle.sync(); } catch (error) { await handle.close(); throw error; }
    return async () => {
      try { if (await readFile(path, "utf8") !== token) throw new Error("candidate assignment lock ownership changed"); } finally { await handle.close(); }
      await unlink(path); await syncDirectory(dirname(path));
    };
  }
  throw new Error("candidate assignment repository lock is unavailable", { cause: lastError });
}
function positive(value: number) { if (!Number.isSafeInteger(value) || value <= 0) throw new Error("lock option must be a positive safe integer"); return value; }
function isCode(error: unknown, code: string): boolean { return error instanceof Error && "code" in error && error.code === code; }
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
