# 전략 포트폴리오: policy와 lifecycle 계약

[운용 모델 진입점](../../plans/strategy-portfolio-operating-model-plan.md) · [현재 main 구현과 남은 작업](../../architecture/strategy-portfolio-implementation-status.md) · [기존 PR 1~8 단계](../../plans/strategy-portfolio/implementation-stages.md) · [검증·최종 수용 기준](../../plans/strategy-portfolio/validation-and-acceptance.md)

## 이 문서의 책임과 읽기 기준

이 문서는 해당 책임의 목표 계약과 구현 과정에서 구체화된 안전·저장·복구 제약의 정본이다.
계약의 존재를 전체 구현 완료나 실행 권한으로 해석하지 않는다. 기존 13절의 상세는 살아 있는
lock/lease, fail-closed, rollback 조건을 포함하므로 이력 파일로 숨기지 않고 여기 보존한다.

상세에 남은 “첫 분할”, “후속”, “아직”은 해당 분할의 범위 제한을 기록한 표현이다.
뒤의 분할이 추가한 기능까지 현재 미구현이라고 단정하지 않는다. 최신 연결 여부는 위의
현재 main 상태표와 소스를 확인하고, 원자 실행·권한 한계는 해당 계약 전체를 함께 적용한다.
기존 단계명·식별자·숫자·실패 및 복구 의미를 이 이동으로 변경하지 않는다.

<a id="spom-source-168-590"></a>
<!-- spom-source:168-590 sha256:28fb346495515fb65fd715293af08e09f08ca244ccca83d96e4cb9f9342225dc -->

### 6.1 `PortfolioPolicyActivationEvent`

```ts
type PortfolioPolicyActivationEvent =
  | {
      eventType: "activated";
      mode: "paper_only";
      activationId: string;
      activationEventHash: string;
      portfolioId: string;
      activationSequence: number;
      policyRecordId: string;
      policyId: string;
      policyVersion: string;
      policyHash: string;
      policyLineageHash: string;
      supersedesActivationId?: string;
      effectiveFrom: string;
      createdAt: string;
    }
  | {
      eventType: "retired";
      mode: "paper_only";
      retirementEventId: string;
      activationEventHash: string;
      portfolioId: string;
      activationSequence: number;
      retiredActivationId: string;
      reasonCode: string;
      effectiveFrom: string;
      createdAt: string;
    };
```

- policy record 자체는 immutable하게 유지한다.
- `activationId`와 `retirementEventId`는 재사용하지 않는다.
- `activationEventHash`는 variant별 event ID, hash와 `createdAt`을 제외한 complete canonical
  payload에서 계산하며 event ID는 hash에서 파생한다. resolver는 sequence fold 전에 모든
  event를 독립 rehash하고 policy record ID/ID/version/hash/lineage tuple,
  supersedes/retired target, effective time 또는 reason이 바뀐 record를 fail-closed한다. exact
  payload retry만 기존 event로 수렴한다.
- event는 backend가 append 시 부여한 portfolio별 연속 `activationSequence`를 가진다.
  예약·backdate를 지원하지 않으며 `effectiveFrom`은 `createdAt`과 같은 즉시 적용 시각이어야
  한다. 미래 또는 과거 effective time과 sequence gap/duplicate를 거절한다.
- 교체 activation은 현재 active ID를 `supersedesActivationId`로 지정해 한 event에서 이전
  activation을 닫고 새 policy를 연다. policy 없이 중단할 때는 `retiredActivationId`를 가진
  retirement event를 append한다.
- as-of resolver는 `effectiveFrom <= asOf`인 event만 선택한 뒤 `activationSequence` 오름차순으로
  fold하고 supersedes/retired target이 그 시점의 current active와 정확히 일치하는지
  검증한다. unknown target, 이미 닫힌 target과 분기된 transition은 fail-closed한다.
- 같은 `portfolioId`와 시점에 active policy가 0개 또는 2개 이상이면 해당 portfolio
  실행을 fail-closed한다.
- simulation run은 시작 시 policy hash를 고정하며 실행 도중 새 정책으로 바뀌지 않는다.

### 6.2 `StrategyBucketPolicy`

