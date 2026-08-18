import {
  officialBrokerObservedCalendarEvidenceV2Schema,
  verifyOfficialBrokerObservedCalendarEvidenceV2,
  type OfficialBrokerObservedCalendarEvidenceV2
} from "./officialBrokerObservedCalendarEvidenceV2.js";
import {
  buildOfficialBrokerObservedCalendarCoverageProbeReport,
  parseOfficialBrokerObservedCalendarCoverageProbePlan,
  type OfficialBrokerObservedCalendarCoverageProbeReport
} from "./officialBrokerObservedCalendarCoverageProbe.js";
import {
  buildOfficialBrokerObservedCalendarReplayInput,
  type OfficialBrokerObservedCalendarReplayInput
} from "./officialBrokerObservedCalendarReplayAdapter.js";

declare const ephemeralObservationBrand: unique symbol;
declare const ephemeralConsumerBrand: unique symbol;

export interface OfficialBrokerObservedCalendarEphemeralObservation {
  readonly [ephemeralObservationBrand]: true;
  toJSON(): never;
}

export interface OfficialBrokerObservedCalendarEphemeralConsumer {
  readonly [ephemeralConsumerBrand]: true;
  toJSON(): never;
}

export interface CreateOfficialBrokerObservedCalendarEphemeralObservationInput {
  evidence: unknown;
  rawResponseBytes: Uint8Array;
}

export interface ConsumeOfficialBrokerObservedCalendarEphemeralObservationOptions {
  asOf: string;
  consumer: OfficialBrokerObservedCalendarEphemeralConsumer;
}

export interface CreateOfficialBrokerObservedCalendarReplayInputEphemeralConsumerOptions {
  use: (input: OfficialBrokerObservedCalendarReplayInput) => void;
}

export interface CreateOfficialBrokerObservedCalendarCoverageReportEphemeralConsumerOptions {
  plan: unknown;
  use: (report: OfficialBrokerObservedCalendarCoverageProbeReport) => void;
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

interface ConsumerState {
  execute: (observations: VerifiedObservation[], asOf: string) => void;
}

const observationStates = new WeakMap<object, ObservationState>();
const consumerStates = new WeakMap<object, ConsumerState>();

export function createOfficialBrokerObservedCalendarEphemeralObservation(
  input: CreateOfficialBrokerObservedCalendarEphemeralObservationInput
): OfficialBrokerObservedCalendarEphemeralObservation {
  assertTransferredRawResponseBytes(input.rawResponseBytes);
  const ownedRawResponseBytes = Uint8Array.from(input.rawResponseBytes);

  try {
    const parsedEvidence =
      officialBrokerObservedCalendarEvidenceV2Schema.parse(input.evidence);
    const evidence = verifyOfficialBrokerObservedCalendarEvidenceV2(
      parsedEvidence,
      {
        asOf: parsedEvidence.source.retrievedAt,
        rawResponseBytes: ownedRawResponseBytes
      }
    );
    const observation = createOpaqueObject(() => {
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
    ownedRawResponseBytes.fill(0);
    throw error;
  } finally {
    input.rawResponseBytes.fill(0);
  }
}

export function createOfficialBrokerObservedCalendarReplayInputEphemeralConsumer(
  options: CreateOfficialBrokerObservedCalendarReplayInputEphemeralConsumerOptions
): OfficialBrokerObservedCalendarEphemeralConsumer {
  assertUseCallback(options.use);
  const use = options.use;
  return createConsumerCapability((observations, asOf) => {
    if (observations.length !== 1) {
      throw new Error(
        "official broker calendar replay input consumer requires exactly one observation"
      );
    }
    const observation = observations[0]!;
    const replayInput = buildOfficialBrokerObservedCalendarReplayInput({
      evidence: observation.evidence,
      asOf,
      rawResponseBytes: observation.rawResponseBytes
    });
    useRevocableDerivedOutput(replayInput, use, "replay input");
  });
}

export function createOfficialBrokerObservedCalendarCoverageReportEphemeralConsumer(
  options: CreateOfficialBrokerObservedCalendarCoverageReportEphemeralConsumerOptions
): OfficialBrokerObservedCalendarEphemeralConsumer {
  assertUseCallback(options.use);
  const use = options.use;
  const plan = deepFreeze(
    parseOfficialBrokerObservedCalendarCoverageProbePlan(options.plan)
  );
  return createConsumerCapability((observations, asOf) => {
    const report = buildOfficialBrokerObservedCalendarCoverageProbeReport({
      plan,
      evaluatedAt: asOf,
      observations: observations.map(({ evidence, rawResponseBytes }) => ({
        status: "verified" as const,
        requestedDate: evidence.requestedDate,
        evidence,
        rawResponseBytes
      }))
    });
    useRevocableDerivedOutput(report, use, "coverage report");
  });
}

export function consumeOfficialBrokerObservedCalendarEphemeralObservation(
  observation: OfficialBrokerObservedCalendarEphemeralObservation,
  options: ConsumeOfficialBrokerObservedCalendarEphemeralObservationOptions
): void {
  consumeOfficialBrokerObservedCalendarEphemeralObservations(
    [observation],
    options
  );
}

export function consumeOfficialBrokerObservedCalendarEphemeralObservations(
  observations: readonly OfficialBrokerObservedCalendarEphemeralObservation[],
  options: ConsumeOfficialBrokerObservedCalendarEphemeralObservationOptions
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
      const observationObject = assertOpaqueObject(observation, "observation");
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

    const consumerObject = assertOpaqueObject(options.consumer, "consumer");
    const consumerState = consumerStates.get(consumerObject);
    if (consumerState === undefined) {
      throw new Error(
        "official broker calendar ephemeral consumer must come from a trusted process-local factory"
      );
    }

    for (let index = 0; index < observationObjects.length; index += 1) {
      const state = ownedStates[index]!;
      observationStates.set(observationObjects[index]!, {
        status: "consuming",
        evidence: state.evidence,
        rawResponseBytes: state.rawResponseBytes
      });
    }
    const verifiedObservations = ownedStates.map((state) => ({
      evidence: verifyOfficialBrokerObservedCalendarEvidenceV2(
        state.evidence,
        {
          asOf: options.asOf,
          rawResponseBytes: state.rawResponseBytes
        }
      ),
      rawResponseBytes: state.rawResponseBytes
    }));
    consumerState.execute(verifiedObservations, options.asOf);
  } finally {
    for (const observationObject of observationObjects) {
      disposeObservationObject(observationObject);
    }
  }
}

export function disposeOfficialBrokerObservedCalendarEphemeralObservation(
  observation: OfficialBrokerObservedCalendarEphemeralObservation
): void {
  const observationObject = assertOpaqueObject(observation, "observation");
  if (!observationStates.has(observationObject)) {
    throw new Error(
      "official broker calendar ephemeral observation must come from the process-local factory"
    );
  }
  disposeObservationObject(observationObject);
}

function createConsumerCapability(
  execute: ConsumerState["execute"]
): OfficialBrokerObservedCalendarEphemeralConsumer {
  const consumer = createOpaqueObject(() => {
    throw new Error(
      "official broker calendar ephemeral consumer cannot be serialized or exported"
    );
  });
  consumerStates.set(consumer, { execute });
  return consumer as OfficialBrokerObservedCalendarEphemeralConsumer;
}

function useRevocableDerivedOutput<T extends object>(
  output: T,
  use: (value: T) => void,
  label: string
): void {
  const capability = createRevocableReadonlyMembrane(output, label);
  try {
    const detachedOutput: unknown = use(capability.proxy);
    if (detachedOutput !== undefined) {
      suppressRejectedThenable(detachedOutput);
      throw new Error(
        `official broker calendar ephemeral ${label} consumer must not return detached output`
      );
    }
  } finally {
    capability.revoke();
  }
}

function disposeObservationObject(observation: object): void {
  const state = observationStates.get(observation);
  if (state === undefined || state.status === "disposed") {
    return;
  }
  try {
    state.rawResponseBytes.fill(0);
  } finally {
    observationStates.set(observation, { status: "disposed" });
  }
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

function assertOpaqueObject(value: unknown, label: string): object {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    throw new Error(
      `official broker calendar ephemeral ${label} handle is invalid`
    );
  }
  return value;
}

function assertTransferredRawResponseBytes(
  value: unknown
): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new Error(
      "official broker calendar ephemeral raw response bytes must be a non-empty Uint8Array"
    );
  }
}

