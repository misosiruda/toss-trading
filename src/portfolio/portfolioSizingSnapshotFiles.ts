import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import { sha256HashSchema } from "../domain/schemas.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";
import type { PortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { resolvePortfolioSizingSnapshot } from "./portfolioSizingSnapshotResolver.js";
import { RuntimePortfolioPolicyActivationFileRepository } from "./runtimePortfolioPolicyActivationFiles.js";
import { RuntimePortfolioPolicyFileRepository } from "./runtimePortfolioPolicyFiles.js";
import { withDurablePolicyDependencies } from "./runtimePolicyDependencyGeneration.js";
import { SourcePriceEvidenceFileRepository, getDurableSourcePriceEvidenceObservation,
  resolveVerifiedSourcePriceEvidenceOrigin, type VerifiedSourcePriceEvidenceHistory } from "./sourcePriceEvidenceFiles.js";
import { SourceFxEvidenceFileRepository, getDurableSourceFxEvidenceObservation,
  resolveVerifiedSourceFxEvidenceOrigin } from "./sourceFxEvidenceFiles.js";
import { withStoredPendingPlanActionHistory } from "./storedPendingPlanActionProgress.js";
import { getHeldRebalancePlanEventObservation } from "./rebalancePlanEventFiles.js";
import type { OpeningCapacityMandateSources } from "./openingCapacityMandateBinding.js";
import type { bindHeldSnapshotOpeningBudget } from "./heldSnapshotOpeningBudget.js";

type CapacityRootSources = Omit<OpeningCapacityMandateSources, "mandates" | "events">;
export type OpeningBudgetBoundSizingPublication = Readonly<{ snapshot: PortfolioSizingSnapshot;
  openingBudget: ReturnType<typeof bindHeldSnapshotOpeningBudget> }>;

export const PORTFOLIO_SIZING_SNAPSHOTS_FILE_NAME =
  "portfolio-sizing-snapshots.jsonl";

export interface PortfolioSizingSnapshotFileRepositoryOptions {
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
}

export const portfolioSizingSnapshotObservationSchema = z.object({
  recordCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).refine((value) => !Object.is(value, -0)),
  recordsHash: sha256HashSchema,
  observedAt: offsetQualifiedIsoDateTimeSchema
}).strict();
export type PortfolioSizingSnapshotObservation = Readonly<z.infer<typeof portfolioSizingSnapshotObservationSchema>>;
export interface VerifiedPortfolioSizingSnapshotHistory {
  snapshots: readonly PortfolioSizingSnapshot[];
}
const durableSnapshotObservations = new WeakMap<VerifiedPortfolioSizingSnapshotHistory, PortfolioSizingSnapshotObservation>();
const durableSnapshotSourcePaths = new WeakMap<VerifiedPortfolioSizingSnapshotHistory, string>();

/** Only the live lease of this configured source can be shared with a dependent repository. */
export function assertDurablePortfolioSizingSnapshotSource(history: VerifiedPortfolioSizingSnapshotHistory, baseDir: string): void {
  getDurablePortfolioSizingSnapshotObservation(history);
  if (durableSnapshotSourcePaths.get(history) !== createPortfolioSizingSnapshotPaths(resolve(baseDir)).recordsPath) {
    throw new Error("portfolio sizing snapshot lease belongs to a different source path");
  }
}

/** Only a live repository-issued lease proves this source observation. */
export function getDurablePortfolioSizingSnapshotObservation(history: VerifiedPortfolioSizingSnapshotHistory): PortfolioSizingSnapshotObservation {
  const observation = durableSnapshotObservations.get(history);
  if (observation === undefined) throw new Error("portfolio sizing snapshot history lacks a durable observation lease");
  return observation;
}

/** Revalidates a previously observed prefix; the returned content is not a new lease. */
export function resolveObservedPortfolioSizingSnapshotHistory(history: VerifiedPortfolioSizingSnapshotHistory, value: unknown): readonly PortfolioSizingSnapshot[] {
  const current = getDurablePortfolioSizingSnapshotObservation(history);
  const observation = portfolioSizingSnapshotObservationSchema.parse(value);
  if (Date.parse(observation.observedAt) > Date.parse(current.observedAt)) throw new Error("portfolio sizing snapshot observation is in the future");
  const prefix = history.snapshots.slice(0, observation.recordCount);
  if (prefix.length !== observation.recordCount || hashCanonicalPayload(prefix) !== observation.recordsHash) {
    throw new Error("portfolio sizing snapshot observation does not match durable source prefix");
  }
  return Object.freeze(prefix);
}

