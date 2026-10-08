# Child admission lineage B — 구현 범위

기준 main: `e0c11bb710f085d16603618aa61baef90c5a4eed` ([PR823](https://github.com/misosiruda/toss-trading/pull/823)).
이 문서는 [A의 후속 B](child-applied-settings-scope.md#후속-b-admission-lineage)와
[입력·runtime 계약](input-runtime-provenance-contract.md)의 부분 producer 설계다. B 구현·시험 완료 보고가 아니다.

## 목적

서버가 실제 durable accepted 뒤 발행한 내부 context를 API → batch → 실제 child로 전달하고,
그 접수의 저장 입력과 child가 실제 캡처·저장한 A 설정 사이의 알려진 변환을 검증한다.
별도 immutable B 기록이 receipt, exact child, 실제 A reference와 제한된 mapping 판정을 연결한다.
receipt의 존재와 설정 일치는 다른 근거다. 요청 hash를 옆에 적는 것만으로 실제 소비가 검증되지 않는다.

기존 initial/source/settings v1의 `admission: unavailable` 상수와 원래 bytes는 변경하지 않는다.
B가 성공해도 completeConfiguration=false, completeInput=false, comparability=unavailable이다.
clock/sampler/provider의 state·구현, process/build/Node/dependency, 완료 result/report 결속,
source acquisition/file identity/read completeness, 공개 reader/endpoint/UI와 비교는 후속이다.
실거래·유료 실행·새 외부 자료 수집·generic permission/trust 체계를 추가하지 않는다.

## 현재 코드에서 확인한 근거

- `acceptPaperSimulation`은 ID 예약 → canonical/input exclusive write와 sync → 두 전체-record hash를
  포함한 accepted durable append 뒤 void를 반환한다. accepted event 자체의 별도 content hash는 없다.
- API는 같은 resolve의 requested/effective/notices를 저장하지만 response와 runnerInput이 mutable
  config reference를 공유한다. B 기대값을 그 reference에서 나중에 다시 만들면 안 된다.
- input persister는 masking 여부를 record에 갖지만 지금은 hash만 반환한다. redacted admission도
  accepted될 수 있으므로 hash가 있다는 이유로 손실 없는 입력이라고 판단하면 안 된다.
- 기존 `readPaperSimulationInput`은 legacy/redacted/lock/limit/변경·결속 오류를 generic unavailable로
  합친다. 이를 mandatory post-accept gate로 끼워 기존 accepted를503으로 소급하지 않는다.
- batch는 source를 읽고 availability가 통과한 child만 호출한다. child는 source/portfolio를 다시 읽는다.
  batch의 read 또는 skipped record를 child 실제 소비 관측으로 승격하지 않는다.
- 실제 순서는 runner private capture → reservation/initial → source → settings durable → legacy artifacts
  → ticks/decide다. B는 settings durable 뒤, legacy artifacts 전에 들어간다.

참조: [admission writer](../../../src/storage/paperSimulationObservationStore.ts),
[input writer/reader](../../../src/storage/paperSimulationInputStore.ts),
[API adapter](../../../src/api/paperSimulationRuns.ts),
[batch](../../../src/workflows/historicalBatchReplayWorkflow.ts),
[child plan](../../../src/workflows/historicalReplayWorkflowPlan.ts),
[reservation owner](../../../src/storage/replayInitialPortfolioObservationStore.ts).

## 소유 범위

1. 저장 writer가 실제 저장한 입력·redacted 상태를 소유하고 accepted append/lock release 성공 뒤에만
   비직렬화 내부 context를 발행한다. 공개 가능한 receipt reference와 private 기대값을 구분한다.
2. API의 내부 runnerInput, batch options와 child workflow options에 optional context를 전달한다.
   HTTP body/header나 CLI에 receipt/hash/verified 입력 surface를 추가하지 않는다.
3. 실제 settings writer가 작은 immutable durable reference를 반환하고 같은 reservation owner가 보관한다.
   settings snapshot 전체를 새 writer에 장기 보관하거나 저장 후 파일을 다시 hash해 소비 근거로 만들지 않는다.
4. [B v1 계약](child-admission-lineage-contract.md)의 별도 파일을 exclusive 저장한다. 기존 A 기록을
   수정하거나 과거 child를 backfill하지 않는다. B 파일도 orphan/기존 출력 검사에 포함한다.
5. API random/fixed 경로만 v1의 검증된 derivation 대상이다. 일반 batch의 balanced/split/role-regime/
   calendar-filtered 경로를 이름만 바꾸어 지원하지 않는다. 기존 sampler의 초기-year/extended local label이
   B frozen 표현 밖이면 unsupported_derivation으로 남기고 기존 replay 허용을 유지한다. context 없는 기존 경로는 그대로다.

## 실제 변환

| 구분 | 접수에서 child까지의 의미 |
| --- | --- |
| ID/index | simulationRunId=batchId. child index는0부터 effective runCount 미만. runId는 기존 safe batch ID·6자리 index·selectedMonth 조합 |
| count | single은 requested count와 무관하게1. batch omission은5. requested omission/명시값과 notice를 다시 resolve하지 않음 |
| seed | effective seed 원문을 보존한 admission과 batch의 trim 결과를 구분. child seed는 trimmed seed + `:` + index |
| 시각 | acceptedAt=API createdAt. child startedAt=accepted epoch + index milliseconds. 실제 wall-clock 시작으로 표시하지 않음 |
| random | effective range/windowMonths/offset540와 child seed로 선택된 full-month 후보·index·month·start/end를 연결 |
| fixed | effective top windowMonths는null. fixedWindow의 metadata windowMonths는 보존하고 seed만 child seed로 바꿈. candidateIndex0은 child index가 아님 |
| mode | legacy child metadata는 fixed에도 random_window라고 쓸 수 있음. B는 authoritative API mode와 실제 selection을 사용 |
| scalars | API prefix `packet_<safe batchId>`에 child index suffix. expiry60/maxCandidates10/API age86400. 일반 batch age300으로 채우지 않음 |
| pacing | admission에 저장한 effective tickDelayMs를 전달. 현재 env로 다시 계산하지 않음 |
| 공유 A | constraints 순서·presence, supplied execution normalization, base Risk/allocation, null exit→omission을 exact A snapshot/hash와 비교 |
| A omission | API가 넘기지 않는 universeManifest/candidateStrategyBucket/marketRegimeAllocationPolicy를 새 기본값으로 채우지 않음 |
| 초기 portfolio | 저장 상태가 요청 cash보다 우선. generated와 stored override를 actual initial origin/hash로 구분. cash0·보유를 unknown으로 합치지 않음 |
| runtime 제외 | window/seed는 planned derivation. 새 clock/sampler 인자 전달을 실제 session/state/구현의 동일성으로 승격하지 않음 |

## 실패·호환성

- admission 저장 실패는 기존409/503·runner0, ID barrier 보존이다. context가 먼저 발행되지 않는다.
- context 없는 legacy/standalone/batch는 B unavailable 의미이며 새 B 파일을 만들 필요가 없다.
- canonical-only 또는 redacted admission에서 손실 없는 기대값이 없으면 typed unavailable이다.
  과거 accepted나 clone을 새 실패로 바꾸거나 원문·민감 hash를 복원하지 않는다.
- 지원된 context 위조, ID/시각/hash/reference 또는 recorded A mapping 불일치는 고정 오류로
  ticks/decide 전에 멈춘다. 조용히 context omission으로 바꾸어 실행하지 않는다.
- A unsupported/limit 또는 관측 불가 initial은 mapping unavailable이며 기존 허용 실행은 유지한다.
  source/settings redacted와 settings inspection_unavailable의 기존 중단을 B를 위해 늦추지 않는다.
- B write/sync/close 실패는 child 실행 전 정지하며 partial file/reservation을 보존한다.
  이미 반환한202를503으로 소급하지 않고 기존 child/batch failure 관측을 따른다.
- clone은 원래 requestedConfig의 새 validation/new ID/new admission이다. 옛 context를 복제하지 않는다.
- skipped 또는 실제 runner 진입 전 실패한 child에 consumed B 증거를 만들지 않는다.

## 완료 기준

1. 실제 합성 HTTP create가 default batch와 실제 child까지 진행해 accepted의 두 hash/ID/acceptedAt,
   A의 실제 immutable reference와 B가 일치한다. response spy만으로 끝내지 않는다.
2. 여러 후보·여러 child random, multi-child fixed, single count override, batch count omission,
   whitespace seed/date-only +09 변환/fixed metadata windowMonths/startedAt+index 및 기존 sampler가 허용하는
   초기-year/extended local label의 B unavailable·실행 호환성을 검증한다.
3. 공유 A field와 알려진 normalization/default/presence가 정확히 대응하고, 현재 env/default로
   과거 snapshot을 재구성하지 않는다. API age86400/direct batch300을 분리한다.
4. 요청과 다른 stored cash/보유 및 generated cash/빈 보유, unavailable 초기 상태를 구분한다.
5. plain object/직렬화 clone/prototype 위조·proxy·accessor context를 먼저 실행하지 않고 거절하며, cross-batch/child/index/time/hash/version/reference,
   snapshot·callback·response mutation이 verified lineage로 승격되지 않는다.
6. 모든 새 write/file-sync/close/directory-open/sync/close 실패, alias/orphan/경합/재시도에서
   provider/tick0·원본/barrier 보존을 검증한다. 기존 early source/settings 중단도 유지한다.
7. legacy/canonical-only/redacted/unsupported·limit·clone·validation/GET mutation0를 검증한다.
   일반 unsupported를 포괄적 실행 금지나 새 권한 요구로 바꾸지 않는다.
8. schema·전체 envelope byte 한도와 정확한 -1/at/+1·민감 자료 합성 경계를 검증한다.
9. B 성공도 runtime/result/완전 input·비교 성공으로 승격하지 않는다.
10. 책임별 Korean commit, 필요한 공식 profile·독립 검토·새 최종 Linux full·자동 review와 실제 GitHub
    보호 조건을 충족한다. PR823 검증은 B backend 변경의 검증이 아니다. branch는 보존한다.

이 문서의 완료는 구현 범위·현재 근거·실패 의미와 검증 기준의 일치다. 제품 코드 구현 전에 독립 검토한다.
