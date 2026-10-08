# Child admission lineage B — v1 계약안

기준 main: `e0c11bb710f085d16603618aa61baef90c5a4eed`.
[범위·완료 기준](child-admission-lineage-scope.md)에 따른 구현 전 계약안이다. 독립 설계 검토와 합성
최대-envelope 확인 뒤 구현하며, 이 문서는 새 producer/reader가 이미 존재한다는 뜻이 아니다.

## 1. 실제 발행 context

admission storage 모듈은 실제 저장한 canonical/input record와 accepted append의 성공을 소유한다.
입력 persister 내부의 richer result가 전체-record hash, 저장 당시 redacted 상태와 안전한 parsed snapshot을
반환할 수 있다. 기존 hash-only 진입점/void admission wrapper가 필요한 caller에는 원래 의미를 유지한다.
같은 파일을 receipt 때문에 두 번 쓰거나 accepted 뒤 현재 파일을 다시 hash하는 절차를 추가하지 않는다.

context는 accepted write/file sync/close/directory sync 및 append lock release가 모두 성공한 뒤 발행한다.
그 전 실패에는 context가 없고 기존 admission 오류·ID barrier가 남는다. 기존 Windows filesystem 예외를
확대하거나 child writer의 엄격한 directory durability 조건을 완화하지 않는다.

발행은 비직렬화·module-private ownership으로 확인한다. 예를 들어 모듈 내부에만 있는 issuance state와
그 state를 참조하는 정확한 frozen context identity를 사용할 수 있다. receipt reference·snapshot copy·
JSON clone·프로토타입·TypeScript brand·readonly·verified flag로 발행자를 위조할 수 없어야 한다.
임의 context/reference의 속성을 읽거나 parser에 넣기 전에 발행 소유권을 확인한다. 새 option의 accessor,
proxy wrapper, forged/직렬화 context를 실행해 확인하지 않으며 고정 오류로 거절한다.
생성자나 임의 JSON→verified context 변환을 외부로 열지 않는다. 이는 현재 process의 작은 producer 소유권
경계이며 signing/role/permission/token 발행 서비스나 악의적 process/module 방어 체계를 만들지 않는다.

private state는 admission writer가 소유한 bounded parsed copy다. response/config/runnerInput의 나중 값을
다시 읽어 기대값을 만들지 않는다. 객체 변경으로 stored input hash나 mapping 기대값이 바뀌지 않는다.
민감 원문을 보관하지 않으며 저장이 redacted이면 원문 snapshot을 private context에도 복원하지 않는다.
현재 reader의 generic unavailable을 mandatory post-accept503 gate로 사용하지 않는다.

### 안전한 reference

손실 없이 보존된 admission의 작은 reference는 아래 필드만 갖는다.

| 필드 | 값/근거 |
| --- | --- |
| receiptVersion | `paper_simulation_admission_receipt.v1` |
| simulationRunId, batchId | 실제 accepted ID, 둘은 같고 기존 PAPER_SIMULATION_ID_PATTERN |
| acceptedAt | 실제 accepted ISO 시각 |
| canonicalVersion, canonicalRequestHash | `paper_simulation_canonical_request.v1`, 실제 canonical 전체-record hash |
| inputVersion, inputProvenanceHash | `paper_simulation_input_provenance.v1`, 실제 input 전체-record hash |

reference는 복사 가능한 데이터이고 단독으로 검증 권한이 없다. accepted event 자체의 별도 hash가 이미
존재한다고 가정하거나 이번 B에서 추가하지 않는다. namespace/sourceRuntimeId는 기존 admission 저장의
결속 의미만 가진다. 실제 child process/Node/runtime version 검증으로 표시하지 않는다.

legacy input 부재와 실제 저장 redaction 또는 더 강한 bounded credential 검출은 private state의 typed
unavailable로 구분한다. 이 state에는 reason만 보관하며 ID/시각/hash/snapshot/원문·파생 secret을 넣지 않는다.
발행 소유권은 먼저 확인하되 unavailable이면 identity/reference를 구성하기 전에 B 발행을 생략한다.

실제 합성 접수에서 `password=SYNTH_B`와 저장 redacted=true인 JWT형 seed 모두 sanitized accepted ID와
child ID에 민감 부분이 남았다. 기존 identity masking이나 원래 문자열용 detector로 sanitized ID의 안전성을
다시 추측할 수 없다. 따라서 payload의 seed만 빼거나 그 ID를 hash해 unavailable 파일에 넣지 않는다.
B 파일 없음은 verified 연결이 없다는 의미이며, 그 부재만으로 private unavailable reason을 추정하지 않는다.
기존 accepted/ID/실행·A/source 보안 중단을 바꾸는 수정이 아니다.

