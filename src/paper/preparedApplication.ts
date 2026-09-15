import { preparePaperApplication as prepareV1, verifyPreparedPaperApplication as verifyV1,
  type PreparedPaperApplicationInput, type PreparedPaperApplication } from "./executionModels/v1/paper/preparedApplication.js";
export type { PreparedPaperApplicationInput, PreparedPaperApplication } from "./executionModels/v1/paper/preparedApplication.js";
export { hashPreparedApplicationPayload } from "./executionModels/v1/paper/preparedApplication.js";

/** New applications explicitly select v1. A future writer must add a new model without changing v1. */
export function preparePaperApplication(input: PreparedPaperApplicationInput): PreparedPaperApplication {
  return prepareV1(input);
}

/** Dispatch BEFORE replay; historical records never depend on the evolving current engine. */
export function verifyPreparedPaperApplication(value: unknown): PreparedPaperApplication {
  if (value === null || typeof value !== "object" || !("executionModelVersion" in value)) {
    throw new Error("prepared paper application execution model is required");
  }
  switch (value.executionModelVersion) {
    case "paper_order_engine.v1": return verifyV1(value);
    default: throw new Error("prepared paper application execution model is unsupported");
  }
}
