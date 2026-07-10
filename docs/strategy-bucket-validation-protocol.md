# Strategy Bucket Validation Protocol

이 문서는 `toss-trading`의 paper-only historical replay에서 strategy bucket별 전략 후보를 어떻게 검증할지 정의한다.

목표는 특정 전략, 종목, 매수/매도 판단을 추천하는 것이 아니다. 목표는 장기, 스윙, 단기, 초단기, hedge 후보가 우리가 세운 가정대로 동작하는지, 어떤 조건에서는 유효하다고 볼 수 없는지, 그 조건을 어떤 artifact와 warning으로 판정할지 고정하는 것이다.

이 문서는 실거래 기능 구현 계획이 아니다. live order, broker mutation, raw `codex exec`, raw `tossctl`, natural language order, `place_order` surface는 범위에 포함하지 않는다. AI decision provider는 direction/evidence proposal만 제공하며 final sizing과 gate는 deterministic backend와 Risk Engine이 담당한다.

구체적인 replay/report 명령과 bucket별 실행 matrix는 [strategy-bucket-validation-runbook.md](strategy-bucket-validation-runbook.md)를 따른다.

## 기준 소스

검증 protocol은 현재 구현된 다음 contract를 기준으로 한다.

| 기준 | Source of truth | 검증에서 쓰는 정보 |
| --- | --- | --- |
| Strategy bucket enum | `src/domain/schemas.ts` | `long_term`, `swing`, `short_term`, `intraday`, `hedge` |
| Strategy replay preset | `src/replay/strategyReplayPreset.ts` | preset별 window, cadence, decision call budget, risk profile, exit policy |
| Bucket test validation | `src/api/strategyBucketTestValidation.ts` | paper-only config validation, bucket policy 존재 여부, provider mode gate |
| Historical replay guide | `docs/historical-replay.md` | batch replay command, preset, cost, validation split, report artifact |
| Sharpe validation | `docs/sharpe-statistical-validation-contract.md` | sample size, confidence interval, Lo-style adjustment, PSR, DSR warning |
| CPCV/PBO validation | `docs/cpcv-pbo-validation-contract.md` | selection overfitting, split matrix, sampled/full CPCV/PBO warning |
| RH milestone | `docs/research-hardening-milestone-plan.md` | calendar/FX, lifecycle, market impact, Sharpe, CPCV/PBO, Triple Barrier 상태 |
| Dashboard lab | `apps/dashboard/README.md` | read-only validation lab, strategy test lab, risk trace, cost warning |

`regime_cash`는 `StrategyReplayPresetName`에는 포함되지만 `strategyBucket` enum은 아니다. 따라서 이 문서에서는 별도 "allocation/cash reserve preset"으로 검증하고, bucket별 결과 matrix에는 `long_term`, `swing`, `short_term`, `intraday`, `hedge`만 넣는다.

## 검증 질문

각 strategy bucket은 다음 질문에 답해야 한다.

1. 이 bucket의 사전 가정은 무엇인가?
2. 그 가정이 깨지는 시장, 데이터, 비용, 리스크 조건은 무엇인가?
3. 깨짐을 어떤 artifact, metric, warning으로 판단할 것인가?
4. train에서 좋아 보인 결과가 validation/test 또는 다른 regime에서도 유지되는가?
5. 비용, partial fill, no-fill, risk reject, provider failure를 반영한 뒤에도 같은 결론인가?
6. 결과가 특정 window, 특정 prompt, 특정 policy hash, 특정 seed에만 의존하지 않는가?
7. AI evidence proposal이 deterministic risk gate와 충돌할 때 어떤 쪽을 신뢰하는가?

마지막 질문의 답은 항상 deterministic backend다. AI output은 evidence와 direction proposal이며, sizing, exposure cap, cash reserve, hedge policy, lifecycle gate, order simulation gate는 backend가 결정한다.

## 판정 등급

검증 결과는 투자 판단 문구가 아니라 research 상태로만 표현한다.

| 등급 | 의미 | 허용되는 다음 단계 |
| --- | --- | --- |
| `research_valid_for_paper_followup` | 현재 data, cost, risk, split 조건에서 bucket 가정이 반복적으로 깨지지 않았다. | 더 긴 paper-only validation과 문서화 |
| `conditional` | 일부 regime, cost, sample, split warning이 있지만 가정 전체를 닫을 정도는 아니다. | 조건을 명시한 추가 paper-only 실험 |
| `invalid_for_current_data_or_model` | 현재 data, cost model, validation split, risk policy에서 bucket 가정이 성립하지 않는다. | bucket 설정, data, cost, policy 재검토 |
| `inconclusive` | sample, data coverage, lifecycle, FX, label, split matrix가 부족해 결론을 낼 수 없다. | 입력 데이터와 검증 artifact 보강 |

