# Research Hardening Milestone Plan

이 문서는 Q1\~Q9 paper-only research simulation 구현 이후의 다음 milestone을 정의한다.

목표는 더 공격적인 실거래 기능을 여는 것이 아니라, 현재 paper-only historical replay와 Next.js dashboard를 더 신뢰할 수 있는 검증 환경으로 만드는 것이다. 모든 단계는 `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only` 경계를 유지한다.

## 배경

현재 완료된 범위:

- 장기, 스윙, 단기, 초단기, hedge strategy bucket 구분
- portfolio-level exposure aggregation
- regime-aware dynamic cash reserve
- hedge policy
- transaction cost, liquidity, partial fill/no-fill rejection
- train/validation/test split, walk-forward, embargo, purged split, PBO-like report
- batch replay aggregate report와 read-only dashboard 표시
- Next.js dashboard 기반 policy validation, strategy bucket test, progress view, risk trace, audit view

남은 항목은 기존 Q1\~Q9의 미완료가 아니라 다음 단계의 신뢰성 강화 후보였다. 사용자는 이 항목들을 실제로 진행할 필요가 있다고 판단했고, 이 문서는 그 작업 순서를 새 milestone으로 고정한다.

## 원칙

1. 운영 UI 정리와 데이터 정합성을 성과 지표 확장보다 먼저 처리한다.
2. 백테스트 왜곡을 줄이는 작업을 전략 선택 고도화보다 먼저 처리한다.
3. 단기/초단기 전략의 비용 가정은 낙관적으로 두지 않는다.
4. AI decision provider는 direction/evidence proposal에 머물고 sizing은 deterministic risk/allocation engine이 담당한다.
5. 새 metric은 투자 조언 문구가 아니라 검증 지표로만 노출한다.
6. replay 결과가 좋아지는 방향의 선택 편향을 막기 위해 selection process와 rejected action을 계속 audit log에 남긴다.
7. live order, broker mutation, raw `codex exec`, raw `tossctl`, natural language order surface는 추가하지 않는다.

## 전체 우선순위

1. Dashboard legacy archive, redirect, deployment routing 정리
2. Exchange calendar, timezone, FX stale rule
3. Universe lifecycle snapshot
4. Slippage, nonlinear market impact, volatility-adjusted cost
5. Sharpe statistical validation
6. Full CPCV/PBO
7. Triple Barrier Method와 meta-labeling

이 순서는 의존성 기준이다. 1은 운영자가 어떤 UI를 기준으로 볼지 정리하는 작업이고, 2\~3은 replay input의 정합성 기반이다. 4는 높은 turnover 전략의 체결 가정을 보수화한다. 5\~7은 여러 전략 후보를 비교할 때 필요한 통계 검증과 label/evaluation layer 확장이다.

## RH1. Dashboard Legacy Archive And Routing

목표:

- Next.js `apps/dashboard`를 operator UI의 기준으로 고정한다.
- Local Operations API의 기존 정적 `/dashboard`를 legacy compatibility surface로 명확히 격리한다.
- archive, redirect, deployment routing 정책을 문서와 코드에서 일관되게 만든다.

작업 범위:

- 기존 정적 `dashboard/` asset의 archive 위치 또는 compatibility 유지 정책 결정
- Local Operations API `/dashboard` routing과 Next.js `/dashboard` routing의 역할 분리
- README, `apps/dashboard/README.md`, dashboard plan 문서의 운영 진입점 정리
- legacy static response header와 화면 문구 유지 여부 검토
- deployment routing에서 operator가 어떤 URL을 기본으로 열어야 하는지 명시

정책 기준:

- routing/archive 결정 기록은 [dashboard-routing-policy.md](dashboard-routing-policy.md)를 기준으로 한다.
- 현재 결정은 Next.js `apps/dashboard`를 기본 operator UI로 두고, Local Operations API의 정적 `/dashboard`는 legacy static compatibility surface로 유지하는 것이다.

비범위:

- live trading dashboard 구현
- broker mutation 추가
- strategy runner 자동 시작
- authentication/RBAC 전체 구현

완료 기준:

- `README.md`와 dashboard 문서가 하나의 기본 operator URL을 가리킨다.
- legacy static dashboard는 archive 또는 compatibility surface 중 하나로 명확히 분류된다.
- Next.js route와 Local Operations API route가 서로 다른 책임을 가진다는 점이 테스트 또는 문서로 확인된다.
- live order, broker mutation, raw command surface가 여전히 노출되지 않는다.

권장 PR 분해:

1. routing/archive 정책 문서화
2. static dashboard archive 또는 compatibility route 정리
3. README와 deployment 안내 갱신
4. dashboard smoke/E2E와 no-live-order boundary 검증 보강

## RH2. Exchange Calendar, Timezone, FX Stale Rule

목표:

- KR/US 혼합 replay에서 거래일, 휴장일, 장 마감 기준, timezone 경계가 replay 결과를 왜곡하지 않게 한다.
- FX rate가 stale한 상태에서 country/currency exposure와 performance가 조용히 계산되지 않게 한다.

작업 범위:

- market calendar abstraction
- `exchange`, `timezone`, `sessionDate`, `marketOpen`, `marketClose`, `holiday` metadata
- KR/US instrument별 local trading date 변환
- replay window와 batch sampler의 calendar-aware validation
- FX snapshot freshness policy
- FX stale reject/warning code
- report와 dashboard에 calendar/FX warning 노출

비범위:

- 실시간 FX feed 연동
- official broker account balance 조회
- live market open order routing
- 실계좌 currency conversion

완료 기준:

- KR/US replay sample이 local trading date와 UTC timestamp를 함께 기록한다.
- 휴장일 또는 market session 밖의 sample은 명시적으로 skip/reject/warn 처리된다.
- FX stale 상태는 report warning과 audit event로 남는다.
- timezone mismatch가 발생해도 portfolio metric이 조용히 계산되지 않는다.

권장 PR 분해:

1. calendar/FX contract와 fixture 문서화
2. market calendar helper와 unit test
3. replay window validation 연결
4. FX stale policy와 report/dashboard warning 연결

## RH3. Universe Lifecycle Snapshot

목표:

- survivorship bias를 줄이기 위해 replay 시점의 투자 universe를 날짜별 snapshot으로 고정한다.
- delisted, suspended, inactive instrument가 과거 replay에서 현재 상태 기준으로 누락되거나 잘못 포함되지 않게 한다.

작업 범위:

- date-scoped universe snapshot schema
- instrument lifecycle status: `active`, `suspended`, `delisted`, `unknown`
- snapshot hash와 replay manifest 연결
- universe coverage report
- lifecycle status별 candidate eligibility rule
- missing metadata fail-closed 또는 warning policy

비범위:

- 실제 거래소 listing feed 자동 수집
- survivorship-free commercial data vendor 연동
- 특정 종목 추천
- live universe 자동 변경

정책 기준:

- Universe lifecycle snapshot contract는 [historical-replay.md](historical-replay.md)의 `Universe manifest` 생명주기 snapshot 계약과 `docs/historical-universe.lifecycle-sample.json` fixture를 기준으로 한다.

현재 결정:

- `HistoricalUniverseManifest`는 date-scoped `snapshotDate`와 `active`, `suspended`, `delisted`, `unknown` lifecycle status를 가진다.
- replay manifest는 `--universe-path`가 있을 때 normalized universe manifest를 `universeHash`에 포함하고 `universeSnapshotDate`를 저장한다.
- candidate builder는 명시된 non-active lifecycle과 manifest 누락 symbol을 `HISTORICAL_LIFECYCLE_<STATUS>` reason code로 표시하고, risk engine은 non-hold decision을 `VIRTUAL_LIFECYCLE_NOT_ELIGIBLE`로 fail-closed reject한다.
- universe coverage report는 `BatchReplayAggregateReport.universeCoverage`, `ReplayResearchReport.dataUniverseCoverage`, Next.js Validation Lab의 read-only data universe coverage summary로 연결한다.
- 이 범위는 paper-only replay artifact 검증용이며 live universe 자동 변경, 실시간 listing feed, 특정 종목 추천으로 확장하지 않는다.

완료 기준:

- replay manifest가 universe snapshot hash와 snapshot date를 포함한다.
- delisted/suspended fixture가 candidate selection과 report에서 재현 가능하게 처리된다.
- universe selection bias warning이 aggregate report에 노출된다.
- unknown lifecycle metadata는 paper-only risk policy에 따라 보수적으로 처리된다.

권장 PR 분해:

1. universe lifecycle schema와 sample fixture
2. replay manifest hash 연결
3. candidate eligibility와 risk warning 연결
4. coverage report와 dashboard 표시

## RH4. Slippage And Market Impact

목표:

- fixed bps cost만으로 단기/초단기 전략을 과대평가하지 않게 한다.
- 거래대금, volume participation, spread, volatility에 따라 paper execution cost가 보수적으로 커질 수 있게 한다.

작업 범위:

- market impact model interface
- fixed bps, spread-based, participation-rate, volatility-adjusted cost model 분리
- per-trade cost breakdown: fee, tax, spread, slippage, market impact
- turnover, participation rate, no-fill/partial-fill 이유 기록
- strategy bucket별 cost drag 비교
- dashboard/report cost warning

비범위:

- live order book 연결
- 실제 broker execution quality 분석
- high-frequency trading engine
- 실거래 주문 가격 최적화

정책 기준:

- RH4 cost/execution contract는 [historical-replay.md](historical-replay.md)의 `Q3-2 기준`과 `paper_cost_model.v5` / `execution_simulator.v4` 설명을 기준으로 한다.

현재 결정:

- `paper_cost_model.v5` / `execution_simulator.v4`는 fixed bps fee/tax/slippage 산식을 유지하고, opt-in fixed half-spread bps를 별도 cost component로 기록한다. 기본 half-spread 0과 volatility-adjusted slippage는 명시적 `not_modeled` placeholder로 기록한다.
- candidate `volume` 또는 `averageVolume`이 있을 때 volume participation cap을 적용하고, paper trade/report에는 `fillStatus`(`filled`, `partial`, `rejected`), `liquidityStatus`(`not_modeled`, `sufficient`, `partial`, `rejected`, `stale`), participation rate를 분리해 남긴다.
- 기본 `marketImpactBpsPerParticipationRate=0`에서는 market impact가 `not_modeled`이며, 0보다 큰 paper-only policy에서는 filled notional과 filled participation rate 기준 `linear_participation_bps` impact cost를 계산한다.
- market impact policy는 run metadata, `costModelHash`, trade cost component, historical replay report, batch aggregate cost summary에 남긴다.
- strategy bucket별 cost drag는 aggregate `costSummary.byStrategyBucket`과 replay research `costBreakdown.byStrategyBucket`으로 보존한다.
- Next.js Validation Lab은 Local Operations API의 `costRiskWarning` read-only summary로 execution cost, market impact, partial fill, liquidity not-modeled, bucket coverage warning을 표시한다.
- 이 범위는 paper-only replay artifact 해석용이며 strategy recommendation, sizing directive, performance guarantee로 확장하지 않는다.

완료 기준:

- 단기/초단기 bucket은 fixed bps 외 cost component를 별도 기록한다.
- volume participation이 높은 simulated order는 reject 또는 더 높은 cost로 처리된다.
- report가 gross return과 cost-adjusted return을 분리해서 보여준다.
- market impact model 변경은 config hash와 report에 남는다.

권장 PR 분해:

1. cost model interface 확장
2. market impact fixture와 execution simulator 연결
3. aggregate report cost breakdown 확장
4. dashboard cost/risk warning 표시

## RH5. Sharpe Statistical Validation

목표:

- Sharpe ratio를 단일 숫자로 비교하지 않고 sample size, serial correlation, non-IID return 문제를 함께 기록한다.
- 여러 strategy/prompt/policy 후보를 비교할 때 우연히 높은 Sharpe를 고른 위험을 표시한다.

정책 기준:

- Sharpe validation design과 metric schema는 [sharpe-statistical-validation-contract.md](sharpe-statistical-validation-contract.md)를 기준으로 한다.

현재 결정:

- `sharpe_validation.v1` contract는 [sharpe-statistical-validation-contract.md](sharpe-statistical-validation-contract.md)를 기준으로 하며, source of truth는 `src/analytics/sharpeValidation.ts`다.
- standalone `calculateSharpeValidationReport()`는 sample Sharpe, 95% confidence interval, Lo-style adjusted Sharpe, benchmark-gated Probabilistic Sharpe Ratio, selection-context-gated Deflated Sharpe Ratio를 계산한다.
- `HistoricalReplayReport.sharpeValidation`은 single replay return sample, lag 5 autocorrelation diagnostic, `candidateCount=1` / `trialCount=1` selection context를 기록하고 Markdown render에 read-only section을 표시한다.
- `BatchReplayAggregateReport`는 `overall`, `byRegime`, `byValidationSplitRole` group summary마다 `sharpeValidation`을 생성하고, trial dispersion이 부족하면 DSR을 `missing_selection_context`로 fail-closed warning 처리한다.
- `ReplayResearchReport`는 Sharpe validation status, sample Sharpe, Lo/PSR/DSR status, selection context, warning을 read-only summary로 보존한다.
- legacy static dashboard renderer는 Sharpe validation status, sample Sharpe, Lo/PSR/DSR status, sample count, warning을 read-only summary로 표시한다.
- Next.js Validation Lab은 Sharpe validation status, sample Sharpe, Lo/PSR/DSR status, selection context, warning을 read-only summary로 표시한다.
- insufficient sample, zero volatility, non-IID return, missing selection context는 pass처럼 보이지 않도록 warning으로 남긴다.
- 이 범위는 paper-only replay artifact 해석용이며 strategy recommendation, sizing directive, performance guarantee로 확장하지 않는다.

