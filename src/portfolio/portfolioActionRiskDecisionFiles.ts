import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { sha256HashSchema } from "../domain/schemas.js";
import {
  type PortfolioActionRiskDecision,
  createPortfolioActionRiskDecision,
  parsePortfolioActionRiskDecision
} from "./portfolioActionRiskDecision.js";
import {
  hashCanonicalPayload,
  offsetQualifiedIsoDateTimeSchema
} from "./runtimePolicyContracts.js";
import { readStoredRuntimePortfolioPolicyActivationSnapshot, RuntimePortfolioPolicyActivationFileRepository } from "./runtimePortfolioPolicyActivationFiles.js";
import { resolveActiveRuntimePortfolioPolicyAsOf } from "./runtimePortfolioPolicyActivation.js";
import { readStoredRiskDecisionPlanContext, riskDecisionPlanOriginSchema, validateRiskDecisionPlanState, type RiskDecisionPlanOrigin } from "./portfolioActionRiskDecisionPlanContext.js";
import { InvestmentMandateFileRepository, getDurableInvestmentMandateObservation, resolveObservedInvestmentMandateHistory, type VerifiedInvestmentMandateHistory } from "./investmentMandateFiles.js";
import { riskDecisionMandateIdentity, riskDecisionMandateOriginSchema, validateRiskDecisionMandateState, type RiskDecisionMandateOrigin } from "./portfolioActionRiskDecisionMandateContext.js";
import { PortfolioSizingSnapshotFileRepository, getDurablePortfolioSizingSnapshotObservation, resolveObservedPortfolioSizingSnapshotHistory, type VerifiedPortfolioSizingSnapshotHistory } from "./portfolioSizingSnapshotFiles.js";
import { riskDecisionSnapshotIdentity, riskDecisionSnapshotOriginSchema, validateRiskDecisionSnapshotState, type RiskDecisionSnapshotOrigin } from "./portfolioActionRiskDecisionSnapshotContext.js";
import { validateRiskDecisionCashCapacity } from "./portfolioActionRiskDecisionCashCapacity.js";
import { SourcePriceEvidenceFileRepository, getDurableSourcePriceEvidenceObservation, resolveObservedSourcePriceEvidenceHistory, type VerifiedSourcePriceEvidenceHistory } from "./sourcePriceEvidenceFiles.js";
import { riskDecisionPriceIdentity, riskDecisionPriceOriginSchema, validateRiskDecisionPriceState, type RiskDecisionPriceOrigin } from "./portfolioActionRiskDecisionPriceContext.js";
import { createPortfolioPlanExecutionPreview, portfolioPlanExecutionPreviewInputSchema } from "./portfolioPlanExecutionPreview.js";
import { createPortfolioActionExecutionPreview } from "./portfolioActionExecutionPreview.js";
import { portfolioExecutionRuleParametersSchema } from "./portfolioPolicyExecutionPreview.js";
import { riskRuleParameterRefFor } from "./runtimePolicyContracts.js";
import { assertRiskExecutionDecisionBinding, parseRiskDecisionExecutionOrigin, riskDecisionExecutionOriginSchema,
  verifyRiskExecutionLiquidity, type RiskDecisionExecutionOrigin } from "./portfolioActionRiskDecisionExecutionContext.js";

export const PORTFOLIO_ACTION_RISK_DECISION_RECORDS_FILE_NAME =
  "portfolio-action-risk-decision-records.jsonl";

export interface PortfolioActionRiskDecisionFileRepositoryOptions {
  lockTimeoutMs?: number;
  lockRetryDelayMs?: number;
}

const verifiedPortfolioActionRiskDecisionHistories =
  new WeakSet<VerifiedPortfolioActionRiskDecisionHistory>();
const verifiedPortfolioActionRiskDecisionMetadata =
  new WeakMap<VerifiedPortfolioActionRiskDecisionHistory, VerifiedHistoryMetadata>();

export interface VerifiedPortfolioActionRiskDecisionHistory {
  records: readonly PortfolioActionRiskDecision[];
}

export interface VerifiedPortfolioActionRiskDecisionOrigin {
  record: PortfolioActionRiskDecision;
  appendedAt: string;
  commitHash: string;
  policyOrigin: PersistedPolicyOrigin | null;
  planOrigin: RiskDecisionPlanOrigin | null;
  mandateOrigin: RiskDecisionMandateOrigin | null;
  snapshotOrigin: RiskDecisionSnapshotOrigin | null;
  priceOrigin: RiskDecisionPriceOrigin | null;
  executionOrigin: RiskDecisionExecutionOrigin | null;
}

interface VerifiedHistoryMetadata {
  appendedAtById: ReadonlyMap<string, string>;
  commitHashById: ReadonlyMap<string, string>;
  policyOriginById: ReadonlyMap<string, PersistedPolicyOrigin>;
  planOriginById: ReadonlyMap<string, RiskDecisionPlanOrigin>;
  mandateOriginById: ReadonlyMap<string, RiskDecisionMandateOrigin>;
  snapshotOriginById: ReadonlyMap<string, RiskDecisionSnapshotOrigin>;
  priceOriginById: ReadonlyMap<string, RiskDecisionPriceOrigin>;
  executionOriginById: ReadonlyMap<string, RiskDecisionExecutionOrigin>;
  lastEntryHash: string | null;
  lastCommittedAt: string | null;
}

const portfolioActionRiskDecisionFileEntrySchema = z
  .object({
    record: z.unknown(),
    appendedAt: offsetQualifiedIsoDateTimeSchema,
    previousEntryHash: sha256HashSchema.nullable(),
    entryHash: sha256HashSchema
  })
  .strict();

interface PortfolioActionRiskDecisionFileEntry {
  record: PortfolioActionRiskDecision;
  appendedAt: string;
  previousEntryHash: string | null;
  entryHash: string;
}

const committedEntrySchema = z.object({
  schemaVersion: z.literal("portfolio_action_risk_decision_entry.v2"),
  record: z.unknown(),
  appendStartedAt: offsetQualifiedIsoDateTimeSchema,
  previousEntryHash: sha256HashSchema.nullable(),
  entryHash: sha256HashSchema
}).strict();