```ts
type TakeProfitPolicy =
  | { mode: "disabled" }
  | {
      mode: "full_exit";
      takeProfitRatio: number;
    }
  | {
      mode: "partial_then_trail";
      takeProfitRatio: number;
      takeProfitSellRatio: number;
      trailingStopFromPeakRatio: number;
    };

interface StrategyBucketExitPolicy {
  takeProfit: TakeProfitPolicy;
  stopLossRatio?: number;
  timeExpiryAction: "review_required" | "sell_all";
}

type EvidenceClass =
  | "market_technical"
  | "fundamental_quality"
  | "portfolio_fit"
  | "execution_fit";

interface EvidenceRequirement {
  evidenceClass: EvidenceClass;
  sourceContractId: string;
  maximumAgeSeconds: number;
  minimumObservationCount?: number;
}

interface BucketSelectionPolicyRecord {
  selectionPolicyRecordId: string;
  bucket: StrategyBucket;
  version: string;
  hash: string;
  lineageHash: string;
  requiredEvidence: EvidenceRequirement[];
  everyTickSourceRequirement?: {
    sourceContractId: string;
    eventType: "verified_market_packet";
    maximumAgeSeconds: number;
    dedupeKey: "packet_hash";
  };
  hardGateRuleIds: string[];
  hardGateRules?: CandidateHardGateRule[];
  costEstimationModelVersion?: string;
  liquidityEstimationModelVersion?: string;
  costBasisModelVersion?: string;
  classificationModelVersion?: string;
  exposureLimitPolicy?: {
    modelVersion: string;
    maximumSectorExposureRatio: number;
  };
  notionalSizingPolicy?: {
    modelVersion: string;
    minimumScoreMultiplier: number;
    maximumScoreMultiplier: number;
    minimumOrderNotionalKrw: number;
  };
  scoringModelVersion: string;
  scoringModelRef?: {
    scoringModelRecordId: string;
    version: string;
    hash: string;
  };
  featureDefinitionRefs: string[];
  createdAt: string;
}

interface BucketSelectionPolicyRef {
  selectionPolicyRecordId: string;
  version: string;
  hash: string;
  lineageHash: string;
}

type CanonicalRiskParameterValue =
  | string
  | number
  | boolean
  | null
  | CanonicalRiskParameterValue[]
  | { [key: string]: CanonicalRiskParameterValue };

interface PortfolioRiskRuleParameterRecord {
  riskRuleParameterRecordId: string;
  ruleId: string;
  ruleVersion: string;
  version: string;
  hash: string;
  lineageHash: string;
  parameters: { [key: string]: CanonicalRiskParameterValue };
  createdAt: string;
}

interface PortfolioRiskRuleParameterRef {
  riskRuleParameterRecordId: string;
  version: string;
  hash: string;
  lineageHash: string;
}

interface PortfolioRiskRuleSetRecord {
  riskRuleSetRecordId: string;
  version: string;
  hash: string;
  lineageHash: string;
  rules: Array<{
    ruleId: string;
    ruleVersion: string;
    appliesTo: Array<"BUY" | "SELL">;
    parameterRef: PortfolioRiskRuleParameterRef;
  }>;
  createdAt: string;
}

interface PortfolioRiskRuleSetRef {
  riskRuleSetRecordId: string;
  version: string;
  hash: string;
  lineageHash: string;
}

interface PortfolioLegacyReduceOnlyPolicy {
  allowBuyOrIncrease: false;
  maximumParticipationRatio: number;
  riskRuleSetRef: PortfolioRiskRuleSetRef;
}

type BucketSelectionTrigger =
  | { mode: "below_min" }
  | {
      mode: "entry_floor_on_due_cycle";
      entryWeightRatio: number;
    };

interface ScheduleBoundaryRecord {
  scheduleBoundaryRecordId: string;
  market: Market;
  version: string;
  hash: string;
  lineageHash: string;
  timeZone: string;
  sessionCalendarRecordId: string;
  sessionCalendarVersion: string;
  sessionCalendarHash: string;
  sessionCalendarLineageHash: string;
  interval: "hourly" | "daily" | "weekly";
  anchorLocalTime: string;
  weeklyAnchorDay?: "monday" | "tuesday" | "wednesday" | "thursday" | "friday";
  nonSessionDayRule: "previous_session" | "next_session";
  createdAt: string;
}

type SessionCalendarEntry =
  | {
      exchangeDate: string;
      sessionKind: "closed";
      sourceEvidenceRefs: string[];
    }
  | {
      exchangeDate: string;
      sessionKind: "regular" | "early_close" | "delayed_open";
      opensAt: string;
      closesAt: string;
      sourceEvidenceRefs: string[];
    };

interface SessionCalendarRecord {
  sessionCalendarRecordId: string;
  market: Market;
  version: string;
  hash: string;
  lineageHash: string;
  timeZone: string;
  validFromExchangeDate: string;
  validThroughExchangeDate: string;
  sessions: SessionCalendarEntry[];
  createdAt: string;
}

interface ScheduleBoundaryRef {
  scheduleBoundaryRecordId: string;
  version: string;
  hash: string;
  lineageHash: string;
}

type BucketReviewCadence =
  | { mode: "every_tick" }
  | {
      mode: "scheduled";
      boundaryRefs: ScheduleBoundaryRef[];
    };

interface BucketDrawdownSemanticsRecord {
  drawdownSemanticsRecordId: string;
  version: string;
  hash: string;
  lineageHash: string;
  equityBasis: "bucket_assets_plus_cash";
  unitFlowRule: "mint_burn_at_pre_flow_unit_nav";
  pnlRule: "mark_to_market_and_execution_cost_only";
  highWaterMarkRule: "max_previous_and_resulting_unit_nav";
  drawdownFormula: "one_minus_unit_nav_over_high_water_mark";
  emptyEpochRule: "preserve_nav_until_explicit_initial_or_empty_epoch";
  activationCarryRule: "carry_when_semantics_hash_matches";
  createdAt: string;
}

interface BucketDrawdownSemanticsRef {
  drawdownSemanticsRecordId: string;
  version: string;
  hash: string;
  lineageHash: string;
}

interface StrategyBucketPolicy {
  bucket: StrategyBucket;
  targetWeightRatio: number;
  minWeightRatio: number;
  maxWeightRatio: number;
  maxTurnoverRatio: number;
  turnoverWindow: {
    mode: "fixed_utc";
    durationSeconds: number;
    anchor: "unix_epoch";
    denominator: "window_open_portfolio_net_worth_krw";
  };
  maxDrawdownRatio: number;
  drawdownSemanticsRef: BucketDrawdownSemanticsRef;
  reviewCadence: BucketReviewCadence;
  eventTriggers: Array<
    "regime_change" | "thesis_evidence_change"
  >;
  selectionTrigger: BucketSelectionTrigger;
  openingCapacityPolicy?: {
    modelVersion: "bucket_opening_capacity_policy.v1";
    maximumPositionCount: number;
  };
  minimumHoldingSeconds?: number;
  maximumHoldingSeconds?: number;
  exitPolicy: StrategyBucketExitPolicy;
  enabledMarkets: Market[];
  enabledAssetClasses: string[];
  selectionPolicyRef: BucketSelectionPolicyRef;
  riskRuleSetRef: PortfolioRiskRuleSetRef;
}
```

