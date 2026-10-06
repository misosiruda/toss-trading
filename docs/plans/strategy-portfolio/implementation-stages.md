# 전략 포트폴리오 구현 단계와 후속 계획

[운용 모델 진입점](../strategy-portfolio-operating-model-plan.md) · [현재 main 구현과 남은 작업](../../architecture/strategy-portfolio-implementation-status.md) · [기존 PR 1~8 단계](implementation-stages.md) · [검증·최종 수용 기준](validation-and-acceptance.md)

## 상태를 읽는 법

`PR 1`~`PR 8`은 원문 내부 구현 단계명이며 GitHub PR 번호가 아니다. 아래 목록과 완료 조건은
목표/단계 범위이며 check 완료 선언이 아니다. 누적된 세부 안전 계약은 책임별 문서로 옮겼고,
현재 구현 여부는 별도 상태표에서 source와 함께 확인한다. “기존/계획 endpoint”와 Dashboard
항목은 당시 API 계획을 보존한 것이며 개별 route의 현재 구현을 보증하지 않는다.
Trainer MVP의 전략·시장·UX·Jev 선택도 이 분리로 확정하지 않는다.

<a id="spom-source-3099-3141"></a>
<!-- spom-source:3099-3141 sha256:9622fea23f5bf49b8cf0be328116e09e7342d51928b15df6e3b87693a04f2a33 -->

## 11. API와 Dashboard 계획

### 11.1 Local Operations API

기존 endpoint는 유지한다.

```text
POST /paper/policies/validate
POST /paper/policies
```

계획 endpoint는 다음과 같다.

```text
GET  /paper/policies/active
POST /paper/policies/{policyRecordId}/activate
GET  /virtual/portfolio/gaps
POST /paper/portfolio/rebalance/preview
GET  /paper/portfolio/rebalance/plans/{planId}
```

- `GET`은 read-only다.
- policy activation과 rebalance preview 저장은 same-origin, mutation token, explicit
  operation header를 요구하는 guarded paper-only mutation이다.
- preview는 paper order를 실행하지 않는다.
- 실제 paper execution endpoint는 별도 PR에서 idempotency와 version check가 갖춰진 뒤
  추가한다.
- 어떤 endpoint도 live order 또는 broker mutation을 만들지 않는다.

### 11.2 Dashboard

`/dashboard/portfolio`는 같은 active policy hash를 기준으로 다음을 표시한다.

- bucket별 target/min/current/max와 KRW gap
- 종목별 mandate, target range, 보유기간, 다음 review 시각
- selection evidence freshness와 blocked reason
- 예정된 rebalance action과 예상 비용
- cash reserve와 hedge effectiveness
- policy version, activation 시각과 마지막 orchestration cycle

target policy를 읽지 못하면 현재처럼 임의의 `0%` target이나 `ok`를 표시하지 않고
`missing_policy`로 명확히 구분한다.

<!-- /spom-source -->

<a id="spom-source-3155-3168"></a>
<!-- spom-source:3155-3168 sha256:a48cc60d33d023c2f9de3e86b2814fdeb2db6cf3e0039d231e7fca7674c7e545 -->

## 13. 구현 순서

각 단계는 독립적으로 review/revert할 수 있는 작은 PR로 진행한다.

### PR 1. Runtime policy contract와 activation lineage

실제 구현은 다음처럼 독립적으로 검토 가능한 책임으로 나눈다.

1. immutable policy dependency contract: selection policy, risk parameter/rule set,
   drawdown semantics, session calendar, schedule boundary의 strict schema, canonical hash와
   hash-derived ID 검증
2. dependency repository/resolver와 current validation candidate의 runtime policy 정규화
3. append-only activation event repository와 single-active as-of resolver

<!-- /spom-source -->

<a id="spom-source-3255-3276"></a>
<!-- spom-source:3255-3276 sha256:0ff866cab71dcdfd45c3f7a9db48cabf0cad4cf69f5b479f75830bfd3e7c7d9b -->

- current validation candidate를 runtime `PortfolioPolicy` contract로 정규화
- immutable bucket selection policy ref와 resolver validation
- immutable portfolio risk rule parameter/rule set ref와 required-rule resolver
- immutable bucket drawdown semantics ref와 activation/replay resolver
- immutable market schedule boundary ref와 timezone/calendar/hash validation
- immutable session calendar record와 date-coverage resolver
- append-only activation record와 single-active fail-closed resolver
- policy hash/version parser와 migration test
- runner와 order engine에는 아직 연결하지 않음

완료 조건:

- `portfolioId`별 active policy 1개를 deterministic하게 읽는다.
- 해당 portfolio의 active policy 없음, 중복 active, corrupt lineage를 모두 거절한다.
- enabled market 집합과 scheduled boundary market 집합이 정확히 일치한다.