export function createPortfolioSizingSnapshotPaths(baseDir: string): {
  recordsPath: string;
  lockPath: string;
} {
  return {
    recordsPath: join(baseDir, PORTFOLIO_SIZING_SNAPSHOTS_FILE_NAME),
    lockPath: join(
      baseDir,
      `.${PORTFOLIO_SIZING_SNAPSHOTS_FILE_NAME}.lock`
    )
  };
}

/** Strict append-only storage for valuation-resolved sizing snapshots. */
export class PortfolioSizingSnapshotFileRepository {
  private readonly recordsPath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;

  constructor(
    baseDir: string,
    options: PortfolioSizingSnapshotFileRepositoryOptions = {}
  ) {
    const paths = createPortfolioSizingSnapshotPaths(resolve(baseDir));
    this.recordsPath = paths.recordsPath;
    this.lockPath = paths.lockPath;
    this.lockTimeoutMs = positiveInteger(
      options.lockTimeoutMs ?? 5_000,
      "lockTimeoutMs"
    );
    this.lockRetryDelayMs = positiveInteger(
      options.lockRetryDelayMs ?? 10,
      "lockRetryDelayMs"
    );
  }

  async readAll(): Promise<readonly PortfolioSizingSnapshot[]> {
    return this.withLock(async () => this.readAllUnderLock());
  }

  /** Holds the source lock through the consumer; failure never promotes an unflushed generation. */
  async withDurableVerifiedHistory<T>(operation: (history: VerifiedPortfolioSizingSnapshotHistory) => Promise<T>): Promise<T> {
    return this.withLock(() => this.withDurableHistoryUnderLock(operation));
  }

  private async withDurableHistoryUnderLock<T>(operation: (history: VerifiedPortfolioSizingSnapshotHistory) => Promise<T>): Promise<T> {
      const { snapshots, observedAt } = await readDurableBoundSnapshotSource(this.recordsPath);
      const history = Object.freeze({ snapshots });
      const observation = Object.freeze({
        recordCount: snapshots.length, recordsHash: hashCanonicalPayload(snapshots), observedAt
      });
      durableSnapshotObservations.set(history, observation);
      durableSnapshotSourcePaths.set(history, this.recordsPath);
      try {
        return await operation(history);
      } finally {
        durableSnapshotObservations.delete(history);
        durableSnapshotSourcePaths.delete(history);
      }
  }

  async resolveById(
    portfolioSnapshotId: string
  ): Promise<PortfolioSizingSnapshot> {
    const snapshots = await this.readAll();
    const matches = snapshots.filter(
      (snapshot) => snapshot.portfolioSnapshotId === portfolioSnapshotId
    );
    if (matches.length !== 1) {
      throw new Error("portfolio sizing snapshot does not resolve exactly once");
    }
    return matches[0] as PortfolioSizingSnapshot;
  }

  async append(value: unknown): Promise<PortfolioSizingSnapshot> {
    const candidate = cloneResolvedSnapshot(value);
    return this.withLock(() => this.appendUnderLock(candidate));
  }

  /** Concrete sources: price -> FX -> capacity sources (including sizing) -> event -> plan -> mandate -> policy -> activation -> Risk -> fill -> capacity.
   * New append and exact retry bind pending progress and persisted execution origins, including terminal plans.
   * Root issuance, bound mandates, gross consumption, retirement and aggregate pending BUY coverage are checked; unverified cancellations are rejected.
   * Allocation and accounting remain separate gates. Pending projection is computed once by the final held-source binder.
   */
  async appendForActivePolicy(value: unknown): Promise<PortfolioSizingSnapshot> {
    return this.appendForActivePolicySources(value, false);
  }

  /** Requires explicit opening limits and computes reservation-adjusted bounds under the same source locks as publication.
   * Returned bounds are observations, not a retained lease or allocation/CAS approval. This repository alone does not bind the actual portfolio.
   */
  async appendWithOpeningBudgetForActivePolicy(value: unknown): Promise<OpeningBudgetBoundSizingPublication> {
    return this.appendForActivePolicySources(value, true);
  }

