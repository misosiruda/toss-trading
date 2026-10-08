import { lstat, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { observeReplayInitialPortfolio, replayInitialPortfolioReservationSchema, replayInitialPortfolioObservationSchema,
  type ReplayInitialPortfolioIdentity, type ReplayInitialPortfolioOrigin } from "../domain/replayInitialPortfolioObservation.js";
import type { VirtualPortfolio } from "../domain/schemas.js";
import { maskObject } from "../security/masking.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { assertExperimentPathSyntax, ensureExperimentDirectory, hasFsCode, writeExclusiveExperimentFile } from "./paperExperimentFilesystem.js";
import { HISTORICAL_REPLAY_REPORT_FILE_NAME, HISTORICAL_REPLAY_PROGRESS_FILE_NAME, HISTORICAL_REPLAY_RUN_METADATA_FILE_NAME,
  HISTORICAL_REPLAY_RESEARCH_MANIFEST_FILE_NAME, HISTORICAL_REPLAY_PACKETS_FILE_NAME, HISTORICAL_REPLAY_DECISIONS_FILE_NAME,
  HISTORICAL_REPLAY_RISK_DECISIONS_FILE_NAME, HISTORICAL_REPLAY_TRADES_FILE_NAME, HISTORICAL_REPLAY_PORTFOLIO_TIMELINE_FILE_NAME } from "./artifactPaths.js";

export const REPLAY_INITIAL_PORTFOLIO_FILE = "historical-replay-initial-portfolio.json";
export const REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE = "historical-replay-initial-portfolio.reserved.json";
const replayOutputs = [REPLAY_INITIAL_PORTFOLIO_FILE, HISTORICAL_REPLAY_REPORT_FILE_NAME, HISTORICAL_REPLAY_PROGRESS_FILE_NAME,
  HISTORICAL_REPLAY_RUN_METADATA_FILE_NAME, HISTORICAL_REPLAY_RESEARCH_MANIFEST_FILE_NAME, HISTORICAL_REPLAY_PACKETS_FILE_NAME,
  HISTORICAL_REPLAY_DECISIONS_FILE_NAME, HISTORICAL_REPLAY_RISK_DECISIONS_FILE_NAME, HISTORICAL_REPLAY_TRADES_FILE_NAME,
  HISTORICAL_REPLAY_PORTFOLIO_TIMELINE_FILE_NAME];

export class ReplayInitialPortfolioDurabilityError extends Error {
  readonly code = "DURABILITY_UNAVAILABLE";
  constructor() { super("initial portfolio observation durability failed"); this.name = "ReplayInitialPortfolioDurabilityError"; }
}

/** Reserve before rewriting existing replay artifacts. The immutable reservation is never removed or retried. */
export async function reserveReplayInitialPortfolioObservation(input: {
  storageBaseDir: string; identity: ReplayInitialPortfolioIdentity; startedAt: string; origin: ReplayInitialPortfolioOrigin;
}): Promise<(portfolio: VirtualPortfolio) => Promise<void>> {
  try {
    assertExperimentPathSyntax(input.storageBaseDir);
    const reservation = replayInitialPortfolioReservationSchema.parse({ schemaVersion: "replay_initial_portfolio_reservation.v1",
      identity: input.identity, startedAt: input.startedAt, origin: input.origin });
    const { identity, startedAt, origin } = reservation;
    const storageBaseDir = resolve(input.storageBaseDir);
    if (createReplayResearchHash(maskObject(identity)) !== createReplayResearchHash(identity)) throw Error("redacted identity");
    await ensureExperimentDirectory(storageBaseDir);
    // Inputs may already exist; any prior output (including an alias or partial file) rejects admission.
    await assertOutputsAbsent(storageBaseDir, [...replayOutputs, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE]);
    await writeExclusiveExperimentFile(join(storageBaseDir, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE), JSON.stringify(reservation) + "\n");
    // The exclusive reservation serializes cooperating child writers. Recheck before initializing outputs.
    await assertOutputsAbsent(storageBaseDir, replayOutputs);
    // Callers may have recursively created the hierarchy before reservation; publish every ancestor entry.
    await syncDirectoryChain(storageBaseDir);
    let invoked = false;
    return async portfolio => {
      if (invoked) throw Error("initial portfolio observation already attempted");
      invoked = true;
      try {
        const record = replayInitialPortfolioObservationSchema.parse({
          schemaVersion: "replay_initial_portfolio_observation.v1", mode: "paper_only", phase: "runner_initial_state",
          identity, startedAt, reservationHash: createReplayResearchHash(reservation),
          initialPortfolio: observeReplayInitialPortfolio(portfolio, origin),
          admission: "unavailable", source: "unavailable", configuration: "unavailable", runtime: "unavailable",
          dependencies: "unavailable", result: "unavailable", completeInput: false, comparability: "unavailable"
        });
        await writeExclusiveExperimentFile(join(storageBaseDir, REPLAY_INITIAL_PORTFOLIO_FILE), JSON.stringify(record) + "\n");
        await syncDirectory(storageBaseDir);
      } catch (error) {
        if (error instanceof ReplayInitialPortfolioDurabilityError) throw error;
        throw Error("initial portfolio observation storage failed");
      }
    };
  } catch (error) {
    if (error instanceof ReplayInitialPortfolioDurabilityError) throw error;
    throw Error("initial portfolio observation reservation failed");
  }
}
async function assertOutputsAbsent(directory: string, names: readonly string[]): Promise<void> {
  for (const name of names) {
    try { await lstat(join(directory, name)); throw Error("replay output exists"); }
    catch (error) { if (!hasFsCode(error, "ENOENT")) throw error; }
  }
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  } catch { throw new ReplayInitialPortfolioDurabilityError(); }
}

async function syncDirectoryChain(path: string): Promise<void> {
  for (let current = path; ; current = dirname(current)) {
    await syncDirectory(current);
    if (dirname(current) === current) return;
  }
}
