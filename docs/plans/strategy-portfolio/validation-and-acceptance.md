# 전략 포트폴리오 검증·호환성·최종 수용 기준

[운용 모델 진입점](../strategy-portfolio-operating-model-plan.md) · [현재 main 구현과 남은 작업](../../architecture/strategy-portfolio-implementation-status.md) · [기존 PR 1~8 단계](implementation-stages.md) · [검증·최종 수용 기준](validation-and-acceptance.md)

## 상태와 provenance

이 문서는 요구되는 검증 계약이며 이번 문서 작업에서 모든 시나리오를 실행했다는 결과 보고가 아니다.
원문 `8eede864a26143ac91a912671d7f98bd222632e0`의 12개 최종 수용 기준은 문장·순서와
미완료 상태를 유지하고 추적 ID만 추가했다. 개별 source나 테스트 존재만으로 전체 운용 완료를
판정하지 않는다. 원문 구간 및 AC 대응은 [원문 대응표](source-map.md)에 있다.

<a id="spom-source-3142-3154"></a>
<!-- spom-source:3142-3154 sha256:72a7eaf319bca7541b71c2e4ff7a07121589bc0be803dc9651caa046ab2ffcf5 -->

## 12. Historical replay와 검증 정책

- replay run은 active pointer를 실시간으로 따라가지 않고 시작 시 고정한 policy record를
  사용한다.
- 각 bucket isolated replay와 full shared-portfolio replay를 모두 실행한다.
- isolated 결과가 좋아도 full policy로 자동 승격하지 않는다.
- train 결과로 선택한 policy는 validation/test holdout에서 별도로 평가한다.
- 거래비용, turnover, drawdown, rejection, provider failure와 missing evidence를 수익률과
  함께 기록한다.
- long-term candidate는 데이터 window가 짧거나 fundamental evidence가 없으면 별도
  `evidence_insufficient` 상태로 보고한다.
- 결과 보고는 paper-only research artifact이며 투자 성과로 표현하지 않는다.

<!-- /spom-source -->

<a id="spom-source-6727-6918"></a>
<!-- spom-source:6727-6918 sha256:0712501c1ca9d68ab944e96ce4efb769097e5695f5a28b725ecc648280c66a96 -->

## 14. 테스트 전략

### Contract 및 invariant

