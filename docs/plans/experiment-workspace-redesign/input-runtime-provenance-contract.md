# 입력·runtime/version provenance 후속 계약

기준: PR817 병합 main `55ba85ba8a72b71636f34e1d2a57b93bbdee5fa6`.
이 문서는 승인된 UX06의 선행 저장·조회 계약과 구현 순서를 정한다. 문서 추가만으로 producer,
reader, 새 endpoint, 비교 가능성 또는 화면 기능이 구현됐다고 표시하지 않는다.

## 목적과 현재 근거

생성 요청, 생성 시점의 실효 입력, child가 실제 소비한 입력 및 실행 runtime을 구분한다.
완전한 근거가 없는 실행은 이유를 표시하고, 두 unknown을 동일한 입력으로 취급하지 않는다.
새 입력 수집, 실거래, 유료 AI 실행, EXP CLI를 dashboard에 연결하는 작업은 포함하지 않는다.

| 현재 코드 | 확인한 근거 | 부족한 근거 |
| --- | --- | --- |
| `paperSimulationConfig.ts` | 순수 resolver가 requested/effective/notices를 생성 | 저장된 과거 입력을 현재 resolver로 복원할 수 없음 |
| `paperSimulationRuns.ts` | 같은 effectiveConfig를 runner에 전달하고 응답 | 응답 자체는 durable 입력 증거가 아님 |
| `paperSimulationRequestStore.ts` | canonical 요청, acceptance hash, durable runtime UUID, Node/model version | 전체 effectiveConfig/notices와 Git/source/build/lock 결속 없음 |
| `historicalBatchReplayWorkflow` 및 child metadata/research manifest | child identity, 선택 window, configuration 및 저장 hash | 모든 원래 batch 입력·실제 runtime을 복원하거나 현재 자료와 hash를 검증한 것은 아님 |
| `replayProvenanceProjection.ts` | field별 partial/stored observation | requested/effective/runtime 일부는 항상 not_persisted |
| `paperExperimentRuntime.ts` | 별도 EXP CLI 계열의 source/build receipt 검증 | historical batch/API 실행의 증거로 가져올 수 없음 |

PR816의 whole-batch clone은 canonical 원래 요청 → 현재 validation → 새 ID를 소유한다.
PR817의 benchmark 선택은 URL 표시 상태다. 어느 쪽도 complete execution provenance를 증명하지 않는다.

## 세 종류의 입력과 두 runtime 시점

1. **원래 batch 요청:** 기존 parser가 승인한 requestedConfig를 omission까지 보존한다.
   single_replay의 요청 runCount와 실제 1회, random 추출 범위와 선택된 child window를 구분한다.
2. **접수 시점의 실효 입력:** create에서 실제 runnerInput에 전달한 effectiveConfig와 notices를
   같은 관측 단위로 기록한다. 요청을 다시 resolve하거나 현재 환경·기본값으로 채우지 않는다.
   비용, sampling, risk/allocation/exit, universe의 무필터 의미, provider와 benchmark 정책을 포함한다.
3. **child 소비 입력:** exact child의 선택 window, 실제 읽은 source snapshot, 적용 configuration,
   scope 및 실제 실행 runtime과 연결한다. batch 요청의 source 경로나 manifest hash만으로
   전체 source를 읽었거나 그 자료를 해당 child가 소비했다고 단정하지 않는다.

접수 API runtime과 실제 replay runtime은 별도 관측이다. 주입 runner, 다른 프로세스 또는
runtime 변경이 있으면 API Node version을 child 실행 version으로 복사하지 않는다.
저장소 runtime UUID는 namespace identity이고 Git revision이나 실행 구현 동일성의 증거가 아니다.

## Version과 저장 단위

다음 이름은 후속 구현이 사용할 계약 식별자이며 현재 지원 endpoint/파일 목록이 아니다.

| 단위 | 식별자 | 결속 |
| --- | --- | --- |
| 접수 입력 기록 | `paper_simulation_input_provenance.v1` | exact simulationRunId=batchId, acceptedAt, 기존 canonicalRequestHash, requested/effective 계약 version |
| child 실행 기록 | `replay_input_runtime_provenance.v1` | exact child/batch/runIndex, 접수 기록 hash 또는 명시적 legacy unavailable, 실제 소비 입력·runtime 관측 |
| 조회 DTO | `replay_input_runtime_read.v1` | exact requested child와 검증된 저장 evidence version, field별 판독 상태 |

