# 전략 포트폴리오: rebalance·Risk·fill 계약

[운용 모델 진입점](../../plans/strategy-portfolio-operating-model-plan.md) · [현재 main 구현과 남은 작업](../../architecture/strategy-portfolio-implementation-status.md) · [기존 PR 1~8 단계](../../plans/strategy-portfolio/implementation-stages.md) · [검증·최종 수용 기준](../../plans/strategy-portfolio/validation-and-acceptance.md)

## 이 문서의 책임과 읽기 기준

이 문서는 해당 책임의 목표 계약과 구현 과정에서 구체화된 안전·저장·복구 제약의 정본이다.
계약의 존재를 전체 구현 완료나 실행 권한으로 해석하지 않는다. 기존 13절의 상세는 살아 있는
lock/lease, fail-closed, rollback 조건을 포함하므로 이력 파일로 숨기지 않고 여기 보존한다.

상세에 남은 “첫 분할”, “후속”, “아직”은 해당 분할의 범위 제한을 기록한 표현이다.
뒤의 분할이 추가한 기능까지 현재 미구현이라고 단정하지 않는다. 최신 연결 여부는 위의
현재 main 상태표와 소스를 확인하고, 원자 실행·권한 한계는 해당 계약 전체를 함께 적용한다.
기존 단계명·식별자·숫자·실패 및 복구 의미를 이 이동으로 변경하지 않는다.

<a id="spom-source-1871-2336"></a>
<!-- spom-source:1871-2336 sha256:f235c3c1e11f6a2510d9df072137d8351e463072836888eca867596ea8779a6c -->

### 6.7 `RebalancePlanRecord`와 `RebalancePlanEvent`

```ts
type RebalanceExecutionTarget =
  | {
      targetKind: "fractional_buy_notional";
      targetNotionalKrw: number;
    }
  | {
      targetKind: "fractional_sell_quantity";
      targetQuantity: number;
      referencePriceKrw: number;
      markedTargetNotionalKrw: number;
      priceEvidenceRef: string;
    }
  | {
      targetKind: "whole_share_quantity";
      targetQuantity: number;
      referencePriceKrw: number;
      plannedNotionalKrw: number;
      residualNotionalKrw: number;
      priceEvidenceRef: string;
    };

interface RebalanceActionBase {
  actionId: string;
  actionSequence: number;
  market: Market;
  symbol: string;
  executionTarget: RebalanceExecutionTarget;
  maximumNotionalKrw: number;
  reasonCodes: string[];
}

type RebalanceAction = RebalanceActionBase &
  (
    | {
        lineageKind: "mandate";
        side: "BUY" | "SELL";
        mandateId: string;
      }
    | {
        lineageKind: "unassigned_legacy_reduce_only";
        side: "SELL";
        observedPositionRef: string;
        legacyStateDetectedAt: string;
      }
  );

type RebalancePlanPredecessor =
  | {
      predecessorKind: "applied";
      predecessorPlanId: string;
      predecessorPlanHash: string;
      predecessorPlanEventId: string;
      predecessorPlanEventHash: string;
    }
  | {
      predecessorKind: "stale";
      predecessorPlanId: string;
      predecessorPlanHash: string;
      predecessorPlanEventId: string;
      predecessorPlanEventHash: string;
    };

interface RebalancePlanRecord {
  planId: string;
  cycleId: string;
  portfolioId: string;
  portfolioVersion: string;
  portfolioSnapshotHash: string;
  policyHash: string;
  evidenceCutoffAt: string;
  triggerRef: string;
  phase: "sell" | "buy";
  predecessor?: RebalancePlanPredecessor;
  actions: [RebalanceAction, ...RebalanceAction[]];
  planHash: string;
  createdAt: string;
}

interface PortfolioActionRiskDecision {
  riskDecisionId: string;
  riskDecisionHash: string;
  riskRuleSetRecordId: string;
  riskRuleSetVersion: string;
  riskRuleSetHash: string;
  planId: string;
  actionId: string;
  portfolioId: string;
  policyHash: string;
  expectedPortfolioVersion: string;
  expectedPortfolioSnapshotHash: string;
  market: Market;
  symbol: string;
  side: "BUY" | "SELL";
  riskRuleScope:
    | { scopeKind: "bucket"; bucket: StrategyBucket }
    | { scopeKind: "legacy_reduce_only"; legacyPolicyHash: string };
  actionExecutionTargetHash: string;
  turnoverAssessment:
    | {
        scopeKind: "bucket";
        turnoverStateId: string;
        turnoverStateHash: string;
        turnoverWindowOpenPortfolioNetWorthKrw: number;
        priorBucketTurnoverNotionalKrw: number;
        requestedBucketTurnoverNotionalKrw: number;
        resultingBucketTurnoverRatio: number;
      }
    | {
        scopeKind: "legacy_reduce_only";
        countedInBucketTurnover: false;
      };
  priorCumulativeFilledNotionalKrw: number;
  priorCumulativeFilledQuantity: number;
  requestedNotionalKrw: number;
  requestedQuantity: number;
  worstCaseFillNotionalKrw: number;
  approvedMaximumFillNotionalKrw: number;
  cashAssessment:
    | {
        side: "BUY";
        worstCaseNetCashDebitKrw: number;
        approvedMaximumNetCashDebitKrw: number;
      }
    | {
        side: "SELL";
        expectedMinimumNetCashCreditKrw: number;
      };
  decision: "approved" | "rejected";
  requiredRuleIds: string[];
  ruleResults: Array<{
    ruleId: string;
    result: "pass" | "fail";
    reasonCode: string;
  }>;
  riskInputHash: string;
  riskEvidenceRefs: string[];
  decidedAt: string;
}

interface PaperFillExecutionRecord {
  paperFillRecordId: string;
  paperFillHash: string;
  portfolioId: string;
  rebalancePlanId: string;
  rebalanceActionId: string;
  fillId: string;
  market: Market;
  symbol: string;
  side: "BUY" | "SELL";
  requestedNotionalKrw: number;
  requestedQuantity: number;
  quantityOverride: number | null;
  sourcePriceKrw: number;
  sourcePriceEvidence: {
    sourceContractId: string;
    evidenceRef: string;
    evidenceHash: string;
    market: Market;
    symbol: string;
    priceField: "last_price";
    observedAt: string;
  };
  averagePriceKrw: number | null;
  fillPriceKrw: number;
  quantity: number;
  filledNotionalKrw: number;
  grossAmountKrw: number;
  netAmountKrw: number;
  participationRate: number | null;
  volume: number | null;
  averageVolume: number | null;
  liquidityStale: boolean;
  fillStatus: "filled" | "partial";
  liquidityStatus: "not_modeled" | "sufficient" | "partial";
  liquidityRejectReason: null;
  fractionalShares: boolean;
  executionPolicy: {
    modelVersion: string;
    fillPriceRule: "current_candidate_last_price";
    slippageBps: number;
    feeBps: number;
    taxBps: number;
    halfSpreadBps: number;
    fillRatio: number;
    allowFractionalShares: boolean;
    maxVolumeParticipationRate: number;
    minLiquidityFillRatio: number;
    rejectStaleLiquidity: boolean;
    marketImpactBpsPerParticipationRate: number;
  };
  costBreakdown: {
    feeKrw: number;
    taxKrw: number;
    slippageKrw: number;
    spreadCostKrw: number;
    impactCostKrw: number;
    totalCostKrw: number;
  };
  evidenceRefs: string[];
  asOf: string;
  createdAt: string;
}

interface PortfolioLegacyExecutionAccountingRecord {
  legacyAccountingRecordId: string;
  legacyAccountingHash: string;
  portfolioId: string;
  observedPositionRef: string;
  activePortfolioPolicyHash: string;
  rebalancePlanId: string;
  rebalanceActionId: string;
  fillId: string;
  paperFillRecordId: string;
  paperFillHash: string;
  grossProceedsKrw: number;
  totalExecutionCostKrw: number;
  netCashCreditKrw: number;
  expectedPrePortfolioVersion: string;
  expectedPrePortfolioSnapshotHash: string;
  resultingPortfolioVersion: string;
  resultingPortfolioSnapshotHash: string;
  asOf: string;
  createdAt: string;
}

type RebalancePlanEvent =
  | {
      planEventId: string;
      planEventHash: string;
      previousPlanEventId?: never;
      eventType: "previewed";
      planId: string;
      planHash: string;
      cycleId: string;
      portfolioId: string;
      portfolioVersion: string;
      portfolioSnapshotHash: string;
      policyHash: string;
      asOf: string;
    }
  | {
      planEventId: string;
      planEventHash: string;
      previousPlanEventId: string;
      eventType: "approved" | "rejected";
      planId: string;
      planHash: string;
      cycleId: string;
      portfolioId: string;
      portfolioVersion: string;
      portfolioSnapshotHash: string;
      policyHash: string;
      asOf: string;
      reasonCodes: string[];
    }
  | {
      planEventId: string;
      planEventHash: string;
      previousPlanEventId: string;
      eventType: "stale";
      planId: string;
      planHash: string;
      cycleId: string;
      portfolioId: string;
      portfolioVersion: string;
      portfolioSnapshotHash: string;
      policyHash: string;
      observedCurrentPortfolioVersion: string;
      observedCurrentPortfolioSnapshotId: string;
      observedCurrentPortfolioSnapshotHash: string;
      asOf: string;
      reasonCodes: string[];
    }
  | {
      planEventId: string;
      planEventHash: string;
      previousPlanEventId: string;
      eventType: "execution_applied";
      planId: string;
      planHash: string;
      cycleId: string;
      portfolioId: string;
      portfolioVersion: string;
      portfolioSnapshotHash: string;
      policyHash: string;
      asOf: string;
      actionId: string;
      actionSequence: number;
      fillSequence: number;
      fillId: string;
      paperFillRecordId: string;
      paperFillHash: string;
      requestedNotionalKrw: number;
      requestedQuantity: number;
      filledNotionalKrw: number;
      filledQuantity: number;
      cumulativeFilledNotionalKrw: number;
      cumulativeFilledQuantity: number;
      riskDecisionId: string;
      expectedPrePortfolioVersion: string;
      expectedPrePortfolioSnapshotHash: string;
      resultingPortfolioVersion: string;
      resultingPortfolioSnapshotHash: string;
    }
  | {
      planEventId: string;
      planEventHash: string;
      previousPlanEventId: string;
      eventType: "applied";
      planId: string;
      planHash: string;
      cycleId: string;
      portfolioId: string;
      portfolioVersion: string;
      portfolioSnapshotHash: string;
      policyHash: string;
      asOf: string;
      executionEventIds: string[];
      resultingPortfolioVersion: string;
      resultingPortfolioSnapshotHash: string;
    };
```

- plan 본문은 immutable `RebalancePlanRecord`로 한 번만 저장한다. `planHash`는 plan ID,
  `planHash` 자체와 생성 시각을 제외한 scope와 ordered action payload의 canonical hash다.
  `planId`는 domain prefix와 `planHash`에서 파생하며 모든 plan event가 exact `planId + planHash`를
  직접 보존한다. resolver는 event fold와 approval 전에 record를 독립 rehash하고 ID/hash/event
  binding 중 하나라도 다르면 plan을 corrupt로 보고 실행을 fail-closed한다.
- 동일 cycle ID의 동일 scope/hash 재시도는 기존 plan을 반환한다. 같은 cycle ID에 다른
  scope, action 또는 hash를 쓰거나 두 번째 plan을 만드는 요청은 거절한다.
- 하나의 plan에는 한 side만 포함한다. 같은 orchestration trigger에 SELL과 BUY가 모두
  필요하면 `sell` plan을 먼저 적용하고, 새 mark/risk snapshot에서 `buy` plan을 다시
  산출한다. 후속 plan은 새 cycle ID와 `predecessorKind = applied` union으로 선행 SELL plan과
  terminal event의 ID/hash를 직접 연결한다.
- action sequence는 0부터 gap 없이 증가하고 action ID는 plan 안에서 unique해야 한다.
  `sell` plan에는 SELL만, `buy` plan에는 BUY만 허용한다. initial plan은 predecessor를 생략하고,
  후속 BUY는 `applied`, stale replacement는 `stale` predecessor만 허용한다. predecessor union의
  plan/event ID/hash는 exact terminal event로 resolve되어야 하고 그 resulting snapshot 또는
  stale event의 `observedCurrentPortfolioVersion`/snapshot ID/hash가 후속 plan의 preview scope와
  같아야 한다. stale event의 기존 `portfolioVersion`/`portfolioSnapshotHash`는 원 plan scope로
  유지하며 관측된 current snapshot으로 덮어쓰지 않는다.
- fractional BUY는 양수 `targetNotionalKrw`, fractional SELL은 양수 `targetQuantity`,
  whole-share 실행은 양의 정수 `targetQuantity`를 immutable target으로 사용한다.
  fractional SELL quantity는 snapshot의 가용 quantity 이하이고 BUY/SELL side와 target kind가
  일치해야 한다. whole-share target은 sizing 시점의
  reference price/evidence로 `plannedNotionalKrw`와 floor rounding 후 남은
  `residualNotionalKrw`를 기록한다. planned/target notional은 `maximumNotionalKrw` 이하이고
  SELL target은 snapshot의 가용 position도 넘을 수 없다. executor는 target을 재결정하지 않는다.
  Plan의 KRW notional/cap/residual은 safe integer이며 양수 target과 cap, 비음수 residual을 사용한다.
  Quantity target의 표시 notional은 기존 paper execution의 KRW gross convention과 동일하게
  `Math.round(targetQuantity * referencePriceKrw)`로 검증한다. Residual의 원래 sizing budget과
  floor 수량 선택의 정당성은 sizing/source resolver가 별도로 재구성해야 한다.
- `actionExecutionTargetHash`는 plan에 저장된 complete `executionTarget`의 canonical hash이며
  Risk Engine과 execution event가 같은 target을 독립 검증할 때 사용한다.
- 일반 action은 active mandate를 참조한다. `unassigned_legacy_reduce_only`는 mandate ID를
  합성하지 않고 저장된 legacy state의 `observedPositionRef`/`detectedAt`을 직접 참조하며
  SELL만 허용한다. 이 variant도 lifecycle/Risk Engine 검증을 우회할 수 없다.
- legacy reduce-only fill은 bucket을 합성하거나 `BucketEquityEvent`/`BucketTurnoverEvent`를
  만들지 않는다. 대신 exact observed position, root legacy policy, plan/action/fill과 verified
  paper fill record를 참조하는 `PortfolioLegacyExecutionAccountingRecord`를 사용한다.
  record hash는 ID/hash/createdAt을 제외한 complete payload에서 계산하고 ID는 hash에서 파생한다.
  gross proceeds, total cost와 net cash credit을 fill record에서 독립 재계산하고 position 감소,
  shared cash credit, portfolio version/snapshot과 accounting record를 한 transaction으로 반영한다.
  retry는 기존 record를 반환하며 bucket/policy/mandate lineage를 만들어내지 않는다.
- legacy fill 이후에는 resulting portfolio snapshot으로 portfolio-level exposure, cash reserve와
  root risk rule을 즉시 재평가한다. 비용은 같은 legacy accounting record에 포함하므로 bucket
  fee/cash-flow update를 만들지 않고 fill-origin risk-state update로 trigger lineage를 보존한다.
- 첫 event는 predecessor가 없는 `previewed`여야 한다. 이후 event는 직전 event ID를
  `previousPlanEventId`로 참조하며 record와 동일한 plan/cycle/portfolio/version/snapshot/
  policy scope를 직접 저장한다.
- `planEventHash`는 event ID와 자기 hash를 제외한 complete variant payload에서
  계산하고 event ID는 hash에서 파생한다. chain fold 전에 모든 event를 독립 rehash하며
  event type, reason, predecessor, risk/fill 또는 resulting state가 바뀐 record는 fail-closed한다.
- 허용 전이는 `previewed -> approved | rejected | stale`, `approved -> execution_applied |
  rejected | stale`, `execution_applied -> execution_applied | applied | rejected |
  stale`뿐이다. `rejected`, `stale`, `applied`는 terminal이며 unknown predecessor, duplicate
  event ID, branch, terminal 이후 event는 거절한다.
- 각 paper fill 직후 `execution_applied`를 durable하게 기록한다. event는 action/fill별 Risk
  Engine decision과 실행 직전 expected version/snapshot, 실행 직후 resulting version/snapshot을
  일대일로 보존하고 exact paper fill record ID/hash를 참조한다. fill ID는 portfolio 전체에서
  globally unique하고 같은 fill을 다른 plan/action 또는 새 event로 재기록할 수 없다.
- `PaperFillExecutionRecord` hash는 record ID/hash/createdAt을 제외한 complete payload에서
  계산하고 ID는 hash에서 파생한다. execution policy, source price, liquidity evidence와
  participation에서 fill price, quantity, gross/net amount와 모든 cost component를 독립 재계산해
  stored output 및 total과 대조한다. exact retry만 기존 record로 수렴하며 이 검증 전에는
  execution event, cost/flow event 또는 portfolio mutation을 만들지 않는다.
- `sourcePriceEvidence`는 fill의 market/symbol과 정확히 같은 typed price observation을 가리키며
  source contract, evidence ID/hash, `last_price` field와 observed time을 직접 보존한다. resolver는
  evidence payload를 독립 rehash하고 해당 field의 값과 `sourcePriceKrw`, freshness cutoff를
  대조한다. generic `evidenceRefs`의 배열 순서나 liquidity evidence를 source price origin으로
  추정하지 않으며 unresolved/mismatched observation은 fill과 mark-head mutation을 거절한다.
- 성공적으로 저장되는 `PaperFillExecutionRecord.liquidityStatus`는 기존
  `PaperLiquidityStatus` 중 `not_modeled`, `sufficient`, `partial`만 사용한다. `rejected` 또는
  `stale` liquidity result와 reject reason이 있는 결과는 fill record나 execution/accounting
  event를 만들지 않고 plan을 `rejected` 또는 `stale` terminal로 전환한다. 문서 전용 별칭인
  `filled`나 `unavailable`은 저장 contract에서 허용하지 않는다.
- `PortfolioActionRiskDecision`은 기존 범용 decision ID를 그대로 신뢰하지 않고 plan/action,
  policy, market/symbol/side, execution target hash, prior cumulative notional/quantity, 이번
  requested notional/quantity와 expected pre-state를 canonical risk input hash에 묶는다.
  `execution_applied` 전에 exact record가
  resolve되고 `approved`이며 action, amount와 expected state가 모두 일치해야 한다.
  stale/unrelated/rejected decision은 실행할 수 없다.
- bucket action decision은 current turnover window/state ID/hash, 고정 분모, prior cumulative
  notional과 이번 요청의 worst-case absolute turnover contribution을 risk input에 묶는다.
  Risk Engine은 resulting turnover ratio가 `maxTurnoverRatio` 이하인 범위만 승인한다. fill
  직전 state가 달라졌거나 실제 fill 반영 후 누계가 cap을 넘으면 portfolio mutation과
  turnover event를 모두 거절한다. fill 성공 시 같은 transaction에서 turnover event/state를
  갱신한 뒤 다음 action을 평가한다.
- mandate action은 active mandate의 bucket rule set을 사용하고 legacy action은 root policy의
  `PortfolioLegacyReduceOnlyPolicy.riskRuleSetRef`만 사용한다. scope union이 action lineage와
  맞지 않거나 legacy decision이 bucket을 주장하면 거절한다.
  `legacyPolicyHash`는 활성 root policy의 `legacyReduceOnlyPolicy` 전체 payload를
  `hashCanonicalPayload`로 계산한 digest이며 riskRuleSetRef의 lineageHash도 포함한다.
- decision resolver는 위 scope로 선택한 exact risk rule set에서 action side에 적용되는 canonical
  required rule ID 집합을 다시 계산한다. `requiredRuleIds`와 result의 unique rule ID 집합이
  정확히 같고 모든 result가 `pass`일 때만 `decision = approved`를 파생한다. 빈 결과,
  missing/extra/duplicate rule, 하나라도 `fail`인 approved record와 hash mismatch는 corrupt로
  보고 fail-closed한다.
- `riskDecisionHash`는 decision ID와 digest 자체를 제외한 input/output 전체를 canonicalize해
  계산하고 decision ID는 이 digest에서 파생한다. 실행 직전 resolver는 immutable
  plan/action/snapshot/rule-set/evidence ref에서 input을 복원해 모든 rule, worst-case notional,
  approved maximum과 derived decision을 deterministic하게 다시 계산한다. 재계산 결과나 full
  decision digest가 stored record와 다르면 실행을 fail-closed한다.
- action별 fill sequence는 0부터 gap 없이 증가하고 `filledNotionalKrw > 0`,
  `filledQuantity > 0`, notional/quantity cumulative가 각각 이전 값과 이번 fill의 합인지
  검증한다. fractional BUY의 requested/filled/cumulative notional은 남은 target 이하이고
  fractional SELL과 whole-share의 requested/filled/cumulative quantity는 남은 target 이하이어야
  한다. Risk Engine은 current
  price와 complete cost bound로 `worstCaseFillNotionalKrw`와 BUY의
  `worstCaseNetCashDebitKrw`를 계산한다. action remaining/exposure/liquidity cap은 gross filled
  notional에, current spendable cash와 policy cash reserve cap은 비용을 포함한 net debit에
  적용한다. 두 값이 각각 `approvedMaximumFillNotionalKrw`와
  `approvedMaximumNetCashDebitKrw` 이하여야만 decision을 승인한다.
