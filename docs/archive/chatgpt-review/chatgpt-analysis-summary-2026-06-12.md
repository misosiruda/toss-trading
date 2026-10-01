# ChatGPT Analysis Summary

이 문서는 `2026-06-12 15:53 KST` 기준 historical replay 첨부 스냅샷에 대해 ChatGPT가 반환한 분석 결과를 프로젝트 의사결정용으로 정리한 것입니다.

원문:

```text
docs/chatgpt-review/chatgpt-analysis-raw-2026-06-12.md
```

관련 입력:

```text
docs/chatgpt-review/chatgpt-review-prompt-2026-06-12.md
docs/chatgpt-review/historical-replay-log-summary-2026-06-12-1553-kst.json
docs/chatgpt-review/historical-replay-progress-snapshot-2026-06-12-1553-kst.json
docs/historical-replay-diagnostic-brief.md
```

## 결론

ChatGPT 분석 결론은 명확합니다.

현재 로그만으로는 AI paper strategy의 투자성을 판단할 수 없습니다. 판단 가능한 것은 전략 수익성이 아니라 다음 시스템 진단 항목입니다.

- 백테스트 신뢰도 결함
- portfolio state와 mark-to-market 결함
- append-only audit trail 부재
- AI decision schema와 Risk Engine 계약 불일치
- Risk reject 반복 패턴
- benchmark 및 성과 metric 부재

따라서 현재 결과는 수익성 판단 자료가 아니라 구현 개선 우선순위를 정하는 진단 자료로만 사용해야 합니다.

## 핵심 근거

### 1. Replay 미완료

분석 기준 snapshot은 `605 / 1272 ticks`, `47.56%` 진행 상태입니다. `finalReportPath`도 `null`입니다.

중간 snapshot만으로 total return, max drawdown, benchmark 대비 alpha, 승률, 사후 수익 attribution을 판단하면 표본 절단 편향이 생깁니다.

### 2. NAV와 PnL 신뢰도 부족

포지션별 `marketPriceKrw`가 `null`이고 `unrealizedPnlKrw`가 모두 `0`입니다.

이 문제는 단순 UI 표시 문제가 아닙니다. 다음 값이 모두 오염될 수 있습니다.

- `virtualNetWorthKrw`
- `positionMarketValueKrw`
- 종목별 `weightPct`
- symbol exposure 판단
- portfolio timeline
- benchmark 비교
- drawdown 계산

### 3. Snapshot은 감사 로그가 아님

현재 progress는 `recentDecisions`, `recentRiskDecisions`, `recentPackets` 중심입니다. 전체 replay를 재현하기 위한 event history가 아닙니다.

필요한 로그:

```text
packet_log.ndjson
ai_decision_log.ndjson
normalized_order_log.ndjson
risk_decision_log.ndjson
virtual_trade_log.ndjson
portfolio_timeline.ndjson
run_metadata.json
final_report.json
```

### 4. SELL decision contract 불일치

반복되는 reject code:

```text
VIRTUAL_SELL_AMOUNT_REQUIRED
VIRTUAL_SELL_AMOUNT_EXCEEDED
VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED
```

이는 AI가 매도 의도를 냈지만 Risk Engine이 요구하는 주문 수량/금액 계약을 충족하지 못했다는 신호입니다. 전략 자체의 성과 실패라기보다 인터페이스 계약 실패에 가깝습니다.

핵심 원칙:

```text
AI는 sell amount를 계산하지 않는다.
AI는 sell intent와 sizing mode를 낸다.
Risk Engine이 현재 포지션과 가격 기준으로 executable order를 만든다.
PaperOrderEngine은 normalized order만 체결한다.
```

## 반영할 설계 결정

### Decision Schema V2

SELL은 금액 중심이 아니라 수량, 비율, 목표 비중 중심으로 표현합니다.