### PR 2. Active policy 기반 portfolio compliance

- `portfolio-compliance`가 active policy target/min/max를 읽도록 연결
- bucket gap과 `under`, `over`, `ok`, `missing_policy` 계산
- dashboard에 실제 policy version과 gap 표시

<!-- /spom-source -->

<a id="spom-source-3309-3323"></a>
<!-- spom-source:3309-3323 sha256:c30bea301ce80cec5bc80ef8330aaa8092cad5adb48ab172336e2df09d17db87 -->

완료 조건:

- 저장 정책과 화면 target이 같은 policy hash를 사용한다.
- policy가 없을 때 `0% target`을 정상값처럼 표시하지 않는다.

### PR 3. `InvestmentMandate`와 position strategy state

- immutable mandate record/event chain, assigned/unassigned legacy state와 manual assignment
  event의 strict schema/repository
- mandate/event full-payload digest와 position state의 exact hash binding
- portfolio 안에서 한 종목 하나의 active mandate invariant
- 기존 position의 `unassigned_legacy` migration
- position peak/review/holding age와 bucket unit-NAV drawdown state persistence
- position strategy state full-payload digest와 restart 검증

<!-- /spom-source -->

<a id="spom-source-3604-3618"></a>
<!-- spom-source:3604-3618 sha256:f32f99ae7f1f43b777147d4842d4730f4ced9da3edaa6ae78164d4976ef45cdf -->

완료 조건:

- 모든 신규 paper position이 mandate와 policy hash를 가진다.
- selector가 만든 mandate는 request, assignment와 scoring model lineage를 가진다.
- manual mandate는 먼저 저장된 assignment event와 scope/range가 일치한다.
- manual assignment event의 complete payload digest와 hash-derived ID가 일치한다.
- manual `open_or_increase`는 selector와 같은 evidence gate를 통과하고,
  `classify_existing_reduce_only`는 buy/increase를 만들지 않는다.
- lineage 또는 holding timestamp가 없는 legacy position은 값을 자동 추정하지 않고
  `unassigned_legacy`와 `review_required`로 구분하며 해당 portfolio의 신규 매수를 막는다.
- mandate event chain의 branch/unknown predecessor/terminal transition을 거절한다.
- mandate/event/state의 canonical hash가 다르면 신규 매수를 거절한다.
- position strategy state의 peak/partial-exit/holding/review payload rehash가 일치한다.
- 재시작 후 bucket equity event replay와 risk snapshot이 같은 unit NAV/high-water mark를 만든다.

<!-- /spom-source -->

<a id="spom-source-3915-3922"></a>
<!-- spom-source:3915-3922 sha256:b66e53b297910b8533db20fdeb8c61ceb37d42d6fd784c0415fcdd6aed871fe7 -->

### PR 4. `PortfolioGapAnalyzer`

- bucket/symbol/cash gap read model
- min/max band와 available slot 계산
- immutable portfolio sizing snapshot과 mark provenance repository
- policy의 `selectionTrigger`별 request 생성 조건
- selection request append-only repository

<!-- /spom-source -->

<a id="spom-source-4405-4415"></a>
<!-- spom-source:4405-4415 sha256:513d593654010a75c11a705847ec80e691dbc76a46c926ad8609f6df2a5a669d -->

완료 조건:

- overweight bucket은 신규 candidate request를 만들지 않는다.
- `below_min` request는 `underweightKrw > 0`일 때만, `entry_floor_on_due_cycle` request는
  due cycle에서 `entryGapKrw > 0`일 때만 생성된다.
- min이 0이고 target이 양수인 선택적 bucket은 명시적인 entry floor까지만 empty
  portfolio bootstrap이 가능하며 floor 도달 후 target을 반복 추격하지 않는다.
- cash reserve 미달이면 모든 buy capacity가 0이다.
- 같은 cycle/bucket의 selection request retry는 기존 record로 수렴한다.

### PR 5. Bucket candidate selector contract

<!-- /spom-source -->

<a id="spom-source-4449-4460"></a>
<!-- spom-source:4449-4460 sha256:e30e047f655ba4c8b3b75714146afd3e53b342ac8d335b841dcbba0abe344e76 -->

- 공통 hard gate와 bucket별 scoring interface
- immutable selection policy record와 hash resolver
- price/volume 기반 `market_technical` feature부터 구현
- evidence completeness와 scoring model version 기록
- candidate assignment append-only repository와 request lineage 검증
- assignment full-payload digest와 eligibility/hard-gate 독립 재평가
- request별 sealed assignment set의 deterministic top-N과 unique assignment consumption
- selector/manual 공용 bucket opening capacity ledger와 version CAS
- mandate activation부터 position 생성까지 유지되는 reservation lifecycle event chain
- canonical candidate sizing input repository와 input hash replay
- manifest bucket은 observed metadata로 유지하되 자동 acceptance 근거로 사용하지 않음

