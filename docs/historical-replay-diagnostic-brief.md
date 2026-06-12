# Historical Replay Diagnostic Brief

이 문서는 현재 실행 중인 paper-only historical replay 로그를 기준으로 알고리즘 개선 포인트, 근거 자료, 외부 ChatGPT 검토용 프롬프트를 정리합니다.

이 문서는 투자 조언, 수익률 보장, 실계좌 성과 판단 문서가 아닙니다. 현재 로그는 `paper_only` 가상 투자 진행 중 snapshot이며, 실거래 주문을 만들거나 우회하지 않습니다.

## 기준 로그

로그 파일:

```text
data/replay-2026-04-12-2026-06-12/historical-replay-progress.json
```

확인 시점:

- `updatedAt`: `2026-06-12T06:45:10.593Z` (`2026-06-12 15:45:10 KST`)
- `startedAt`: `2026-06-12T03:48:08.189Z` (`2026-06-12 12:48:08 KST`)
- `simulatedAt`: `2026-05-14T10:00:00Z` (`2026-05-14 19:00:00 KST`)
- `status`: `running`
- `mode`: `paper_only`
- `finalReportPath`: `null`

## 현재 진행 요약

| 항목 | 값 |
| --- | ---: |
| 완료 tick | `583 / 1272` |
| 진행률 | `45.83%` |
| packet 수 | `199` |
| AI 호출 수 | `199` |
| AI 판단 record 수 | `198` |
| AI skip 수 | `0` |
| Risk 판단 수 | `1,188` |
| Risk 승인 수 | `1,110` |
| Risk 반려 수 | `78` |
| 가상 체결 수 | `24` |
| 현금 | `600,000 KRW` |
| 포지션 평가액 | `10,466,929 KRW` |
| 가상 순자산 | `11,066,929 KRW` |
| 보유 종목 수 | `6` |

## 보유 포지션

현재 progress snapshot의 포지션 기준입니다.

| 종목 | 수량 | 평균가 | 평가액 | 순자산 비중 | 비고 |
| --- | ---: | ---: | ---: | ---: | --- |
| `005930` | `9.049774` | `221,000` | `2,000,000` | `18.07%` | `marketPriceKrw` 없음 |
| `035420` | `9.033852` | `218,290` | `1,969,380` | `17.80%` | `marketPriceKrw` 없음 |
| `042660` | `14.983656` | `131,802` | `1,958,364` | `17.70%` | `marketPriceKrw` 없음 |
| `028300` | `33.464726` | `57,299` | `1,803,749` | `16.30%` | `marketPriceKrw` 없음 |
| `035900` | `25.013638` | `60,475` | `1,475,805` | `13.34%` | `marketPriceKrw` 없음 |
| `000660` | `0.647293` | `1,194,000` | `1,259,631` | `11.38%` | `marketPriceKrw` 없음 |

주의:

- 포지션별 `marketPriceKrw`가 `null`입니다.
- 포지션별 `unrealizedPnlKrw`가 `0`으로 저장되어 있습니다.
- 따라서 현재 순자산은 가상 시뮬레이션 현황 참고값으로 볼 수 있지만, 투자 성과 검증 지표로는 아직 부족합니다.

## 최근 판단 및 체결 패턴

현재 progress snapshot은 전체 판단 로그를 모두 보관하지 않고 최근 일부만 보관합니다.

최근 `50`개 AI decision record의 action 집계:

| Action | Count |
| --- | ---: |
| `VIRTUAL_HOLD` | `263` |
| `VIRTUAL_SELL` | `28` |
| `VIRTUAL_BUY` | `9` |

가상 체결 집계:

| Action | Count | 금액 |
| --- | ---: | ---: |
| `VIRTUAL_BUY` | `19` | `18,842,525 KRW` |
| `VIRTUAL_SELL` | `5` | `9,442,525 KRW` |

종목별 체결 집계:

| 종목 | 체결 수 | 체결 금액 |
| --- | ---: | ---: |
| `028300` | `9` | `8,913,050 KRW` |
| `042660` | `5` | `5,900,000 KRW` |
| `035900` | `4` | `5,500,000 KRW` |
| `000660` | `2` | `4,000,000 KRW` |
| `005930` | `1` | `2,000,000 KRW` |
| `035420` | `3` | `1,972,000 KRW` |