  /** Runs a trusted internal consumer before releasing source locks. Snapshot publication is already durable;
   * consumer failure is propagated but cannot roll back that snapshot or arbitrary consumer writes.
   */
  async withPublishedOpeningBudgetForActivePolicy<T>(value: unknown,
    operation: (publication: OpeningBudgetBoundSizingPublication) => Promise<T>): Promise<T> {
    if (typeof operation !== "function") throw new Error("opening budget consumer must be a function");
    return this.appendForActivePolicySources(value, true, operation);
  }

  /** Require the cutoff to cover recorded timestamps in the complete source generation observed NOW.
   * Marker times precede their fsync: this NEVER proves durable availability at cutoff, reconciliation or allocation approval.
   */
  async withPublishedOpeningBudgetForRecordedTimeCoverage<T>(value: unknown,
    operation: (publication: OpeningBudgetBoundSizingPublication) => Promise<T>): Promise<T> {
    if (typeof operation !== "function") throw new Error("opening budget consumer must be a function");
    return this.appendForActivePolicySources(value, true, operation, true);
  }

  private appendForActivePolicySources(value: unknown, openingBudgetRequired: false): Promise<PortfolioSizingSnapshot>;
  private appendForActivePolicySources(value: unknown, openingBudgetRequired: true): Promise<OpeningBudgetBoundSizingPublication>;
  private appendForActivePolicySources<T>(value: unknown, openingBudgetRequired: true,
    operation: (publication: OpeningBudgetBoundSizingPublication) => Promise<T>, recordedTimeCoverageRequired?: boolean): Promise<T>;
  private async appendForActivePolicySources<T>(value: unknown, openingBudgetRequired: boolean,
    operation?: (publication: OpeningBudgetBoundSizingPublication) => Promise<T>, recordedTimeCoverageRequired = false): Promise<PortfolioSizingSnapshot | OpeningBudgetBoundSizingPublication | T> {
    const candidate = cloneResolvedSnapshot(value), baseDir = dirname(this.recordsPath);
    // Risk schemas depend on this module's observation contract. Load consumers after module initialization.
    const [{ PortfolioActionRiskDecisionFileRepository, getHeldPortfolioActionRiskDecisionObservation },
      { PaperFillExecutionFileRepository, getHeldPaperFillExecutionObservation },
      { InvestmentMandateFileRepository, getDurableInvestmentMandateObservation }, { bindHeldSnapshotPendingReservationOrigins },
      { bindHeldSnapshotOpeningBudget }, { assertHeldOpeningRecordedTimeCoverage },
      { OpeningCapacityReservationEventFileRepository, getDurableOpeningCapacityEventObservedAt }] = await Promise.all([
      import("./portfolioActionRiskDecisionFiles.js"), import("./paperFillExecutionFiles.js"),
      import("./investmentMandateFiles.js"), import("./heldSnapshotPendingReservationBinding.js"),
      import("./heldSnapshotOpeningBudget.js"), import("./currentOpeningProjectionFrontier.js"),
      import("./openingCapacityReservationEventFiles.js")
    ]);
    const options = { lockTimeoutMs: this.lockTimeoutMs, lockRetryDelayMs: this.lockRetryDelayMs };
    return withStoredMarkPrices(baseDir, candidate, options, (prices) => withStoredFxRates(baseDir, candidate, options,
      () => this.withCapacityRootSources((sources) => withStoredPendingPlanActionHistory({ baseDir, portfolioId: candidate.portfolioId, asOf: candidate.asOf }, async (planEvents) => {
      const planObservation = getHeldRebalancePlanEventObservation(planEvents);
      return new InvestmentMandateFileRepository(baseDir, options).withDurableVerifiedHistory(async (mandates) => {
      const mandateObservation = getDurableInvestmentMandateObservation(mandates);
      if (Date.parse(mandateObservation.observedAt) < Date.parse(planObservation.observedAt)) {
        throw new Error("sizing snapshot mandate observation clock moved backwards");
      }
      return withDurablePolicyDependencies(baseDir, async (dependencies, verifyDependencies) => {
      // Do not carry a policy/dependency generation across the destination lock wait.
      return new RuntimePortfolioPolicyFileRepository(baseDir, dependencies.repository, options)
        .withDurablePolicyGeneration(async (policies) => {
          const activations = new RuntimePortfolioPolicyActivationFileRepository(baseDir, policies, dependencies.repository, options);
          return activations.withDurableActivePolicy(candidate.portfolioId, async (active, observedAt) => {
            if (Date.parse(observedAt) < Date.parse(mandateObservation.observedAt)) throw new Error("sizing snapshot activation observation clock moved backwards");
            if (candidate.policyHash !== active.policy.policyHash) throw new Error("sizing snapshot active policy mismatch");
            if (Date.parse(candidate.asOf) < Date.parse(active.activation.effectiveFrom) || Date.parse(candidate.asOf) > Date.parse(observedAt)) {
              throw new Error("sizing snapshot cutoff is outside the observed active policy interval");
            }
            return new PortfolioActionRiskDecisionFileRepository(baseDir, options).withDurableVerifiedHistory(async (risks) => {
              const riskObservation = getHeldPortfolioActionRiskDecisionObservation(risks);
              if (Date.parse(riskObservation.observedAt) < Date.parse(observedAt)) throw new Error("sizing snapshot Risk observation clock moved backwards");
              return new PaperFillExecutionFileRepository(baseDir, options).withDurableVerifiedHistory(async (fills) => {
                if (Date.parse(getHeldPaperFillExecutionObservation(fills).observedAt) < Date.parse(riskObservation.observedAt)) {
                  throw new Error("sizing snapshot fill observation clock moved backwards");
                }
                return new OpeningCapacityReservationEventFileRepository(baseDir, options).withDurableVerifiedHistory(async (capacity) => {
                  if (Date.parse(getDurableOpeningCapacityEventObservedAt(capacity)) < Date.parse(getHeldPaperFillExecutionObservation(fills).observedAt)) {
                    throw new Error("sizing snapshot capacity observation clock moved backwards");
                  }
                  const heldSources = { ...sources, mandates, events: capacity, planEvents, risks, fills, prices };
                  // Each branch validates pending/terminal sources once; never trust an externally calculated budget.
                  const openingBudget = openingBudgetRequired
                    ? bindHeldSnapshotOpeningBudget({ baseDir, snapshot: candidate, policy: active.policy }, heldSources) : null;
                  if (openingBudget === null) bindHeldSnapshotPendingReservationOrigins({ baseDir, snapshot: candidate }, heldSources);
                  if (recordedTimeCoverageRequired) assertHeldOpeningRecordedTimeCoverage({ baseDir,
                    portfolioId: candidate.portfolioId, asOf: candidate.asOf }, heldSources);
                  await verifyDependencies();
                  const snapshot = await this.appendUnderLock(candidate);
                  await verifyDependencies();
                  if (openingBudget === null) return snapshot;
                  const publication = Object.freeze({ snapshot, openingBudget });
                  if (!operation) return publication;
                  const result = await operation(publication);
                  await verifyDependencies();
                  return result;
                });
              });
            });
          });
        });
      });
      });
    }, options))));
  }

