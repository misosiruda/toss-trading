import { lstat, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { observeReplayInitialPortfolio, replayInitialPortfolioReservationSchema, replayInitialPortfolioObservationSchema,
  type ReplayInitialPortfolioIdentity, type ReplayInitialPortfolioOrigin } from "../domain/replayInitialPortfolioObservation.js";
import type { VirtualPortfolio } from "../domain/schemas.js";
import { maskObject } from "../security/masking.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { assertExperimentPathSyntax, ensureExperimentDirectory, hasFsCode, writeExclusiveExperimentFile } from "./paperExperimentFilesystem.js";

export const REPLAY_INITIAL_PORTFOLIO_FILE = "historical-replay-initial-portfolio.json";
export const REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE = "historical-replay-initial-portfolio.reserved.json";

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
    await writeExclusiveExperimentFile(join(storageBaseDir, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE), JSON.stringify(reservation) + "\n");
    await syncDirectory(storageBaseDir);
    await syncDirectory(dirname(storageBaseDir));
    try { await lstat(join(storageBaseDir, REPLAY_INITIAL_PORTFOLIO_FILE)); throw Error("initial observation exists"); }
    catch (error) { if (!hasFsCode(error, "ENOENT")) throw error; }
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
      } catch { throw Error("initial portfolio observation storage failed"); }
    };
  } catch { throw Error("initial portfolio observation reservation failed"); }
}
async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, "r"); } catch (error) {
    if (process.platform === "win32" && hasFsCode(error, "EPERM")) return; throw error;
  }
  try { await handle.sync(); } catch (error) {
    if (!(process.platform === "win32" && hasFsCode(error, "EPERM"))) throw error;
  } finally { await handle.close(); }
}
