import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { getDurableBucketSelectionRequestObservation, bucketSelectionRequestObservationSchema,
  resolveObservedBucketSelectionRequestHistory, type VerifiedBucketSelectionRequestHistory } from "./bucketSelectionRequestFiles.js";
import { CandidateAssignmentFileRepository, getDurableCandidateAssignmentObservation, type VerifiedCandidateAssignmentHistory } from "./candidateAssignmentFiles.js";
import { getDurableCandidateSizingInputObservation, type VerifiedCandidateSizingInputHistory } from "./candidateSizingInputFiles.js";
import { resolveCandidateAssignmentSizingBinding } from "./candidateAssignment.js";
import { parseSelectorOpeningCapacityReservationRecord, type SelectorOpeningCapacityReservationRecord } from "./selectorOpeningCapacityReservation.js";
import { getDurablePortfolioSizingSnapshotObservation, portfolioSizingSnapshotObservationSchema,
  resolveObservedPortfolioSizingSnapshotHistory, type VerifiedPortfolioSizingSnapshotHistory } from "./portfolioSizingSnapshotFiles.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

export const SELECTOR_OPENING_CAPACITY_RESERVATIONS_FILE_NAME = "selector-opening-capacity-reservations.jsonl";
const journalObservationSchema = z.object({ originCount: z.number().int().nonnegative().safe().refine((value) => !Object.is(value, -0)),
  generationHash: sha256HashSchema.nullable(), observedAt: offsetQualifiedIsoDateTimeSchema }).strict();
const sourceSchema = z.object({ requestObservation: bucketSelectionRequestObservationSchema,
  snapshotObservation: portfolioSizingSnapshotObservationSchema, assignmentObservation: journalObservationSchema,
  sizingInputObservation: journalObservationSchema }).strict();
type Source = Readonly<z.infer<typeof sourceSchema>>;
const entrySchema = z.object({ schemaVersion: z.literal("selector_capacity_reservation_entry.v1"), record: z.unknown(), source: sourceSchema,
  appendStartedAt: offsetQualifiedIsoDateTimeSchema, previousCommitHash: sha256HashSchema.nullable(), entryHash: sha256HashSchema }).strict();
const commitSchema = z.object({ schemaVersion: z.literal("selector_capacity_reservation_commit.v1"), entryHash: sha256HashSchema,
  committedAt: offsetQualifiedIsoDateTimeSchema, commitHash: sha256HashSchema }).strict();

export interface VerifiedSelectorCapacityReservationOrigin {
  readonly record: SelectorOpeningCapacityReservationRecord;
  readonly source: Source;
  readonly appendStartedAt: string;
  readonly committedAt: string;
  readonly entryHash: string;
  readonly commitHash: string;
}
export interface VerifiedSelectorCapacityReservationHistory {
  readonly origins: readonly VerifiedSelectorCapacityReservationOrigin[];
  readonly generationHash: string | null;
}
const observations = new WeakMap<VerifiedSelectorCapacityReservationHistory, string>();

/** Actual source locks and the reservation lock are held only during this observation's callback. */
export function getDurableSelectorCapacityReservationObservation(history: VerifiedSelectorCapacityReservationHistory): string {
  const observedAt = observations.get(history);
  if (observedAt === undefined) throw new Error("selector capacity history lacks a durable observation lease");
  return observedAt;
}

export function createSelectorOpeningCapacityReservationPaths(baseDir: string) {
  return { recordsPath: join(baseDir, SELECTOR_OPENING_CAPACITY_RESERVATIONS_FILE_NAME),
    lockPath: join(baseDir, `.${SELECTOR_OPENING_CAPACITY_RESERVATIONS_FILE_NAME}.lock`),
    pendingPath: join(baseDir, ".selector-opening-capacity-reservation-pending.json") };
}