const policyOriginSchema = z.object({
  activationId: z.string().min(1).max(240),
  activationEventHash: sha256HashSchema,
  runtimePolicyRecordId: z.string().min(1).max(240),
  policyHash: sha256HashSchema,
  policyLineageHash: sha256HashSchema,
  observedAt: offsetQualifiedIsoDateTimeSchema
}).strict();
const generationBoundPolicyOriginSchema = policyOriginSchema.extend({
  activationHistory: z.object({ eventCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), eventsHash: sha256HashSchema }).strict()
}).strict();
type PersistedPolicyOrigin = Readonly<z.infer<typeof policyOriginSchema> & {
  activationHistory?: Readonly<{ eventCount: number; eventsHash: string }>;
}>;
const policyBoundEntrySchema = committedEntrySchema.extend({
  schemaVersion: z.literal("portfolio_action_risk_decision_entry.v3"),
  policyOrigin: policyOriginSchema
}).strict();
const planBoundEntrySchema = policyBoundEntrySchema.extend({
  schemaVersion: z.literal("portfolio_action_risk_decision_entry.v4"),
  policyOrigin: generationBoundPolicyOriginSchema,
  planOrigin: riskDecisionPlanOriginSchema
}).strict();
const mandateBoundEntrySchema = planBoundEntrySchema.extend({
  schemaVersion: z.literal("portfolio_action_risk_decision_entry.v5"),
  mandateOrigin: riskDecisionMandateOriginSchema
}).strict();
const snapshotBoundEntrySchema = planBoundEntrySchema.extend({
  schemaVersion: z.literal("portfolio_action_risk_decision_entry.v6"),
  mandateOrigin: riskDecisionMandateOriginSchema.nullable(),
  snapshotOrigin: riskDecisionSnapshotOriginSchema
}).strict();
const priceBoundEntrySchema = snapshotBoundEntrySchema.extend({
  schemaVersion: z.literal("portfolio_action_risk_decision_entry.v7"),
  priceOrigin: riskDecisionPriceOriginSchema
}).strict();
const executionBoundEntrySchema = priceBoundEntrySchema.extend({
  schemaVersion: z.literal("portfolio_action_risk_decision_entry.v8"),
  executionOrigin: riskDecisionExecutionOriginSchema
}).strict();

const commitMarkerSchema = z.object({
  schemaVersion: z.literal("portfolio_action_risk_decision_commit.v1"),
  entryHash: sha256HashSchema,
  committedAt: offsetQualifiedIsoDateTimeSchema,
  commitHash: sha256HashSchema
}).strict();

interface ParsedRiskDecisionEntry {
  record: PortfolioActionRiskDecision;
  committedAt: string | null;
  tailHash: string;
  policyOrigin: PersistedPolicyOrigin | null;
  planOrigin: RiskDecisionPlanOrigin | null;
  mandateOrigin: RiskDecisionMandateOrigin | null;
  snapshotOrigin: RiskDecisionSnapshotOrigin | null;
  priceOrigin: RiskDecisionPriceOrigin | null;
  executionOrigin: RiskDecisionExecutionOrigin | null;
}

export function createPortfolioActionRiskDecisionPaths(baseDir: string): {
  recordsPath: string;
  lockPath: string;
} {
  return {
    recordsPath: join(baseDir, PORTFOLIO_ACTION_RISK_DECISION_RECORDS_FILE_NAME),
    lockPath: join(
      baseDir,
      `.${PORTFOLIO_ACTION_RISK_DECISION_RECORDS_FILE_NAME}.lock`
    )
  };
}

/** Strict append-only storage for immutable Risk Engine decisions. */
export class PortfolioActionRiskDecisionFileRepository {
  private readonly recordsPath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryDelayMs: number;