- `holdingPeriodHint`를 실제 cadence와 holding boundary로 구체화한다.
- `openingCapacityPolicy`는 bucket별 최대 보유 종목 수를 runtime policy의 complete payload에
  고정한다. `maximumPositionCount`는 양의 safe integer이고 model version과 함께 policy hash,
  record ID와 lineage hash에 반영된다. Normalizer, parser와 append-only policy 저장소가 이 값을
  보존하며 독립 재해시에서 값 변조를 거절한다. 추가 필드와 잘못된 model/count는 허용하지 않는다.
- 기존 runtime policy와 해시를 유지하기 위해 이 필드는 optional이고 기본값을 소급 삽입하지 않는다.
  명시된 policy를 사용하는 gap analyzer는 외부 capacity의 `maximumPositionCount`가 더 크거나
  더 작아도 거절한다. Active position, pending reservation 및 mandate-bound unused slot은 기존처럼
  모두 차감한다. 필드 없는 과거 policy의 gap 계산은 기존 입력 계약을 유지하지만, 그것을 실제
  current capacity 할당 권한의 증거로 사용하지 않는다. 후속 공용 원장/CAS의 신규 할당 경로에는
  명시적인 한도 정책과 실제 점유 원본 검증이 필요하다. 이 변경만으로 그 경로가 구현된 것은 아니다.
- 새 필드가 있는 record는 이전 strict parser에서 거절된다. Reader를 먼저 배포하고 새 runtime
  policy를 발급해야 한다. Rollback 시 새 record가 있는 저장소를 이전 reader로 읽는 것은 호환되지
  않으므로 지원 reader를 유지해야 하며 record 삭제나 필드 제거/재해시로 원본을 바꾸지 않는다.
  기존 record의 migration은 없고 한도 값은 운영자가 명시해야 한다. 테스트 값은 운용 기본값이 아니다.
- `entry_floor_on_due_cycle`은 min 값과 무관하게 `entryWeightRatio`를 필수로 가지며
  `minWeightRatio <= entryWeightRatio <= targetWeightRatio`와 양수 조건을 검증한다.
- target이 양수이고 min이 0인 bucket에 `below_min`을 지정하면 empty portfolio에서
  영구적으로 선택 불가능하므로 policy validation에서 거절한다.
- `every_tick`은 `reviewCadence.mode = every_tick`으로 표현하며 `intraday` bucket이고
  참조한 immutable selection policy에
  `everyTickSourceRequirement`가 있을 때만 허용한다.
- selection policy hash는 record ID, `hash` 자체와 `createdAt`을 제외한 전체 payload에서
  계산한다. required evidence는 evidence class/source contract, hard-gate ID와 feature ref는
  각 canonical key로 정렬하고 duplicate를 거절하며 every-tick source requirement와 scoring
  model version도 digest에 포함한다. record ID는 hash에서 파생한다.
- scheduled cadence는 대상 market별 immutable `ScheduleBoundaryRecord`를 정확히 하나씩
  참조한다. record는 IANA timezone, versioned session calendar, local anchor, interval,
  weekly anchor와 non-session-day rule을 고정한다. 누락·중복 market, hash mismatch 또는
  policy가 허용한 market과 boundary market 불일치는 activation에서 거절한다.
- `weeklyAnchorDay`는 weekly record에서만 필수이며 hourly/daily record에는 허용하지 않는다.
  `hash`는 ID, `hash` 자체와 `createdAt`을 제외한 전체 boundary payload의 canonical hash로
  검증한다.
- `SessionCalendarRecord`는 exchange date별 session을 중복 없이 정렬해 저장한다. closed
  session은 open/close를 가질 수 없고, open session은 timezone offset이 포함된
  `opensAt < closesAt`을 필수로 가진다. record hash는 ID, `hash` 자체와 `createdAt`을 제외한
  전체 payload를 묶고 각 entry는 provenance ref를 가져야 한다.
- valid range의 모든 calendar date는 open 또는 closed entry를 정확히 하나 가져야 하며
  provenance ref는 검증된 official calendar evidence/publication으로 resolve되어야 한다.
- boundary resolver는 exact session calendar ID/version/hash를 읽는다. policy activation은
  calendar의 missing/corrupt와 market/timezone 불일치를 fail-closed하고, due-cycle 생성은 이에
  더해 requested slot의 date coverage를 검증해 date gap도 fail-closed한다.
