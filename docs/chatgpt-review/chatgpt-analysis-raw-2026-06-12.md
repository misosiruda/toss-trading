2026-06-12 15:53 KST 첨부 스냅샷 기준입니다. 결론은 명확합니다.

## 1. 투자성 판단 가능 여부

**불가능합니다.**

이 로그만으로는 현재 AI paper strategy가 “투자성이 있다”거나 “buy-and-hold보다 낫다”고 판단하면 안 됩니다. 판단 가능한 것은 **전략 성과**가 아니라 **시스템 상태, 데이터 로깅 결함, 리스크 게이트 동작, 주문 스키마 불일치**입니다.

현재 자료는 `paper_only` replay이고, live trading이 아니며, AI가 최종 주문 결정을 하지 않고 Risk Engine이 최종 gate라는 안전 경계를 명시합니다. 따라서 이 검토는 전략 수익성 판단이 아니라 백테스트 신뢰도와 시스템 설계 품질 검토로 제한해야 합니다. 

---

## 2. 근거

### 2.1 Replay가 아직 절반도 끝나지 않았음

첨부 요약 기준 replay는 `running`, `605 / 1272 ticks`, `47.56%` 완료 상태이고 `finalReportPath`는 `null`입니다. 즉 최종 성과 리포트가 없습니다. 이 상태에서 수익률, 승률, MDD, benchmark 대비 alpha를 판단하면 표본 절단 편향이 생깁니다. 

본문에 적은 숫자와 첨부파일 숫자가 약간 다릅니다. 본문은 583 tick, 45.83% 기준이고, 첨부 summary는 605 tick, 47.56% 기준입니다. 판단은 동일합니다. **둘 다 미완료 중간 스냅샷**입니다.

### 2.2 현재 NAV와 PnL 신뢰도가 낮음

포지션별 `marketPriceKrw`가 `null`이고 `unrealizedPnlKrw`가 전부 `0`으로 저장되어 있습니다. 반면 replay packet 안의 candidate에는 `lastPriceKrw`가 존재합니다. 즉 가격 데이터는 일부 존재하지만 portfolio state에 정상 mark-to-market으로 반영되지 않고 있습니다. 

이 상태에서는 다음 값들이 모두 의심 대상입니다.

| 항목                       | 문제                             |
| ------------------------ | ------------------------------ |
| `virtualNetWorthKrw`     | stale `marketValueKrw` 기반일 가능성 |
| `positionMarketValueKrw` | 최신 가격 반영 여부 불명확                |
| `weightPct`              | exposure limit 판단에 쓰기 위험       |
| `unrealizedPnlKrw`       | 전부 0이면 성과 분석 불가                |
| risk exposure            | 현재가 기준인지 평균가/마지막 체결가 기준인지 불명확  |

이건 단순 표시 버그가 아닙니다. Risk Engine의 `symbol_exposure`, Portfolio timeline, benchmark 비교, drawdown 계산까지 전부 오염시킬 수 있습니다.

### 2.3 로그가 append-only audit trail이 아님

요약 파일은 현재 snapshot이 전체 판단 로그가 아니라 `recentDecisions`, `recentRiskDecisions`, `recentPackets` 중심이라고 명시합니다. 또한 최종 report, benchmark, max drawdown, slippage, fees, tax, out-of-sample metric이 없다고 명시되어 있습니다. 

따라서 현재 로그로는 다음을 재구성할 수 없습니다.

| 필요한 분석                                              | 현재 가능 여부 |
| --------------------------------------------------- | -------: |
| tick별 NAV curve                                     |      불충분 |
| decision → risk → order → fill → portfolio state 재현 |      부분적 |
| AI 판단의 사후 성과 attribution                            |      불가능 |
| reject가 성과에 미친 영향                                   |      불충분 |
| 수수료/슬리피지 반영 성과                                      |      불가능 |
| benchmark 대비 초과수익                                   |      불가능 |

### 2.4 Risk Engine은 동작하지만, decision contract와 맞지 않음