  constructor(
    baseDir: string,
    options: PortfolioActionRiskDecisionFileRepositoryOptions = {}
  ) {
    const paths = createPortfolioActionRiskDecisionPaths(baseDir);
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

  async readAll(): Promise<readonly PortfolioActionRiskDecision[]> {
    return this.withLock(async () => (await this.readHistoryUnderLock()).records);
  }

  async readVerifiedHistory(): Promise<VerifiedPortfolioActionRiskDecisionHistory> {
    return this.withLock(async () => this.readHistoryUnderLock());
  }

  async resolveById(riskDecisionId: string): Promise<PortfolioActionRiskDecision> {
    const records = await this.readAll();
    const matches = records.filter(
      (record) => record.riskDecisionId === riskDecisionId
    );
    if (matches.length !== 1) {
      throw new Error("portfolio action risk decision does not resolve exactly once");
    }
    return matches[0] as PortfolioActionRiskDecision;
  }

  async append(value: unknown): Promise<PortfolioActionRiskDecision> {
    return this.#appendRecord(value, null);
  }

  /** Binds policy availability before record creation, not rule-result replay. */
  async createAndAppendWithPolicyOrigin(
    input: Omit<Parameters<typeof createPortfolioActionRiskDecision>[0], "decidedAt">
  ): Promise<PortfolioActionRiskDecision> {
    return this.#createWithOrigins(input, false);
  }

  /** Observes stored plan state before creation; does not reserve execution capacity. */
  async createAndAppendWithPlanOrigin(
    input: Omit<Parameters<typeof createPortfolioActionRiskDecision>[0], "decidedAt">
  ): Promise<PortfolioActionRiskDecision> {
    return this.#createWithOrigins(input, true);
  }

  /** Requires the actual mandate source, held under its shared lock through Risk persistence. */
  async createAndAppendWithMandateOrigin(
    input: Omit<Parameters<typeof createPortfolioActionRiskDecision>[0], "decidedAt">
  ): Promise<PortfolioActionRiskDecision> {
    return this.#createWithOrigins(input, true, true);
  }

  /** Binds the stored valuation pre-state for both mandate and legacy reduce-only actions. */
  async createAndAppendWithSnapshotOrigin(
    input: Omit<Parameters<typeof createPortfolioActionRiskDecision>[0], "decidedAt">
  ): Promise<PortfolioActionRiskDecision> {
    for (const key of ["decidedAt", "riskDecisionId", "riskDecisionHash", "riskInputHash"]) {
      if (key in input) throw new Error("snapshot-bound risk creation cannot accept a record or timestamp");
    }
    // Clone before the first asynchronous source read, just like the other creation paths.
    const creationInput = JSON.parse(JSON.stringify(input));
    return new PortfolioSizingSnapshotFileRepository(dirname(this.recordsPath)).withDurableVerifiedHistory(
      async (history) => this.#createWithOrigins(creationInput, true, true, history)
    );
  }

  /** Observes a selected typed price before Snapshot/Mandate/policy and holds its source through commit. */
  async createAndAppendWithPriceOrigin(
    input: Omit<Parameters<typeof createPortfolioActionRiskDecision>[0], "decidedAt">, evidenceRef: string
  ): Promise<PortfolioActionRiskDecision> {
    for (const key of ["decidedAt", "riskDecisionId", "riskDecisionHash", "riskInputHash"]) {
      if (key in input) throw new Error("price-bound risk creation cannot accept a record or timestamp");
    }
    const creationInput = JSON.parse(JSON.stringify(input));
    const priceRef = z.string().min(1).max(240).parse(evidenceRef);
    const baseDir = dirname(this.recordsPath);
    return new SourcePriceEvidenceFileRepository(baseDir).withDurableVerifiedHistory(async (history) =>
      new PortfolioSizingSnapshotFileRepository(baseDir).withDurableVerifiedHistory(async (snapshots) =>
        this.#createWithOrigins(creationInput, true, true, snapshots, { history, evidenceRef: priceRef })));
  }

  /** Binds a concrete plan-derived, policy-priced packet execution without accepting model overrides. */
  async createAndAppendWithExecutionOrigin(
    input: Omit<Parameters<typeof createPortfolioActionRiskDecision>[0], "decidedAt">,
    request: Omit<z.input<typeof portfolioPlanExecutionPreviewInputSchema>, "baseDir" | "planId">
  ): Promise<PortfolioActionRiskDecision> {
    for (const key of ["decidedAt", "riskDecisionId", "riskDecisionHash", "riskInputHash"]) {
      if (key in input) throw new Error("execution-bound risk creation cannot accept a record or timestamp");
    }
    const creationInput = JSON.parse(JSON.stringify(input));
    const selected = portfolioPlanExecutionPreviewInputSchema.omit({ baseDir: true, planId: true }).parse(request);
    if (!isDeepStrictEqual(selected, request)) throw new Error("risk execution request must already be canonical");
    const baseDir = dirname(this.recordsPath);
    const candidate = createPortfolioActionRiskDecision({ ...creationInput, decidedAt: new Date().toISOString() });
    const history = await this.readVerifiedHistory();
    const existing = history.records.find((record) => sameCreationInput(record, candidate));
    if (existing !== undefined) {
      const prior = resolveVerifiedPortfolioActionRiskDecisionOrigin(history, existing.riskDecisionId);
      if (prior.executionOrigin === null || prior.planOrigin?.predecessorEventHash !== selected.expectedPlanEventHash ||
        prior.priceOrigin?.evidenceRef !== selected.priceEvidenceRef || prior.executionOrigin.liquidity.packetHash !== selected.liquidityPacketHash) {
        throw new Error("risk execution origin cannot be added or replaced after persistence");
      }
      // A delayed retry explains the original decision, not fresh execution permission.
      // Resolve outside the Risk lock to preserve the source -> Risk lock order.
      const { resolvePortfolioActionRiskDecisionExecution } = await import("./portfolioActionRiskDecisionExecutionResolver.js");
      const resolved = await resolvePortfolioActionRiskDecisionExecution({ baseDir, riskDecisionId: existing.riskDecisionId });
      if (!isDeepStrictEqual(prior, resolved.origin)) throw new Error("risk execution retry origin changed during resolution");
      return this.withLock(async () => {
        const current = resolveVerifiedPortfolioActionRiskDecisionOrigin(await this.readHistoryUnderLock(), existing.riskDecisionId);
        if (!isDeepStrictEqual(current, prior)) throw new Error("risk execution retry origin changed during resolution");
        await syncDurableJsonFile(this.recordsPath);
        return current.record;
      });
    }
    const execution = await createPortfolioPlanExecutionPreview({ ...selected, baseDir, planId: creationInput.planId });
    return new SourcePriceEvidenceFileRepository(baseDir).withDurableVerifiedHistory(async (history) =>
      new PortfolioSizingSnapshotFileRepository(baseDir).withDurableVerifiedHistory(async (snapshots) =>
        this.#createWithOrigins(creationInput, true, true, snapshots,
          { history, evidenceRef: selected.priceEvidenceRef }, execution)));
  }

  async #createWithOrigins(
    input: Omit<Parameters<typeof createPortfolioActionRiskDecision>[0], "decidedAt">, bindPlan: boolean, bindMandate = false,
    snapshotHistory?: VerifiedPortfolioSizingSnapshotHistory,
    priceContext?: { history: VerifiedSourcePriceEvidenceHistory; evidenceRef: string },
    executionContext?: Awaited<ReturnType<typeof createPortfolioPlanExecutionPreview>>
  ): Promise<PortfolioActionRiskDecision> {
    for (const key of ["decidedAt", "riskDecisionId", "riskDecisionHash", "riskInputHash"]) {
      if (key in input) throw new Error("policy-bound risk creation cannot accept a record or timestamp");
    }
    // Snapshot input as well; caller mutation during asynchronous reads is not allowed.
    const creationInput = JSON.parse(JSON.stringify(input));
    const context = bindPlan ? await readStoredRiskDecisionPlanContext({ baseDir: dirname(this.recordsPath), planId: creationInput.planId }) : null;
    if (context !== null) {
      const persist = async (mandateHistory?: VerifiedInvestmentMandateHistory) => {
        // Lock order: price (when bound) -> snapshot -> mandate (when assigned) -> activation -> risk.
        const snapshot = await readStoredRuntimePortfolioPolicyActivationSnapshot(dirname(this.recordsPath));
        const activationStore = new RuntimePortfolioPolicyActivationFileRepository(dirname(this.recordsPath), snapshot.policies, snapshot.dependencies.repository);
        return activationStore.withDurableActivePolicy(creationInput.portfolioId, async (active, observedAt, activationHistory, verifyHistory) => {
          const policyOrigin = Object.freeze({
            activationId: active.activation.activationId, activationEventHash: active.activation.activationEventHash,
            runtimePolicyRecordId: active.policy.runtimePolicyRecordId, policyHash: active.policy.policyHash,
            policyLineageHash: active.policy.lineageHash, observedAt, activationHistory
          });
          // Use the timestamp at which the locked activation generation was folded.
          const record = createPortfolioActionRiskDecision({ ...creationInput, decidedAt: observedAt });
          if (record.policyHash !== active.policy.policyHash) throw new Error("plan-bound risk decision active policy mismatch");
          if (Date.parse(observedAt) < Date.parse(context.origin.observedAt)) throw new Error("plan-bound risk creation clock moved backwards");
          const binding = validateRiskDecisionPlanState(record, context.state);
          let snapshotOrigin: RiskDecisionSnapshotOrigin | null = null;
          let verifySnapshotHistory: ((origin: RiskDecisionSnapshotOrigin, existing: PortfolioActionRiskDecision) => void) | undefined;
          if (snapshotHistory !== undefined) {
            const observation = getDurablePortfolioSizingSnapshotObservation(snapshotHistory);
            if (Date.parse(observedAt) < Date.parse(observation.observedAt)) throw new Error("snapshot-bound risk creation clock moved backwards");
            const resolved = validateRiskDecisionSnapshotState(binding, snapshotHistory.snapshots);
            validateRiskDecisionCashCapacity({ decision: record, snapshot: resolved.snapshot, policy: active.policy });
            snapshotOrigin = { ...riskDecisionSnapshotIdentity(resolved), observation };
            verifySnapshotHistory = (prior, existing) => {
              const original = resolveObservedPortfolioSizingSnapshotHistory(snapshotHistory, prior.observation);
              const previous = validateRiskDecisionSnapshotState({ ...binding, decision: existing }, original);
              validateRiskDecisionCashCapacity({ decision: existing, snapshot: previous.snapshot, policy: active.policy });
              const { observation: _time, ...identity } = prior;
              if (!isDeepStrictEqual(identity, riskDecisionSnapshotIdentity(previous))) throw new Error("risk decision retry snapshot source mismatch");
            };
          }
          let priceOrigin: RiskDecisionPriceOrigin | null = null;
          let verifyPriceHistory: ((origin: RiskDecisionPriceOrigin, existing: PortfolioActionRiskDecision) => void) | undefined;
          if (priceContext !== undefined) {
            const observation = getDurableSourcePriceEvidenceObservation(priceContext.history);
            if (Date.parse(observedAt) < Date.parse(observation.observedAt)) throw new Error("price-bound risk creation clock moved backwards");
            const price = validateRiskDecisionPriceState(record, priceContext.history, priceContext.evidenceRef);
            priceOrigin = { ...riskDecisionPriceIdentity(price), observation };
            verifyPriceHistory = (prior, existing) => {
              const prefix = resolveObservedSourcePriceEvidenceHistory(priceContext.history, prior.observation);
              const original = validateRiskDecisionPriceState(existing, prefix, prior.evidenceRef);
              const { observation: _time, ...identity } = prior;
              if (!isDeepStrictEqual(identity, riskDecisionPriceIdentity(original))) throw new Error("risk decision retry price source mismatch");
            };
          }
          let executionOrigin: RiskDecisionExecutionOrigin | null = null;
          if (executionContext !== undefined) {
            const selectedContext = executionContext.packetPreview.policyPreview.policyContext;
            const planContext = executionContext.planContext;
            if (selectedContext.activationId !== active.activation.activationId || selectedContext.activationEventHash !== active.activation.activationEventHash ||
              selectedContext.policyHash !== active.policy.policyHash || planContext.origin.planCommitHash !== context.origin.planCommitHash ||
              planContext.origin.predecessorCommitHash !== context.origin.predecessorCommitHash || planContext.actionId !== record.actionId ||
              planContext.portfolioVersion !== record.expectedPortfolioVersion || planContext.portfolioSnapshotHash !== record.expectedPortfolioSnapshotHash) {
              throw new Error("risk execution policy or plan changed after preview");
            }
            const scope = record.riskRuleScope;
            const bucket = scope.scopeKind === "bucket" ? active.policy.strategyBuckets.find((item) => item.bucket === scope.bucket) : null;
            const rules = snapshot.dependencies.repository.resolveRiskRuleSetDependencies(bucket?.riskRuleSetRef ?? active.policy.legacyReduceOnlyPolicy.riskRuleSetRef);
            const required = rules.riskRules.filter(({ rule }) => rule.appliesTo.includes(record.side)).map(({ rule }) => rule.ruleId).sort();
            if (record.riskRuleSetRecordId !== rules.riskRuleSet.riskRuleSetRecordId || record.riskRuleSetVersion !== rules.riskRuleSet.version ||
              record.riskRuleSetHash !== rules.riskRuleSet.hash || !isDeepStrictEqual(record.requiredRuleIds, required)) {
              throw new Error("risk execution decision must use the complete policy-selected rule set");
            }
            const rule = rules.riskRules.find(({ rule }) => rule.ruleId === "paper_execution" && rule.ruleVersion === "v1" && rule.appliesTo.includes(record.side));
            if (rule === undefined) throw new Error("risk execution requires policy-selected paper_execution v1");
            const parameters = portfolioExecutionRuleParametersSchema.parse(rule.parameter.parameters);
            const settings = parameters.markets[record.market];
            const original = executionContext.packetPreview.policyPreview.preview;
            if (settings === undefined || !isDeepStrictEqual(riskRuleParameterRefFor(rule.parameter), selectedContext.executionParameterRef) ||
              !isDeepStrictEqual(settings.executionPolicy, original.input.executionPolicy) ||
              !settings.allowedPriceSourceContractIds.includes(original.input.sourcePriceEvidence.sourceContractId) ||
              priceOrigin?.evidenceRef !== original.input.sourcePriceEvidence.evidenceRef || priceOrigin.evidenceHash !== original.input.sourcePriceEvidence.evidenceHash) {
              throw new Error("risk execution selected parameters or price mismatch");
            }
            executionOrigin = parseRiskDecisionExecutionOrigin({ schemaVersion: "portfolio_risk_execution_input.v1",
              preview: createPortfolioActionExecutionPreview({ ...original.input, asOf: observedAt }),
              executionParameterRef: riskRuleParameterRefFor(rule.parameter), maximumPriceAgeSeconds: settings.maximumPriceAgeSeconds,
              liquidity: executionContext.packetPreview.liquidityContext });
            assertRiskExecutionDecisionBinding(record, executionOrigin);
            await verifyRiskExecutionLiquidity(dirname(this.recordsPath), executionOrigin);
          }
          if (mandateHistory === undefined) return this.#appendRecord(record, policyOrigin, context.origin, verifyHistory,
            null, undefined, snapshotOrigin, verifySnapshotHistory, priceOrigin, verifyPriceHistory, executionOrigin);
          const observation = getDurableInvestmentMandateObservation(mandateHistory);
          if (Date.parse(observedAt) < Date.parse(observation.observedAt)) throw new Error("mandate-bound risk creation clock moved backwards");
          const mandate = validateRiskDecisionMandateState(binding, mandateHistory);
          const mandateOrigin = { ...riskDecisionMandateIdentity(mandate), observation };
          return this.#appendRecord(record, policyOrigin, context.origin, verifyHistory, mandateOrigin, (prior, existing) => {
            const original = resolveObservedInvestmentMandateHistory(mandateHistory, prior.observation);
            const previous = validateRiskDecisionMandateState({ ...binding, decision: existing }, original);
            const { observation: _time, ...identity } = prior;
            if (!isDeepStrictEqual(identity, riskDecisionMandateIdentity(previous))) throw new Error("risk decision retry mandate source mismatch");
          }, snapshotOrigin, verifySnapshotHistory, priceOrigin, verifyPriceHistory, executionOrigin);
        });
      };
      const legacySnapshot = snapshotHistory !== undefined && creationInput.riskRuleScope?.scopeKind === "legacy_reduce_only";
      return bindMandate && !legacySnapshot ? new InvestmentMandateFileRepository(dirname(this.recordsPath)).withDurableVerifiedHistory(persist) : persist();
    }
    const snapshot = await readStoredRuntimePortfolioPolicyActivationSnapshot(dirname(this.recordsPath));
    const observedAt = new Date().toISOString();
    const active = resolveActiveRuntimePortfolioPolicyAsOf({
      portfolioId: creationInput.portfolioId, asOf: observedAt,
      events: snapshot.events, policies: snapshot.policies, dependencies: snapshot.dependencies.repository
    });
    const policyOrigin = Object.freeze({
      activationId: active.activation.activationId,
      activationEventHash: active.activation.activationEventHash,
      runtimePolicyRecordId: active.policy.runtimePolicyRecordId,
      policyHash: active.policy.policyHash,
      policyLineageHash: active.policy.lineageHash,
      observedAt
    });
    const decidedAt = new Date().toISOString();
    if (Date.parse(decidedAt) < Date.parse(observedAt)) throw new Error("policy-bound risk creation clock moved backwards");
    const record = createPortfolioActionRiskDecision({ ...creationInput, decidedAt });
    return this.#appendRecord(record, policyOrigin);
  }

  async #appendRecord(value: unknown, policyOrigin: PersistedPolicyOrigin | null, planOrigin: RiskDecisionPlanOrigin | null = null,
    verifyActivationHistory?: (boundary: NonNullable<PersistedPolicyOrigin["activationHistory"]>) => void,
    mandateOrigin: RiskDecisionMandateOrigin | null = null,
    verifyMandateHistory?: (origin: RiskDecisionMandateOrigin, existing: PortfolioActionRiskDecision) => void,
    snapshotOrigin: RiskDecisionSnapshotOrigin | null = null,
    verifySnapshotHistory?: (origin: RiskDecisionSnapshotOrigin, existing: PortfolioActionRiskDecision) => void,
    priceOrigin: RiskDecisionPriceOrigin | null = null,
    verifyPriceHistory?: (origin: RiskDecisionPriceOrigin, existing: PortfolioActionRiskDecision) => void,
    executionOrigin: RiskDecisionExecutionOrigin | null = null): Promise<PortfolioActionRiskDecision> {
    const candidate = cloneRecord(value);
    return this.withLock(async () => {
      const history = await this.readHistoryUnderLock();
      const records = history.records;
      const existing = records.find(
        (record) => record.riskDecisionId === candidate.riskDecisionId ||
          (policyOrigin !== null && sameCreationInput(record, candidate))
      );
      if (existing !== undefined) {
        if (!(policyOrigin === null ? isDeepStrictEqual(existing, candidate) : sameCreationInput(existing, candidate))) {
          throw new Error("portfolio action risk decision ref collision");
        }
        if (policyOrigin !== null) {
          const prior = getVerifiedHistoryMetadata(history).policyOriginById.get(existing.riskDecisionId);
          if (prior === undefined || !samePolicyOriginIdentity(prior, policyOrigin)) {
            throw new Error("risk policy origin cannot be added or replaced after persistence");
          }
          if (planOrigin !== null) {
            if (prior.activationHistory === undefined || verifyActivationHistory === undefined) {
              throw new Error("risk decision retry requires its original activation history boundary");
            }
            verifyActivationHistory(prior.activationHistory);
          }
        }
        if (planOrigin !== null) {
          const prior = getVerifiedHistoryMetadata(history).planOriginById.get(existing.riskDecisionId);
          if (prior === undefined || !samePlanOriginIdentity(prior, planOrigin)) throw new Error("risk plan origin cannot be added or replaced after persistence");
        }
        if (mandateOrigin !== null) {
          const prior = getVerifiedHistoryMetadata(history).mandateOriginById.get(existing.riskDecisionId);
          const { observation: _current, ...identity } = mandateOrigin;
          const { observation: _prior, ...priorIdentity } = prior ?? {};
          if (prior === undefined || verifyMandateHistory === undefined || !isDeepStrictEqual(identity, priorIdentity)) {
            throw new Error("risk mandate origin cannot be added or replaced after persistence");
          }
          verifyMandateHistory(prior, existing);
        }
        if (snapshotOrigin !== null) {
          const prior = getVerifiedHistoryMetadata(history).snapshotOriginById.get(existing.riskDecisionId);
          const { observation: _current, ...identity } = snapshotOrigin;
          const { observation: _prior, ...priorIdentity } = prior ?? {};
          if (prior === undefined || verifySnapshotHistory === undefined || !isDeepStrictEqual(identity, priorIdentity)) {
            throw new Error("risk snapshot origin cannot be added or replaced after persistence");
          }
          verifySnapshotHistory(prior, existing);
        }
        if (priceOrigin !== null) {
          const prior = getVerifiedHistoryMetadata(history).priceOriginById.get(existing.riskDecisionId);
          const { observation: _current, ...identity } = priceOrigin;
          const { observation: _prior, ...priorIdentity } = prior ?? {};
          if (prior === undefined || verifyPriceHistory === undefined || !isDeepStrictEqual(identity, priorIdentity)) {
            throw new Error("risk price origin cannot be added or replaced after persistence");
          }
          verifyPriceHistory(prior, existing);
        }
        if (executionOrigin !== null) {
          const prior = getVerifiedHistoryMetadata(history).executionOriginById.get(existing.riskDecisionId);
          if (prior === undefined || !sameExecutionOriginIdentity(prior, executionOrigin)) {
            throw new Error("risk execution origin cannot be added or replaced after persistence");
          }
          assertRiskExecutionDecisionBinding(existing, prior);
          await verifyRiskExecutionLiquidity(dirname(this.recordsPath), prior);
        }
        await syncDurableJsonFile(this.recordsPath);
        return existing;
      }
      const candidateOrigin = originKey(candidate);
      if (records.some((record) => originKey(record) === candidateOrigin)) {
        throw new Error("portfolio action risk decision hash collision");
      }
      const metadata = getVerifiedHistoryMetadata(history);
      const appendStartedAt = new Date().toISOString();
      if (metadata.lastCommittedAt !== null &&
        Date.parse(appendStartedAt) < Date.parse(metadata.lastCommittedAt)) {
        throw new Error("portfolio action risk decision clock moved backwards since previous commit");
      }
      const entry = createPortfolioActionRiskDecisionFileEntry({
        record: candidate,
        appendStartedAt,
        previousEntryHash: metadata.lastEntryHash,
        policyOrigin, planOrigin, mandateOrigin, snapshotOrigin, priceOrigin, executionOrigin
      });
      await appendDurableJsonLine(this.recordsPath, entry);
      // Sample availability only after the record and directory sync complete.
      // The second append binds that post-record-fsync time to this exact entry.
      const committedAt = new Date().toISOString();
      if (Date.parse(committedAt) < Date.parse(entry.appendStartedAt)) {
        throw new Error("portfolio action risk decision clock moved backwards during append");
      }
      const marker = {
        schemaVersion: "portfolio_action_risk_decision_commit.v1" as const,
        entryHash: entry.entryHash,
        committedAt
      };
      await appendDurableJsonLine(this.recordsPath, {
        ...marker, commitHash: hashCanonicalPayload(marker)
      });
      return candidate;
    });
  }

  private async readHistoryUnderLock(): Promise<VerifiedPortfolioActionRiskDecisionHistory> {
    let raw: string;
    try {
      raw = await readFile(this.recordsPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return createVerifiedPortfolioActionRiskDecisionHistory([]);
      }
      throw error;
    }
    return createVerifiedPortfolioActionRiskDecisionHistory(
      parsePortfolioActionRiskDecisionEntries(raw)
    );
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

/** Parses and independently verifies a complete durable risk-decision log. */
export function parsePortfolioActionRiskDecisions(
  raw: string
): readonly PortfolioActionRiskDecision[] {
  return Object.freeze(
    parsePortfolioActionRiskDecisionEntries(raw).map((entry) => entry.record)
  );
}

function parsePortfolioActionRiskDecisionEntries(
  raw: string
): readonly ParsedRiskDecisionEntry[] {
  if (raw.length > 0 && !raw.endsWith("\n")) {
    throw new Error("portfolio action risk decision file has a torn final line");
  }
  const lines = raw.split(/\r?\n/);
  lines.pop();
  const entries: ParsedRiskDecisionEntry[] = [];
  const refs = new Set<string>();
  const origins = new Set<string>();
  let previousEntryHash: string | null = null;
  let previousCommittedAt: string | null = null;
  let hasCommittedEntry = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.length === 0) {
      throw new Error(
        `portfolio action risk decision file contains corrupt line ${index + 1}`
      );
    }
    let entry: ParsedRiskDecisionEntry;
    try {
      const value: unknown = JSON.parse(line);
      if (value !== null && typeof value === "object" && "schemaVersion" in value) {
        const parsed = value.schemaVersion === "portfolio_action_risk_decision_entry.v8" ? executionBoundEntrySchema.parse(value)
          : value.schemaVersion === "portfolio_action_risk_decision_entry.v7" ? priceBoundEntrySchema.parse(value)
          : value.schemaVersion === "portfolio_action_risk_decision_entry.v6" ? snapshotBoundEntrySchema.parse(value)
          : value.schemaVersion === "portfolio_action_risk_decision_entry.v5" ? mandateBoundEntrySchema.parse(value)
          : value.schemaVersion === "portfolio_action_risk_decision_entry.v4" ? planBoundEntrySchema.parse(value)
          : value.schemaVersion === "portfolio_action_risk_decision_entry.v3" ? policyBoundEntrySchema.parse(value) : committedEntrySchema.parse(value);
        const record = parsePortfolioActionRiskDecision(parsed.record);
        const policyOrigin = "policyOrigin" in parsed ? parsed.policyOrigin : null;
        const planOrigin = "planOrigin" in parsed ? parsed.planOrigin : null;
        const mandateOrigin = "mandateOrigin" in parsed ? parsed.mandateOrigin : null;
        const snapshotOrigin = "snapshotOrigin" in parsed ? parsed.snapshotOrigin : null;
        const priceOrigin = "priceOrigin" in parsed ? parsed.priceOrigin : null;
        const executionOrigin = "executionOrigin" in parsed ? parseRiskDecisionExecutionOrigin(parsed.executionOrigin) : null;
        if (executionOrigin !== null) {
          assertRiskExecutionDecisionBinding(record, executionOrigin);
          if (priceOrigin?.evidenceRef !== executionOrigin.preview.input.sourcePriceEvidence.evidenceRef ||
            priceOrigin.evidenceHash !== executionOrigin.preview.input.sourcePriceEvidence.evidenceHash) {
            throw new Error("risk execution input differs from selected price origin");
          }
        }
        const payload = {
          schemaVersion: parsed.schemaVersion, record,
          appendStartedAt: parsed.appendStartedAt,
          previousEntryHash: parsed.previousEntryHash,
          ...(policyOrigin === null ? {} : { policyOrigin }),
          ...(planOrigin === null ? {} : { planOrigin }),
          ...(snapshotOrigin === null ? (mandateOrigin === null ? {} : { mandateOrigin }) : { mandateOrigin, snapshotOrigin }),
          ...(priceOrigin === null ? {} : { priceOrigin }),
          ...(executionOrigin === null ? {} : { executionOrigin })
        };
        if (parsed.previousEntryHash !== previousEntryHash ||
          parsed.entryHash !== hashCanonicalPayload(payload) ||
          !isDeepStrictEqual(value, { ...payload, entryHash: parsed.entryHash }) ||
          Date.parse(parsed.appendStartedAt) < Date.parse(record.decidedAt) ||
          (policyOrigin !== null && Date.parse(record.decidedAt) < Date.parse(policyOrigin.observedAt)) ||
          (mandateOrigin !== null && Date.parse(record.decidedAt) < Date.parse(mandateOrigin.observation.observedAt)) ||
          (priceOrigin !== null && (Date.parse(record.decidedAt) < Date.parse(priceOrigin.observation.observedAt) ||
            !record.riskEvidenceRefs.includes(priceOrigin.evidenceRef))) ||
          (snapshotOrigin !== null && (Date.parse(record.decidedAt) < Date.parse(snapshotOrigin.observation.observedAt) ||
            snapshotOrigin.portfolioSnapshotHash !== record.expectedPortfolioSnapshotHash ||
            (mandateOrigin !== null) !== (record.riskRuleScope.scopeKind === "bucket"))) ||
          (planOrigin !== null && (planOrigin.planId !== record.planId ||
            Date.parse(record.decidedAt) < Date.parse(planOrigin.observedAt) ||
            Date.parse(planOrigin.observedAt) < Date.parse(planOrigin.planAppendedAt) ||
            Date.parse(planOrigin.observedAt) < Date.parse(planOrigin.predecessorAppendedAt))) ||
          (previousCommittedAt !== null && Date.parse(parsed.appendStartedAt) < Date.parse(previousCommittedAt))) {
          throw new Error("portfolio action risk decision entry origin mismatch");
        }
        const markerValue: unknown = JSON.parse(lines[++index] ?? "");
        const marker = commitMarkerSchema.parse(markerValue);
        const markerPayload = {
          schemaVersion: marker.schemaVersion,
          entryHash: marker.entryHash,
          committedAt: marker.committedAt
        };
        if (marker.entryHash !== parsed.entryHash ||
          marker.commitHash !== hashCanonicalPayload(markerPayload) ||
          !isDeepStrictEqual(markerValue, { ...markerPayload, commitHash: marker.commitHash }) ||
          Date.parse(marker.committedAt) < Date.parse(parsed.appendStartedAt)) {
          throw new Error("portfolio action risk decision durable commit origin mismatch");
        }
        entry = { record, committedAt: marker.committedAt, tailHash: marker.commitHash, policyOrigin, planOrigin, mandateOrigin, snapshotOrigin, priceOrigin, executionOrigin };
        previousCommittedAt = marker.committedAt;
        hasCommittedEntry = true;
      } else {
        if (hasCommittedEntry) throw new Error("legacy risk decision cannot follow committed entries");
        const legacy = parsePortfolioActionRiskDecisionFileEntry(value, previousEntryHash);
        // Legacy pre-write timestamps cannot prove durability, including on retry.
        entry = { record: legacy.record, committedAt: null, tailHash: legacy.entryHash, policyOrigin: null, planOrigin: null, mandateOrigin: null, snapshotOrigin: null, priceOrigin: null, executionOrigin: null };
      }
    } catch (error) {
      throw new Error(
        `portfolio action risk decision file contains corrupt line ${index + 1}`,
        { cause: error }
      );
    }
    const record = entry.record;
    if (refs.has(record.riskDecisionId)) {
      throw new Error("portfolio action risk decision file contains a duplicate ref");
    }
    const origin = originKey(record);
    if (origins.has(origin)) {
      throw new Error(
        "portfolio action risk decision file contains a duplicate hash"
      );
    }
    refs.add(record.riskDecisionId);
    origins.add(origin);
    entries.push(entry);
    previousEntryHash = entry.tailHash;
  }
  return Object.freeze(entries);
}

