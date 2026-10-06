> 2026-10-06 사용자 승인: 비용 직접 입력·기존 3종 benchmark의 표시 선택·coverage metadata 유지·원래 batch 요청 정본을 재검증해 새 ID 생성 방향은 [승인 계약](../plans/experiment-workspace-redesign/approved-options-contract-20261006.md)과 [기능별 PR](../plans/experiment-workspace-redesign/approved-options-pr-plan-20261006.md)을 따른다. 아래 UX02a 계약과 현재 미지원 guard는 후속 구현 전까지 유지하며 승인 방향을 구현 완료로 표시하지 않는다.

# Paper simulation 입력·실효 조건 계약

UX-02a 범위: 기존 historical batch runner의 동작을 설명하는 side-effect-free 검증과
create/runner의 동일 입력 매핑. 새 비용/benchmark/종목 필터, PortfolioPolicy 실행,
UI, 외부 AI 실행이나 데이터 수집은 포함하지 않는다.
UX-02b 접수·실패 관측의 별도 범위는 [관측 계약](paper-simulation-observations.md)을 따른다.

## 검증과 생성

- `POST /paper/simulations/validate`: `x-toss-trading-operation: paper-simulation-validate`,
  JSON body와 기존 loopback same-origin guard를 요구한다. 최대 body는 32,768 bytes다.
- `POST /paper/simulations`: 기존 `paper-simulation-create` intent와 guard를 유지한다.
  서로의 intent를 재사용할 수 없으며 validation은 mutation route 목록에 들어가지 않는다.
- local API는 기존 policy/bucket validation과 같은 guard다. Next의 create proxy는 기존
  dashboard intent·same-origin·runtime mutation token 검증을 그대로 유지한다.
  UX-03의 `/dashboard/experiments/validate` proxy는 별도 `paper-simulation-validate` dashboard intent,
  명시적인 동일 Origin, JSON object와 streamed 32,768-byte 제한을 적용한다. 이 읽기 전용 검증은
  mutation token을 요구·전달하지 않는다. 생성은 기존 guarded create proxy를 유지한다.
  [UX-03 입력·검증 lifecycle](../plans/experiment-workspace-redesign/ux03-implementation.md)을 참고한다.
- 검증 200은 `schemaVersion=paper_simulation_validation.v1`, `status=valid`,
  `requestedConfig`, `effectiveConfig`, `notices`를 반환한다. `requestedConfig`는 기존
  schema로 파싱한 알려진 필드이며 원본 JSON 전체가 아니다. 불필요한 broad strict화 없이
  기존 추가 metadata 제거 규칙을 유지한다.
- 검증은 schema, 기존 경로/날짜/수치 및 provider enable·tick pacing 설정만 확인한다.
  파일 읽기, artifact/audit 저장, 실행 슬롯 예약, provider 생성/호출, runner 실행은 없다.
  `readOnly=true`, `storageMutationEnabled=false`, `replayRunnerStarted=false`,
  `dataAvailabilityChecked=false`, `sourceDataKind=unknown`을 반환한다.
- 파일 존재·coverage·실제 데이터 종류·인증·provider 가용성·runner 건강·동시 실행 슬롯은
  확인하지 않는다. 검증 성공 뒤 create는 409 또는 다른 오류가 될 수 있다.
- create는 같은 resolver를 사용하고 같은 `requestedConfig`, `effectiveConfig`, `notices`를
  202 응답에 추가한다. runner가 실제 소비하는 것은 이 `effectiveConfig`다.
  기존 ID, URL, 요청 횟수 필드는 유지한다. `accepted`는 완료나 데이터 가용성의 증거가 아니다.
  `simulationRunId=batchId`이고 batch 내부 개별 `runId`와 구별한다.

## 요청 → 실효 조건