- deterministic paper fill을 계산한 뒤 portfolio를 변경하기 전에 actual `filledNotionalKrw`가
  해당 gross approved maximum 이하이고 BUY `netAmountKrw`가 net-debit approval, current
  spendable cash와 cash reserve를 넘지 않는지 검증한다. 새 cumulative filled notional도
  action의 `maximumNotionalKrw` 및 current exposure/liquidity cap을 넘을 수 없다. 하나라도
  초과하면 `execution_applied`, cost/flow/turnover event 또는 portfolio mutation 없이 거절한다.
- SELL은 verified paper fill의 actual `netAmountKrw`가 risk decision의 independently recomputed
  `expectedMinimumNetCashCreditKrw` 이상인지 mutation 전에 검증한다. 실제 net credit가 floor보다
  작으면 execution event, bucket/legacy accounting, turnover 또는 portfolio mutation을 모두
  만들지 않고 rejected/stale policy에 따라 종료한다.
- event는 action sequence/fill sequence 순서로만
  append하며 다음 action은 이전 action이 target을 채운 뒤에만 시작한다. retry는 기존 fill
  ID/event를 반환하며 새 ID로 같은 체결을 중복 계상할 수 없다.
- 하나의 accepted fill은 pre-fill source-price valuation과 valuation head update, verified
  `PaperFillExecutionRecord`, portfolio quantity/cash mutation, position mutation-head event,
  reservation/turnover/cost/capital-flow/risk-state event, resulting portfolio snapshot과
  `execution_applied` event를 하나의 durable transaction으로 commit한다. 적용 순서는 canonical
  sequence로 고정하되 외부 observer에는 전부 보이거나 전부 보이지 않아야 한다. 중간 실패는
  모두 rollback하며 restart가 새 quantity와 이전 mark head 또는 회계 없는 portfolio를 볼 수 없다.
- 첫 fill 전에는 plan record의 preview version/snapshot을 current state와 비교한다. 이후
  fill의 expected pre-state는 직전 `execution_applied`의 resulting state와 같아야 한다.
  이 선형 chain에 기록된 in-plan mutation은 stale이 아니며, 그 외 version/snapshot drift는
  plan을 terminal `stale`로 만든다.
- `applied`는 fractional BUY의 cumulative filled notional이 `targetNotionalKrw`, fractional
  SELL과 whole-share action의 cumulative filled quantity가 `targetQuantity`와 정확히 같고
  체결 결과가 event chain에 기록된 뒤에만 만들고
  ordered `executionEventIds`와 최종 portfolio version/snapshot을 보존한다. 한 plan에 정확히
  한 번만 존재할 수 있다.
- current plan state는 event chain fold로 재구성한다. 재시작 후 snapshot/cache와 replay
  결과가 다르거나 chain이 불완전하면 신규 적용을 fail-closed한다.

<!-- /spom-source -->

<a id="spom-source-2723-3032"></a>
<!-- spom-source:2723-3032 sha256:d6caf2b03a5ee3f68a2ba6c56caba0214cea1d9e1d0176e5eff8210e1ac0a09c -->

## 8. Portfolio gap과 리밸런싱

### 8.1 Gap 계산

각 bucket에 대해 다음 값을 산출한다.

```text
currentWeight = bucketExposureKrw / virtualNetWorthKrw
targetGapKrw = max(0, targetWeightKrw - currentExposureKrw)
overweightKrw = max(0, currentExposureKrw - maxWeightKrw)
underweightKrw = max(0, minWeightKrw - currentExposureKrw)
entryWeightKrw = selectionTrigger.entryWeightRatio * virtualNetWorthKrw
entryGapKrw = max(0, entryWeightKrw - currentExposureKrw)
```

- `selectionTrigger.mode = below_min`이면 `underweightKrw > 0`일 때만 request를 만든다.
- `targetGapKrw`는 compliance와 목표 대비 drift 표시용이며 그 자체로 매수 요청이나
  exact-target 추격을 발생시키지 않는다.
- `selectionTrigger.mode = entry_floor_on_due_cycle`이면 bucket cadence 또는 event trigger가
  도래했고 `entryGapKrw > 0`일 때만 request를 만든다. 이 모드는 min이 0인 선택적
  bucket을 empty portfolio에서 bootstrap하되 entry floor까지만 채우는 명시적 band
  예외다. entry floor에 도달한 뒤에는 target을 추격하지 않는다.
- target보다 낮지만 min 이상인 `below_min` bucket은 비용과 turnover를 고려해 유지한다.
- `entry_floor_on_due_cycle`도 required evidence, buy capacity, cash reserve, cost와 turnover
  gate를 통과하지 못하면 request 또는 trade를 만들지 않는다.
- max를 넘으면 신규 매수를 차단하고 sell/rebalance candidate를 만든다.
- cash reserve 미달이면 모든 신규 매수를 차단한다.

### 8.2 결정 우선순위

하나의 orchestration cycle에서 다음 우선순위를 고정한다.

1. lifecycle invalidation과 명시적인 fail-closed safety action
2. stop-loss와 risk limit 위반 축소
3. stale/missing critical evidence의 신규 매수 차단과 보유 position review
4. maximum holding review와 thesis invalidation
5. bucket/symbol overweight rebalance
6. take-profit와 trailing stop
7. cash/hedge reserve 복구
8. policy selection trigger를 충족한 bucket 신규 매수

SELL과 BUY가 같은 orchestration trigger에서 필요하면 side별 plan을 분리한다. SELL plan을
먼저 paper fill하고 mark-to-market 및 risk snapshot을 다시 만든 뒤 새 snapshot/version에
묶인 BUY plan을 생성·평가한다. 두 plan은 같은 trigger claim 아래에서 predecessor terminal
event와 phase로 서로 다른 cycle ID를 파생한다. 같은 종목에 상충하는 BUY/SELL을 동시에
발행하지 않는다.

### 8.3 Idempotency와 동시성

```ts
interface PortfolioPolicyTriggerEventBase {
  policyTriggerEventId: string;
  portfolioId: string;
  policyHash: string;
  eventHash: string;
  evidenceRefs: string[];
  asOf: string;
  createdAt: string;
}

type PortfolioPolicyTriggerEvent = PortfolioPolicyTriggerEventBase &
  (
    | {
        eventType: "regime_change";
        market: Market;
        previousRegime: string;
        currentRegime: string;
      }
    | {
        eventType: "thesis_evidence_change";
        mandateId: string;
        market: Market;
        symbol: string;
        previousThesisStatus: "intact" | "watch" | "invalidated" | "unknown";
        currentThesisStatus: "intact" | "watch" | "invalidated" | "unknown";
      }
  );

interface PortfolioRiskStateUpdateRecordBase {
  riskStateUpdateRecordId: string;
  portfolioId: string;
  policyHash: string;
  stateUpdateHash: string;
  asOf: string;
  createdAt: string;
}

type PortfolioRiskStateUpdateRecord = PortfolioRiskStateUpdateRecordBase &
  (
    | {
        stateUpdateKind: "market_mark";
        portfolioSnapshotId: string;
        portfolioSnapshotHash: string;
      }
    | {
        stateUpdateKind: "fill";
        rebalancePlanId: string;
        rebalanceActionId: string;
        planExecutionEventId: string;
        fillId: string;
        paperFillRecordId: string;
        paperFillHash: string;
        accountingScope:
          | {
              scopeKind: "bucket";
              fillAccountingGroupId: string;
            }
          | {
              scopeKind: "legacy_portfolio";
              legacyAccountingRecordId: string;
              legacyAccountingHash: string;
            };
      }
    | {
        stateUpdateKind: "fee" | "cash_flow";
        bucketEquityEventId: string;
        rebalancePlanId: string;
        rebalanceActionId: string;
        fillId: string;
      }
    | {
        stateUpdateKind: "risk_state";
        riskStateEpochId: string;
        bucket: StrategyBucket;
        lastBucketEquityEventId: string;
        riskStateHash: string;
      }
  );

type PortfolioCycleTrigger =
  | {
      triggerKind: "scheduled";
      scheduleBoundaryHash: string;
      scheduleSlotId: string;
      slotEndsAt: string;
    }
  | {
      triggerKind: "every_tick";
      packetHash: string;
      packetAsOf: string;
    }
  | {
      triggerKind: "policy_event";
      eventType: "regime_change" | "thesis_evidence_change";
      policyTriggerEventId: string;
      eventHash: string;
      eventAsOf: string;
    }
  | {
      triggerKind: "risk_breach";
      stateUpdateKind: "market_mark" | "fill" | "fee" | "cash_flow" | "risk_state";
      riskStateUpdateRecordId: string;
      stateUpdateHash: string;
      stateUpdateAsOf: string;
    };

interface PortfolioTriggerClaimRecord {
  triggerClaimId: string;
  triggerClaimHash: string;
  portfolioId: string;
  policyHash: string;
  triggerIdentity: string;
  triggerRef: string;
  evidenceCutoffAt: string;
  triggerPayloadHash: string;
  evaluationPortfolioVersion: string;
  evaluationPortfolioSnapshotId: string;
  evaluationPortfolioSnapshotHash: string;
  createdAt: string;
}

type PortfolioTriggerClaimEvent =
  | {
      triggerClaimEventId: string;
      triggerClaimEventHash: string;
      triggerClaimId: string;
      triggerClaimHash: string;
      previousTriggerClaimEventId?: never;
      eventType: "evaluation_started";
      initialCycleId: string;
      asOf: string;
      createdAt: string;
    }
  | {
      triggerClaimEventId: string;
      triggerClaimEventHash: string;
      triggerClaimId: string;
      triggerClaimHash: string;
      previousTriggerClaimEventId: string;
      eventType: "completed_with_plan";
      initialCycleId: string;
      planId: string;
      planHash: string;
      asOf: string;
      createdAt: string;
    }
  | {
      triggerClaimEventId: string;
      triggerClaimEventHash: string;
      triggerClaimId: string;
      triggerClaimHash: string;
      previousTriggerClaimEventId: string;
      eventType: "completed_no_action";
      initialCycleId: string;
      reasonCodes: string[];
      resultingPortfolioVersion: string;
      resultingPortfolioSnapshotHash: string;
      asOf: string;
      createdAt: string;
    };
```

- trigger claim ID는 mutable portfolio state와 독립적으로 `portfolioId + policyHash +
  evidenceCutoffAt + triggerIdentity + triggerRef`에서 파생한다. claim은 durable unique key로
  먼저 append한다. 최초 claim은 그 순간의 immutable evaluation portfolio version/snapshot
  ID/hash를 함께 고정하며 `triggerClaimHash`는 ID/hash/createdAt을 제외한 complete payload에서
  계산한다. exact payload 재시도는 기존 claim과 terminal result를 반환하고 같은 ID의 다른
  payload/hash는 거절한다.
- claim 생성과 첫 `evaluation_started` event append는 한 transaction으로 commit한다. claim event는
  ID/hash/createdAt을 제외한 complete payload로 hash와 hash-derived ID를 만들고 exact claim
  ID/hash 및 선형 predecessor를 보존한다. terminal은 `completed_with_plan` 또는
  `completed_no_action` 하나뿐이며 branch, duplicate terminal과 terminal 이후 event를 거절한다.
- crash 후 terminal event가 없으면 current portfolio로 다시 평가하지 않고 claim에 고정된
  evaluation snapshot과 deterministic initial cycle ID로 평가를 resume한다. plan record와
  plan의 최초 `previewed` event 및 `completed_with_plan` event는 같은 transaction에서 저장한다.
  세 record 중 하나라도 저장되지 않으면 모두 rollback해 claim을 nonterminal로 유지한다. action이
  없을 때도 reason과 resulting snapshot을 가진 `completed_no_action` event를 durable하게 남긴다.
  따라서 claim만 소비되거나 event chain 없는 plan이 남아 risk breach/no-op 결과가 유실될 수 없다.
- initial cycle ID는 `triggerClaimId + initial`에서 파생한다. portfolio version/snapshot은
  immutable plan의 preview scope와 stale 검증에는 포함하지만 trigger claim 또는 initial cycle
  identity에는 포함하지 않는다. 따라서 성공 후 acknowledgement가 유실되어 같은 packet/event가
  다시 들어와도 변경된 snapshot으로 두 번째 initial cycle을 만들 수 없다.
- `PortfolioCycleTrigger`에서 identity/ref/cutoff를 한 가지 방식으로만 만든다. scheduled는
  `triggerIdentity = scheduled:<scheduleBoundaryHash>`, ref는 canonical slot ID, cutoff는 slot
  end다. `every_tick` identity는 `every_tick`, ref는 packet hash, cutoff는 packet `asOf`다.
  policy event identity는 `event:<eventType>`, ref/cutoff는 immutable event hash/`asOf`다. risk
  breach identity는 `risk_breach:<stateUpdateKind>`, ref/cutoff는 원인이 된 immutable state
  update hash/`asOf`다. union에 없는 trigger나 field 조합은 거절한다.
- `PortfolioPolicyTriggerEvent`는 event ID/createdAt/hash를 제외한 canonical payload에서
  `eventHash`를 만들고 event ID를 hash에서 결정론적으로 파생해 append-only 저장한다. 같은
  hash 재시도는 기존 record를 반환하고 같은 ID의 payload/hash 충돌을 거절한다. trigger는
  exact ID/hash/type/as-of/portfolio/policy를 resolve하며 evidence, mandate 또는 market scope가
  누락·불일치하면 cycle을 만들지 않는다.
- previous/current 값은 달라야 하고 evidence ref는 비어 있을 수 없다. thesis event의 mandate는
  같은 portfolio/policy/market/symbol의 active mandate로 resolve되어야 한다.
- `PortfolioRiskStateUpdateRecord`는 update kind별 exact immutable origin을 참조한다. market
  mark는 portfolio snapshot, fill은 plan/action/execution event/fill, fee와 cash flow는 bucket
  equity event 및 plan/action/fill, risk state는 epoch/last event/state hash를 resolve한다.
- fill update는 exact paper fill record와 accounting scope도 resolve한다. bucket scope는 fill
  accounting group, legacy scope는 portfolio-level legacy accounting record를 요구하며 두 variant를
  섞거나 legacy fill에 bucket equity origin을 합성하면 거절한다.
- state update hash는 record ID, `stateUpdateHash`와 `createdAt`을 제외한 canonical payload에서
  계산하고 ID는 kind와 hash에서 결정론적으로 파생한다. exact retry는 기존 record를 반환하며 missing origin,
  as-of/scope/hash mismatch, 같은 ID의 payload collision을 거절한다. risk-breach trigger는 exact
  update record ID/hash/kind/as-of를 검증한 뒤에만 cycle을 만든다.
- `evidenceCutoffAt`은 처리 시작 시각이 아니라 trigger에서 canonical하게 파생한다.
  scheduled cycle은 schedule slot end, `every_tick`은 packet `asOf`, event trigger는 event
  `asOf`, risk breach는 state update `asOf`를 사용하며 같은 `triggerRef`가 다른 cutoff를
  제시하면 거절한다.
- 같은 cycle ID의 rebalance plan은 한 번만 적용한다.
- SELL 완료 후 BUY 후속 cycle은 `triggerClaimId + post_sell_buy +
  predecessor.predecessorPlanEventId`, stale replacement는 `triggerClaimId + replacement +
  predecessor.predecessorPlanEventId`에서 파생하되 predecessor kind를 cycle identity에 함께
  포함한다. 둘 다 선행 terminal event와 새 preview snapshot을 exact resolve하며 같은
  predecessor의 중복 cycle을 거절한다. mutable snapshot만 바뀌었다는 이유로 replacement를
  만들 수 없다.
- 후속 BUY plan record는 `predecessorKind = applied`, stale replacement plan record는
  `predecessorKind = stale`을 사용하고 각각 선행 plan/event ID/hash를 보존한다. union kind와
  실제 terminal event type이 다르거나 predecessor plan hash가 재계산 결과와 다르면 거절한다.
  stale replacement는 predecessor stale event에 저장된 observed current version/snapshot을 exact
  resolve하고 새 plan preview scope에 그대로 묶는다.
- plan의 preview, approval, fill execution, rejection, stale, applied 상태는 immutable plan
  record와 선형 append-only event chain으로 저장하며 재시작 후 replay로 current state를
  복원한다.
- 첫 실행 전 portfolio version/snapshot 또는 policy hash가 preview와 다르면 plan을 terminal
  `stale`로 기록하고 적용하지 않는다. 실행 시작 후에는 직전 `execution_applied`가 선언한
  resulting state만 다음 action의 expected state로 허용한다. 다른 drift는 `stale`이며, 새
  snapshot/version drift만으로 새 cycle ID를 만들지 않는다. terminal `stale` event를 먼저
  기록한 뒤 그 event를 predecessor로 삼아야 replacement preview를 생성할 수 있고, SELL 후속
  BUY도 선행 `applied` event를 predecessor로 삼는다.
- multi-process 실행 전 portfolio-scoped lock 또는 compare-and-swap version을 둔다.
- decision/trade/portfolio/strategy-state 저장 실패가 부분 상태를 만들지 않도록 durable
  transaction boundary 또는 재구성 가능한 append-only event contract가 필요하다.

## 9. Multi-bucket orchestration

각 bucket은 같은 portfolio를 사용하되 정상 review/selection은 자신의 cadence가 도래했을
때만 평가한다. risk breach 검사는 아래 cadence와 별도로 모든 relevant state update마다
강제한다.

| Bucket | 초기 paper cadence | 실행 조건 |
| --- | --- | --- |
| `long_term` | weekly | 정기 review, thesis/evidence 변경, risk breach |
| `swing` | daily | market close snapshot과 중기 signal 갱신 |
| `short_term` | daily | 신선한 단기 signal과 exit evidence 존재 |
| `intraday` | `hourly` 또는 `every_tick` | intraday source와 liquidity evidence가 모두 준비된 경우 |
| `hedge` | daily 또는 regime change | 하방 노출과 hedge effectiveness 재계산 |

표의 cadence는 운영 의도를 나타내는 초기값이다. 실제 due 시각과 schedule slot은 policy가
참조한 market별 `ScheduleBoundaryRecord`에서만 계산하며 서버 timezone이나 단순 UTC 날짜
경계에 의존하지 않는다.
daily data만 있는 실행에서 `intraday`를 활성화하지 않는다. cadence별 source requirement가
충족되지 않으면 해당 bucket만 `degraded` 또는 `blocked`로 두고 다른 bucket의 read-only
평가를 계속할 수 있다.
`every_tick`은 busy loop가 아니라 새로 검증된 market packet event마다 한 번 실행한다.
동일 packet hash의 중복 event는 같은 trigger claim과 initial cycle ID로 수렴해 한 번만
처리한다. portfolio가 이미 변경된 뒤의 retry도 기존 결과를 반환한다. 정기 cadence
외 `regime_change`와 thesis evidence 변경은 `eventTriggers`로 선언한다. risk breach는
선택형 trigger가 아니며 모든 enabled bucket에 항상 적용한다.

<!-- /spom-source -->

## 기존 PR 4의 세부 계약 · 원문 4230–4404행

<a id="spom-source-4230-4404"></a>
<!-- spom-source:4230-4404 sha256:acc0e9fdad9f190063ef1f0a4aa92a37a8cf610ffb5db53746c7a6e135abb2ca -->

서른한 번째 분할은 accepted paper fill을 complete immutable `PaperFillExecutionRecord`로 보존하는 strict
contract를 구현한다. Record는 plan/action/fill, market/symbol/side, source-price evidence projection,
execution policy와 liquidity input, requested/filled quantity·notional, gross/net amount 및 cost breakdown을
complete payload에 포함한다. Stored output은 기존 deterministic paper execution model로 다시 계산하고
accepted `filled`/`partial`과 non-rejected liquidity result만 허용한다. Evidence ref canonical order와 source
scope/chronology를 검증하고 record hash는 ID/hash/createdAt을 제외한 payload, ID는 hash에서 파생한다.
Append-only repository, typed source-price evidence exact resolver, plan execution event/accounting origin과 fill
risk-state update 연결은 후속 분할 전까지 구현 완료로 간주하지 않는다.

서른두 번째 분할은 `PaperFillExecutionRecord`를 strict append-only JSONL repository에 보존한다. Repository는
append 전 입력과 complete history의 각 line을 strict record parser로 독립 검증하고, torn/blank/corrupt
line, duplicate record ID/hash, duplicate `(portfolioId, fillId)`를 fail-closed한다. 동일 payload의
`createdAt`만 다른 재시도는 최초 durable record로
수렴시키며 thread/process 간 exclusive lock, file/directory sync, lock ownership token으로 append durability와
직렬화를 보장한다. Verified complete history는 module-private provenance를 통과한 opaque wrapper로만 제공한다.
Typed source-price evidence exact resolver, plan execution event/accounting origin과 fill risk-state update 연결은
후속 분할 전까지 구현 완료로 간주하지 않는다.