function assertUseCallback(value: unknown): void {
  if (typeof value !== "function") {
    throw new Error(
      "official broker calendar ephemeral consumer requires a use callback"
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

function createRevocableReadonlyMembrane<T extends object>(
  value: T,
  label: string
): {
  proxy: T;
  revoke: () => void;
} {
  const proxies = new WeakMap<object, object>();
  const revokers: Array<() => void> = [];

  const wrap = (candidate: unknown): unknown => {
    if (candidate === null || typeof candidate !== "object") {
      return candidate;
    }
    const existing = proxies.get(candidate);
    if (existing !== undefined) {
      return existing;
    }
    const { proxy, revoke } = Proxy.revocable(candidate, {
      get: (target, key, receiver) => {
        if (key === "toJSON") {
          return () => {
            throw new Error(
              `official broker calendar ephemeral ${label} cannot be serialized or exported`
            );
          };
        }
        return wrap(Reflect.get(target, key, receiver));
      },
      getOwnPropertyDescriptor: (target, key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (descriptor === undefined || !("value" in descriptor)) {
          return descriptor;
        }
        return { ...descriptor, value: wrap(descriptor.value) };
      },
      set: () => {
        throw new Error(
          `official broker calendar ephemeral ${label} is read-only`
        );
      },
      defineProperty: () => {
        throw new Error(
          `official broker calendar ephemeral ${label} is read-only`
        );
      },
      deleteProperty: () => {
        throw new Error(
          `official broker calendar ephemeral ${label} is read-only`
        );
      },
      setPrototypeOf: () => {
        throw new Error(
          `official broker calendar ephemeral ${label} is read-only`
        );
      },
      preventExtensions: () => {
        throw new Error(
          `official broker calendar ephemeral ${label} is read-only`
        );
      }
    });
    proxies.set(candidate, proxy);
    revokers.push(revoke);
    return proxy;
  };

  const proxy = wrap(value) as T;
  return {
    proxy,
    revoke: () => {
      for (let index = revokers.length - 1; index >= 0; index -= 1) {
        revokers[index]!();
      }
      revokers.length = 0;
    }
  };
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
