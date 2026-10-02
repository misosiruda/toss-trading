# 단일 paper 실험 기술 설계

## 상태와 결정

[기획](product-plan.md)을 구현하기 위한 설계이며 아직 구현된 계약이 아니다.
코드 관찰 기준은 `bc1423bd992171cf86b5c5d288e9c1c915cc2333`이다.
구현 순서·검증 명령은 [PR 작업 계획](pr-work-plan.md)에 둔다.

- 실행점: `runHistoricalReplayWorkflow`를 직접 호출하는 fixture 전용 adapter
- 입력: 기존 schema/config를 조합한 작은 versioned JSON, normalized full payload 보존
- 식별: 기존 `createReplayResearchHash`/`ReplayResearchManifest` 재사용, attempt identity와 분리
- 저장: 새 attempt 전용 빈 디렉터리. source·공유 portfolio·기존 batch 디렉터리를 사용하지 않음
- 검토: 기존 report/audit를 읽는 projection과 한국어 파일 보고서, 새 추론/매매 engine 없음
- 외부 연결: 없음. CLI만 추가하며 기존 HTTP/Dashboard/MCP API는 변경하지 않음

`paperSimulationRuns`의 full config 경로는 참고하되 그대로 호출하지 않는다. 현재 adapter는
`costModel`/`benchmarkPolicy`를 schema로 받지만 workflow 인자로 전달하지 않으며,
`wallClockTimestamps: true`와 메모리 `WeakMap`을 쓴다. 이 표시값을 실제 적용된 정책 또는
재시작 안전성으로 설명하지 않는다. 이번 범위에서 그 기존 API를 함께 수리하지 않는다.
`strategyBucketTestRuns`도 queued record만 저장하므로 실행 입력/queue로 사용하지 않는다.

## 1. 입력 계약과 정규화

새 `PaperExperimentInput`은 별도 trading config 모델이 아니라 아래 기존 계약의
직렬화 가능한 composition이다. 파일명·type명은 구현 PR에서 확정하되 필드 의미는 유지한다.
외부 JSON은 strict parsing하며 unknown field를 조용히 버리지 않는다.

| 입력 묶음 | 보존 내용과 기존 정본 | v1 제한 |
| --- | --- | --- |
| identity | `schemaVersion`, experiment question, fixture ID/version, implementation revision | fixture-only임을 literal로 고정, 실험 ID를 성능 순위로 사용하지 않음 |
| source | `HistoricalMarketSnapshot[]`, 고정 fixture provenance/sourceRefs, source coverage 설명 | inline synthetic records만, URL/CLI/provider/module path 불가 |
| universe | 기존 `HistoricalUniverseManifest` 또는 동일 schema의 fixture universe | 모든 source symbol의 membership 명시, 실제 broad universe 주장 금지 |
| window | 기존 clock/sampling configuration | explicit UTC start/end, step, frequency, max calls, fixed timezone; random/window sampler·session 비범위 |
| initial state | `initialCashKrw`, 빈 positions | 기존 portfolio 복원·실계좌 입력 금지 |
| policy | 기존 run configuration의 constraints, resolved Risk/allocation, normalized exit policy | 모든 effective 값 고정, v1 exit/regime 확장 비활성 |
| execution/cost | `createPaperExecutionPolicy`가 만든 full policy, `createPaperCostModel` 버전·가정 | fee/tax/slippage 등을 숫자로 명시, `standard` 문자열만 저장하지 않음 |
| provider | 기존 deterministic first-priced fixture의 ID/version와 metadata | 외부 AI calls 0, model/schema 경로·환경변수 provider 전환 불가 |
| evaluation | evidence cutoff, `cashOnly` primary benchmark, review 질문과 한계 | 비용 동등한 전략 비교/통계적 유효성 주장 불가 |

기존 `historicalReplayRunConfigurationSchema`, `historicalMarketSnapshotSchema`, universe parser,
Risk profile resolver, execution/exit normalizer를 사용한다. 기존 config schema가 허용하는 값 중
v1에 필요 없는 값은 좁혀 reject한다. 중복 Zod policy 정의나 다른 hash canonicalizer를 만들지 않는다.

정규화 순서:

1. 파일 byte limit를 먼저 검사하고 JSON/schema·정확한 version·fixture ID를 검증
2. timestamp를 명시적 timezone이 있는 ISO UTC로 정규화. 로컬 날짜 추정/현재 시각 fallback 금지
3. Risk/allocation/exit/execution의 default를 기존 resolver로 한 번만 채워 full effective 값 보존
4. snapshot은 market/symbol/observedAt/snapshotId 순서로 정렬. 중복 snapshot ID와 동일
   market/symbol/observedAt의 충돌을 reject. 배열 순서에 의미가 있는 decision 항목은 임의 정렬하지 않음
5. 모든 숫자의 finite/range와 예상 tick 수를 검증한 뒤 normalized plain JSON 생성
6. 기존 `createReplayResearchHash(normalizedInput)`로 `inputHash` 계산. 이 값은 입력 envelope
   식별용이며 기존 replay `configHash`/`riskPolicyHash`를 대체하거나 같은 값이라고 주장하지 않음

v1 자원 한도는 입력 2 MiB, snapshot 100개, universe symbol 10개, tick 100개,
fixture decision call 100회다. step은 최소 60초, end ≥ start를 요구한다. tick 수는
`clock.ticks()`를 만들기 전에 산술로 한도를 검사한다. source·tick·call 한도는 서로 별개다.
`session`은 현재 replay run config에 전부 저장되지 않으므로 v1에서 명시적으로 reject한다.
경로·사용자 이름·secret/raw input은 validation error에 그대로 출력하지 않는다.

첫 golden fixture는 `KR:FIXTURE_A` 같은 가상 symbol, 3개 synthetic 일별 snapshot,
고정된 3 tick·빈 portfolio·1,000,000 KRW 가상 현금으로 충분하다. 거래일/calendar/FX의
사실성을 주장하지 않으며 정확한 값은 EXP-01의 tracked fixture와 테스트로 확정한다.
이는 실제 한국 시장/투자 전략을 선택한 결정이 아니다.

## 2. Provenance, cutoff와 coverage

`sourceDataDir` 문자열이나 hash만으로 입력을 복원하지 않는다. admission이 한 번 읽고
검증한 records를 normalized input에 포함하여 보존하고, 그 동일 records만 workflow용
snapshot 파일로 materialize한다. 실행 중 원래 mutable source 경로를 다시 읽지 않는다.
입력의 sourceRefs는 fixture provenance에만 연결되고 실제 외부 source와 혼합하지 않는다.

- evidence cutoff는 이 실험에서 허용한 source의 최종 `observedAt` 상한이다.
  그 뒤의 row는 admission 실패. 최초 tick 이후이지만 cutoff 이하인 row는 정상 시계열이며
  각 tick에서 기존 `HistoricalMarketSnapshotIndex`의 observedAt/freshness guard를 따른다.
- `createdAt`은 fixture artifact 생성 provenance다. `observedAt`과 구분하며 실제 시장의
  publication/availability 시각을 보증하지 않는다. point-in-time source 신뢰도를 승격하지 않는다.
- 입력 admission은 missing/empty/corrupt row, 알 수 없는 symbol, 누락된 sourceRef,
  중복·불일치 universe, 뒤집힌 날짜를 실패로 처리한다. 기존 `JsonlStore.readAll()`의
  skip-line-and-count 관용 정책만으로 실험을 시작하지 않는다.
- 필요한 tick에 fresh 가격이 없는 경우는 source coverage 경고/`insufficient_data`다.
  strategy HOLD나 Risk rejection으로 바꾸지 않는다. 전 tick에서 사용 가능한 source가 없는
  입력은 preflight 거절하며 일부 결측은 counts/시각·제외 사유를 보존한다.
- direct workflow에는 batch/CLI의 전체 availability/calendar/FX gate가 자동으로 들어오지 않는다.
  이 slice는 synthetic mechanics 검증으로 한정하며 exchange-session, FX, lifecycle의 실제
  coverage와 수집 적법성은 검증하지 않았다고 항상 표시한다.

## 3. 입력·실행 식별과 artifact 계약

저장 구조의 논리적 예시는 다음과 같다. 경로는 adapter가 정하고 입력 JSON에서 받지 않는다.

```text
data/paper-experiments/<attemptId>/
  input/experiment-input.json
  input/historical-market-snapshots.jsonl
  experiment-run.json
  replay/<기존 createStoragePaths의 manifest, metadata, progress, report, JSONL logs>
  review/paper-experiment-review.json
  review/paper-experiment-review.md
```