Risk decision은 `packet_freshness`, `decision_freshness`, `candidate_presence`, `candidate_price`, `cash_limit`, `budget_limit`, `symbol_exposure`, `sell_position` 같은 rule을 검사하고 있습니다. 즉 gate 자체는 존재합니다. 

문제는 반복 reject code입니다.

* `VIRTUAL_SELL_AMOUNT_REQUIRED`
* `VIRTUAL_SELL_AMOUNT_EXCEEDED`
* `VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED`

첨부 progress snapshot에는 같은 형태의 sell reject가 여러 tick과 여러 symbol에서 반복됩니다. 예를 들어 `028300`, `042660`, `035900`, `000660`, `005930`에서 sell amount required/exceeded가 반복적으로 발생합니다.  

이건 AI가 “매도 의도”를 냈는데, Risk Engine이 요구하는 주문 수량/금액 계약을 충족하지 못하는 상태입니다. 즉 **전략 실패라기보다 인터페이스 계약 실패**입니다.

### 2.5 최근 action/reject/trade 통계는 성능 지표가 아님

첨부 요약 기준 recent action count는 `VIRTUAL_BUY 15`, `VIRTUAL_HOLD 249`, `VIRTUAL_SELL 36`이고, 최근 reject code는 `SELL_AMOUNT_EXCEEDED 6`, `SELL_AMOUNT_REQUIRED 3`, `SYMBOL_EXPOSURE_EXCEEDED 4`입니다. 가상 체결은 `BUY 20건 / 18,884,161 KRW`, `SELL 6건 / 11,442,525 KRW`입니다. 

이 숫자는 시스템 진단에는 유용하지만 성과 판단에는 부족합니다. 이유는 다음과 같습니다.

| 통계                | 해석 가능            | 해석 불가                |
| ----------------- | ---------------- | -------------------- |
| BUY/SELL/HOLD 비율  | 전략이 얼마나 자주 행동하는지 | 행동이 수익을 냈는지          |
| Risk reject count | rule 충돌이 있는지     | reject가 손실을 줄였는지     |
| trade amount      | 회전율 추정           | risk-adjusted return |
| 보유 종목 수           | 집중도 확인           | 적정 포트폴리오 여부          |

---

## 3. 데이터 한계

### 3.1 성과 판단에 필요한 데이터가 빠져 있음

현재 반드시 추가되어야 하는 데이터는 다음입니다.

| 데이터                                       | 필요한 이유                    |
| ----------------------------------------- | ------------------------- |
| tick별 portfolio NAV                       | 수익률, 변동성, drawdown 계산     |
| tick별 cash / position / price / PnL       | state transition 검증       |
| realized / unrealized PnL 분리              | 매도 성과와 보유 성과 분리           |
| full decision log                         | AI 판단 전체 분포와 drift 분석     |
| full risk decision log                    | reject 원인과 성과 영향 분석       |
| full trade blotter                        | 체결 품질, 수수료, 슬리피지 분석       |
| benchmark NAV curve                       | buy-and-hold 대비 비교        |
| fee / tax / slippage model                | 현실성 있는 replay             |
| model version / prompt hash / config hash | 재현성                       |
| data source timestamp / stale flag        | look-ahead, stale data 검증 |
| out-of-sample split                       | 과최적화 방지                   |
| corporate action / split adjustment       | 가격 시계열 정합성                |
| liquidity / volume constraint             | 체결 가능성 검증                 |

### 3.2 현재 snapshot 구조는 운영 진단에 부족함

`recentDecisions 50`, `recentRiskDecisions 50`, `recentPackets 10` 방식은 UI에는 편하지만 연구/감사 로그로는 부족합니다. 장애 발생 시 “왜 이 체결이 발생했는가?”를 완전 재현할 수 있어야 합니다.

필요한 구조는 snapshot이 아니라 append-only event sourcing입니다.

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

### 3.3 현재 포지션 평가는 stale 가능성이 큼