조회 DTO version, 저장 evidence version, configuration version 및 runtime implementation version은
서로 대체하지 않는다. 알 수 없는 version을 현재 schema로 해석하거나 unknown field를 버려
유효한 예전 계약으로 바꾸지 않는다. 버전별 parser는 raw 존재 여부와 정확한 shape를 확인한다.
schema default가 생성한 값은 recorded가 아니다. 현재 계산값으로 과거 record를 migration하지 않는다.

기존 canonical request v1과 accepted 관측 v1은 기존 읽기·clone 의미를 유지한다. 새 접수 입력의
hash를 acceptance에 결속할 때는 해당 accepted schema의 명시적 확장과 legacy 호환 검증을 함께 한다.
옛 accepted event에 새 hash가 없으면 그 추가 증거만 unavailable이며 기존 canonical clone을
자동 차단하거나 새 hash를 보충하지 않는다. 변경 전 reader가 새 기록을 처리할 수 있다고 가정하지 않는다.

## Producer와 durable 순서

- 접수 입력은 서버가 한 번 resolve한 값과 실제 runnerInput에서 만든다. HTTP body/header의
  runtime/hash/verification 주장이나 임의 JSON을 증거로 받아들이지 않는다.
- exclusive ID 예약 → canonical 및 접수 입력 기록의 write/fsync/디렉터리 sync → 두 기록의
  hash와 결속된 durable accepted 이벤트 → 202/runner dispatch 순서를 지킨다.
- 새 기록을 저장하는 producer 경로에서 저장·결속 실패는 503/runner0이다. 남은 ID barrier,
  기록이나 원본 실행은 삭제·재사용하지 않는다. validation/GET은 파일을 생성하거나 복구하지 않는다.
- 관측할 수 없는 runtime은 typed unavailable과 이유로 저장할 수 있다. 이는 파일 쓰기 실패를
  무시한다는 뜻이 아니며, create 접수 성공을 complete provenance 성공으로 승격하지 않는다.
- child 증거는 실제 runner의 소비 경계에서 작성한다. source snapshot/설정은 실행 전 고정한
  내용과 실제 소비 내용을 결속한다. 실행 뒤 현재 파일만 hash해 과거 실행 입력이라고 표시하지 않는다.
- 완료 전 손상·누락·중단·범위 초과가 있으면 complete child evidence를 발행하지 않는다.
  이 상태는 실행의 completed/failed와 별도다. 실행 결과를 새 증거 부재 때문에 다시 실행하지 않는다.

## Runtime과 입력 fingerprint의 의미

runtime complete에는 실행한 구현 revision, source/build 결속, dependency lock digest, 실제 Node와
execution model version이 필요하다. Git HEAD와 디스크 파일을 관측한 것만으로 이미 로드된 코드의
동일성을 주장하지 않는다. producer/launcher는 실행 전 검증한 receipt와 실제 process/runner를 결속해야 한다.
source dirty, receipt missing/mismatch, compiled 파일 변경, 다른 runner 또는 unknown version이면
해당 runtime은 unavailable이다. 단순 UUID·version 문자열 일치로 complete가 되지 않는다.

input fingerprint는 계약 version과 정규화 규칙, 실제 소비된 source 내용·범위, 적용 설정의
결속을 포함한다. path/preset 이름, 파일 mtime, 보고서 숫자 일치 또는 저장된 hash 하나만으로
같은 source를 증명하지 않는다. 기존 research hash는 재검증 전까지 stored observation이다.
source kind, universe/membership와 scope를 이름에서 추론하지 않고 producer의 검증 가능한 근거만 쓴다.
membership filtering이나 외부 자료 수집 정책은 추가하지 않는다.

대상은 현재 historical replay가 허용한 저장 입력이다. 공식 calendar의 ephemeral/non-exporting
evidence나 그 파생 결과를 새 provenance 파일·hash·DTO로 내보내는 근거가 아니다. 기존 evidence class의
저장·공개 금지 경계는 그대로 유지하며, 허용된 입력만으로 증명이 부족하면 unavailable이다.

해시 결속은 신뢰된 server storage 안의 무결성 검사다. 서명·외부 공증이나 악의적 관리자의
관련 파일 동시 위조 방어를 새로 보장하지 않는다. 근거 없는 verified=true 입력은 받지 않는다.

## Exact child 읽기와 공개 경계

- 기존 bounded identity scan의 exact child/batch/index와 producer directory 결속을 먼저 확인한다.
  batch alias/latest/prefix fallback, 임의 경로 탐색, 다른 EXP 계열 evidence 보충은 없다.
- canonical 요청 읽기와 historical provenance 읽기는 목적이 다르다. clone의 현재 version 호환
  gate를 완화하지 않는다. 과거 관측 조회는 versioned 저장 parser로 읽고 현재 Node와 다르다는
  사실을 표시할 수 있으나, 그 차이를 현재 clone 가능성으로 해석하지 않는다.