`attemptId`/`runId`는 실행별 identity, `inputHash`는 같은 조건의 identity다.
생성·시작·종료 wall-clock 시각과 실제 artifact path는 attempt 기록에 남기고 inputHash에서 제외한다.
`packetIdPrefix`와 workflow `generatedAt`은 normalized input의 고정 값에서 결정한다.
재실행마다 prefix를 바꾸면 기존 configHash까지 바뀌므로 attempt ID를 prefix로 쓰지 않는다.
기존 manifest의 hash 계산 내용·version은 변경하지 않는다.

`experiment-input.json`은 hash 계산의 원문인 정규화된 전체 payload이고 새 연구 manifest가 아니다.
`experiment-run.json`은 inputHash, attempt/run ID, parentAttemptId(명시적 retry만),
단계·종료 원인, 기존 manifest reference와 제한된 상대 artifact 경로를 연결하는 얇은 기록이다.
매매·잔고·결정은 이 파일에 재구현하지 않는다. 기존 replay manifest·audit·report가 해당 근거의 정본이다.

입력 immutability는 exclusive create와 이후 갱신 금지로 보장하는 애플리케이션 계약이다.
OS 보안 권한을 바꾸거나 임의의 외부 writer로부터 보호되는 보안 저장소라고 주장하지 않는다.
실행 전/완료 전 입력과 materialized source의 hash를 재검증한다. mismatch는 성공 종료 불가다.
기존 manifest hash는 workflow가 실제 사용한 normalized config/data에 대해 계산하고,
입력→실제 options→manifest 대응을 테스트한다. 현재 private manifest 정규화 함수를 공유해야 하면
기존 hash 결과를 유지하는 최소 추출만 허용한다.

재현성 비교는 같은 inputHash, 코드 revision, dependency/Node 기준에서 수행한다.
기존 manifest의 config/data/universe/coverage/prompt/schema/risk/cost hash와 packet·decision·
Risk·trade·portfolio의 semantic payload가 같아야 한다. attempt/run identity, 파일 경로,
운영 timestamp, 측정 duration만 명시적 whitelist로 제외한다. 지표·비용·사유·sourceRefs를
제외하거나 모든 report byte가 동일하다고 주장하지 않는다.

## 4. 저장 격리와 실행 adapter

1. 입력 preflight를 통과한 뒤 고정 storage root 아래 backend가 새 attempt 이름을 할당
2. attempt directory를 exclusive 생성. 이미 있는 이름은 내용과 상태에 관계없이 충돌 실패
3. input과 초기 lifecycle을 exclusive 기록한 뒤 그 안의 빈 `replay/`만 workflow에 전달
4. normalized records를 attempt 내부에 고정. 외부 source·공유 root와 겹치거나 symlink를
   통과하는 경로는 reject하고 입력에서 absolute/traversal/output path를 받지 않음
5. 기존 `SimulatedClock`, `ReplaySamplingPolicy`, fixture provider를 구성하여
   `runHistoricalReplayWorkflow` 호출. Risk/sizing/fill·report 계산은 기존 구현 그대로 유지
6. 결과 manifest/report와 요구된 logs의 schema·identity·input 대응을 확인한 뒤 terminal 기록

기존 workflow는 `storageBaseDir`의 `virtual-portfolio.json`을 읽어 요청 cash보다 우선한다.
따라서 기존 저장소를 재사용하거나 source directory를 output으로 넘기는 것은 금지한다.
생성된 replay dir가 비어 있지 않으면 시작하지 않는다. 이전 portfolio를 검사하여 지우는 식으로
정리하지 않는다. batch wrapper는 같은 batchId에서 일부 artifacts를 truncate/remove하므로
이번 adapter에서 호출하지 않는다.

운영 중 mutable status는 단일 owner가 같은 directory의 temp+rename으로 원자 교체하고,
`completed`는 필수 artifact 검증 후 마지막에 쓴다. 이 계약은 기존 replay의 모든 JSONL write를
transactional 또는 power-loss durable하게 바꾸지 않는다. torn/missing artifact는 검토 시
`incomplete`로 표시하고 성공으로 추측하지 않는다. source·이전 attempt의 bytes는 변경하지 않는다.

## 5. 종료, 중단, 재시작과 취소