최근 Risk 반려 code:

| Reject code | Count |
| --- | ---: |
| `VIRTUAL_SELL_AMOUNT_REQUIRED` | `3` |
| `VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED` | `3` |
| `VIRTUAL_SELL_AMOUNT_EXCEEDED` | `1` |

최근 event 예시:

```text
2026-05-14T10:00:00Z KR:028300 VIRTUAL_BUY filled 400000
2026-05-14T08:00:00Z KR:028300 VIRTUAL_BUY rejected VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED
2026-05-14T07:00:00Z KR:035900 VIRTUAL_BUY rejected VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED
2026-05-14T06:00:00Z KR:028300 VIRTUAL_BUY rejected VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED
2026-05-14T05:00:00Z KR:042660 VIRTUAL_SELL rejected VIRTUAL_SELL_AMOUNT_REQUIRED
2026-05-14T05:00:00Z KR:035900 VIRTUAL_BUY filled 1000000
2026-05-14T04:00:00Z KR:042660 VIRTUAL_SELL rejected VIRTUAL_SELL_AMOUNT_EXCEEDED
2026-05-14T04:00:00Z KR:000660 VIRTUAL_SELL filled 2000000
```

## 판단 가능한 개선 포인트

### 1. Mark-to-market 정확도 보강

현재 포지션 snapshot은 평가액은 있지만 `marketPriceKrw`와 `unrealizedPnlKrw`가 비어 있습니다. 이 상태에서는 순자산 곡선, 종목별 손익, drawdown, 체결 후 성과를 신뢰하기 어렵습니다.

개선 방향:

- 각 tick에서 보유 포지션을 최신 available snapshot 가격으로 재평가합니다.
- `marketPriceKrw`, `unrealizedPnlKrw`, `unrealizedPnlRate`, `positionWeightPct`를 progress와 report에 저장합니다.
- 가격이 없을 때는 `lastKnownPrice`와 `priceStalenessSeconds`를 함께 저장합니다.

### 2. 전체 의사결정 audit log 보존

현재 progress 파일은 `recentDecisions`, `recentRiskDecisions`, `recentPackets` 중심이라 전체 2개월 판단 흐름을 사후 분석하기 어렵습니다.

개선 방향:

- `historical-replay-decisions.jsonl`
- `historical-replay-risk-decisions.jsonl`
- `historical-replay-trades.jsonl`
- `historical-replay-portfolio-timeline.jsonl`

위와 같은 append-only 로그를 추가합니다.

필수 필드:

- `tickIndex`
- `simulatedAt`
- `packetId`
- `symbol`
- `action`
- `confidence`
- `amountKrw`
- `quantity`
- `reason`
- `riskApproved`
- `rejectCodes`
- `cashBefore`
- `cashAfter`
- `positionBefore`
- `positionAfter`
- `netWorthBefore`
- `netWorthAfter`

### 3. Sell 계약 개선

최근 반려에 `VIRTUAL_SELL_AMOUNT_REQUIRED`, `VIRTUAL_SELL_AMOUNT_EXCEEDED`가 반복됩니다. 이는 AI가 매도 의도를 냈지만 Risk Engine이 현재 보유 수량과 주문 금액을 맞추지 못했다는 신호입니다.

개선 방향:

- AI decision schema에 `sellRatio` 또는 `quantity`를 추가합니다.
- `VIRTUAL_SELL`은 `amountKrw` 단독보다 보유 수량 기준으로 처리합니다.
- Risk Engine은 `sellRatio`를 현재 보유 수량에 clamp한 뒤 실행 가능 금액을 계산합니다.
- 매도 불가능한 포지션은 AI에게 다음 packet에서 같은 실수를 줄일 수 있도록 reason code를 feedback context로 전달합니다.

### 4. 현금 및 재진입 정책 보강

현재 현금은 `600,000 KRW`로 순자산 대비 약 `5.42%`입니다. 최근에는 `VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED`가 반복되어 추가 매수 의도가 Risk Engine에서 막히고 있습니다.