서른세 번째 분할은 `PaperFillExecutionRecord.sourcePriceEvidence` projection을 immutable
`SourcePriceEvidenceRecord`에 exact-resolve한다. Resolver는 supplied evidence를 strict parser로 독립 rehash하고
evidence ref/hash, source contract, market/symbol, `last_price`, observation instant를 projection과 대조하며
`priceKrw`를 fill의 `sourcePriceKrw`와 exact-match한다. Availability 판단에는 caller-provided evidence
`createdAt`을 사용하지 않고, strict append-only `SourcePriceEvidenceFileRepository`가 append 시 생성한
`appendedAt`을 사용한다. 초기 durable envelope은 complete evidence record, 쓰기 전 `appendedAt`, predecessor
entry hash를 포함한다. 아래 서른여덟 번째 분할은 이를 post-fsync commit origin으로 강화한다.
Resolver는 repository가 발급한 opaque verified complete history에서만 origin을 얻으며 현재는
`appendedAt`이 fill `asOf` 이상이면 fail-closed한다. 기존 raw-record
line은 신뢰 가능한 append timestamp가 없으므로 자동 호환하지 않고 typed source evidence artifact를 새 envelope
format으로 재생성해야 한다. Plan execution event/accounting origin과 fill risk-state update 연결은 후속 분할
전까지 구현 완료로 간주하지 않는다.

서른네 번째 분할은 한 accepted fill의 portfolio mutation을 immutable
`RebalancePlanExecutionAppliedEvent` variant로 보존하는 strict contract를 구현한다. Event는 plan/action/fill
sequence, exact paper fill ID/hash, requested/current/cumulative fill amount, Risk decision ID와 pre/resulting
portfolio version/snapshot을 complete payload에 포함한다. Cumulative amount는 current fill 이상이어야 하고
resulting portfolio state는 pre-state를 반드시 전진시킨다. Filled quantity는 requested quantity를 초과할 수
없지만 slippage가 반영된 filled notional은 requested notional을 초과할 수 있고,
후속 Risk decision resolver가 `approvedMaximumFillNotionalKrw`와 exact 검증한다. Event hash는 ID/hash를
제외한 complete payload, ID는 hash에서 파생한다. Full `RebalancePlanEvent` union repository/fold, exact
plan/action/risk/fill resolver와 accounting/risk-state mutation 연결은 후속 분할 전까지 구현 완료로 간주하지
않는다.

서른다섯 번째 분할은 plan action 실행 직전 Risk Engine 결과를 immutable
`PortfolioActionRiskDecision`으로 보존하는 strict contract를 구현한다. Decision은 exact rule-set, plan/action,
portfolio snapshot, action target, bucket 또는 legacy scope, turnover/cash assessment, prior cumulative와
requested/worst-case/approved maximum, canonical rule results와 evidence refs를 complete payload에 포함한다.
Required rule ID 집합과 result ID 집합을 exact-match하고 모든 result에서 approved/rejected를 파생하며 bucket
turnover contribution을 `worstCaseFillNotionalKrw`와 exact-match한 뒤 저장된 분모·prior로 ratio를 재계산한다.
Approved decision은 worst-case gross fill과 BUY net debit가 각각 저장된 approved maximum 이하일 때만 허용한다.
Rejected decision은 가용 capacity가 없는 원인을 보존하도록 approved maximum 0을 허용하되 음수는 거절한다.
BUY worst-case net debit는 비용이 음수가 아니므로 worst-case gross fill 이상이어야 한다.
SELL minimum net credit는 worst-case gross fill 이하여야 하며, approved record는 이 gross 값이
approved maximum 이하이므로 승인 상한보다 큰 수령 하한을 기록할 수 없다.
`riskInputHash`는 caller에게 받지 않고 canonical rule-set/plan/action/snapshot/scope/turnover basis/prior/request와
evidence ref projection에서 계산하며 parse 시 독립 재계산한다.
모든 identifier는 lone surrogate를 거절하여 UTF-8 정렬 동률로 인한 canonical identity 분기를 차단한다.
Decision hash는 ID/hash를 제외한 complete
payload, ID는 hash에서 파생한다. Rule-set/plan/action/snapshot/evidence deterministic resolver와
`execution_applied` actual fill cap 검증은 후속 분할 전까지 구현 완료로 간주하지 않는다.

서른여섯 번째 분할은 `PortfolioActionRiskDecisionFileRepository`의 append-only JSONL 저장소를
구현한다. Complete decision을 독립 parse/rehash하고 정확한 retry만 기존 record와 저장시각으로 수렴한다.
Repository가 생성한 `appendedAt`, complete record와 predecessor hash를 entry hash에 결합하며
decision time 이전 append, torn/corrupt line, duplicate identity와 chain mismatch를 fail-closed한다.
Read와 append는 동일한 exclusive lock을 사용하고 record/lock 및 가능한 directory fsync를 수행한다.
Verified history는 실제 repository read에서만 발급하며 raw parser 결과나 prototype 복제로 대체할 수 없다.
이 검증은 저장 이력의 무결성 범위이며 Risk rule-set/plan/action/evidence의 의미적 인증과 독립 재평가,
fill binding 및 multi-artifact transaction은 아직 후속 범위이다. 기존 파일의 migration이나 live 경로 변경은 없다.

서른일곱 번째 분할은 `validateRebalancePlanExecutionFillRiskBinding`으로 execution event와
저장된 decision/fill을 대조한다. Exact record ID/hash, portfolio/plan/action/policy와 market/symbol/side,
requested/filled 금액·수량, expected pre-state 및 prior+fill cumulative를 검증한다.
Paper-fill raw parser의 기존 구조 검증 API는 유지하되, 이 binding에서는 repository read에서만
발급되는 추가 내부 brand를 요구하여 임의 JSONL에서 만든 history를 실제 저장 근거로 인정하지 않는다.
Source-price origin과 availability도 다시 검증하며 decision 저장시각 < fill cutoff <= event cutoff를
요구한다. Fill source-price evidence ID는 decision의 `riskEvidenceRefs`에도 포함돼야 하며
fill record 생성시각이 event cutoff보다 늦으면 거절한다.
신규 paper fill은 `paper_fill_execution_entry.v1` envelope에 `appendStartedAt`과 predecessor hash를
저장하고 record fsync가 완료된 뒤 `paper_fill_execution_commit.v1` marker의 `committedAt`을
채집·저장한다. Origin의 `appendedAt`은 이 post-fsync 시각이며 binding은 event cutoff보다 엄격히
이전인지 검증한다. 같은 밀리초는 실제 선후관계를 증명하지 못하므로 거절하며, caller는 append
완료 후 origin보다 늦은 cutoff에서 event를 생성해야 한다. Marker는 해당 entry hash를 포함하고
후속 entry는 marker hash를 predecessor로 참조한다.
Marker 누락·변조·torn pair는 읽기와 append를 모두 거절하며 자동 복구·timestamp 합성을 하지 않는다.
기존 bare record의
조회와 exact retry는 유지하지만 append 시각은 합성하지 않으며 execution binding은 이를
`review_required` legacy로 거절한다. Versioned entry 뒤의 bare entry는 downgrade로 거절한다.
새 reader는 legacy prefix와 versioned entry를 함께 읽지만 이전 reader는 versioned entry를 읽지
못하므로 롤백 시 신규 실행을 중지하고 새 reader를 유지하거나 별도 검증된 호환 절차가 필요하다.
가격 근거의 post-fsync origin도 decision의 `decidedAt`보다 엄격히 이전이어야 한다.
Risk decision 저장소의 기존 fsync 전 `appendedAt` 한계는 아래 서른아홉 번째 분할에서
post-fsync origin과 중간 실패 검증으로 보강한다. 이 binding만으로 최종 실행을 승인하면 안 된다.
Actual gross approved cap, BUY net debit cap 및 SELL net credit floor를 넘으면 거절한다.
이 순수 validator는 mutation이나 최종 실행 승인을 하지 않는다. Plan/action 원본, rule-set/evidence
독립 재평가, action sequence/target, current state/capacity 및 multi-artifact transaction 검증은 후속 범위이다.

서른여덟 번째 분할은 가격 근거의 실제 record durability를 `source_price_evidence_entry.v2`와
`source_price_evidence_commit.v1` marker 쌍으로 보존한다. Entry는 complete record, `appendStartedAt`,
predecessor hash를 포함하고 file/directory sync를 마친 뒤 채집한 `committedAt`을 별도 marker에 저장한다.
Marker는 entry hash에 결합하며 다음 entry는 marker hash를 predecessor로 참조한다. Origin API의
`appendedAt`은 marker의 post-record-fsync `committedAt`으로 해소한다. Marker 자체의 저장 완료시각을
의미하지 않는다. Marker 누락·torn pair·변조·orphan·chain 절단은 read/append 모두 fail-closed하며
자동 marker 보충이나 기록 삭제를 하지 않는다.

기존 unversioned envelope prefix는 조회와 exact retry bytes를 유지하지만 post-fsync 시각을 합성하지
않는다. Legacy source origin은 `review_required` 오류로 거절하고 versioned pair 뒤의 legacy append도
거절한다. 기존 raw record parser의 조회 계약과 bucket valuation read 경로는 유지한다. 실제 fsync를
지연시키는 회귀 테스트와 mixed legacy/new prefix, source→fill 및 source→decision 동일 밀리초 거절을
검증한다. 같은 밀리초는 선후관계가 불명확하므로 downstream cutoff는 origin보다 늦어야 한다.
이전 reader는 새 pair를 읽지 못하므로 새 기록이 생긴 후에는 reader를 유지하거나 검증된 별도 호환
절차가 필요하다. Runtime 자동 migration이나 외부 호출은 없으며 최종 plan/action/transaction
연결은 여전히 후속이다.

서른아홉 번째 분할은 Risk 결정 저장소에도 `portfolio_action_risk_decision_entry.v2`와
`portfolio_action_risk_decision_commit.v1` 쌍을 적용한다. 결정 record와 append 시작시각,
predecessor를 hash로 결합하고 record/file directory sync 완료 후 채집한 `committedAt`을 별도
marker에 기록한다. 후속 entry의 predecessor는 직전 marker의 hash이다. 기존 origin API의
`appendedAt`은 post-record-fsync 시각이며 marker 자체의 저장 완료시각을 뜻하지 않는다.
Execution binding은 이 Risk origin보다 fill cutoff가 엄격히 늦어야 한다고 검증한다.
새 append 시작시각이 직전 committed pair의 완료시각보다 이르면 쓰기 전에 거절하며, reader도
동일한 cross-entry 순서를 검사한다. Pair 내부에서만 시계 역행을 검사하는 것으로는 충분하지 않다.

저장소 간 시계 역행은 timestamp 비교만으로 증명할 수 없으므로, 체결의
`createAndAppendWithRiskOrigin`은 Risk repository-issued history에서 approved origin을 먼저
해소한 후 내부 factory로 체결을 생성한다. 이미 생성된 record/ID/hash 및 caller가 제공한
asOf/createdAt은 거절하고 내부에서 시각을 채집한다. 신규 생성시각은 Risk origin보다 늦어야 한다.
`paper_fill_execution_entry.v2`에 Risk decision ID/hash와 commit hash/시각을 결합하여
체결 생성 전에 해당 Risk 원본이 이미 존재했음을 기록한다. 기존 unbound 체결에
나중에 receipt를 붙이거나 다른 Risk 원본으로 교체하는 retry는 bytes 변경 없이 거절한다.
Execution binding은 receipt와 현재 verified Risk origin이 정확히 일치해야 하며, 기존 bare/v1
체결의 조회·일반 retry는 유지하되 최종 binding에는 사용할 수 없다. Raw parser는 receipt 발급
권한을 얻지 않는다. 재시작·동시 retry·receipt 변조·Risk 교체 및 체결 저장 후 시계를 되돌려
Risk를 append하는 경우를 검증한다. 새 v2 체결도 이전 reader와 호환되지 않는다.
같은 portfolio/fill ID의 생성 입력과 Risk receipt가 모두 같은 retry는 최초 record·시각·bytes로
수렴한다. 이 API는 생성 순서와 provenance를 검증하지만 Risk rule-set 재평가나 최종 실행 승인이 아니다.

Legacy envelope prefix의 조회·exact retry bytes는 유지하지만 승인 origin을 합성하거나 승격하지
않는다. Legacy origin은 `review_required`로 거절한다. 새로운 pair 뒤 legacy, missing/torn/orphaned
marker, record/marker hash·시간·predecessor 변조, prefix 절단은 read/append에서 fail-closed이다.
실제 record fsync 지연 및 fsync 오류를 주입해 완료시각 채집과 incomplete pair 재시도 차단을
검증한다. 자동 복구·삭제·backfill은 없으며 이전 reader는 새 pair와 호환되지 않는다. 새 기록 이후
rollback은 새 reader 유지 또는 검증된 별도 호환 절차가 필요하다.
이 변경은 Risk rule-set/evidence의 의미적 인증·독립 재평가, plan/action/state 연결이나 multi-artifact
atomic execution을 구현하지 않는다. 해당 최종 승인·실행 연결은 후속이며 live 경로는 변경하지 않는다.

마흔 번째 분할은 `resolvePortfolioActionRiskDecisionPolicy`로 저장된 Risk 결정의 정책·규칙
참조를 해소한다. 설정된 단일 `baseDir`에서 Risk repository-issued history와 기존 consistent
policy/activation/dependency generation을 직접 읽으며 외부 배열·snapshot·loader 입력은 허용하지
않는다. 결정시각의 activation history를 fold한 뒤 exact policy hash를 대조한다. Bucket scope는 해당 bucket의 enabled market과
risk rule set을, legacy SELL scope는 root legacy policy 전체 hash와 전용 rule-set ref를 검증한다.
기존 immutable dependency resolver로 rule-set/parameter identity·version·hash·lineage 및 생성
순서를 검증하고 action side에 해당하는 rule ID 집합을 다시 계산한다. 자체적으로 일관된
decision이라도 policy-selected rule set 또는 required/result ID 집합이 다르면 fail-closed한다.

이 resolver는 rejected decision도 설명 목적으로 반환하지만 이를 approved로 승격하지 않는다.
결정 이후 retirement는 과거 결정시각 해소에 영향을 주지 않으므로 현재 실행 권한을 증명하지는
않는다. 현재 active policy, mandate/action/plan/snapshot 원본과 수치 입력 복원, 각 규칙의 독립
재평가·cap 계산, turnover/portfolio mutation 연결은 후속이다. 기존 fill binding과 최종 executor에는
아직 연결하지 않았으며 이 resolver만으로 실행을 승인하면 안 된다.
이 조회는 저장 경로와 파일 접근 제어를 신뢰하며 파일을 직접 재작성할 수 있는 공격자에 대한
외부 인증이나 읽기 이후의 동시 변경까지 고정하는 실행 transaction을 제공하지 않는다.

정책을 나중에 backfill하여 기존 결정을 소급 정당화하지 못하도록
`PortfolioActionRiskDecisionFileRepository.createAndAppendWithPolicyOrigin`이 같은 경로의
전체 정책 generation을 읽고 activation 파일을 cooperative lock 아래 fsync한 뒤에만
Risk 레코드를 생성한다. `decidedAt`·완성 레코드 입력은 받지 않으며 activation ID/hash,
runtime policy ID/hash/lineage와 관측 시각을 `portfolio_action_risk_decision_entry.v3`의
`policyOrigin` receipt에 묶고 기존 commit marker와 함께 저장한다. resolver는 이 receipt와
결정시각의 활성 정책이 일치하는지도 확인한다. 기존 bare/v2 query·exact retry는 유지하지만
receipt 없는 결정은 새 policy resolver에서 legacy review 대상으로 거절하며 자동 승격하지 않는다.
동일 생성 입력과 동일 activation identity의 factory retry는 원래 record·receipt·시각을 반환하고,
기존 무근거 record에 receipt를 추가하거나 다른 activation으로 교체하지 않는다.
이 factory도 caller의 규칙 결과를 독립 재계산하지 않으므로 최종 Risk 승인 API가 아니다.
v3 저장 뒤 구 reader는 fail-closed하므로 rollback 시 새 reader를 유지해야 하며 자동 downgrade는 없다.

<!-- /spom-source -->

## 기존 PR 6의 세부 계약 · 원문 5630–6313행

<a id="spom-source-5630-6313"></a>
<!-- spom-source:5630-6313 sha256:5515cd8a81845d3e6cd8a0e7f53f3750c792ca6fd8bf9b6415bb31ae978a315d -->

첫 번째 분할은 Risk/partial-fill source 해소의 선행 계약인 `RebalancePlanRecord`를 구현한다.
`rebalancePlan.ts`는 scope와 ordered action payload를 hash하고 `rebalance_plan` prefix로 ID를
파생한다. `createdAt`은 semantic hash에서 제외하되 cutoff 이후인지 검증한다. Action sequence는
0부터 연속이어야 하며 ID는 plan 안에서 unique, side는 phase와 일치해야 한다. Mandate와
legacy reduce-only lineage는 strict union으로 분리하고 legacy BUY나 합성 mandate를 거절한다.
Fractional BUY/SELL 및 whole-share target은 side·quantity·integer KRW cap과 표시 notional
재계산을 검증하며 complete target hash를 별도로 제공한다. Reason은 canonical sort 후 중복을
거절하고 read에서는 이미 canonical인 full record만 독립 rehash한다.

이 분할은 immutable content contract만 제공한다. Cycle당 유일 저장, append-only repository,
predecessor terminal event와 snapshot/mandate/price 원본 해소, residual sizing 재계산, execution
fold와 Risk/fill binding 및 atomic transaction은 아직 후속이다. `applied` predecessor는 후속
BUY shape만 허용하지만 실제 predecessor가 SELL applied였는지 이 contract만으로 승인하지 않는다.
기존 live/order/MCP 경로는 연결하거나 변경하지 않는다.

두 번째 분할은 `RebalancePlanFileRepository`로 immutable plan artifact를 저장한다.
`rebalance-plan-records.jsonl`에 `rebalance_plan_entry.v1`과 `rebalance_plan_commit.v1`을
쌍으로 append하며 record와 directory sync 이후에만 관측한 committedAt을 marker에 남긴다.
다음 entry는 직전 marker hash를 predecessor로 사용한다. 전체 read는 record/entry/marker
hash, 시간 순서와 unique plan/cycle ID를 독립 검증하며 torn pair, duplicate, 순서 변경,
미완성 write를 자동 복구하거나 무시하지 않는다.

Cooperative process는 exclusive lock 아래 read/validate/append를 직렬화하며 같은 cycle의
다른 scope/action/hash는 거절한다. 생성시각만 다른 semantic retry는 최초 record와 원래
origin을 유지한다. Repository-issued history의 WeakMap provenance와 post-record-fsync origin을
제공하지만 serialized copy나 순수 parser 결과를 repository origin으로 승격하지 않는다.
Abandoned lock은 자동 삭제하지 않으며 lock 대기는 monotonic elapsed time으로 제한한다.
Windows의 delete-pending lock 획득은 일시적 `EPERM`도 제한 시간까지 재시도하지만 lock 획득
후의 write/fsync/ownership 오류는 재시도로 감추지 않고 전파한다.

이 저장소는 plan artifact만 저장한다. Cycle claim completion·최초 preview event와의 원자 저장,
predecessor/mandate/snapshot/price source 해소, Risk 생성 전 plan availability receipt와
최종 execution fold는 아직 후속이다. 검증된 과거 read가 최신 generation 또는 실행 권한을
뜻하지 않으며 저장 경로를 재작성할 수 있는 공격자에 대한 외부 인증도 제공하지 않는다.

세 번째 분할은 `rebalancePlanEvent.ts`의 전체 event union content contract다. `previewed`,
`approved`, `rejected`, `stale`, `execution_applied`, `applied`의 variant별 필드를 strict하게
분리하고 event ID/hash를 제외한 full payload를 hash한다. `previewed`에는 predecessor를
허용하지 않고 나머지는 필수로 보존한다. Reason은 비어 있지 않은 canonical unique 집합이고
`applied.executionEventIds`는 비어 있지 않은 unique ordered 배열이며 정렬하지 않는다.
기존 `execution_applied` 전용 creator/parser와 hash 의미는 그대로 재사용한다.

`validateRebalancePlanEventRecordBinding`은 plan과 event를 각각 독립 rehash한 뒤 exact
plan/cycle/portfolio/version/snapshot/policy scope, creation 이후 event 시각 및 execution action
ID/sequence를 비교한다. Stale observed state와 execution pre/resulting state가 바뀌어도 공통
scope는 최초 plan preview의 값을 유지한다. 이 helper는 content 대조이며 source authenticity,
실제 predecessor/linear transition/terminal 여부, applied target 충족, cumulative fill/Risk replay,
최신 portfolio state와 durable origin을 증명하지 않는다. Event repository/fold와 실행 연결은 후속이다.