- bucket target + cash target 합계 100%
- target이 min/max 범위 안에 존재
- policy hash canonicalization과 version compatibility
- activation sequence gap/duplicate와 future/backdated effective time 거절
- activation event full-payload digest, hash-derived ID와 독립 rehash 검증
- as-of activation fold와 supersedes/retired target 검증
- activation repository의 cross-process exact retry 수렴, atomic sequence와 corrupt/torn line 거절
- active policy의 selection policy ref가 immutable record와 일치
- selection policy payload canonical ordering, digest 제외 field와 독립 rehash 검증
- active policy의 risk rule set ref와 canonical required rule이 immutable record와 일치
- risk parameter payload canonical hash, rule ID/version scope와 독립 resolver 검증
- drawdown semantics payload digest와 unit NAV/HWM/reset/carry rule resolver 검증
- root legacy reduce-only rule set ref와 SELL-only scope 해소
- `portfolioId`당 single active policy
- `portfolioId + market + symbol`당 single active mandate
- mandate event chain의 선형 predecessor와 derived status 검증
- mandate record/event full-payload digest와 position state의 exact hash binding
- mandate와 position의 policy hash 일치
- selector mandate의 request/assignment/scoring model lineage 완전성
- candidate assignment set의 sealed ordering/top-N, available slot cap과 unique consumption
- selected assignment reservation 합계의 request gap/additional-exposure budget 상한
- selector/manual 동시 요청의 공용 capacity ledger CAS, unique slot과 aggregate budget 상한
- selector mandate/event의 ledger-assigned global slot ordinal과 reservation ID/hash 일치
- reservation의 mandate binding, partial fill, position 생성과 release transition replay
- reservation event strict variant의 full-payload rehash와 mandatory origin 검증
- candidate assignment의 full-payload digest와 eligibility/hard-gate 독립 재평가
- selector/manual sizing input record의 feature/cap/liquidity/cost payload와 hash 완전성
- portfolio sizing snapshot의 exposure/full digest 재계산과 canonical ordering 검증
- pending plan/action/reservation input replay와 BUY/SELL exposure total 일치
- valuation mark의 market/symbol, FX의 base/quote identity와 duplicate 거절
- cross-bucket mandate migration의 zero-sum equity, unit NAV/HWM와 mark-head 보존
- 종목별 previous mark head 연속성, overlap/gap과 stale predecessor 거절
- mark head event strict variant rehash와 snapshot replay 일치
- position mark-head event repository의 thread/process exact retry 수렴과 corrupt/torn/branch/origin 거절
- position mark-head durable snapshot의 replay equality와 journal complete/partial recovery 검증
- valuation mark의 active position completeness와 previous head ID/hash/quantity/price/evidence 해소
- typed source-price evidence의 complete payload hash와 hash-derived ref 및 canonical provenance 검증
- source-price evidence repository의 process retry 수렴과 ref/origin/corrupt history 거절
- selector mandate의 min/target/max range와 assignment `sizingOutputHash` 일치
- manual mandate의 assignment event reference와 scope/range 일치
- manual `open_or_increase`의 active selection policy evidence validation hash 일치
- manual `open_or_increase`의 immutable portfolio snapshot과 backend sizing input/output hash 일치
- manual event/reservation/mandate/state의 원자 commit, rollback과 reservation single-use
- manual `classify_existing_reduce_only`의 buy/increase 차단
- selector mandate가 참조하는 append-only request/assignment record의 해소 가능성
- selection request가 참조하는 immutable portfolio sizing snapshot의 해소와 hash 검증
- cycle-derived selection request와 request/symbol-derived assignment identity 및 collision 거절
- selection request full-payload digest와 snapshot/policy 기반 gap/slot/cap 독립 재계산
- legacy unassigned state에 fabricated mandate/policy/holding timestamp가 없음
- trigger 종류별 canonical `evidenceCutoffAt` 파생과 같은 trigger ref의 cutoff mismatch 거절
- mutable portfolio snapshot과 독립적인 trigger claim dedupe, 성공 후 동일 packet retry 수렴
- claim 생성/시작 원자성과 crash 후 frozen snapshot resume, plan/no-action terminal 결과 보존
- schedule/session calendar hash 입력의 ID/digest/createdAt 제외와 독립 rehash 검증
- session calendar ID/version/hash/date coverage와 entry provenance 검증
- scheduled cadence boundary의 timezone/calendar/hash 해소와 DST·휴장·조기 종료 slot 재현
- bucket `enabledMarkets`와 scheduled boundary/packet/request/mandate/action market 일치
- rebalance plan record hash와 선형 event predecessor/scope 일치
- hash-derived plan ID와 모든 plan event의 exact plan ID/hash binding
- rebalance plan event full-payload digest와 hash-derived ID 검증
- rebalance plan의 허용 transition, terminal state와 duplicate/branch 거절
- sell/buy 혼합 plan 거절과 SELL applied snapshot 기반 후속 BUY plan lineage
- fractional BUY notional, fractional SELL quantity와 whole-share quantity/residual의 strict
  union, cap 및 완료 조건 검증
- mandate action과 unassigned legacy reduce-only action의 strict lineage union 검증
- 각 fill의 action/risk decision/pre-resulting portfolio state mapping 검증
- risk decision의 plan/action/target/pre-state exact scope 및 input hash 검증
- turnover window/state replay, prior/requested 누계와 risk-decision cap 검증
- 같은 window의 policy activation 누계 승계와 mid-window window semantics 변경 거절
- full risk decision digest rehash와 deterministic rule/output 재평가
- mandate bucket rule scope와 legacy portfolio-level SELL rule scope 분리
- risk rule set의 required rule 완전성, duplicate/missing/extra/fail result 거절
- partial fill requested/filled/sequence/cumulative 계산, target 초과와 target 미달 applied 거절
- whole-share slippage 후 actual/cumulative notional의 approved cash/exposure/liquidity cap 재검증
- 성공 fill의 liquidity status가 `not_modeled | sufficient | partial`인지 검증하고
  `filled | unavailable | rejected | stale` 저장 및 reject reason 동반 fill 거절