| 요청 | 실제 적용 및 노출 |
| --- | --- |
| `mode` | `paper_only`만 허용 |
| `runType`, `runCount` | single은 1회, batch는 지정값 또는 5회. single의 다른 count는 notice와 함께 1로 정규화 |
| `sourceDataDir` | 프로젝트 `data` 아래 상대 경로를 runner에 전달. 존재·symlink·종류·coverage는 검증하지 않음 |
| `universe.preset` | 모든 기존 문자열을 요청 metadata로 유지. `presetApplied=false`; source snapshot 종목을 preset으로 필터링하지 않음 |
| `universe.market` | mixed_global은 profile 목표 exposure를 KR/US로 반분. kr/us는 기존 profile allocation을 유지. 모두 `marketFilterApplied=false` |
| `window` | 날짜만 있으면 +09:00 하루 시작/끝으로 정규화. YYYY-MM-DD 달력 날짜는 round-trip 검증하여 존재하지 않는 날짜의 자동 rollover를 거부하며 ISO datetime도 offset과 독립적으로 날짜 부분을 검증. random은 seed·월 길이·범위로 기존 sampler 사용. fixed는 날짜가 구간을 결정하며 windowMonths는 fixedWindow metadata에만 유지 |
| `samplingPolicy` | 빈도·stepSeconds·maxDecisionCalls 그대로 적용. Codex call cap은 Codex provider에만 적용하고 fixture의 실효 cap은 0 |
| `capital`, `riskProfile` | initialCashKrw와 profile로 기존 constraints/riskPolicy/allocationPolicy를 결정하고 값 공개 |
| `paperExitPolicy` | none=null; take_profit_stop_loss=0.15/0.08; rebalance_threshold=max position weight 0.4. 기존 full_exit 정규화 유지 |
| `decisionProvider` | fixture는 외부 model/schema 파일을 쓰지 않아 실효 modelId/outputSchema=null. Codex는 기존 enable guard 뒤 지정 model/schema/cap 사용 |
| `costModel=standard` | 별도 fee preset이 아님. 기존 `createPaperCostModel(undefined)` 전체 값과 version 공개. 실행에도 동일 기본 executionPolicy를 명시 전달 |
| `benchmarkPolicy=cash_equal_weight_initial_hold` | 고정 cashOnly/equalWeightBuyAndHold/initialPortfolioBuyAndHold 보고서. equal weight는 첫 priced replay packet이 없으면 unavailable |
| `portfolioPolicy` | 직접 실행 adapter가 없어 필드가 있으면 명시적 400. `portfolioPolicyApplied=false` |
| server tick pacing | 기존 환경변수 기본 0ms/상한 5,000ms 유지, 실효값 공개 |

`standard`의 현재 기본값은 fee/slippage/tax/half-spread/market-impact bps 0,
fillRatio 1, fractional shares 허용, max participation 0.1, min liquidity fill ratio 0.1,
stale liquidity 거절이다. 이는 `historicalBatchReplayWorkflow` → `historicalReplayWorkflowPlan`
→ `PaperOrderEngine` → `createPaperExecutionPolicy`에서 확인한 기본값이다. preset 이름만으로
유료 수수료나 현실적인 거래 비용을 주장하지 않는다. 기본 executionPolicy의 명시적 전달로
새 replay configuration provenance에는 그 값이 기록되며 이전 artifact는 다시 쓰지 않는다.

## 호환성 audit와 의도적 제한

확인한 caller는 `dashboard/simulationForm.js`, `dashboard/index.html`,
`apps/dashboard/src/app/dashboard/lab/policies/PolicyBuilderForm.tsx`와 기존
`localOperationsServer.test.ts`다. legacy/Next의 기본 `global_broad`, `mixed_global`,
`standard`, `cash_equal_weight_initial_hold`, fixture model 문자열을 유지한다. legacy의
`kr_us_core`/`manual_path`, `kr`/`us`도 정상 source 경로를 막지 않으며 미적용/배정 의미를 공개한다.
Next policy 버튼은 기존처럼 policy hash를 seed로 사용하며 정책 자체가 적용되지는 않는다.

legacy 화면의 `high_cost`, `cash_only`는 이전 schema에서 허용했으나 실제 실행·보고서에
전달되지 않았다. 두 선택은 이제 각각 `unsupported_simulation_cost_model`,
`unsupported_simulation_benchmark_policy` 400과 field-specific 설명을 반환한다.
서버가 실제 적용했다고 오해할 수 있는 요청을 성공으로 접수하지 않는 의도적 tightening이다.
legacy의 기존 에러 표시 경로는 유지하며, 새 UI는 이 선택들을 지원 옵션으로 노출하지 않는다.
`portfolioPolicy`는 `unsupported_simulation_portfolio_policy` 400이다.
기존 경로/날짜/schema/provider 오류 코드와 create 409는 유지한다.

## 완료·검증 기준

- validation 성공/거절/guard 오류 모두 artifact/audit/runner/provider 호출 0
- validation과 create 및 runner spy의 실효 조건 동일, accepted ID 그대로 유지
- 모든 preset/market 호환, risk/exit/sampling/provider/run/window 매핑과 미지원 값 거절
- 합성 KR/US snapshot을 사용하는 실제 fixed/random fixture replay에서 비용 hash,
  실행 metadata, allocation, exits, benchmark와 양쪽 시장 종목 보존 확인
- `git diff --check`, `npm run check:review`; 최종 후보 전체 검증은 병합 절차에서 수행

검증은 credential-free이며 실제 시장 성과·실제 데이터 가용성·유료 AI를 검증했다고 보고하지 않는다.
