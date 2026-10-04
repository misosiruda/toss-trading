# 저장 provenance 부분 조회

`GET /batch/replay/runs/provenance?runId=<exact-child>`는 historical batch replay 저장 관측만 조회한다. 정확한 ASCII child ID 1개가 필요하다. 중복 파라미터, 경로 문자, 추가 query는 400이며 파일을 읽지 않는다. GET 외 method(HEAD 포함)는 405다. 모든 응답은 `Cache-Control: no-store`다. 새로운 create, provider 호출, broker 호출, 입력 저장 및 clone 동작은 없다.

## 결합과 읽기 경계

server storage의 sibling `batch-replay` root 아래 batch manifest와 고정 이름 runs index만 읽는다. aggregate/latest/batch alias를 선택 근거로 사용하지 않는다. 전체 index를 한도 안에서 검사해 같은 child가 여러 줄/여러 batch에 있으면 ambiguous, 손상 JSONL은 invalid다. 저장 record의 batch/index와 metadata의 identity가 같아야 한다. metadata가 다른 child이면 그 관측을 반환하지 않는다. 외부 research manifest와 metadata의 embedded manifest가 모두 있으면 identity와 canonical 저장 내용이 일치해야 한다. 불일치한 research 관측은 unavailable이며 독립된 정상 configuration 값은 유지한다.

저장 record의 child storage는 절대경로 또는 기본 CLI가 저장한 프로젝트 작업 기준 상대경로다. reader 시작 시 작업 기준을 고정하고 상대경로를 한 번만 resolve한 뒤 해당 batch `runs` 내부인지 확인한다. 다른 cwd·경로 후보를 탐색하거나 추측하지 않는다. 사용자 query나 source/log/report/manifest path 필드로 파일을 찾지 않는다. 부모부터 lstat으로 symlink/junction을 거절하고, 파일은 regular file/nlink 1, O_RDONLY/O_NOFOLLOW open 뒤 dev/ino/nlink를 확인한다. UTF-8 및 읽기 전후 크기/mtime도 검사한다. 실제 경로의 root containment와 child/batch/index identity를 유지한다. 이 검사는 기존 신뢰된 server storage를 위한 경계이며 악의적 동시 parent-directory 교체를 막는 OS sandbox를 주장하지 않는다.

유효한 batch manifest가 있는데 runs index 파일이 없으면 저장 손상 또는 아직 검사하지 못한 index로 취급해 전체 lookup을 invalid로 닫는다. 다른 batch의 match나 missing을 반환해 uniqueness를 주장하지 않는다. 실제 존재하는 빈 index는 허용하며 exact active manifest identity는 기존 계약대로 대조한다.

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

backend는 performance.now로 단일 monotonic deadline을 만들고 scan, stat·path 확인 후, 각 bounded file read 전후, UTF-8 decode·JSON parse·projection 후에 같은 deadline을 검사한다. OS에서 진행 중인 lstat/open/read를 강제로 취소할 수는 없다. 이미 열린 handle은 finally에서 닫고 deadline 뒤 새로운 read를 시작하지 않는다. directory iterator도 unwind하며 닫힌다. Promise race가 먼저 limit을 반환한 뒤 늦은 I/O 결과는 채택하지 않으며 부분 결과를 완전한 관측으로 노출하지 않는다. 다른 reader는 checkpoint 기본 no-op으로 기존 동작을 유지한다.

정확한 1,500ms 경계는 monotonic clock 회귀로 limit-only를 확인한다. adapter 회귀는 1,500ms limit과 250ms 응답 처리 후에도 기존 2,000ms abort 이전에 limit으로 표시함을 고정 clock으로 확인한다. 실제 transport가 영구 정체한 경우 기존 2초 abort·GET 1회·retry 없음은 유지한다.