export function getVerifiedPortfolioActionRiskDecisions(
  history: VerifiedPortfolioActionRiskDecisionHistory
): readonly PortfolioActionRiskDecision[] {
  if (!verifiedPortfolioActionRiskDecisionHistories.has(history)) {
    throw new Error("portfolio action risk decision history is not verified");
  }
  return history.records;
}

export function resolveVerifiedPortfolioActionRiskDecisionOrigin(
  history: VerifiedPortfolioActionRiskDecisionHistory,
  riskDecisionId: string
): VerifiedPortfolioActionRiskDecisionOrigin {
  const records = getVerifiedPortfolioActionRiskDecisions(history);
  const matches = records.filter((record) => record.riskDecisionId === riskDecisionId);
  if (matches.length !== 1) {
    throw new Error("portfolio action risk decision does not resolve exactly once");
  }
  const metadata = getVerifiedHistoryMetadata(history);
  const appendedAt = metadata.appendedAtById.get(riskDecisionId);
  if (appendedAt === undefined) {
    throw new Error("portfolio action risk decision durable origin is unavailable; legacy record requires review");
  }
  return deepFreeze({
    record: matches[0] as PortfolioActionRiskDecision,
    appendedAt,
    commitHash: metadata.commitHashById.get(riskDecisionId)!,
    policyOrigin: metadata.policyOriginById.get(riskDecisionId) ?? null,
    planOrigin: metadata.planOriginById.get(riskDecisionId) ?? null,
    mandateOrigin: metadata.mandateOriginById.get(riskDecisionId) ?? null,
    snapshotOrigin: metadata.snapshotOriginById.get(riskDecisionId) ?? null,
    priceOrigin: metadata.priceOriginById.get(riskDecisionId) ?? null,
    executionOrigin: metadata.executionOriginById.get(riskDecisionId) ?? null
  });
}