  /** Owns the destination lock once and shares only its pre-append history with dependent readers.
   * This private lease cannot escape to a caller that could reuse a stale generation after append.
   */
  private async withCapacityRootSources<T>(operation: (sources: CapacityRootSources) => Promise<T>): Promise<T> {
    const baseDir = dirname(this.recordsPath), options = { lockTimeoutMs: this.lockTimeoutMs, lockRetryDelayMs: this.lockRetryDelayMs };
    const [{ ManualAssignmentFileRepository }, { BucketSelectionRequestFileRepository }, { CandidateSizingInputFileRepository },
      { CandidateAssignmentFileRepository }, { ManualOpeningCapacityReservationFileRepository },
      { SelectorOpeningCapacityReservationFileRepository }] = await Promise.all([
      import("./manualAssignmentFiles.js"), import("./bucketSelectionRequestFiles.js"), import("./candidateSizingInputFiles.js"),
      import("./candidateAssignmentFiles.js"), import("./manualOpeningCapacityReservationFiles.js"), import("./selectorOpeningCapacityReservationFiles.js")
    ]);
    return new ManualAssignmentFileRepository(baseDir, options).withDurableVerifiedHistory((manual) =>
      new BucketSelectionRequestFileRepository(baseDir, options).withDurableVerifiedHistory((requests) =>
        this.withLock(() => this.withDurableHistoryUnderLock((snapshots) =>
          new CandidateSizingInputFileRepository(baseDir, options).withDurableVerifiedHistoryFromSources(requests, snapshots, (inputs) =>
            new CandidateAssignmentFileRepository(baseDir, options).withDurableVerifiedHistoryFromSources(inputs, requests, snapshots, (assignments) =>
              new ManualOpeningCapacityReservationFileRepository(baseDir, options).withDurableVerifiedHistoryFromSources(manual, snapshots, (manualReservations) =>
                new SelectorOpeningCapacityReservationFileRepository(baseDir, options).withDurableVerifiedHistoryFromSources(assignments, inputs, requests, snapshots,
                  (selectorReservations) => operation({ manual, requests, inputs, assignments, manualReservations, selectorReservations })))))))));
  }