개선 방향:

- 최소 현금 비중을 설정합니다. 예: `minCashReserveRatio = 0.10`
- 신규 매수와 추가 매수의 예산 정책을 분리합니다.
- 종목별 최대 비중을 동적으로 계산합니다. 예: 기본 `20%`, 변동성 높으면 `15%`
- 최근 매수 종목에는 cooldown을 둡니다. 예: `sameSymbolBuyCooldownTicks = 6`
- 같은 종목 exposure 반려가 반복되면 AI prompt에 "이미 한도 초과" 상태를 명시합니다.

### 5. 성과 비교 기준 추가

현재 값만으로는 AI 판단이 단순 보유보다 나은지 판단할 수 없습니다.

개선 방향:

- 같은 기간 equal-weight buy-and-hold benchmark
- 현금 100% benchmark
- 첫 tick 후보 동일가중 benchmark
- 종목별 개별 buy-and-hold benchmark

최소 평가 지표:

- total return
- max drawdown
- volatility
- hit rate after buy
- hit rate after sell
- average return after N ticks
- rejected decision ratio
- turnover
- cash drag
- concentration risk

### 6. AI 판단 품질 평가 추가

최근 50개 decision record 기준으로 `VIRTUAL_HOLD`가 대부분이고, Buy/Sell은 Risk Engine에서 일부 반려됩니다. 이 자체가 나쁜 것은 아니지만, 판단 품질을 평가하려면 "판단 이후 결과"가 필요합니다.

개선 방향:

- 각 decision에 대해 `+1h`, `+6h`, `+1d`, `+3d` 후 가격 변화를 붙입니다.
- Buy decision은 이후 수익률, Sell decision은 이후 회피 손실 또는 기회손실을 평가합니다.
- Hold decision은 "매수하지 않아서 피한 손실"과 "놓친 수익"을 분리합니다.
- AI reason을 구조화합니다. 예: `momentum`, `volume`, `risk`, `portfolio`, `uncertainty`

## 현재 데이터로 내릴 수 있는 결론

현재 로그는 "투자성이 검증되었다"는 결론을 내리기에는 부족합니다.

부족한 이유:

- 전체 2개월 중 `45.83%`만 진행되었습니다.
- 최종 `historical-replay-report.json`이 아직 생성되지 않았습니다.
- 전체 판단/리스크/체결 history가 append-only로 남아 있지 않습니다.
- 포지션별 현재가와 미실현 손익이 progress에 제대로 기록되지 않습니다.
- benchmark 대비 초과 성과가 계산되지 않았습니다.
- 거래비용, 슬리피지, 세금, 호가 단위 등 현실 제약이 반영되지 않았습니다.

다만 "어디를 고쳐야 하는지"에 대한 근거는 충분히 있습니다.

우선순위:

1. 포지션 mark-to-market과 성과 timeline을 먼저 고칩니다.
2. 전체 decision/risk/trade append-only log를 남깁니다.
3. Sell decision schema를 보유 수량/비율 기반으로 바꿉니다.
4. 현금 reserve, exposure, cooldown 정책을 명시합니다.
5. benchmark와 decision attribution을 추가합니다.
6. 그 후 2개월 전체 replay를 다시 실행해 비교합니다.

## ChatGPT 분석 결과 반영

ChatGPT 외부 검토 결과는 `docs/chatgpt-review/chatgpt-analysis-summary-2026-06-12.md`에 정리했습니다. 원문은 `docs/chatgpt-review/chatgpt-analysis-raw-2026-06-12.md`에 보존했습니다.

반영된 핵심 결론:

- 현재 로그만으로 투자성 판단은 불가능합니다.
- 판단 가능한 것은 전략 성과가 아니라 백테스트 신뢰도, 데이터 로깅 결함, Risk Engine 동작, decision contract 불일치입니다.
- `Portfolio mark-to-market`, `portfolio timeline`, `append-only audit trail`은 모두 P0로 봅니다.
- `VIRTUAL_SELL_AMOUNT_REQUIRED`, `VIRTUAL_SELL_AMOUNT_EXCEEDED` 반복은 전략 실패보다 SELL decision schema와 Risk Engine normalization의 계약 실패로 봅니다.
- 성과 판단 전 `benchmark`, `drawdown`, `decision attribution`, `fee/slippage/tax` 모델이 필요합니다.