function createVerifiedPortfolioActionRiskDecisionHistory(
  entries: readonly ParsedRiskDecisionEntry[]
): VerifiedPortfolioActionRiskDecisionHistory {
  const records = entries.map((entry) => entry.record);
  const history = Object.freeze({ records: Object.freeze([...records]) });
  verifiedPortfolioActionRiskDecisionHistories.add(history);
  verifiedPortfolioActionRiskDecisionMetadata.set(history, {
    appendedAtById: new Map(
      entries.filter((entry) => entry.committedAt !== null)
        .map((entry) => [entry.record.riskDecisionId, entry.committedAt!])
    ),
    commitHashById: new Map(entries.filter((entry) => entry.committedAt !== null)
      .map((entry) => [entry.record.riskDecisionId, entry.tailHash])),
    policyOriginById: new Map(entries.filter((entry) => entry.policyOrigin !== null)
      .map((entry) => [entry.record.riskDecisionId, deepFreeze(entry.policyOrigin!)])),
    planOriginById: new Map(entries.filter((entry) => entry.planOrigin !== null)
      .map((entry) => [entry.record.riskDecisionId, deepFreeze(entry.planOrigin!)])),
    mandateOriginById: new Map(entries.filter((entry) => entry.mandateOrigin !== null)
      .map((entry) => [entry.record.riskDecisionId, deepFreeze(entry.mandateOrigin!)])),
    snapshotOriginById: new Map(entries.filter((entry) => entry.snapshotOrigin !== null)
      .map((entry) => [entry.record.riskDecisionId, deepFreeze(entry.snapshotOrigin!)])),
    priceOriginById: new Map(entries.filter((entry) => entry.priceOrigin !== null)
      .map((entry) => [entry.record.riskDecisionId, deepFreeze(entry.priceOrigin!)])),
    executionOriginById: new Map(entries.filter((entry) => entry.executionOrigin !== null)
      .map((entry) => [entry.record.riskDecisionId, deepFreeze(entry.executionOrigin!)])),
    lastEntryHash: entries.at(-1)?.tailHash ?? null,
    lastCommittedAt: entries.at(-1)?.committedAt ?? null
  });
  return history;
}