/** Source-bound immutable records, not current capacity allocation or an atomic mandate transaction. */
export class SelectorOpeningCapacityReservationFileRepository {
  private readonly paths: ReturnType<typeof createSelectorOpeningCapacityReservationPaths>;
  private readonly options: { lockTimeoutMs: number; lockRetryDelayMs: number };
  private readonly baseDir: string;
  constructor(baseDir: string, options: { lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {
    this.baseDir = resolve(z.string().min(1).parse(baseDir));
    this.paths = createSelectorOpeningCapacityReservationPaths(this.baseDir);
    this.options = { lockTimeoutMs: positiveInteger(options.lockTimeoutMs ?? 5000),
      lockRetryDelayMs: positiveInteger(options.lockRetryDelayMs ?? 10) };
  }

  async readAll(): Promise<readonly VerifiedSelectorCapacityReservationOrigin[]> {
    return this.withDurableVerifiedHistory(async (history) => history.origins);
  }

  /** Request -> snapshot -> sizing -> assignment -> reservation. Consumers must not re-enter these stores. */
  async withDurableVerifiedHistory<T>(operation: (history: VerifiedSelectorCapacityReservationHistory) => Promise<T>): Promise<T> {
    return this.withSources((sources) => this.withLock(async () => {
      const { history, observedAt } = await this.readUnderLock(sources);
      observations.set(history, observedAt);
      try { return await operation(history); }
      finally { observations.delete(history); }
    }));
  }

  async append(value: unknown): Promise<VerifiedSelectorCapacityReservationOrigin> {
    const record = parseSelectorOpeningCapacityReservationRecord(value);
    return this.withSources((sources) => this.withLock(async () => {
      const { history } = await this.readUnderLock(sources);
      const existing = history.origins.find((item) => item.record.selectorCapacityReservationId === record.selectorCapacityReservationId);
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing.record, record)) throw new Error("selector capacity reservation ID collision");
        return existing;
      }
      if (history.origins.some((item) => item.record.candidateAssignmentId === record.candidateAssignmentId)) {
        throw new Error("selector capacity assignment already has an issuance");
      }
      const source = captureSource(sources);
      const appendStartedAt = new Date().toISOString();
      verifySource(record, source, sources, appendStartedAt);
      const previous = history.origins.at(-1);
      if (previous && Date.parse(appendStartedAt) < Date.parse(previous.committedAt)) throw new Error("selector capacity append clock moved backwards");
      const payload = { schemaVersion: "selector_capacity_reservation_entry.v1" as const, record, source,
        appendStartedAt, previousCommitHash: history.generationHash };
      const entryHash = hashCanonicalPayload(payload);
      // An interrupted entry/marker write remains fail-closed, even when a complete line is visible.
      const pending = await open(this.paths.pendingPath, "wx");
      try { await pending.writeFile(`${JSON.stringify({ entryHash })}\n`); await pending.sync(); }
      finally { await pending.close(); }
      await syncDirectory(dirname(this.paths.pendingPath));
      await appendLine(this.paths.recordsPath, { ...payload, entryHash });
      const committedAt = new Date().toISOString();
      if (Date.parse(committedAt) < Date.parse(appendStartedAt)) throw new Error("selector capacity commit clock moved backwards");
      const marker = { schemaVersion: "selector_capacity_reservation_commit.v1" as const, entryHash, committedAt };
      const commitHash = hashCanonicalPayload(marker);
      await appendLine(this.paths.recordsPath, { ...marker, commitHash });
      if (Date.now() < Date.parse(committedAt)) throw new Error("selector capacity flush clock moved backwards");
      await unlink(this.paths.pendingPath);
      await syncDirectory(dirname(this.paths.pendingPath));
      return Object.freeze({ record, source, appendStartedAt, committedAt, entryHash, commitHash });
    }));
  }

  private withSources<T>(operation: (sources: Sources) => Promise<T>): Promise<T> {
    return new CandidateAssignmentFileRepository(this.baseDir, this.options).withDurableVerifiedHistory((assignments, inputs, requests, snapshots) =>
      operation({ assignments, inputs, requests, snapshots, index: createSourceIndex(assignments, inputs) }));
  }

  private async readUnderLock(sources: Sources) {
    try { await lstat(this.paths.pendingPath); throw new Error("selector capacity pending append requires explicit recovery"); }
    catch (error) { if (!isCode(error, "ENOENT")) throw error; }
    const { raw, observedAt } = await readDurableRaw(this.paths.recordsPath);
    if (Date.parse(observedAt) < Date.parse(getDurableCandidateAssignmentObservation(sources.assignments)) || Date.now() < Date.parse(observedAt)) {
      throw new Error("selector capacity observation clock moved backwards");
    }
    if (raw && !raw.endsWith("\n")) throw new Error("selector capacity file has a torn final line");
    const lines = raw.split(/\r?\n/); lines.pop();
    const origins: VerifiedSelectorCapacityReservationOrigin[] = [];
    const ids = new Set<string>(), assignmentIds = new Set<string>();
    let generationHash: string | null = null;
    let previousTime: string | undefined;
    for (let index = 0; index < lines.length; index += 2) {
      try {
        const value: unknown = JSON.parse(lines[index]!);
        const entry = entrySchema.parse(value);
        const record = parseSelectorOpeningCapacityReservationRecord(entry.record);
        const { entryHash, ...payload } = entry;
        if (!isDeepStrictEqual(entry, value) || entryHash !== hashCanonicalPayload(payload) || entry.previousCommitHash !== generationHash) {
          throw new Error("selector capacity entry hash or predecessor mismatch");
        }
        const markerValue: unknown = JSON.parse(lines[index + 1] ?? "");
        const marker = commitSchema.parse(markerValue);
        const { commitHash, ...markerPayload } = marker;
        if (!isDeepStrictEqual(markerValue, marker) || marker.entryHash !== entryHash || commitHash !== hashCanonicalPayload(markerPayload) ||
          Date.parse(marker.committedAt) < Date.parse(entry.appendStartedAt) || Date.parse(marker.committedAt) > Date.parse(observedAt) ||
          (previousTime !== undefined && Date.parse(entry.appendStartedAt) < Date.parse(previousTime))) {
          throw new Error("selector capacity commit hash or chronology mismatch");
        }
        verifySource(record, entry.source, sources, entry.appendStartedAt);
        if (ids.has(record.selectorCapacityReservationId)) throw new Error("selector capacity duplicate reservation ID");
        ids.add(record.selectorCapacityReservationId);
        if (assignmentIds.has(record.candidateAssignmentId)) throw new Error("selector capacity duplicate assignment issuance");
        assignmentIds.add(record.candidateAssignmentId);
        origins.push(Object.freeze({ record, source: freezeSource(entry.source), appendStartedAt: entry.appendStartedAt,
          committedAt: marker.committedAt, entryHash, commitHash }));
        generationHash = commitHash;
        previousTime = marker.committedAt;
      } catch (cause) { throw new Error(`selector capacity corrupt entry at line ${index + 1}`, { cause }); }
    }
    return { history: Object.freeze({ origins: Object.freeze(origins), generationHash }), observedAt };
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.baseDir, { recursive: true });
    let directory = await realpath(this.baseDir);
    while (true) {
      await syncDirectory(directory);
      const parent = dirname(directory);
      if (directory === parent) break;
      directory = parent;
    }
    const release = await acquireLock(this.paths.lockPath, this.options);
    try { return await operation(); } finally { await release(); }
  }
}