ChatGPT 분석 기준의 PR 우선순위:

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

## PR 단위 제안

### PR 1. Replay audit log 영속화

목표:

- progress snapshot에만 의존하지 않고 전체 판단 근거를 보존합니다.

변경:

- `historical-replay-decisions.jsonl`
- `historical-replay-risk-decisions.jsonl`
- `historical-replay-trades.jsonl`
- `historical-replay-portfolio-timeline.jsonl`
- dashboard와 report에서 full log 기반 요약 사용

### PR 2. Portfolio mark-to-market 보정

목표:

- 순자산, 손익, drawdown을 신뢰 가능한 값으로 계산합니다.

변경:

- 보유 포지션 현재가 평가
- stale price 표시
- 미실현 손익 계산
- 포트폴리오 timeline 저장

### PR 3. Sell decision schema 개선

목표:

- AI의 Sell 판단이 Risk Engine에서 금액 오류로 반복 반려되는 문제를 줄입니다.

변경:

- `sellRatio` 또는 `quantity` 필드 추가
- Risk Engine sell clamp 로직
- AI prompt에 보유 수량과 매도 가능 금액 제공

### PR 4. Cash reserve 및 exposure policy 개선

목표:

- 현금 고갈, 반복 exposure 반려, 과도한 재진입을 줄입니다.

변경:

- 최소 현금 비중
- 신규/추가 매수 예산 분리
- 종목별 cooldown
- exposure rejection feedback

### PR 5. Benchmark 및 성과 평가 리포트

목표:

- AI 판단이 단순 전략보다 나은지 비교합니다.

변경:

- equal-weight buy-and-hold benchmark
- cash benchmark
- max drawdown
- decision outcome attribution
- dashboard 성과 비교 패널

## ChatGPT 검토용 프롬프트

아래 프롬프트는 현재 로그 기반으로 외부 ChatGPT에게 개선 방향을 묻기 위한 것입니다.