포지션에는 `updatedAt`이 symbol별로 다르고, `marketPriceKrw`는 없으며, `unrealizedPnlKrw`는 0입니다. 그런데 recent packet candidate에는 `lastPriceKrw`, `sourceRefs`, `collectedAt`, `staleAfter`가 들어 있습니다. 

즉 price feed와 portfolio valuation 사이의 연결이 끊겨 있습니다. 이 상태에서는 exposure limit도 “현재가 기준”이 아니라 “마지막 portfolio update 기준”으로 동작할 수 있습니다.

### 3.4 fractional quantity 정책이 불명확함

가상 체결 수량이 소수점입니다. 예를 들어 progress snapshot에는 `quantity: 0.345240...`, `7.023705...` 같은 fractional quantity 체결이 존재합니다. 

paper-only라서 fractional simulation 자체는 허용할 수 있습니다. 하지만 시스템 신뢰도를 위해서는 둘 중 하나를 명시해야 합니다.

| 선택지                         | 의미                  |
| --------------------------- | ------------------- |
| fractional virtual share 허용 | 순수 연구용, 실거래 현실성과 분리 |
| integer lot rule 적용         | 한국 주식 체결 현실성 강화     |

현재는 정책이 불명확합니다.

---

## 4. 우선 개선점

## 4.1 가장 먼저 고쳐야 할 결함

**P0 결함은 Portfolio mark-to-market / timeline / audit trail입니다.**

이유는 단순합니다. NAV, PnL, exposure가 신뢰되지 않으면 어떤 전략 평가도 무의미합니다. AI가 잘했는지, Risk Engine이 잘 막았는지, PaperOrderEngine이 제대로 체결했는지 모두 portfolio state에 의존합니다.

다음은 같은 P0 묶음으로 봐야 합니다.

1. `marketPriceKrw` null 제거
2. `unrealizedPnlKrw = 0` 고정 저장 제거
3. tick별 portfolio snapshot append-only 저장
4. trade 이후 cash/position/NAV reconciliation
5. stale price metadata 저장
6. full decision/risk/trade audit log 저장

## 4.2 개선 순서

권장 순서는 다음입니다.

| 순서 | 컴포넌트                                     | 이유                                                                      |
| -: | ---------------------------------------- | ----------------------------------------------------------------------- |
|  1 | **Portfolio timeline / mark-to-market**  | 성과와 리스크 판단의 기준 데이터. 이것 없이는 모든 metric이 오염됨                               |
|  2 | **AI decision schema v2**                | sell intent, sizing, target exposure를 명확히 해야 reject storm 제거 가능         |
|  3 | **Risk Engine normalization / policy**   | AI decision을 canonical virtual order로 변환하고 reserve/exposure/cooldown 적용 |
|  4 | **PaperOrderEngine**                     | 체결 가격, 수수료, 슬리피지, 부분체결, lot rule을 현실적으로 반영                              |
|  5 | **Benchmark / final report / dashboard** | 전략 평가와 운영 진단을 자동화                                                       |

즉 질문의 네 컴포넌트만 놓고 보면:

```text
Portfolio timeline
→ AI decision schema
→ Risk Engine
→ PaperOrderEngine
```

단, `AI decision schema`와 `Risk Engine`은 실제 PR에서는 강하게 결합되어야 합니다. 스키마만 바꾸고 Risk Engine이 normalize하지 않으면 같은 문제가 다시 납니다.

---

## 4.3 Sell amount reject 반복 문제 해결

현재 sell reject는 대략 두 유형입니다.

| Reject code                    | 의미                                   |
| ------------------------------ | ------------------------------------ |
| `VIRTUAL_SELL_AMOUNT_REQUIRED` | AI가 sell action을 냈지만 매도 금액/수량이 없거나 0 |
| `VIRTUAL_SELL_AMOUNT_EXCEEDED` | 요청 매도 금액이 현재 보유 평가액 또는 가능 수량보다 큼     |

근본 원인은 **SELL을 amount 중심으로 표현하는 schema**입니다. SELL은 금액보다 **수량, 비율, 목표 비중**으로 표현해야 합니다.