## 2. 전달과 versioned mapping

API 내부 runnerInput → batch options → child workflow options에 optional context를 전달한다.
새 HTTP/CLI 입력 필드, response receipt endpoint, public constructor를 만들지 않는다.
body/header의 receipt/hash/verified 주장으로 이 context를 채우지 않는다.

API v1 지원은 random_month/fixed_range의 기존 default adapter 경로다. version은
`paper_simulation_child_mapping.v1`이다. 저장된 effective snapshot을 현재 resolver/env로 재구성하지 않는다.
현재 실행 경계에서 아래의 알려진 변환과 실제 child 인자를 대조한다.

- batchId=simulationRunId, zero-based index가 effective runCount 안에 있음.
- normalized batch seed는 effective.window.seed.trim(); window.seed는 `${normalizedSeed}:${index}`.
- child runId는 기존 safe batchId/6자리 index/selectedMonth 규칙. startedAt은 acceptedAt+index ms.
- random selection은 accepted range/windowMonths/offset540/child seed의 기존 pure sampler 결과와 결속.
  API에는 calendar/candidateFilter/balanced/split 선택이 없다. 이 조건이 아닌 경로를 v1 matched로 취급하지 않는다.
- fixed selection은 accepted fixedWindow의 필드·presence를 보존하고 seed만 child seed로 교체한다.
  fixed의 candidateIndex0과 child index를 혼동하지 않는다.
- 실제 windowSelection과 mode를 사용하며 legacy metadata의 random_window label로 mode를 추측하지 않는다.

선택 결과를 새로 계산해 원래 child 인자를 바꾸지 않는다. 기존 batch가 만든 실제 selection의 private copy를
전달하고 검증한다. 검증 때문에 calendar/source를 추가 조회하거나 새로운 filtering을 수행하지 않는다.
window 관계는 planned derivation이며 clock session/ticks나 sampler state·구현의 동일성을 증명하지 않는다.

### A 공유 field

기대 projection은 아래 값/presence를 갖는다. 일치 판정은 versioned A snapshot의 동일한 hash domain을
사용하며 실제 durable A의 recorded contentHash와 비교한다. A payload를 B에 중복 저장하지 않는다.

| A 항목 | frozen API v1 기대값 |
| --- | --- |
| packetIdPrefix | `packet_<safe batchId>_<index>` |
| packetExpiresInSeconds / maxCandidates / maxSnapshotAgeSeconds | 60 / 10 / 86400. 일반 batch의 age300을 가져오지 않음 |
| tickDelayMs | 저장된 effective.tickDelayMs의 값과 presence |
| constraints | 저장된 effective.constraints, allowedActions 순서·중복·presence 유지 |
| executionPolicy | 저장된 effective.costModel.executionPolicy를 기존 workflow normalization한 supplied 결과 |
| riskPolicy / allocationPolicy | 저장된 effective base 값·presence. tick별 scheduled ceiling/ramp/regime 파생과 구분 |
| paperExitPolicy | effective null은 omission. non-null은 기존 supplied normalized policy |
| universeManifest / candidateStrategyBucket / marketRegimeAllocationPolicy | 현재 API adapter의 omission |

expected projection이나 actual A가 관측 unsupported/limit이면 같다고 판정하지 않고 unavailable이다.
A의 redacted/inspection_unavailable stop은 먼저 적용하며 이를 B를 위해 늦추지 않는다.
지원된 recorded A와 기대값의 차이는 mapping mismatch다. receipt만 가지고 matched를 만들 수 없다.

### 초기 상태

generated origin이면 실제 initial snapshot이 요청 cash, 빈 holdings와 실제 계획 시작시각으로 생성된
초기 객체에 대응하는지 검증한다. stored_portfolio origin이면 요청 cash와 다를 수 있으며 기존 저장 상태가
우선했다는 relation을 기록한다. 요청 cash로 actual portfolio를 덮어쓰지 않는다. 실제 initial reference가
unavailable이면 초기 관계도 unavailable이며 B의 matched claim은 발행하지 않는다.
원래 initial 전체-record reference는 그대로 결속하므로 cash0·보유·원가 등의 차이를 잃지 않는다.