```text
너는 알고리즘 트레이딩 백테스트/페이퍼 트레이딩 시스템을 검토하는 시니어 엔지니어이자 퀀트 리서치 리뷰어다.

아래 시스템은 실거래가 아니라 paper_only historical replay다. 투자 조언이나 종목 추천을 하지 말고, 시스템 설계/백테스트 신뢰도/리스크 관리/데이터 로깅 관점에서만 평가해라.

중요한 안전 경계:
- 실거래 주문은 없다.
- AI 판단은 paper_only virtual decision이다.
- Risk Engine이 최종 gate다.
- unofficial data source는 조회/정보 수집용이며 live trading path에는 쓰지 않는다.
- 이 결과를 수익률 보장이나 투자 조언으로 해석하면 안 된다.

현재 실행 로그 요약:
- 로그 파일: data/replay-2026-04-12-2026-06-12/historical-replay-progress.json
- 상태: running
- 모드: paper_only
- startedAt: 2026-06-12T03:48:08.189Z
- updatedAt: 2026-06-12T06:45:10.593Z
- simulatedAt: 2026-05-14T10:00:00Z
- 완료 tick: 583 / 1272
- 진행률: 45.83%
- packet 수: 199
- AI 호출 수: 199
- AI decision record 수: 198
- AI skip 수: 0
- Risk 판단 수: 1,188
- Risk 승인 수: 1,110
- Risk 반려 수: 78
- 가상 체결 수: 24
- 현금: 600,000 KRW
- 포지션 평가액: 10,466,929 KRW
- 가상 순자산: 11,066,929 KRW
- 보유 종목 수: 6
- finalReportPath: null

현재 보유 포지션:
- 005930: 수량 9.049774, 평균가 221,000, 평가액 2,000,000, 순자산 비중 18.07%
- 035420: 수량 9.033852, 평균가 218,290, 평가액 1,969,380, 순자산 비중 17.80%
- 042660: 수량 14.983656, 평균가 131,802, 평가액 1,958,364, 순자산 비중 17.70%
- 028300: 수량 33.464726, 평균가 57,299, 평가액 1,803,749, 순자산 비중 16.30%
- 035900: 수량 25.013638, 평균가 60,475, 평가액 1,475,805, 순자산 비중 13.34%
- 000660: 수량 0.647293, 평균가 1,194,000, 평가액 1,259,631, 순자산 비중 11.38%

주의할 데이터 품질 이슈:
- 포지션별 marketPriceKrw가 null이다.
- 포지션별 unrealizedPnlKrw가 0으로 저장되어 있다.
- 현재 progress snapshot은 전체 판단 로그가 아니라 recentDecisions 50개, recentRiskDecisions 50개, recentPackets 10개만 보관한다.
- 최종 historical-replay-report.json은 아직 생성되지 않았다.

최근 50개 AI decision record action 집계:
- VIRTUAL_HOLD: 263
- VIRTUAL_SELL: 28
- VIRTUAL_BUY: 9

가상 체결 집계:
- VIRTUAL_BUY: 19건, 18,842,525 KRW
- VIRTUAL_SELL: 5건, 9,442,525 KRW

종목별 체결 집계:
- 028300: 9건, 8,913,050 KRW
- 042660: 5건, 5,900,000 KRW
- 035900: 4건, 5,500,000 KRW
- 000660: 2건, 4,000,000 KRW
- 005930: 1건, 2,000,000 KRW
- 035420: 3건, 1,972,000 KRW

최근 Risk 반려 code:
- VIRTUAL_SELL_AMOUNT_REQUIRED: 3
- VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED: 3
- VIRTUAL_SELL_AMOUNT_EXCEEDED: 1

최근 event 예시:
- 2026-05-14T10:00:00Z KR:028300 VIRTUAL_BUY filled 400000
- 2026-05-14T08:00:00Z KR:028300 VIRTUAL_BUY rejected VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED
- 2026-05-14T07:00:00Z KR:035900 VIRTUAL_BUY rejected VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED
- 2026-05-14T06:00:00Z KR:028300 VIRTUAL_BUY rejected VIRTUAL_SYMBOL_EXPOSURE_EXCEEDED
- 2026-05-14T05:00:00Z KR:042660 VIRTUAL_SELL rejected VIRTUAL_SELL_AMOUNT_REQUIRED
- 2026-05-14T05:00:00Z KR:035900 VIRTUAL_BUY filled 1000000
- 2026-05-14T04:00:00Z KR:042660 VIRTUAL_SELL rejected VIRTUAL_SELL_AMOUNT_EXCEEDED
- 2026-05-14T04:00:00Z KR:000660 VIRTUAL_SELL filled 2000000

내가 묻고 싶은 것:

1. 이 로그만 기준으로 현재 알고리즘의 투자성을 판단하기에 충분한가? 부족하다면 어떤 데이터가 더 필요한가?
2. 현재 구조에서 가장 먼저 고쳐야 할 시스템 결함은 무엇인가?
3. AI decision schema, Risk Engine, PaperOrderEngine, Portfolio timeline 중 어떤 순서로 개선해야 하는가?
4. Sell 판단이 amount 관련 reject로 반복 반려되는 문제를 어떻게 설계적으로 해결할 수 있는가?
5. 현금 reserve, exposure limit, cooldown 정책을 어떤 형태로 넣는 것이 좋은가?
6. 이 AI paper strategy가 단순 buy-and-hold보다 나은지 판단하려면 어떤 benchmark와 metric이 필요한가?
7. dashboard에는 어떤 진단 패널이 추가되어야 운영자가 빠르게 문제를 파악할 수 있는가?
8. 위 정보를 바탕으로 PR 단위 개선 계획을 우선순위로 제안해라.

답변 형식:
- "투자성 판단 가능 여부"를 먼저 결론으로 써라.
- 그 다음 "근거", "데이터 한계", "우선 개선점", "추가 수집 데이터", "PR 단위 계획" 순서로 정리해라.
- 종목 추천이나 실제 매수/매도 조언은 하지 마라.
- 시스템 설계와 백테스트 신뢰도 관점으로만 답해라.
```