### 권장 decision contract

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
      sellRatio?: number;        // 0 < sellRatio <= 1
      targetWeightPct?: number;  // currentWeight → targetWeight
      sellAll?: boolean;
      confidence: number;
      reasonCodes: string[];
      expiresAt: string;
    };
```

### Risk Engine normalize 규칙

AI decision을 바로 체결하지 말고 Risk Engine 앞에서 normalized order로 변환해야 합니다.

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

SELL normalization은 이렇게 처리합니다.

| 입력                | 처리                                                              |
| ----------------- | --------------------------------------------------------------- |
| `sellAll: true`   | 현재 보유 수량 전량                                                     |
| `sellRatio: 0.5`  | 현재 보유 수량의 50%                                                   |
| `targetWeightPct` | 현재 비중에서 목표 비중까지 필요한 수량                                          |
| `sellQuantity`    | 보유 수량 이하로 검증                                                    |
| sizing 없음         | schema invalid. Risk reject가 아니라 decision validation error      |
| 요청 수량 > 보유 수량     | `CLIPPED_TO_POSITION` 또는 reject. paper 연구 목적이면 clipping 후 로그 권장 |

중요한 원칙은 다음입니다.

```text
AI는 sell amount를 계산하지 않는다.
AI는 sell intent와 sizing mode를 낸다.
Risk Engine이 현재 포지션과 가격 기준으로 executable order를 만든다.
PaperOrderEngine은 normalized order만 체결한다.
```

### reject 대신 adjustment를 남겨야 하는 경우

`SELL_AMOUNT_EXCEEDED`는 매도 의도가 명확하고 보유 수량보다 약간 큰 경우 reject보다 clipping이 낫습니다.

```json
{
  "riskAction": "ADJUSTED_APPROVED",
  "adjustmentCode": "SELL_CLIPPED_TO_AVAILABLE_POSITION",
  "requestedQuantity": 9.10,
  "approvedQuantity": 9.03
}
```

반면 `SELL_AMOUNT_REQUIRED`는 자동 추론하면 위험합니다. 이건 LLM schema 오류로 보고 `DECISION_SCHEMA_INVALID`로 분류하는 게 맞습니다.

---

## 4.4 현금 reserve, exposure limit, cooldown 정책

이건 전략 추천이 아니라 시스템 정책 형태로 넣어야 합니다. 값은 backtest config로 주입하고, dashboard에서 변경 이력을 남겨야 합니다.

### Cash reserve

```ts
availableCashKrw =
  cashKrw - max(minCashReserveKrw, virtualNetWorthKrw * minCashReservePct);
```

정책:

| 항목                  | 권장 형태                             |
| ------------------- | --------------------------------- |
| `minCashReservePct` | NAV 대비 최소 현금 비율                   |
| `minCashReserveKrw` | 절대 최소 현금                          |
| `reserveMode`       | `HARD_BLOCK` 또는 `SOFT_SCALE_DOWN` |
| BUY 처리              | reserve 침범 시 reject 또는 budget 축소  |
| SELL 처리             | reserve와 무관하게 허용                  |

BUY만 reserve 영향을 받아야 합니다. SELL은 현금을 늘리는 reduce-risk action이므로 reserve 때문에 막으면 안 됩니다.

### Exposure limit

```ts
postTradeWeightPct =
  postTradeSymbolMarketValueKrw / postTradeNetWorthKrw;
