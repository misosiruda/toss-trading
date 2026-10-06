import { PAPER_SIMULATION_ID_PATTERN } from "../domain/paperSimulationObservation.js";
import { readPaperSimulationRequest, unavailablePaperSimulationRequest } from "../storage/paperSimulationRequestStore.js";
export const PAPER_SIMULATION_REQUEST_ROUTE = "/paper/simulations/request";
export async function readPaperSimulationRequestQuery(url: URL, storageBaseDir: string) {
  const ids = url.searchParams.getAll("simulationRunId");
  if (ids.length !== 1 || !PAPER_SIMULATION_ID_PATTERN.test(ids[0]!) || [...url.searchParams.keys()].some(key => key !== "simulationRunId")) {
    return { statusCode: 400, payload: unavailablePaperSimulationRequest("") };
  }
  return { statusCode: 200, payload: await readPaperSimulationRequest(storageBaseDir, ids[0]!) };
}

export type { PaperSimulationRequestRead } from "../storage/paperSimulationRequestStore.js";