## 3. 별도 immutable artifact

파일: `historical-replay-admission-lineage.json`.
버전: `replay_admission_lineage.v1`, phase: `child_admission_binding`, mode: `paper_only`.
기존 initial/source/settings v1의 schema·admission unavailable 상수·bytes는 바꾸지 않는다.

공통 envelope는 다음 값만 갖는 strict object다.

- schemaVersion/mode/phase
- identity(runId, batchId, runIndex), startedAt, reservationHash
- 실제 durable initialObservation/sourceObservation/settingsObservation의 version·전체-record hash·typed state
- lineage 아래 union
- clock/sampler/provider/acquisition/sourceTrust/sourceFileIdentity/sourceReadCompleteness/runtime/dependencies/result는
  `unavailable`; completeConfiguration=false, completeInput=false, comparability=unavailable

이 producer는 손실 없는 available admission context가 있는 child에만 B 파일을 만든다. batchId는 그 context의
PAPER_SIMULATION_ID_PATTERN과 같고 runId는 기존 child ID 한도256/ASCII를 따른다. context 없는 일반
batch의 opaque batchId를 새 B file에 복사하거나 과거 실행을 backfill하지 않는다.

`lineage.status=recorded`는 아래 근거가 모두 확인됐을 때만 발행한다.

- 위의 안전한 admission reference
- mappingVersion, effectiveRunCount(1–20), windowMode(random_month/fixed_range)
- normalizedBatchSeed(1–120 UTF-16 units), 실제 plannedWindow의 frozen 필드
- expectedSettingsHash(actual A recorded contentHash와 동일)
- initialCapitalRelation(`generated_matches_admission` 또는 `stored_portfolio_precedence`)

plannedWindow는 기존 ReplayWindowSelection의12필드(seed,rangeStart,rangeEnd,windowMonths,
timezoneOffsetMinutes,candidateCount,selectedCandidateIndex,selectedMonth,localStartDate,localEndDate,startAt,endAt)를
고정한다. seed는 실제 child suffix를 포함해 최대140 UTF-16 units, 시각은4자리 year의 UTC canonical ISO
`YYYY-MM-DDTHH:mm:ss.sssZ`(24자, Date.toISOString round-trip 일치),
selectedMonth는 YYYY-MM, local date는 YYYY-MM-DD, offset은540이다. candidateCount는 양의 safe integer,
selectedCandidateIndex는 그 미만의0 이상 safe integer다. fixed는 count1/index0이다.
windowMonths는1–12이며 effective fixed top의null과 fixedWindow 안의 metadata 값을 구분한다.

현재 API가 허용하는 시간 범위 전체가 이 recorded 표현에 들어온다고 가정하지 않는다. 기존 sampler는
초기 year0100의 label을 `100-01`/`100-01-…`로 만들 수 있고, UTC9999년 말의 +09 local 변환은
`+010000` label을 만들 수 있다. 실제 selection이 위 frozen grammar 밖이면 strict recorded parser 전에
`unsupported_derivation`으로 분류한다. 이 fallback은 writer-owned admission에서 도출한 기대 selection 자체가
표현 밖일 때만 적용한다. 지원되는 정상 기대값을 caller가 비표준 label로 바꾼 경우는 mismatch이며
unavailable로 강등하지 않는다. 기존 replay/API 허용을 유지하며 label을 padding·정규화해
새로 발명하지 않는다. 이 두 합성 입력의 admission/sampler 수용 및 B unavailable 회귀를 포함한다.

`lineage.status=unavailable`에는 reason만 둔다: `unsupported_derivation`, `settings_unavailable`,
`initial_unavailable`. 이것은 available admission에 대응하는 child 관측/표현의 부분성이다.
issuer의 input_missing/redacted는 이 artifact union이 아니라 앞선 private 분기이며 B 파일 자체가 없다. receipt/snapshot/seed/window/기대 hash를 이 branch에 넣지 않는다.
누락·redaction·관측 불가를 mismatch나 verified로 바꾸지 않는다. 실제 지원된 context/recorded observation의
명백한 위조·불일치는 이 union으로 숨기지 않고 발행 실패로 다룬다.

