# Paper simulation 접수·runner 실패 관측 계약

UX-02b는 `POST /paper/simulations`로 접수한 batch의 최소 관측만 저장한다.
Runner가 manifest 생성 전에 reject해도 접수 응답의 exact ID로 실패 근거를 찾을 수 있다.
UI, scheduler, heartbeat, 자동 retry·recovery·resume·cancel, live trading, 유료 AI 실행,
새 credential·비용·benchmark·universe 정책은 추가하지 않는다.
입력·실효 조건은 [기존 계약](paper-simulation-config.md)을 유지한다.

## 저장 원본과 의미

원본은 `batch-replay/<simulationRunId>/paper-simulation-observations.jsonl` 한 개다.
`simulationRunId=batchId`이며 batch 내부 개별 `runId`가 아니다.
기존 manifest, run log나 audit log에 접수 event를 이중 기록하지 않는다.

허용 event는 strict `schemaVersion=paper_simulation_observation.v1` 두 종류다.

- 첫 줄 `event=accepted`: `simulationRunId`, 같은 `batchId`, `acceptedAt`
- 선택적 둘째 줄 `event=runner_failed`: 같은 identity와 첫 줄의 `acceptedAt` 참조,
  `observedAt`, 고정 `reasonCode=runner_rejected`

원본 오류 message·stack·cause, provider output, 환경변수와 절대 경로는 저장·반환하지 않는다.
Accepted의 입력 seed를 포함하는 기존 ID 형식은 그대로 유지한다.
접수만 존재하면 `outcome=unknown`이다. 실행 중·실패·완료를 추론하지 않는다.
`runner_failed`도 runner promise가 reject했다는 관측이며 batch 내부 개별 run의 상태를 덮지 않는다.
정상 완료·부분 결과·skipped는 계속 기존 manifest/run artifact만 증거로 사용한다.
Runner가 resolve했다고 새 completed event를 만들지 않는다.

## 접수 순서와 충돌

1. 기존 guard와 side-effect-free config resolver를 통과한다.
2. 첫 await 전에 options 객체별 WeakMap token을 예약한다. 같은 options의 경합은 기존
   `paper_simulation_already_running` 409다. 자기 token과 일치할 때만 해제한다.
3. 기존 timestamp millisecond + 정규화·32자 제한 seed ID를 만들고 output directory를
   non-recursive exclusive `mkdir`로 확보한다. 기존 directory는 비어 있어도
   `paper_simulation_id_conflict` 409이며 log·manifest·run bytes를 바꾸지 않는다.
4. 새 directory의 부모 entry를 sync한 뒤 기존 `JsonlStore.appendDurably`와
   paper execution log lock으로 accepted write·file fsync·close·directory sync를 끝낸다.
5. append lock이 풀린 뒤 runner를 dispatch하고 202를 반환한다.

accepted 저장 실패는 고정 `paper_simulation_admission_failed` 503이며 runner를 호출하지 않는다.
확보한 directory, 부분 bytes와 실패 lock은 명시적 barrier로 남기고 삭제·재사용하지 않는다.
Directory 확보 전 실패는 아직 접수된 ID가 아니다. ID 재시도는 자동 복구가 아니다.
서로 다른 process의 동일 ID는 exclusive directory에서 한 요청만 통과한다.
다른 ID/다른 options 사이에 전역 동시 실행 제한이나 cross-process scheduler는 없다.

Runner의 sync throw와 async rejection을 같은 방식으로 처리한다. failure 기록도 단일 log
lock 아래 accepted identity를 재확인한 뒤 append한다. 기록이 실패해도 unhandled rejection이나
자동 재시도를 만들지 않는다. 쓰기 전 실패하면 기존 accepted/unknown이 남는다. partial write,
fsync/close 또는 lock release 실패로 barrier가 남으면 조회는 `unavailable`이며 실패 관측을
확정하지 않는다. 저장이 불완전한 상태를 정상 prefix나 성공한 transaction처럼 설명하지 않는다.

## Exact-ID 조회와 호환성

`GET /batch/replay/runs?runId=<accepted simulationRunId>`의 additive 필드
`simulationObservation`은 manifest가 없어도 조회된다. HEAD도 동일한 read-only 경로를 사용한다.