`research_valid_for_paper_followup`는 실거래 적용, 성과 기대, 특정 종목 매매 판단을 뜻하지 않는다.

## 공통 fail-closed 조건

아래 조건 중 하나라도 있으면 해당 bucket은 최소 `conditional` 이하로 낮추고, hard blocker는 `invalid_for_current_data_or_model` 또는 `inconclusive`로 닫는다.

| 조건 | 판단 신호 | 기본 판정 |
| --- | --- | --- |
| Calendar 또는 timezone mismatch | availability preflight, calendar validation warning, skipped run | `inconclusive` |
| FX snapshot stale | FX stale warning, country/currency exposure 계산 warning | `inconclusive` |
| Universe lifecycle 누락 또는 non-active | lifecycle reject code, coverage warning, `VIRTUAL_LIFECYCLE_NOT_ELIGIBLE` | `invalid_for_current_data_or_model` |
| `strategyBucket` metadata 부족 | universe coverage `missingRequiredStrategyBuckets`, cost breakdown missing bucket warning | `inconclusive` |
| Replay window sample 부족 | `INSUFFICIENT_RETURN_SAMPLES`, skipped run, return sample 부족 | `inconclusive` |
| Cost/impact model이 핵심 가정과 맞지 않음 | `not_modeled` liquidity, market impact placeholder, 높은 participation rate | `conditional` 또는 `invalid_for_current_data_or_model` |
| Partial fill 또는 no-fill이 결과를 지배 | partial/no-fill count, liquidity reject, fill status distribution | `invalid_for_current_data_or_model` |
| Risk gate reject가 주된 결과 | risk reject rate, reject code concentration, risk trace | `invalid_for_current_data_or_model` |
| Provider failure가 결과를 지배 | provider failure rate, progress provider failure count | `inconclusive` |
| Train만 좋고 validation/test에서 붕괴 | `byValidationSplitRole`, CPCV/PBO warning, PBO below-median signal | `invalid_for_current_data_or_model` |
| Selection context 부족 | `MULTIPLE_TESTING_CONTEXT_MISSING`, `SELECTION_CONTEXT_MISSING` | `conditional` 또는 `inconclusive` |
| Label/evaluation artifact stale 또는 누락 | Triple Barrier/meta-label artifact warning 또는 누락 | `conditional` 또는 `inconclusive` |
| Dashboard 또는 report source corrupt | Validation Lab source status `corrupt`, JSON parse failure | `inconclusive` |

Risk, lifecycle, data availability, policy validation 실패는 fail-closed로 해석한다. 좋은 performance metric이 있더라도 hard blocker를 덮지 않는다.

## 공통 검증 절차

### 1. 입력 고정

실험 전에 다음 값을 고정한다.

| 항목 | 기록 위치 |
| --- | --- |
| `sourceDataDir` | batch replay config, strategy bucket test config |
| `universePath`와 universe hash | batch manifest, replay research manifest |
| calendar fixture와 rule | batch CLI option, availability report |
| FX freshness policy | report warning, availability summary |
| `strategyPreset` | batch manifest, run metadata, selection trial config |
| replay cadence | `stepSeconds`, `decisionFrequency`, `maxDecisionCalls` |
| provider mode | `dry_run_fixture` 또는 `codex_paper_only` |
| risk profile과 risk policy hash | run metadata, research manifest |
| exit policy hash | selection trial log, research manifest |
| cost model hash | research manifest, cost summary |
| prompt/schema hash | research manifest, selection trial log |
| seed와 split role | batch manifest, run record, validation split assignment |

입력값이 고정되지 않은 실험은 다른 bucket과 비교하지 않는다.

### 2. Backend validation 먼저 실행

dashboard 또는 API를 통해 strategy bucket isolated test config를 만들 때는 validation-only endpoint를 먼저 통과해야 한다.

```text
POST /paper/simulations/strategy-bucket-tests/validate
```

이 endpoint는 read-only validation이다. record 생성, artifact 저장, replay runner 시작, live order surface를 수행하지 않는다. 이후 create endpoint를 사용하더라도 현재 contract는 queued record와 audit event 저장에 한정되며 replay runner를 시작하지 않는다.