- fractional SELL의 quantity 기반 완료와 불필요한 residual notional 대기 방지
- capital-flow execution origin 중복과 amount mismatch 거절
- 모든 bucket equity event variant의 full-payload digest와 hash-derived ID 검증
- strategy transfer pair의 sequence, equal-and-opposite amount와 전체 transaction 원자성
- valuation mark payload rehash/delta 재계산과 duplicate mark origin retry 수렴
- valuation current price evidence의 ref/hash/scope/value/observed instant 검증
- valuation risk-state scope/policy/head와 equity/position event origin graph 검증
- fill/position mutation 후 mark head rebase와 다음 valuation predecessor CAS 검증
- fill 전 source-price valuation, source-price mutation head와 execution-cost 단일 계상
- fill-price rebase 및 valuation 없는 price-changing migration 거절
- source-price evidence가 generic/liquidity ref이거나 market/symbol/as-of/hash가 다른 fill 거절
- corrupt mark head snapshot, event branch와 unauthenticated mutation origin 거절
- policy trigger event ID/hash/type/as-of/scope resolver와 payload collision 거절

### Gap 및 sizing

- `below_min` mode는 min/max band 내부에서 불필요한 trade가 없음
- `entry_floor_on_due_cycle`은 due cycle과 entry gap이 모두 있을 때만 floor까지 selection 가능
- overweight sell이 underweight buy보다 먼저 처리됨
- cash reserve, symbol, bucket, sector, country, currency limit 중 최소 cap 적용
- `(market, symbol)` exposure tuple 정렬·중복 거절과 동일 symbol의 market별 cap 분리
- dust와 거래비용 threshold 이하의 계획 제외
- sizing input record의 algorithm/feature/classification/cap/liquidity/cost payload rehash와 replay
- tax/market-impact를 포함한 full execution policy와 cost calculation input 재현
- 동일한 전체 `sizingInputHash`의 target range와 최대 notional 재현 및
  `sizingOutputHash` 검증

### Bucket risk state

- BUY/SELL notional은 drawdown 손익으로 계상하지 않고 fee/slippage와 mark PnL만 반영
- shared cash allocation/deallocation이 unit을 mint/burn하고 unit NAV를 바꾸지 않음
- positive execution-cost delta, unresolved execution과 duplicate cost event 거절
- execution-cost plan/action/fill origin mismatch와 cross-plan duplicate fill 거절
- actual fill full-payload rehash, 비용 breakdown 재계산과 execution-cost delta 일치
- typed source-price evidence의 market/symbol/field/as-of/hash와 fill source price 일치
- BUY worst-case/actual net cash debit의 spendable cash·reserve cap 검증
- SELL actual net cash credit의 approved/recomputed minimum floor 검증
- BUY/SELL fill accounting group의 side별 cost/flow 순서와 atomic append 검증
- valuation/head, fill, quantity/cash mutation, 회계·risk·snapshot·execution event 전체 원자성
- fee-only equity 감소 직후 unit NAV/drawdown 재계산과 breach 평가
- 재시작 event replay와 snapshot의 unit NAV/high-water mark/drawdown 일치
- 동일 drawdown semantics의 policy activation에서 unit NAV/high-water mark 승계
- exposure가 있는 상태의 drawdown semantics 변경 activation 거절
- 최초 또는 empty 초기화 외 high-water mark 암묵적 초기화 금지
- activation ID를 참조하는 epoch initialization과 initial unit/equity 검증
- corrupt/missing event와 snapshot mismatch의 신규 매수 fail-closed

### Cadence 및 exit

- bucket별 due/not-due 판단
- `every_tick` packet hash deduplication과 event trigger cycle identity
- scheduled/every-tick/policy-event/risk-breach trigger union의 identity/ref/cutoff 재현
- risk update kind별 immutable origin resolver, retry 수렴과 ID/payload collision 거절
- legacy fill risk update의 portfolio accounting origin과 bucket-origin 혼용 거절
- minimum/maximum holding boundary
- 같거나 역전된 minimum/maximum holding boundary의 validation 거절
- `timeExpiryAction`별 review-only와 reduce-only sell 동작
- partial take-profit 후 durable trailing state
- lifecycle invalidation과 risk breach가 minimum holding보다 우선
- 모든 enabled bucket의 market mark/fill/fee/cash-flow/risk-state update마다 risk breach 강제 평가

