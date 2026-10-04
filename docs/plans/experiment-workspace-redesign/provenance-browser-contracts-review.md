# Provenance UI review follow-up

This local follow-up starts from the combined UI tree `4597da5eb483a2013a0b8410b12555231c7c1091`, which includes API `1b095817`. Remote UI `e6188ec` remains frozen for independent review. It does not change the API or PR803 metadata.

The UI adapter rejects fractional, negative and unsafe `maxNewPositionsPerDay`, binds configuration/window observations to `run_metadata`, and permits research observations only from `research_manifest` or `run_metadata`. Recorded fields cannot also carry an unavailable reason; unavailable fields cannot carry a recorded source/verification. Field family, overall state and unavailable reason must match the API projection. Tests include both reported malformed cases and valid zero, safe integer and embedded/external research controls.

## What the navigation test protects

Comparison renders a server document with exact-ID GETs; it has no client polling lifecycle that applies late comparison responses. Its browser test protects the latest chosen document URL, pair, statuses and provenance panels after an older server read completes or is canceled. Existing keyboard/form/history tests cover actual UI selection. The response-gate test isolates this document/server-read boundary and does not claim to test the detail snapshot component's stale-response disposal.

The old test launched two overlapping `page.goto(..., waitUntil=load)` calls and counted requests by ID alone. A pending goto promise did not establish either document commit or a pending backend response. The original tablet interrupted-navigation failure and desktop visibility/clock failure logs remain preserved in the diagnostic handoff; neither is equated with PR802's original create202 navigation stall.

The replacement first prepares a complete comparison document, then arms one exact generation/endpoint/child-ID gate. It awaits the old document's `commit`, independently checks the actual `/batch/replay/runs` request is started, open and pending, and completes the second document navigation to `commit`. Only then does it release the older response, observe finish/cancellation, and assert the new exact pair, status and URL. No outstanding goto is caught or ignored. The provenance suite gates both runs and provenance endpoints separately and checks the new panels' exact IDs and stored values against distinct older hash/cash values.

An expired/closed old read before overlap fails the precondition. The existing 2-second application deadline, test timeout and retry=0 stay unchanged; fixture elapsed age is checked before overlap/release. There is no 600ms sleep, forced timeout, blanket goto catch, automatic retry, or assertion relaxation. Fixture controls are synthetic, in-memory, runner-header guarded and isolated on loopback. Per-generation gate-state attachments provide pending/release/finish/cancel evidence.

## Visibility and virtual time

The old hidden-document test dispatched visibility events and fast-forwarded virtual time without observing hydration's timer/listener installation. The follow-up observes the existing five-second browser timer and visibility listener, asserts the displayed child is running, then checks hidden clears the timer and visible reinstalls it before advancing time. It retains GET=1, hidden GET=0 and departure cleanup assertions and attaches the observed event/timer order. It adds no product readiness hook, delay or timeout increase. The original failing run did not capture timer readiness, so its cause remains unconfirmed; passing this guarded test is evidence for the explicit precondition, not a retrospective diagnosis.

Independent review and exact follow-up validation remain separate from API PR806's security/Linux gate. The upstream PR802 hold remains.

An additional keyboard probe preserved the unchanged `<details open>` assertion and recorded a failing Enter on BODY with no summary focusin; a passing control delivered keydown/keyup to SUMMARY and opened DETAILS. The keyboard test now requires a visible, focused summary and sends Enter to that locator. This strengthens the action precondition without changing the product or the open assertion. The original failed run and probe traces remain preserved; the reason the earlier focus call did not establish focus is not inferred.