type Sources = {
  assignments: VerifiedCandidateAssignmentHistory; inputs: VerifiedCandidateSizingInputHistory;
  requests: VerifiedBucketSelectionRequestHistory; snapshots: VerifiedPortfolioSizingSnapshotHistory;
  index: ReturnType<typeof createSourceIndex>;
};
function createSourceIndex(assignments: VerifiedCandidateAssignmentHistory, inputs: VerifiedCandidateSizingInputHistory) {
  return {
    assignments: new Map(assignments.origins.flatMap((origin, ordinal) => origin.kind === "assignment" ? [[origin.record.assignmentId, { origin, ordinal }] as const] : [])),
    sets: new Map(assignments.origins.flatMap((origin, ordinal) => origin.kind === "set" ? [[origin.record.candidateAssignmentSetId, { origin, ordinal }] as const] : [])),
    inputs: new Map(inputs.origins.map((origin, ordinal) => [origin.record.sizingInputRecordId, { origin, ordinal }])),
    selections: new Map(assignments.origins.flatMap((origin) => origin.kind === "set"
      ? origin.record.selectedAssignments.map((row) => [row.assignmentId, row] as const) : []))
  };
}
function captureSource(sources: Sources): Source {
  return freezeSource({ requestObservation: getDurableBucketSelectionRequestObservation(sources.requests),
    snapshotObservation: getDurablePortfolioSizingSnapshotObservation(sources.snapshots),
    assignmentObservation: { originCount: sources.assignments.origins.length, generationHash: sources.assignments.generationHash,
      observedAt: getDurableCandidateAssignmentObservation(sources.assignments) },
    sizingInputObservation: { originCount: sources.inputs.origins.length, generationHash: sources.inputs.generationHash,
      observedAt: getDurableCandidateSizingInputObservation(sources.inputs) } });
}
function verifyJournalPrefix(history: { origins: readonly { commitHash: string; committedAt: string }[] },
  observation: z.infer<typeof journalObservationSchema>, currentObservedAt: string, appendStartedAt: string) {
  const last = observation.originCount === 0 ? null : history.origins[observation.originCount - 1];
  if (observation.originCount > history.origins.length || (last?.commitHash ?? null) !== observation.generationHash ||
    Date.parse(observation.observedAt) > Date.parse(currentObservedAt) || Date.parse(observation.observedAt) > Date.parse(appendStartedAt) ||
    (last && Date.parse(last.committedAt) > Date.parse(observation.observedAt))) throw new Error("selector capacity journal source prefix or chronology mismatch");
}
function verifySource(record: SelectorOpeningCapacityReservationRecord, source: Source, sources: Sources, appendStartedAt: string) {
  const timeline = [source.requestObservation.observedAt, source.snapshotObservation.observedAt,
    source.sizingInputObservation.observedAt, source.assignmentObservation.observedAt, appendStartedAt].map(Date.parse);
  if (timeline.some((time, index) => index > 0 && time < timeline[index - 1]!)) throw new Error("selector capacity source observation clock moved backwards");
  verifyJournalPrefix(sources.assignments, source.assignmentObservation, getDurableCandidateAssignmentObservation(sources.assignments), appendStartedAt);
  verifyJournalPrefix(sources.inputs, source.sizingInputObservation, getDurableCandidateSizingInputObservation(sources.inputs), appendStartedAt);
  const request = resolveObservedBucketSelectionRequestHistory(sources.requests, source.requestObservation)
    .find((item) => item.requestId === record.selectionRequestId);
  const snapshot = resolveObservedPortfolioSizingSnapshotHistory(sources.snapshots, source.snapshotObservation)
    .find((item) => item.portfolioSnapshotId === record.currentPortfolioSnapshotId);
  const candidate = sources.index.assignments.get(record.candidateAssignmentId), set = sources.index.sets.get(record.candidateAssignmentSetId);
  const selected = sources.index.selections.get(record.candidateAssignmentId);
  if (!request || !snapshot || !candidate || !set || !selected ||
    candidate.ordinal >= source.assignmentObservation.originCount || set.ordinal >= source.assignmentObservation.originCount) {
    throw new Error("selector capacity actual source is missing from its observed prefix");
  }
  const assignment = candidate.origin.record;
  const sizing = sources.index.inputs.get(assignment.sizingInputRecordId);
  if (!sizing || sizing.ordinal >= source.sizingInputObservation.originCount) throw new Error("selector capacity actual sizing source is missing");
  // The held assignment repository has already replayed each complete sealed set exactly once.
  // Do not replay the full set again for every issued candidate.
  const binding = resolveCandidateAssignmentSizingBinding({ assignment, request, sizingInput: sizing.origin.record });
  if (record.selectionRequestHash !== request.requestHash || set.origin.record.requestId !== request.requestId ||
    record.candidateAssignmentSetHash !== set.origin.record.candidateAssignmentSetHash ||
    record.candidateAssignmentHash !== assignment.assignmentHash || selected.assignmentHash !== assignment.assignmentHash ||
    record.selectedRank !== selected.selectedRank || record.reservedMaximumNotionalKrw !== selected.reservedMaximumNotionalKrw ||
    binding.sizingInput.executionCostInput.side !== "BUY") throw new Error("selector capacity actual allocation source mismatch");
  for (const key of ["portfolioId", "policyHash", "bucket", "market", "symbol"] as const) {
    if (record[key] !== assignment[key]) throw new Error("selector capacity actual assignment scope mismatch");
  }
  if (snapshot.portfolioSnapshotHash !== record.currentPortfolioSnapshotHash || snapshot.portfolioId !== record.portfolioId ||
    snapshot.policyHash !== record.policyHash || Date.parse(snapshot.asOf) < Date.parse(request.asOf) ||
    Date.parse(snapshot.asOf) > Date.parse(record.createdAt) || Date.parse(snapshot.asOf) > Date.parse(source.snapshotObservation.observedAt) ||
    Date.parse(set.origin.committedAt) > Date.parse(record.createdAt) || Date.parse(record.createdAt) > Date.parse(appendStartedAt) ||
    Date.parse(source.requestObservation.observedAt) > Date.parse(appendStartedAt) ||
    Date.parse(source.snapshotObservation.observedAt) > Date.parse(appendStartedAt)) {
    throw new Error("selector capacity snapshot source or availability mismatch");
  }
}
function freezeSource(source: Source): Source {
  return Object.freeze({ requestObservation: Object.freeze({ ...source.requestObservation }),
    snapshotObservation: Object.freeze({ ...source.snapshotObservation }), assignmentObservation: Object.freeze({ ...source.assignmentObservation }),
    sizingInputObservation: Object.freeze({ ...source.sizingInputObservation }) });
}