### 실패 및 복구

- active policy 없음/중복/corrupt
- stale evidence와 missing required feature
- portfolio version drift
- stale terminal event 이후 새 portfolio snapshot/version으로 replacement preview 생성
- duplicate trigger claim/cycle 및 duplicate plan apply
- stale replacement와 SELL 후속 BUY cycle의 terminal predecessor 기반 identity 검증
- applied/stale predecessor strict union과 plan/event ID/hash/type mismatch 거절
- stale event의 original scope와 observed current snapshot 분리 및 replacement scope binding
- completed-with-plan, plan record와 최초 preview event의 원자 commit/rollback
- trigger claim 중간 crash 뒤 frozen evaluation snapshot resume 및 no-action terminal dedupe
- plan event chain 재시작 복원과 applied plan의 exactly-once 검증
- in-plan expected mutation 허용과 unrelated portfolio drift의 stale 전환
- decision/trade/state 중간 실패 후 재구성 또는 안전 중단

### Safety

- `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false` 유지
- live `TradingSignal`, `OrderIntent`, broker endpoint 생성 없음
- MCP portfolio tool은 read-only 유지
- account, credential, order/execution identifier masking

## 15. 호환성과 롤백

- 기존 `VirtualPortfolio`와 historical replay artifact는 즉시 제거하지 않는다.
- 신규 field는 versioned artifact 또는 별도 state로 도입하고 legacy input을 명시적으로
  `unassigned_legacy`/`review_required`로 정규화한다. 누락된 lineage나 holding timestamp는
  합성하지 않는다.
- policy activation 이전에는 현재 paper runner 동작을 유지한다.
- 각 구현 PR은 feature flag 또는 미연결 contract 상태로 배포 가능해야 한다.
- active policy 적용에 문제가 있으면 현재 `activationId`를 `supersedesActivationId`로
  지정한 새 activation event로 이전 validated policy를 다시 활성화한다. policy 없이
  중단할 때만 명시적인 retirement event를 사용하며 저장 record를 수정하거나 삭제하지 않는다.
- DB schema 변경은 현재 계획에 없으며 local JSON/JSONL artifact migration만 대상이다.

## 16. 최종 수용 기준

다음 조건을 모두 만족해야 전략 포트폴리오 운용이 연결된 것으로 본다.

- [ ] `SPOM-AC-01`: active policy가 전체 자금의 bucket/cash 목표를 단일 source of truth로 제공한다.
- [ ] `SPOM-AC-02`: 현재 portfolio gap이 active policy 기준으로 계산된다.
- [ ] `SPOM-AC-03`: 종목 탐색은 bucket별 `selectionTrigger`가 충족된 request에서만 시작된다.
- [ ] `SPOM-AC-04`: candidate selection이 bucket별 hard gate와 versioned score를 사용한다.
- [ ] `SPOM-AC-05`: 모든 신규 position이 종목별 mandate와 target range를 가진다.
- [ ] `SPOM-AC-06`: holding age, review cadence, exit state가 durable하게 보존된다.
- [ ] `SPOM-AC-07`: 여러 bucket이 하나의 portfolio에서 서로 다른 cadence로 실행된다.
- [ ] `SPOM-AC-08`: rebalance는 band, turnover, cost, liquidity와 Risk Engine을 통과한다.
- [ ] `SPOM-AC-09`: 동일 trigger의 중복 initial cycle, 동일 cycle의 중복 적용과 상충 주문이 차단된다.
- [ ] `SPOM-AC-10`: dashboard가 active policy와 동일한 hash로 target/current/gap을 표시한다.
- [ ] `SPOM-AC-11`: isolated bucket 결과와 full portfolio 결과를 분리해서 검증한다.
- [ ] `SPOM-AC-12`: 모든 경로가 paper-only이고 live order surface를 추가하지 않는다.

<!-- /spom-source -->
