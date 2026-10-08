# Child가 소비한 source 배열의 부분 관측 설계

기준 main: `3cbd1ebc8bd959aed3ff3cdf53f1885ed887513a` (PR820).
이 문서는 [입력·runtime 계약](input-runtime-provenance-contract.md) 2단계의 다음 작은 기능을
설계한다. 아직 새 source producer, artifact, endpoint 또는 reader가 구현된 것은 아니다.

## 목적·포함·비범위

목표는 child runner가 실제 소비할 parsed `HistoricalMarketSnapshot[]`를 실행 전에 고정하고,
그 배열과 exact child/초기 상태를 제한된 관측 파일로 결속하는 것이다.

포함은 source 배열의 ownership 격리, 순서·중복·presence를 보존하는 frozen v1 schema,
bounded snapshot/hash, immutable write와 첫 tick/provider 전 내구성, 합성 workflow 검증이다.
입력 파일을 실행 뒤 다시 읽거나 hash해서 과거 소비 입력을 복원하지 않는다.

다음은 비범위다.

- 원본 파일의 byte 보존, 완전한 read history, acquisition/provider 신뢰, historical completeness
- 현재 tolerant `readAll()`을 strict durable-history lease로 교체하거나 source 쓰기를 잠그는 정책 변경
- 전체 configuration, universe, clock/sampling, runtime/dependency, 결과/report의 완전성
- 공개 GET/DTO/UI, EXP CLI 결속, benchmark 계산·표시 정책 변경, membership filtering
- 새 외부 수집, provider/prompt 원문, 공식 calendar의 ephemeral/non-exporting evidence와 파생 결과 저장
- 실제 거래·유료 AI·시스템 시간/보안 설정 변경, 기존 산출물 재작성·자동 복구

## 세 source 단위를 구분한다

| 단위 | 현재 근거 | 이 기능의 표현 |
| --- | --- | --- |
| 원본 JSONL 파일 | `readAll()`은 파일 전체를 UTF-8 문자열로 읽고 blank를 건너뛰며 잘못된 줄을 센다. 파일 부재도 빈 records로 반환한다. | byte/file identity와 read completeness는 unavailable |
| parsed 소비 배열 | workflow가 얻어 plan과 runner에 넘긴 유효 records | 지원 범위 안에서 실제 고정한 배열만 recorded |
| tick별 선택 후보 | index·freshness·screening·allocation·Risk가 소비 배열을 사용해 만든 결과 | 입력 배열 개수와 후보 개수·coverage를 동일시하지 않음 |

빈 records를 관측하면 배열 `[]`의 실제 소비 사실만 보존한다. 원본 파일이 존재했다거나 시장에
자료가 없었다고 추론하지 않는다. `corruptLineCount`는 해당 read 호출의 진단이며 누락된 내용,
정확한 전체 source coverage 또는 strict parsing 성공을 증명하지 않는다. 손상 줄 원문은 저장하지 않는다.

`FileHistoricalMarketSnapshotStore.withDurableVerifiedHistory()`에는 별도의 lock·strict history·
내용 재확인·lease 계약이 이미 있다. 단순 `readAll()` 결과에 그 이름이나 관측 hash를 붙이지 않는다.
해당 lease를 오래 유지하거나 읽기 정책을 바꾸려면 별도 scope와 호환성 검증이 필요하다.

## Ownership과 실제 소비 결속

1. 지원 범위 preflight 후, runner 진입 시 첫 await 전에 private source copy를 만든다.
   배열과 각 record의 중첩 배열을 모두 분리한다. 관측 callback에도 별도 copy를 주며 caller나
   callback 변경이 실제 replay에 들어가지 않도록 한다.
2. index, mark-to-market 경로, market regime allocation 및 exit/provider 결정의
   `riskPolicyForReplayTick`가 모두 같은 고정 source를 사용한다. index만 복사하고 다른 경로에
   `input.snapshots`를 남기는 구현은 완료가 아니다.
3. 순서·중복을 보존한다. input snapshot을 미리 정렬·deduplicate·window slice하거나 missing
   optional 값을 null/빈 배열/0으로 채우지 않는다. 동일 시각·symbol·snapshotId의 tie에서 순서가
   결과에 영향을 주는 경우도 별도 회귀로 고정한다.
