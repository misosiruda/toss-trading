import { PAPER_EXECUTION_MODEL_VERSION } from "./costModel.js";
import { buildPaperFill, buildWholeSharePaperFill, type PaperFillInput } from "./executionModel.js";

export const WHOLE_SHARE_PAPER_EXECUTION_MODEL_VERSION = "execution_simulator.v5";

/** Explicit artifact model dispatch; the existing runner/cost-model default remains v4. */
export function buildVersionedPaperFill(input: PaperFillInput, modelVersion: string) {
  if (modelVersion === PAPER_EXECUTION_MODEL_VERSION) return buildPaperFill(input);
  if (modelVersion === WHOLE_SHARE_PAPER_EXECUTION_MODEL_VERSION) return buildWholeSharePaperFill(input);
  throw new Error("unsupported paper execution model version");
}