- `status=available`: schema version, exact identity, `acceptedAt`, `outcome`,
  `runnerFailure`(없으면 null, 있으면 `observedAt`/`reasonCode`)만 반환
- `status=missing`: observation 경로나 file이 없음
- `status=invalid`: identity 문법 또는 전체 log 내용이 잘못됨
- `status=unavailable`: 읽기 오류, alias, 조회 중 원본 변경 또는 남아 있는 writer barrier
- runId query가 없으면 `simulationObservation=null`

HTTP routing은 legacy run 선택용 trim된 ID와 관측용 원시 `searchParams.get("runId")` 값을
분리한다. 관측은 URL decoding 1회 뒤의 값을 정규화·trim·truncate하지 않는다. Query 누락은
null이고 명시적 empty·공백·newline 및 percent-encoded 공백 alias는 invalid다.
exact 허용 ID만 경로로 사용하며
manifest/aggregate의 임의 source path에서 log를 찾지 않는다. legacy·개별 run ID는 새 접수 ID가
아니므로 `invalid`일 수 있으나 기존 detail 조회는 유지된다. 기존 `runs`, `selectedRun`,
`latestRunArtifacts`, status/count, manifest 선택과 aggregate fallback은 변경하지 않는다.
Aggregate fallback에서 관련 없는 개별 run detail을 선택하지 않는 기존 exact-ID 동작도 유지한다.

최대 두 줄의 전체 파일을 검증한다. torn 마지막 줄, corrupt JSON/UTF-8, strict schema 위반,
잘못된 identity/reference, 중복, 순서 역전, 역행 timestamp, 추가 event와 4KiB 초과는 정상
prefix로 복원하지 않는다. Reader는 mkdir·lock 획득·fsync·repair·migration을 수행하지 않는다.
재시작은 저장된 관측만 다시 읽으며 runner를 재개하지 않는다.

## Filesystem 보장과 제한

새 관측 경로의 모든 directory component는 symlink가 아닌 directory여야 한다.
Log는 symlink/hardlink가 아닌 단일 regular file이며 descriptor/path identity와
읽기 전후 size·mtime·ctime을 대조한다. Alias가 포함된 설정은 canonical 경로로 운영해야 한다.
존재하는 output directory와 old artifact는 migration 없이 유지한다.
기존 sourceDataDir의 lexical `data` 경계와 source 검증 수준은 입력 계약 그대로다.
이 관측 기능은 source dataset의 존재·symlink·coverage·품질을 새로 인증하지 않는다.

새 부모 directory도 필요한 경우 생성 순서마다 상위 directory entry를 sync한다.
Durable append와 admission은 기존 저장소와 같이 Windows directory open/sync의 `EPERM`만
unsupported로 허용한다. Windows directory fsync 지원이나 전원 장애 시 완전한 metadata
내구성을 새로 보장하지 않는다. Linux에서 실행한 테스트를 Windows 실측으로 보고하지 않는다.
협력 writer와 신뢰하는 로컬 filesystem을 전제로 하며 악의적인 동시 namespace 교체를 막는
OS handle lease, DB transaction, atomic completion receipt나 자동 stale lock takeover가 아니다.

일반 runner의 recursive runsDir 생성과 runs/selection·derived report 초기화는 새 log와
공존한다. 별도 `validationRoleRegimePlan`의 outputAbsent admission에는 적용하지 않는다.

## 검증·롤백

Tests는 credential-free synthetic fixture와 fs fault injection으로 pre-202 순서, no-effect guard,
동시 접수, process 간 동일 ID 충돌, 모든 원본 손상, no-secret 기록, restart unknown,
GET/HEAD 무변경과 기존 정상 fixture/조회 회귀를 확인한다. 검토 중 `git diff --check`,
`npm run check:review`, 최종 후보에는 기존 전체 gate를 적용한다.
코드 rollback에 artifact 변환은 필요 없지만 새 접수 관측 조회·충돌 방어가 없어지므로
이전에 만들어진 같은 ID directory를 재사용하지 않도록 주의한다. 이 PR은 원본/barrier 삭제나
복구 도구를 제공하지 않는다.