- ancestor symlink/junction, regular file/nlink, open 전후 dev/ino/크기/mtime/ctime, UTF-8,
  hash·accepted binding 및 반환 직전 재검사를 유지한다. hardlink·변경·barrier는 fail-closed다.
- scan/read/parse/projection에 하나의 monotonic budget을 적용하고 bytes/record 상한을 둔다.
  새 파일을 더 읽는 만큼 backend 1.5초와 transport 2초의 기존 예산 안에서 한도를 재검증한다.
  부족하면 limit이며 timeout 증가나 background retry로 성공처럼 보이지 않게 한다.
- 요청/실효 입력은 credential/header/env 전체를 포함하지 않는다. 기존 masking 때문에 원본
  완전성이 사라지면 redacted/unavailable이다. 민감 문자열이나 그 개별 추정 hash를 공개하지 않는다.
- 공개 DTO는 version·상태·identity·허용된 scalar/digest만 whitelist한다. 경로, provider/prompt
  출력, raw 오류, 임의 map key·자유 문자열을 전체 JSON으로 내보내지 않는다.
- GET-only/no-store, query 중복·unknown key·unsafe ID 사전 거절과 파일/runner/provider mutation0을 유지한다.

## 비교에 넘기는 판정

field별로 recorded/stored_observation, 검증된 내용 결속, unavailable(reason)을 구분한다.
0·false·명시적 null과 missing을 합치지 않는다. redacted, not_persisted, invalid, blocked, limit,
ambiguous, identity_mismatch, unsupported_version 및 runtime 미검증의 이유를 유지한다.

입력과 runtime이 complete라는 사실만으로 비교 가능한 성과가 되지 않는다. 같은 evidence class,
source·소비 범위, 기간/timezone, universe, scope, provider, 비용, benchmark, policy/implementation
version을 검증해야 한다. 서로 다른 version·범위·source 및 full portfolio/단일 bucket은 자동
동등 비교하지 않는다. 알려진 차이는 차이로, unknown은 불가 이유로 표시한다. 기존 provenance v1의
comparability=unavailable은 새 producer·reader·검증이 실제 연결되기 전까지 유지한다.

baseline1/candidate1–3 UI는 이 계약 뒤 별도 PR이다. 후보 열별 실패를 격리하고 unknown끼리 같다고
표시하지 않는다. 자동 순위·최적화·투자 추천은 추가하지 않는다.

## 구현 순서와 완료 증거

1. **접수 입력 보존:** versioned requested/effective/notices snapshot, actual runnerInput 동일성,
   durable acceptance 결속과 실제 합성 HTTP create. schema/default/omission/비용·환경 변경 회귀 및
   write/fsync/accepted 실패503·runner0, legacy canonical clone 보존을 검증한다.
2. **실제 소비 입력·runtime producer:** process/build receipt와 source snapshot의 소비 결속,
   child identity 및 완료성. dirty/stale build, 다른 runner, source 변경·중단·누락 negatives와
   실제 합성 replay를 검증한다. EXP CLI를 그대로 연결하거나 증거를 가져오지 않는다.
3. **bounded historical read:** exact ID, versioned parsing, hash와 acceptance/child binding,
   masking·path/file 변경·bytes/deadline·GET mutation0, legacy unavailable 및 현재 version과 다른
   과거 기록의 관측/clone 구분을 검증한다. API와 UI parser가 같은 계약을 받는 composition test를 둔다.
4. **비교 UI:** 위 producer/read 계약을 소비해 1+1–3 선택·URL/history/reload, duplicate/self compare,
   불완전 열 격리와 조건 차이를 3viewport/keyboard/axe/console에서 확인한다.

각 기능 PR은 별도 scope와 책임 commit, 한국어 Draft 및 독립 검토 후 최초 Ready 자동 review를
따른다. backend 입력이 바뀌면 PR816의 full4530/0/33을 새 후보로 재사용하지 않는다. 새로운
backend 후보에는 실제 영향 검증과 최종 독립 Linux full이 필요하다. 시간 서비스 중지 승인은 없다.
새 환경의 실제 실패는 코드/환경 근거를 구분하고 성공으로 바꾸지 않는다.

이번 문서 PR의 완료는 위 계약·현재 근거·단계별 검증 경계의 일치다. 코드·저장 artifact·거래 정책을
바꾸지 않으므로 rollback은 문서만 되돌린다. 후속 구현은 기존 artifact를 수정·삭제하지 않고,
기존 reader/clone 경로의 호환성과 새로운 증거의 unavailable 상태를 각각 검증해야 한다.