function getVerifiedHistoryMetadata(
  history: VerifiedPortfolioActionRiskDecisionHistory
): VerifiedHistoryMetadata {
  const metadata = verifiedPortfolioActionRiskDecisionMetadata.get(history);
  if (metadata === undefined) {
    throw new Error("portfolio action risk decision history is not verified");
  }
  return metadata;
}

function createPortfolioActionRiskDecisionFileEntry(input: {
  record: PortfolioActionRiskDecision;
  appendStartedAt: string;
  previousEntryHash: string | null;
  policyOrigin: PersistedPolicyOrigin | null;
  planOrigin: RiskDecisionPlanOrigin | null;
  mandateOrigin: RiskDecisionMandateOrigin | null;
  snapshotOrigin: RiskDecisionSnapshotOrigin | null;
  priceOrigin: RiskDecisionPriceOrigin | null;
  executionOrigin: RiskDecisionExecutionOrigin | null;
}) {
  if (Date.parse(input.appendStartedAt) < Date.parse(input.record.decidedAt)) {
    throw new Error("portfolio action risk decision cannot be appended before decision time");
  }
  const common = {
    record: input.record,
    appendStartedAt: input.appendStartedAt,
    previousEntryHash: input.previousEntryHash
  };
  const payload = input.executionOrigin !== null
    ? { schemaVersion: "portfolio_action_risk_decision_entry.v8" as const, ...common,
      policyOrigin: generationBoundPolicyOriginSchema.parse(input.policyOrigin), planOrigin: riskDecisionPlanOriginSchema.parse(input.planOrigin),
      mandateOrigin: input.mandateOrigin === null ? null : riskDecisionMandateOriginSchema.parse(input.mandateOrigin),
      snapshotOrigin: riskDecisionSnapshotOriginSchema.parse(input.snapshotOrigin), priceOrigin: riskDecisionPriceOriginSchema.parse(input.priceOrigin),
      executionOrigin: parseRiskDecisionExecutionOrigin(input.executionOrigin) }
    : input.priceOrigin !== null
    ? { schemaVersion: "portfolio_action_risk_decision_entry.v7" as const, ...common,
      policyOrigin: generationBoundPolicyOriginSchema.parse(input.policyOrigin), planOrigin: riskDecisionPlanOriginSchema.parse(input.planOrigin),
      mandateOrigin: input.mandateOrigin === null ? null : riskDecisionMandateOriginSchema.parse(input.mandateOrigin),
      snapshotOrigin: riskDecisionSnapshotOriginSchema.parse(input.snapshotOrigin), priceOrigin: riskDecisionPriceOriginSchema.parse(input.priceOrigin) }
    : input.snapshotOrigin !== null
    ? { schemaVersion: "portfolio_action_risk_decision_entry.v6" as const, ...common,
      policyOrigin: generationBoundPolicyOriginSchema.parse(input.policyOrigin), planOrigin: riskDecisionPlanOriginSchema.parse(input.planOrigin),
      mandateOrigin: input.mandateOrigin === null ? null : riskDecisionMandateOriginSchema.parse(input.mandateOrigin),
      snapshotOrigin: riskDecisionSnapshotOriginSchema.parse(input.snapshotOrigin) }
    : input.mandateOrigin !== null
    ? { schemaVersion: "portfolio_action_risk_decision_entry.v5" as const, ...common,
      policyOrigin: generationBoundPolicyOriginSchema.parse(input.policyOrigin), planOrigin: riskDecisionPlanOriginSchema.parse(input.planOrigin),
      mandateOrigin: riskDecisionMandateOriginSchema.parse(input.mandateOrigin) }
    : input.planOrigin !== null
    ? { schemaVersion: "portfolio_action_risk_decision_entry.v4" as const, ...common,
      policyOrigin: generationBoundPolicyOriginSchema.parse(input.policyOrigin), planOrigin: riskDecisionPlanOriginSchema.parse(input.planOrigin) }
    : input.policyOrigin === null
    ? { schemaVersion: "portfolio_action_risk_decision_entry.v2" as const, ...common }
    : { schemaVersion: "portfolio_action_risk_decision_entry.v3" as const, ...common, policyOrigin: policyOriginSchema.parse(input.policyOrigin) };
  return deepFreeze({
    ...payload,
    entryHash: hashCanonicalPayload(payload)
  });
}