4. 이후 caller 배열/record 교체, callback 내부 변경, source 파일 교체가 실행 중 private copy나
   관측 hash를 바꾸지 못함을 실제 packet/가격·allocation/Risk 소비 결과로 검사한다.
5. 지원 밖 입력은 억지로 요약 snapshot을 만들지 않는다. `unavailable`과 이유만 기록하며
   source가 고정됐다고 주장하지 않는다. 기존 replay 입력 허용 범위를 이 관측 상한으로 축소하지 않는다.

## v1 snapshot에 보존할 필드

현재 [historicalMarketSnapshotSchema](../../../src/domain/schemas.ts)의 실제 parsed 필드를
빠짐없이 보존한다. 별도 v1 parser는 default/coercion/trim을 하지 않고 unknown field를 거절한다.

- identity/분류: `snapshotId`, `market`, `symbol`, optional `name`, `assetType`, `assetClass`,
  `region`, `riskTags`, `strategyBucket`, `sector`
- 시점/주기: `observedAt`, `interval`, `createdAt`
- 가격/거래량: optional `openPriceKrw`, `highPriceKrw`, `lowPriceKrw`, `closePriceKrw`,
  필수 `lastPriceKrw`, optional `volume`
- 참조: `sourceRefs`의 원래 배열과 순서

필드별 변화와 optional omission/명시 0/빈 optional 배열을 fingerprint 회귀에 넣는다.
snapshot identity나 sourceRefs에 replay-ID 전용 masking 예외를 확장하지 않는다.
JSON으로 값을 정확히 보존할 수 없는 명시 `undefined`, `-0`, nonfinite number, 잘못된 Unicode나
지원하지 않는 객체는 `unsupported_shape`다. 직렬화가 값을 바꾼 뒤 recorded/hash를 만드는 대신
사전 검사에서 구분한다. 이미 source parser가 정규화한 값과 파일의 원래 byte는 계속 별개다.

## 제안하는 관측 상한과 unavailable

아래 값은 새 관측 파일의 v1 engineering 한도다. 시장 coverage나 기존 replay의 지원 크기가 아니다.
구현 PR에서 경계·메모리 검증 후 상수와 문서를 함께 고정하며, 변경하면 검증을 다시 수행한다.

| 경계 | v1 제안 | 이유와 확인 |
| --- | --- | --- |
| records | 50,000개 | 배열 전체 clone 전에 개수를 거절하고 CPU/메모리 사용을 유한하게 함 |
| snapshot UTF-8 JSON | 16 MiB | 장기 원본 dataset 전체 복제를 보장하지 않는 bounded 관측. 정확한 byte 경계와 직렬화 메모리 측정 필요 |
| 일반 식별/분류 문자열 | 120자, 시간 80자 | portfolio 관측의 bounded string 원칙과 맞추되 값은 잘라 저장하지 않음 |
| record별 sourceRefs | 128개, 각 512자 | 원본 참조의 임의 확장을 제한. 한도 초과는 전부 unavailable |
| riskTags | 32개 | 기존 enum은 유지하고 중복 제거로 입력을 바꾸지 않음 |

record/필드 상한을 먼저 검사하고 record 단위로 byte budget을 누적한다. 전체 입력을 무제한
`JSON.stringify`/deep clone한 뒤 한도를 검사하는 구현은 허용하지 않는다. 빈 배열은 한도 안의 실제
소비 상태다. 새로운 한도가 기존 API create/runner 입력 거절 조건을 암묵적으로 바꾸면 안 된다.

`unsupported_shape`, `redacted`, `limit`, `retention_unavailable`은 snapshot과 개별 내용 hash 없이
구분한다. masking이 필요한 내용은 전체 snapshot/hash를 만들지 않는다. 이 관측이 저장을 허용하는
대상은 기존 계약상 허용된 stored market input뿐이다. 공식 calendar의 non-exporting handle/파생
자료를 sourceRefs나 다른 DTO로 포장해 허용하지 않는다. 식별 문자열로 source kind나 보존 권한을
추론하지 않는다. 구현 시 허용된 저장 입력인지 확인할 수 없는 경로는 `retention_unavailable`이어야 한다.

