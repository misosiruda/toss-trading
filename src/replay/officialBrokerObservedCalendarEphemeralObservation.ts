import {
  officialBrokerObservedCalendarEvidenceV2Schema,
  verifyOfficialBrokerObservedCalendarEvidenceV2,
  type OfficialBrokerObservedCalendarEvidenceV2
} from "./officialBrokerObservedCalendarEvidenceV2.js";

declare const ephemeralObservationBrand: unique symbol;
declare const ephemeralObservationScopeBrand: unique symbol;

export interface OfficialBrokerObservedCalendarEphemeralObservation {
  readonly [ephemeralObservationBrand]: true;
  toJSON(): never;
}

export interface OfficialBrokerObservedCalendarEphemeralObservationScope {
  readonly [ephemeralObservationScopeBrand]: true;
  readonly evidence: OfficialBrokerObservedCalendarEvidenceV2;
  readonly rawResponseBytes: Uint8Array;
  readonly asOf: string;
  toJSON(): never;
}

export interface CreateOfficialBrokerObservedCalendarEphemeralObservationInput {
  evidence: unknown;
  rawResponseBytes: Uint8Array;
}

export interface ConsumeOfficialBrokerObservedCalendarEphemeralObservationOptions {
  asOf: string;
  consumer: (
    scope: OfficialBrokerObservedCalendarEphemeralObservationScope
  ) => void;
}

interface ReadyObservationState {
  status: "ready";
  evidence: OfficialBrokerObservedCalendarEvidenceV2;
  rawResponseBytes: Uint8Array;
}

interface ConsumingObservationState {
  status: "consuming";
  evidence: OfficialBrokerObservedCalendarEvidenceV2;
  rawResponseBytes: Uint8Array;
}

interface DisposedObservationState {
  status: "disposed";
}

type ObservationState =
  | ReadyObservationState
  | ConsumingObservationState
  | DisposedObservationState;

interface ActiveScopeState {
  status: "active";
  evidence: OfficialBrokerObservedCalendarEvidenceV2;
  rawResponseBytes: Uint8Array;
  asOf: string;
}

interface DisposedScopeState {
  status: "disposed";
}

type ScopeState = ActiveScopeState | DisposedScopeState;

const observationStates = new WeakMap<object, ObservationState>();
const scopeStates = new WeakMap<object, ScopeState>();

export function createOfficialBrokerObservedCalendarEphemeralObservation(
  input: CreateOfficialBrokerObservedCalendarEphemeralObservationInput
): OfficialBrokerObservedCalendarEphemeralObservation {
  assertOwnedRawResponseBytes(input.rawResponseBytes);

  try {
    const parsedEvidence =
      officialBrokerObservedCalendarEvidenceV2Schema.parse(input.evidence);
    const evidence = verifyOfficialBrokerObservedCalendarEvidenceV2(
      parsedEvidence,
      {
        asOf: parsedEvidence.source.retrievedAt,
        rawResponseBytes: input.rawResponseBytes
      }
    );

    const observation = createOpaqueObject(() => {
      disposeOfficialBrokerObservedCalendarEphemeralObservation(
        observation as OfficialBrokerObservedCalendarEphemeralObservation
      );
      throw new Error(
        "official broker calendar ephemeral observation cannot be serialized or exported"
      );
    });
    observationStates.set(observation, {
      status: "ready",
      evidence: deepFreeze(evidence),
      rawResponseBytes: input.rawResponseBytes
    });
    return observation as OfficialBrokerObservedCalendarEphemeralObservation;
  } catch (error) {
    input.rawResponseBytes.fill(0);
    throw error;
  }
}

export function consumeOfficialBrokerObservedCalendarEphemeralObservation(
  observation: OfficialBrokerObservedCalendarEphemeralObservation,
  options: ConsumeOfficialBrokerObservedCalendarEphemeralObservationOptions
): void {
  const observationObject = assertOpaqueObject(observation);
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

  observationStates.set(observationObject, {
    status: "consuming",
    evidence: state.evidence,
    rawResponseBytes: state.rawResponseBytes
  });

  let scopeObject: object | undefined;
  try {
    const evidence = deepFreeze(
      verifyOfficialBrokerObservedCalendarEvidenceV2(state.evidence, {
        asOf: options.asOf,
        rawResponseBytes: state.rawResponseBytes
      })
    );
    scopeObject = createScope(
      observation,
      evidence,
      state.rawResponseBytes,
      options.asOf
    );
    const output: unknown = options.consumer(
      scopeObject as OfficialBrokerObservedCalendarEphemeralObservationScope
    );
    if (output !== undefined) {
      suppressRejectedThenable(output);
      throw new Error(
        "official broker calendar ephemeral consumer must not return detached output"
      );
    }
  } finally {
    if (scopeObject !== undefined) {
      scopeStates.set(scopeObject, { status: "disposed" });
    }
    disposeOfficialBrokerObservedCalendarEphemeralObservation(observation);
  }
}

export function disposeOfficialBrokerObservedCalendarEphemeralObservation(
  observation: OfficialBrokerObservedCalendarEphemeralObservation
): void {
  const observationObject = assertOpaqueObject(observation);
  const state = observationStates.get(observationObject);
  if (state === undefined) {
    throw new Error(
      "official broker calendar ephemeral observation must come from the process-local factory"
    );
  }
  if (state.status === "disposed") {
    return;
  }
  try {
    state.rawResponseBytes.fill(0);
  } finally {
    observationStates.set(observationObject, { status: "disposed" });
  }
}

function createScope(
  observation: OfficialBrokerObservedCalendarEphemeralObservation,
  evidence: OfficialBrokerObservedCalendarEvidenceV2,
  rawResponseBytes: Uint8Array,
  asOf: string
): object {
  const scope = Object.create(null) as object;
  Object.defineProperties(scope, {
    evidence: {
      enumerable: false,
      configurable: false,
      get: () => getActiveScopeState(scope).evidence
    },
    rawResponseBytes: {
      enumerable: false,
      configurable: false,
      get: () => getActiveScopeState(scope).rawResponseBytes
    },
    asOf: {
      enumerable: false,
      configurable: false,
      get: () => getActiveScopeState(scope).asOf
    },
    toJSON: {
      enumerable: false,
      configurable: false,
      writable: false,
      value: () => {
        disposeOfficialBrokerObservedCalendarEphemeralObservation(observation);
        throw new Error(
          "official broker calendar ephemeral observation scope cannot be serialized or exported"
        );
      }
    }
  });
  scopeStates.set(scope, {
    status: "active",
    evidence,
    rawResponseBytes,
    asOf
  });
  return Object.freeze(scope);
}

function getActiveScopeState(scope: object): ActiveScopeState {
  const state = scopeStates.get(scope);
  if (state === undefined || state.status !== "active") {
    throw new Error(
      "official broker calendar ephemeral observation scope is disposed"
    );
  }
  return state;
}

function createOpaqueObject(toJSON: () => never): object {
  const value = Object.create(null) as object;
  Object.defineProperty(value, "toJSON", {
    enumerable: false,
    configurable: false,
    writable: false,
    value: toJSON
  });
  return Object.freeze(value);
}

function assertOpaqueObject(value: unknown): object {
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

function assertOwnedRawResponseBytes(
  value: unknown
): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new Error(
      "official broker calendar ephemeral raw response bytes must be a non-empty Uint8Array"
    );
  }
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

function suppressRejectedThenable(value: unknown): void {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  ) {
    void Promise.resolve(value).catch(() => undefined);
  }
}
