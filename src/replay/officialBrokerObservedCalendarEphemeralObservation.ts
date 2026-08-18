import {
  officialBrokerObservedCalendarEvidenceV2Schema,
  verifyOfficialBrokerObservedCalendarEvidenceV2,
  type OfficialBrokerObservedCalendarEvidenceV2
} from "./officialBrokerObservedCalendarEvidenceV2.js";
import {
  buildOfficialBrokerObservedCalendarCoverageProbeReport,
  parseOfficialBrokerObservedCalendarCoverageProbePlan
} from "./officialBrokerObservedCalendarCoverageProbe.js";
import { buildOfficialBrokerObservedCalendarReplayInput } from "./officialBrokerObservedCalendarReplayAdapter.js";

declare const ephemeralObservationBrand: unique symbol;

export interface OfficialBrokerObservedCalendarEphemeralObservation {
  readonly [ephemeralObservationBrand]: true;
  toJSON(): never;
}

export interface CreateOfficialBrokerObservedCalendarEphemeralObservationInput {
  evidence: unknown;
  rawResponseBytes: Uint8Array;
}

export interface ConsumeOfficialBrokerObservedCalendarEphemeralReplayInputOptions {
  asOf: string;
}

export interface ConsumeOfficialBrokerObservedCalendarEphemeralCoverageReportOptions {
  asOf: string;
  plan: unknown;
}

interface OwnedObservationState {
  status: "ready" | "consuming";
  evidence: OfficialBrokerObservedCalendarEvidenceV2;
  rawResponseBytes: Uint8Array;
}

interface DisposedObservationState {
  status: "disposed";
}

type ObservationState = OwnedObservationState | DisposedObservationState;

interface VerifiedObservation {
  evidence: OfficialBrokerObservedCalendarEvidenceV2;
  rawResponseBytes: Uint8Array;
}

const observationStates = new WeakMap<object, ObservationState>();
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength"
)?.get;

export function createOfficialBrokerObservedCalendarEphemeralObservation(
  input: CreateOfficialBrokerObservedCalendarEphemeralObservationInput
): OfficialBrokerObservedCalendarEphemeralObservation {
  const transferredRawResponseBytes = input.rawResponseBytes;
  assertTransferredRawResponseBytes(transferredRawResponseBytes);
  let ownedRawResponseBytes: Uint8Array | undefined;
  let transferredRawResponseBytesZeroized = false;

  try {
    ownedRawResponseBytes = new Uint8Array(transferredRawResponseBytes);
    zeroizeBytes(transferredRawResponseBytes);
    transferredRawResponseBytesZeroized = true;
    const parsedEvidence =
      officialBrokerObservedCalendarEvidenceV2Schema.parse(input.evidence);
    const evidence = verifyOfficialBrokerObservedCalendarEvidenceV2(
      parsedEvidence,
      {
        asOf: parsedEvidence.source.retrievedAt,
        rawResponseBytes: ownedRawResponseBytes
      }
    );
    const observation = createOpaqueObservation(() => {
      disposeObservationObject(observation);
      throw new Error(
        "official broker calendar ephemeral observation cannot be serialized or exported"
      );
    });
    observationStates.set(observation, {
      status: "ready",
      evidence: deepFreeze(evidence),
      rawResponseBytes: ownedRawResponseBytes
    });
    return observation as OfficialBrokerObservedCalendarEphemeralObservation;
  } catch (error) {
    if (ownedRawResponseBytes !== undefined) {
      zeroizeBytes(ownedRawResponseBytes);
    }
    throw error;
  } finally {
    if (!transferredRawResponseBytesZeroized) {
      zeroizeBytes(transferredRawResponseBytes);
    }
  }
}

export function consumeOfficialBrokerObservedCalendarEphemeralReplayInput(
  observation: OfficialBrokerObservedCalendarEphemeralObservation,
  options: ConsumeOfficialBrokerObservedCalendarEphemeralReplayInputOptions
): void {
  consumeVerifiedObservations([observation], options.asOf, (observations) => {
    if (observations.length !== 1) {
      throw new Error(
        "official broker calendar replay input operation requires exactly one observation"
      );
    }
    const verifiedObservation = observations[0]!;
    void buildOfficialBrokerObservedCalendarReplayInput({
      evidence: verifiedObservation.evidence,
      asOf: options.asOf,
      rawResponseBytes: verifiedObservation.rawResponseBytes
    });
  });
}

