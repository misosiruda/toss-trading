# 저장 provenance 부분 조회

`GET /batch/replay/runs/provenance?runId=<exact-child>`는 historical batch replay 저장 관측만 조회한다. 정확한 ASCII child ID 1개가 필요하다. 중복 파라미터, 경로 문자, 추가 query는 400이며 파일을 읽지 않는다. GET 외 method(HEAD 포함)는 405다. 모든 응답은 `Cache-Control: no-store`다. 새로운 create, provider 호출, broker 호출, 입력 저장 및 clone 동작은 없다.

## 결합과 읽기 경계

server storage의 sibling `batch-replay` root 아래 batch manifest와 고정 이름 runs index만 읽는다. aggregate/latest/batch alias를 선택 근거로 사용하지 않는다. 전체 index를 한도 안에서 검사해 같은 child가 여러 줄/여러 batch에 있으면 ambiguous, 손상 JSONL은 invalid다. 저장 record의 batch/index와 metadata의 identity가 같아야 한다. metadata가 다른 child이면 그 관측을 반환하지 않는다. 외부 research manifest와 metadata의 embedded manifest가 모두 있으면 identity와 canonical 저장 내용이 일치해야 한다. 불일치한 research 관측은 unavailable이며 독립된 정상 configuration 값은 유지한다.

저장 record의 child storage는 절대경로 또는 기본 CLI가 저장한 프로젝트 작업 기준 상대경로다. reader 시작 시 작업 기준을 고정하고 상대경로를 한 번만 resolve한 뒤 해당 batch `runs` 내부인지 확인한다. 다른 cwd·경로 후보를 탐색하거나 추측하지 않는다. 사용자 query나 source/log/report/manifest path 필드로 파일을 찾지 않는다. 부모부터 lstat으로 symlink/junction을 거절하고, 파일은 regular file/nlink 1, O_RDONLY/O_NOFOLLOW open 뒤 dev/ino/nlink를 확인한다. UTF-8 및 읽기 전후 크기/mtime도 검사한다. 실제 경로의 root containment와 child/batch/index identity를 유지한다. 이 검사는 기존 신뢰된 server storage를 위한 경계이며 악의적 동시 parent-directory 교체를 막는 OS sandbox를 주장하지 않는다.

유효한 batch manifest가 있는데 runs index 파일이 없으면 저장 손상 또는 아직 검사하지 못한 index로 취급해 전체 lookup을 invalid로 닫는다. 다른 batch의 match나 missing을 반환해 uniqueness를 주장하지 않는다. 실제 존재하는 빈 index는 running manifest의 count가 0일 때만 허용하며 exact active manifest identity는 기존 계약대로 대조한다.

요청 ID로 필터링하기 전에 모든 index 행의 mode, batchId, ASCII runId, runCount 범위의 정수 runIndex, seed·storage 경로 타입/길이, 시작 시각, terminal status와 해당 terminal 시각/null 구분을 검사한다. 다른 child의 손상된 행도 전체 조회를 invalid로 닫는다. 모든 행의 raw 경로 문법과 batch/runs 내부 경계를 검사하지만 다른 child의 artifact 파일을 추가로 읽지는 않는다. ID 또는 index 중복은 ambiguous다. active snapshot과 terminal 행이 같은 ID 또는 index를 공유하면 두 identity와 저장 경로가 같아야 한다.

raw batchId와 seed는 writer의 normalizeRequiredText 계약(양끝 공백을 제거한 비어 있지 않은 문자열)을 따른다. 공백·콜론·슬래시·Unicode가 들어간 batchId도 그대로 identity 대조에 사용하고, filesystem 이름은 writer가 별도로 safeArtifactPathPart로 만든다. reader가 raw batchId를 경로에 결합하거나 다른 디렉터리를 찾지 않는다. opaque text는 기존 manifest/index 전체 byte 한도로 제한되며 임의의 child query 길이 제한을 적용하지 않는다. 저장 child ID의 안전한 ASCII 문법과 요청 child ID의 엄격한 256자 한도는 구분한다.

스캔한 directory는 producer의 safeArtifactPathPart(batchId, "batch")로 정해지는 directory와 같아야 한다. 비교에만 정제된 이름을 사용하며 raw ID나 대체 경로로 파일을 열지 않는다. Node의 host path 비교로 Windows의 실제 case-insensitive 경계를 보존한다. manifest와 모든 행의 batchId를 함께 다른 값으로 바꿔 directory 관계를 위조해도 invalid다. 실제 writer matrix는 공백·구분자·Unicode fallback·raw traversal처럼 보이는 batchId의 정상 저장/조회, 두 실제 batch의 다른 child와 중복, unrelated 행 손상, count/whole-row 삭제, 저장 경로 탈출·traversal 거절과 opaque text 비노출을 대조한다.