네 번째 분할은 `replayRebalancePlanEvents`의 순수 상태 재생이다. 입력 plan/event를 독립 검증한
뒤 첫 preview, 즉시 predecessor, nondecreasing event time과 허용 선형 전이를 검사한다.
Plan은 frozen binding을 만들 때 한 번만 parse/rehash하고 각 event는 그 원본에 대조한다.
다음 미완료 action은 단조 증가 cursor로 추적해 event마다 전체 action 배열을 재탐색하지 않는다.
Duplicate event, branch, terminal 이후 event를 거절하고 action이 target을 채워야 다음 action을
시작한다. Fill sequence는 action마다 0부터 연속이며 notional/quantity 누계는 직전 값과 실제
fill 합계여야 한다. 동일 plan 이력에서 fill/paper-fill/Risk decision ID 재사용을 거절한다.
수량은 `canonicalQuantity.ts`에서 Number의 canonical decimal 표기를 BigInt 단위로 바꿔
덧셈·remaining 비교한다. `0.1 + 0.2` 누계는 `0.3`이며 epsilon으로 target 초과를 허용하지 않는다.
324자리 scale은 Number의 최소 양수까지 표현하기 위한 내부 단위일 뿐 broker lot-size 규칙이
아니다. 정확한 십진 합계를 Number contract로 표현할 수 없으면 반올림하지 않고 fail-closed한다.
저장 Risk/fill binding도 같은 수량 합계를 사용한다. 과거 binary-drift 누계는 자동 수정하거나
승격하지 않으며 해당 이력은 재검토가 필요하다.

Fractional BUY는 requested/filled/cumulative notional을, fractional SELL과 whole-share는
requested/filled/cumulative quantity를 immutable target에 대조한다. 모든 실제 gross 누계는
action notional cap 이하이며 KRW는 positive safe integer, whole-share quantity는 정수여야 한다.
Quantity target은 reference-price notional 미달만으로 완료를 지연하지 않는다. 첫 fill의 pre-state는
plan preview, 이후는 직전 fill resulting state와 같아야 한다. Applied는 모든 action 완료,
정확한 ordered execution IDs 및 마지막 resulting state가 일치해야만 재생된다.
Execution resulting version은 최초 plan version이나 이전 fill의 version을 재사용할 수 없다.
이 검사는 action 경계 및 incomplete prefix에도 적용하며 opaque version의 정렬은 가정하지 않는다.

이 결과는 supplied content의 replay이며 valid prefix도 허용한다. Repository가 발급한 최신 이력,
실제 fill/Risk/price 원본, plan-before-Risk availability, policy/rule 수치 replay, portfolio-wide fill
uniqueness 및 cross-artifact atomic commit을 대신하지 않는다. Stale observed state와 마지막
execution state도 구분하며 외부 상태를 변경하지 않는다. 해당 저장·해소·실행 연결은 후속이다.

이 분할의 전체 회귀 검증에서 runtime policy 저장소의 동시 exclusive lock 획득이 Windows
`EPERM`으로 실패한 경계를 보강한다. `open("wx")`의 `EEXIST`와 Windows `EPERM`만
monotonic deadline 안에서 재시도하며 token 쓰기/fsync, ownership 오류는 재시도하지 않는다.
영구 획득 오류는 원인을 보존한 timeout으로 실패하고 abandoned lock은 삭제하지 않는다.
실제 동시 읽기, 일시·영구 오류 주입 및 frozen wall clock 테스트로 이 경계를 검증한다.

다섯 번째 분할은 `RebalancePlanEventFileRepository`의 append-only event 저장과 read replay다.
`rebalance-plan-events.jsonl`의 `rebalance_plan_event_entry.v1`은 full event, plan 저장 원본의
`planCommitHash`, append 시작시각과 직전 global commit hash를 결합한다. Record와 directory
sync 뒤 채집한 시각을 `rebalance_plan_event_commit.v1`에 저장하며 불완전한 쌍은 거절한다.
Plan과 event는 별도 lock을 가지며 event lock 안에서 plan repository의 검증된 history를 읽는다.
이 순서는 cooperative writer 사이의 event append를 직렬화하지만 두 파일의 원자 commit은 아니다.

모든 read에서 plan origin과 event/entry/marker hash, 저장 시각과 global chain을 검증하고,
plan별 event를 모아 순수 replay로 scope/transition/partial fill/applied 상태를 다시 검증한다.
최초 event의 `asOf`는 저장된 plan availability 이후, successor의 `asOf`는 저장된 이전 event
availability 이후여야 한다. Exact event retry는 전체 기존 파일을 먼저 검증하고 최초 원본·bytes를
유지하며 다른 predecessor/terminal 이후 append는 거절한다. Torn line/pair, 중복, 분기 또는
재해시된 잘못된 plan origin을 자동 복구하거나 무시하지 않는다. 저장소가 발급한 frozen history만
WeakMap 기반 origin/replay 해소에 사용할 수 있다.

`generationHash`는 해당 read가 관측한 global tail이며 이후 append에도 과거 token은 historical
observation으로만 유효하다. 유효한 suffix 전체를 삭제하거나 파일을 통째로 재작성할 권한이 있는
공격자를 외부 anchor 없이 탐지한다고 주장하지 않는다. 저장된 execution/approval event 자체가
실제 fill/Risk/price provenance 또는 최종 Risk 승인을 뜻하지 않는다. Cycle claim+plan+preview,
portfolio-wide fill uniqueness 및 accounting/state와의 cross-artifact transaction은 아직 후속이다.

여섯 번째 분할은 `PortfolioActionRiskDecisionFileRepository.createAndAppendWithPlanOrigin`과
`resolvePortfolioActionRiskDecisionPlan`으로 Risk 결정의 plan/action/pre-state 입력을 연결한다.
Factory는 같은 base directory에서 plan/event repository의 검증 및 fsync를 마치고 active policy를
새로 읽은 뒤 결정시각을 채집한다. Plan/event 조회 중 retirement 또는 policy 교체가 발생하면
그 변경을 반영한 정책으로 대조한다. Event 관측시각과 plan 원본은 동일 event lock 아래 보존하며
반환 후 새 event가 생겨도 과거 이력에 새 관측시각을 붙이지 않는다.
마지막 activation read는 `withDurableActivePolicy`로 lock을 유지한 채 다시 검증·fsync하고,
그 상태를 fold한 시각을 v4 `decidedAt`으로 사용한다. Risk entry/marker 저장이 끝날 때까지
activation lock을 유지하여 중간 retirement/supersession을 차단한다. Lock 순서는 activation→Risk며
실패해도 두 lock은 해제된다. 이미 미래 effectiveFrom이 있는 정책도 동일 결정시각에서 해소한다.
v4 policy origin은 같은 lock 안에서 검증·fsync한 전체 activation event 배열의 `eventCount`와
`eventsHash`를 `activationHistory`로 저장한다. 이후 과거 effectiveFrom을 가진 retirement가
추가돼도 당시 결정의 정책 해소에는 저장된 개수의 prefix를 독립 rehash하여 사용한다. 전체 현재
이력의 손상은 먼저 거절하며 prefix 누락·교체도 실패한다. 이는 당시 알려진 정책의 역사적 설명이지
소급 변경 후의 현재 실행 허가가 아니며, 신규 생성은 최신 정책 이력을 다시 확인한다.
`portfolio_action_risk_decision_entry.v4`에는 기존 policy origin과 함께
plan ID/hash/commit/availability, 직전 event ID/hash/commit/availability 및 관측 시각을 저장한다.
Caller가 완성 record나 결정시각을 전달하는 입력은 거절하며 나중에 기존 record에 plan receipt를
덧붙이거나 교체하는 retry도 허용하지 않는다.

관측한 이력은 approved 또는 execution_applied여야 하며 다음 미완료 action만 결정 대상으로
허용한다. Plan/policy/portfolio, market/symbol/side, execution target hash와 mandate/legacy scope
종류를 대조하고 expected portfolio version/snapshot 및 prior cumulative를 replay 결과와 비교한다.
Approved decision의 요청 금액과 gross 상한은 action 잔여 cap 이하여야 하고 fractional BUY의 요청·승인 상한은
잔여 notional target 이하, 수량 target은 canonical decimal remaining 이하이며 whole-share 요청은
정수여야 한다. Rejected decision은 초과 요청을 설명할 수 있으나 scope/pre-state 검증은 동일하다.
Event replay도 각 체결 요청 금액을 직전 누적 체결 금액을 차감한 action 잔여 cap과 대조한다.
이미 저장된 초과 요청 이력도 fail-closed하며 원본을 자동 수정하거나 한도를 확대하지 않는다.

Resolver는 저장된 v4 receipt가 가리키는 predecessor까지의 이력을 전체 저장 파일에서 복원하고
원본 및 policy-selected rule 집합을 다시 대조한다. 이후 새 event가 생겨도 과거 결정을 설명할 수
있으며 그 결과가 현재 실행 권한이나 최신 state 예약을 뜻하지는 않는다. Factory의 생성 retry는
같은 입력·policy·plan·predecessor일 때 최초 record/receipt/bytes를 유지한다. 이력이 전진하면 새
pre-state 입력이 필요하며 과거 record 자체의 일반 append retry는 그대로 보존한다.
동일 생성 retry 중 정책의 미래 event가 추가되어도 최초 activation history receipt는 교체하지
않는다. 다른 입력으로 새 결정을 만들면 미래 effective event까지 포함한 새 generation을 저장한다.
Retry는 activation lock을 유지한 현재 이력에 최초 receipt의 개수·hash와 일치하는 prefix가
남아 있는지도 검증한다. 활성 정책이 같더라도 최초 관측 suffix가 잘리거나 교체됐다면 실패한다.

기존 bare/v2/v3 조회·exact retry는 유지하지만 plan receipt 없는 결정은 새 resolver에서
review_required로 거절하며 자동 승격하지 않는다. v4 저장 후 이전 reader는 호환되지 않으므로
rollback 시 신규 생성을 멈추고 새 reader를 유지하거나 별도 검증된 호환 절차가 필요하다.
여섯 번째 분할에는 Mandate 원본의 bucket 일치가 포함되지 않는다. 가격·snapshot·turnover 원본과
실제 Risk 수치 규칙의 독립 재평가, 관측 이후 변경을 막는 실행 transaction은 후속이다. 이 변경은 Risk 결과를 실제로 계산하거나
최종 실행을 승인하지 않으며 live 경로를 추가하지 않는다.

일곱 번째 분할은 Risk 생성 전에 mandate 원본을 관측하기 위한 저장소 경로다.
`InvestmentMandateFileRepository.withDurableVerifiedHistory`는 두 JSONL의 전체 record/event를
같은 shared lock 아래 각각 동일 handle로 읽고 검증한 후 두 파일을 fsync하고 `observedAt`을 채집한다.
존재하는 빈 파일도 fsync하며, 없는 파일은 디렉터리 동기화 이후 경로 부재를 다시 확인한다.
관측시각은 두 원본의 동기화 이후이면서 최종 bytes/descriptor/path identity 재검증 이전에 고정한다.
한 원본을 처리하는 동안 다른 원본이 교체·덮어쓰기·삭제되면 consumer를 호출하지 않는다.
확보한 source handle은 성공과 부분 실패 모두 닫는다. 검증 뒤 비협력 writer가 변경해도 과거 원본에
그 변경보다 늦은 관측시각을 붙이지 않으며, 이 관측을 현재 실행 권한으로 해석하지 않는다.
`getDurableInvestmentMandateObservation`은 이 lease 안에서만 record/event 개수와 전체 payload
배열 hash를 반환한다. 일반 verified read·복사본·만료 lease는 durable observation을 얻을 수 없다.
Consumer 성공/실패 시 lease를 폐기하고 잠금을 해제하며 source fsync 실패 시 consumer를 호출하지
않는다. `resolveObservedInvestmentMandateHistory`는 새 durable lease에서 이전 관측의 두 prefix를
개수·hash로 독립 검증하고 유효한 record/event 조합만 재생한다. 전체 현재 이력의 손상은 먼저
거절하고 prefix를 새 verified lease로 승격하지 않는다. 정상 append 이후에도 과거 상태를 재생할 수
있지만 truncation·replacement는 거절한다. 관측은 bytes의 내구성 확인일 뿐 payload 생성 시각의
진위나 현재 실행 권한을 보증하지 않는다. 이 저장소 분할 자체는 Risk receipt를 저장하지 않으며
기존 mandate 파일 형식 및 일반 조회·append 계약은 유지한다.

여덟 번째 분할은 `createAndAppendWithMandateOrigin`으로 실제 mandate 원본을 Risk 생성에 연결한다.
저장된 plan/event를 확인한 다음 mandate shared lock → activation lock → Risk lock 순서로 획득하고
Risk commit까지 두 원본 lease를 유지한다. 신규 v5 entry는 v4 policy/plan receipt에 mandate
ID/hash, 결정시점 current event ID/hash와 두 원본 배열의 관측 count/hash/time을 추가한다.
Plan action의 mandateId가 가리키는 원본은 portfolio/policy/market/symbol/bucket과 일치해야 하고,
결정시각에 active 또는 review_required이며 `validFrom <= decidedAt < expiresAt`이어야 한다.
expiresAt이 없으면 상한은 적용하지 않는다. Approved BUY는 active mandate가 필요하며 manual
`classify_existing_reduce_only`를 거절한다. Review-required/reduce-only mandate의 SELL과
review-required BUY의 rejected 설명은 허용하지만 source/scope/유효기간 검증은 동일하다.
Legacy reduce-only action은 mandate를 합성하지 않고 기존 plan-bound 경로를 유지한다.

`resolvePortfolioActionRiskDecisionMandate`는 policy/plan을 재검증하고 저장된 관측 prefix를
현재 durable mandate 이력에서 해소해 당시 event와 상태를 독립 대조한다. 나중에 소급 retirement가
append되어도 기존 결정은 최초 generation 기준으로 설명하며 신규 생성은 최신 이력으로 거절한다.
생성 retry는 최초 receipt를 보존하고 그 prefix가 축소·교체되지 않았는지 같은 source lock 아래 확인한다.
v4 이하 record에 mandate receipt를 사후 추가하거나 자동 승격하지 않는다. 두 원본 fsync 실패와
mandate identity·상태·scope 불일치에서는 신규 Risk record를 남기지 않는다.

이 경로는 caller가 제공한 Risk 결과의 원본 결속이지 Risk 수치 규칙의 계산이나 현재 실행 허가가 아니다.
Manual/selector assignment와 reservation 원본, review cadence/holding expiry 판단, 가격·snapshot·turnover,
최종 fill/accounting transaction 연결은 후속이다. v5 reader를 먼저 배포하고 새 factory를 사용해야 하며,
v5 저장 후 rollback은 신규 생성을 중단하고 호환 reader를 유지해야 한다. 기존 파일을 삭제·변환하거나
live/broker/실제 portfolio mutation을 추가하지 않는다.

아홉 번째 분할은 Risk 현금·노출 입력 연결 전에 저장된 `PortfolioSizingSnapshot` 원본 세대를
관측하는 경로다. `PortfolioSizingSnapshotFileRepository.withDurableVerifiedHistory`는 기존 전체
parse/valuation replay를 수행한 후 동일 file handle을 fsync하고 원본 bytes를 같은 handle에서 다시 읽는다.
Handle의 dev/ino/size/mtime/ctime과 경로의 identity까지 대조해 관측 도중 덮어쓰기·교체를 거절한 뒤,
같은 lock 아래 배열 count/hash와 관측시각을 제공한다. Consumer 종료 시 성공·실패 모두 lease가 만료되며 fsync 실패에서는 consumer를
호출하지 않는다. 파일이 없으면 디렉터리 동기화 후 경로 부재를 다시 확인하고, 중간에 생성된 파일이나
symlink는 거절한다. 관측시각은 fsync 이후이면서 최종 handle/path 또는 부재 재확인 이전에 고정한다.
검증 후 비협력 writer가 파일을 바꾸더라도 과거 원본에 그 변경보다 늦은 관측시각을 붙이지 않는다.
빈 저장소는 count 0/빈 배열 hash로 관측하되 파일이나 가짜 snapshot을 만들지 않는다.
`resolveObservedPortfolioSizingSnapshotHistory`는 현재 durable lease에서 과거 관측 prefix의 개수·hash를
대조한다. 정상 append 뒤에는 당시 내용을 복원하며 source 축소·교체와 전체 이력의 손상은 거절한다.
직렬화된 receipt는 대조용 데이터일 뿐 새 lease가 아니다. 관측은 저장 bytes의 내구성 확인이며
valuation의 외부 가격·FX 진위, pending action/reservation 원본, 최신 portfolio state 또는 실행 권한을
보증하지 않는다. Risk에 snapshot receipt를 저장하고 plan pre-state와 결속하는 연결은 후속이다.
Snapshot 파일 형식, 기존 read/append/retry 계약과 설정은 변경하지 않아 코드 롤백이 가능하다.

열 번째 분할은 `createAndAppendWithSnapshotOrigin`으로 저장된 valuation-resolved snapshot을 Risk
결정 생성 전에 연결한다. Snapshot source lease를 획득하고 기존 plan/event를 재생한 다음,
snapshot → mandate(assigned action만) → activation → Risk 순서로 source lease를 Risk commit까지
유지한다. 원본은 expected portfolio version/hash, portfolio/policy scope와 일치해야 하고 snapshot
as-of 및 각 관측시각은 decidedAt보다 늦을 수 없다. 최초 preview뿐 아니라 partial execution 후
replayed pre-state가 가리키는 resulting snapshot도 동일하게 해소한다. 미분류 노출이 있으면 approved
BUY를 거절하며 rejected BUY 설명과 legacy reduce-only SELL은 원본 검증을 거쳐 허용한다.
Legacy action에는 mandate origin을 합성하지 않고 null로 저장한다.

신규 v6 Risk entry는 기존 policy/plan origin에 snapshot ID/hash, exposure hash와 source 전체 배열의
count/hash/time을 추가한다. Assigned action은 기존 mandate receipt도 필수다. Retry는 원래 record와
receipt를 보존하며 최초 관측 prefix의 축소·교체를 같은 source lock 아래 거절한다. v5 이하에
snapshot receipt를 사후 추가하거나 자동 승격하지 않는다. `resolvePortfolioActionRiskDecisionSnapshot`은
저장된 policy/plan/mandate 및 snapshot prefix를 재검증하고 현금·보유 수량·각 exposure 차원의 실제
평가 입력을 반환한다. 전체 source가 손상되면 유효한 prefix만 잘라서 진행하지 않는다.

이 분할은 Risk 입력 원본의 결속이며 caller ruleResults의 실제 수치 계산, 가격/FX 및 turnover 원본의
외부 진위, legacy position-state 원본, reservation 해소 또는 최신 실행 승인 증거는 아니다.
기존 API/파일 경로와 v2~v5 읽기·생성 경로는 유지한다. v6를 쓰기 전에 호환 reader를 배포하며 v6 저장 후
rollback은 신규 생성을 중단하고 호환 reader를 유지해야 한다. 기존 artifact 삭제·자동 변환은 없다.

열한 번째 분할은 `validateRiskDecisionCashCapacity`를 snapshot-bound 생성·retry와 과거 resolver에
연결한다. 실제 valuation replay의 cash/NAV/pending BUY 및 당시 활성 정책으로
`max(0, cash - max(minimumCashReserveKrw, round(NAV * targetCashRatio)) - pendingBuyExposureKrw)`를
재계산한다. Approved BUY의 worst-case net debit과 approved maximum net debit은 모두 정수 KRW이며
이 상한을 넘을 수 없다. Gross notional만 현금과 비교해 비용을 빠뜨리거나, actual worst-case가 작다는
이유로 더 큰 approval cap을 허용하지 않는다. 준비금·pending 차감은 각각 0에서 포화시켜 overflow를
막는다. Pending SELL 대금은 현금에 더하지 않으며 caller plan/action ID만으로 pending BUY를 제외하지 않는다.

`resolvePortfolioActionRiskDecisionSnapshot`은 BUY에 frozen `cashCapacity`를 반환하고 SELL에는 null을
반환한다. Rejected BUY는 현금이 부족해도 과거 거절 근거를 재생한다. SELL/legacy reduce-only의
현금 부족은 감축을 막지 않는다. 이 상한은 필요한 거절 조건이며 pending BUY의 추가 비용, reservation
원본·소유권·해소, 가격 및 complete cost bound, exposure/turnover와 versioned rule result 전체의
독립 재평가를 완료한 실행 승인이 아니다. 기존 pending exposure는 gross notional이므로 이 값으로
최종 spendable cash를 확정하거나 approval authority를 발급하지 않는다.

Risk payload/hash와 v2~v6 파일 bytes는 변경하지 않는다. 기존 provenance 없는 생성·raw read 경로도
유지한다. 다만 기존 v6에 잘못된 over-cash approval이 있으면 강화된 historical resolver가 거절한다.
해당 이력은 삭제·수정하지 않고 검토 대상으로 보존한다. 코드 rollback은 bytes 변환 없이 가능하지만
이 현금 gate도 제거하므로 신규 생성/실행 경로를 중단한 상태에서 이전 reader로 과거 raw 이력만 읽는다.

