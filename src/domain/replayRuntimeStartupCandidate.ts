import { types } from "node:util";

const values = Object.freeze({
  schemaVersion: ["replay_runtime_startup_candidate.v1"],
  platform: ["aix", "android", "darwin", "freebsd", "linux", "openbsd", "sunos", "win32", "unknown"],
  architecture: ["arm", "arm64", "ia32", "loong64", "mips", "mipsel", "ppc64", "riscv64", "s390", "s390x", "x64", "unknown"],
  mode: ["paper_only", "live", "unknown"],
  provider: ["mock", "deterministic_fixture", "external", "unknown"],
  bootstrap: ["before_application_load", "application_loaded", "unknown"],
  preloads: ["absent", "present", "unknown"],
  moduleLoader: ["builtin_local_esm_cjs_json", "custom_or_external", "unknown"],
  moduleCache: ["owned_empty", "preexisting", "unknown"],
  compileCache: ["disabled", "enabled", "unknown"],
  startupSnapshot: ["absent", "present", "unknown"],
  inspector: ["disabled", "enabled", "unknown"],
  startupConfig: ["absent", "present", "unknown"],
  runtimeSettings: ["declared_baseline", "unsupported", "unknown"],
  nativeAssets: ["absent", "present", "unknown"],
  filesystem: ["local_regular_files", "unsupported", "unknown"],
  generatedCode: ["absent", "present", "unknown"]
} as const);

type EnumField = keyof typeof values;
type Descriptor = { readonly [K in EnumField]: (typeof values)[K][number] } & { readonly nodeVersion: string };
const fields = Object.freeze(["nodeVersion", ...Object.keys(values)] as const);
const nodeVersionPattern = /^v(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})(?![\s\S])/;

export type ReplayRuntimeStartupCandidateReason =
  | "invalid_descriptor"
  | "unsupported_runtime_profile"
  | "unsupported_execution_profile"
  | "application_not_unloaded"
  | "unsupported_startup_profile"
  | "unsupported_loading_profile"
  | "unsupported_filesystem_profile";

interface UnverifiedResult {
  readonly schemaVersion: "replay_runtime_startup_candidate_result.v1";
  readonly evidence: "unverified_descriptor";
  readonly runtime: "unavailable";
  readonly dependencies: "unavailable";
  readonly result: "unavailable";
  readonly comparability: "unavailable";
  readonly completeRuntime: false;
  readonly completeConfiguration: false;
  readonly completeInput: false;
}

export type ReplayRuntimeStartupCandidateResult = UnverifiedResult & (
  | { readonly status: "candidate"; readonly profile: "linux_x64_node24_19_paper_fixture.v1" }
  | { readonly status: "unavailable"; readonly reason: ReplayRuntimeStartupCandidateReason }
);

/** Pure eligibility of caller-supplied data. Never a startup observation, permission, or runtime receipt. */
export function evaluateReplayRuntimeStartupCandidate(value: unknown): ReplayRuntimeStartupCandidateResult {
  const descriptor = inspectDescriptor(value);
  if (!descriptor) return unavailable("invalid_descriptor");
  if (descriptor.nodeVersion !== "v24.19.0" || descriptor.platform !== "linux" || descriptor.architecture !== "x64") {
    return unavailable("unsupported_runtime_profile");
  }
  if (descriptor.mode !== "paper_only" || !["mock", "deterministic_fixture"].includes(descriptor.provider)) {
    return unavailable("unsupported_execution_profile");
  }
  if (descriptor.bootstrap !== "before_application_load") return unavailable("application_not_unloaded");
  if (descriptor.preloads !== "absent" || descriptor.compileCache !== "disabled" || descriptor.startupSnapshot !== "absent" ||
    descriptor.inspector !== "disabled" || descriptor.startupConfig !== "absent" || descriptor.runtimeSettings !== "declared_baseline") {
    return unavailable("unsupported_startup_profile");
  }
  if (descriptor.moduleLoader !== "builtin_local_esm_cjs_json" || descriptor.moduleCache !== "owned_empty" ||
    descriptor.nativeAssets !== "absent" || descriptor.generatedCode !== "absent") {
    return unavailable("unsupported_loading_profile");
  }
  if (descriptor.filesystem !== "local_regular_files") return unavailable("unsupported_filesystem_profile");
  return fixedResult({ status: "candidate", profile: "linux_x64_node24_19_paper_fixture.v1" });
}

function inspectDescriptor(value: unknown): Descriptor | undefined {
  try {
    if (unsafeJsonPrototypes() || value === null || typeof value !== "object" || types.isProxy(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== fields.length || keys.some(key => typeof key !== "string" || !fields.includes(key))) return undefined;
    const detached: Record<string, string> = Object.create(null);
    for (const key of fields) {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property?.enumerable || !Object.hasOwn(property, "value") || typeof property.value !== "string") return undefined;
      const scalar: string = property.value;
      if (key === "nodeVersion") {
        if (scalar.length > 12 || !nodeVersionPattern.test(scalar)) return undefined;
      } else if (!(values[key as EnumField] as readonly string[]).includes(scalar)) return undefined;
      detached[key] = scalar;
    }
    return detached as Descriptor;
  } catch {
    // No input, path, key, exception, or coercion is copied to the fixed result.
    return undefined;
  }
}

function unsafeJsonPrototypes(): boolean {
  if (Object.getPrototypeOf(Array.prototype) !== Object.prototype || Object.getPrototypeOf(Object.prototype) !== null) return true;
  return executableToJSON(Object.getOwnPropertyDescriptor(Object.prototype, "toJSON")) ||
    executableToJSON(Object.getOwnPropertyDescriptor(Array.prototype, "toJSON"));
}

function executableToJSON(descriptor: PropertyDescriptor | undefined): boolean {
  return descriptor !== undefined && (!Object.hasOwn(descriptor, "value") || typeof descriptor.value === "function");
}

function unavailable(reason: ReplayRuntimeStartupCandidateReason): ReplayRuntimeStartupCandidateResult {
  return fixedResult({ status: "unavailable", reason });
}

function fixedResult(
  status: { status: "candidate"; profile: "linux_x64_node24_19_paper_fixture.v1" } |
    { status: "unavailable"; reason: ReplayRuntimeStartupCandidateReason }
): ReplayRuntimeStartupCandidateResult {
  // A null prototype also prevents inherited serialization hooks on the returned object.
  return Object.freeze(Object.assign(Object.create(null), {
    schemaVersion: "replay_runtime_startup_candidate_result.v1", evidence: "unverified_descriptor",
    runtime: "unavailable", dependencies: "unavailable", result: "unavailable", comparability: "unavailable",
    completeRuntime: false, completeConfiguration: false, completeInput: false
  }, status)) as ReplayRuntimeStartupCandidateResult;
}