execution 상태와 result quality는 별개다. workflow의 `completed`는 모든 판단 성공이나
유효한 연구 결과를 뜻하지 않으며 provider failure/packet skip이 포함될 수 있다.

| 상황 | attempt 상태/quality | 보존 및 재실행 동작 |
| --- | --- | --- |
| schema/cutoff/size preflight 실패 | attempt 없음, validation error | runner 호출 0, 공유 저장소 변경 0 |
| 입출력 준비·recorder start 실패 | `failed`, incomplete evidence | 가능한 실패 기록과 생성된 파일 보존 |
| 정상 tick 종료·artifact 검사 성공 | `completed`, `usable_fixture` 또는 `insufficient_data`/`provider_failure` | 투자 성공 판정이 아님 |
| 명시적 HOLD | `completed`, no-trade reason | decision과 필요한 Risk/no-op 근거 보존 |
| Risk 거절 | `completed`, risk-denied observation | 실제 rejectCodes와 no-fill 보존 |
| runner throw·artifact 불일치 | `failed`, partial/unavailable | report가 일부 있어도 완료로 표시하지 않음 |
| 협력적 취소 확인 | `cancelled`, partial evidence | 취소 전에 확정된 paper evidence 보존, rollback 주장 금지 |
| 강제 종료·crash/terminal marker 없음 | 읽기 projection `incomplete`, 저장된 마지막 상태도 함께 표시 | 자동 resume·status 덮어쓰기·파일 삭제 금지 |

outer owner는 workflow 호출 전체를 try/catch로 감싼다. 현재 workflow의 manifest/progress/audit
시작 write가 내부 try보다 앞에 있으므로 내부 실패 recorder만 믿지 않는다. 실패 기록까지
쓸 수 없으면 CLI의 nonzero exit와 partial path를 알리고 completed marker를 만들지 않는다.

취소는 EXP-03에서 기존 workflow/runner에 optional cooperative signal을 추가한다. 기본 호출의
동작은 그대로다. tick 시작, provider 전후, 각 execution 전, 최종 완료 commit 직전에 확인한다.
취소 관측 뒤에는 새 decision/fill을 시작하지 않으며 진행 중인 동기 fill을 반쯤 rollback하지 않는다.
취소 acknowledgement는 runner가 멈추고 종료 기록이 저장된 뒤에만 한다.
완료 commit 뒤의 취소는 기존 완료 상태를 보존하는 already-terminal 응답이다.

기존 replay progress/audit schema는 `running/completed/failed` 중심이다. v1에서 이를 일괄
확장하지 않고 typed cancellation을 기존 실패 기록에도 남기며 outer attempt가 `cancelled`와
원인을 명시한다. reader는 이 둘을 함께 표시하고 historical `failed`를 숨기지 않는다.
강제 kill은 cooperative cancel 성공으로 표시하지 않는다.

재시작 시 read/inspect는 기존 artifact를 읽기만 한다. terminal marker 없는 실행을 timeout/PID
추정만으로 완료·취소라고 고치지 않는다. 실행 중인지 입증할 수 없으면 incomplete/unknown이다.
명시적 retry만 같은 고정 입력으로 새 attempt를 만들고 parentAttemptId를 남긴다. 기존 attempt를
다시 열어 append/resume하지 않는다. 자동 retry, overwrite, 공유 잔고 사용은 없다.
동일 attempt 동시 시작은 하나만 생성되며 서로 다른 attempt는 완전히 독립한다.

## 6. 결과 검토 계약

`PaperExperimentReview`는 입력·attempt·기존 report/audit의 read-only projection이다.
필수 파일 누락/잘못된 identity/hash/깨진 JSONL을 0건으로 바꾸지 않는다. report 생성기가 결과를
고치거나 재실행하지 않으며 raw filesystem path를 신뢰해 attempt 밖의 파일을 열지 않는다.

보고서 순서:

1. 질문과 fixture-only 경고, inputHash/attempt/코드 기준, execution 상태와 evidence quality
2. window/cutoff/provenance·coverage와 실제 적용된 Risk/allocation/exit/execution policy
3. packet → decisionHash/항목 → Risk rejectCodes 또는 허용 → trade/portfolio 근거
4. HOLD, no candidate, sampling skip, provider failure, Risk denial을 각각 표시
5. 기존 비용 breakdown, cashOnly primary comparison, 보조 benchmark의 명시적 한계
6. 동일 inputHash의 다른 attempt와 semantic 비교 결과(선택), 불일치하면 비교 불가 사유
7. 근거가 있는 관찰, 결론낼 수 없는 점, 다음 검증 질문. 자유형 AI 호출·추천 문구 없음