<!-- /spom-source -->

<a id="spom-source-5617-5629"></a>
<!-- spom-source:5617-5629 sha256:5ee3f00256a26e97248f4c63b475360593d3c51967f42c827732390f3e0c960c -->

### PR 6. Rebalance preview planner

- sell-first deterministic plan
- target range, turnover, cost와 liquidity threshold
- portfolio/policy version binding과 idempotency key
- immutable plan record와 append-only state event chain
- plan ID/hash/event binding과 applied/stale predecessor strict union
- plan event full-payload digest, hash-derived ID와 독립 rehash
- bucket turnover window/event/state와 action risk input binding
- side별 chained plan과 fill별 risk decision/execution state lineage
- action-scoped risk decision resolver와 partial-fill cumulative guard
- read-only preview 및 artifact 저장

<!-- /spom-source -->

<a id="spom-source-6314-6332"></a>
<!-- spom-source:6314-6332 sha256:3e110e38df62b4b39717bca6bdd219532d5f1bab2d0ca42660dd40a7aaf5348d -->

완료 조건:

- preview는 portfolio와 trade를 변경하지 않는다.
- stale preview 또는 version mismatch를 적용할 수 없다.
- plan 상태는 허용된 선형 transition만 가지며 재시작 후 동일하게 복원된다.
- plan event payload digest가 다르면 승인·실행을 fail-closed한다.
- plan ID가 record hash에서 파생되고 모든 event가 같은 plan hash를 보존한다.
- stale replacement와 SELL 후속 BUY가 각 terminal predecessor union을 정확히 보존한다.
- claim completion, plan record와 최초 preview event가 하나의 transaction으로 저장된다.
- terminal plan은 재승인·재적용할 수 없고 applied plan은 정확히 한 번만 적용된다.
- SELL/BUY가 함께 필요하면 SELL applied snapshot에 묶인 별도 BUY plan만 생성된다.
- 모든 fill이 Risk Engine decision과 pre/resulting portfolio state에 연결된다.
- 모든 fill의 실제 가격·유동성·비용 breakdown이 독립 재현되고 BUY net debit cap을 통과한다.
- partial fill 누계가 execution target을 넘지 않고 target 미달 plan은 applied가 될 수 없다.
- 각 action은 cap과 별도의 fractional BUY notional 또는 fractional/whole-share quantity
  target을 가지며 executor가 target을 재결정하지 않는다.
- unassigned legacy position은 observed state에 연결된 reduce-only SELL로만 표현된다.
- unassigned legacy SELL은 bucket lineage 없이 portfolio-level accounting record로 원자 반영된다.

<!-- /spom-source -->

<a id="spom-source-6433-6434"></a>
<!-- spom-source:6433-6434 sha256:e5095d087b36de9759a19f6fa1b1505f26ded25db9464358bce995e35cbda64a -->

### PR 7. Shared portfolio multi-bucket paper orchestrator

<!-- /spom-source -->

<a id="spom-source-6688-6719"></a>
<!-- spom-source:6688-6719 sha256:0033c4a924c00729008c5b4bf17dfebf038100319a5797e33e275cc5d05222ec -->

- cadence scheduler와 conflict resolver
- immutable regime/thesis trigger event repository와 dedupe resolver
- immutable risk-state update origin repository와 breach trigger resolver
- frozen evaluation snapshot을 가진 resumable trigger claim event chain
- bucket별 exit policy와 selection request 실행
- 각 fill 후 mark-to-market 및 risk snapshot 재평가
- paper-only execution과 audit lineage

완료 조건:

- 하나의 cycle에서 상충하는 BUY/SELL이 발생하지 않는다.
- 일반 paper fill은 policy/mandate/decision/risk decision, legacy reduce-only fill은 active root
  policy/observed legacy state/decision/risk decision/accounting record와 연결된다.

### PR 8. Integrated replay와 운영 화면

- isolated bucket과 full portfolio 비교
- target drift, turnover, cost, drawdown, evidence gap report
- mandate timeline과 rebalance plan dashboard
- E2E, accessibility, replay reproducibility 검증

완료 조건:

- 동일 fixture, policy, seed가 동일 final portfolio와 lineage hash를 만든다.
- dashboard가 backend ViewModel만 사용해 compliance를 표시한다.

### 후속 단계. Fundamental evidence source

- 공식적이고 provenance를 보존하는 read-only 재무 데이터 contract
- credential, 비용, 라이선스 또는 외부 계정 설정이 필요하면 owner 판단 후 진행
- source가 준비되기 전에는 long-term quality를 가격 데이터만으로 확정하지 않음

<!-- /spom-source -->