```ts
type VirtualDecisionV2 =
  | {
      action: "VIRTUAL_HOLD";
      symbol: string;
      confidence: number;
      reasonCodes: string[];
      expiresAt: string;
    }
  | {
      action: "VIRTUAL_BUY";
      symbol: string;
      budgetKrw?: number;
      targetWeightPct?: number;
      maxBudgetKrw?: number;
      confidence: number;
      reasonCodes: string[];
      expiresAt: string;
    }
  | {
      action: "VIRTUAL_SELL";
      symbol: string;
      reduceOnly: true;
      sellQuantity?: number;
      sellRatio?: number;
      targetWeightPct?: number;
      sellAll?: boolean;
      confidence: number;
      reasonCodes: string[];
      expiresAt: string;
    };
```

### Normalized Virtual Order

AI decision을 바로 체결하지 않고 Risk Engine 앞에서 정규화합니다.

```ts
type NormalizedVirtualOrder = {
  action: "VIRTUAL_BUY" | "VIRTUAL_SELL" | "VIRTUAL_HOLD";
  symbol: string;
  quantity: number;
  expectedPriceKrw: number;
  notionalKrw: number;
  reduceOnly: boolean;
  originalDecisionRef: string;
  normalizationNotes: string[];
};
```

SELL normalization 원칙:

- `sellAll`: 현재 보유 수량 전량
- `sellRatio`: 현재 보유 수량의 비율
- `targetWeightPct`: 현재 비중에서 목표 비중까지 필요한 수량
- `sellQuantity`: 보유 수량 이하로 검증
- sizing 없음: `DECISION_SCHEMA_INVALID`
- 요청 수량 초과: `SELL_CLIPPED_TO_AVAILABLE_POSITION` 또는 명시 reject

### Reserve, Exposure, Cooldown

현금 reserve는 BUY에만 적용합니다. SELL은 현금을 늘리는 reduce-risk action이므로 reserve 때문에 막지 않습니다.

Exposure 원칙:

```text
이미 exposure 초과인 종목:
- BUY는 차단
- HOLD는 허용
- SELL은 허용
```

Cooldown은 최소 3종류로 나눕니다.

- `postFillCooldown`
- `postRejectCooldown`
- `oppositeActionCooldown`

단, 강제 리스크 축소성 SELL은 cooldown 예외로 둡니다.

## 우선순위

ChatGPT 분석은 P0를 다음 묶음으로 봤습니다.

1. Portfolio mark-to-market
2. Portfolio timeline
3. Append-only audit trail

현재 프로젝트 계획에는 audit log를 PR 1, mark-to-market을 PR 2로 나누되 둘 다 P0로 처리합니다. 이유는 구현 단위와 검증 단위가 다르지만, 둘 중 하나만으로는 투자성 평가가 불가능하기 때문입니다.

## PR 단위 반영 계획

| 우선순위 | PR | 핵심 효과 |
| --- | --- | --- |
| P0 | PR-1 Audit log + portfolio timeline | replay 재현성 확보 |
| P0 | PR-2 Mark-to-market / PnL fix | NAV, exposure, 성과 신뢰도 확보 |
| P0 | PR-3 AI decision schema v2 | sell reject storm 원인 제거 |
| P1 | PR-4 Risk normalization + policies | reserve/exposure/cooldown 적용 |
| P1 | PR-5 Paper execution model | 체결 현실성 확보 |
| P1 | PR-6 Benchmark report | buy-and-hold 대비 판단 가능 |
| P2 | PR-7 Dashboard diagnostic panels | 운영 진단 속도 개선 |
| P2 | PR-8 Regression tests | 재발 방지 |

### PR-1. Append-only audit log + portfolio timeline

목표:

- snapshot 기반 운영에서 재현 가능한 event-sourced replay로 전환합니다.

주요 산출물:

- `packet_log.ndjson`
- `ai_decision_log.ndjson`
- `normalized_order_log.ndjson`
- `risk_decision_log.ndjson`
- `virtual_trade_log.ndjson`
- `portfolio_timeline.ndjson`
- `run_metadata.json`