function parsePortfolioActionRiskDecisionFileEntry(
  value: unknown,
  expectedPreviousEntryHash: string | null
): PortfolioActionRiskDecisionFileEntry {
  const parsed = portfolioActionRiskDecisionFileEntrySchema.parse(value);
  const record = parsePortfolioActionRiskDecision(parsed.record);
  const canonical = {
    record,
    appendedAt: parsed.appendedAt,
    previousEntryHash: parsed.previousEntryHash,
    entryHash: parsed.entryHash
  };
  if (!isDeepStrictEqual(value, canonical)) {
    throw new Error("portfolio action risk decision file entry must already be canonical");
  }
  if (canonical.previousEntryHash !== expectedPreviousEntryHash) {
    throw new Error("portfolio action risk decision file predecessor mismatch");
  }
  if (Date.parse(canonical.appendedAt) < Date.parse(record.decidedAt)) {
    throw new Error("portfolio action risk decision cannot be appended before decision time");
  }
  const expectedEntryHash = hashCanonicalPayload({
    record,
    appendedAt: canonical.appendedAt,
    previousEntryHash: canonical.previousEntryHash
  });
  if (canonical.entryHash !== expectedEntryHash) {
    throw new Error("portfolio action risk decision file entry hash mismatch");
  }
  return deepFreeze(canonical);
}

