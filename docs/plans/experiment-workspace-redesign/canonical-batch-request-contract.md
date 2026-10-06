# Canonical whole-batch 요청 저장과 exact ID 읽기

기준: main `3fcb0926` 이후 승인된 4단계. 다음 5단계 clone UI는 이 PR에 포함하지 않는다.

## 저장 계약

`POST /paper/simulations`는 기존 파싱·현재 validation·mutation guard를 유지한다. exclusive batch 디렉터리를 예약한 후 원래 whole-batch 요청을 `paper-simulation-request.json`에 저장하고 file fsync와 디렉터리 sync를 완료한다. 그 기록의 canonical SHA256을 v1 accepted 이벤트의 optional `canonicalRequestHash`에 연결해 durable append한 뒤에만 기존 202와 runner dispatch가 가능하다. Windows의 기존 directory sync EPERM 예외만 유지한다.

기록 버전은 `paper_simulation_canonical_request.v1`이며 원래 simulationRunId/batchId/acceptedAt, sourceRuntime, requestedConfig, redacted를 포함한다. runCount 및 executionCosts의 원래 생략 여부, random seed·추출 기간·빈도·자본·위험·청산·명시 비용을 보존한다. effectiveConfig나 child의 추출 window에서 역산하지 않는다. 기존 parser가 제거하는 unknown JSON과 HTTP header·credential은 저장하지 않는다. 기존 masking으로 요청이 변하면 masked 값만 저장하고 redacted=true로 표시한다. 마스킹된 요청은 반환하거나 기본값으로 복원하지 않는다.

batch root의 `paper-simulation-runtime.json`은 create에서만 처음 생성하는 durable UUID namespace이다. 각 canonical 기록에는 해당 create 시점의 실제 Node version 및 기존 execution model version도 저장한다. 재시작 시 같은 namespace를 읽으며 read/validation은 생성하지 않는다. 전체 Git/build provenance나 input dataset 내용·가용성 보증은 아니다. marker가 손상되면 admission이 실패한다. Node/model version 변경은 새 create를 막지 않으며 새 요청은 현재 version을 기록한다. 과거 요청 read는 현재 version과 다르면 unavailable이다. 운영자가 임의로 marker를 수정하거나 reader가 복구하지 않는다.

canonical 또는 accepted 저장 실패는 기존 503/runner0 계약을 유지한다. 예약 디렉터리와 이미 저장된 bytes는 삭제·재사용하지 않는다. 기존 legacy accepted 기록은 읽기 호환되지만 canonical hash가 없으므로 요청 복원은 unavailable이다. 기존 관측 API 응답 구조는 변경하지 않는다.

## 읽기 계약

GET 전용 `/paper/simulations/request?simulationRunId=<exact batch ID>`는 typed requestedConfig와 기록의 identity/runtime/hash를 반환한다. 누락·중복·unknown query·비정상 ID는400, HEAD 및 다른 method는405이다. 유효한 exact ID의 증거가 없거나 불완전하면200의 `status: unavailable`, `reasonCode: canonical_request_unavailable`로 처리하고 요청 값을 반환하지 않는다.

조회는 original exact ID만 사용한다. child/latest fallback이나 prefix salvage·재구성·복구 쓰기는 없다. canonical16KiB/runtime2KiB/observation4KiB 제한과1초 checkpoint budget, UTF8·strict record version·원래 ID/acceptance hash·runtime 일치를 검사한다. 파싱이 unknown 필드를 버리거나 masking이 값을 바꾸는 요청도 unavailable이다. ancestor symlink·file symlink·hardlink·directory 파일·읽는 동안 교체/변경·observation append barrier는 fail-closed다. 파일 fingerprint를 반환 직전 다시 검사한다. checkpoint budget은 대기 중인 OS I/O를 강제 취소하는 sandbox가 아니다.

현재 whole-batch 요청의 보존·읽기만 제공한다. 자료 수집·provider 호출·유료 AI·실거래를 수행하지 않는다. 다음 clone 단계에서 현재 validation을 다시 실행한 후 기존 create1회를 사용해 새 ID를 생성하며, 이 읽기 결과만으로 clone 성공을 보장하지 않는다.

## 검증과 잔여 사항

합성 fixture로 HTTP create→durable request→runner1, original omission/decimal, GET side effects0, canonical fsync 선후와 failure503/runner0, legacy/masked/cross-runtime/ID/hash/unknown/version/oversized/torn/UTF8/barrier/hardlink/budget negatives를 검증한다. 기존 관측 테스트의 디렉터리 구성 기대값만 canonical 파일 추가에 맞춘다. Backend 변경이므로 이전 Linux 전체 통과를 새 head의 통과로 재사용하지 않는다. Draft의 고정 head에 대해 독립 Linux full 및 보안 검토가 필요하다.

기존 soft-navigation 간헐 정체의 원인 미확정 상태와 별도 late202 수정은 이 범위와 분리한다. PR814의 benchmark 표시 query가 다른 detail 탭 이동 후 기본3개로 초기화되는 UX는 후속 대상이며, 표시 상태를 business requestedConfig에 섞지 않는다.
## Exact runtime UUID의 HTTP 응답 보존

독립 검토에서 정상 UUID `aaaaaaaa-1234-4567-8123-abcdefabcdef`의 숫자 구간이 기존 계좌 패턴에 맞아 generic HTTP writer가 UUID를 변경하면서 canonical hash는 유지하는 P2를 재현했다. 저장·direct read는 정상인데 GET DTO만 identity 계약을 깨는 응답 경계 결함이다.

canonical GET 전용 writer는 먼저 기존 maskObject를 적용한 후200 available DTO의 mode/readOnly/record version/runtime version과 UUID 형식을 검증하여 정확한 `sourceRuntime.sourceRuntimeId` 필드만 원본으로 보존한다. 일반 writeJson과 계좌·JWT·token·nested 동명 필드 마스킹은 그대로 유지한다. 정상 UUID의 실제 GET 반복 응답과 direct read 전체 DTO 일치를 검증하며 malformed DTO·잘못된 UUID·다른 status code에는 보존 예외를 적용하지 않는다.