열두 번째 분할은 `validateRiskDecisionSnapshotState`의 approved SELL에 실제 보유 수량 상한을
적용한다. Snapshot의 market/symbol과 Risk bucket이 같은 lot만 사용하며, legacy reduce-only는
`strategyBucket`이 없는 lot만 사용한다. 다른 bucket·legacy의 같은 symbol 수량을 합산하거나
존재하지 않는 lot을 합성하지 않는다. Requested quantity를 canonical decimal units로 비교하므로
epsilon으로 보유 초과를 허용하지 않는다. Snapshot 자체가 per-market/symbol/bucket 중복 lot을
거절하므로 정확히 하나의 lot 또는 0 수량 상한으로 해소된다.

공통 snapshot validator를 사용하는 생성·retry·historical resolver에 동일하게 적용한다.
Partial execution 후에는 replayed resulting snapshot의 수량을 쓰고 prior cumulative fill을 다시
차감하지 않는다. Rejected SELL은 보유분이 없어도 거절 근거 조회를 유지한다. BUY 동작은 변경하지 않는다.
이 검사는 snapshot에 기록된 물리적 수량의 필요조건이다. Pending SELL 예약과 충돌·dedupe,
position-state 및 legacy observedPositionRef 원본, Mandate 소유권 lineage와 최종 실행 transaction을
대체하지 않는다. 기존 v2~v6 bytes/hash 및 raw read는 유지하고 over-owned v6 승인만 강화된
resolver에서 거절한다. 해당 기록을 삭제·자동 재작성하지 않는다. Rollback 시에도 신규 생성/실행을
중단한 채 과거 raw 이력만 조회해야 하며, 이전 코드로 돌아가면 이 수량 gate가 사라진다.

열세 번째 분할은 Risk의 가격 원본 연결을 위한 `SourcePriceEvidenceFileRepository`의
`withDurableVerifiedHistory`를 구현한다. 저장된 complete source-price history를 같은 descriptor로
읽기·검증·fsync하고 directory sync 후 관측시각을 찍는다. Consumer 전에 bytes, descriptor 및
pathname의 파일 identity/size/mtime/ctime을 재확인한다. 빈 파일도 fsync하고 없는 파일은 directory
sync와 absence 재확인으로 관측하되 source 파일을 만들지 않는다. 관측시각은 최종 검증/handle close
이전 값이므로 그 이후 비협력 writer의 교체를 과거 원본에 더 늦은 시각으로 붙이지 않는다.

관측 receipt는 `recordCount`, `entriesHash`, `observedAt`을 가지며 entries hash는 각 record와
nullable durable commit 시각, 전체 entry/commit provenance를 포함한 tail hash에 결속된다.
단순 record array뿐 아니라 commit metadata만 바뀐 경우도 원래 prefix 해소를 거절한다.
새 관측과 직렬화된 과거 receipt 모두 해당 prefix의 record 생성·durable commit 시각보다 이를 수 없다.
Callback 동안만 repository가 발급한 WeakMap lease가 유효하고 완료/예외 시 폐기한다. 일반 read,
복제·상속 history, 직렬화 receipt 및 반환된 historical prefix에는 새 lease를 부여하지 않는다.
원래 prefix 뒤 정상 append는 허용하되 source 축소·교체·전체 suffix 손상·시계 역행·fsync/directory
실패는 fail-closed한다. 기존 legacy entry의 durable origin 부재를 새 관측으로 승격하지 않는다.

기존 파일 bytes와 read/append/retry 형식은 변경하지 않는다. Rollback은 코드만으로 가능하며
artifact 삭제·변환은 없다. 이 분할은 durable source observation 제공이며 아직 Risk 생성 receipt나
가격/비용 계산에 연결된 것은 아니다. 관측한 파일을 외부 가격 진위나 최신 실행 승인으로 승격하지
않는다. Consumer 쪽 Risk receipt 결속은 다음 분할에서 연결하며 pending/cost/turnover·최종 실행 검증은 후속이다.

열네 번째 분할은 `createAndAppendWithPriceOrigin(input, evidenceRef)`와
`resolvePortfolioActionRiskDecisionPrice`를 연결한다. Caller는 typed price reference만 선택하며
가격 숫자·history·receipt·decidedAt를 주입하지 않는다. 입력은 첫 비동기 조회 전에 복사한다.
실제 가격 저장소의 durable lease를 획득한 뒤 snapshot → mandate(assigned만) → activation → Risk
순서로 lock을 획득하고 Risk commit까지 유지한다. Legacy reduce-only SELL에는 mandate를 합성하지 않는다.
선택한 가격은 Risk의 evidence list에 존재하고 market/symbol이 같아야 하며 observedAt, createdAt 및
durable committedAt가 모두 decidedAt 이하여야 한다. Plan preview의 reference quote와 Risk의 quote는
서로 다른 시점일 수 있으므로 두 ref의 동일성을 강제하지 않는다.

신규 `portfolio_action_risk_decision_entry.v7`은 v6의 정책·plan·mandate·snapshot 원본과 필수
`priceOrigin = { evidenceRef, evidenceHash, observation: { recordCount, entriesHash, observedAt } }`를
entry hash에 포함한다. Decision payload/hash와 기존 commit marker 형식은 변경하지 않는다.
Exact retry는 최초 receipt와 record를 반환하고 bytes를 변경하지 않는다. 정상 source append 뒤에는
원래 prefix를 재생하지만 source 소실·축소·commit metadata 교체·corrupt suffix와 identity 변경은
실패한다. 과거 resolver는 policy/plan/snapshot/mandate를 해소한 뒤 원래 가격 prefix와 identity를 대조한다.
Legacy 가격의 durable origin 부재 및 v6 이하 Risk의 price origin 부재는 자동 승격하지 않는다.

`portfolioActionRiskDecisionPolicyResolver.test.ts`는 assigned BUY/SELL과 legacy SELL의 실제 저장소
연결, 입력 변형·잘못된 source scope·과거 availability, restart/retry, rehashed receipt와 source 변조,
source fsync 실패 및 Risk commit 중 경쟁 price writer 차단을 검증한다.
기존 entry는 기존 reader 의미로 계속 읽고 origin 조회의 `priceOrigin`은 null이다. v7 writer 활성화 전에
모든 consumer reader를 갱신해야 한다. v7 기록 후 구버전 reader로 단순 rollback하면 unknown schema로
fail-closed하므로 신규 생성·실행을 중지하고 v7 호환 reader를 유지한다. 파일을 v6로 낮추거나 기록을
삭제·재해시하지 않는다. DB migration, live 거래 설정 및 외부 API 변경은 없다.
이 분할은 판단 당시 가격 입력의 원본 결속이며 외부 가격 진위·현재 freshness·수치 Risk rule 재계산·
complete cost bound 또는 현재 execution authority를 증명하지 않는다. 해당 계산과 실행 연결은 후속이다.

열다섯 번째 분할은 v7 Risk가 선택한 가격과 paper fill의 실제 source price identity를 연결한다.
`PaperFillExecutionFileRepository.createAndAppendWithRiskOrigin`은 fill payload를 검증한 뒤
`sourcePriceEvidence.evidenceRef/evidenceHash`가 Risk의 `priceOrigin`과 같은지 저장·retry 전에 검사한다.
`validateRebalancePlanExecutionFillRiskBinding`도 실제 저장 가격을 해소한 뒤 동일 검사를 수행한다.
Risk evidence list에 두 quote가 있어도 선택하지 않은 quote를 체결에 대입할 수 없다. 저장된 fill과
event 및 entry/commit hash를 재계산해 quote를 교체한 경우도 binding 단계에서 거절한다.

`portfolioActionRiskDecisionPolicyResolver.test.ts`는 실제 v7 생성부터 assigned BUY/SELL 및 legacy SELL의
fill 저장·restart retry·event binding까지 연결한다. 다른 listed quote 또는 selected ref의 hash 교체는
fill write 전에 거절하며, 이미 저장된 fill bytes를 완전히 rehash한 교체도 read-only binding에서 거절한다.
이 테스트의 event는 binding 검증용이며 실제 portfolio mutation이나 execution event transaction을 기록하지 않는다.
기존 v6 이하 Risk의 null price origin과 기존 fill/event bytes 형식은 그대로 유지한다. 그 경로는 여전히
기존 수준의 부분 검증이며 v7 원본 검증 통과로 취급하지 않는다. V7 선택 가격과 불일치하는 기존 fill은
raw read 가능하더라도 새 binding을 통과할 수 없다. Rollback은 코드로 가능하지만 신규 실행을 중지한 뒤
진행해야 하며 불일치 artifact를 자동 수정·삭제하지 않는다. 이 identity gate만으로 가격 원본 prefix 재생,
freshness, complete cost bound, 전체 Risk 재평가 또는 최종 execution transaction을 대체하지 않는다.

열여섯 번째 분할은 `PortfolioActionExecutionPreview` 순수 계산 계약을 구현한다. Risk가 비용 계산을
위해 선행 fill record를 요구하고 fill record가 다시 Risk origin을 요구하는 순환을 피하도록, fill ID나
파일 저장 없이 기존 `buildPaperFill`의 실행 수량·gross/net·fee/tax/slippage/spread/impact를 계산한다.
기존 fill의 full policy schema를 공유하고 side, typed source-price record, post-fillRatio requested notional,
nullable quantity override, nullable volume/averageVolume, liquidityStale와 asOf를 strict input으로 받는다.
정책 누락을 simulator 기본값으로 채우지 않으며 모델 버전과 모든 정책 값을 명시해야 한다.

`executionInputHash`는 complete input에, `executionPreviewHash`와 hash-derived ID는 schema version,
input/hash, requested quantity 및 모든 execution output에 결속된다. Parser는 가격 payload를 재해시하고
전체 모델을 다시 실행해 저장 값/identity와 대조한다. 정상·partial뿐 아니라 modeled liquidity rejected/stale
결과도 별도로 재생하며 이러한 결과를 accepted fill로 승격하지 않는다. Missing volume은 명시적인
`not_modeled`로 보존하되 stale을 거절하는 정책에서 missing volume과 stale=true가 같이 들어오면,
기존 simulator의 not-modeled 성공 fallback을 사용하지 않고 fail-closed한다.

Requested notional은 기존 fill record와 같이 fillRatio 적용 후 기준이다. Quantity override와 반올림한
source-price notional이 다르면 거절한다. Whole-share override와 부분 체결 결과 모두 정수만 허용하고 모델 계산 금액은
safe integer, fill price는 양의 safe integer, 수량은 canonical decimal 범위를 확인한다. 0으로 반올림된
체결 가격·성공 금액, 비정상 participation, target division overflow와 비정상 비용 결과는 거절한다.
Slippage는 fill price에 이미 반영되므로 BUY net에 다시 더하지 않으며 total cost의 설명 항목에는 포함한다.

`portfolioActionExecutionPreview.test.ts`는 모든 BUY/SELL 비용의 명시적 기대값과 기존 fill record parser
parity, partial/insufficient/stale/missing liquidity, fillRatio·whole share, 정책 누락·미래/변조 가격·unsafe
금액 및 complete rehash로도 숨길 수 없는 output 변조를 검증한다. 기존 fill record 형식/기본값은
변경하지 않는다. 이 계약은 로컬 순수 계산이며 artifact persistence, actual policy/liquidity source origin,
가격 freshness, Risk worst-case/approval 상한과 최종 execution transaction 연결은 후속이다.
따라서 `filled` 계산 결과나 preview hash를 Risk 승인 또는 실제 체결로 사용하지 않는다. DB migration과
자동 artifact 변경은 없고 아직 writer/consumer가 없으므로 이번 코드 rollback에 저장 데이터 변환은 없다.

열일곱 번째 분할은 `createPortfolioPolicyExecutionPreview`로 실제 저장된 active policy와 typed 가격을
위 순수 계산에 연결한다. 입력은 storage root, portfolio/expected policy hash, bucket 또는 legacy scope,
market/symbol/price ref, side/request와 liquidity 값이다. Caller가 실행 정책, 가격 payload, 평가 시각이나
activation history를 대체할 수 없다. Price durable lease 다음 activation lock을 잡고 backend 관측 시각을
생성하며, 활성 bucket의 enabled market 및 risk rule set 또는 legacy root의 rule set을 선택한다.
Legacy는 SELL만 허용한다. 이 경로는 scope 선택을 mandate나 plan 원본으로 인증하지 않는다.

선택된 rule set에는 해당 side에 적용되는 `paper_execution`, `ruleVersion = v1`이 있어야 한다.
해당 immutable parameter record의 `parameters`는 다음 opt-in strict 계약을 사용한다.

```typescript
{
  schemaVersion: "portfolio_execution_rule.v1",
  markets: {
    KR?: { executionPolicy: CompletePaperExecutionPolicy,
      maximumPriceAgeSeconds: number, allowedPriceSourceContractIds: string[] },
    US?: { executionPolicy: CompletePaperExecutionPolicy,
      maximumPriceAgeSeconds: number, allowedPriceSourceContractIds: string[] }
  }
}
```

적어도 한 market 설정이 필요하며 요청 market의 설정을 다른 시장에서 빌려오지 않는다. 가격 최대 나이는
양의 safe integer 초이고 허용 source contract 목록은 비어 있지 않은 정렬·중복 없는 목록이다. 전체 실행
정책에는 기본값을 채우지 않는다. 기존 policy에는 이 rule을 자동 추가하거나 활성화하지 않으며 누락된
policy는 이 새 preview 진입점에서만 fail-closed한다. 기존 generic Risk 저장/해소 동작은 변경하지 않는다.

저장 가격의 ref/hash, market/symbol, source contract allowlist, observed/created/저장 관측 시각을 검증하고
backend cutoff 기준 나이가 최대값 이하인지 확인한다. 결과는 순수 preview와 exact activation generation,
policy lineage, rule-set/parameter ref 및 가격 observation을 포함한 context와 complete observation hash다.
재시작 후 다시 읽어 같은 모델 출력을 얻되 새 관측 시각이므로 hash의 retry 동일성을 보장하지 않는다.
반환값은 저장 artifact 또는 재사용 가능한 실행 권한이 아니다. 유동성 값은 아직 caller 입력이며 원본
검증을 주장하지 않는다. 가격의 외부 진위, mandate/plan 인증, Risk 수치 승인과 최종 원자 실행은 후속이다.

기존 실제 policy 저장소 fixture를 확장해 BUY/SELL·legacy별 fee/tax 계산, 재시작, caller override와
mutation, 정책 drift/retirement, 누락/버전/side/market 설정, source/freshness 및 corrupt 원본을 검사한다.
Risk/fill 파일이 생성되지 않는 것도 검증한다. Artifact format이나 기본 거래 설정은 변경하지 않으므로
새 진입점을 제거하는 코드 rollback이 가능하며 기존 policy의 rewrite/data migration은 없다.

열여덟 번째 분할은 `createPortfolioPacketExecutionPreview`로 `market-packets.jsonl`의 canonical
packet/candidate 거래량을 정책 기반 preview에 연결한다. Caller는 `liquidityPacketHash`만 지정하며
`volume`, `averageVolume`, `liquidityStale`, packet/history payload 또는 평가 시각을 덮어쓸 수 없다.
기존 strict raw packet reader를 사용해 전체 파일의 corrupt/torn/blank/비canonical line을 거절하고,
독립 rehash한 packet이 정확히 하나인지, 그 packet ID가 다른 payload에 재사용되지 않았는지 검사한다.
선택 packet의 portfolio ID와 candidate의 market/symbol도 정확히 하나로 일치해야 한다.

선택 candidate의 두 volume 필드는 명시적으로 null 또는 유한 nonnegative supported quantity로 매핑한다.
둘 다 없으면 evidence 누락으로 거절하고 0은 보존해 기존 liquidity model이 rejected로 계산하게 한다.
평균 거래량만 있으면 기존 모델의 average-only 계산을 보존한다. Packet 생성·만료 및 candidate 수집·만료
시각은 offset-qualified ISO로 검사하며 collected <= generated <= cutoff, cutoff < expires/staleAfter를
요구한다. Packet read 직후와 실제 policy/price I/O 뒤 preview cutoff 모두 검사해 도중 만료도 거절한다.

반환은 policy preview, `stored-market-packet-liquidity.v1`의 packet/hash/sourceRefs/시각/전체 read history
count/hash context 및 이 전체의 observation hash다. 위 source contract 명칭은 로컬 packet projection의
종류이며 외부 source 진위나 policy-selected source trust를 뜻하지 않는다. 일반 packet 저장소는 price의
durable lease와 다르므로 이 context를 fsync 관측 receipt, 역사적 availability 증명 또는 실행 권한으로
사용하지 않는다. Packet의 portfolio balance/eligibility도 현재 Risk state나 plan 승인으로 사용하지 않는다.
현재 adapter는 fresh volume 조회와 모델 계산 연결이며 원본의 durable 결속, 정책별 liquidity source/기간
규칙, 모든 Risk 수치 재평가와 최종 실행 transaction은 후속이다.

실제 packet writer와 policy/price 저장소를 조합한 6개 테스트에서 BUY/SELL·legacy 부분 체결 비용,
재시작과 override 차단, scope/hash mismatch, corrupt/duplicate/reused ID, 모호한 candidate, missing/zero/
average-only/unsafe volume, 정확한 만료 경계 및 I/O 중 만료를 검사한다. Risk/fill artifact는 생성하지
않는다. 기존 packet·Risk·fill format과 기본 실행 경로는 변경하지 않으며 코드 rollback에 데이터 변환은 없다.

열아홉 번째 분할은 whole-share 부분 체결 계산을 명시적인 `execution_simulator.v5`로 추가한다.
기존 v4는 quantity override가 있으면 `allowFractionalShares=false`여도 유동성 cap이 만든 5.5주 같은
소수 수량을 반환한다. 순수 preview가 이를 거절하던 경계를 해소하되 기존 v4 artifact의 재생 값을
바꾸지 않도록 `buildVersionedPaperFill`이 저장된 modelVersion으로 v4/v5를 분기한다.
기존 `buildPaperFill`, runner와 `PAPER_EXECUTION_MODEL_VERSION` 기본값은 v4로 유지한다.

V5는 whole-share override가 양의 safe integer인지 확인하고, 수량 산출 뒤 override 유무와 관계없이
내림한다. 유동성이 모델링된 경우 실제 내림 수량의 source-price notional/requested notional 비율이
`minLiquidityFillRatio` 이상인지 다시 검사한다. 0주 또는 최소 비율 미달은 0 amount의
`rejected/insufficient_liquidity` 결과이며, 정상 결과는 내림 수량에서 gross/net·fee/tax/spread/impact와
participation을 다시 계산한다. Fractional share 계산은 기존 모델을 재사용한다.

순수 preview와 `PaperFillExecutionRecord`의 complete execution policy는 v4/v5를 명시적으로 허용하고
둘 다 저장된 버전으로 독립 replay한다. 기존 v4 record의 값과 identity를 유지하며 modelVersion만
바꿔 v4 소수 부분 체결을 v5로 재해시하는 것은 replay mismatch로 거절한다. 활성 policy의 parameter가
v5를 명시해야 새 계산을 사용하며 기존 정책이나 artifact를 자동 승격하지 않는다. V5 reader를 먼저
배포한 뒤 새 parameter를 선택해야 한다. V5 artifact 생성 후 구 reader로 rollback하면 읽기가 실패하므로
호환 reader를 유지하고 새 v5 선택을 중지해야 하며 기존 v5 데이터를 v4로 덮어쓰지 않는다.

버전 dispatch, legacy default, BUY/SELL 정수 부분 체결 및 내림 후 최소 비율·0주 거절, fractional 경로
동일성, preview의 전체 비용과 fill parser parity, v4/v5 round-trip 및 버전 바꿔치기 거절을 검증한다.
이 변경은 모델 계산이며 Risk 승인·원본 durable 결속이나 최종 실행 transaction을 추가하지 않는다.

스무 번째 분할은 `createPortfolioPlanExecutionPreview`로 저장된 plan/event 진행 상태와
policy/price/packet 실행 미리보기를 연결한다. 호출자는 plan ID, 예상 predecessor event hash,
가격 ref와 packet hash만 전달하며 action, side, bucket, 수량·금액은 덮어쓸 수 없다.
Approved 또는 execution_applied 상태의 다음 미완료 action을 고르고, fractional BUY는 남은 목표
notional, quantity target은 canonical decimal 차감으로 남은 수량을 계산한다. 현재 source price로
산출한 요청 또는 모델의 gross amount가 남은 action cap을 넘으면 목표를 임의로 축소하지 않고 거절한다.
Whole-share/fractional target과 실제 선택된 실행 정책의 share mode도 일치해야 한다.

Mandate action의 bucket은 실제 저장 mandate에서 해소하고 BUY는 active open-or-increase 상태만
허용한다. Legacy action은 root reduce-only SELL scope를 사용한다. 계산 전후 plan commit/predecessor와
mandate history를 다시 읽어 도중 변경을 거절하며 backend cutoff에서 mandate 유효성을 다시 평가한다.
반환 context는 plan origin, 실행 전 portfolio version/hash, action/target hash, 누적 체결과 남은 cap 및
mandate 관측 hash를 포함한다. 관측 시각이 달라지는 재호출은 새 observation이며 동일 실행값 재현만 보장한다.

