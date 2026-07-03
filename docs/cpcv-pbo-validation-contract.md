# CPCV/PBO Validation Contract

이 문서는 RH6 `Full CPCV And PBO`의 design과 `cpcv_pbo_validation.v1` config/report schema, standalone PBO 계산 정책을 정의한다.

범위는 paper-only historical replay와 batch replay 결과를 사후 검증할 때 쓰는 validation contract다. 이 문서는 실거래 주문, 브로커 쓰기 경로, 원시 명령 실행 surface, 자동 strategy 배포를 추가하지 않는다.

## 현재 상태

현재 구현은 다음 구조를 가진다.

- `src/replay/validationProtocol.ts`는 `walk_forward` split schema와 `train`, `validation`, `test` role assignment를 정의한다.
- `src/replay/walkForwardSplit.ts`는 월 단위 rolling train/validation/test window를 만든다.
- `src/replay/purgedSplit.ts`는 `purged_k_fold` plan과 split schema를 제공한다. label interval overlap과 embargo window로 train sample을 제외한다.
- `BatchReplayAggregateReport.overfittingDiagnostics`는 `sampled_cpcv_pbo_like` diagnostic을 기록한다. selection trial과 validation split metadata를 join해 train 선택 후보, holdout degradation, split metric matrix, `pboLikeScore`를 계산한다.
- `src/replay/combinatorialPurgedCv.ts`는 `combinatorial_purged_cv` standalone split plan을 생성한다.
- `src/replay/cpcvPboValidation.ts`는 `cpcv_pbo_validation.v1` artifact schema와 standalone PBO calculator를 제공한다. batch report/dashboard 연결은 아직 후속 범위다.

## Contract 목표

RH6는 여러 strategy, prompt, policy 후보 중 우연히 높은 train 성과를 고른 위험을 더 명시적으로 기록하기 위해 다음 정보를 별도 artifact field로 고정한다.

| 항목 | 목적 | 기본 처리 |
| --- | --- | --- |
| `config` | fold 수, test fold 수, purge/embargo, combination budget 기록 | invalid config는 unavailable |
| `splitPlan` | CPCV fold 조합과 train/test sample id 기록 | budget 초과 시 sampled 또는 unavailable |
| `performanceMatrix` | candidate별 train/test metric matrix 기록 | 후보나 holdout sample 부족 시 warning |
| `selectionLog` | train metric 기준 selected candidate와 tie policy 기록 | deterministic tie-breaker 기록 |
| `pbo` | Probability of Backtest Overfitting 후보 계산 | matrix 부족 시에도 non-null 객체를 유지하고 `status`와 `probability=null`로 사유 기록 |
| `warnings` | insufficient matrix, budget, purge/embargo warning | pass처럼 보이지 않게 명시 |

## TypeScript Schema

Source of truth는 `src/replay/cpcvPboValidation.ts`다.

```typescript
export const CPCV_PBO_VALIDATION_SCHEMA_VERSION = "cpcv_pbo_validation.v1";

interface CpcvPboValidationReport {
  schemaVersion: typeof CPCV_PBO_VALIDATION_SCHEMA_VERSION;
  status: "available" | "sampled" | "unavailable";
  generatedAt: string;
  config: CpcvPboValidationConfig;
  splitPlan: CpcvSplitPlanSummary | null;
  performanceMatrix: CpcvCandidatePerformanceRow[];
  selectionLog: CpcvSelectionLogEntry[];
  pbo: CpcvPboEstimate;
  warnings: CpcvPboWarning[];
}
```

`config`는 generator와 calculator가 같은 해석을 쓰도록 고정한다.

```typescript
type CpcvPboValidationConfig =
  | CpcvPboExhaustiveValidationConfig
  | CpcvPboSampledValidationConfig;

interface CpcvPboValidationConfigBase {
  validationProtocol: "combinatorial_purged_cv";
  foldCount: number;
  testFoldCount: number;
  purgeDurationDays: number;
  embargoDurationDays: number;
  selectionMetric: "total_return_ratio";
  tieBreaker: "candidate_key_asc";
  maxCombinationCount: number;
}

interface CpcvPboExhaustiveValidationConfig
  extends CpcvPboValidationConfigBase {
  combinationMode: "exhaustive";
  randomSeed: null;
}

interface CpcvPboSampledValidationConfig
  extends CpcvPboValidationConfigBase {
  combinationMode: "sampled";
  randomSeed: string;
}
```

`splitPlan`은 full 조합을 artifact로 남기기 위한 요약이다.

```typescript
interface CpcvSplitPlanSummary {
  foldCount: number;
  testFoldCount: number;
  requestedCombinationCount: number;
  emittedCombinationCount: number;
  skippedCombinationCount: number;
  combinations: CpcvSplitCombination[];
}

interface CpcvSplitCombination {
  combinationId: string;
  combinationIndex: number;
  trainFoldIds: string[];
  testFoldIds: string[];
  trainSampleIds: string[];
  testSampleIds: string[];
  purgedSampleIds: string[];
  embargoedSampleIds: string[];
}
```

`performanceMatrix`는 PBO 계산 입력으로 사용한다.

```typescript
interface CpcvCandidatePerformanceRow {
  candidateKey: string;
  promptHash: string | null;
  configHash: string | null;
  riskPolicyHash: string | null;
  exitPolicyHash: string | null;
  splitMetrics: CpcvCandidateSplitMetric[];
}

interface CpcvCandidateSplitMetric {
  combinationId: string;
  trainMetric: number | null;
  testMetric: number | null;
  trainReturnSampleCount: number;
  testReturnSampleCount: number;
}
```