## 저장 단위·순서와 초기 상태 결속

구현용 제안 이름은 `historical-replay-source-observation.json`,
`replay_source_observation.v1`, `replay_source_snapshot.v1`이다. 현재 지원 artifact 목록이 아니다.

- strict envelope는 exact runId/batchId/runIndex, 시작 시각, 동일 child reservation hash,
  실제 생성한 초기 portfolio observation의 version/content hash 및 source 관측 상태를 결속한다.
  초기 portfolio가 unavailable이면 그 정확한 상태를 결속하고 complete input을 만들지 않는다.
- 기존 초기 observation의 `source=unavailable`을 나중에 바꾸지 않는다. 새 source 파일은 별도
  immutable 부분 관측이며, 둘의 연결과 전체 완전성은 후속 reader가 따로 검증한다.
- source 파일 또는 orphan이 이미 있으면 기존 child 예약의 초기 preflight에서 거절하도록
  출력 존재 검사를 확장한다. 기존 report/metadata/log 보존 및 협조 writer 경합 규칙을 유지한다.
- source copy 고정 → 기존 reservation과 상위 directory sync → 초기 관측의 내구성 완료 →
  source 관측 exclusive write/file sync/directory sync → 첫 runner tick/provider 순서다.
  source 파일 쓰기가 실패하면 provider0, 기존 초기 관측/예약/부분 파일은 삭제·재사용하지 않는다.
- 참조 hash는 같은 writer가 실제로 생성한 초기 observation 값에서 얻는다. 완료 뒤 현재 파일을
  읽고 연결을 보충하거나 원래 research manifest hash로 대체하지 않는다.
- typed unavailable 기록 자체의 write/sync 실패도 실행 차단이다. 파일만 남은 상태를 durable
  성공으로 읽지 않으며 새로운 complete/available reader를 이 기능에 추가하지 않는다.

configuration, acquisition, file identity/read completeness, runtime, dependencies, result 및
comparability는 계속 unavailable이고 `completeInput=false`다. source 배열의 recorded만으로
실행 성공·재현 가능성·AI 결정 동일성·통제된 metric 비교를 주장하지 않는다.

## 구현 PR의 필수 완료·검증표

1. 실제 합성 child에서 snapshot과 모든 source 소비 경로가 같은 private copy임을 검증한다.
   caller/callback/파일의 실행 중 mutation, 배열 재정렬·중복·nested refs와 Risk 경계를 포함한다.
2. 모든 필드와 omission/0/빈 배열의 hash 구분, strict version/unknown/invalid 및 각 상한의
   경계 전후를 시험한다. unsupported/redacted/retention 상태는 snapshot/hash를 남기지 않는다.
3. 초기 상태와 source의 exact child/예약/hash 연결, 혼합 child·초기 상태 변경 negatives를 둔다.
4. write/file sync/directory open/sync/close 실패의 provider0과 원본/barrier 보존을 검증한다.
   기존/orphan/alias/동시 요청·완료 후 재시도 거절도 유지한다.
5. `readAll()`의 missing/empty/blank/corrupt 진단을 구분하되 내용이나 완전성을 발명하지 않는다.
   raw source 경로·오류·민감 값과 non-exporting evidence를 새 파일/공개 DTO로 내보내지 않는다.
6. 초기 portfolio 관측, 기존 research manifest, 원래 batch clone/create 및 standalone/legacy의
   의미가 유지되는 회귀를 포함한다. 새 source 관측으로 완전성 또는 비교 status가 바뀌지 않는다.
7. scope/diff/안전/문서 자체 검토와 관련 시험, exact 후보의 독립 검토 및 공식 Linux full을
   완료한 뒤 Draft·자동 review·현재 보호 조건으로 게시/병합한다. 환경 실패는 별도 보존한다.

이번 문서 PR의 완료는 실제 소스의 소비 경로·field·순서와 위 경계를 대조한 검토 가능한 설계다.
retention 판정 경로와 한도 측정이 미정인 채 producer 구현을 완료했다고 표시하지 않는다.