writer는 index에 순서대로 terminal 행을 append하고 manifest를 나중에 갱신한다. running manifest에서는 빈 index·아직 실행하지 않은 마지막 child 누락·terminal count 지연·같은 child의 active/terminal 중첩이 정상이다. 다만 저장된 행은 0부터 연속된 index prefix여야 하고 manifest count가 관측된 terminal bucket보다 많을 수 없다. completed/completed_with_failures에서는 행 수가 runCount와 같고 각 index가 정확히 한 번 존재하며 completed/skipped/failed count와 최종 status가 정확히 맞아야 한다. completed_with_failures child는 completedCount에 포함된다. 완전한 행 삭제나 정상 JSON만 남은 잘린 index도 invalid다. skipped child의 artifact directory가 없는 정상 partial 계약은 유지한다. 이것은 index identity와 완료성 검사이며 전체 replay 설정을 복원·검증하는 계약은 아니다.

active snapshot은 이미 terminal prefix에 존재하는 동일 child와 겹치거나, prefix 바로 다음 index에만 존재할 수 있다. prefix보다 뒤의 아직 기록되지 않은 index를 건너뛰면 다른 요청 child의 조회도 invalid다. 과거 writer의 manifest는 activeRun 필드를 도입 전 생략했다. 공개 writer 이력1b9f5544(도입 전)·8b10b6c6(도입 후)와 초기48f94577의 identity/count/timestamp 계약을 대조했다. 생략은 내부적으로 active identity 없음으로 취급하되 completed의 전체 index/count 증명과 running의 prefix/count 검사는 그대로 적용한다. 생략된 옛 running snapshot에서 미기록 active child를 추측·복원하지 않는다. 그 ID는 index에 없으면 missing이며 다른 정상 batch 조회를 막지 않는다.

한도는 root entries 256개, batch manifest 256KiB, index 각 4MiB 및 10,000줄, metadata 512KiB, research manifest 64KiB, 총 파일 bytes 8MiB, 전체 2초다. deadline 이후 추가 읽기를 멈추며 진행 중인 bounded file handle은 finally에서 닫는다. 한도를 넘으면 일부 index를 유일하다고 해석하지 않고 `limit`로 응답한다.

## 응답 의미

`contractVersion: replay_provenance_read.v1`은 현재 조회 DTO 버전이다. 과거 실행 runtime 버전이 아니다. 정상 응답도 `partial`이며 전체 requested/effective 입력을 복원했다고 주장하지 않는다. 각 field는 `recorded/source/verification: stored_observation/value` 또는 `unavailable/reason/value:null`이다. 원본에서 field 존재 여부를 먼저 확인하므로 schema default를 새 저장 값으로 만들지 않는다. 저장된 0은 0으로 반환한다.

window의 고정 enum·시각·timezone, capital/clock/sampling/constraints의 일부 값, risk/allocation/exit의 whitelist scalar, executionPolicy scalar, 저장된 SHA256 hash 및 알려진 execution model version만 projection한다. hash는 당시 저장 관측이며 현재 자료·정책·코드의 hash를 재계산하거나 검증하지 않는다. 자유 문자열 seed/preset/packet prefix는 값이 저장됐어도 `redacted_text`로 숨긴다. 임의 map key, policyName, provider/prompt 출력, warnings/errors, 경로, token 및 환경 설정은 응답에 포함하지 않는다. 새 계산 seed hash도 만들지 않는다.

projection 문자열은 최대 128자, enum collection은 최대 16개로 제한한다. 초과 field는 invalid/unavailable이며 큰 배열이나 자유 문자열을 그대로 전달하지 않는다.

raw 문자열 길이와 배열 길이는 Zod safeParse 전에 제한한다. 날짜 6필드는 reader 전용 엄격한 ISO timestamp 문법과 calendar 범위를 먼저 검사한다. Date.parse가 허용하는 자유 문자열·괄호 설명·경로는 unavailable/invalid로 거절하고 과거 정본처럼 정규화하지 않는다. nullable range의 저장 null만 그대로 허용한다.

원래 requestedConfig/effectiveConfig/notices와 runtime Git revision/dependency lock hash/Node version은 historical API 실행에 저장되지 않았으므로 `not_persisted`다. 다른 CLI paper-experiment 증거 계열의 runtime/input 정보를 가져와 보충하지 않는다. comparison/clone은 계속 unavailable이다. future create 정본 저장과 clone 단위 선택은 이 범위 밖이며 사용자 결정 전 구현하지 않는다.

## 검증

합성 fixture에서 exact child/다른 child/partial/missing/malformed, metadata identity 불일치, research identity·embedded hash 불일치, 전체 index의 100개 밖 중복 및 다른 batch 중복, 경로 밖 접근, hardlink 및 junction/symlink, 파일 byte/line 제한, read 전후 bytes/mtime/entries 보존, HTTP GET-only/no-store/400/405 및 runner 호출 0을 확인한다. 독립 리뷰와 Linux 최종 gate 전 Ready/merge하지 않는다.

