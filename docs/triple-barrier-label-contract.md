# Triple Barrier Label Contract

이 문서는 RH7 `Triple Barrier And Meta-Labeling`의 design과 `triple_barrier_label.v1` label schema 후보를 정의한다.

범위는 paper-only historical replay와 batch replay 결과를 사후 평가할 때 쓰는 label/evaluation contract다. 이 문서는 실거래 주문, 브로커 쓰기 경로, live `TradingSignal`, live `OrderIntent`, AI confidence 기반 sizing, 자동 종목 추천을 추가하지 않는다.

## 현재 상태

현재 구현은 다음 구조를 가진다.

- `src/replay/purgedSplit.ts`는 `sampleId`, `labelStart`, `labelEnd`를 입력으로 받아 label horizon overlap과 embargo window가 있는 train sample을 제외한다.
- `BatchReplayAggregateReport.overfittingDiagnostics`와 `cpcv_pbo_validation.v1`은 candidate selection bias를 사후 경고로 표시한다.
- historical replay report와 dashboard는 PBO/Sharpe 계열 검증을 투자 조언이 아닌 read-only warning evidence로 표시한다.
- 아직 triple barrier label generator, label artifact, meta-label report는 없다.

## Contract 목표

RH7는 fixed horizon return label만으로 direction decision을 평가하는 한계를 줄이기 위해 다음 정보를 별도 artifact field로 고정한다.

| 항목 | 목적 | 기본 처리 |
| --- | --- | --- |
| `config` | profit-taking, stop-loss, time barrier 기준과 가격 source 기록 | invalid config는 fail-closed |
| `event` | 평가 대상 sample, symbol, market, observation time, label horizon 기록 | horizon이 없으면 label unavailable |
| `barriers` | upper/lower/time barrier와 touch timestamp 기록 | 다중 touch는 deterministic tie policy 기록 |
| `label` | direction outcome과 realized return ratio 기록 | 가격 부족 시 `unavailable` |
| `purgedSample` | purged validation에 전달할 `sampleId`, `labelStart`, `labelEnd` | overlap 제거는 기존 purged split layer가 담당 |
| `warnings` | missing price, invalid barrier, ambiguous touch, overlap policy warning | pass처럼 보이지 않게 명시 |

## TypeScript Schema 후보

Source of truth는 후속 구현에서 추가될 `src/replay/tripleBarrierLabel.ts`가 된다. 이 PR은 구현 전 contract 후보를 문서로 고정한다.

```typescript
export const TRIPLE_BARRIER_LABEL_SCHEMA_VERSION =
  "triple_barrier_label.v1";

interface TripleBarrierLabelArtifact {
  schemaVersion: typeof TRIPLE_BARRIER_LABEL_SCHEMA_VERSION;
  generatedAt: string;
  config: TripleBarrierLabelConfig;
  labels: TripleBarrierLabel[];
  summary: TripleBarrierLabelSummary;
  warnings: TripleBarrierLabelWarning[];
}
```

`config`는 barrier 해석과 재현성을 고정한다.

```typescript
interface TripleBarrierLabelConfig {
  labelProtocol: "triple_barrier";
  priceSource: "historical_market_snapshot";
  referencePriceField: "last" | "close";
  profitTakingReturnRatio: number;
  stopLossReturnRatio: number;
  timeBarrierDurationDays: number;
  barrierTouchPolicy: "first_touch";
  ambiguousTouchPolicy: "earliest_timestamp_then_stop_loss";
  configHash: string;
}
```

각 label은 evaluation artifact이며 주문 의도가 아니다.

```typescript
interface TripleBarrierLabel {
  labelId: string;
  sampleId: string;
  symbol: string;
  market: "KR" | "US" | "UNKNOWN";
  observationAt: string;
  labelStart: string;
  labelEnd: string;
  entryPrice: number | null;
  upperBarrierPrice: number | null;
  lowerBarrierPrice: number | null;
  touchedBarrier:
    | "profit_taking"
    | "stop_loss"
    | "time"
    | "unavailable";
  touchedAt: string | null;
  realizedReturnRatio: number | null;
  directionLabel:
    | "positive"
    | "negative"
    | "neutral"
    | "unavailable";
  status: "available" | "unavailable";
  purgedSample: TripleBarrierPurgedSample;
  warnings: TripleBarrierLabelWarning[];
}

interface TripleBarrierPurgedSample {
  sampleId: string;
  labelStart: string;
  labelEnd: string;
}
```

summary는 dashboard/report가 label quality를 설명할 때 사용한다.

```typescript
interface TripleBarrierLabelSummary {
  totalLabelCount: number;
  availableLabelCount: number;
  unavailableLabelCount: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  profitTakingCount: number;
  stopLossCount: number;
  timeBarrierCount: number;
  warningCount: number;
}
```

warning은 artifact-level과 per-label 모두 같은 shape를 사용한다. 특정 label에 묶이지 않는 config/source warning은 `labelId`와 `sampleId`를 `null`로 둔다.