async function readDurableRaw(path: string): Promise<{ raw: string; observedAt: string }> {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r+"); }
  catch (error) {
    if (!isCode(error, "ENOENT")) throw error;
    await syncDirectory(dirname(path));
    const observedAt = new Date().toISOString();
    try { await lstat(path); } catch (recheck) { if (isCode(recheck, "ENOENT")) return { raw: "", observedAt }; throw recheck; }
    throw new Error("selector capacity source appeared during observation");
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !(await lstat(path)).isFile()) throw new Error("selector capacity source must be a regular file");
    const bytes = await handle.readFile();
    await handle.sync();
    await syncDirectory(dirname(path));
    const observedAt = new Date().toISOString();
    const verified = Buffer.alloc(bytes.length);
    let offset = 0;
    while (offset < verified.length) {
      const { bytesRead } = await handle.read(verified, offset, verified.length - offset, offset);
      if (!bytesRead) throw new Error("selector capacity source changed during observation");
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (!(await lstat(path)).isFile()) throw new Error("selector capacity source must be a regular file");
    const namedHandle = await open(path, "r");
    let named;
    try { named = await namedHandle.stat({ bigint: true }); } finally { await namedHandle.close(); }
    if (!bytes.equals(verified) || before.size !== BigInt(bytes.length) || before.dev !== after.dev || before.ino !== after.ino ||
      before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
      after.dev !== named.dev || after.ino !== named.ino || after.size !== named.size || after.mtimeNs !== named.mtimeNs || after.ctimeNs !== named.ctimeNs) {
      throw new Error("selector capacity source changed during observation");
    }
    const raw = bytes.toString("utf8");
    if (!Buffer.from(raw, "utf8").equals(bytes)) throw new Error("selector capacity journal contains invalid UTF-8");
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
  try { handle = await open(path, "r"); }
  catch (error) { if (process.platform === "win32" && isCode(error, "EPERM")) return; throw error; }
  try { await handle.sync(); }
  catch (error) { if (!(process.platform === "win32" && isCode(error, "EPERM"))) throw error; }
  finally { await handle.close(); }
}
async function acquireLock(path: string, options: { lockTimeoutMs: number; lockRetryDelayMs: number }): Promise<() => Promise<void>> {
  const deadline = performance.now() + options.lockTimeoutMs;
  let lastError: unknown;
  while (performance.now() < deadline) {
    let handle: Awaited<ReturnType<typeof open>>;
    try { handle = await open(path, "wx"); }
    catch (error) {
      if (!(isCode(error, "EEXIST") || (process.platform === "win32" && isCode(error, "EPERM")))) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(options.lockRetryDelayMs, Math.max(0, deadline - performance.now()))));
      continue;
    }
    const token = `${randomUUID()}\n`;
    try { await handle.writeFile(token); await handle.sync(); }
    // Initialization failure cannot prove pathname ownership; retain the lock for explicit recovery.
    catch (error) { await handle.close(); throw error; }
    return async () => {
      try { if (await readFile(path, "utf8") !== token) throw new Error("selector capacity lock ownership changed"); }
      finally { await handle.close(); }
      await unlink(path);
      await syncDirectory(dirname(path));
    };
  }
  throw new Error("selector capacity repository lock is unavailable", { cause: lastError });
}
function positiveInteger(value: number) { if (!Number.isSafeInteger(value) || value <= 0) throw new Error("lock option must be a positive safe integer"); return value; }
function isCode(error: unknown, code: string): boolean { return error instanceof Error && "code" in error && error.code === code; }