  private async appendUnderLock(candidate: PortfolioSizingSnapshot): Promise<PortfolioSizingSnapshot> {
    const snapshots = await this.readAllUnderLock();
    const existing = snapshots.find((snapshot) => snapshot.portfolioSnapshotId === candidate.portfolioSnapshotId);
    if (existing !== undefined) {
      if (!isDeepStrictEqual(existing, candidate)) throw new Error("portfolio sizing snapshot ID collision");
      await syncDurableJsonFile(this.recordsPath);
      return existing;
    }
    const origin = snapshotOrigin(candidate);
    if (snapshots.some((snapshot) => snapshotOrigin(snapshot) === origin)) throw new Error("portfolio sizing snapshot origin collision");
    await appendDurableJsonLine(this.recordsPath, candidate);
    return candidate;
  }

  private async readAllUnderLock(): Promise<
    readonly PortfolioSizingSnapshot[]
  > {
    let raw: string;
    try {
      raw = decodePortfolioSizingSnapshotSource(await readFile(this.recordsPath));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return Object.freeze([]);
      }
      throw error;
    }
    return parsePortfolioSizingSnapshots(raw);
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const outputDirectory = dirname(this.recordsPath);
    await mkdir(outputDirectory, { recursive: true });
    await syncDirectoryAncestors(outputDirectory);
    const release = await acquireExclusiveLock({
      lockPath: this.lockPath,
      timeoutMs: this.lockTimeoutMs,
      retryDelayMs: this.lockRetryDelayMs
    });
    try {
      return await operation();
    } finally {
      await release();
    }
  }
}

/** Holds the actual price writer lock through destination persistence; never accepts caller histories. */
async function withStoredMarkPrices<T>(baseDir: string, snapshot: PortfolioSizingSnapshot,
  options: PortfolioSizingSnapshotFileRepositoryOptions, operation: (history: VerifiedSourcePriceEvidenceHistory) => Promise<T>): Promise<T> {
  const marks = snapshot.valuationInputs.filter((input) => input.kind === "mark_price");
  // Terminal plans may contain executions even without positions or pending inputs. Always observe this source.
  return new SourcePriceEvidenceFileRepository(baseDir, options).withDurableVerifiedHistory(async (history) => {
    const cutoff = Date.parse(snapshot.asOf);
    if ((marks.length > 0 || snapshot.pendingActionInputs.length > 0) && cutoff > Date.parse(getDurableSourcePriceEvidenceObservation(history).observedAt)) {
      throw new Error("sizing snapshot mark cutoff is after its price observation");
    }
    for (const mark of marks) {
      const origin = resolveVerifiedSourcePriceEvidenceOrigin(history, mark.evidenceRef), price = origin.record;
      if (price.market !== mark.market || price.symbol !== mark.symbol || price.priceKrw !== mark.priceKrw ||
        Date.parse(price.observedAt) !== Date.parse(mark.evidenceAsOf)) {
        throw new Error("sizing snapshot mark differs from stored price evidence");
      }
      if ([price.observedAt, price.createdAt, origin.appendedAt].some((instant) => Date.parse(instant) > cutoff)) {
        throw new Error("sizing snapshot mark source was unavailable at its cutoff");
      }
    }
    return operation(history);
  });
}