- `enabledMarkets`는 비어 있지 않은 canonical unique set이어야 한다. scheduled cadence의
  resolved boundary market 집합은 `enabledMarkets`와 정확히 같아야 하고 `every_tick` packet,
  selection request, mandate 및 rebalance action의 market도 이 집합 안에 있어야 한다.
- schedule slot ID와 cutoff는 boundary record 및 session calendar로 계산한다. DST, 휴장,
  조기 종료를 구현체의 local timezone이나 처리 시각으로 추정하지 않는다.
- turnover window는 Unix epoch를 anchor로 한 고정 UTC 구간이며 duration은 양의 정수다.
  window ID는 policy와 독립적으로 portfolio/bucket/window start/end에서 파생하고 분모는 window 시작 직전
  immutable portfolio snapshot의 positive `virtualNetWorthKrw`로 고정한다. 분모를 resolve할 수
  없거나 0 이하이면 신규 fill을 fail-closed하며 중간 자금 유입으로 분모를 재설정하지 않는다.
- 같은 window 안의 policy activation은 기존 turnover event/state 누계를 그대로 이어받고 새
  policy의 `maxTurnoverRatio`를 누계에 적용한다. `turnoverWindow` duration/anchor/denominator를
  바꾸는 policy는 기존 window가 끝난 정확한 boundary에서만 activation할 수 있으며 중간
  activation은 거절한다. 정책 교체 자체로 window나 누계를 초기화할 수 없다.
- 모든 BUY/SELL fill의 absolute filled notional을 `BucketTurnoverEvent`에 append하고 선형
  predecessor, exact plan/action/fill origin, full event hash와 누계를 검증한다. state hash는
  event replay 결과와 같아야 하며 fill retry는 기존 event로 수렴한다. turnover ratio는
  `cumulativeAbsoluteFilledNotionalKrw / windowOpenPortfolioNetWorthKrw`다.
- turnover event hash는 event ID/hash/createdAt을 제외한 complete payload에서 계산하고 ID는
  hash에서 파생한다. state ID는 window identity에서 파생하며 state hash는 자기 hash를 제외한
  complete snapshot payload에서 계산한다. resolver는 event chain을 replay해 누계, ratio,
  last event와 state hash를 독립 검증한다.
- `risk_breach`는 선택 가능한 `eventTriggers` 값이 아니다. 모든 enabled bucket은 market
  mark, fill, fee, cash-flow와 risk-state update마다 cadence와 무관하게 Risk Engine에서
  재평가되며 breach는 즉시 신규 매수를 차단하고 sell-first reduce-only cycle을 만든다.
- activation과 replay 시작 시 `selectionPolicyRef`가 같은 bucket/version/hash의 immutable
  record로 resolve되어야 한다. required evidence, freshness, source contract, hard gate,
  feature와 scoring version을 구현 기본값으로 대체하지 않는다. resolver는 canonical payload를
  독립 rehash해 ID/ref/hash가 모두 일치하지 않으면 fail-closed한다.
- `riskRuleSetRef`도 같은 ID/version/hash의 immutable record로 resolve하고 rule ID 중복,
  빈 applicability와 parameter ref mismatch를 거절한다. action side에 적용되는 rule 전체가
  Risk Engine decision의 required set이며 caller가 일부 rule만 선택할 수 없다.
- risk rule set은 rule ID로 canonical sort하고 ID/createdAt/hash를 제외한 payload에서 hash를
  계산한다. BUY와 SELL 각각에 적용되는 required rule이 하나 이상이어야 하며 record는
  append-only다.
- 각 `parameterRef`는 같은 rule ID/version을 가진 immutable
  `PortfolioRiskRuleParameterRecord`로 resolve되어야 한다. parameter record hash는 ID,
  `hash`, `createdAt`을 제외한 canonical payload에서 계산하고 ID는 hash에서 파생한다.
  object key는 lexical order로 canonicalize하고 non-finite number, duplicate key와 지원하지
  않는 value type을 거절한다. Risk Engine replay와 fill 직전 재검증은 이 저장 payload의
  수치·enum·boolean만 사용하며 현재 runtime default로 누락값을 보충하지 않는다.
- `drawdownSemanticsRef`는 exact immutable `BucketDrawdownSemanticsRecord`로 resolve한다. hash는
  ID/hash/createdAt을 제외한 complete payload에서 계산하고 ID는 hash에서 파생한다. activation,
  risk-state replay와 breach evaluation은 저장된 unit flow/PnL/HWM/drawdown/empty/carry rule만
  사용하고 runtime 구현 기본값으로 대체하지 않는다. 독립 rehash 또는 version/hash가 다르면
  activation과 신규 매수를 fail-closed한다.
- 여섯 dependency record는 semantic `hash`/hash-derived ID와 별도로 `lineageHash`를 가진다.
  `lineageHash`는 `recordType`, record ID, semantic hash, `createdAt`과 canonical child
  `dependencyLineageHashes`의 digest이며 모든 ref가 이를 포함한다. risk rule set은 parameter
  lineage를, schedule boundary는 session calendar lineage를 parent lineage digest에 포함해
  상위 runtime policy hash까지 생성 시각 provenance를 연쇄 결속한다. 새 lineage-only field는
  기존 semantic hash/ID 입력에서 제외해 append-only artifact identity를 유지한다. parser,
  loader와 resolver는 semantic hash/ID와 lineage hash를 모두 독립
  검증하며 어느 dependency의 `createdAt`만 바뀌어도 activation 전 fail-closed한다.