```

정책:

| Limit                  | 설명              |
| ---------------------- | --------------- |
| `maxSymbolWeightPct`   | 단일 종목 최대 비중     |
| `maxSectorWeightPct`   | 섹터 집중 방지        |
| `maxGrossExposurePct`  | 총 주식 노출 한도      |
| `maxNewPositions`      | 신규 종목 수 제한      |
| `maxAddPerTickKrw`     | 한 tick 신규 투입 한도 |
| `maxTurnoverPerDayPct` | 과도한 회전 방지       |

중요 규칙:

```text
이미 exposure 초과인 종목:
- BUY는 차단
- HOLD는 허용
- SELL은 허용
```

현재 recent reject에 `VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED`가 반복되므로, 초과 종목에 대한 BUY intent는 cooldown까지 같이 걸어야 합니다. 

### Cooldown

cooldown은 최소 3종류로 분리하는 것이 좋습니다.

| Cooldown                 | 목적                             |
| ------------------------ | ------------------------------ |
| `postFillCooldown`       | 방금 체결한 종목을 바로 재매매하지 않음         |
| `postRejectCooldown`     | 같은 reject를 반복하지 않음             |
| `oppositeActionCooldown` | BUY 직후 SELL, SELL 직후 BUY 회전 억제 |

예시 정책:

```ts
cooldownKey = `${runId}:${symbol}:${action}`;

if (lastRejectedCode === "VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED") {
  blockSameSymbolBuyUntil = currentTick + exposureRejectCooldownTicks;
}