완료 기준:

- progress snapshot 없이 event log만으로 최종 portfolio를 재구성할 수 있어야 합니다.
- `decisionProviderCallCount`, `decisionRecordCount`, `riskDecisionCount`, `tradeCount`가 log count와 일치해야 합니다.
- 모든 trade가 `packetId -> decisionId -> riskDecisionId -> tradeId -> portfolioSnapshotId`로 연결되어야 합니다.

### PR-2. Mark-to-market / PnL / stale price fix

목표:

- `marketPriceKrw: null`, `unrealizedPnlKrw: 0` 문제를 제거합니다.

완료 기준:

```text
cashKrw + sum(position.marketValueKrw) == virtualNetWorthKrw
position.marketValueKrw == quantity * marketPriceKrw
unrealizedPnlKrw != forced zero
no position has null marketPriceKrw if candidate/history price exists
```

### PR-3. AI decision schema v2

목표:

- SELL amount reject 반복을 schema 단계에서 제거합니다.

완료 기준:

- `VIRTUAL_SELL_AMOUNT_REQUIRED`가 정상 decision에서는 발생하지 않아야 합니다.
- sizing 없는 SELL은 parser를 통과하지 않아야 합니다.
- original decision과 normalized order가 모두 저장되어야 합니다.

### PR-4. Risk normalization + reserve/exposure/cooldown

목표:

- AI decision을 executable virtual order로 정규화하고 정책 기반 gate를 적용합니다.

완료 기준:

- exposure 초과 종목의 BUY는 차단합니다.
- exposure 초과 종목의 SELL은 차단하지 않습니다.
- 같은 symbol/action/reject code가 반복되면 cooldown이 발동합니다.
- risk log에 `originalDecision`, `normalizedOrder`, `checkedRules`, `adjustments`, `rejectCodes`가 남습니다.

### PR-5. PaperOrderEngine execution model

목표:

- 가상 체결의 현실성과 재현성을 개선합니다.

주요 항목:

- fill price rule 명시
- look-ahead 방지
- fee/slippage/tax model 추가
- partial fill 옵션
- fractional share 허용 여부 config화
- fill 후 portfolio reconciliation

### PR-6. Benchmark + final historical-replay-report.json

목표:

- 투자성 판단에 필요한 최소 리포트를 생성합니다.

필수 benchmark:

- same-universe equal-weight buy-and-hold
- initial-portfolio buy-and-hold
- cash-only baseline
- broad KR market index proxy

필수 metric:

- total return
- volatility
- Sharpe 또는 유사 위험 조정 지표
- Sortino
- max drawdown
- turnover
- fee/slippage drag
- decision outcome attribution
- risk reject attribution

### PR-7. Dashboard diagnostic panels

목표:

- 운영자가 문제를 빠르게 파악할 수 있게 합니다.

추가 패널:

- Replay status
- NAV & drawdown
- Portfolio M2M health
- Decision funnel
- Risk reject heatmap
- Reject loop detector
- Exposure panel
- Cooldown panel
- Order lifecycle
- Data lineage
- Confidence calibration
- Fee/slippage impact
- Schema error panel

### PR-8. Regression tests

목표:

- 같은 결함이 재발하지 않도록 고정합니다.

테스트 항목:

- schema validation unit test
- sell normalization unit test
- risk policy unit test
- portfolio invariant property test
- replay golden file test
- reject loop regression test
- mark-to-market stale price test
- benchmark report snapshot test

## 최종 반영 방침

현재 시스템은 `paper_only` 안전 경계는 유지하고 있지만, 백테스트 신뢰도 관점에서는 아직 평가 가능한 상태가 아닙니다.

따라서 다음 작업 전까지 수익성 결론을 내리지 않습니다.

1. portfolio state와 audit trail을 고칩니다.
2. sell schema와 Risk Engine normalization을 고칩니다.
3. benchmark와 final report를 생성합니다.
4. 전체 2개월 replay를 다시 실행합니다.