### 3. Preset별 batch replay 실행

bucket별 후보는 `--strategy-preset`으로 분리하고 같은 data, universe, calendar, cost, split 조건에서 반복 실행한다.

```powershell
npm run historical:batch:replay:dry -- -- --source-data-dir data/replay-2023-01-2026-05-global-broad-yahoo-daily --output-dir data/batch-replay --batch-id batch-<preset>-validation-001 --seed bucket-validation-001 --runs 16 --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --strategy-preset <preset> --universe-path docs/historical-universe.global-broad.json --window-sampling balanced_regime --target-regimes bull,bear,sideways,mixed
```

실제 threshold와 run 수는 실험 전에 문서화한다. 실험 결과를 본 뒤 threshold를 바꾸면 selection bias로 기록한다.

### 4. Aggregate report 생성

batch run이 끝나면 aggregate report를 생성해 validation split, cost, Sharpe, CPCV/PBO, Triple Barrier/meta-label artifact를 한 곳에서 확인한다.

```powershell
npm run historical:batch:report -- -- --runs-path data/batch-replay/batch-<preset>-validation-001/batch-replay-runs.jsonl --output-path data/batch-replay/batch-<preset>-validation-001/batch-replay-aggregate-report.json
```

report는 strategy 자동 선택이나 live trading signal이 아니다. report는 실패 조건과 warning을 숨기지 않는 research artifact다.

### 5. Dashboard read-only 검토

Next.js dashboard는 다음 화면에서 결과를 확인한다.

| 화면 | 확인 항목 |
| --- | --- |
| `/dashboard/lab/strategy-tests` | bucket별 result matrix, full portfolio baseline delta, queued/running/completed 상태 |
| `/dashboard/validation` | validation split, overfitting warning, cost warning, Sharpe, CPCV/PBO, label/meta-label summary |
| `/dashboard/risk-gate` | AI proposal, normalized budget, risk approval, reject code, simulated execution status |
| `/dashboard/lab/runs/[runId]` | run별 artifact snapshot과 progress summary |

Dashboard는 read-only 확인 surface다. 화면에서 좋아 보이는 bucket을 live path로 승격하지 않는다.

## 공통 metric 해석

### 성과 metric

`totalReturnRatio`, `CAGR`, `maxDrawdownRatio`, `Calmar`, `hitRatio`, `profitFactor`, `tailLoss`, `exposureAdjustedReturn`은 bucket 가정을 설명하는 evidence일 뿐이다. 단일 성과 숫자만으로 research validity를 결정하지 않는다.

### 비용과 체결

`costSummary.byStrategyBucket`과 `costBreakdown.byStrategyBucket`을 우선 확인한다.

- turnover가 높은 bucket은 fee, tax, slippage, spread, market impact, participation rate를 분리해서 본다.
- `marketImpactBpsPerParticipationRate=0`이거나 liquidity가 `not_modeled`이면 단기/초단기 결과는 보수적으로 해석한다.
- partial fill 또는 rejected fill이 많으면 gross return보다 execution quality를 먼저 본다.

### Risk gate

AI proposal이 많아도 risk reject가 지배적이면 해당 bucket 가정은 현재 policy에서 작동하지 않는 것이다.

확인 항목:

- `riskRejectRate`
- reject code distribution
- `maxStrategyBucketExposureRatio`
- cash reserve reject
- hedge policy reject
- lifecycle reject
- concentration, country, currency, sector reject

### Sharpe validation

Sharpe 계열은 ranking 숫자가 아니라 statistical warning surface다.

무조건 확인할 항목:

- return sample count
- minimum sample count
- `sampleSharpe` status
- `loAdjustedSharpe` status
- `probabilisticSharpeRatio` status
- `deflatedSharpeRatio` status
- `NON_IID_RETURN_SAMPLE`
- `MULTIPLE_TESTING_CONTEXT_MISSING`
- `SELECTION_CONTEXT_MISSING`

Sample 부족이나 DSR context 부족이 있으면 bucket을 research-valid로 승격하지 않는다.

### CPCV/PBO

여러 preset, prompt, risk profile, exit policy 중 좋은 결과를 고른 경우 CPCV/PBO warning을 먼저 본다.

확인 항목:

- `cpcvPboValidation.status`
- `pbo.status`
- `pbo.probability`
- evaluated combination count
- sampled mode 여부
- split plan availability
- `PBO_CANDIDATE_COUNT_INSUFFICIENT`
- `PBO_HOLDOUT_MATRIX_INSUFFICIENT`
- `CPCV_SPLIT_PLAN_UNAVAILABLE`

PBO가 unavailable 또는 sampled이면 "검증 실패"가 아니라 "좋은 결과를 선택했다는 주장을 아직 엄밀히 지지하지 못한다"는 warning으로 기록한다.

### Triple Barrier와 meta-label

Triple Barrier와 meta-label은 side decision의 사후 평가 evidence다. sizing 지시나 order signal이 아니다.

확인 항목:

- label distribution
- actionable candidate count
- meta-label accuracy ratio
- purged sample 연결 여부
- stale derived artifact 제거 여부
- `META_LABEL_SIZING_DIRECTIVE_REJECTED`

Meta-label 결과가 좋더라도 deterministic Risk Engine의 sizing/gate를 대체하지 않는다.

## Bucket별 가정과 실패 조건

### `long_term`

사전 가정:

- 긴 holding period와 낮은 turnover가 핵심이다.
- 비용보다 lifecycle, universe coverage, drawdown, concentration, regime coverage가 더 중요하다.
- weekly cadence와 넓은 exit band를 전제로 한다.

유효하다고 볼 수 있는 조건:

- 여러 regime에서 결과가 한쪽 regime에만 몰리지 않는다.
- validation/test split에서 drawdown과 tail loss가 과도하게 악화되지 않는다.
- return sample이 충분하고 Sharpe validation warning이 hard blocker가 아니다.
- risk reject가 concentration 또는 lifecycle 문제로 지배되지 않는다.
- 하나의 position 또는 하나의 market exposure가 결과 대부분을 설명하지 않는다.

유효할 수 없는 상황:

- 긴 window 때문에 sample 수가 부족해 통계 검증이 닫힌다.
- 결과가 bull regime 또는 특정 data window에만 의존한다.
- delisted/suspended/unknown lifecycle이 누락되어 survivorship bias 가능성이 있다.
- drawdown이 정책 cap을 반복적으로 넘거나 cash reserve gate가 계속 reject한다.
- 좋은 total return이 하나의 집중 position에서만 발생한다.

판단 방법:

- `byRegime`, `byValidationSplitRole`, `maxDrawdownRatio`, `tailLoss`, `exposureCompliance.byStrategyBucket`을 함께 본다.
- `sharpeValidation.sample.returnSampleCount`가 부족하면 `inconclusive`로 둔다.
- lifecycle warning 또는 universe hash 누락은 성과 metric보다 우선한다.

### `swing`

사전 가정:

- multi-week 수준의 변화에 반응하되 intraday 수준의 체결 정밀도를 요구하지 않는다.
- daily cadence, 중간 turnover, partial trailing exit가 핵심이다.
- sideways regime에서 whipsaw가 발생할 수 있다.

유효하다고 볼 수 있는 조건:

- validation/test에서 train 대비 성과와 drawdown이 급격히 붕괴하지 않는다.
- turnover와 cost drag가 bucket 가정을 압도하지 않는다.
- risk reject가 특정 reject code에 몰리지 않는다.
- provider evidence가 stale data 또는 contradictory signal에 자주 막히지 않는다.

유효할 수 없는 상황:

- sideways 또는 mixed regime에서 반복적으로 손실과 cost drag가 누적된다.
- train split에서만 좋고 validation/test holdout에서 median 아래로 떨어진다.
- partial take-profit과 trailing stop이 과도한 churn으로 바뀐다.
- signal evidence가 부족해 `VIRTUAL_HOLD` 또는 risk reject가 대부분이다.

판단 방법:

- result matrix의 `turnoverRatio`, `costDragRatio`, `riskRejectRate`, `providerFailureRate`를 full portfolio baseline delta와 같이 본다.
- `overfittingDiagnostics`와 `cpcvPboValidation` warning이 있으면 `conditional` 이하로 둔다.
- risk trace에서 provider proposal과 risk reject 사유가 같은 패턴으로 반복되는지 확인한다.

### `short_term`

사전 가정:

- 짧은 holding period와 높은 turnover를 감수하되 cost-adjusted 결과가 남아야 한다.
- liquidity, partial fill, market impact, no-fill reject가 핵심 검증 대상이다.
- daily snapshot 기반이면 intraday microstructure를 주장하지 않는다.

유효하다고 볼 수 있는 조건:

- fee, tax, slippage, spread, market impact를 반영한 뒤에도 bucket 가정이 사라지지 않는다.
- partial/no-fill이 결과를 지배하지 않는다.
- risk cap 때문에 대부분의 action이 reject되는 구조가 아니다.
- validation/test split에서 cost drag가 train보다 급격히 커지지 않는다.

유효할 수 없는 상황:

- gross return은 양호하지만 total cost 또는 cost drag가 성과를 대부분 제거한다.
- participation rate가 높거나 liquidity가 `not_modeled`라 체결 가정이 불충분하다.
- no-fill 또는 partial fill이 반복되어 실행 가능성을 설명하지 못한다.
- stale daily data로 빠른 회전 전략을 평가하고 있다.

판단 방법:

- `costSummary.byStrategyBucket`, participation rate, partial fill count, no-fill reject를 먼저 확인한다.
- cost model이 `not_modeled`인 핵심 항목은 warning으로 남기고 research-valid로 승격하지 않는다.
- `riskRejectRate`와 liquidity reject가 높으면 performance metric보다 execution feasibility를 우선한다.

### `intraday`

사전 가정:

- 초단기 검증은 data cadence와 execution cost가 가장 중요하다.
- preset은 hourly step과 `every_tick` decision frequency를 제공하지만, 입력 data가 intraday resolution이라는 보장은 아니다.
- daily snapshot을 hourly cadence로 재사용하는 실험은 intraday 전략 검증이 아니라 cadence stress test로만 해석한다.

유효하다고 볼 수 있는 조건:

- 입력 snapshot cadence가 intraday 가정을 뒷받침한다.
- bid/ask spread, market impact, liquidity, stale price warning이 보수적으로 기록된다.
- provider call budget과 failure rate가 결과를 왜곡하지 않는다.
- cost-adjusted result가 short-term보다 더 낙관적으로 보이는 이유가 data artifact가 아니다.

유효할 수 없는 상황:

- source data가 daily bar인데 hourly replay로 초단기 edge를 주장한다.
- spread, market impact, volume participation이 `not_modeled`이거나 부족하다.
- provider call 실패 또는 timeout이 많아 decision cadence가 유지되지 않는다.
- risk gate가 turnover, cash, concentration, liquidity 문제로 대부분 reject한다.
- sample 수는 많아 보이지만 실제 unique price snapshot이 부족하다.

판단 방법:

- source snapshot frequency와 unique timestamp coverage를 먼저 확인한다.
- daily data 기반이면 `invalid_for_current_data_or_model` 또는 `inconclusive`로 닫고, "intraday 유효"라고 표현하지 않는다.
- `costRiskWarning`, `providerFailureRate`, `partialFillCount`, `maxParticipationRate`를 hard gate로 본다.

### `hedge`

사전 가정:

- hedge bucket은 독립 수익 전략이 아니라 downside exposure와 drawdown을 줄이는 보조 bucket이다.
- `hedgePolicy`와 positive hedge target이 켜져 있어야 isolated hedge test가 의미 있다.
- hedge 효과는 gross return이 아니라 coverage, drawdown reduction, over-hedge 여부, cost drag로 본다.

유효하다고 볼 수 있는 조건:

- hedge exposure가 policy target과 일관된다.
- downside exposure 또는 drawdown이 비용 대비 의미 있게 줄어든다.
- `hedgeCompliance.status`가 `ok`이고 over-hedged 또는 missing이 아니다.
- hedge cost drag가 portfolio risk reduction을 완전히 상쇄하지 않는다.

유효할 수 없는 상황:

- hedge policy가 꺼져 있거나 hedge target이 0이다.
- hedge bucket candidate가 없거나 `requireHedgeBucket`을 만족하지 못한다.
- hedge exposure가 과도해 portfolio upside/downside 구조를 왜곡한다.
- hedge cost가 높고 drawdown reduction evidence가 없다.
- hedge가 특정 regime에서만 작동하고 validation/test에서 사라진다.

판단 방법:

- `hedgeCompliance.status`, `hedgeCoverageRatio`, `netDownsideExposureRatio`, `hedgeCostKrw`, `hedgeTradeCount`를 본다.
- hedge result를 total return ranking에 넣지 않는다.
- risk trace에서 `hedge_policy` reject와 over-hedged 상태를 별도로 기록한다.

### `regime_cash` preset

사전 가정:

- `regime_cash`는 strategy bucket이 아니라 market regime allocation과 dynamic cash reserve를 검증하는 preset이다.
- 목적은 공격적 수익이 아니라 high volatility 또는 불리한 regime에서 cash reserve가 portfolio risk를 줄이는지 확인하는 것이다.

유효하다고 볼 수 있는 조건:

- regime classification이 충분한 sample과 symbol coverage를 가진다.
- cash reserve 변화가 drawdown 또는 tail loss 감소와 함께 설명된다.
- cash drag가 지나치게 크지 않고, reserve status가 missing 또는 fallback에만 머물지 않는다.

유효할 수 없는 상황:

- `marketRegime`이 `insufficient_data`에 자주 머문다.
- reserve rule source가 계속 fallback이다.
- cash reserve가 높아졌지만 drawdown reduction evidence가 없다.
- market별 KR/US regime이 불일치하는데 aggregate regime만 보고 결론을 낸다.

판단 방법:

- `cashCompliance.ruleSource`, `reserveStatus`, `marketRegime`, `marketRegimesByMarket`, `cashGapKrw`, `tailLoss`를 같이 본다.
- 이 preset은 bucket별 matrix의 승자 후보가 아니라 portfolio policy stress test로 기록한다.

## 실험 설계 matrix

각 bucket은 최소한 다음 축을 고정하거나 반복한다.

| 축 | 기본 원칙 |
| --- | --- |
| Data window | 같은 `random-window-from`, `random-window-to`, seed family 사용 |
| Regime | `balanced_regime`으로 bull, bear, sideways, mixed를 분리 |
| Split | train, validation, test role을 명시하고 role별 metric을 분리 |
| Universe | 같은 `universePath`와 lifecycle coverage hash 사용 |
| Cost | 같은 cost model과 market impact policy 사용 |
| Provider | `dry_run_fixture`와 `codex_paper_only`를 섞어 비교하지 않음 |
| Prompt | prompt hash가 바뀌면 다른 candidate로 기록 |
| Risk profile | risk profile이 바뀌면 다른 candidate로 기록 |
| Exit policy | exit policy hash가 바뀌면 다른 candidate로 기록 |
| Baseline | full portfolio aggregate, cash-only, equal-weight, initial-hold benchmark와 분리 비교 |

좋은 결과를 본 뒤 matrix 축을 추가하거나 제거하면 selection trial로 기록한다.

## 결과 기록 template

각 bucket 실험의 결론은 다음 template으로 남긴다.

```markdown
## <bucket> validation result

- Status: `research_valid_for_paper_followup` | `conditional` | `invalid_for_current_data_or_model` | `inconclusive`
- Data: `<sourceDataDir>`
- Universe: `<universePath>`, `<universeHash>`
- Preset: `<strategyPreset>`
- Provider: `dry_run_fixture` | `codex_paper_only`
- Split: train `<n>`, validation `<n>`, test `<n>`
- Regime coverage: bull `<n>`, bear `<n>`, sideways `<n>`, mixed `<n>`
- Cost model: `<costModelHash>`, highest cost bucket `<bucket>`
- Risk gate: reject rate `<ratio>`, primary reject codes `<codes>`
- Sharpe validation: status `<status>`, warnings `<codes>`
- CPCV/PBO: status `<status>`, warnings `<codes>`
- Triple Barrier/meta-label: status `<status>`, warnings `<codes>`
- Primary invalidation risks: `<risks>`
- Follow-up: `<paper-only next experiment>`
```

Template의 `Follow-up`은 paper-only 실험만 적는다. 실거래 적용, 특정 종목 매수/매도, 성과 목표 달성 문구는 쓰지 않는다.

## PR 전 자체 검토 기준

전략 검증 관련 PR은 다음을 확인한다.

- 문서, 테스트, 구현 범위가 같은 PR 범위에 있는가?
- dashboard 또는 API 문구가 strategy recommendation처럼 읽히지 않는가?
- fail-closed 조건이 pass처럼 표시되지 않는가?
- `strategyBucket` enum과 `StrategyReplayPresetName` 차이를 섞지 않았는가?
- cost, liquidity, market impact warning이 short-term과 intraday에서 먼저 보이는가?
- Sharpe/CPCV/PBO/Triple Barrier warning이 read-only evidence로 표현되는가?
- AI output을 sizing, final gate, order intent로 연결하지 않았는가?
- live order, broker mutation, raw command execution surface가 추가되지 않았는가?
- Markdown의 실제 물결표가 필요한 경우 `\~`로 escape 되었는가?