- active `PortfolioPolicy` canonical hash는 각 bucket의 `enabledMarkets`, complete
  `selectionPolicyRef`, `riskRuleSetRef`, `drawdownSemanticsRef`, `reviewCadence` boundary ref와
  `turnoverWindow`를 포함해
  selection/risk/schedule rule 교체가 동일 policy hash 아래에서 일어나지 않게 한다.
- root `PortfolioPolicy`는 bucket lineage가 없는 position 전용
  `PortfolioLegacyReduceOnlyPolicy`를 필수로 가지며 이 config와 rule-set ref도 policy hash에
  포함한다. 이 policy는 SELL과 exposure 축소만 허용하고 bucket을 합성하지 않는다.
- take-profit을 사용하지 않으면 `disabled`, 전량 익절은 trigger ratio가 필수인
  `full_exit`, 부분 익절은 trigger/sell/trailing ratio가 모두 필수인
  `partial_then_trail`로만 표현한다. 각 ratio의 범위도 strict validation한다.
- `maximumHoldingSeconds`가 있으면 `timeExpiryAction`을 함께 검증한다.
- holding boundary는 `minimumHoldingSeconds >= 0`, `maximumHoldingSeconds > 0`이고 둘 다
  있으면 반드시 `minimumHoldingSeconds < maximumHoldingSeconds`여야 한다. 같거나 역전된
  값은 policy validation에서 거절한다.
- `review_required`는 만료 시 신규 매수를 차단하고 검토 상태로만 전환한다.
- `sell_all`을 명시한 bucket만 만료 시 reduce-only paper sell candidate를 만들며,
  Risk Engine 재검증을 통과해야 한다.
- lifecycle, stale evidence, Risk Engine reject는 minimum holding보다 우선한다.

<!-- /spom-source -->

<a id="spom-source-3033-3098"></a>
<!-- spom-source:3033-3098 sha256:f46d6e595d5c362292f1dd821c24be380a382af341d7806f2fdfa12bf775d80f -->

## 10. Policy lifecycle과 저장 artifact

계획된 artifact는 모두 paper-only이며 real account identifier를 포함하지 않는다.

| Artifact | 형태 | 책임 |
| --- | --- | --- |
| `bucket-selection-policy-records.jsonl` | 신규 append-only | evidence/freshness/hard gate/scoring rule set |
| `candidate-scoring-model-records.jsonl` | 신규 immutable dependency, read-only loader | 명시적 가중치/정규화 모델의 exact ID/version/hash; writer는 후속 |
| `portfolio-risk-rule-parameter-records.jsonl` | 신규 append-only | rule별 canonical parameter payload와 immutable hash |
| `portfolio-risk-rule-set-records.jsonl` | 신규 append-only | side별 required Risk Engine rule과 parameter ref |
| `bucket-drawdown-semantics-records.jsonl` | 신규 append-only | unit NAV/HWM/reset/carry 계산 규칙 payload |
| `session-calendar-records.jsonl` | 신규 append-only | exchange-date별 session과 provenance |
| `schedule-boundary-records.jsonl` | 신규 append-only | market timezone, calendar와 cadence slot boundary |
| `portfolio-policy-records.jsonl` | 기존 append-only | validated immutable policy |
| `runtime-portfolio-policy-records.jsonl` | 신규 append-only | dependency-resolved canonical runtime policy와 immutable lineage |
| `portfolio-policy-activations.jsonl` | 신규 append-only | portfolio별 active/retired policy lineage |
| `manual-assignment-events.jsonl` | 신규 append-only | full digest로 인증한 manual authorization과 sizing lineage |
| `manual-opening-capacity-reservations.jsonl` | 신규 append-only | manual open/increase의 single-use slot·notional 예약 |
| `opening-capacity-reservation-events.jsonl` | 신규 append-only | selector/manual 예약의 mandate binding, fill 소비와 release chain |
| `bucket-opening-capacity-state.json` | 신규 snapshot | selector/manual 공용 slot·opening budget CAS ledger |
| `instrument-mandate-records.jsonl` | 신규 append-only | immutable 종목 역할·target·evidence |
| `instrument-mandate-events.jsonl` | 신규 append-only | mandate hash에 묶인 activate/review/retire transition chain |
| `bucket-mandate-migration-transfers.jsonl` | 신규 append-only | cross-bucket equity·mark-head·mandate 원자 transfer |
| `position-strategy-state.json` | 신규 snapshot | full digest로 검증하는 현재 보유기간·peak·review 상태 |
| `bucket-equity-events.jsonl` | 신규 append-only | full-event digest를 가진 capital flow, valuation, execution cost |
| `bucket-valuation-mark-records.jsonl` | 신규 append-only | valuation별 immutable position/mark origin과 delta |
| `bucket-position-mark-head-events.jsonl` | 신규 append-only | 종목별 mark initialization, valuation과 position mutation chain |
| `bucket-position-mark-head-state.json` | 신규 snapshot | 종목별 last accepted price/evidence와 valuation predecessor |
| `bucket-risk-state.json` | 신규 snapshot | unit NAV, high-water mark와 drawdown current state |
| `bucket-turnover-events.jsonl` | 신규 append-only | window별 fill turnover 원천과 누계 |
| `bucket-turnover-state.json` | 신규 snapshot | 고정 분모, 누적 notional과 turnover ratio |
| `portfolio-sizing-snapshots.jsonl` | 신규 append-only | sizing 시점의 virtual portfolio, mark와 exposure |
| `candidate-sizing-input-records.jsonl` | 신규 append-only | feature, exposure/liquidity cap과 execution cost input |
| `market-technical-evidence-records.jsonl` | 신규 append-only | 실제 historical source prefix와 지표 evidence의 entry/commit pair |
| `portfolio-policy-trigger-events.jsonl` | 신규 append-only | regime/thesis evidence change payload와 canonical hash |
| `portfolio-risk-state-updates.jsonl` | 신규 append-only | risk trigger별 immutable update origin과 canonical hash |
| `portfolio-trigger-claims.jsonl` | 신규 append-only | mutable snapshot과 독립적인 trigger dedupe claim |
| `portfolio-trigger-claim-events.jsonl` | 신규 append-only | claim 평가 시작과 plan/no-action terminal 결과 |
| `portfolio-gap-snapshots.jsonl` | 신규 append-only | policy 대비 현재 gap |
| `bucket-selection-requests.jsonl` | 신규 append-only | full digest와 재계산 가능한 bucket selection 요청 |
| `candidate-assignment-records.jsonl` | 신규 append-only | assignment와 request별 sealed set을 같은 잠금/entry·commit 이력에 저장 |
| `rebalance-plan-records.jsonl` | 신규 append-only | immutable plan scope, action과 canonical hash |
| `portfolio-action-risk-decisions.jsonl` | 신규 append-only | plan/action/pre-state별 Risk Engine 최종 판단 |
| `rebalance-plan-events.jsonl` | 신규 append-only | preview, approval, fill execution, rejection, stale, applied transition chain |
| `paper-fill-execution-records.jsonl` | 신규 append-only | 실제 fill input/output과 비용 breakdown 전체 digest |
| `portfolio-legacy-execution-accounting.jsonl` | 신규 append-only | unassigned legacy SELL의 portfolio-level 회계 |