if (lastFillAction === "VIRTUAL_BUY") {
  blockSellUntil = currentTick + minHoldTicks;
}
```

단, 강제 리스크 축소성 SELL은 cooldown 예외로 둬야 합니다.

---

## 5. 추가 수집 데이터

### 5.1 성과 평가용

| 데이터                | 필수 필드                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Portfolio timeline | `tickIndex`, `simulatedAt`, `cash`, `marketValue`, `NAV`, `realizedPnl`, `unrealizedPnl`               |
| Position timeline  | `symbol`, `quantity`, `avgPrice`, `marketPrice`, `marketValue`, `weight`, `unrealizedPnl`              |
| Trade blotter      | `decisionId`, `riskDecisionId`, `orderId`, `fillPrice`, `quantity`, `fee`, `tax`, `slippage`, `status` |
| Benchmark timeline | same timestamp NAV and return                                                                          |
| Drawdown series    | peak NAV, current drawdown, max drawdown                                                               |
| Return series      | tick return, daily return, cumulative return                                                           |

### 5.2 Decision attribution용

각 AI decision마다 사후 수익률을 붙여야 합니다.

```json
{
  "decisionId": "...",
  "symbol": "028300",
  "action": "VIRTUAL_BUY",
  "confidence": 0.74,
  "approved": true,
  "filled": true,
  "returnAfter1Tick": 0.012,
  "returnAfter4Ticks": -0.004,
  "returnAfter1Day": 0.018,
  "benchmarkReturnSameHorizon": 0.006,
  "excessReturn": 0.012
}
```

이게 있어야 AI가 낸 BUY/SELL/HOLD가 실제로 유효했는지 판단할 수 있습니다.

### 5.3 Benchmark

buy-and-hold 비교는 최소 4개가 필요합니다.

| Benchmark                             | 목적                |
| ------------------------------------- | ----------------- |
| 동일 universe equal-weight buy-and-hold | AI timing 효과 검증   |
| 최초 보유 포트폴리오 buy-and-hold              | 리밸런싱/매매 효과 검증     |
| broad KR market index proxy           | 시장 대비 성과 확인       |
| cash-only baseline                    | 위험자산 노출 자체의 효과 분리 |

가능하면 추가로 넣을 것:

| Benchmark                           | 목적                       |
| ----------------------------------- | ------------------------ |
| candidate score top-N rule strategy | AI 판단이 simple rule보다 나은지 |
| random action baseline              | 우연 대비 유의성                |
| risk-engine-only baseline           | Risk Engine만의 기여도 분리     |

### 5.4 Metrics

단순 수익률만 보면 안 됩니다. 최소 metric set은 다음입니다.

| Metric                   | 목적                        |
| ------------------------ | ------------------------- |
| Total return             | 전체 성과                     |
| CAGR 또는 기간 환산 수익률        | 기간 보정                     |
| Volatility               | 위험                        |
| Sharpe                   | 위험 대비 수익                  |
| Sortino                  | 하방 위험 대비 수익               |
| Max drawdown             | 최대 손실 구간                  |
| Calmar                   | drawdown 대비 수익            |
| Hit rate                 | 체결별 승률                    |
| Profit factor            | 총이익 / 총손실                 |
| Average win/loss         | 손익 비대칭                    |
| Turnover                 | 회전율                       |
| Fee/slippage drag        | 거래 비용 민감도                 |
| Exposure-adjusted return | 시장 노출 대비 효율               |
| Alpha/Beta               | benchmark 대비 요인           |
| Drawdown duration        | 회복 시간                     |
| Decision calibration     | confidence와 실제 outcome 관계 |

---

## 6. PR 단위 계획

## PR-1 — Append-only audit log + portfolio timeline

**목표:** snapshot 기반 운영에서 재현 가능한 event-sourced replay로 전환.

작업:

* `packet_log.ndjson`
* `ai_decision_log.ndjson`
* `normalized_order_log.ndjson`
* `risk_decision_log.ndjson`
* `virtual_trade_log.ndjson`
* `portfolio_timeline.ndjson`
* `run_metadata.json`

Acceptance criteria:

* progress snapshot 없이도 event log만으로 최종 portfolio 재구성 가능
* `decisionProviderCallCount`, `decisionRecordCount`, `riskDecisionCount`, `tradeCount`가 log count와 일치
* 모든 trade가 `packetId → decisionId → riskDecisionId → tradeId → portfolioSnapshotId`로 연결됨

---

## PR-2 — Mark-to-market / PnL / stale price fix

**목표:** `marketPriceKrw: null`, `unrealizedPnlKrw: 0` 문제 제거.

작업:

* tick마다 모든 보유 종목 가격 갱신
* `marketPriceKrw`, `priceSourceRef`, `priceTimestamp`, `staleAfter`, `isPriceStale` 저장
* `unrealizedPnlKrw = quantity * (marketPrice - averagePrice)` 계산
* realized PnL 별도 누적
* NAV invariant 검사

Acceptance criteria:

```text
cashKrw + sum(position.marketValueKrw) == virtualNetWorthKrw
position.marketValueKrw == quantity * marketPriceKrw
unrealizedPnlKrw != forced zero
no position has null marketPriceKrw if candidate/history price exists
```

---

## PR-3 — AI decision schema v2

**목표:** SELL amount reject storm 제거.

작업:

* discriminated union schema 도입
* SELL에서 `budgetKrw` 중심 표현 폐기
* `sellRatio`, `sellQuantity`, `targetWeightPct`, `sellAll` 도입
* HOLD는 budget/quantity 금지
* BUY는 `budgetKrw` 또는 `targetWeightPct`만 허용
* strict JSON schema validation
* invalid decision은 `DECISION_SCHEMA_INVALID`로 별도 로깅

Acceptance criteria:

* `VIRTUAL_SELL_AMOUNT_REQUIRED`가 정상 decision에서는 발생하지 않음
* AI decision parser가 sizing 없는 SELL을 통과시키지 않음
* original decision과 normalized order가 모두 저장됨

---

## PR-4 — Risk Engine normalization + reserve/exposure/cooldown

**목표:** AI decision을 executable virtual order로 정규화하고, 정책 기반 gate 적용.

작업:

* `normalizeDecisionToVirtualOrder()`
* SELL reduce-only enforcement
* oversized SELL clipping 또는 명시 reject
* cash reserve policy
* symbol/sector/gross exposure policy
* post-fill cooldown
* post-reject cooldown
* repeated reject suppression

Acceptance criteria:

* exposure 초과 종목의 BUY는 차단
* exposure 초과 종목의 SELL은 차단하지 않음
* 같은 symbol/action/reject code가 N회 반복되면 cooldown 발동
* risk log에 `originalDecision`, `normalizedOrder`, `checkedRules`, `adjustments`, `rejectCodes`가 모두 남음

---

## PR-5 — PaperOrderEngine execution model

**목표:** 가상 체결의 현실성과 재현성 개선.

작업:

* fill price rule 명시: current candle close, next open, VWAP proxy 중 하나
* look-ahead 방지
* fee/slippage/tax model 추가
* partial fill 옵션
* fractional share 허용 여부 config화
* fill 후 portfolio reconciliation

Acceptance criteria:

* 모든 fill이 price source와 timestamp를 가짐
* 수수료/슬리피지 on/off 비교 가능
* 체결 후 cash/quantity/NAV invariant 통과
* negative cash / negative position 불가

---

## PR-6 — Benchmark + final historical-replay-report.json

**목표:** 투자성 판단에 필요한 최소 리포트 생성.

작업:

* strategy NAV curve
* benchmark NAV curve
* same-universe buy-and-hold
* initial-portfolio buy-and-hold
* cash baseline
* total return, Sharpe, Sortino, MDD, turnover, fee drag
* decision attribution
* risk reject attribution

Acceptance criteria:

* `finalReportPath`가 null이 아니어야 함
* strategy vs benchmark 표 자동 생성
* transaction-cost on/off 결과 분리
* AI decision outcome table 생성

---

## PR-7 — Dashboard diagnostic panels

**목표:** 운영자가 즉시 문제를 파악할 수 있게 함.

추가 패널:

| 패널                     | 표시 내용                                              |
| ---------------------- | -------------------------------------------------- |
| Replay status          | progress, tick, packet, decision/risk/trade count  |
| NAV & drawdown         | strategy NAV, benchmark NAV, drawdown              |
| Portfolio M2M health   | null price, stale price, PnL mismatch              |
| Decision funnel        | packet → AI → risk → order → fill                  |
| Risk reject heatmap    | code × symbol × time                               |
| Reject loop detector   | 같은 reject 반복 경고                                    |
| Exposure panel         | symbol/sector/gross/cash reserve                   |
| Cooldown panel         | active cooldown, remaining ticks                   |
| Order lifecycle        | original decision → normalized order → risk → fill |
| Data lineage           | sourceRefs, collectedAt, staleAfter                |
| Confidence calibration | confidence bucket별 사후 성과                           |
| Fee/slippage impact    | cost drag                                          |
| Schema error panel     | invalid AI decision 목록                             |

---

## PR-8 — Test suite / regression replay

**목표:** 같은 결함이 재발하지 않도록 고정.

테스트:

* schema validation unit test
* sell normalization unit test
* risk policy unit test
* portfolio invariant property test
* replay golden file test
* reject loop regression test
* mark-to-market stale price test
* benchmark report snapshot test

Acceptance criteria:

```text
npm test / pnpm test에서 deterministic replay 통과
golden replay 결과가 허용 오차 내에서 일치
SELL sizing 없는 decision은 체결 path 진입 불가
portfolio NAV invariant 항상 통과
```

---

## 최종 우선순위 요약

| 우선순위 | PR                                  | 핵심 효과                        |
| ---: | ----------------------------------- | ---------------------------- |
|   P0 | PR-1 Audit log + portfolio timeline | 재현성 확보                       |
|   P0 | PR-2 Mark-to-market / PnL fix       | NAV, exposure, 성과 신뢰도 확보     |
|   P0 | PR-3 AI decision schema v2          | sell reject storm 원인 제거      |
|   P1 | PR-4 Risk normalization + policies  | reserve/exposure/cooldown 적용 |
|   P1 | PR-5 Paper execution model          | 체결 현실성 확보                    |
|   P1 | PR-6 Benchmark report               | buy-and-hold 대비 판단 가능        |
|   P2 | PR-7 Dashboard panels               | 운영 진단 속도 개선                  |
|   P2 | PR-8 Regression tests               | 재발 방지                        |

정리하면, 현재 시스템은 **paper-only 안전 경계는 적절히 분리되어 있지만, 백테스트 신뢰도 관점에서는 아직 평가 가능한 상태가 아닙니다.** 먼저 portfolio state와 audit trail을 고치고, 그 다음 sell schema와 Risk Engine normalization을 고쳐야 합니다. 그 전까지는 어떤 수익성 결론도 내리면 안 됩니다.
