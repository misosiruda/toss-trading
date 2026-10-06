# 전략 포트폴리오 운용 모델의 과거 기준선과 구현 이력

[운용 모델 진입점](../plans/strategy-portfolio-operating-model-plan.md) · [현재 main 구현과 남은 작업](../architecture/strategy-portfolio-implementation-status.md) · [기존 PR 1~8 단계](../plans/strategy-portfolio/implementation-stages.md) · [검증·최종 수용 기준](../plans/strategy-portfolio/validation-and-acceptance.md)

## 이력의 범위

아래 읽기 기준과 2·4절은 분리 전 원문에 누적된 **당시 상태**다. active pointer/compliance,
mandate persistence, position state, plan 저장에 대한 부재 설명은 최신 main의 상태가 아니다.
당시 예시 비중·계획 기본값·상태 문장은 history로 보존하며 현재 값이나 투자 권고로 승격하지 않는다.
원문 기준 commit은 `8eede864a26143ac91a912671d7f98bd222632e0`이다.

13절의 작은 구현 분할에는 현행 안전 규칙과 미완료 transaction이 섞여 있었다. 따라서
세부 본문은 아래 이력 찾아보기가 가리키는 책임별 계약에 한 번만 유지한다. 다음 절의 과거 문구나
테스트 설명은 새 실행 검증 결과가 아니다. 기존 시점별 미구현 표현의 최신 상태는 별도 구현 표로 확인한다.

<a id="spom-source-3-15"></a>
<!-- spom-source:3-15 sha256:ae97c764f828ff10512948e10f8091ef95ae3ca122df3d1ddc4bba9660811b31 -->

## 읽기 기준

이 문서는 목표 계약과 작은 PR별 구현 기록이 함께 누적된 원문이다. 현재 제품 목적은
[프로젝트 개요](../architecture/project-overview.md), 첫 사용자 흐름의 제안은
[Trainer MVP 제안](../plans/trainer-mvp-roadmap.md)을 먼저 읽는다. 이 문서의 안전·저장·복구 계약과
최종 수용 기준은 그대로 유지한다. 문서 분할은 [문서 정리 계획](../README.md)에 제안되어 있다.

구현 기준인 main `d9818e7`에는 publisher-session composition이 아직 포함되지 않았다.
2026-10-01 별도로 관찰한 미병합 PR788 branch `dd132a3`는 current publication callback에 예약
append session을 전달하는 변경을 포함하며 chronology/lifetime 검토가 남아 있다. 이 문서 branch에
PR788 코드 변경은 포함하지 않는다. 뒤쪽의 "publisher composition은 후속" 설명은 main 기준으로 유지한다.
이 연결을 shared allocator, 원자 mandate 발행 또는 전체 운용 완료로 해석하지 않는다.

<!-- /spom-source -->

<a id="spom-source-31-60"></a>
<!-- spom-source:31-60 sha256:16a140b3c15a82297a31bf5ba99bedf36d0af17650b723b23d5ccb0ab5e07006 -->

## 2. 문제 정의

현재 코드는 다음 기반을 이미 가지고 있다.

- `long_term`, `swing`, `short_term`, `intraday`, `hedge` strategy bucket
- strategy bucket metadata를 가진 candidate, position, trade contract
- bucket별 exposure와 turnover risk limit
- `PortfolioPolicy` draft validation과 append-only 저장
- strategy bucket별 historical replay preset과 isolated test record
- cash reserve, market regime allocation, hedge, execution cost, portfolio analytics

그러나 이 기능은 하나의 운용 루프로 연결되지 않았다.

- 저장된 `PortfolioPolicy` 중 현재 적용할 정책을 가리키는 active pointer가 없다.
- main portfolio compliance는 저장된 정책의 target을 읽지 못한다.
- 종목의 `strategyBucket`은 주로 universe manifest에 미리 지정된 metadata다.
- 같은 포트폴리오에서 bucket마다 다른 판단 주기와 exit policy를 동시에 적용하지 않는다.
- bucket 목표 비중은 있지만 종목별 역할, 목표 비중, 보유기간과 검토 주기가 없다.
- `holdingPeriodHint`는 validation metadata이며 실제 time-based exit를 강제하지 않는다.
- isolated bucket test 결과를 통합 포트폴리오 정책으로 자동 승격하지 않는다.

결과적으로 현재 시스템은 bucket별 실험은 가능하지만 다음 질문에 일관되게 답하지
못한다.

