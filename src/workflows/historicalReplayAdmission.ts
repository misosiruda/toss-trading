import { types } from "node:util";
import { captureReplayAdmissionActualChild, type ReplayAdmissionActualChild } from "../domain/replayAdmissionMapping.js";
import { resolvePaperSimulationAdmissionContext, type PaperSimulationAdmissionContext } from "../storage/paperSimulationObservationStore.js";

/** The optional internal handle is never read through a getter or deserialized from request data. */
export function captureReplayAdmissionContext(options: object): PaperSimulationAdmissionContext | undefined {
  try {
    if (types.isProxy(options)) throw Error();
    const descriptor = Object.getOwnPropertyDescriptor(options, "admissionContext");
    if (descriptor === undefined) {
      // Inheritance must not silently turn a supplied handle into receiptless execution.
      let prototype = Object.getPrototypeOf(options);
      for (let depth = 0; prototype !== null; depth += 1) {
        if (depth === 32 || types.isProxy(prototype) || Object.getOwnPropertyDescriptor(prototype, "admissionContext")) throw Error();
        prototype = Object.getPrototypeOf(prototype);
      }
      return undefined;
    }
    if (!Object.hasOwn(descriptor, "value")) throw Error();
    if (descriptor.value === undefined) return undefined;
    resolvePaperSimulationAdmissionContext(descriptor.value);
    return descriptor.value as PaperSimulationAdmissionContext;
  } catch { throw Error("replay admission context unavailable"); }
}

/** Authentic unavailable ownership must be handled before even constructing an identity-bearing B input. */
export function captureReplayWorkflowAdmission(options: object, context: PaperSimulationAdmissionContext | undefined):
  Readonly<ReplayAdmissionActualChild> | undefined {
  if (context === undefined || resolvePaperSimulationAdmissionContext(context).status === "unavailable") return undefined;
  try {
    if (types.isProxy(options)) throw Error();
    const own = (key: string): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(options, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) throw Error();
      return descriptor.value;
    };
    return captureReplayAdmissionActualChild({
      identity: { runId: own("runId"), batchId: own("batchId"), runIndex: own("batchRunIndex") },
      startedAt: Date.prototype.toISOString.call(own("generatedAt")),
      windowSamplingMode: own("admissionWindowSamplingMode"), windowSelection: own("windowSelection")
    });
  } catch { throw Error("replay admission mapping mismatch"); }
}
