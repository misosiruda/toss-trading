import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { FileVirtualPortfolioStore } from "../storage/virtualPortfolioFileStore.js";
import { createPortfolioSizingSnapshot, portfolioSizingSnapshotSchema } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { resolvePortfolioSizingSnapshot } from "./portfolioSizingSnapshotResolver.js";

const inputSchema = portfolioSizingSnapshotSchema.omit({ portfolioSnapshotId: true, portfolioSnapshotHash: true,
  portfolioId: true, portfolioVersion: true, virtualPortfolio: true }).extend({
  baseDir: z.string().min(1), portfolioPath: z.string().min(1)
}).strict();

/** Publishes a snapshot of the actual locked paper portfolio, with its revision hash as version.
 * Valuation replay remains mandatory. Policy activation, price provenance and pending/capacity
 * authority are not established here; a persisted snapshot is not a current execution lease.
 */
export async function appendCurrentPortfolioSizingSnapshot(value: z.input<typeof inputSchema>,
  options: ConstructorParameters<typeof FileVirtualPortfolioStore>[1] = {}) {
  return publish(value, options, false);
}

/** Also binds publication to the actual active policy, holding sizing -> policy -> activation locks through fsync.
 * The result still does not authorize pending reservations, Risk or current execution.
 */
export async function appendPolicyBoundCurrentPortfolioSizingSnapshot(value: z.input<typeof inputSchema>,
  options: ConstructorParameters<typeof FileVirtualPortfolioStore>[1] = {}) {
  return publish(value, options, true);
}

async function publish(value: z.input<typeof inputSchema>,
  options: ConstructorParameters<typeof FileVirtualPortfolioStore>[1], requireActivePolicy: boolean) {
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
    // Hold the source portfolio lock through destination append/fsync/exact retry.
    return requireActivePolicy ? snapshots.appendForActivePolicy(snapshot) : snapshots.append(snapshot);
  });
}