1. 현재 포트폴리오에서 어떤 역할이 부족한가?
2. 부족한 역할을 어떤 조건의 종목으로 채워야 하는가?
3. 선택된 종목은 어느 정도 비중과 기간으로 보유해야 하는가?
4. 언제 유지, 축소, 교체 또는 청산해야 하는가?
5. 여러 bucket의 판단이 충돌하면 어떤 규칙으로 해결하는가?

<!-- /spom-source -->

<a id="spom-source-86-126"></a>
<!-- spom-source:86-126 sha256:6df70d6444c64155fbed19acee39cebbebe3065c5e17f65de1f3c2dda9e81b98 -->

## 4. 현재 구현 기준선

| 기능 | 현재 상태 | 목표 상태 |
| --- | --- | --- |
| strategy bucket schema | 구현 | 유지 |
| policy draft validation | 구현 | runtime policy contract와 통합 |
| policy append-only 저장 | activation repository까지 구현 | runner에서 active policy 사용 |
| bucket target/min/max weight | active policy compliance에 적용, sizing 미연결 | sizing에도 동일 policy 적용 |
| bucket exposure/turnover gate | 구현, policy 입력 연결은 수동 | active policy에서 자동 파생 |
| bucket별 replay preset | 구현 | shared portfolio orchestration에 재사용 |
| 종목별 bucket | manifest metadata 중심 | deterministic assignment와 mandate로 승격 |
| 종목별 target range | mandate strict contract에 구현, persistence 미연결 | mandate repository/state에 연결 |
| 실제 보유기간 상태 | 미구현 | position strategy state에 추가 |
| 통합 rebalance plan | 미구현 | preview와 paper execution 분리 |
| active policy 기반 dashboard | 구현 | 동일 policy hash compliance 유지 |
| 여러 bucket 동시 실행 | 미구현 | cadence-aware orchestrator 추가 |

runtime policy의 immutable dependency contract, read-only filesystem loader,
validation candidate 정규화와 strict persistence adapter는 구현되어 있다. activation lifecycle은
strict event contract, dependency를 다시 해소하는 deterministic as-of fold와 cross-process
atomic append/dedupe repository까지 구현되었다. runner 연결은 아직 포함하지 않는다.

현재 dashboard policy builder의 초기 draft는 다음 비중을 사용한다. 이 값은 활성
정책이나 투자 권고가 아니라 paper simulation을 시작하기 위한 편집 가능한 예시다.

| Bucket | Target | Min | Max | Max turnover | Max drawdown | Holding hint | Selection trigger | Entry floor |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| `long_term` | 35% | 20% | 50% | 15% | 18% | `multi_month` | `below_min` | - |
| `swing` | 20% | 10% | 30% | 35% | 12% | `multi_week` | `below_min` | - |
| `short_term` | 15% | 0% | 25% | 50% | 8% | `multi_day` | `entry_floor_on_due_cycle` | 5% |
| `intraday` | 10% | 0% | 15% | 100% | 4% | `intraday` | `entry_floor_on_due_cycle` | 2% |
| `hedge` | 5% | 0% | 15% | 40% | 6% | `hedge` | `entry_floor_on_due_cycle` | 2% |
| cash | 15% | - | - | - | - | dynamic regime | - | - |

`Selection trigger`와 `Entry floor` 열은 현재 builder에 구현된 값이 아니라 위 초기
비중을 runtime policy로 정규화할 때 추가할 계획 기본값이다.

Policy builder의 drawdown/turnover 값과 historical replay preset의 take-profit,
stop-loss, trailing stop 값은 현재 서로 다른 configuration source다. runtime policy를
도입할 때 두 설정을 하나의 versioned bucket policy로 통합해야 한다.

<!-- /spom-source -->

## 기존 13절 구현 분할 찾아보기

각 행은 원문에 누적된 변경의 위치다. 상세 본문의 안전·호환성 제약은 링크의 계약이 정본이며,
여기서 완료 여부나 실행 권한을 새로 선언하지 않는다. 원문의 ordinal은 재번호를 매기지 않는다.

