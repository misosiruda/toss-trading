export function startupCandidateFixture(): Record<string, string> {
  return {
    schemaVersion: "replay_runtime_startup_candidate.v1",
    nodeVersion: "v24.19.0", platform: "linux", architecture: "x64", mode: "paper_only", provider: "mock",
    bootstrap: "before_application_load", preloads: "absent", moduleLoader: "builtin_local_esm_cjs_json",
    moduleCache: "owned_empty", compileCache: "disabled", startupSnapshot: "absent", inspector: "disabled",
    startupConfig: "absent", runtimeSettings: "declared_baseline", nativeAssets: "absent",
    filesystem: "local_regular_files", generatedCode: "absent"
  };
}