이는 순차 read의 미리보기이지 여러 파일을 묶은 lease나 최신 실제 portfolio 증명, capacity reservation,
Risk 승인 또는 실행 transaction이 아니다. 저장 execution event의 Risk/fill 원본 검증 및 최종 portfolio
CAS는 후속 실행 연결에서 필요하다. 기존 artifact와 runner는 변경하지 않으며 데이터 migration 없이
코드 rollback이 가능하다. 실제 저장 fixture로 BUY/SELL/legacy, 정수 부분 체결, 0.3-0.1=0.2 잔량,
predecessor drift, terminal/retired/reduce-only, source cap, caller override와 I/O 중 plan/mandate 변경을 검증한다.

스물한 번째 분할은 `createAndAppendWithExecutionOrigin`으로 계획 기반 실행 미리보기를
`portfolio_action_risk_decision_entry.v8`의 `executionOrigin`에 보존한다. 호출자는 예상 plan event,
가격 ref와 packet hash를 선택할 뿐 모델 정책·유동성·시각을 주입하지 않는다. 기존 price → snapshot →
mandate → activation → Risk 저장 순서를 유지하고 실제 선택된 전체 rule set/ID와 `paper_execution.v1`
parameter ref를 검증한다. Plan에서 계산한 요청과 Risk 요청이 같아야 하며 modeled gross보다 작은
worst-case gross, BUY modeled net보다 작은 worst-case debit, SELL modeled net보다 큰 minimum credit를
거절한다. `paper_execution` 결과는 pass여야 한다. 다른 required Risk 결과의 수치 계산은 아직 별도다.

저장된 preview는 전체 모델 입력과 출력·hash를 독립 재생한다. 과거 execution resolver는 실제
policy parameter, source price, plan의 남은 목표 및 원래 packet history prefix까지 다시 해소한다.
Packet 관측은 canonical 일반 read/prefix 비교이며 fsync receipt나 외부 데이터 진위 증명이 아니다.
나중의 무관한 packet append는 과거 prefix를 대체하지 않고, retry는 기존 receipt와 bytes를 유지한다.
저장 identity를 먼저 확인하므로 packet/가격 만료 뒤의 지연 retry도 당시 cutoff와 실제 원본을 재해소해
기존 결정을 반환한다. 이 반환은 만료를 연장하거나 새 체결 권한을 만들지 않는다. Selection identity 변경,
원본 손상 및 새 요청은 이 과거 반환 경로로 우회하지 못하며 새 체결에는 현재 freshness 검증이 유지된다.
다른 packet/model로 receipt를 교체하거나 v1–v7 기록에 receipt를 덧붙이지 않는다.

Risk-bound fill writer와 plan execution fill binding은 동일한 source price 숫자/ref/hash, 요청,
수량 override, volume/averageVolume, 전체 실행 정책과 수량·가격·비용 출력을 요구한다.
반올림 결과만 같거나 더 저렴한 정책이어도 입력이 다르면 거절한다. 가격 maximum age와 packet의
expiresAt/staleAfter는 Risk decidedAt 및 fill asOf에서 각각 검증한다. 원래 packet의 생성 시각은
liquidity readAt보다 늦을 수 없으며 독립 재해시한 과거 기록에도 이 순서를 강제한다. 평균 매입가 기반 손익은 이 비용
미리보기의 입력·출력이 아니며 별도 accounting 검증 대상이다. 이 비용 경계는 고정된 동일 입력의
모의 체결에 한정되며 일반적인 시장 worst-case, 모든 Risk 규칙의 승인 또는 최신 portfolio 권한이 아니다.
Fill retry도 저장소 lock 안에서 동일 입력과 Risk origin을 확인하고 기존 fill의 원래 asOf로 검증한다.
만료 후 재시도는 기존 bytes/시각을 보존하며 새로운 fill ID나 변경된 모델 입력으로 재사용하지 못한다.
현재 capacity 예약, portfolio CAS 및 fill/accounting/valuation/event의 원자 실행은 후속이다.

BUY/SELL/legacy/whole-share 저장·재시작, 비용 과소 기재, 불완전 rule set, caller override,
독립 재해시한 모델/parameter/freshness 변경, packet prefix 교체와 retry, 기존 v7 승격 거절,
반올림에 가려진 가격 변경 및 더 저렴한 체결 모델 교체를 실제 저장 fixture로 검증한다.
새 factory만 v8을 쓰며 기존 factory의 형식은 유지한다. V8 reader를 먼저 배포하고 새 쓰기를 활성화해야
한다. V8 기록 후에는 호환 reader를 유지한 채 새 v8 쓰기를 중지해 rollback하며 기존 파일을 v7로
재작성하지 않는다. Live 경로, API와 runner 기본값은 변경하지 않는다.

스물두 번째 분할은 `bucketTurnover.ts`에서 고정 UTC window의 `BucketTurnoverEvent`와
`BucketTurnoverState` 계약 및 전체 window 재생을 구현한다. Window는 Unix epoch 기준 floor로
산출하며 시작 포함·끝 제외, 정수 초 duration과 canonical UTC milliseconds를 사용한다.
State ID는 portfolio/bucket/start/end에서만 파생하므로 policy hash가 바뀌어도 동일 window ID를
유지한다. 초기 root는 window 시작 시각, positive safe-integer KRW 분모와 0 누계를 갖는다.
이 순수 factory의 분모는 아직 source-authenticated 값이 아니며 window 시작 직전 실제 immutable
snapshot 선택 및 원본 검증은 저장·해소 연결에서 반드시 수행해야 한다.

Event는 complete payload에서 ID/hash/createdAt만 제외해 hash와 ID를 계산한다. Replay는 빈 root에서
전체 event를 순서대로 검증하며 exact window scope/predecessor, event/fill 중복, asOf/createdAt 역행, 구간 초과와
safe-integer 합산 overflow를 거절한다. 누계와 ratio를 독립 계산하고 마지막 policy hash/event ID를
반영한다. Policy 교체 event라도 분모를 바꾸거나 누계를 초기화하지 않는다. State hash는 자기 hash를
제외한 complete payload에서 계산하며 `resolveBucketTurnoverState`는 자체 rehash가 유효한 snapshot도
전체 event 재생 결과와 다르면 거절한다. 원본 이벤트 정책의 실제 activation 검증은 별도다.

해당 분할은 순수 계약·재생이며 file repository, window root의 유일성·분모 원본, 실제 plan/action/fill
source 해소, window 간 global fill uniqueness, retry 저장 수렴, current state CAS, Risk 회전율 cap 계산과
fill/accounting 원자 반영은 후속이다. 기존 수동 Risk 입력이나 runner에 자동 연결하지 않는다.
UTC 경계·epoch 이전 시각, 정책 교체 누계, 재시작 재생, complete rehash 변경, 중복·branch·scope·시각 및
safe-integer overflow를 synthetic unit fixture로 검증한다. 기존 artifact/API/default 변경 및 migration은
없으므로 이 미연결 모듈을 되돌리는 데 데이터 변환은 필요 없다.

스물세 번째 분할은 `bucketTurnoverSnapshotOrigin.ts`에서 실제 sizing snapshot 저장소의 live durable
lease를 받아 window 시작 직전 snapshot과 분모를 결속한다. 같은 portfolio의 `asOf < windowStartedAt`
중 가장 최신 시각을 선택하며 파일 append 순서나 policy hash로 후보를 좁히지 않는다. 최신 시각이
동률이면 모호한 원본으로 거절하고, 없거나 NAV가 0 이하이면 과거 양수 snapshot으로 fallback하지
않는다. 구간 시작과 같은 시각 및 구간 이후 snapshot은 분모 후보에서 제외한다.

Origin은 initial state, 정확한 snapshot ID/hash·exposure hash와 전체 관측 prefix receipt를 포함한다.
Historical resolver는 재시작 후에도 현재 durable source에서 원래 prefix를 재검증해 원래 분모를
유지한다. 나중에 도착한 과거 시각 snapshot은 새 관측의 후보를 바꿀 수 있지만 기존 origin의
분모를 바꾸지 않는다. 원본 prefix의 변경·절단과 corrupt/torn suffix는 fail-closed한다. 복제되거나
만료된 history 객체는 lease로 인정하지 않으며, 신규 요청의 미래 asOf와 임의 분모 필드는 거절한다.

이 연결은 snapshot 내용·출처 검증이며 policy/duration activation 인증, persisted window root의
최초 유일성 또는 현재 Risk 권한은 아니다. 후속 window repository가 전체 origin을 hash-covered
기록에 저장하고 동일 window의 최초 origin을 보존해야 한다. 임의로 구성한 receipt의 과거 발급을
증명하거나 새 root로 기존 window를 대체하는 동작을 허용하는 API는 추가하지 않는다. 기존 snapshot
파일 bytes/format과 runner는 유지한다. 실제 임시 저장소 기반 원본 선택·lease·재시작·prefix 변경
테스트를 추가하며 외부 데이터, live order 또는 credential은 사용하지 않는다.

스물네 번째 분할은 `bucketTurnoverWindowFiles.ts`에서 최초 window의 분모·snapshot origin과
실제 활성 정책 origin을 `bucket-turnover-windows.jsonl`의 entry/commit 쌍으로 저장한다. 요청은
portfolio/bucket/expectedPolicyHash만 받고 시각·duration·분모·원본 receipt는 호출자가 주입하지
못한다. Snapshot source → activation → window의 잠금 순서에서 source 관측과 policy 관측이 같은
UTC window에 있는지 확인한 후 정책이 선택한 duration으로 최초 root를 생성한다.

Entry는 전체 snapshot/policy origin, appendStartedAt, previous commit hash를 결속하고 commit
marker는 entry hash와 실제 entry fsync 후 채집한 committedAt을 결속한다. Reader는 원래 snapshot
prefix와 활성 정책 prefix, exact policy/activation identity, duration, 초기 state hash, 전체 commit
chain·시각과 window 유일성을 재검증한다. Snapshot 관측보다 미래이거나 window 끝 이상인 commit도
거절한다. 신규 append 전 `.bucket-turnover-window-pending.json`을 durable하게 생성하고 entry
fsync 후의 committedAt 및 marker fsync 완료 시각이 구간 안임을 확인한 뒤에만 pending을 제거한다.
동기화 중 구간이 끝나거나 실패하면 pending을 남겨 완성된 pair가 있어도 이후 read/retry를 거절한다.
Pending은 자동 수리·삭제하지 않으며 정상 기록과 함께 호환 reader가 계속 인식해야 한다.

같은 window가 존재하면 원본을 먼저 검증하고 sync한 뒤 그대로 반환한다. 이후 snapshot 도착이나
동일 duration의 정책 교체로 최초 분모·origin을 교체하지 않는다. 신규/재시도 요청은 현재 활성
정책과 expected hash의 일치를 요구하며 과거 origin 조회는 `readVerifiedHistory`로 분리한다.
복제된 history는 repository-issued origin으로 인정하지 않는다. 불완전 entry/commit, torn/corrupt,
중복 root, rehash된 분모·policy·predecessor·시각 변경과 abandoned lock은 자동 수리하지 않고
fail-closed한다. 실제 임시 저장소, 다중 process 최초 생성, retry·reopen·정책 변경, UTC 경계,
clock rollback과 fsync failure 테스트를 추가한다.

이는 최초 window 저장 경계이며 turnover fill event 저장, 누계 projection, 현재 Risk 한도 검사나
fill/accounting 원자 반영은 후속이다. 기존 파일·API·runner는 변경하지 않으며 새 파일은 이 명시적
repository 호출에서만 생성한다. 기존 데이터 migration은 없고 rollback 시 신규 쓰기를 중지하며
이미 쓴 origin 파일과 호환 reader를 보존한다. Corrupt/torn 파일을 삭제하거나 prefix로 자동 절단해
복구하지 않는다. 설정된 storage root 전체를 일관되게 재작성하는 공격에 대한 외부 인증은 아니다.

스물다섯 번째 분할은 `bucketTurnoverFillOrigin.ts`의 `resolveBucketTurnoverFillOrigin`에서 실제
저장된 paper fill ID를 회전율 입력 원본으로 해소한다. 요청은 baseDir/paperFillRecordId만 받고
금액·bucket·시각·Risk receipt를 주입하지 못한다. 저장된 fill의 Risk receipt와 원래 결정의
commit/hash/time을 비교하고 기존 execution resolver로 정책, plan predecessor, mandate 관측
prefix, snapshot, 가격 및 liquidity/model 원본을 재검증한다. Plan/action/market/symbol/side와
mandate bucket이 맞아야 하며 실제 fill economics가 동결된 실행 모델 및 승인된 gross/net
한도를 만족해야 한다. Legacy reduce-only fill과 Risk origin 없는 기존 fill은 거절한다.

Fill 시각과 원래 정책 duration으로 window identity를 계산해 실제 최초 window 저장소에서
원본을 찾는다. Risk assessment의 window ID와 고정 분모가 같아야 하고 window commit은 Risk
결정 이전, Risk commit은 fill 이전, fill의 post-fsync completion은 window 끝 이전이어야 한다. 반환 금액은
requested notional이나 net cash가 아니라 실제 `filledNotionalKrw`이며 asOf도 fill 원본을 따른다.
Plan/mandate/fill/Risk의 식별자·hash 및 최초 window 원본을 중첩 동결해 역사적 설명에 제공한다.

기존 Risk 통합 fixture를 재사용해 partial BUY, SELL, whole-share fill, 독립 재해시한 plan/action
치환, Risk receipt 변조, 원본 누락/손상/pending, 분모·window 불일치, 늦은 fill commit과 시계
역행을 검증한다. 별도 runner/API 변경은 없다. `createAndAppendWithRiskCompletion`은 opt-in
`paper_fill_execution_entry.v3`/commit/completion 세 줄을 기록하며 entry와 marker의 fsync 및
directory sync 완료 후 채집한 시각을 completion hash에 결속한다. Reader는 세 줄의 hash와
시간 순서를 재검증하고 completion 파일 sync 후에만 repository origin을 발급한다. 다음 entry는
completion hash를 predecessor로 사용한다. Completion 기록 시점의 추가 sync가 늦더라도 이
증거가 가리키는 것은 앞선 fill pair의 동기화 완료 시각이며 전체 회계 transaction 완료가 아니다.
원본 resolver는 completion이 없는 v1/v2 fill을 거절하고 재시도로 proof를 소급 추가하지 않는다.
구간 경계를 넘는 실제 FileHandle marker sync 지연과 marker sync 실패를 주입해 거절을 검증한다.
기존 append/Risk-origin 생성 메서드의 v1/v2 동작은 유지한다. v3 쓰기는 명시적 opt-in이며 기존
파일 변환 migration은 없다. Rollback 시 신규 쓰기를 중지하고 이미 기록한 v3 및 호환 reader를
보존해야 한다. Completion line 삭제나 기존 기록 승격은 하지 않는다. 이는 원본 결속이며 turnover event 저장·누계
재생에 의한 assessment state hash/prior 검증, 현재 정책 cap, assignment/reservation 원본과
fill/accounting 원자 반영은 후속이다. 역사적 조회를 현재 실행 권한으로 사용하지 않는다.

스물여섯 번째 분할은 `BucketTurnoverEventFileRepository`가 저장된 paper fill ID와 expected
turnover state hash만 받아 `bucket-turnover-events.jsonl`에 entry/commit 쌍을 생성한다. 실제
source resolver가 제공하는 amount·bucket·policy·plan/action/fill·asOf를 사용하고 predecessor와
resulting cumulative는 잠긴 전체 prior replay에서 계산한다. Risk assessment의 state hash와
prior cumulative도 재생 결과와 같아야 하며 실제 fill이 Risk requested turnover를 초과할 수 없다.
이는 과거 입력의 정합성 검사이고 현재 정책의 maxTurnoverRatio 평가나 실행 승인은 아니다.

Entry는 complete event/source/prior-state hash/append timestamp/global predecessor를 결속하고
marker는 entry hash와 commit timestamp를 결속한다. Reader는 매 source를 실제 저장소에서 다시
해소하고 전체 canonical payload와 원본을 비교한 뒤 window별 event chain을 재생한다. 여러
window에 걸쳐 portfolio/fill ID는 한 번만 나타나며 동일 retry는 최초 source와 prior hash로만
기존 event를 반환한다. `readWindowState`는 실제 최초 root와 전체 events를 다시 재생하고 별도
`bucket-turnover-state.json` projection 저장은 후속이다. Clone history는 발급 원본으로 인정하지 않는다.

신규 event는 fill completion 관측 시각 이상이면서 window 안에서만 생성한다. 실제 completion
원본을 해소한 뒤 생성하므로 밀리초 단위 시계에서 동일 시각은 허용하고 이전 시각은 거절한다. Pending barrier를
먼저 sync하고 entry/marker를 각각 sync하며 marker fsync 완료까지 구간 안인지 확인한 뒤에만
pending을 제거한다. Sync 실패, 구간 초과, torn/corrupt와 abandoned lock은 자동 복구하지 않는다.
Event 저장소 lock 안에서 source resolver의 기존 source lock들을 획득하므로 source lease를
이미 보유한 callback 안에서 이 API를 호출하지 않는다. 공용 transaction coordinator의 lock
순서·fill/accounting 원자 적용 및 durable current Risk state 관측은 후속에서 명시적으로 연결한다.

기존 Risk 통합 fixture에서 두 체결의 누계와 state 재생, 원래 hash 재시도, 서로 다른 process의
동시 최초 저장, rehash한 event/source/chain 변조, 오래된 Risk prior, 실제 source 손상과 fsync
실패·경계 초과를 검증한다. 이는 artifact 통합 테스트이며 전체 portfolio 실행 E2E는 아니다.
기존 파일을 변환하는 migration이나 runner/API 변경은 없다. Rollback 시 신규 쓰기를 중지하고
기록된 event/pending 및 호환 reader를 보존한다. 손상된 suffix를 삭제하거나 pending을 자동 제거하지 않는다.

스물일곱 번째 분할은 `BucketTurnoverStateFileRepository`가 실제 최초 window와 event의 전체
재생 결과를 `bucket-turnover-state.json`에 저장한다. Document v1은 sourceWindowCount와
sourceWindowGenerationHash, sourceEventCount와 sourceEventGenerationHash, turnoverStateId 순으로
정렬된 전체 states 및 자신만 제외한 complete payload의 projectionHash를 가진다. Caller는
expectedProjectionHash만 제공하며 state·분모·누계·시각을 지정하지 않는다.

명시적 refresh는 기존 projection이 실제 append-only 원본의 정확한 historical prefix인지 먼저
독립 검증하고, expected hash가 맞으면 현재 전체 재생 결과를 temporary file fsync → atomic rename
→ directory sync로 교체한다. 이미 동일한 최신 projection이면 bytes/hash를 유지한 채 sync한다.
일반 조회는 missing/stale projection을 자동 갱신하지 않는다. Corrupt projection, 원본 prefix 유실,
손상 및 pending은 read/refresh 모두 fail-closed하며 기존 bytes를 보존한다. Snapshot 자체가 없으면
명시적 null expected hash refresh로 실제 원본에서 최초 생성할 수 있지만 다른 source를 복구하지 않는다.

Event 저장소의 `withDurableStateSources`와 window 저장소의 `withDurableVerifiedHistory`는
event → snapshot → window lock 순서로 projection read/refresh callback까지 writer를 배제한다.
`withDurableSnapshot`은 projection 파일 sync 후 backend 관측 시각을 발급하며 WeakMap 관측은
callback 안에서만 유효하다. Clone 및 반환/예외 이후의 관측 사용을 거절한다. 이 callback 안에서
동일 source 저장소를 재진입하지 않는다. 현재 policy/Risk/reservation lock, 선택 window의 유효기간과
정책 cap 평가 및 fill/accounting 공용 transaction은 포함하지 않는다. Event append는 projection을
자동 갱신하지 않으며 후속 coordinator가 명시적 refresh와 Risk 연결을 수행해야 한다.

실제 저장 fixture에서 초기 root/두 fill 누계, 정상 historical prefix에서 current CAS 갱신, 두 window
보존, rehash한 state/source 변조와 source prefix 유실, pending 차단, 3 process 최초 refresh 수렴,
callback writer 배제·권한 만료 및 temporary/snapshot fsync 실패를 검증한다. Migration 명령은 없고
최초 생성은 refresh API로 수행한다. Rollback은 projection consumer/writer를 함께 중지하고 원본
JSONL과 호환 reader를 보존한다. Projection 교체는 원본 event를 수정하거나 전체 회계 transaction을
완성하지 않는다. 실제 전원 차단과 전체 portfolio E2E 검증은 후속이다.

스물여덟 번째 분할은 `validateRiskDecisionTurnoverCapacity`를 policy-bound/plan-bound 및 그 상위
snapshot/price/execution-bound Risk 생성 경로와 historical policy resolver에 연결한다. Parsed policy와
decision의 portfolio/hash, bucket/market을 대조하고 입력 assessment의 고정 분모·prior·requested 금액을
safe integer로 검증한다. 누계 합산은 BigInt로 수행하고 safe integer overflow는 거절한다.

