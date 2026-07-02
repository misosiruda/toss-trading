# Sharpe Statistical Validation Contract

이 문서는 RH5 `Sharpe Statistical Validation`의 design과 `sharpe_validation.v1` metric schema를 정의한다.

범위는 paper-only historical replay와 batch replay 결과를 해석할 때 쓰는 통계 검증 contract다. 이 문서는 strategy 자동 선택, live signal 생성, broker write path, live execution routing을 추가하지 않는다.

## 현재 상태

현재 구현은 다음 contract를 가진다.

- `src/analytics/performanceMetrics.ts`의 `performance_metrics.v1`은 return sample 기반 `sharpeRatio`를 계산한다.
- 현재 `sharpeRatio`는 per-sample 값이며 annualize하지 않는다.
- return sample이 3개 미만이거나 volatility가 0이면 `null`과 warning을 반환한다.
- 현재 `sharpeRatio`는 serial correlation adjustment, confidence interval, Probabilistic Sharpe Ratio, Deflated Sharpe Ratio를 계산하지 않는다.
- batch aggregate report는 group별 return sample로 `advancedPerformance`를 계산하고, selection trial이 있을 때 sampled CPCV/PBO-like warning을 별도 section에 남긴다.
- `src/analytics/sharpeValidation.ts`는 standalone `calculateSharpeValidationReport()`를 제공한다. 이 helper는 finite return sample에서 sample Sharpe, mean, volatility, skewness, excess kurtosis, autocorrelation diagnostic을 계산하지만 아직 report/dashboard payload에 연결되지 않는다.

## Contract 목표

RH5는 Sharpe ratio를 단일 ranking 숫자로 취급하지 않기 위해 다음 정보를 별도 artifact field로 고정한다.

| 항목 | 목적 | 기본 처리 |
| --- | --- | --- |
| `sample` | return sample 수, minimum sample, annualization 상태 기록 | insufficient sample이면 metric은 `null` |
| `distribution` | mean, volatility, skewness, kurtosis, autocorrelation 진단 | 계산 불가 값은 `null`과 warning |
| `sampleSharpe` | 기존 per-sample Sharpe와 호환되는 기본 추정치 | standalone calculator에서 계산하고 report 연결은 후속 PR에서 처리 |
| `loAdjustedSharpe` | serial correlation 보정 후보 | 후속 calculator PR에서 계산 |
| `probabilisticSharpeRatio` | Sharpe가 benchmark를 초과할 확률 후보 | sample/skew/kurtosis 부족 시 unavailable |
| `deflatedSharpeRatio` | 후보 다중 비교와 selection bias 보정 후보 | candidate/trial context 없으면 unavailable |
| `selectionContext` | candidate count, trial count, 선택 metric 기록 | 없는 경우 selection bias warning |
| `warnings` | sample, non-IID, multiple testing warning code | pass처럼 보이지 않게 명시 |

## TypeScript Schema

Source of truth는 `src/analytics/sharpeValidation.ts`다.

```typescript
export const SHARPE_VALIDATION_SCHEMA_VERSION = "sharpe_validation.v1";

interface SharpeValidationReport {
  schemaVersion: typeof SHARPE_VALIDATION_SCHEMA_VERSION;
  status: "available" | "unavailable";
  sample: SharpeValidationSampleSummary;
  distribution: SharpeValidationDistributionSummary;
  metrics: SharpeValidationMetrics;
  selectionContext: SharpeValidationSelectionContext;
  warnings: SharpeValidationWarning[];
}
```

`SharpeValidationMetrics`는 네 가지 metric slot을 가진다.

```typescript
interface SharpeValidationMetrics {
  sampleSharpe: SharpeValidationEstimate;
  loAdjustedSharpe: SharpeValidationEstimate;
  probabilisticSharpeRatio: SharpeValidationProbability;
  deflatedSharpeRatio: SharpeValidationEstimate;
}
```

현재 구현은 schema, unavailable placeholder helper, standalone sample calculator를 제공한다. `HistoricalReplayReport`, `BatchReplayAggregateReport`, `ReplayResearchReport`, dashboard ViewModel에 이 field를 연결하는 작업은 후속 PR 범위다.

## Warning Code

| Code | 의미 | 기본 severity |
| --- | --- | --- |
| `INSUFFICIENT_RETURN_SAMPLES` | Sharpe 검증에 필요한 return sample이 부족함 | warning |
| `ZERO_RETURN_VOLATILITY` | volatility가 0이라 ratio를 계산할 수 없음 | warning |
| `SERIAL_CORRELATION_NOT_ADJUSTED` | serial correlation 보정 없이 sample Sharpe만 있음 | warning |
| `NON_IID_RETURN_SAMPLE` | return sample이 독립 동일분포로 보기 어렵다는 진단 | warning |
| `SKEW_OR_KURTOSIS_UNAVAILABLE` | PSR/DSR 후보 계산에 필요한 왜도/첨도를 계산하지 못함 | warning |
| `SELECTION_CONTEXT_MISSING` | selected candidate의 선택 context가 없음 | warning |
| `MULTIPLE_TESTING_CONTEXT_MISSING` | DSR 후보 계산에 필요한 candidate/trial 수가 없음 | warning |
| `SHARPE_VALIDATION_NOT_IMPLEMENTED` | PSR/DSR/Lo-adjusted Sharpe 또는 report 연결이 아직 없음 | info |

## 계산 정책

현재 standalone calculator와 후속 calculator 확장은 다음 정책을 따른다.

- finite number return sample만 사용하고 `NaN`, `Infinity`는 sample에서 제외한다.
- sample 수가 minimum보다 작으면 Sharpe 계열 metric을 `null`로 둔다.
- volatility가 0이면 ratio를 만들지 않는다.
- annualization은 return frequency와 annualization factor가 명시될 때만 허용한다.
- serial correlation 보정이 없으면 `SERIAL_CORRELATION_NOT_ADJUSTED` warning을 남긴다.
- `autocorrelationMaxLag`가 지정되면 lag별 autocorrelation coefficient를 계산하고, 절댓값이 0.2 이상인 coefficient가 있으면 `NON_IID_RETURN_SAMPLE` warning을 남긴다.
- standalone calculator는 sample Sharpe만 `computed`로 채울 수 있다.
- PSR/DSR 후보는 skewness, kurtosis, benchmark Sharpe, candidate/trial context가 충분할 때만 계산한다.
- 여러 strategy, prompt, risk profile, allocation policy 후보 중 best result를 고른 경우 `selectionContext`와 warning을 함께 기록한다.

## Report 연결 계획

후속 PR은 다음 순서로 연결한다.

1. `HistoricalReplayReport.advancedPerformance` 또는 별도 `sharpeValidation` field에 single replay 검증 결과를 연결한다.
2. `BatchReplayAggregateReport` group summary에 Sharpe validation을 연결한다.
3. Probabilistic Sharpe Ratio, Deflated Sharpe Ratio, Lo-adjusted Sharpe 계산을 selection context와 함께 확장한다.
4. `ReplayResearchReport`와 Next.js Validation Lab에서 unavailable/available 상태와 warning을 read-only로 표시한다.

## Safety Boundary

이 contract는 다음 surface를 만들지 않는다.

- live order placement
- broker write path
- enabled live-order MCP tool
- unreviewed command execution
- NL order request
- live `TradingSignal` 또는 live `OrderIntent` 생성
- AI confidence를 position sizing으로 직접 연결하는 경로

Sharpe validation은 paper-only 사후 검증 경고다. AI는 direction/evidence provider에 머물고 final sizing과 gate는 deterministic backend와 Risk Engine이 담당한다.