`pbo`는 계산 가능 여부와 산출 근거를 함께 기록한다.

```typescript
interface CpcvSelectionLogEntry {
  combinationId: string;
  selectedCandidateKey: string | null;
  selectedTrainMetric: number | null;
  selectedTestMetric: number | null;
  testRankPercentile: number | null;
  tieBreakApplied: boolean;
}

interface CpcvPboEstimate {
  status: "computed" | "insufficient_matrix" | "budget_exceeded" | "not_applicable";
  probability: number | null;
  evaluatedCombinationCount: number;
  selectedBelowMedianCount: number;
  lambdaLogitValues: number[];
  methodNotes: string[];
}

interface CpcvPboWarning {
  code:
    | "CPCV_CONFIG_INVALID"
    | "CPCV_COMBINATION_BUDGET_EXCEEDED"
    | "CPCV_SAMPLED_MODE_USED"
    | "CPCV_PURGE_OR_EMBARGO_REMOVED_ALL_TRAIN"
    | "PBO_CANDIDATE_COUNT_INSUFFICIENT"
    | "PBO_HOLDOUT_MATRIX_INSUFFICIENT"
    | "PBO_SELECTION_TIE_BREAK_APPLIED";
  severity: "info" | "warning";
  message: string;
}
```

## 계산 정책

standalone calculator는 다음 정책을 따른다.

- `foldCount`는 2 이상이어야 한다.
- `testFoldCount`는 1 이상이고 `foldCount`보다 작아야 한다.
- 전체 조합 수는 `nCk(foldCount, testFoldCount)`로 계산한다.
- `combinationMode="exhaustive"`에서 조합 수가 `maxCombinationCount`를 초과하면 report를 `unavailable`로 닫고 `pbo.status="budget_exceeded"`, `probability=null`로 기록한다.
- `combinationMode="sampled"`는 non-empty `randomSeed`를 필수로 요구한다.
- `combinationMode="sampled"`에서 조합 수가 `maxCombinationCount`를 초과하면 deterministic `randomSeed`로 조합을 sampling하고 report status를 `sampled`로 기록한다.
- purge는 label interval overlap을 train sample에서 제거한다.
- embargo는 test window 이후 설정된 기간의 train sample을 제거한다.
- train metric이 같은 후보는 `candidate_key_asc` tie breaker로 deterministic하게 선택한다.
- 각 combination에서 train metric 후보가 2개 이상일 때 train metric 기준으로 selected candidate를 고른다.
- train에서 경쟁한 모든 candidate가 같은 combination의 comparable test metric을 가진 경우에만 test rank percentile을 계산한다.
- test rank percentile은 descending rank의 mid-rank percentile이며, tied test metric 후보는 같은 percentile을 공유한다. PBO 후보는 selected candidate의 test rank percentile이 `0.5` 이하인 combination 비율과 logit rank 값을 함께 기록한다.
- train metric 후보가 2개 미만이거나 모든 combination이 같은 train candidate 집합 기준으로 scored 되지 않으면 `pbo.status="insufficient_matrix"` 또는 `pbo.status="not_applicable"`, `probability=null`, warning을 함께 기록한다.
- 모든 값은 paper-only 사후 검증 지표이며 strategy 자동 선택이나 sizing으로 연결하지 않는다.

## Warning Code 후보

| Code | 의미 | 기본 severity |
| --- | --- | --- |
| `CPCV_CONFIG_INVALID` | fold/test fold/purge/embargo config가 유효하지 않음 | warning |
| `CPCV_COMBINATION_BUDGET_EXCEEDED` | exhaustive mode에서 조합 수가 budget을 초과함 | warning |
| `CPCV_SAMPLED_MODE_USED` | full 조합 대신 sampled mode로 degrade됨 | info |
| `CPCV_PURGE_OR_EMBARGO_REMOVED_ALL_TRAIN` | purge/embargo 이후 train sample이 남지 않음 | warning |
| `PBO_CANDIDATE_COUNT_INSUFFICIENT` | 후보가 2개 미만이라 PBO를 계산할 수 없음 | warning |
| `PBO_HOLDOUT_MATRIX_INSUFFICIENT` | 일부 또는 전체 combination의 comparable test metric matrix가 부족함 | warning |
| `PBO_SELECTION_TIE_BREAK_APPLIED` | train metric 동률에서 deterministic tie breaker가 적용됨 | info |

## 기존 구현과의 연결 계획

연결 순서는 다음과 같다.

1. 완료: `combinatorial_purged_cv` standalone split generator를 기준으로 `cpcv_pbo_validation.v1` schema와 config parser를 코드에 추가한다.
2. 완료: PBO calculator가 train/test matrix에서 `CpcvPboEstimate`를 계산한다.
3. 후속: `BatchReplayAggregateReport.overfittingDiagnostics`의 sampled matrix를 새 artifact schema로 승격한다.
4. 후속: replay research report와 dashboard validation lab은 read-only warning으로만 표시한다.

## Safety Boundary

이 contract는 다음 작업을 하지 않는다.

- 실거래 주문 생성
- 브로커 계좌 또는 주문 상태 변경
- raw shell command 실행 surface 추가
- 자연어 주문 요청 처리
- AI confidence를 deterministic sizing이나 gate보다 우선하는 구조
- 특정 ticker 권유 또는 투자 판단 권유 문구

CPCV/PBO validation은 여러 후보를 비교한 뒤 selection bias를 설명하는 paper-only 사후 검증 layer다. AI는 direction/evidence provider에 머물고 final sizing과 gate는 deterministic backend와 Risk Engine이 담당한다.