/** FX is already represented by KRW marks: compare conversion evidence, never multiply the mark again. */
async function withStoredFxRates<T>(baseDir: string, snapshot: PortfolioSizingSnapshot,
  options: PortfolioSizingSnapshotFileRepositoryOptions, operation: () => Promise<T>): Promise<T> {
  const rates = snapshot.valuationInputs.filter((input) => input.kind === "fx_rate");
  if (rates.length === 0) return operation();
  return new SourceFxEvidenceFileRepository(baseDir, options).withDurableVerifiedHistory(async (history) => {
    const cutoff = Date.parse(snapshot.asOf);
    if (cutoff > Date.parse(getDurableSourceFxEvidenceObservation(history).observedAt)) {
      throw new Error("sizing snapshot FX cutoff is after its source observation");
    }
    for (const rate of rates) {
      const origin = resolveVerifiedSourceFxEvidenceOrigin(history, rate.evidenceRef), record = origin.record;
      if (record.baseCurrency !== rate.baseCurrency || record.quoteCurrency !== rate.quoteCurrency || record.rate !== rate.rate ||
        Date.parse(record.observedAt) !== Date.parse(rate.evidenceAsOf)) throw new Error("sizing snapshot FX differs from stored evidence");
      if ([record.observedAt, record.createdAt, origin.appendedAt].some((instant) => Date.parse(instant) > cutoff)) {
        throw new Error("sizing snapshot FX source was unavailable at its cutoff");
      }
    }
    return operation();
  });
}

function decodePortfolioSizingSnapshotSource(bytes: Buffer): string {
  const raw = bytes.toString("utf8");
  if (!Buffer.from(raw, "utf8").equals(bytes)) throw new Error("portfolio sizing snapshot source contains invalid UTF-8");
  return raw;
}

/** Parses and independently resolves a complete durable snapshot log. */
export function parsePortfolioSizingSnapshots(
  raw: string
): readonly PortfolioSizingSnapshot[] {
  if (raw.length > 0 && !raw.endsWith("\n")) {
    throw new Error("portfolio sizing snapshot file has a torn final line");
  }
  const lines = raw.split(/\r?\n/);
  lines.pop();
  const snapshots: PortfolioSizingSnapshot[] = [];
  const ids = new Set<string>();
  const origins = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) {
      throw new Error(
        `portfolio sizing snapshot file contains corrupt line ${index + 1}`
      );
    }
    let snapshot: PortfolioSizingSnapshot;
    try {
      snapshot = resolvePortfolioSizingSnapshot(JSON.parse(line)).snapshot;
    } catch (error) {
      throw new Error(
        `portfolio sizing snapshot file contains corrupt line ${index + 1}`,
        { cause: error }
      );
    }
    if (ids.has(snapshot.portfolioSnapshotId)) {
      throw new Error("portfolio sizing snapshot file contains a duplicate ID");
    }
    const origin = snapshotOrigin(snapshot);
    if (origins.has(origin)) {
      throw new Error(
        "portfolio sizing snapshot file contains a duplicate origin"
      );
    }
    ids.add(snapshot.portfolioSnapshotId);
    origins.add(origin);
    snapshots.push(snapshot);
  }
  return Object.freeze(snapshots);
}

/** Detects source rewrites/replacement during observation, including non-cooperative recovery. */
async function readDurableBoundSnapshotSource(path: string): Promise<{ snapshots: readonly PortfolioSizingSnapshot[]; observedAt: string }> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, "r+");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      await syncOutputDirectory(dirname(path));
      const observedAt = new Date().toISOString();
      try {
        await lstat(path);
      } catch (recheckError) {
        if (isNodeError(recheckError) && recheckError.code === "ENOENT") return { snapshots: Object.freeze([]), observedAt };
        throw recheckError;
      }
      throw new Error("portfolio sizing snapshot source appeared during durable observation");
    }
    throw error;
  }
  try {
    const before = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const snapshots = parsePortfolioSizingSnapshots(decodePortfolioSizingSnapshotSource(bytes));
    await handle.sync();
    await syncOutputDirectory(dirname(path));
    // Date the flushed generation before the final verification, never after descriptor close.
    const observedAt = new Date().toISOString();
    // Explicit offsets reread the same descriptor, not the possibly replaced pathname.
    const verified = Buffer.alloc(bytes.length);
    let offset = 0;
    while (offset < verified.length) {
      const { bytesRead } = await handle.read(verified, offset, verified.length - offset, offset);
      if (bytesRead === 0) throw new Error("portfolio sizing snapshot source changed during durable observation");
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    // Windows pathname stat can report dev=0; compare descriptor identities on both sides.
    const namedHandle = await open(path, "r");
    let named;
    try {
      named = await namedHandle.stat({ bigint: true });
    } finally {
      await namedHandle.close();
    }
    if (!bytes.equals(verified) || before.size !== BigInt(bytes.length) ||
      before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
      after.dev !== named.dev || after.ino !== named.ino || after.size !== named.size ||
      after.mtimeNs !== named.mtimeNs || after.ctimeNs !== named.ctimeNs) {
      throw new Error("portfolio sizing snapshot source changed during durable observation");
    }
    return { snapshots, observedAt };
  } finally {
    await handle.close();
  }
}