기존 benchmark는 replay packet/timeline만 사용한다. cashOnly는 no-trade이므로 비용 0이고,
동일 초기 현금·tick을 비교한다. equal-weight/initial-hold는 현재 cost 0, 일부 packet 기준
curve이므로 strategy와 비용·sampling이 완전히 같다고 쓰지 않는다. benchmark null은
unavailable로 보존하고 새로운 비용 보정 계산기를 만들지 않는다. 비용 정책을 바꾸면
inputHash/costModelHash와 실제 fill costs가 함께 바뀌는지 테스트한다.

모든 핵심 주장에는 artifact basename과 JSON field 또는 log 식별자를 둔다. Hash는 무결성과
동일 조건 확인 수단이지 source 사실성·실제 수익·데이터 완전성의 증명이 아니다.

## 기준 source 대응

아래 링크의 line은 모두 고정 baseline 기준이며 제안 파일의 구현 존재를 뜻하지 않는다.

| 근거 | 확인한 책임·경계 |
| --- | --- |
| [queued schema와 저장](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/api/strategyBucketTestRuns.ts#L68-L111), [record 생성](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/api/strategyBucketTestRuns.ts#L361-L423) | full config 미보존, runId null, runnerStarted false |
| [simulation schema](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/api/paperSimulationRuns.ts#L42-L78), [adapter](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/api/paperSimulationRuns.ts#L255-L339) | cost/benchmark 입력과 적용의 차이, batch 호출 |
| [simulation in-flight 처리](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/api/paperSimulationRuns.ts#L126-L233) | process-local WeakMap, durable attempt/cancel 아님 |
| [single workflow](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/workflows/historicalReplayWorkflow.ts#L59-L168) | 기존 portfolio/source read, start write, runner/report/failure 순서 |
| [plan options와 초기 상태](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/workflows/historicalReplayWorkflowPlan.ts#L31-L142), [metadata config](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/workflows/historicalReplayWorkflowPlan.ts#L185-L210) | 재사용 옵션, storedPortfolio 우선, clock session 미포함 |
| [manifest 생성과 payload 정규화](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/workflows/historicalReplayWorkflow.ts#L171-L231), [fixture provider](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/workflows/historicalReplayWorkflow.ts#L429-L446) | 기존 hash 입력과 내부 static wrapper |
| [canonical hash/manifest](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/replay/replayRunManifest.ts#L22-L132) | 원문 payload가 아닌 hash/reference 저장 |
| [strict run config](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/replay/historicalReplayAuditLog.ts#L108-L163), [snapshot schema](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/domain/schemas.ts#L179-L215) | 새 입력에서 조합할 schema |
| [source index](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/market/historicalPacketBuilder.ts#L92-L171) | tick별 future/stale exclusion |
| [runner options와 tick loop](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/replay/codexHistoricalReplayRunner.ts#L67-L167) | 기존 provider interface, cancellation 없음, ticks eager 생성 |
| [batch 시작 write](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/workflows/historicalBatchReplayWorkflow.ts#L385-L445) | 일반 batch 재실행 overwrite 위험, 별도 plan 모드에만 absence guard |
| [JSONL reader](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/storage/jsonlStore.ts#L43-L72) | missing/invalid line 관용 read와 strict admission 구분 |
| [execution policy](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/paper/executionModel.ts#L9-L80), [cost model](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/paper/costModel.ts#L6-L76) | 기존 숫자 policy와 modeled/not_modeled 가정 |
| [benchmark](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/reports/historicalReplayBenchmark.ts#L43-L108), [report 조합](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/reports/historicalReplayReport.ts#L185-L250) | cash/보조 기준선과 costs, warnings 기존 계산 재사용 |
| [artifact catalog](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/storage/artifactPaths.ts#L9-L28), [legacy 상태](https://github.com/misosiruda/toss-trading/blob/bc1423bd992171cf86b5c5d288e9c1c915cc2333/src/replay/historicalReplayProgress.ts#L34-L39) | 기존 이름 보존, cancelled를 기존 완료로 오인하지 않음 |