export function consumeOfficialBrokerObservedCalendarEphemeralCoverageReport(
  observations: readonly OfficialBrokerObservedCalendarEphemeralObservation[],
  options: ConsumeOfficialBrokerObservedCalendarEphemeralCoverageReportOptions
): void {
  consumeVerifiedObservations(observations, options.asOf, (verified) => {
    const plan = parseOfficialBrokerObservedCalendarCoverageProbePlan(
      options.plan
    );
    void buildOfficialBrokerObservedCalendarCoverageProbeReport({
      plan,
      evaluatedAt: options.asOf,
      observations: verified.map(({ evidence, rawResponseBytes }) => ({
        status: "verified" as const,
        requestedDate: evidence.requestedDate,
        evidence,
        rawResponseBytes
      }))
    });
  });
}

export function disposeOfficialBrokerObservedCalendarEphemeralObservation(
  observation: OfficialBrokerObservedCalendarEphemeralObservation
): void {
  const observationObject = assertObservationObject(observation);
  if (!observationStates.has(observationObject)) {
    throw new Error(
      "official broker calendar ephemeral observation must come from the process-local factory"
    );
  }
  disposeObservationObject(observationObject);
}

function consumeVerifiedObservations(
  observations: readonly OfficialBrokerObservedCalendarEphemeralObservation[],
  asOf: string,
  operation: (observations: VerifiedObservation[]) => void
): void {
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new Error(
      "official broker calendar ephemeral consumption requires observations"
    );
  }

  const observationObjects: object[] = [];
  const ownedStates: OwnedObservationState[] = [];
  try {
    const seen = new Set<object>();
    for (const observation of observations) {
      const observationObject = assertObservationObject(observation);
      observationObjects.push(observationObject);
      if (seen.has(observationObject)) {
        throw new Error(
          "official broker calendar ephemeral observation cannot be consumed twice in one chain"
        );
      }
      seen.add(observationObject);
      const state = observationStates.get(observationObject);
      if (state === undefined) {
        throw new Error(
          "official broker calendar ephemeral observation must come from the process-local factory"
        );
      }
      if (state.status !== "ready") {
        throw new Error(
          `official broker calendar ephemeral observation is ${state.status}`
        );
      }
      ownedStates.push(state);
    }

    for (let index = 0; index < observationObjects.length; index += 1) {
      const state = ownedStates[index]!;
      observationStates.set(observationObjects[index]!, {
        status: "consuming",
        evidence: state.evidence,
        rawResponseBytes: state.rawResponseBytes
      });
    }
    operation(
      ownedStates.map((state) => ({
        evidence: verifyOfficialBrokerObservedCalendarEvidenceV2(
          state.evidence,
          {
            asOf,
            rawResponseBytes: state.rawResponseBytes
          }
        ),
        rawResponseBytes: state.rawResponseBytes
      }))
    );
  } finally {
    for (const observationObject of observationObjects) {
      disposeObservationObject(observationObject);
    }
  }
}

function disposeObservationObject(observation: object): void {
  const state = observationStates.get(observation);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    zeroizeBytes(state.rawResponseBytes);
  } finally {
    observationStates.set(observation, { status: "disposed" });
  }
}

function createOpaqueObservation(toJSON: () => never): object {
  const value = Object.create(null) as object;
  Object.defineProperty(value, "toJSON", {
    enumerable: false,
    configurable: false,
    writable: false,
    value: toJSON
  });
  return Object.freeze(value);
}

function assertObservationObject(value: unknown): object {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    throw new Error(
      "official broker calendar ephemeral observation handle is invalid"
    );
  }
  return value;
}

function assertTransferredRawResponseBytes(
  value: unknown
): asserts value is Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    typedArrayByteLengthGetter === undefined ||
    typedArrayByteLengthGetter.call(value) === 0
  ) {
    throw new Error(
      "official broker calendar ephemeral raw response bytes must be a non-empty Uint8Array"
    );
  }
}

function zeroizeBytes(value: Uint8Array): void {
  Uint8Array.prototype.fill.call(value, 0);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