```typescript
type TripleBarrierLabelWarningCode =
  | "TRIPLE_BARRIER_CONFIG_INVALID"
  | "TRIPLE_BARRIER_ENTRY_PRICE_MISSING"
  | "TRIPLE_BARRIER_PRICE_PATH_MISSING"
  | "TRIPLE_BARRIER_AMBIGUOUS_TOUCH"
  | "TRIPLE_BARRIER_TIME_BARRIER_ONLY"
  | "TRIPLE_BARRIER_PURGED_SAMPLE_MISSING"
  | "META_LABEL_SIZING_DIRECTIVE_REJECTED";

interface TripleBarrierLabelWarning {
  code: TripleBarrierLabelWarningCode;
  severity: "info" | "warning";
  message: string;
  labelId: string | null;
  sampleId: string | null;
}
```

meta-label은 sizing 명령이 아니라 evaluation signal로만 남긴다. 첫 구현에서는 생성하지 않고, 후속 report contract에서 다음 후보를 검토한다.

```typescript
interface MetaLabelCandidate {
  schemaVersion: "meta_label_candidate.v1";
  sourceLabelId: string;
  sideDecision: "long" | "short" | "hold" | "unknown";
  outcome: "correct_side" | "wrong_side" | "not_actionable";
  sizingDirective: null;
}
```

## Barrier Policy

- profit-taking barrier는 `entryPrice * (1 + profitTakingReturnRatio)`로 계산한다.
- stop-loss barrier는 `entryPrice * (1 - stopLossReturnRatio)`로 계산한다.
- time barrier는 `labelStart + timeBarrierDurationDays` 이후의 마지막 관측 가능 가격으로 평가한다.
- 같은 timestamp에서 upper/lower barrier가 동시에 touch된 것으로 보이면 `ambiguousTouchPolicy`에 따라 stop-loss를 우선 기록하고 warning을 남긴다.
- price source가 horizon 전체를 덮지 못하면 `status: "unavailable"`과 warning을 남긴다.
- 모든 계산은 replay observation time 이후 데이터만 label 평가 구간에 사용한다. feature packet 또는 decision packet에는 future label 값을 넣지 않는다.

## Purged Validation 연결

triple barrier label은 기존 purged split layer가 이해하는 `sampleId`, `labelStart`, `labelEnd`를 반드시 가진다.

후속 연결 원칙은 다음과 같다.

1. label generator가 `TripleBarrierPurgedSample` 목록을 만든다.
2. purged/embargo validation은 이 목록을 `PurgedKFoldSample` 호환 입력으로 사용한다.
3. `labelEnd`가 test label horizon과 겹치는 train sample은 기존 purge rule로 제외된다.
4. embargo는 test label window 이후 configured duration만큼 train 후보에서 제외한다.

## Warning Code 후보

| Code | 의미 | 기본 severity |
| --- | --- | --- |
| `TRIPLE_BARRIER_CONFIG_INVALID` | barrier ratio, duration, price field가 유효하지 않음 | warning |
| `TRIPLE_BARRIER_ENTRY_PRICE_MISSING` | label start에서 entry price를 찾을 수 없음 | warning |
| `TRIPLE_BARRIER_PRICE_PATH_MISSING` | label horizon 가격 path가 부족함 | warning |
| `TRIPLE_BARRIER_AMBIGUOUS_TOUCH` | 같은 timestamp에서 상하단 barrier touch가 충돌함 | warning |
| `TRIPLE_BARRIER_TIME_BARRIER_ONLY` | price barrier touch 없이 time barrier로 종료됨 | info |
| `TRIPLE_BARRIER_PURGED_SAMPLE_MISSING` | purged validation에 필요한 label horizon이 없음 | warning |
| `META_LABEL_SIZING_DIRECTIVE_REJECTED` | meta-label 후보가 sizing directive를 포함하려 함 | warning |

## Report And Dashboard Policy

- report와 dashboard는 label distribution, unavailable count, warning count를 설명한다.
- label distribution은 매수/매도 추천이나 성과 보장 문구로 표현하지 않는다.
- `directionLabel`은 사후 평가 결과이며 live signal이 아니다.
- meta-label은 side decision quality를 설명하는 후보일 뿐 order sizing이나 Risk Engine gate를 대체하지 않는다.

## 기존 구현과의 연결 계획

연결 순서는 다음과 같다.

1. 현재 범위: `triple_barrier_label.v1` design과 label schema 후보를 문서화한다.
2. label generator와 fixture test를 추가한다.
3. generated label horizon을 purged validation input으로 연결한다.
4. meta-label evaluation report와 dashboard 표시를 추가한다.

## Safety Boundary

이 contract는 다음 작업을 하지 않는다.

- 실거래 주문 생성
- 브로커 계좌 또는 주문 상태 변경
- raw shell command 실행 surface 추가
- 자연어 주문 요청 처리
- live `TradingSignal` 생성
- live `OrderIntent` 생성
- AI confidence를 deterministic sizing이나 gate보다 우선하는 구조
- 특정 ticker 권유 또는 투자 판단 권유 문구

Triple barrier와 meta-labeling은 direction decision을 사후 평가하는 paper-only research layer다. AI는 direction/evidence provider에 머물고 final sizing과 gate는 deterministic backend와 Risk Engine이 담당한다.