Bucket의 maxTurnoverRatio는 canonical decimal units로 계산해 `floor(분모 × 정책 비율)`을 정수
원화 최대 누계로 사용한다. 예를 들어 십진 0.29와 분모 1,000은 290원까지 허용하지만 십진
0.3333333333333333과 분모 3은 1원을 허용하지 않는다. 반올림한 division 값의 equality나 epsilon으로
한도를 넓히지 않는다. 한도를 초과한 approved 결정은 저장 전에 실패하고, 같은 내용을 rehash한 과거
approved 기록도 policy resolver에서 거절한다. Rejected 기록은 한도 평가를 설명하며 bucket 회전율에
포함하지 않는 legacy reduce-only의 기존 경계를 유지한다. 반환된 `remainingTurnoverNotionalKrw`는
요청 반영 후의 가정 잔여액 `max(0, 최대 누계 - prior - requested)`이다. 한도 도달·초과 시 0이며,
rejected 결정의 반환값도 해당 요청을 가정한 설명이지 실제 차감·예약 결과가 아니다.

정책이 변경되면 같은 입력 prior 누계에 새 정책 한도를 적용하며 누계를 0으로 바꾸지 않는다. 과거
조회는 결정 당시의 검증된 정책으로 한도를 확인한다. 기존 generic record parser/저장 schema를 바꾸거나
기존 파일을 변환하지 않지만 정책 한도를 위반한 과거 approved 기록은 이제 policy/execution 해소가 실패한다.
그 기록을 자동 삭제·수정하지 않고 operator review 대상으로 남긴다. Rollback으로 한도 초과 승인이 다시
해소될 수 있으므로 관련 consumer를 중지한 상태에서 이전 코드로 되돌린다.

이 단계는 입력된 turnover assessment의 정책 상한을 강제하는 필요조건이다. Current projection의 실제
state/hash/분모를 Risk 생성 및 재시도에 연결하는 origin, 실행 시점의 window 만료·policy drift 검사,
reservation·fill/accounting transaction 및 나머지 ruleResults의 독립 계산은 후속이다. Caller가 주장한
prior를 현재 원본으로 인증했다고 간주하지 않는다. 통합 테스트는 BUY/SELL의 경계값/초과, plan/execution
생성 전 무기록 실패, rejected 설명, rehash한 과거 승인 거절 및 하향 policy activation을 검증한다.
기존 실행 비용 fixture의 turnover 분모는 해당 fixture 규모인 1,000,000원으로 맞춘다.

<!-- /spom-source -->

## 기존 PR 6의 세부 계약 · 원문 6333–6432행

<a id="spom-source-6333-6432"></a>
<!-- spom-source:6333-6432 sha256:2835b8f3b4321309eba1e52ddafae6d52c025a56615273bbe85dd9fe747e7bed -->

스물아홉 번째 분할은 `resolveCurrentPortfolioActionRiskDecisionTurnover`로 실제 저장된 execution-bound
Risk를 현재 회전율 projection 및 활성 정책과 연결해 읽기 전용 재검증한다. 전체 Risk/plan/mandate/
snapshot/price/liquidity 원본은 projection lock 전에 해소한다. 이후 event → snapshot → window lock을
유지한 상태에서 선택된 Risk 원본이 그대로인지 재확인하고 Risk lock을 해제한 뒤 activation을 잠근다.
Window 생성도 snapshot lock을 먼저 필요로 하므로 activation/window lock 순서가 교착하는 writer는
동시에 진입하지 못한다. Projection callback 안에서 price/snapshot resolver를 다시 호출하지 않는다.

현재 정책의 bucket/market, policy hash와 activation ID/hash를 결정 당시 원본과 대조한다. 같은 정책을
retire 후 다시 활성화한 경우도 이전 Risk가 새 activation의 승인이 되지 않는다. 현재 UTC window를
정책 duration으로 계산하고 실제 state의 hash, 누계 및 최초 snapshot 분모와 assessment를 비교한다.
전체 원본을 재생한 projection의 window 및 마지막 event completion 가용 시각이 `decidedAt`보다 엄격히 이전인지
검사해, 아직 저장되지 않았던 미래 누계를 과거 결정이 미리 참조한 것처럼 rehash하는 입력도 거절한다.
밀리초 시각이 같으면 독립적으로 생성된 Risk와 원본 저장 완료의 선후관계를 증명할 수 없어 거절한다.
관측 시각은 선택된 Risk의 실제 commit 시각 이상이어야 하며, 결정 시각 이후라도 commit 이전으로
시계가 역행하면 거절한다. 최신 상태 및 정책 대조 뒤 기존 정책 회전율 상한 검증을 다시 적용한다.

`getDurableBucketTurnoverStateSource`는 활성 projection 관측에서만 원본 가용 시각과 commit/completion hash를
반환한다. Marker timestamp는 마지막 fsync와 pending 제거 전일 수 있어 가용 시각으로 쓰지 않는다.
Window `createOrResolveWithCompletion`과 event `appendFillWithCompletion`은 opt-in v2 entry를 기록하고,
entry/marker fsync와 pending barrier의 durable 제거 후 completion 시각을 샘플링해 세 번째 행으로
저장한다. Completion은 source kind·marker commit hash·시각의 전체 payload를 hash로 결속하며 다음
global predecessor와 projection generation은 completion hash를 사용한다. V2의 누락·손상된 세 번째 행은
완료되지 않은 이력으로 거절한다. V1 root/event에 completion을 사후 추가하거나 시각을 합성하지 않는다.
V1의 과거 replay와 기존 writer는 유지하지만, 선택한 root 또는 마지막 event의 completion이 없으면
current 검사를 거절한다. Clone, callback 종료·예외 뒤 접근은 거절한다. Resolver는 상태 파일을 자동 생성·refresh하지
않고 missing/stale/corrupt/pending 및 fsync 실패를 그대로 차단한다. 체결 후 projection을 refresh해도
이전 누계를 참조한 Risk는 current 검사에서 거절하며, 기존 historical resolver의 과거 설명은 유지한다.

반환된 `turnoverObservation`은 `observedAt`의 검사 결과이지 재사용 가능한 lease나 실행 권한이 아니다.
Risk 생성 receipt/재시도 원본 결속, 현재 가격·잔고·소유 수량·예약·전체 rule 재평가 및 원자 체결 coordinator는
여전히 후속이다. Risk entry·runner·MCP·HTTP·거래 기본값은 변경하지 않는다. 자동 migration은 없으며
v2 reader를 먼저 배포하고 opt-in writer를 사용해야 한다. 새 형식 기록 후에는 관련 consumer를 중지하고
v2 reader를 유지해야 하며, v2를 모르는 코드로 곧바로 rollback하면 해당 이력 조회가 실패한다. 기존 파일을
자동 삭제·변환하지 않고 operator review 대상으로 남긴다. Completion은 앞선 실제 데이터와 barrier 제거의
완료 증명이지 자기 자신의 fsync 또는 여러 artifact의 원자 실행을 증명하는 receipt가 아니다.
통합 테스트는 BUY/SELL, stale projection/체결 후 old Risk, rehash한 누계·분모·hash, 원본 가용성,
구간 만료·retirement·동일 정책 재활성화, source lease 수명과 fsync 실패를 검증한다. 추가로 marker fsync
도중 실제 다음 Risk를 생성하는 경합을 재현해, marker 이후라도 completion 이전 결정은 current 검사가 거절함을 검증한다.

서른 번째 분할은 `BucketTurnoverStateFileRepository.withDurableRiskSources`로 회전율 projection,
가격 및 portfolio snapshot의 실제 원본 관측을 한 callback에 제공한다. 기존 projection 조회 안에서
price를 새로 잠그면 price → snapshot 순서의 Risk writer와 교착될 수 있으므로 새 경로는 event를
잠그고 과거 fill/Risk 원본을 먼저 해소한 다음 price → snapshot → window 순서로 잠근다. Window
저장소가 같은 baseDir의 가격·snapshot 원본을 직접 읽으며 caller가 다른 저장소의 history를 주입하지
못한다. Event/window writer 배제와 기존 projection 검증을 유지하고 모든 source lock을 callback의
성공·실패 종료까지 보존한다. Callback은 전달받은 history를 재사용하고 같은 저장소를 재진입하지 않는다.
설정된 lock timeout/retry는 event의 과거 fill → Risk → policy/plan/snapshot/mandate/price 및 window
원본 조회에도 전달한다. 제한은 각 잠금 획득의 경합 대기 값이며 전체 replay·파일 I/O·callback의 총
실행 시간 제한이 아니다. 옵션을 생략한 기존 resolver의 기본값은 유지한다.

가격 → snapshot → projection 관측 시각의 역행은 소비자 호출 전에 거절한다. Clone 및 callback 종료
뒤에는 원본 lease getter가 실패한다. Missing/stale/corrupt projection, pending event 및 각 source
fsync 실패에서 callback은 호출되지 않는다. 기존 read/refresh 및 저장 형식은 변경하지 않으며
projection을 자동 생성하거나 refresh하지 않는다. 별도 프로세스의 잠금 경합, price owner가 snapshot을
읽을 수 있는 획득 순서, 예외 해제, fsync 실패 및 시계 역행을 실제 임시 저장소로 검증한다.

이 분할은 Risk 생성 연결의 잠금 선행조건이며 policy/mandate/Risk 생성·receipt 저장, 과거 turnover
prefix 재검증, 현금·수량 예약 및 원자 체결은 후속이다. 현재 Risk 생성 메서드를 이 callback 안에서
그대로 호출하면 원본 저장소 재진입이므로 허용하지 않는다. 기존 데이터를 변환하지 않으며 rollback은
신규 consumer를 중지하고 코드만 되돌릴 수 있다. 거래·MCP·HTTP 설정과 paper-only 기본값은 유지한다.

서른한 번째 분할은 `PortfolioActionRiskDecisionFileRepository.createAndAppendWithTurnoverOrigin`으로
실제 회전율 원본을 Risk 생성과 append까지 연결한다. Opt-in Risk entry v9는 기존 v8의 policy,
plan, mandate, snapshot, price 및 execution 원본에 strict `portfolio_risk_turnover_origin.v1`을
추가한다. 이 원본은 선택한 state ID/hash, window/마지막 event의 commit·completion hash,
가용 시각과 전체 projection의 window/event count·generation hash·projection hash·관측 시각을
저장한다. 전체 원본은 entry hash 재계산에 포함되며 domain Risk record hash는 변경하지 않는다.

생성은 event → price → snapshot → window → mandate → activation → Risk 잠금 순서로 실제
원본을 보존한다. 가격·잔고 이력을 재사용하고 원본 저장소를 재진입하지 않는다. 실제 정책의
window ID, 고정 분모, 이전 누계, state hash 및 회전율 한도를 입력과 비교한다. 원본 completion은
decision보다 엄격히 앞서야 하고 source observation은 decision보다 늦을 수 없다. Projection의
missing/stale/corrupt 또는 completion 없는 legacy 원본은 새 v9 생성 전에 거절한다. 자동 refresh,
가용 시각 합성 및 기존 v8 결정에 대한 v9 원본 소급 추가는 하지 않는다.

동일 입력 재시도는 원래 저장한 관측 prefix를 실제 원본에서 재검증하고 기존 결정을 반환한다.
새 원본으로 과거 결정을 덮어쓰지 않는다. 동시 생성이 Risk 잠금에서 같은 결정을 발견하면 이미
보유한 source lease 안에서 원래 prefix를 재생한다. 과거 execution resolver는 v9 원본도 검증하지만
현재 projection cache를 요구하지 않으며 현재 실행 권한을 발급하지 않는다. Event reader는 각 event
이전까지 검증한 prefix를 내부 replay 동안만 전달하여 event → fill → Risk → event 순환 조회를
방지한다. Prefix metadata는 복사하고 저장소 root 및 내부 replay 수명을 확인하므로 caller clone,
다른 root의 이력과 반환 후 캐시한 이력을 재주입할 수 없다.

재생은 실제 prefix count·generation·projection hash와 선택 source identity를 모두 비교한다.
관측 시각보다 뒤에 완료된 포함 원본과 관측 시각보다 엄격히 앞서 완료됐지만 누락된 원본은
거절한다. 같은 millisecond의 시각만으로 전후 순서를 증명하지 않으며 새 생성 경로에서는 전체
잠긴 이력을 사용한다. Source receipt 자체가 현재 실행 권한이나 현금·수량 예약을 의미하지 않는다.
Risk append fsync 실패 시 성공 결과를 반환하지 않고 원본 lock을 해제하며 불완전 Risk 이력은
자동 복구·삭제하지 않는다. 전체 artifact에 걸친 원자 체결/회계 rollback은 여전히 후속 범위이다.

기존 v1~v8 reader/writer와 저장된 fill/event source payload는 유지하고 v9에만 선택적
`turnoverOrigin` 필드를 반환한다. 자동 migration은 없다. V9 reader를 먼저 배포하고 opt-in writer를
사용해야 한다. V9 기록 후에는 writer/consumer를 중지하고 v9 reader를 유지해야 하며 v9를 모르는
코드로 즉시 rollback하면 이력 조회가 실패한다. 기존 파일을 변환하거나 삭제하지 않는다.
테스트는 BUY/SELL, exact/concurrent retry, 두 번의 실제 paper fill 이후 prefix 재생, v8 소급 변경
거절, 독립 rehash 원본 위조, 가용 시각 경계, cached/clone/foreign prefix, stale projection,
실제 Risk fsync 동안 source lock 유지 및 실패 후 해제·불완전 이력 보존을 검증한다.
현재 가격·잔고·수량 예약 및 모든 Risk rule 수치 재평가, runner/원자 체결 coordinator 연결은 후속이다.
MCP·HTTP·live order surface와 mock/paper-only 기본값은 변경하지 않는다.

<!-- /spom-source -->

## 기존 PR 7의 세부 계약 · 원문 6435–6687행

<a id="spom-source-6435-6687"></a>
<!-- spom-source:6435-6687 sha256:b260916803589d0539a2955de914d48c8cb0f104b24e9631c95bbdcb115fdd3e -->

선행 current portfolio 동시성 연결은 기존 paper runner에 적용한다. `FileVirtualPortfolioStore`의
`read`/`write`, `readSnapshot`과 조건부 갱신이 같은 `virtual-portfolio.json.lock` 디렉터리를 사용하며,
현재 값 비교부터 decision/trade/risk 적용 및 portfolio 파일 교체까지 다른 협력 writer의 진입을
차단한다. `paperDecisionPipeline`은 provider 호출 전에 현재 저장 잔고와 packet 잔고를 대조하고,
provider 호출 후 잠금 안에서 최초 저장 값과 revision hash를 다시 비교한다. 불일치하면 `portfolio_state_changed`와
`PAPER_PORTFOLIO_STATE_CHANGED` audit를 남기고 decision/trade를 쓰지 않는다. Provider는 잠금 밖에서
실행하므로 외부 응답을 기다리는 동안 잔고 writer를 막지 않는다. 같은 초기 잔고로 두 BUY runner가
경합하면 하나만 적용되고 다른 하나는 변경된 잔고를 확인해 거절한다.

조건부 갱신 callback 실행 또는 portfolio commit 중 오류가 나면 일부 decision/trade/audit가 이미 기록되었을 수 있어
소유자 파일과 잠금 디렉터리를 복구 장벽으로 보존한다. 후속 읽기·쓰기·runner는 timeout 후 실패하며
자동 잠금 탈취나 부분 기록 삭제를 하지 않는다. 실제 trade append 직후 오류를 주입해 기존 잔고
보존, 추가 provider 호출 차단 및 trade 중복 추가 차단을 검증한다. 개별 portfolio 파일은 unique 임시
파일 write/fsync/rename으로 교체하지만 **여러 artifact의 commit/rollback 또는 exactly-once journal은
아니다**. Trigger identity dedupe와 공용 capacity allocator,
active policy/mandate/fill 회계 원자 연결은 여전히 후속이다. 기존 JSON 형식과 import 경로는 유지한다.
배포·롤백 때는 모든 reader/writer를 중지하고, 실패 장벽이 있으면 관련 artifact를 대조한 명시적 복구
후 진행한다. 구버전 프로세스와 동시 실행하면 구버전 writer가 새 잠금을 사용하지 않으므로 지원하지
않는다. 실행 중 외부 파일 교체는 지원하지 않으며 Risk Engine과 paper-only 기본값은 바꾸지 않는다.
Portfolio 파일과 디렉터리 동기화는 잠금 안에서 완료하고 잠금 삭제 뒤에는 추가 I/O를 하지 않는다.
따라서 해제 후 cleanup sync 오류로 완료된 HOLD/거절 결과를 실패로 뒤집지 않는다. 잠금 삭제 자체의
durability는 약속하지 않으므로 crash 후 이전 lock이 다시 보일 수 있으며, 이 경우 자동 탈취하지 않고
복구 장벽으로 취급한다. 삭제 실패도 남은 디렉터리를 보존해 후속 실행을 차단한다.

실제 writer의 revision journal은 `<portfolio 파일 경로>.revisions.jsonl`에 저장한다. 각
`paper_portfolio_revision.v1` entry는 연속 sequence, 직전 revision hash, 변경 전 portfolio 값의 hash와
전체 변경 후 portfolio를 가지며, 자기 `revisionHash`만 제외한 전체 payload를 독립 SHA-256으로 검증한다.
Object key 정렬 기반 hash와 schema 순서의 canonical JSON line을 함께 검사하고 UTF-8 손상, torn line,
중복 JSON key, sequence/predecessor gap, 현재 JSON 값과 마지막 entry의 불일치를 거절한다. 기존 JSON
파일은 그대로 유지하고 모든 일반 reader/writer도 journal이 있으면 전체 chain과 현재 값을 대조한다.
Journal이 없는 기존 파일은 revision null인 legacy 관측이며 read는 이력을 합성하지 않는다. 최초 write가
실제로 관측한 기존 값의 hash를 첫 entry에 보존하지만 과거 회계/거래 lineage를 인증하는 것은 아니다.

일반 write와 성공한 조건부 write는 값이 같아도 새 revision을 기록한다. `paperDecisionPipeline`은
`readSnapshot`의 portfolio/revision을 provider 호출 전에 캡처하고 `withExclusiveSnapshotUpdate`에서
두 값을 비교한다. 따라서 관측 이후 다른 writer의 A→B→A 변경과 같은 값의 HOLD commit도 오래된
실행을 거절한다. 기존 `withExclusiveUpdate`는 값 CAS 호환 API로 남지만 실제 runner는 revision API를
사용한다. 새 runner가 시작되기 전 완료된 동일 packet의 반복 실행이나 별도 trigger/cycle dedupe는
아직 보장하지 않는다. Sizing snapshot의 실제 revision 연결은 아래 current publisher로 제공하며,
정책 활성화·공용 예약·체결 회계와의 전체 transaction 연결은 후속이다.

`appendCurrentPortfolioSizingSnapshot`은 `FileVirtualPortfolioStore.withLockedSnapshot` 안에서 실제
잔고와 전체 revision 이력을 읽고, 저장소가 관측한 `revisionHash`를 snapshot의 `portfolioVersion`으로
사용한다. 호출자는 portfolio ID/version/잔고를 전달할 수 없다. 실제 현금·보유 수량에 대해 기존
valuation/exposure resolver를 다시 실행하고 snapshot 저장·fsync·exact retry 완료까지 portfolio
잠금을 유지한다. 잠금 순서는 portfolio → sizing snapshot이며 이 callback에서 execution-log 잠금을
역순으로 획득하거나 같은 portfolio store를 재호출하지 않는다. 현재 잔고/이력은 변경하지 않는다.
Journal 없는 legacy 또는 부재 잔고는 새 이력을 합성하지 않고 거절한다. 같은 잔고로 되돌아오는 ABA도
서로 다른 revision과 sizing snapshot ID로 구분한다. V3 이력이 있으면 구성된 실제 log plan/receipt까지
재검증하며 사용자 지정 로그 경로는 기존 portfolio store와 같게 제공해야 한다.

기존 일반 snapshot append/read와 과거 버전 문자열은 유지한다. 이 publisher의 결과도 저장 직후
portfolio가 갱신되면 과거 snapshot이므로 current execution lease가 아니다. Policy hash, 가격 증거와
pending action의 원본 권한은 이 연결만으로 승인하지 않으며 기존 downstream source 검증이 계속 필요하다.
`asOf`는 요청된 평가 cutoff이며 해당 과거 시각에 현재 revision bytes가 디스크에 존재했음을 증명하지 않는다.
Snapshot 저장 실패는 오류와 남은 bytes를 보존하되 portfolio를 갱신하지 않는다. 원본 portfolio 잠금은
소유권 확인 후 해제하며 snapshot의 partial/corrupt source는 기존 reader가 fail-closed한다. 새 API를
중지하는 코드 rollback이 가능하고 기존 JSON/schema/reader migration이나 artifact 삭제는 없다.