| 기존 단계/변경 기록 | 원문 행 | 상세 정본 |
| --- | --- | --- |
| PR 3. `InvestmentMandate`와 position strategy state · 첫 분할은 `InvestmentMandateRecord`, lifecycle event와 manual assignment event의 | 3324 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 두 번째 분할은 `instrument-mandate-records.jsonl`과 | 3332 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 세 번째 분할은 assigned/unassigned legacy `PositionStrategyState`의 strict variant와 complete | 3343 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 네 번째 분할은 canonical instrument scope 순서로 저장하는 | 3353 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 다섯 번째 분할은 `manual-assignment-events.jsonl` strict append-only repository를 구현한다. event | 3365 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 여섯 번째 분할은 `BucketEquityEvent`의 epoch initialization, capital flow, valuation, | 3376 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 일곱 번째 분할은 `bucket-equity-events.jsonl` strict append-only repository와 deterministic | 3388 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 여덟 번째 분할은 replay 결과를 canonical `(portfolioId, bucket)` 순서로 저장하는 | 3403 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 아홉 번째 분할은 `epoch_initialized` event를 activation-aware caller가 제공한 exact active runtime | 3416 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 열 번째 분할은 valuation event의 immutable origin인 `BucketValuationMarkRecord` strict contract를 | 3426 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 열한 번째 분할은 `bucket-valuation-mark-records.jsonl` strict append-only repository를 구현한다. | 3436 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 열두 번째 분할은 종목별 valuation predecessor를 보존하는 `BucketPositionMarkHeadEvent`와 | 3445 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 열세 번째 분할은 append-only event를 current snapshot으로 재구성하는 순수 | 3458 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 열네 번째 분할은 `bucket-position-mark-head-events.jsonl` strict append-only repository를 구현한다. | 3471 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 열다섯 번째 분할은 replay 결과를 canonical | 3482 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 열여섯 번째 분할은 immutable valuation mark를 current position mark-head snapshot에 결속하는 순수 | 3497 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 열일곱 번째 분할은 valuation과 paper fill이 공용으로 참조할 immutable | 3509 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 열여덟 번째 분할은 `source-price-evidence-records.jsonl` strict append-only repository를 구현한다. | 3520 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 열아홉 번째 분할은 valuation mark의 각 `currentPriceEvidenceRef`를 immutable | 3531 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 스무 번째 분할은 verified mark origin과 current `BucketRiskState`에서 complete valuation application | 3542 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 스물한 번째 분할은 `BucketValuationApplicationFileRepository`가 verified valuation mark, | 3564 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 스물두 번째 분할은 `runBucketValuationOnce` workflow가 durable current position/evidence에서 verified | 3590 | [상세](../contracts/strategy-portfolio/mandate-state.md#spom-source-3324-3603) |
| PR 3. `InvestmentMandate`와 position strategy state · 예약 원본 계약 분할은 `ManualOpeningCapacityReservationRecord`의 strict | 3619 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3619-3914) |
| PR 3. `InvestmentMandate`와 position strategy state · 이 분할은 불변 record와 원본 payload 간 결속 계약이며 현재 capacity를 예약·소비하는 권한은 아니다. | 3633 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3619-3914) |
| PR 3. `InvestmentMandate`와 position strategy state · 예약 lifecycle 이벤트 계약 분할은 `openingCapacityReservationEvent.ts`에서 `reserved`, | 3640 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3619-3914) |
| PR 3. `InvestmentMandate`와 position strategy state · 예약 이력 재생 분할은 `replayOpeningCapacityReservationEvents`로 단일 portfolio/policy/bucket의 | 3661 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3619-3914) |
| PR 3. `InvestmentMandate`와 position strategy state · 예약 이벤트 저장 분할은 `OpeningCapacityReservationEventFileRepository`에서 | 3684 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3619-3914) |
| PR 3. `InvestmentMandate`와 position strategy state · 수동 예약의 실제 원본 조회 선행 분할은 `ManualAssignmentFileRepository.withDurableVerifiedHistory`로 | 3824 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3619-3914) |
| PR 3. `InvestmentMandate`와 position strategy state · 수동 예약 기록 저장 분할은 `ManualOpeningCapacityReservationFileRepository`에서 계획한 | 3849 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3619-3914) |
| PR 4. `PortfolioGapAnalyzer` · 첫 분할은 active runtime policy와 같은 portfolio/policy scope의 verified exposure 및 opening capacity | 3923 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 두 번째 분할은 `PortfolioExposureSnapshot` strict payload와 독립 | 3933 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 세 번째 분할은 full sizing snapshot에 들어갈 `PortfolioValuationInput`과 | 3947 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 네 번째 분할은 canonical `VirtualPortfolio`, verified exposure, valuation/pending input을 하나의 | 3956 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 다섯 번째 분할은 저장된 sizing snapshot을 downstream sizing/risk input으로 사용하기 전에 | 3969 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 여섯 번째 분할은 valuation/exposure replay를 통과한 snapshot만 | 4018 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 일곱 번째 분할은 `BucketSelectionRequest` strict contract를 구현한다. request hash는 | 4027 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 여덟 번째 분할은 `bucket-selection-requests.jsonl` strict append-only repository를 구현한다. | 4036 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 아홉 번째 분할은 저장된 request가 참조하는 `PortfolioSizingSnapshot`의 ID/hash/scope/as-of를 | 4044 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 열 번째 분할은 `PortfolioCycleTrigger`를 `scheduled`, `every_tick`, `policy_event`, `risk_breach`의 | 4053 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 열한 번째 분할은 `every_tick` trigger가 참조하는 기존 `MarketPacket` complete history를 raw JSONL에서 | 4062 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 열두 번째 분할은 `every_tick` source resolver를 `BucketSelectionRequest` resolver에 연결한다. every-tick | 4073 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 열세 번째 분할은 `PortfolioPolicyTriggerEvent`의 strict immutable contract를 구현한다. regime와 thesis | 4083 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 열네 번째 분할은 검증된 `PortfolioPolicyTriggerEvent`만 | 4091 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 열다섯 번째 분할은 `policy_event` cycle trigger를 complete immutable policy event history에 exact-bind하는 | 4099 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 열여섯 번째 분할은 `PortfolioRiskStateUpdateRecord`의 strict immutable contract를 구현한다. market | 4107 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 열일곱 번째 분할은 `PortfolioRiskStateUpdateRecord`를 | 4116 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 열여덟 번째 분할은 `risk_breach` cycle trigger를 complete immutable risk-state update history에 | 4124 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 열아홉 번째 분할은 `policy_event`와 `risk_breach` source resolver가 resolved immutable record의 | 4131 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 스무 번째 분할은 scheduled trigger를 immutable `ScheduleBoundaryRecord`와 versioned | 4137 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 스물한 번째 분할은 scheduled source resolver를 `BucketSelectionRequest` replay에 연결한다. Scheduled | 4147 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 스물두 번째 분할은 policy event의 raw evidence ref를 그대로 신뢰하지 않도록 | 4154 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 스물세 번째 분할은 검증된 `PortfolioPolicyTriggerEvidenceRecord`만 | 4164 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 스물네 번째 분할은 every-tick packet, policy event와 risk-state update resolver가 complete history의 | 4174 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 스물다섯 번째 분할은 `policy_event` cycle trigger의 event `evidenceRefs`를 complete immutable | 4181 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 스물여섯 번째 분할은 thesis `policy_event`가 참조하는 mandate를 complete investment mandate | 4190 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 스물일곱 번째 분할은 policy-event source resolver를 `BucketSelectionRequest` replay에 연결한다. | 4201 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 스물여덟 번째 분할은 `market_mark` risk-state update가 참조하는 immutable | 4209 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 스물아홉 번째 분할은 `risk_state` update가 참조하는 immutable `BucketRiskState`를 risk-breach source | 4216 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 서른 번째 분할은 `fee`와 `cash_flow` update가 참조하는 immutable `BucketEquityEvent`를 risk-breach | 4223 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-3923-4229) |
| PR 4. `PortfolioGapAnalyzer` · 서른한 번째 분할은 accepted paper fill을 complete immutable `PaperFillExecutionRecord`로 보존하는 strict | 4230 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-4230-4404) |
| PR 4. `PortfolioGapAnalyzer` · 서른두 번째 분할은 `PaperFillExecutionRecord`를 strict append-only JSONL repository에 보존한다. Repository는 | 4239 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-4230-4404) |
| PR 4. `PortfolioGapAnalyzer` · 서른세 번째 분할은 `PaperFillExecutionRecord.sourcePriceEvidence` projection을 immutable | 4248 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-4230-4404) |
| PR 4. `PortfolioGapAnalyzer` · 서른네 번째 분할은 한 accepted fill의 portfolio mutation을 immutable | 4261 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-4230-4404) |
| PR 4. `PortfolioGapAnalyzer` · 서른다섯 번째 분할은 plan action 실행 직전 Risk Engine 결과를 immutable | 4272 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-4230-4404) |
| PR 4. `PortfolioGapAnalyzer` · 서른여섯 번째 분할은 `PortfolioActionRiskDecisionFileRepository`의 append-only JSONL 저장소를 | 4290 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-4230-4404) |
| PR 4. `PortfolioGapAnalyzer` · 서른일곱 번째 분할은 `validateRebalancePlanExecutionFillRiskBinding`으로 execution event와 | 4299 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-4230-4404) |
| PR 4. `PortfolioGapAnalyzer` · 서른여덟 번째 분할은 가격 근거의 실제 record durability를 `source_price_evidence_entry.v2`와 | 4326 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-4230-4404) |
| PR 4. `PortfolioGapAnalyzer` · 서른아홉 번째 분할은 Risk 결정 저장소에도 `portfolio_action_risk_decision_entry.v2`와 | 4343 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-4230-4404) |
| PR 4. `PortfolioGapAnalyzer` · 마흔 번째 분할은 `resolvePortfolioActionRiskDecisionPolicy`로 저장된 Risk 결정의 정책·규칙 | 4375 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-4230-4404) |
| PR 5. Bucket candidate selector contract · Selector sizing 입력의 첫 분할은 `candidateSizingInput.ts`의 strict `CandidateSizingInputRecord` | 4461 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-4461-5616) |
| PR 5. Bucket candidate selector contract · 입력 저장 분할은 `CandidateSizingInputFileRepository`를 통해 계획된 | 4488 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-4461-5616) |
| PR 5. Bucket candidate selector contract · 보유분 기준 노출 상한 분할은 `candidate_position_exposure_bounds.v1`이다. 선택 정책의 optional | 4808 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-4461-5616) |
| PR 5. Bucket candidate selector contract · 이 분할은 assignment/set 저장소, request당 단일 seal, actual source completeness, eligibility 및 | 4874 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-4461-5616) |
| PR 5. Bucket candidate selector contract · 원본 공유 조회 분할은 sizing input, assignment, selector reservation 각각에 | 5160 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-4461-5616) |
| PR 5. Bucket candidate selector contract · 현재 원본 조합의 선행 분할인 `bindOpeningCapacityRootOrigins`는 실제 callback 안에서 살아 있는 | 5186 | [상세](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-4461-5616) |
| PR 6. Rebalance preview planner · 첫 번째 분할은 Risk/partial-fill source 해소의 선행 계약인 `RebalancePlanRecord`를 구현한다. | 5630 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 이 분할은 immutable content contract만 제공한다. Cycle당 유일 저장, append-only repository, | 5639 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 두 번째 분할은 `RebalancePlanFileRepository`로 immutable plan artifact를 저장한다. | 5645 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 세 번째 분할은 `rebalancePlanEvent.ts`의 전체 event union content contract다. `previewed`, | 5665 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 네 번째 분할은 `replayRebalancePlanEvents`의 순수 상태 재생이다. 입력 plan/event를 독립 검증한 | 5679 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 이 분할의 전체 회귀 검증에서 runtime policy 저장소의 동시 exclusive lock 획득이 Windows | 5707 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 다섯 번째 분할은 `RebalancePlanEventFileRepository`의 append-only event 저장과 read replay다. | 5713 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 여섯 번째 분할은 `PortfolioActionRiskDecisionFileRepository.createAndAppendWithPlanOrigin`과 | 5734 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 일곱 번째 분할은 Risk 생성 전에 mandate 원본을 관측하기 위한 저장소 경로다. | 5780 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 여덟 번째 분할은 `createAndAppendWithMandateOrigin`으로 실제 mandate 원본을 Risk 생성에 연결한다. | 5798 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 아홉 번째 분할은 Risk 현금·노출 입력 연결 전에 저장된 `PortfolioSizingSnapshot` 원본 세대를 | 5822 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 열 번째 분할은 `createAndAppendWithSnapshotOrigin`으로 저장된 valuation-resolved snapshot을 Risk | 5838 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 이 분할은 Risk 입력 원본의 결속이며 caller ruleResults의 실제 수치 계산, 가격/FX 및 turnover 원본의 | 5854 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 열한 번째 분할은 `validateRiskDecisionCashCapacity`를 snapshot-bound 생성·retry와 과거 resolver에 | 5859 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 열두 번째 분할은 `validateRiskDecisionSnapshotState`의 approved SELL에 실제 보유 수량 상한을 | 5879 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 열세 번째 분할은 Risk의 가격 원본 연결을 위한 `SourcePriceEvidenceFileRepository`의 | 5895 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 열네 번째 분할은 `createAndAppendWithPriceOrigin(input, evidenceRef)`와 | 5916 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 열다섯 번째 분할은 v7 Risk가 선택한 가격과 paper fill의 실제 source price identity를 연결한다. | 5943 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 열여섯 번째 분할은 `PortfolioActionExecutionPreview` 순수 계산 계약을 구현한다. Risk가 비용 계산을 | 5960 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 열일곱 번째 분할은 `createPortfolioPolicyExecutionPreview`로 실제 저장된 active policy와 typed 가격을 | 5988 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 열여덟 번째 분할은 `createPortfolioPacketExecutionPreview`로 `market-packets.jsonl`의 canonical | 6027 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 열아홉 번째 분할은 whole-share 부분 체결 계산을 명시적인 `execution_simulator.v5`로 추가한다. | 6053 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 스무 번째 분할은 `createPortfolioPlanExecutionPreview`로 저장된 plan/event 진행 상태와 | 6076 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 스물한 번째 분할은 `createAndAppendWithExecutionOrigin`으로 계획 기반 실행 미리보기를 | 6096 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 스물두 번째 분할은 `bucketTurnover.ts`에서 고정 UTC window의 `BucketTurnoverEvent`와 | 6131 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 해당 분할은 순수 계약·재생이며 file repository, window root의 유일성·분모 원본, 실제 plan/action/fill | 6146 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 스물세 번째 분할은 `bucketTurnoverSnapshotOrigin.ts`에서 실제 sizing snapshot 저장소의 live durable | 6153 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 스물네 번째 분할은 `bucketTurnoverWindowFiles.ts`에서 최초 window의 분모·snapshot origin과 | 6172 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 스물다섯 번째 분할은 `bucketTurnoverFillOrigin.ts`의 `resolveBucketTurnoverFillOrigin`에서 실제 | 6201 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 스물여섯 번째 분할은 `BucketTurnoverEventFileRepository`가 저장된 paper fill ID와 expected | 6231 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 스물일곱 번째 분할은 `BucketTurnoverStateFileRepository`가 실제 최초 window와 event의 전체 | 6259 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 스물여덟 번째 분할은 `validateRiskDecisionTurnoverCapacity`를 policy-bound/plan-bound 및 그 상위 | 6287 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-5630-6313) |
| PR 6. Rebalance preview planner · 스물아홉 번째 분할은 `resolveCurrentPortfolioActionRiskDecisionTurnover`로 실제 저장된 execution-bound | 6333 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-6333-6432) |
| PR 6. Rebalance preview planner · 서른 번째 분할은 `BucketTurnoverStateFileRepository.withDurableRiskSources`로 회전율 projection, | 6372 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-6333-6432) |
| PR 6. Rebalance preview planner · 이 분할은 Risk 생성 연결의 잠금 선행조건이며 policy/mandate/Risk 생성·receipt 저장, 과거 turnover | 6389 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-6333-6432) |
| PR 6. Rebalance preview planner · 서른한 번째 분할은 `PortfolioActionRiskDecisionFileRepository.createAndAppendWithTurnoverOrigin`으로 | 6394 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-6333-6432) |
| PR 7. Shared portfolio multi-bucket paper orchestrator · 선행 current portfolio 동시성 연결은 기존 paper runner에 적용한다. `FileVirtualPortfolioStore`의 | 6435 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-6435-6687) |
| PR 7. Shared portfolio multi-bucket paper orchestrator · `appendCurrentPortfolioSizingSnapshot`은 `FileVirtualPortfolioStore.withLockedSnapshot` 안에서 실제 | 6476 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-6435-6687) |
| PR 7. Shared portfolio multi-bucket paper orchestrator · `appendPolicyBoundCurrentPortfolioSizingSnapshot`은 같은 실제 잔고/revision publisher에 저장된 | 6494 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-6435-6687) |
| PR 7. Shared portfolio multi-bucket paper orchestrator · 실제 paper pipeline은 `withLoggedPreparedApplication`에서 로그 batch → portfolio revision 잠금 | 6643 | [상세](../contracts/strategy-portfolio/rebalance-risk-fill.md#spom-source-6435-6687) |