정책에 묶인 selector, mandate와 rebalance downstream artifact는 최소한 `policyHash`,
`portfolioId`, `asOf`를 record 또는 record envelope에 직접 포함하고, source/evidence
ref가 적용되면 해당 ref도 직접 포함한다. `unassigned_legacy`는 policy lineage가 없음을
명시하는 예외다. corrupt line이나 lineage mismatch는 경고만 표시하고 계속 매수하는
대신 fail-closed한다.
legacy position의 안전한 축소는 `unassigned_legacy_reduce_only` action만 사용하며 fabricated
mandate 없이 observed position과 legacy state에 연결한다. 이 경로로 BUY 또는 increase를
표현할 수 없다.
selector가 만든 mandate는 immutable portfolio sizing snapshot, request, sizing input과
assignment record를 순서대로 append-only 저장한 뒤에만 발행한다. 각 ID가 resolve되지
않거나 policy/snapshot/scoring/sizing lineage가 일치하지 않으면 mandate 생성을 거절한다.
manual mandate도 같은 transaction에서 `ManualAssignmentEvent`를 검증·append하고 scope와 해당
sizing 또는 classification range가 일치할 때만 발행한다. 신규 매수를 허용하는 manual event는 active
selection policy의 동일한 evidence/freshness/hard gate와 immutable portfolio snapshot 기반
sizing input record 및 backend sizing input/output hash까지 검증한다. active policy가 참조하는
selection policy record가 없거나 hash가 다르면 candidate evaluation과 신규 매수를
fail-closed한다. selector와 manual 신규 mandate는 공용 `BucketOpeningCapacityState`를 CAS로
갱신해 같은 bucket의 slot과 opening budget을 원자적으로 예약·소비한다.

<!-- /spom-source -->

## 기존 PR 1의 세부 계약 · 원문 3169–3254행

<a id="spom-source-3169-3254"></a>
<!-- spom-source:3169-3254 sha256:f11870da337d37fddee7a355383705815e29c749be79d0508d82b24a0e6e21d4 -->

첫 단계의 contract는 `src/portfolio/runtimePolicyContracts.ts`에 두며 filesystem 저장이나
runner/order engine 연결을 포함하지 않는다. 후속 resolver는 이 contract가 검증한 exact
ID/version/hash만 사용하고 runtime default로 누락값을 보충하지 않는다.

두 번째 단계도 exact dependency resolver와 validation candidate 정규화/persistence adapter로
나눈다. resolver는 `src/portfolio/runtimePolicyDependencyResolver.ts`에서 전체 dependency set의
손상·중복 ID를 먼저 거절하고 selection/risk/drawdown/schedule/calendar ref를 독립 재검증한다.
정규화와 filesystem adapter는 resolver 위의 별도 변경으로 추가하며 activation이나 runner에는
아직 연결하지 않는다.

