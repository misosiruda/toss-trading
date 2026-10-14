# C2-C4 validation record

Implementation checkpoint: 2026-10-14 06:31 UTC. This record freezes the reviewed source and its
pre-publication evidence. The PR's current-head verification record tracks the subsequent full gate
and GitHub review/merge outcomes; this checkpoint does not pre-claim those outcomes.
Base main: `efcdfb8a009543e978a4ff1f91323b50006f7411`, tree `55a863d143ec03f68ae5f59cacc8fbfecab1ab57`.
The allowed delta is seven new test/fixture files, scope and validation documents, and the section7
launcher-contract link. No existing experiment, package/lock or runner file is changed.

The schema and 1,376-byte LF-inclusive maximum were independently reviewed before producer implementation.
The initial P2 (first diagnostic could hide restoration failure) was corrected with independent artifact/input
restoration states and a no-cleanup, no-next-child parent outcome. Follow-up design review found no P1/P2.
The first actual Linux focused run (2026-10-14 06:25 UTC) had 81 tests, 80 passes, one failure,
zero skips/cancellations. All seven ABA observations, three cap cases, 28 ordinary negatives and the actual
restoration-failure case passed. Callback12 was measured in the actual loaded-compiler Program path.
The failure was the source import guard: CRLF in the new child source did not match the required exact
type-only import line. Source line endings were normalized to LF; the assertion was not relaxed.
Two earlier type builds failed on a missing array bracket and an optional cache entry narrowing error;
both were corrected, and subsequent builds passed. All attempts retain their exact source and logs.

Independent implementation review identified two P2 validation gaps: source object mismatch was injected
after emit rather than into emit's source association, and stale-output rejection only tested the case name.
The same fixed cases now inject a different same-name/text SourceFile into the actual writeFile callback,
and a stale item into the output sink checked by the common initial-state guard. No schema, reason,
byte cap, timeout, skip or existing experiment was changed. A further P2 identified that reread compiler B
was checked by the parent after evaluation; immutable A/B supplied bytes now pass their exact pin and byte
size before hooks/evaluation. The artifact_mismatch case exercises this common pre-evaluation guard;
intentional unlisted-module fault suffixes are appended only after the pin check.
The first review gate passed build, quality, tooling23 and affected81 with no failure/skip on its recorded
pre-pin-fix source. The pin-corrected candidate's check:review passed at 06:30:25 UTC: build, quality,
tooling23 and affected81, zero failures/skips/cancellations, source unchanged across execution.
Independent final source review found no remaining P1/P2. Reviewed child SHA256:
`6c426bee46536788ab4caf17405f26bbf68a30897437b15043ea75db5cc0c58e`.
The complete check:merge remains mandatory on the published candidate before normal merge.

Each execution preserves source-before/source-after manifests, source archive, command, safe environment,
Node/lock hashes, timestamps, stdout/stderr and exit code under the isolated C2-C4 evidence root.
Failures and uncertain roots are retained. Earlier C2-C3 test results are historical, not C2-C4 passes.

The dedicated existing Ubuntu24.04 WSL environment runs official Node v24.19.0 Linux x64.
No virtualization/security setting, shared WSL lifecycle, CMS distribution or production process is changed.
Windows or unsupported-runtime skips do not count as Linux validation.

Library upload/readback and a fresh consumer checkout are separate preservation obligations.
The prior official Library flow was unavailable; prior backups, refs and checkouts remain preserved.
No storage URL inference or alternative download/upload API is allowed.