## 읽기 deadline과 응답 전달 예산

인식된 index의 exact child는 artifact directory가 없어도 unknown ID로 바꾸지 않는다. 데이터 부족으로 skipped된 child는 runner가 directory를 만들지 않을 수 있다. raw 경로 문법과 batch/runs lexical containment 및 존재하는 ancestor의 symlink 방어를 통과한 ENOENT에 한해, index의 batch/child 결속을 보존한 partial과 metadata/research field별 missing을 반환한다. outside/traversal/symlink/중복/누락 index는 이 경로에서도 거절한다. index에 없는 ID의 전체 missing과 구분하며 입력 복원이나 실행 성공을 추정하지 않는다.

UI transport는 기존 2초이며 backend 읽기·파싱·projection은 최대 1.5초다. 고정 field whitelist의 JSON 직렬화와 loopback 전달에 0.5초를 남기는 정책이다. client의 x-provenance-budget-ms는 남은 상대 duration만 전달하며 backend는 최대 2초로 clamp하고 reserve를 뺀다. 누락·잘못된 값은 기본 예산이며 client hint로 최대 읽기 예산을 늘릴 수 없다. 네트워크 이동 시간 자체를 정확히 알거나 모든 지연을 보장하는 계약은 아니다.

backend는 performance.now로 단일 monotonic deadline을 만들고 scan, stat·path 확인 후, 각 bounded file read 전후, UTF-8 decode·JSON parse·projection 후에 같은 deadline을 검사한다. OS에서 진행 중인 lstat/open/read를 강제로 취소할 수는 없다. 이미 열린 handle은 finally에서 닫고 deadline 뒤 새로운 read를 시작하지 않는다. directory는 명시적 read loop로 순회하며 모든 read 이전과 이후에 deadline을 검사하고 finally에서 닫힌다. opendir가 예산 뒤 끝나거나 entry 처리 중 예산이 지나도 다음 read를 시작하지 않는다. Promise race가 먼저 limit을 반환한 뒤 늦은 I/O 결과는 채택하지 않으며 부분 결과를 완전한 관측으로 노출하지 않는다. 다른 reader는 checkpoint 기본 no-op으로 기존 동작을 유지한다.

정확한 1,500ms 경계는 monotonic clock 회귀로 limit-only를 확인한다. adapter 회귀는 1,500ms limit과 250ms 응답 처리 후에도 기존 2,000ms abort 이전에 limit으로 표시함을 고정 clock으로 확인한다. 실제 transport가 영구 정체한 경우 기존 2초 abort·GET 1회·retry 없음은 유지한다.

15ms 읽기 예산에 opendir가 virtual40ms에 끝나는 경계는 directory read0/close1/limit-only로 검증한다. 첫 entry 처리 중40ms에 도달하는 경계도 read1/다음 read0/close1을 확인한다. 이 경계 검사에서 실제 sleep이나 timeout 확대를 사용하지 않는다.

## Requested writer-child ID boundary (API follow-on)

The frozen public API `3099348326e25a7d8899a3341ccfe290c4fc51c6` is preserved. Actual writer batches `-synthetic`, `--` and `-` generate stored children rejected by the old alphanumeric-first request gate. This is a compatibility gap within the existing bounded request contract.

Generic alphanumeric-first ASCII IDs and the 256-character cap remain. Additional leading-hyphen admission is restricted to sanitized batch prefix (no dot/escape or edge underscore), `_run_`, a canonical padded nonnegative safe-integer index and the writer numeric year/month suffix. Arbitrary leading-hyphen IDs remain invalid. Terminal line breaks are rejected in both requested and stored IDs. Query decoding remains once, duplicate/extra keys are rejected and slash/backslash/percent/control/space/Unicode query characters remain invalid. Requested IDs never become paths; index storage paths retain all syntax, containment, filesystem and identity checks. Long producer IDs exceeding256 remain outside this request contract.

The API-owned matrix runs fourteen actual synthetic writers, reads twenty-eight generated children over the real GET-only HTTP route, rejects unsafe encoded query suffixes and duplicate keys, and rejects six forbidden suffix classes in an unrelated stored sibling. Reads invoke neither runner nor provider. No frontend import belongs in this API test. The UI-owned companion separately proves the same writer→HTTP results through the actual display adapter and transport. Synthetic fixtures only; no paid AI, live execution, credentials or real data.

The earlier combined candidate remains preserved. API-only final-tree verification is recorded separately; no latest Linux full, Security or publication is claimed by this source contract.

API-only final-tree Windows verification: root build, focused API41/41 and quality gate pass. No frontend source or dynamic frontend import is included in this API follow-on. UI integration and frontend verification belong to the separately stacked UI companion. These are not latest Linux full or Security results.