작업 범위:

- Sharpe confidence interval
- Probabilistic Sharpe Ratio
- Deflated Sharpe Ratio
- sample size, autocorrelation, skewness, kurtosis warning
- per-bucket metric과 full-portfolio metric의 비교 기준 정리
- dashboard/report에 통계적 신뢰도 경고 표시

비범위:

- 성과 보장 문구
- 투자 추천 score
- AI confidence를 position sizing에 직접 연결
- live strategy auto-selection

완료 기준:

- Sharpe 계열 metric은 sample warning과 함께 기록된다.
- insufficient sample size에서는 metric이 pass처럼 보이지 않고 warning으로 노출된다.
- 여러 후보 중 best result만 선택한 경우 selection bias warning을 남긴다.
- report는 CAGR, MDD, Calmar, turnover, tail loss, exposure-adjusted return과 함께 Sharpe 계열 지표를 표시한다.

권장 PR 분해:

1. Sharpe validation design과 metric schema
2. metric calculator와 unit test
3. aggregate report 연결
4. replay research report read-only 표시
5. dashboard validation lab 표시

## RH6. Full CPCV And PBO

목표:

- 현재 sampled CPCV/PBO-like 경고를 더 엄격한 combinatorial validation 구조로 확장한다.
- prompt sweep, parameter sweep, strategy selection 과정의 overfitting probability를 더 명시적으로 계산한다.

작업 범위:

- combinatorial split generator
- purged/embargo-aware CPCV split
- fold별 train/test performance matrix
- Probability of Backtest Overfitting 계산
- strategy selection log와 PBO report 연결
- compute budget과 max combination guard

비범위:

- 무제한 parameter sweep
- 자동 best strategy 배포
- live trading enablement
- Codex가 strategy selection을 최종 결정하는 구조

완료 기준:

- CPCV split은 overlap/embargo rule을 위반하지 않는다.
- PBO 계산에 사용된 candidate/fold/performance matrix가 artifact로 남는다.
- combination 수가 과도하면 fail-closed 또는 sampled mode로 명시적으로 degrade된다.
- dashboard/report가 PBO warning을 투자 조언이 아닌 검증 경고로 표시한다.

정책 기준:

- CPCV/PBO validation design과 config/report schema는 [cpcv-pbo-validation-contract.md](cpcv-pbo-validation-contract.md)를 기준으로 한다.

현재 결정:

- `cpcv_pbo_validation.v1` contract는 [cpcv-pbo-validation-contract.md](cpcv-pbo-validation-contract.md)를 기준으로 하며, source of truth는 `src/replay/cpcvPboValidation.ts`다.
- `src/replay/combinatorialPurgedCv.ts`는 `combinatorial_purged_cv` standalone split plan을 생성하고, invalid config와 exhaustive budget excess를 fail-closed 처리한다.
- standalone PBO calculator는 config/split plan 일치 여부를 검증하고 `config`, `splitPlan`, `performanceMatrix`, `selectionLog`, `pbo`, `warnings`를 하나의 artifact로 기록한다.
- PBO 계산은 train metric 기준 selected candidate, deterministic `candidate_key_asc` tie breaker, holdout rank percentile, insufficient/mismatched holdout matrix fail-closed warning을 사용한다.
- `BatchReplayAggregateReport.cpcvPboValidation`은 기존 sampled PBO-like diagnostics를 `cpcv_pbo_validation.v1` artifact로 승격한다. 기존 aggregate는 full CPCV fold/sample id를 보존하지 않으므로 `status: "sampled"`, `splitPlan: null`, `CPCV_SPLIT_PLAN_UNAVAILABLE` warning을 사용한다.
- `ReplayResearchReport`와 Next.js Validation Lab은 `cpcvPboValidation` status, PBO probability/status, evaluated combination count, sampled mode, split plan availability, warning을 read-only summary로 표시한다.
- 이 범위는 paper-only replay artifact 해석용이며 strategy recommendation, sizing directive, performance guarantee, live strategy auto-selection으로 확장하지 않는다.

권장 PR 분해:

1. CPCV/PBO math design과 config schema
2. combinatorial split generator
3. PBO calculator와 artifact schema
4. batch aggregate report sampled artifact 연결
5. dashboard read-only warning 연결
6. replay research report read-only warning 연결

## RH7. Triple Barrier And Meta-Labeling

목표:

- fixed horizon label만으로 direction decision을 평가하는 한계를 줄인다.
- side decision과 sizing/risk decision의 책임을 계속 분리하면서 label/evaluation layer를 확장한다.

작업 범위:

- triple barrier label schema
- profit-taking, stop-loss, time barrier config
- event overlap과 purged validation 연결
- meta-label candidate schema
- AI decision side와 deterministic sizing/risk gate 분리 문서화
- label distribution report

비범위:

- AI confidence 기반 direct sizing
- live `TradingSignal` 생성
- live `OrderIntent` 생성
- 자동 종목 추천
- 실거래 order routing

완료 기준:

- triple barrier label은 config hash와 함께 재현 가능하게 생성된다.
- overlapping label horizon은 purged/embargo validation에서 제거된다.
- meta-label은 sizing 명령이 아니라 evaluation signal로만 취급된다.
- dashboard/report는 label quality와 distribution을 설명하되 매수/매도 조언으로 표현하지 않는다.

정책 기준:

- Triple barrier label design과 schema는 [triple-barrier-label-contract.md](triple-barrier-label-contract.md)를 기준으로 한다.

현재 결정:

- `triple_barrier_label.v1`, `meta_label_candidate.v1`, `meta_label_evaluation.v1` contract는 [triple-barrier-label-contract.md](triple-barrier-label-contract.md)를 기준으로 하며, source of truth는 `src/replay/tripleBarrierLabel.ts`다.
- standalone label generator는 historical market snapshot fixture와 event 목록에서 config hash, barrier touch result, direction label, purged sample, summary, warning을 가진 `triple_barrier_label.v1` artifact를 생성한다.
- `buildTripleBarrierPurgedKFoldSamples`는 generated label horizon을 `PurgedKFoldSample` 호환 입력으로 변환해 overlap 제거와 embargo validation에 연결한다.
- `meta_label_candidate.v1`과 `buildMetaLabelCandidate`는 side decision을 사후 label outcome과 비교하되 `sizingDirective`는 `null`만 허용하고, non-null 값은 `META_LABEL_SIZING_DIRECTIVE_REJECTED`로 fail-closed 처리한다.
- `meta_label_evaluation.v1` report는 candidate outcome distribution, actionable candidate count, accuracy ratio를 standalone summary로 집계한다.
- `historicalBatchReport`는 batch directory의 standard `triple-barrier-label-report.json`과 `meta-label-evaluation-report.json` artifact를 aggregate report에 read-only로 포함한다.
- `runHistoricalBatchReplay`는 같은 `batchId` rerun 시작 시 standard label/evaluation artifact를 제거해 stale derived evidence가 sibling auto-load로 붙지 않게 한다.
- Next.js Validation Lab은 `meta_label_evaluation.v1` summary를 read-only paper-only research evidence로 표시하고, batch aggregate report는 `triple_barrier_label.v1` label distribution을 read-only로 표시한다.
- 이 범위는 paper-only replay artifact 해석용이며 strategy recommendation, sizing directive, performance guarantee, live `TradingSignal`, live `OrderIntent`, 자동 종목 추천으로 확장하지 않는다.

권장 PR 분해:

1. triple barrier design과 label schema
2. label generator와 fixture test
3. purged validation 연결
4. meta-label evaluation report와 dashboard 표시

## 공통 검증 기준

모든 RH 단계는 다음을 확인해야 한다.

- `npm run check`
- `git diff --check`
- 관련 unit/integration/E2E test
- no live order boundary grep
- no raw `codex exec` / raw `tossctl` surface
- no real credential
- report 문구가 투자 조언 또는 성과 보장으로 읽히지 않음
- config hash, data snapshot hash, schema version, prompt version 영향 검토
- failure case가 audit log 또는 report warning으로 남음

## 현재 결정

- RH1부터 순서대로 진행한다.
- 각 RH 단계는 PR 단위로 더 작게 분해한다.
- 구현 PR을 시작하기 전에는 해당 RH 단계의 contract와 완료 기준을 먼저 확인한다.
- 보류 후보였던 항목들은 이 문서 기준으로 새 milestone의 작업 후보가 됐다.
- 단, 실거래 기능은 여전히 이 milestone의 범위가 아니다.