filesystem adapter의 첫 변경은 `src/portfolio/runtimePolicyDependencyFiles.ts`의 read-only
loader로 제한한다. 여섯 dependency JSONL 중 corrupt line이 하나라도 있으면 부분 record set을
만들지 않고 전체 load를 거절하며, 로드 후 resolver가 semantic hash와 duplicate ID를 다시
검증한다. lineage field 도입 전 record는 loader가 원본 파일을 수정하지 않는 read-time migration으로
leaf lineage를 결정적으로 backfill하고 risk set→parameter, boundary→calendar lineage를 exact ref로
연결한 뒤 최신 parser를 통과시킨다. legacy semantic hash/ID는 유지하며 partial lineage나 ref
mismatch는 migration하지 않고 fail-closed한다. 부모 parser가 trim하던 legacy record ID와 nested
ref ID/version은 같은 canonical form으로 변환한 뒤 exact lookup과 lineage 계산을 수행한다. offset
legacy `createdAt`은 주변 공백을 먼저 제거해 이미 명시된 zone을 보존한다. offset 없는 legacy
`createdAt`의 시간대는 추측하지
않으며 loader 기본 동작은 해당 record를 거절한다. 운영자가 `legacyOffsetlessCreatedAtOffset`에 `Z`
또는 `-14:00`~`+14:00` 범위의 numeric offset을 명시한 경우에만 메모리에서 시각대를 보완하고,
ISO와 `YYYY/MM/DD`/`MM/DD/YYYY` date-only 값은 해당 offset의 자정으로 정규화한다. semantic
hash/ID와 원본 파일은 그대로
유지한다. 단독 `Z`/`z`, `GMT`/`UTC`, RFC numeric zone, `GMT+HHMM`, 짧은
`GMT+H`/`+HH`/`GMT+H:MM` offset, `GMT0`/`UT0` 계열의 zero-suffixed UTC 또는 ISO compact numeric offset처럼 시간대가 명시된 legacy 형식은 별도 option보다
우선해 epoch-equivalent ISO UTC로 canonicalize한다.
기존 `JsonlStore.append`는 cross-process atomic
dedupe를 제공하지 않으므로 dependency writer와 exact-retry 처리는 원자성 계약을 갖춘 후속
변경 전까지 노출하지 않는다.

current validation candidate 정규화는 `src/portfolio/runtimePortfolioPolicy.ts`가 담당한다.
기존 candidate의 allocation/cash/hedge/exposure 값은 backend validation을 다시 통과해야 하며,
normalizer는 candidate와 record ID를 따로 받지 않고 strict `PaperPolicyRecord`를 받아
record ID 파생 규칙, record tuple, policy hash, validation summary가 내장 candidate와
일치하는지 다시 검증한다. runtime payload의 `sourcePolicyRecordHash`는 strict source record
전체의 canonical digest를 저장해 같은 policy ID/생성 millisecond가 재사용되어도 정확한 source
payload를 구분한다. source tuple의 식별자는 이미 trim된 canonical 값이어야 하며
source `validation.validatedAt`은 source record `createdAt`과 같아야 한다. runtime `createdAt`은
source record `createdAt`보다 빠를 수 없다. resolve된 selection, risk set/parameter, drawdown,
schedule boundary/calendar와 legacy risk dependency도 runtime `createdAt` 이후에 생성될 수 없다.
각 dependency ref는 ID/version/semantic hash뿐 아니라 `lineageHash`도 exact-match해야 하며,
상위 runtime policy hash가 resolved dependency의 생성 시각 provenance까지 고정한다.
각 risk parameter `createdAt`은 참조한 risk rule set보다 늦을 수 없고, session calendar
`createdAt`은 참조한 schedule boundary보다 늦을 수 없다. flat runtime cutoff만 만족하는
역전된 nested lineage도 resolver에서 거절한다.
chronology에 참여하는 activation timestamp는 `Z` 또는 numeric UTC offset과 정확히 3자리
millisecond precision을 포함해야 하며, sub-millisecond 입력을 허용하지 않는다.
dependency/runtime policy timestamp도 `Z` 또는 numeric UTC offset을 포함하고
sub-millisecond를 허용하지 않으며 최대 3자리 fractional second까지만 허용한다.
여섯 dependency record의 constructor와 parser가 이 조건을 직접 강제해 offset 없는
`createdAt` artifact가 저장된 뒤 runtime resolution에서만 실패하는 상태를 허용하지 않는다.
stored runtime record parser는 strict schema parse 결과가 raw input과 deep-equal해야만 허용해
root와 nested identifier의 조용한 trim 변환을 거절하며 `createdAt` offset도 다시 검증한다.
runtime record는 semantic policy hash/ID와 별도 `lineageHash`에 `createdAt`을 결속해 저장 시각
단독 변조를 거절한다.
filesystem repository는 `src/portfolio/runtimePortfolioPolicyFiles.ts`가 담당한다.
`runtime-portfolio-policy-records.jsonl`의 read-validate-append 전체를 `wx` exclusive lock으로
직렬화하고, record를 append하거나 읽을 때마다 complete payload hash와 hash-derived ID를
재검증한 뒤 모든 immutable dependency ref를 다시 해소한다. exact record retry는 기존 record로
수렴하며 file handle sync 이후에만 성공을 반환한다. 같은 semantic ID의 다른 lineage,
corrupt/torn/blank line, duplicate record ID 또는 abandoned lock은 자동 복구하지 않고
fail-closed한다. 이 repository도 runner/order engine에는 연결하지 않는다.
cadence, holding, exit, selection/risk/drawdown/calendar ref는 bucket별 normalization input으로
명시해야 한다. 결과 record는 canonical 5-bucket 순서, source policy hash, legacy reduce-only
rule-set ref를 포함한 complete payload hash와 hash-derived ID를 가지며 저장 전 dependency
resolver를 통과한다. asset class canonicalization은 runtime contract와 동일한 UTF-8 byte
comparator를 사용한다. activation 시 runtime default로 누락값을 보충하지 않는다.