function originKey(record: PortfolioActionRiskDecision): string {
  return record.riskDecisionHash;
}

function sameCreationInput(left: PortfolioActionRiskDecision, right: PortfolioActionRiskDecision): boolean {
  const { decidedAt: _a, riskDecisionId: _b, riskDecisionHash: _c, riskInputHash: _d, ...leftInput } = left;
  const { decidedAt: _e, riskDecisionId: _f, riskDecisionHash: _g, riskInputHash: _h, ...rightInput } = right;
  return isDeepStrictEqual(leftInput, rightInput);
}

function sameExecutionOriginIdentity(left: RiskDecisionExecutionOrigin, right: RiskDecisionExecutionOrigin): boolean {
  const identity = (origin: RiskDecisionExecutionOrigin) => {
    const { asOf: _time, ...input } = origin.preview.input;
    const { readAt: _readAt, historyRecordCount: _count, historyHash: _history, ...liquidity } = origin.liquidity;
    return { input, liquidity, executionParameterRef: origin.executionParameterRef, maximumPriceAgeSeconds: origin.maximumPriceAgeSeconds };
  };
  return isDeepStrictEqual(identity(left), identity(right));
}

function samePolicyOriginIdentity(left: PersistedPolicyOrigin, right: PersistedPolicyOrigin): boolean {
  // Retry keeps the original receipt; later unrelated/future events do not replace it.
  const { observedAt: _a, activationHistory: _c, ...leftIdentity } = left;
  const { observedAt: _b, activationHistory: _d, ...rightIdentity } = right;
  return isDeepStrictEqual(leftIdentity, rightIdentity);
}

function samePlanOriginIdentity(left: RiskDecisionPlanOrigin, right: RiskDecisionPlanOrigin): boolean {
  const { observedAt: _a, ...leftIdentity } = left;
  const { observedAt: _b, ...rightIdentity } = right;
  return isDeepStrictEqual(leftIdentity, rightIdentity);
}

function cloneRecord(value: unknown): PortfolioActionRiskDecision {
  const record = parsePortfolioActionRiskDecision(value);
  return parsePortfolioActionRiskDecision(JSON.parse(JSON.stringify(record)));
}

async function appendDurableJsonLine(
  path: string,
  value: unknown
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
      throw new Error("portfolio action risk decision repository lock is unavailable");
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
            throw new Error("portfolio action risk decision lock ownership changed");
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
        throw new Error("portfolio action risk decision repository lock is unavailable");
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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
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