`appendPolicyBoundCurrentPortfolioSizingSnapshot`은 같은 실제 잔고/revision publisher에 저장된
정책 원본 검증을 추가한 경로다. Sizing 잠금을 얻은 뒤 실제 dependency/policy/activation 파일을 읽어
잠금 대기 중 정책 원본의 부분 append 실패도 거절한다. 이후 정책 저장소의
`withDurablePolicyGeneration`으로 실제 정책 이력을 잠금 안에서 다시 읽고 fsync하며 portfolio → price
→ FX(valuation에 FX가 있는 경우) → sizing snapshot → event → plan → mandate → policy → activation → Risk → fill 순서로
잠금을 유지해 저장 및 exact retry를 완료한다. Policy 잠금은
activation 잠금 대기 및 destination 저장 동안에도 유지하므로 중간의 정책 append 실패로 원본이
손상될 수 있는 cooperative writer gap을 남기지 않는다. Callback에서 같은 policy 저장소를 재진입하거나
activation → policy 역순으로 잠금을 획득하지 않는다. Sizing 저장소의
`appendForActivePolicy`는 activation 이력을 잠금 안에서 다시 읽고 fsync한 관측 시각의 활성 정책과
입력 `policyHash`를 비교한다. 평가 cutoff는 그 activation의 `effectiveFrom` 이상, 관측 시각 이하여야
한다. 정책 부재·종료·교체·손상은 거절하며 동일 hash의 정책이 다시 활성화돼도 이전 epoch의 cutoff는
수락하지 않는다. 사전 로드 이후 activation이 바뀌어도 재검증하며 새 정책 원본이 없는 경우 추정하지 않는다.

Dependency 7종은 `withDurablePolicyDependencies`가 실제 descriptor에서 읽고 fsync한 bytes로
기존 독립 hash/lineage 검증을 수행한다. 신규 저장과 exact retry의 destination fsync 전후에
원본 bytes, 파일 identity/크기/수정 시각/link 수 및 부재 상태를 재검증한다. 잠금 대기 중 부분 append,
저장 중 삭제·동일 내용 파일 교체·정상 추가·없던 파일 생성을 관측하면 성공을 반환하지 않는다.
잘못된 UTF-8, 마지막 줄 개행 누락, symbolic link 및 hard link도 거절하고 blank line/CRLF는 유지한다.
Dependency 전용 writer 잠금은 아니며 비협력 writer를 차단하거나 미래의 원본 상태를 보증하지 않는다.
저장 후 재검증 실패는 이미 쓴 immutable snapshot을 삭제하지 않는다. 일반 reader의 snapshot 존재는
정책 결속 성공 receipt가 아니므로 실행 권한으로 해석하지 않으며 재시도도 원본을 다시 검증한다.
파일 읽기/fsync/close 오류를 전파하고 descriptor를 해제한다. Windows directory sync EPERM 예외는
기존과 같으며 전원 장애 수준의 추가 보장은 없다. Schema 변경이나 자동 복구·원본 수정은 없다.

보유 mark가 있는 policy-bound publisher는 `SourcePriceEvidenceFileRepository`의 실제 가격 이력을
잠그고 read/fsync한 뒤, mark의 ref가 가리키는 record의 market/symbol/priceKrw/observedAt을 대조한다.
관측·생성·durable commit 시각이 snapshot cutoff보다 늦거나 commit 원본이 없는 legacy 가격이면
거절한다. 신규 append와 exact retry 모두 가격 잠금을 먼저 획득해 sizing/policy/activation 잠금 및
destination fsync 완료까지 유지한다. 기존 price-bound Risk의 price → snapshot 순서를 역전하지 않는다.
Cash-only 잔고에는 가격 파일을 요구하지 않는다. 이미 KRW인 US mark에 FX rate를 다시 곱하지 않는다.
이는 mark의 저장 원본 결속이며 sourceContractId의 외부 신뢰 및 freshness 정책은
검증하지 않는다. 이전에 caller-only mark로 통과하던 policy-bound 호출은 이제 실제 committed 가격을
먼저 저장해야 한다. 일반 publisher/append/read와 artifact schema는 유지하고 과거 snapshot을 재작성하지 않는다.
가격 잠금의 경합 timeout은 monotonic clock으로 계산해 벽시계 정지·역행에도 종료하며, 증거의
관측/commit/cutoff 시각은 기존 wall clock 의미를 유지한다. 보존된 실패 잠금을 자동 탈취하지 않는다.

US 평가에 사용한 FX 입력도 `SourceFxEvidenceFileRepository`의 실제 committed 원본에 연결한다.
가격 잠금 뒤, sizing 잠금 전에 FX 잠금을 획득해 ref의 base/quote currency, rate와 observedAt을 대조하고
원본 관측·생성·commit 시각 ≤ snapshot cutoff ≤ durable FX observation 시각을 확인한다.
FX 잠금은 신규 append와 exact retry destination fsync 완료까지 유지한다. FX가 없는 KR/cash-only
평가에는 FX 파일을 요구하지 않는다. 누락·손상·미commit·다른 값/시각·cutoff 이후 원본은 거절하고
일반 `appendCurrentPortfolioSizingSnapshot`과 과거 snapshot reader는 기존 의미를 유지한다.
이전에 caller-only FX ref로 통과하던 policy-bound US 호출은 해당 FX를 실제로 먼저 commit해야 한다.
이 연결은 저장 FX record와 입력의 일치를 검증하지만 KRW mark가 그 rate로 실제 환산됐다는 conversion lineage,
외부 source의 신뢰/freshness, pending/reservation 및 Risk 권한은 인증하지 않는다. 기존 mark에 rate를
다시 곱하지 않으며 새 FX 파일을 삭제하거나 과거 snapshot을 재작성하지 않는다. Rollback은 새 경로를
중지하고 기록을 보존하는 코드 rollback이며 강화된 FX 원본 검증이 제거된다는 점을 검토해야 한다.

이 경로는 실제 정책과 snapshot의 저장 시점 결속이며 일반 append/read 및
`appendCurrentPortfolioSizingSnapshot`의 의미는 바꾸지 않는다. 저장 schema에 activation receipt를 추가하지 않으므로 과거 디스크 존재 시각이나
현재 실행 권한의 증거로 재사용할 수 없다. 활성 정책은 잠금 안의 관측 시각 기준이며 이미 기록된
future-effective 전이가 이후 도래하는 것을 멈추지는 않는다. 가격/FX trust/freshness·환산 lineage·pending 원본 권한, 공용 예약,
최종 Risk 및 다중 bucket scheduler 연결은 별도 검증이 필요하다. 저장 실패 시 부분 destination을
보존하고 원본 portfolio/activation을 변경하지 않으며 소유한 원본 잠금을 해제한다. 활성 정책 잠금의
추가 대기·timeout 및 긴 이력 검증 비용은 운영 관측 대상이고 장기 부하 성능은 아직 측정하지 않았다.
새 publisher 사용을 중지하는 코드 rollback이 가능하며 기존 artifact 삭제나 migration은 없다.

새 JSON 임시 파일을 먼저 sync한 뒤 journal append/fsync와 부모 디렉터리 sync, JSON rename/sync 순으로
반영한다. Journal 쓰기 시작 이후 오류는 일반 write에서도 lock을 복구 장벽으로 남기며, prior JSON이
남아 있어도 자동 retry하지 않는다. Journal과 JSON의 전체 자동 roll-forward/rollback은 후속이다.
배포와 rollback은 모든 writer를 중지하고 journal/JSON 및 부분 실행 기록을 대조해야 한다. Journal 도입
후에는 이를 무시하는 구버전 writer로 바로 rollback하지 않으며, journal 삭제/초기화나 실행 중 외부
파일 교체는 지원하지 않는다. Journal 전체가 외부에서 삭제된 상태는 도입 전 legacy 부재와
구별할 독립 anchor가 없으므로 이를 변조 방지 또는 과거 이력 완전성 증거로 주장하지 않는다.

실행 전 전체 결과 기록은 실제 `paperDecisionPipeline`의 `withPreparedApplication` 경로에 연결한다.
동일 portfolio revision 잠금에서 provider 원본 decision을 다시 semantic 검증하고 confidence/hash를
계산한 뒤, 기존 deterministic `PaperOrderEngine`으로 모든 decision을 순서대로 계산한다. 각 단계의
Risk decision, paper trade 또는 no-op, 변경 후 portfolio와 순서대로 기록할 audit 전체를
`paper_prepared_application.v1`에 넣는다. 입력은 전체 packet, 원본 provider decision, 관측한
portfolio/revision, 평가 시각과 decision summary를 포함한다. `paper_order_engine.v1` 실행 모델은
고정된 v1 Risk/execution 정책을 사용하며 provider가 전달한 policyVersion 문자열을 실행 권한으로
승격하지 않는다. `paper/executionModels/v1`에 원본 커밋의 전체 상대 의존성 22개 파일을 보존한다.
공용 dispatcher가 저장된 executionModelVersion으로 v1을 선택하고 unknown version을 거절하므로
현재 주문 엔진·Risk·confidence·validation 변경이 과거 기록의 재생 결과에 적용되지 않는다.
파일별 hash/import 경계와 변경 전 golden 기록을 검증하며, 새 모델은 v1을 고치지 않고 별도로 추가한다.

전체 canonical payload에서 `applicationHash`만 제외해 SHA-256을 계산하고
`<portfolio 파일 경로>.applications/<hash hex>.json`을 exclusive create한 뒤 파일·디렉터리를
동기화한다. Windows의 기존 directory fsync EPERM 예외는 유지하므로 전원 장애 수준의 보장은
추가하지 않는다. 이 저장이 성공하기 전에는 application decision/trade/audit를 쓰지 않는다.
기존 packet 선택·provider 실패·validation 실패 audit는 이 application 경계 밖이다.
기록은 완료 receipt가 아니라 복구 대조용 intent이며, 존재만으로 거래 적용을 승인하지 않는다.
동일 경로가 이미 있으면 자동 재사용/덮어쓰기하지 않는다. Intent 저장 또는 이후 effect/commit 실패는
기존 잠금을 보존하고 자동 재시도를 차단한다. 불완전 파일이나 실패 잠금을 자동 삭제하지 않는다.

성공한 application의 잔고 변경은 `paper_portfolio_revision.v2`가 intent hash를 참조한다.
일반 portfolio write의 v1과 혼합할 수 있으며, 모든 revision reader는 v2의 실제 intent 파일을
읽어 canonical bytes·파일명 hash·전체 rehash·독립 실행 재생을 검사한다. 관측 revision/이전 잔고 및
계산한 최종 잔고가 revision entry와 같아야 한다. 원본 누락, 손상 또는 독립 rehash한 Risk/fill/audit
변조도 거절한다. 이전 이력에 application 원본을 사후 합성하지 않는다. 기존 legacy JSON,
decision/trade/audit 형식과 audit ID 규칙은 유지하며 기존 audit ID를 멱등성 키로 사용하지 않는다.

Intent 파일은 실패 잠금이 남아도 별도 read helper로 오프라인 검증할 수 있다. 이 검증은 실제
decision/trade/audit 로그의 완료·정확한 prefix 또는 durable 적용을 증명하지 않는다. 전체 artifact
원자성, 완료 marker, automatic roll-forward/rollback, trigger 중복 제거 및
공용 capacity 배정은 후속이다. 재시작 시 정상 portfolio 조회가 가능한 경우에도 intent 자체를
실행 완료 receipt로 해석하지 않는다. 새 v2 reader를 먼저 배포하고 모든 writer를 중지해 전환한다.
V2 생성 뒤 구버전 reader/writer로 즉시 rollback할 수 없으며 intent와 revision을 함께 보존해야 한다.
실패 복구는 모든 관련 writer를 중지하고 intent/현재 JSON/revision/decision/trade/audit를 대조해야 한다.
자동 migration, 이력 삭제, MCP/HTTP mutation 또는 live order surface는 추가하지 않는다.

개별 실행 로그는 `JsonlStore.appendDurably`를 통해 해당 파일 handle의 write/fsync/close 및
부모 디렉터리 sync가 완료된 뒤 append 성공을 반환한다. `FileAuditLog`, `FileVirtualDecisionStore`,
`FileVirtualTradeStore`의 기존 append API가 이 경로를 사용하며 해당 저장소의 모든 호출에 적용된다.
다른 JSONL 저장소의 일반 append, JSONL 한 줄 형식, decision hash 생성과 readAll의 corruptLineCount
정책은 유지한다. 입력은 I/O 대기 전에 검증·직렬화해 호출자 변경이 저장 내용에 반영되지 않는다.

Paper application의 로그 sync 실패는 기존 intent와 이미 기록됐을 수 있는 로그 bytes를 보존하고
잔고 revision/JSON 확정 전에 실패 장벽을 남긴다. 파일 open/write/sync/close/디렉터리 sync 오류를
자동 재시도하거나 부분 bytes를 삭제하지 않는다. Application 밖의 audit append 실패도 호출자에게
전달된다. 개별 로그 동기화와 아래의 협력 writer 잠금은 portfolio 전체 transaction과 구분한다.
Windows directory sync EPERM 예외는 기존 경계대로 유지한다. 새로 생성된 모든 상위 디렉터리의
durability나 장치 전원 장애 수준까지 보장하지 않으므로 사전 준비된 저장 경로를 사용해야 한다.
개별 동기화 자체는 로그 간 원자성, 완료 prefix/receipt, torn-line 복구 또는 exactly-once를
추가하지 않는다. 기존 손상 이력의 자동 수정도 하지 않는다. Runtime artifact 형식 변경은 없고 코드
rollback으로 복구할 수 있으나 rollback하면 append 성공 전에 fsync를 기다리는 보장이 사라진다.

협력 writer의 직렬화는 `paperExecutionLogLocks`에 연결한다. 세 실행 로그의 기존 `append`는
각 파일의 `<로그 경로>.paper-log.lock` 디렉터리와 UUID owner token을 획득한 뒤 동기화한다.
실제 `paperDecisionPipeline`은 provider/semantic 검증 후 audit/decision/trade 경로를 canonical
경로 순서로 잠그고, 그 안에서 기존 portfolio revision 잠금과 prepared application을 실행한다.
따라서 application 로그 기록부터 잔고 revision/JSON 확정까지 독립 writer가 해당 로그에 추가할 수 없다.
잠금 순서는 log batch → portfolio이며 provider/network 호출은 batch 밖에 둔다. 기존 packet 선택과
provider 실패 audit도 개별 writer 잠금에 참여한다. 서로 다른 portfolio가 로그 경로를 공유하면
공통 경로에서 직렬화되지만 별도 portfolio 사이의 회계 transaction을 합치는 것은 아니다.

Batch의 `AsyncLocalStorage` 범위 안에서 기존 append 호출은 재획득하지 않고 소유권을 재검증한다.
동일 파일의 concurrent append는 queue로 직렬화한다. 범위 밖 경로, 중첩 batch, 종료된 범위에서
뒤늦게 실행된 append는 거절한다. Canonical parent 경로를 사용하고 중복 경로, symbolic link인
로그와 hard-linked 로그를 거절한다. 실행 중 외부 경로/파일 교체나 비협력 writer는 지원하지 않는다.
입력 schema 검증/직렬화는 잠금 대기 전에 수행한다. Callback은 모든 append를 await해야 한다.

Append 시작 이후 오류가 발생하면 기록된 bytes와 batch의 모든 로그 잠금을 보존한다. Caller가
append 오류를 삼켜도 batch는 실패하며 후속 queue는 쓰지 않는다. 쓰기 전의 callback/획득 실패는
이미 획득한 정상 잠금을 해제하지만 초기화에 실패한 잠금은 남긴다. EEXIST와 Windows EPERM
획득 경합만 monotonic timeout 안에서 재시도하며 write/fsync/close 오류는 재시도하지 않는다.
Owner token 변경·해제 실패·abandoned lock을 자동 삭제하거나 탈취하지 않는다. 잠금 해제 뒤
추가 fsync는 하지 않으므로 crash 후 잠금이 다시 보일 수 있으며 이 경우 fail-closed로 남는다.

`readAll`은 기존 forensic 조회와 corruptLineCount 정책을 유지하므로 batch 중간 또는 실패 후의
부분 로그도 관측할 수 있다. 이를 committed snapshot이나 적용 완료 증거로 해석하지 않는다.
협력 writer 직렬화 자체는 정확한 prefix/완료 receipt를 제공하지 않는다. 아래의 별도 로그 증거를
연결하더라도 다중 artifact 원자 read/recovery 및 공용 capacity allocator는 후속이다.
배포·rollback은 모든 관련 writer를 중지하고 로그/intent/revision/JSON과 남은 잠금을 대조해야 한다.
구버전 writer는 로그 잠금을 무시하므로 혼합 실행 및 실패 잠금이 있는 상태의 단순 rollback은
지원하지 않는다. Artifact payload/hash와 v1 실행 모델은 바꾸지 않고 자동 migration도 하지 않는다.

실제 paper pipeline은 `withLoggedPreparedApplication`에서 로그 batch → portfolio revision 잠금
순서를 유지하고, prepared intent 다음에 `paper_application_log_plan.v1`을 먼저 저장한다.
계획은 application hash와 audit/decision/trade 각각의 실행 전 존재 여부, byte length 및 SHA-256을
포함한다. 실제 파일을 잠금 안에서 관측·동기화하고, plan 전체 payload에서 `planHash`만 제외해
독립 digest를 계산한다. `<portfolio 경로>.application-log-plans/<plan hash>.json`에 exclusive
create/write/fsync한 뒤에만 application 로그를 추가한다. 기존 prefix는 UTF-8·JSONL framing을
검사하지만 그 자체를 인증된 과거 거래 lineage로 승격하지 않는다.

Effect callback이 끝나면 로그 batch를 seal해 추가 append를 거절하고 이미 등록된 queue를 기다린다.
이후 각 로그의 기존 prefix hash를 재확인하고, 새 suffix의 전체 JSON payload가 고정 실행 모델의
decision 1개, 순서대로 계산한 audit 전체 및 trade 전체와 정확히 같은지 확인한다. 누락·중복·추가
기록, 다른 수량, prefix 변경, torn line, suffix의 중복 JSON key/비canonical bytes는 거절한다.
로그 관측을 sync할 때는 기존 저장소처럼 `r+` handle을 쓰되 파일을 생성하거나 내용을 바꾸지 않는다.
`lstat`의 실제 ENOENT만 부재로 취급하며 open/read/fsync/close 오류는 부재로 숨기지 않는다.

대조 성공 후 `paper_application_log_receipt.v1`이 application/plan hash와 세 로그의 실행 후
존재 여부·길이·hash를 저장한다. `receiptHash`만 제외한 전체 payload를 해시하고
`<portfolio 경로>.application-log-receipts/<receipt hash>.json`을 exclusive create/fsync한다.
이 receipt는 로그 추가 완료 증거이며 portfolio commit marker는 아니다. 실제 잔고 확정은 뒤따르는
`paper_portfolio_revision.v3`가 application hash와 log receipt hash를 함께 참조하면서 수행한다.
Plan/receipt 저장 또는 suffix 대조 실패 시 잔고 확정을 건너뛰고 기존 portfolio 실패 장벽을 남긴다.
로그 쓰기가 시작된 실패는 batch의 로그 장벽도 보존한다. Receipt 뒤 잔고 rename이 실패하면 로그
receipt를 별도로 읽을 수 있어도 portfolio가 적용됐다고 판정하지 않는다.

모든 portfolio reader/writer는 v3 entry의 실제 intent, plan, receipt와 구성된 실제 로그 prefix를
다시 읽어 canonical bytes, hash-derived filename, full digest, origin, prefix 및 suffix 재생을 검증한다.
이후의 정상 append-only suffix는 허용하되 이미 증명한 prefix의 삭제·절단·변조는 거절한다.
Receipt는 filesystem 경로를 제공하지 않는다. 로그 경로는 `FileVirtualPortfolioStore`의 신뢰된
`executionLogPaths` 설정에서 가져오며 기본값은 portfolio 파일과 같은 디렉터리의 기존 세 로그다.
별도 로그 경로를 쓰면 writer와 모든 reader에 같은 설정이 필요하다. Pipeline이 전달한 경로와
설정이 다르면 effect 전 거절한다. 임의 manifest가 reader를 다른 파일로 돌릴 수 없다.

Journal의 v3 receipt들은 한 번의 read 호출 안에서 함께 검증한다. 각 실제 로그는 한 번만 읽고,
before/after byte boundary를 정렬하여 SHA-256 상태를 누적·복사하므로 매 revision마다 전체 로그를
다시 읽거나 prefix 전체를 재해시하지 않는다. Buffer와 digest는 호출 밖에 캐시하지 않아 다음 read는
실제 파일을 다시 검사한다. 기존 prefix의 빈 줄·공백 separator는 `JsonlStore.readAll`과 같이 무시하되
원본 bytes/hash는 그대로 보존한다. 새 suffix의 빈 줄은 허용하지 않으며 torn line 검증도 유지한다.

일반 write의 v1과 기존 `withPreparedApplication`의 v2는 유지하고 과거 로그 receipt를 합성하지 않는다.
v1/v2/v3 혼합 이력을 지원하지만 v3 생성 이후에는 v3 reader를 배포한 상태를 유지해야 한다.
Rollback은 모든 writer를 중지하고 intent/plan/receipt/log/revision/JSON과 실패 잠금을 함께 대조해야
하며 v3를 모르는 구버전 writer로 즉시 돌아갈 수 없다. 고정 실행 모델이나 기존 로그 payload는
변경하지 않는다. 전체 이력 삭제를 식별하는 외부 anchor, 자동 recovery, trigger exactly-once,
공용 allocator 및 정책/mandate/회계 전체 원자 연결은 여전히 후속이다.

<!-- /spom-source -->
