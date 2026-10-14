# C2-C4: one child compiler build observation

This test-only slice starts from main `efcdfb8a009543e978a4ff1f91323b50006f7411`
(tree `55a863d143ec03f68ae5f59cacc8fbfecab1ab57`). It joins actual pinned compiler supply,
the returned compiler exports object, a fixed three-file Program and two in-memory emitted files
inside one owned child. The parent collects one terminal report. It does not join reports from
C2-C2/C2-C3 or equate matching labels/hashes with process/session identity.

## Trust and fixed inputs

Node v24.19.0 Linux x64 and the standalone builtin-only bootstrap are trusted test roots.
TypeScript 5.9.3's compiler A is 9,112,572 bytes, SHA256
`3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675`.
Compiler B appends the fixed `__c2c3Marker = 202` suffix (9,112,608 bytes).
The owned fixture copies the artifact, compiled bootstrap and `entry.ts/value.ts/lib.d.ts` exclusively.
Stable reads reject links, inode replacement, overflow and malformed UTF-8; original repository files
are never changed. Only captured single-link fixture inodes can be overwritten for ABA cases.

The loaded exports object supplies createSourceFile/createProgram/getPreEmitDiagnostics/getOriginalNode
and Program.emit. The host consumes only captured texts, retains SourceFile identity, and accepts only
the fixed `./value.js` resolution and two outputs. Every emitted source must point back to the supplied
SourceFile with unchanged text. Options use `/c2c2`, ES2022 ESM, Classic resolution, strict/noLib,
types=[], noEmitOnError, LF and no incremental/declaration/source-map output, preserving the C2-C2
options digest. Exact golden output texts are independent fixtures. Emitted JavaScript is never executed.
Default CompilerHost and ts.sys are not input fallbacks.

## Cases

| Case | Supplied compiler | Consumed source/output | Terminal |
| --- | --- | --- | --- |
| baseline | A | A | observed |
| compiler_snapshot_aba | captured A during disk A-B-A | A | observed |
| compiler_reread_aba | B read during disk A-B-A | A | counterexample |
| input_snapshot_aba | A | captured A during disk A-B-A | observed |
| input_reread_aba | A | B read during disk A-B-A | counterexample |
| both_snapshot_aba | captured A | captured A | observed |
| both_reread_aba | B | B | counterexample |

These cover A/A, B/A, A/B and B/B values, not every possible interleaving. Identical emitted output
does not certify compiler bytes. `callback_cap`, `read_cap`, `resolution_cap` reach exact bounds.
The fixed negative map in `runtimeCompilerBuildProtocolTestFixtures.ts` is exhaustive for this slice:
cache/pin/load failures; unlisted import/read; diagnostic; stale/extra/duplicate/missing output;
source object/text/count mismatch; option/compiler/cache object faults; byte/count overflows; and
independent restoration failure. Observer faults are test injection, not claims about native compiler behavior.

## Frozen protocol and limits

Before the producer was written, independent design review froze `compiler_build_experiment.v1`,
its finite cases/reasons, canonical key order and exact maximum fixture. Review found a secondary
restoration failure could be hidden by the first diagnostic. The revised rejected union records both
restoration states independently; the follow-up design review found no remaining P1/P2 findings.

Common ordered fields are schemaVersion, caseId, runtime, dependencies, result, comparability,
completeRuntime, completeConfiguration, completeInput. The four categories always equal `unavailable`;
the three complete flags always equal false.

Observed/counterexample fields, in order: status, evidence (`fixed_compiler_build_observation`),
compilerVersion (5.9.3), artifactBytes, capturedArtifact, suppliedArtifact, restoredArtifact,
compilerLoadCount (1), builtinLoads (`crypto,fs,os,path,perf_hooks` in this order), cacheSameObject (true),
compilerObjectSame (true), observedMarker (0/202), callbackCount (12 or cap-case 32), inputFileCount (3),
outputFileCount (2), capturedInput, consumedInput, restoredInput, emittedOutput, optionsDigest,
sourceFileObjectsSame (true), diskBeforeAfterMatch (true). Per-case literals and digest relationships
are exact, not arbitrary numbers or strings. The parser reserializes the expected finite object and
requires byte equality, including one LF. Unknown/missing/reordered/duplicate keys and promotions fail.

Rejected fields after common: status=rejected, evidence=unavailable, finite reason,
artifactRestoration and inputRestoration, each `not_changed|confirmed|unconfirmed`.
The first reason is latched. Both restorations are independently attempted. Any unconfirmed restoration
returns parent `RESTORE_UNCONFIRMED`, preserves that rejected report and root, requests no removal,
and blocks all subsequent allocations in the same harness. Transport failures have no trusted report.
Unconfirmed termination or cleanup likewise retains ownership state and halts subsequent children.

| Bound | Value |
| --- | ---: |
| Compiler artifact / bootstrap | 10 MiB / 64 KiB |
| Input count / bytes each / total | 3 / 16,384 / 49,152 |
| Output count / bytes each / total | 2 / 16,384 / 32,768 |
| Source callbacks / resolution requests / loader callbacks | 16 / 8 / 32 |
| stdout / stderr | 2,048 / 4,096 bytes |
| Execution / TERM / KILL / cleanup observation | 10 / 1 / 1 / 1 seconds |
| Maximum schema-valid report including LF | 1,376 bytes |
| Maximum rejected report including LF | 416 bytes |

Positive lengths in case order above are 1357,1370,1376,1367,1371,1366,1372; cap cases are
1361,1357,1363. Rejection bounds enumerate every finite case/reason/restoration combination.
Callback12 is a frozen test expectation which must be measured in the actual Program path;
the C2-C3 observation is not itself validation. No cap, assertion, timeout or skip is loosened to pass.
Raw source, output, paths, environment, argv, diagnostics, arbitrary IDs or private hashes never enter wire reports.

## Remaining obligations

This is neither runtime admission nor a durable receipt. Compiler initialization's general filesystem,
environment, native/builtin implementation, Node memory image, full project build, package/dependency
closure, emitted code execution, full configuration/input and C2-D IPC/admission remain unproved.
Existing A/B/C1, C2 experiments, production HTTP/runner/provider/receipt, package/lock/runner configuration
are untouched. runtime/dependencies/result/comparability remain unavailable and all completeness flags false.
Validation and preserved failures are recorded in [the validation record](child-runtime-compiler-build-validation.md).