activation contract와 as-of resolver는 `src/portfolio/runtimePortfolioPolicyActivation.ts`가
담당한다. activated/retired payload 전체를 독립 rehash하고 event ID를 hash에서 다시 파생하며,
portfolio별 sequence, 즉시 적용 시각, supersedes/retired target을 선형 fold한다. activated
policy는 record ID/ID/version/hash/lineage tuple을 exact-match하고 모든 bucket의
selection/risk/drawdown/schedule/calendar dependency와 root legacy risk set을 다시 해소한다.
scheduled bucket은 activation 시 enabled market과 boundary market의 canonical 집합이 정확히
같아야 하며, 실제 exchange-date coverage는 해당 orchestration cycle에서 검증한다. 교체 policy가
bucket의 turnover window semantics를 바꾸면 기존 Unix-epoch window의 정확한 boundary에서만
활성화한다.

filesystem repository는 `src/portfolio/runtimePortfolioPolicyActivationFiles.ts`가 담당한다.
`portfolio-policy-activations.jsonl`의 read-validate-append 전체를 `wx` exclusive lock으로
직렬화하고 portfolio별 sequence를 repository 안에서 부여한다. 같은 append input의 retry는 이미
저장된 event로 수렴하며 file handle sync 이후에만 성공을 반환한다. corrupt/torn line, duplicate
event ID, invalid chain 또는 abandoned lock은 자동 복구를 추측하지 않고 fail-closed한다. 이
repository도 runner/order engine에는 아직 연결하지 않는다.

<!-- /spom-source -->

## 기존 PR 2의 세부 계약 · 원문 3277–3308행

<a id="spom-source-3277-3308"></a>
<!-- spom-source:3277-3308 sha256:f0e887814e829dcd7ea67aed5f87e8a9be4759d45c7848c1e50f1918a99037cf -->

`src/api/dashboardViewModels.ts`는 virtual portfolio snapshot의 `updatedAt`을 as-of로 사용해
immutable dependency, `runtime-portfolio-policy-records.jsonl`,
`portfolio-policy-activations.jsonl`을 strict read한 뒤 해당 `portfolioId`의 active policy를
해소한다. 화면에 내리는 `activePolicy`는 runtime record ID, policy ID/version/hash와 activation
ID/effective time을 함께 보존한다. bucket `gapRatio`는 `targetWeightRatio -
currentWeightRatio`이며 min 미만은 `under`, max 초과는 `over`, band 안은 `ok`다. active policy가
없거나 retired 상태이면 target/min/max/gap을 `null`과 `missing_policy`로 내리고, corrupt
policy/dependency/activation lineage는 `policyStatus = invalid`, source `corrupt`, 전체 `breach`로
fail-closed한다. portfolio as-of는 UTC 또는 numeric offset이 있는 timestamp만 canonical UTC로
정규화하며 numeric offset의 extended `+09:00`과 basic `+0900` 형식을 모두 허용한다. active
policy가 hedge를 비활성화한 경우 관측 hedge 효과성은 표시하되 이를 전체 breach에는 합산하지
않는다. backend는 이 정책 상태를 hedge compliance의 `policyEnabled`로 내리고 Next.js breach
목록도 같은 flag가 `true`일 때만 `ineffective`/`over_hedged`를 위반으로 표시한다.
`strategyBucket`이 없는 legacy position은 `unassigned` exposure로 별도 표시하고 active
policy compliance를 `breach`로 fail-closed한다. `ImmutablePolicyDependencyFileLoader`도 여섯
dependency JSONL을 처음 읽는 동안 생길 수 있는 mixed generation 또는 append 중인 마지막 줄의
transient corruption을 내부에서 한 번 더 읽어 검증한다. 두 번째 generation이 clean strict
append-only extension인 경우에만 복구한다. dependency → policy → activation
publication 사이의 모든 cross-file race는 앞서 읽은 각 record 배열을 exact prefix로 보존하는
strict append-only extension이 관찰된 경우에만 bounded re-read한다. truncated, reordered,
replaced generation과 stable corruption은 재시도로 숨기지 않는다.
policy repository는 dependency validation 전 raw record generation을, activation repository는
history validation 전 structural event generation을 함께 반환한다. 따라서 최초 validation이 stale
dependency/policy 때문에 실패해도 retry policy/event 배열이 최초 관찰 배열을 exact prefix로
보존하는지 독립적으로 검증한다.
active policy가 있을 때 cash target과 absolute reserve floor도 같은 policy record에서 읽는다. 이
read-only 경로는 runner, Risk Engine 또는 OrderRouter를 호출하지 않는다.

Next.js dashboard contract와 `/dashboard`, `/dashboard/portfolio` Server Component는 nullable
band/gap을 0%로 대체하지 않고 `missing`으로 표시하며, active policy version/hash와 bucket별
min/target/max/current/gap을 backend ViewModel 그대로 렌더링한다.

<!-- /spom-source -->
