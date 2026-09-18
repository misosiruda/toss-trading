import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { FileVirtualPortfolioStore } from "../storage/virtualPortfolioFileStore.js";
import { createPortfolioSizingSnapshot, portfolioSizingSnapshotSchema } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository, type OpeningBudgetBoundSizingPublication } from "./portfolioSizingSnapshotFiles.js";
import type { PortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { resolvePortfolioSizingSnapshot } from "./portfolioSizingSnapshotResolver.js";

const inputSchema = portfolioSizingSnapshotSchema.omit({ portfolioSnapshotId: true, portfolioSnapshotHash: true,
  portfolioId: true, portfolioVersion: true, virtualPortfolio: true }).extend({
  baseDir: z.string().min(1), portfolioPath: z.string().min(1)
}).strict();
const scopePaths = z.object({ baseDir: z.string().min(1), portfolioPath: z.string().min(1) }).strict();
const heldPublications = new WeakMap<OpeningBudgetBoundSizingPublication, Readonly<{ baseDir: string; portfolioPath: string; observedAt: number }>>();

/** Actual callback identity/path/lifetime check, not a copyable receipt or an execution/allocation approval. */
export function assertHeldCurrentOpeningBudget(publication: OpeningBudgetBoundSizingPublication,
  paths: z.input<typeof scopePaths>): void {
  const input = scopePaths.parse(paths), held = heldPublications.get(publication);
  if (!isDeepStrictEqual(paths, input)) throw new Error("current opening budget paths must already be canonical");
  if (!held) throw new Error("current opening budget requires an active publication scope");
  if (resolve(input.baseDir) !== held.baseDir || resolve(input.portfolioPath) !== held.portfolioPath) {
    throw new Error("current opening budget belongs to a different source path");
  }
  if (Date.now() < held.observedAt) throw new Error("current opening budget observation clock moved backwards");
}

/** Publishes a snapshot of the actual locked paper portfolio, with its revision hash as version.
 * Valuation replay remains mandatory. Policy activation, price provenance and pending/capacity
 * authority are not established here; a persisted snapshot is not a current execution lease.
 */
export async function appendCurrentPortfolioSizingSnapshot(value: z.input<typeof inputSchema>,
  options: ConstructorParameters<typeof FileVirtualPortfolioStore>[1] = {}) {
  return publish(value, options, "unbound");
}

/** Binds stored marks/FX, pending progress, mandate/execution origins, reservation roots/bound mandates/consumption/retirement and active policy through destination fsync.
 * Locks: portfolio -> price -> FX -> manual -> request -> sizing -> input -> assignment -> manual/selector reservation
 * -> event -> plan -> mandate -> policy -> activation -> Risk -> fill -> capacity.
 * Pending BUY membership, prior consumption and aggregate gross coverage are checked. Unverified cancellation releases are rejected.
 * Allocation, accounting, external trust and current execution remain separate gates.
 */
export async function appendPolicyBoundCurrentPortfolioSizingSnapshot(value: z.input<typeof inputSchema>,
  options: ConstructorParameters<typeof FileVirtualPortfolioStore>[1] = {}) {
  return publish(value, options, "policy");
}

/** Publishes and computes opening bounds while the actual portfolio, active policy and all reservation sources remain locked.
 * Requires explicit opening limits. Returns detached observations, not an allocation, execution or accounting authority.
 */
export async function appendOpeningBudgetBoundCurrentPortfolioSizingSnapshot(value: z.input<typeof inputSchema>,
  options: ConstructorParameters<typeof FileVirtualPortfolioStore>[1] = {}) {
  return publish(value, options, "opening-budget");
}

/** Internal composition boundary. The callback runs after durable snapshot publication, with portfolio and all source locks held.
 * Never call a source-lock-taking repository inside it. Consumer writes are not atomically rolled back on failure.
 * Captured publication contents remain readable after exit, but their held identity is revoked in finally.
 */
export async function withPublishedCurrentOpeningBudget<T>(value: z.input<typeof inputSchema>,
  operation: (publication: OpeningBudgetBoundSizingPublication) => Promise<T>,
  options: ConstructorParameters<typeof FileVirtualPortfolioStore>[1] = {}): Promise<T> {
  if (typeof operation !== "function") throw new Error("current opening budget consumer must be a function");
  return withCurrentPortfolio(value, options, (snapshot, repository, paths) =>
    repository.withPublishedOpeningBudgetForActivePolicy(snapshot, async (publication) => {
      const observedAt = Date.parse(publication.openingBudget.occupancy.assessment.observedAt);
      heldPublications.set(publication, Object.freeze({ ...paths, observedAt }));
      try {
        assertHeldCurrentOpeningBudget(publication, paths);
        const result = await operation(publication);
        assertHeldCurrentOpeningBudget(publication, paths);
        return result;
      } finally { heldPublications.delete(publication); }
    }));
}

function publish(value: z.input<typeof inputSchema>, options: ConstructorParameters<typeof FileVirtualPortfolioStore>[1],
  mode: "unbound" | "policy"): Promise<PortfolioSizingSnapshot>;
function publish(value: z.input<typeof inputSchema>, options: ConstructorParameters<typeof FileVirtualPortfolioStore>[1],
  mode: "opening-budget"): Promise<OpeningBudgetBoundSizingPublication>;
async function publish(value: z.input<typeof inputSchema>,
  options: ConstructorParameters<typeof FileVirtualPortfolioStore>[1], mode: "unbound" | "policy" | "opening-budget") {
  return withCurrentPortfolio<PortfolioSizingSnapshot | OpeningBudgetBoundSizingPublication>(value, options, (snapshot, snapshots) => {
    if (mode === "opening-budget") return snapshots.appendWithOpeningBudgetForActivePolicy(snapshot);
    return mode === "policy" ? snapshots.appendForActivePolicy(snapshot) : snapshots.append(snapshot);
  });
}

async function withCurrentPortfolio<T>(value: z.input<typeof inputSchema>,
  options: ConstructorParameters<typeof FileVirtualPortfolioStore>[1],
  operation: (snapshot: PortfolioSizingSnapshot, repository: PortfolioSizingSnapshotFileRepository,
    paths: Readonly<{ baseDir: string; portfolioPath: string }>) => Promise<T>): Promise<T> {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("current sizing snapshot input must already be canonical");
  const baseDir = resolve(input.baseDir), portfolioPath = resolve(input.portfolioPath);
  const portfolioStore = new FileVirtualPortfolioStore(portfolioPath, options);
  const snapshots = new PortfolioSizingSnapshotFileRepository(baseDir, options);
  return portfolioStore.withLockedSnapshot(async ({ portfolio, revisionHash }) => {
    if (portfolio === null || revisionHash === null) throw new Error("current sizing snapshot requires a journaled paper portfolio");
    const snapshot = createPortfolioSizingSnapshot({ portfolioId: portfolio.portfolioId, portfolioVersion: revisionHash,
      virtualPortfolio: portfolio, policyHash: input.policyHash, asOf: input.asOf,
      valuationInputs: input.valuationInputs, pendingActionInputs: input.pendingActionInputs,
      exposureSnapshot: input.exposureSnapshot, exposureSnapshotHash: input.exposureSnapshotHash });
    resolvePortfolioSizingSnapshot(snapshot);
    // Hold the actual portfolio lock through publication and any trusted internal consumer.
    return operation(snapshot, snapshots, Object.freeze({ baseDir, portfolioPath }));
  });
}