function snapshotOrigin(snapshot: PortfolioSizingSnapshot): string {
  return JSON.stringify([
    snapshot.portfolioId,
    snapshot.portfolioVersion,
    snapshot.policyHash,
    Date.parse(snapshot.asOf)
  ]);
}

function cloneResolvedSnapshot(value: unknown): PortfolioSizingSnapshot {
  const snapshot = resolvePortfolioSizingSnapshot(value).snapshot;
  return resolvePortfolioSizingSnapshot(
    JSON.parse(JSON.stringify(snapshot))
  ).snapshot;
}

async function appendDurableJsonLine(
  path: string,
  value: PortfolioSizingSnapshot
): Promise<void> {
  const handle = await open(path, "a");
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncOutputDirectory(dirname(path));
}

async function syncDurableJsonFile(path: string): Promise<void> {
  const handle = await open(path, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncOutputDirectory(dirname(path));
}

async function syncDirectoryAncestors(outputDirectory: string): Promise<void> {
  const outputPath = await realpath(outputDirectory);
  const directories: string[] = [];
  let currentPath = outputPath;
  while (true) {
    directories.unshift(currentPath);
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }
  for (const directory of directories) {
    await syncOutputDirectory(directory);
  }
}

async function syncOutputDirectory(outputDirectory: string): Promise<void> {
  let directory: Awaited<ReturnType<typeof open>>;
  try {
    directory = await open(outputDirectory, "r");
  } catch (error) {
    if (!isUnsupportedWindowsDirectorySync(error)) {
      throw error;
    }
    return;
  }
  try {
    await directory.sync();
  } catch (error) {
    if (!isUnsupportedWindowsDirectorySync(error)) {
      throw error;
    }
  } finally {
    await directory.close();
  }
}

async function acquireExclusiveLock(input: {
  lockPath: string;
  timeoutMs: number;
  retryDelayMs: number;
}): Promise<() => Promise<void>> {
  const deadline = Date.now() + input.timeoutMs;
  while (true) {
    if (Date.now() >= deadline) {
      throw new Error("portfolio sizing snapshot repository lock is unavailable");
    }
    try {
      const handle = await open(input.lockPath, "wx");
      const token = randomUUID();
      try {
        await handle.writeFile(`${token}\n`, "utf8");
        await handle.sync();
      } catch (error) {
        await handle.close();
        await unlink(input.lockPath).catch(() => undefined);
        throw error;
      }
      return async () => {
        try {
          const storedToken = await readFile(input.lockPath, "utf8");
          if (storedToken !== `${token}\n`) {
            throw new Error("portfolio sizing snapshot lock ownership changed");
          }
        } finally {
          await handle.close();
        }
        await unlink(input.lockPath);
        await syncOutputDirectory(dirname(input.lockPath));
      };
    } catch (error) {
      if (!isRetryableLockContention(error)) {
        throw error;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(
          "portfolio sizing snapshot repository lock is unavailable"
        );
      }
      await delay(Math.min(input.retryDelayMs, remainingMs));
    }
  }
}

function isRetryableLockContention(error: unknown): boolean {
  return (
    isNodeError(error) &&
    (error.code === "EEXIST" ||
      (process.platform === "win32" && error.code === "EPERM"))
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function isUnsupportedWindowsDirectorySync(error: unknown): boolean {
  return (
    process.platform === "win32" &&
    isNodeError(error) &&
    error.code === "EPERM"
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