새로 소유할 원본 admission 문자열은 기존32KiB 경계의 parsed data에서 더 강한 bounded credential 검사를
거친다. 저장 redacted 또는 positive credential이면 원문/파생값/개별 hash 없이 private unavailable로
분기해 B를 생략한다. 검증된 안전 원본에서 생성한 seed suffix/ID는 exact derivation 관계로 확인한다.
예를 들어 정상 seed `token`의 파생 `token:0`을 별도 사용자 credential assignment로 오인하지 않는다.
안전한 원본과 다른 caller의 actual 문자열은 mismatch이며 redacted 생략으로 강등해 숨기지 않는다.
이 과정은 기존 canonical/input 저장 bytes와 masking을 확대 변경하지 않으며 A/source의 기존 stop도 유지한다.

전체 UTF-8 JSON+개행은 최대8,192bytes다. 기존 입력 한도를 확대하거나 그 크기의 임의 객체를 받는다는
뜻이 아니다. Node 합성 직렬화에서 독립 field-max/최대 escaping recorded envelope는4,804bytes,
발행 가능한 unavailable3종은2,044–2,047bytes였다. 최대와 한도 사이의 여유는3,388bytes다. 이 fixture는 서로 동시에
성립하지 않을 수 있는 field 상한을 합친 크기 대조이며, 실제 유효 window나 producer/schema 시험이 아니다.
구현에서는 strict schema의 실제 최대 허용 fixture와 writer의 bounded UTF-8 검사를 다시 검증한다.
초과/unknown version/unknown key/nonfinite/잘못된 presence를 버리거나 truncate해 성공으로 만들지 않는다.

## 4. 실제 durable reference와 순서

settings writer는 파일 write/sync/close와 directory sync/close를 마친 실제 record에서 작은 frozen
reference를 반환한다. reservation owner가 initial/source/A reference를 보관하고 B writer에 넘긴다.
caller가 낸 관측 hash나 저장 뒤 현재 파일 재hash로 이 reference를 바꾸지 않는다.

B writer는 same identity/startedAt/reservation와 실제 선행 reference를 먼저 대조하고, 발행 context의
private stored state로 mapping을 검증한다. 별도 B file은 exclusive write → file sync/close → directory
open/sync/close를 완료한 뒤에만 다음 단계가 시작된다. attempted flag는 실패 전에도 소비되어 재시도를
허용하지 않는다. B output/orphan/alias도 기존 reservation preflight의 출력 목록에 포함한다.

| 경로 | 순서·결과 |
| --- | --- |
| context 없음 또는 private issuer unavailable(input_missing/redacted) | 종전 initial/source/A 경로, B 파일 없음; ID/reference 구성도 생략 |
| 지원 context+recorded A/initial+관계 일치 | reservation → initial → source → A → B recorded durable → legacy → ticks/decide |
| available admission과 관측 unsupported·limit/표현 불가 | 같은 선행 기록 → B unavailable durable → 기존 허용 실행 |
| source redacted / settings redacted 또는 inspection_unavailable | 기존 단계에서 먼저 stop, B를 위해 후속 실행하지 않음 |
| 준비 전 검사·planning 실패 | 기존 오류/안전 규칙, 아직 없는 A/B 결속 생성 없음 |
| context 위조·지원된 ID/hash/reference/mapping 충돌 | 고정 오류, 이후 legacy/ticks/decide0, barrier 보존 |
| B 저장/내구성 실패 | 고정 child failure, 이후 ticks/decide0, partial/예약 보존. accepted202를503으로 소급하지 않음 |
| availability skipped | 실제 child runner/A capture가 없으므로 B 없음 |

검증된 ancestry/mapping은 child completed 또는 report 검증과 다르다. B가 존재한다고 completion/비교
근거를 만들지 않는다. 실패 파일을 자동 삭제·재작성·복구하거나 retry하지 않는다.

## 5. 검증·롤백

[범위 문서 완료 기준](child-admission-lineage-scope.md#완료-기준)의 실제 HTTP→default batch→child,
변환·stored override, mutation/위조, 내구성·legacy·clone·부분 관측 회귀를 적용한다. 합성 credentials만 사용한다.
64자리 hash 값이 맞아 보이는 것만으로 fixture를 발행된 context로 취급하지 않는다.

새 source/input/redacted 동작을 과거 full로 검증했다고 표시하지 않는다. 독립 검토와 새 최종 Linux full,
현재 자동 review/GitHub 보호 gate가 필요하다. 공개 reader/UI·runtime/result producer는 추가하지 않는다.
롤백은 새 context 전달/B writer를 제거하는 코드 변경이며 이미 남긴 B/A/예약/accepted 자료는 보존한다.
