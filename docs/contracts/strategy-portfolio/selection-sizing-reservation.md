# 전략 포트폴리오: selection·sizing·reservation 계약

[운용 모델 진입점](../../plans/strategy-portfolio-operating-model-plan.md) · [현재 main 구현과 남은 작업](../../architecture/strategy-portfolio-implementation-status.md) · [기존 PR 1~8 단계](../../plans/strategy-portfolio/implementation-stages.md) · [검증·최종 수용 기준](../../plans/strategy-portfolio/validation-and-acceptance.md)

## 이 문서의 책임과 읽기 기준

이 문서는 해당 책임의 목표 계약과 구현 과정에서 구체화된 안전·저장·복구 제약의 정본이다.
계약의 존재를 전체 구현 완료나 실행 권한으로 해석하지 않는다. 기존 13절의 상세는 살아 있는
lock/lease, fail-closed, rollback 조건을 포함하므로 이력 파일로 숨기지 않고 여기 보존한다.

상세에 남은 “첫 분할”, “후속”, “아직”은 해당 분할의 범위 제한을 기록한 표현이다.
뒤의 분할이 추가한 기능까지 현재 미구현이라고 단정하지 않는다. 최신 연결 여부는 위의
현재 main 상태표와 소스를 확인하고, 원자 실행·권한 한계는 해당 계약 전체를 함께 적용한다.
기존 단계명·식별자·숫자·실패 및 복구 의미를 이 이동으로 변경하지 않는다.

<a id="spom-source-1481-1870"></a>
<!-- spom-source:1481-1870 sha256:b18f58d2b6b27e9fd1e36a9fa831bc802e039bbe2d1c649994e46cfc4b50e994 -->

### 6.6 `PortfolioSizingSnapshot`, `BucketSelectionRequest`와 `CandidateAssignment`

```ts
interface PortfolioExposureSnapshot {
  virtualNetWorthKrw: number;
  cashKrw: number;
  bucketExposureKrw: Record<StrategyBucket, number>;
  unassignedExposureKrw?: number; // positive only; omit when no unassigned holdings
  symbolExposureKrw: Array<{
    market: Market;
    symbol: string;
    exposureKrw: number;
  }>;
  marketExposureKrw: Record<string, number>;
  sectorExposureKrw: Record<string, number>;
  countryExposureKrw: Record<string, number>;
  currencyExposureKrw: Record<string, number>;
  pendingBuyExposureKrw: number;
  pendingSellExposureKrw: number;
}

type PendingPortfolioActionInput = {
  planId: string;
  planHash: string;
  planEventId: string;
  planEventHash: string;
  actionId: string;
  actionExecutionTargetHash: string;
  market: Market;
  symbol: string;
  remainingNotionalKrw: number;
  asOf: string;
} &
  (
    | {
        side: "BUY";
        openingCapacityReservationId: string;
        openingCapacityReservationHash: string;
      }
    | {
        side: "SELL";
        remainingQuantity: number;
        priceEvidenceRef: string;
      }
  );

interface PortfolioSizingSnapshot {
  portfolioSnapshotId: string;
  portfolioId: string;
  portfolioVersion: string;
  policyHash: string;
  asOf: string;
  virtualPortfolio: VirtualPortfolio;
  valuationInputs: Array<
    | {
        kind: "mark_price";
        market: Market;
        symbol: string;
        priceKrw: number;
        evidenceRef: string;
        evidenceAsOf: string;
      }
    | {
        kind: "fx_rate";
        baseCurrency: string;
        quoteCurrency: "KRW";
        rate: number;
        evidenceRef: string;
        evidenceAsOf: string;
      }
  >;
  pendingActionInputs: PendingPortfolioActionInput[];
  exposureSnapshot: PortfolioExposureSnapshot;
  exposureSnapshotHash: string;
  portfolioSnapshotHash: string;
}

interface BucketSelectionRequest {
  requestId: string;
  requestHash: string;
  cycleId: string;
  triggerIdentity: string;
  triggerRef: string;
  portfolioId: string;
  portfolioSnapshotId: string;
  portfolioSnapshotHash: string;
  policyHash: string;
  asOf: string;
  bucket: StrategyBucket;
  gapBasis: "min" | "entry_floor";
  gapKrw: number;
  availableSlots: number;
  maximumAdditionalExposureKrw: number;
  evidenceCutoffAt: string;
  createdAt: string;
}

interface CandidateSizingInputRecord {
  sizingInputRecordId: string;
  requestId: string;
  portfolioId: string;
  portfolioSnapshotId: string;
  portfolioSnapshotHash: string;
  policyHash: string;
  asOf: string;
  market: Market;
  symbol: string;
  bucket: StrategyBucket;
  scoringModelVersion: string;
  sizingAlgorithmVersion: string;
  selectionScore: number;
  exposureKeys: {
    sector: string;
    country: string;
    currency: string;
    classificationEvidenceRef: string;
  };
  featureInputs: Array<{
    featureDefinitionRef: string;
    value: number | boolean | string;
    evidenceRefs: string[];
  }>;
  exposureCapInputs: {
    bucketRemainingKrw: number;
    symbolRemainingKrw: number;
    sectorRemainingKrw: number;
    countryRemainingKrw: number;
    currencyRemainingKrw: number;
    cashAvailableKrw: number;
  };
  liquidityInput: {
    averageDailyNotionalKrw: number;
    maximumParticipationRatio: number;
    maximumLiquidityNotionalKrw: number;
    evidenceRefs: string[];
  };
  executionCostInput: {
    modelVersion: string;
    side: "BUY" | "SELL";
    referenceNotionalKrw: number;
    participationRate: number;
    fillPriceRule: "current_candidate_last_price";
    feeBps: number;
    taxBps: number;
    halfSpreadBps: number;
    slippageBps: number;
    fillRatio: number;
    allowFractionalShares: boolean;
    maxVolumeParticipationRate: number;
    minLiquidityFillRatio: number;
    rejectStaleLiquidity: boolean;
    marketImpactBpsPerParticipationRate: number;
    estimatedCostKrw: number;
    evidenceRefs: string[];
  };
  sizingInputHash: string;
  createdAt: string;
}

interface CandidateAssignment {
  assignmentId: string;
  requestId: string;
  sizingInputRecordId: string;
  portfolioId: string;
  portfolioSnapshotId: string;
  portfolioSnapshotHash: string;
  policyHash: string;
  asOf: string;
  market: Market;
  symbol: string;
  bucket: StrategyBucket;
  eligibility: "eligible" | "watch" | "blocked";
  minWeightRatio: number;
  targetWeightRatio: number;
  maxWeightRatio: number;
  maximumNotionalKrw: number;
  selectionScore: number;
  reasonCodes: string[];
  evidenceRefs: string[];
  scoringModelVersion: string;
  sizingInputHash: string;
  sizingOutputHash: string;
  assignmentHash: string;
  createdAt: string;
}

interface CandidateAssignmentSetRecord {
  candidateAssignmentSetId: string;
  candidateAssignmentSetHash: string;
  requestId: string;
  requestHash: string;
  availableSlots: number;
  requestAllocationBudgetKrw: number;
  orderedAssignments: Array<{
    assignmentId: string;
    assignmentHash: string;
    eligibility: "eligible" | "watch" | "blocked";
    selectionScore: number;
    market: Market;
    symbol: string;
  }>;
  selectedAssignments: Array<{
    assignmentId: string;
    assignmentHash: string;
    selectedRank: number;
    reservedMaximumNotionalKrw: number;
  }>;
  totalReservedMaximumNotionalKrw: number;
  createdAt: string;
}
```

`watch`와 `blocked` candidate는 주문 후보가 될 수 없다. required evidence가 없거나
stale이면 높은 score가 있더라도 `eligible`로 승격하지 않는다.
`PortfolioSizingSnapshot`은 해당 시점의 paper `VirtualPortfolio`, 실제 사용한 mark/FX
값과 provenance, 계산된 exposure payload를 canonical form으로 append-only 저장한다.
symbol exposure는 raw symbol string으로 keying하지 않고 `(market, symbol)` tuple을 market,
symbol 순서로 정렬하며 duplicate tuple을 거절한다.
- `exposureSnapshotHash`는 hash field를 제외한 complete exposure payload에서 계산한다. map
  key는 lexical order, symbol exposure는 market/symbol order로 canonicalize하고 duplicate와
  non-finite number를 거절한다. resolver는 virtual portfolio와 valuation input에서 exposure를
  다시 계산해 payload와 hash가 모두 같은지 검증한다.
- `portfolioSnapshotHash`는 snapshot ID와 자기 hash를 제외하고 independently verified
  `exposureSnapshotHash`를 포함한 complete snapshot payload에서 계산하며 ID는 hash에서
  파생한다. virtual portfolio의 position/order array는 stable domain key로 정렬한다. valuation
  input은 mark를 market/symbol, FX를 base/quote currency로 정렬하고 duplicate logical identity를
  거절하며 mark는 exact `(market, symbol)` position, FX는 exact currency pair에만 적용한다.
  downstream consumer는 두 hash를
  독립 재구성하기 전에는 snapshot을 sizing 또는 risk input으로 사용하지 않는다.
- `pendingActionInputs`는 nonterminal approved/executing plan의 remaining action만 포함하고 exact
  plan/event ID/hash, execution target과 BUY reservation 또는 SELL quantity/price origin을 직접
  보존한다. resolver는 plan event chain, fill cumulative와 reservation chain을 replay해 remaining
  amount를 재계산하고 market/symbol/side 순으로 canonicalize한다. `pendingBuyExposureKrw`와
  `pendingSellExposureKrw`는 이 입력의 합으로만 파생하며 pending input이 빈 경우에만 둘 다 0일
  수 있다. unresolved/corrupt action, duplicate logical action 또는 total mismatch는 snapshot을
  sizing에 사용하지 않고 fail-closed한다.
request의 snapshot ID/hash가 이 immutable record와 일치하지 않으면 selection과 sizing을
거절한다.
- `requestHash`는 request ID/hash/createdAt을 제외한 complete payload에서 계산하고 request ID는
  hash에서 결정론적으로 파생한다. request는 cycle의 exact trigger identity/ref를 직접
  보존하며 같은 payload retry는 기존 record를 반환한다. `(cycleId, bucket)` unique key가 같은
  두 번째 payload나 같은 ID의 hash collision은 거절한다.
- selector는 sizing 전에 exact policy와 independently verified portfolio snapshot에서 current
  exposure, min/entry-floor gap, available slot, cash/exposure cap을 다시 계산한다. derived
  `gapBasis`, `gapKrw`, `availableSlots`, `maximumAdditionalExposureKrw`, cutoff와 request full
  digest가 저장값과 정확히 같지 않으면 request를 소비하지 않는다.
`CandidateSizingInputRecord`는 policy/snapshot/request scope, versioned feature value와 evidence,
exposure cap, liquidity 및 execution cost model input 전체를 canonical form으로 append-only
저장한다. `sizingInputHash`는 record ID, hash와 생성 시각을 제외한 이 전체 payload에서
계산한다. assignment는 exact record ID/hash를 직접 보존하며 record가 resolve되지 않거나
scope/hash가 다르면 생성하지 않는다.
execution cost input은 현재 `PaperExecutionPolicy`의 fill rule, fee, tax, spread, slippage,
fill/fractional/liquidity/staleness 및 market-impact parameter 전체와 side, reference notional,
participation rate를 보존한다. `estimatedCostKrw`는 이 저장값만으로 독립 재계산하며 runtime
default로 누락 parameter를 보충하지 않는다.
feature/evidence ref와 분류 metadata는 모두 resolve되어야 하며 array와 exposure key는
canonical order로 정규화한다. sizing algorithm version이 다르면 같은 input으로 취급하지 않는다.
- `sizingInputRecordId`와 `assignmentId`는 서로 다른 domain prefix와
  request/market/symbol에서 각각 결정론적으로 파생한다. exact retry는 기존 record를
  반환하고 같은 identity에 다른 sizing input hash 또는 assignment payload를 쓰는 요청은
  fail-closed한다.
`sizingOutputHash`는 계산된 min/target/max weight range와 최대 notional을 canonicalize해
만든다. selector mandate의 range는 assignment 값과 정확히 같아야 하며 input/output hash
검증을 모두 통과해야 한다. assignment의 portfolio/snapshot/policy/as-of scope는 request를
읽지 못해도 독립 검증할 수 있도록 직접 저장하고, resolve 가능한 request와도 일치해야 한다.
- `assignmentHash`는 `assignmentId`, `assignmentHash`, `createdAt`을 제외한 assignment 전체
  payload에서 계산한다. reason/evidence ref는 canonical sort하고 duplicate를 거절하며
  eligibility, score, model version, input/output hash와 range/notional을 모두 digest에 포함한다.
  append와 mandate 발급 전에 독립 rehash가 일치해야 한다.
- mandate resolver는 exact selection policy와 sizing input의 feature/evidence를 다시 읽어
  required evidence freshness 및 모든 hard gate를 deterministic하게 재평가한다. 재계산한
  `eligibility`, `selectionScore`, `reasonCodes`가 assignment와 정확히 같지 않거나 assignment가
  `eligible`이 아니면 input/output/assignment hash가 유효해도 mandate를 만들지 않는다.
- 한 request의 모든 assignment를 저장한 뒤 immutable `CandidateAssignmentSetRecord`를 한 번
  seal한다. eligible 우선, selection score 내림차순, market/symbol canonical tie-break로 전체를
  정렬하고 selected assignment는 앞의 `min(availableSlots, eligibleCount)`개와 정확히 같아야
  한다. `requestAllocationBudgetKrw = min(gapKrw, maximumAdditionalExposureKrw)`로 고정하고
  rank 순서로 각 assignment의 individual maximum과 remaining request budget 중 작은 값을
  reserve한다. 모든 positive reservation의 합은 request budget 이하여야 하며 0 reservation은
  selected list에서 제외한다. set hash는 ID/hash/createdAt을 제외한 complete payload에서 계산하고 ID는 hash에서
  파생하며 request당 두 번째 set을 거절한다.
- deterministic selector mandate는 exact set ID/hash와 selected rank를 보존한다. resolver는
  request의 verified `availableSlots`, ordered assignment hashes와 top-N을 독립 재계산하고 해당
  assignment가 selected list의 같은 rank에 있을 때만 발급한다.
  assignment의 individual cap과 set의 `reservedMaximumNotionalKrw` 중 작은 값을
  `maximumOpeningNotionalKrw`로 고정하고 request 전체 reservation 합도 다시 검증한다.
  mandate repository는
  `candidateAssignmentId`를 unique consumption key로 사용해 같은 assignment의 두 번째 mandate를
  거절한다. set의 reservation을 실제 mandate로 소비할 때 current `BucketOpeningCapacityState`를
  다시 계산하고 manual reservation과 같은 slot/notional ledger를 expected version으로
  compare-and-swap한다. set seal과 mandate activation 사이에 manual 또는 다른 selector가 용량을
  먼저 차지했으면 transaction을 rollback하고 stale request로 재평가한다.

#### Selector mandate와 supplied assignment/set 연결

`resolveSelectorMandateAssignmentBinding`은 supplied mandate/request/sizing input과 assignment 전체/set을
독립 파싱한다. 전체 assignment로 set의 ordering/top-N/금액 배분을 다시 계산하고, mandate가 가리키는
assignment가 `eligible`이면서 같은 exact set ID/hash, assignment ID/hash와 selectedRank로 선택됐는지
확인한다. 대상 assignment의 exact sizing input ID/hash·score와 request scope도 기존 resolver로 검사한다.
Opening mandate는 BUY sizing input만 허용한다.

Mandate의 portfolio/policy/bucket/market/symbol, scoring model/score와 min/target/max weight는 해당
assignment와 같아야 한다. Canonical reasonCodes/evidenceRefs 배열도 전체가 같아야 하며 다른 근거나
사유의 교체·추가를 허용하지 않는다. maximumOpeningNotionalKrw와 reservedMaximumNotionalKrw는 individual cap과
set의 selected reservation 중 작은 금액과 정확히 같아야 한다. Mandate asOf는 request asOf보다
과거일 수 없고 evidenceAsOf는 assignment asOf와 같으며 생성은 set 생성 이후여야 한다.

이는 supplied content binding이다. 원본 저장소의 completeness, 실제 required evidence/hard gate와
최종 sizing 재계산, current capacity reservation ID/hash 및 global slot ordinal은 아직 증명하지 않는다.
Request-local selectedRank를 global reservedSlotOrdinal로 추정하지 않으며, slot 값이 content로 유효해도
capacityReservationAuthority는 not_verified다. Writer/activation/Risk 경로를 자동 연결하지 않고 실제
source resolver와 공용 ledger transaction에서 이 검사를 소비하는 단계는 후속이다. 기존 contract,
artifact, API와 기본값 변경 없이 새 소비 경로를 제거하는 코드 rollback이 가능하다.

`resolveStoredSelectorMandateAssignmentBinding`은 baseDir/mandateId만 받아 실제 mandate repository의
durable history에서 selector record를 찾고 해당 잠금을 해제한다. 이어 assignment repository가
이미 유지하는 request → snapshot → sizing → assignment 잠금 안에서 exact set, 같은 request의
assignment 전체, request 및 대상 sizing 원본을 찾는다. 별도 supplied source 목록이나 override를
받지 않는다. Assignment repository의 callback은 기존 history와 함께 이미 잠근 inputs/requests를
전달하며 각 원본의 observation lease는 callback 종료 후 만료된다. 기존 한 인자 consumer는 유지된다.

Mandate 생성 시각이 mandate의 durable observation보다 미래이거나 실제 set commit이 mandate 생성보다
늦거나, set/assignment/request/sizing 원본이 없거나, 전체 이력이
손상되면 거절한다. Set 배분, mandate scope/rank/score/range/금액/사유/근거는 위 content binding을
재사용해 검사한다. 결과에는 실제 set/assignment/sizing origin, 두 단계 observation과 generation 및
binding assessment hash를 보존한다. 재조회 시 immutable binding은 같지만 관측 시각과 observation
hash는 새로 계산된다. Mandate 잠금과 candidate source 잠금을 중첩하지 않으므로 이 결과는 현재
activation의 원자적 승인 또는 current ledger transaction이 아니다. Commit timestamp는 marker flush
완료의 생성 전 영수증이 아니므로 sourceBeforeCreationReceipt는 not_recorded다. Eligibility/final sizing,
reservation/slot 권한 및 currentExecutionAuthority는 여전히 부여하지 않는다. 저장 형식, writer 또는
운영 activation 변경은 없으며 코드 rollback에 기존 원본 데이터 변환/삭제가 없다.

`resolveStoredSelectorOpeningCapacityMandateOrigins`는 portfolio의 실제 capacity event journal을
전체 재생한 뒤 모든 selector root의 실제 발급 journal을 한 번 관측한다. 발급 record의 전체
request/snapshot/sizing/assignment 원본과 저장 receipt를 재검증하고 root의 ID/hash, portfolio/policy/bucket,
ledger version, 전역 slot, 정확한 예약 금액, set/assignment 참조 및 신규 slot 점유를 대조한다.
발급 commit은 root asOf보다 엄격히 앞서야 하며 같은 millisecond 또는 나중에 저장된 발급은 거절한다.
공통 record/event 비교는 `resolveSelectorOpeningCapacityReservedRecordBinding`을 사용하되 이 순수
함수만으로 actual source를 인증하지 않는다. Supplied full binding도 같은 비교 함수를 사용한다.
이어 `bound_to_mandate`의 mandate ID를 모아 한 번에 stored source 대조를 실행한다.
Root의 portfolio/policy/bucket, reservation ID/hash, 전역 slot, 금액과 set/assignment 참조를
mandate와 정확히 비교한다. Request-local rank는 slot으로 사용하지 않는다. Set commit은 root asOf
이하여야 하고 root commit은 mandate 생성 이하여야 하며 mandate 생성은 bound event asOf 이하여야 한다.
각 source 관측 후 journal을 다시 잠가 generation 불변과 관측 시각 순서를 검사하므로 중간 append는
전체 재조회 대상으로 거절한다. Event 잠금을 source 잠금과 중첩하지 않는다.

반환값은 root/bound event storage origin, 실제 issuance origin/commit 및 mandate/candidate sources,
발급 journal generation/관측 시각·검증 root 수와 미검증 event ID를 보존한다. Binding hash에도 발급
commit hash를 포함한다. Unbound root도 발급 원본은 필수지만 mandate 결속 완료로 취급하지 않으므로
미검증 event 목록에 남는다. Manual event 및 fill/release successor도 별도 검증 대상으로 남긴다.
Root는 portfolio 기준 전체 정책·종료 이력을 포함한다. 기존 발급 없는 예약을 자동 변환하거나
추정 발급하지 않으며 실제 발급이 없거나 손상되면 이후 mandate/fill/terminal/pending 소비도 거절한다.
발급 원본용과 mandate binding용 source batch는 각각 한 번이고 root 수에 따라 반복하지 않는다.
이는 역사적 source-content binding이며 실제 발급 보존을 검증하더라도 공용 slot/budget CAS,
활성화 및 eligibility/최종 sizing은 검증하지 않는다. `rootAllocationAuthority=not_verified`,
`currentExecutionAuthority=not_granted`, `sourceBeforeCreationReceipt=not_recorded`를 유지한다.
관측 시각/hash는 재조회마다 달라질 수 있다. Schema, writer 및 기본값 변경 없이 소비 경로를 제거하는
코드 rollback이 가능하고 기존 journal 변환/삭제는 필요 없다. 새 검증 전에 source-bound 발급과
root를 올바른 순서로 보존해야 하며, 발급 없는 과거 root는 명시적 복구 정책 없이는 새 consumer에
수용되지 않는다. Rollback은 이 필수 원본 검사를 제거하므로 안전 경계가 약해짐에 유의한다.

`resolveStoredSelectorMandateAssignmentBindings`는 중복 없는 mandate ID 목록을 받아 mandate와
request/snapshot/sizing/assignment 원본을 각각 한 번 관측하고 ID 및 request별 index를 만든다.
단일 ID 함수는 같은 batch 경로를 사용한다. `createSelectorMandateAssignmentBindingResolver`는 실제
선택 집합별 전체 배분을 한 번 재생한 뒤 독립 파싱·동결한 원본과 private index만 캡처한다. 각 mandate의
정확한 내용·sizing 대조는 생략하지 않는다. 호출자 원본 변경이나 caller 제공 검증 표시는 재사용 근거가 아니다.
최종 bindingsHash는 각 root/event commitHash와 source assessmentHash의 ordered 목록을 hash하여
동일 set 전체를 binding마다 다시 직렬화하지 않는다. 이 변경은 관측/재생 호출 중복을 줄이며 저장소 내부
전체 replay 자체를 생략하거나 총 시간의 선형 증가를 보장하지 않는다. 실제 대규모 시간 측정은 별도다.

`resolveStoredSelectorOpeningCapacityFillOrigins`는 selector root/mandate/assignment 원본 대조 후
각 `partially_consumed`/`consumed_by_position`의 paper fill ID를 실제 plan execution event에 연결한다.
`storedOpeningCapacityFillOrigins.ts`의 private 공통 처리에서 수동 예약과 같은 Risk/plan/가격/체결
원본 검증을 수행한다. 기존 수동 함수 import와 반환 형태는 re-export로 유지하고 호출자가 검증된
source 객체나 source resolver를 주입하는 API는 추가하지 않는다.

감소한 예약 원금은 actual fill의 filledNotionalKrw와 정확히 같아야 하며 수수료를 포함한 net cash와
혼동하지 않는다. BUY, portfolio/policy/bucket/market/symbol/mandate, execution target, Risk 원본 및
판단 당시 active mandate 상태를 검증한다. 실제 plan/mandate receipt가 있으면 source prefix와
정확히 대조하고, receipt가 없는 Risk의 생성 전 가용성을 소급 증명하지 않는다. Plan predecessor와
capacity predecessor는 Risk 판단보다 먼저, execution event는 capacity 소비 평가보다 먼저 기록돼야 한다.
한 portfolio 내 중복 fill/Risk 사용을 거절하고 source 조회 후 capacity generation이 변하면 실패한다.

반환값에는 actual execution/fill/Risk/plan/가격 origin과 당시 mandate 상태를 남긴다. Manual 또는
아직 검증하지 않은 successor는 미검증 event 목록에 남기며 terminal 이후에도 과거 체결을 재검증한다.
이 경로는 root 발급·slot/budget CAS, 실제 정산 및 resulting position, Risk policy/rule 원본, 가격 freshness/trust와
현재 실행 권한을 승인하지 않는다. Risk/체결 writer·운영 기본값·저장 형식 변경은 없으며
`currentExecutionAuthority=not_granted`, `finalSizing=not_performed`를 유지한다. 기존 수동 entrypoint와
공통 구현을 함께 되돌릴 수 있고 기존 artifact 변환/삭제가 필요 없다.

<!-- /spom-source -->

<a id="spom-source-2337-2722"></a>
<!-- spom-source:2337-2722 sha256:31b290d197a0725e561142ef537f13433202f019cd9e90491183daf458a7f676 -->

## 7. Bucket별 종목 선택 정책

모든 종목을 하나의 공통 ranking으로 줄 세우지 않는다. 공통 lifecycle/freshness/
liquidity gate를 통과한 뒤 bucket별 feature set과 threshold를 적용한다.

| Bucket | 주요 목적 | 우선 evidence | 배제 또는 감점 조건 |
| --- | --- | --- | --- |
| `long_term` | 완만한 장기 성장과 자본 보존 | 장기 추세 지속성, realized volatility, drawdown, liquidity, 재무 안정성 | 불충분한 장기 이력, 높은 구조적 변동성, 필수 재무 evidence 누락 |
| `swing` | 수주 단위 추세 포착 | 중기 momentum, volume confirmation, trend persistence, gap risk | 약한 추세, 과도한 gap/impact, stale signal |
| `short_term` | 수일 단위 전술 기회 | 단기 momentum, 거래대금, 변동성 범위, 명확한 exit distance | 낮은 유동성, 손익비 부족, 이벤트 불확실성 |
| `intraday` | 당일 변동 활용 | intraday interval, spread, participation, volume, market impact | daily-only data, stale quote, 당일 청산 근거 부족 |
| `hedge` | 전체 하방 노출 감소 | downside exposure reduction, correlation evidence, hedge cost | gross만 늘리는 hedge, metadata 누락, 비용 상한 초과 |

### 7.1 Evidence 단계

현재 가격·거래량 snapshot만으로 검증 가능한 범위와 추가 source가 필요한 범위를
분리한다.

1. `market_technical`
   - 수익률, realized volatility, drawdown, trend persistence, volume과 liquidity
   - 현재 historical ingestion으로 계산 가능한 범위
2. `fundamental_quality`
   - 매출·이익·현금흐름 안정성, 부채, 배당 지속성 같은 장기 품질 evidence
   - provenance가 확인된 별도 read-only source contract 필요
3. `portfolio_fit`
   - 기존 position과의 sector/country/currency correlation 및 concentration 영향
4. `execution_fit`
   - spread, 예상 participation, slippage와 market impact

`long_term` policy가 `fundamental_quality`를 required로 선언한 경우 해당 source가 없는
candidate는 `unknown` 또는 `blocked`로 남긴다. 가격 상승만으로 기업 안정성을
추정하지 않는다.

### 7.2 Score와 sizing 분리

`calculateMarketTechnicalCandidateFeatures`의 `market_technical_features.v1`은 supplied historical
snapshot의 순수 계산 분할이다. 단일 market/symbol/interval, 명시적 windowStart/asOf,
minimumObservationCount(2~4096), maximumAgeSeconds를 받아 다음 6개 versioned feature를 만든다.

| Feature definition | 계산·단위 |
| --- | --- |
| `market_technical.window_return_ratio.v1` | 마지막/첫 last price의 변화 비율 |
| `market_technical.observation_return_population_stddev.v1` | 인접 last price 단순 수익률의 모집단 표준편차; 연율화 없음 |
| `market_technical.maximum_last_price_drawdown_ratio.v1` | 각 last price 이전 누적 최고값 대비 최대 하락 비율 |
| `market_technical.positive_observation_return_ratio.v1` | 양수인 인접 수익률 수 / 전체 인접 수익률 수; 보합은 양수 아님 |
| `market_technical.average_bar_volume.v1` | 제공된 bar volume의 산술평균 |
| `market_technical.average_bar_last_price_notional_krw.v1` | 제공된 bar의 lastPriceKrw × volume 산술평균; 실제 체결 거래대금 아님 |

가격은 lastPriceKrw를 사용하며 optional close/OHLC로 대체하지 않는다. 양수 safe-integer last price,
모든 bar의 nonnegative safe-integer volume과 safe-integer price×volume을 요구한다. 평균 합계는
BigInt로 계산해 개별 값은 안전하지만 합이 safe integer를 넘는 경우의 손실을 피한다. Numeric feature는
finite·음의 0 없음이 필요하다. 부족한 관측, 누락 volume, 잘못된 수치·Unicode 식별자·qualified timestamp,
mixed scope/interval, duplicate ID 또는 같은 instant, window 밖/미래 observedAt과 stale latest는 거절한다.
Maximum age 경계는 포함한다. Snapshot createdAt은 observedAt 이상이어야 하지만 과거 이력의 나중 생성
시각일 수 있다. CreatedAt이 역사적 asOf 뒤인 입력을 계산할 수 있다는 사실은 point-in-time availability를
증명하지 않는다.

계산은 snapshot을 observedAt 순서로, sourceRefs/riskTags를 canonical 순서로 복제 정렬하고 입력을
변경하지 않는다. Input hash는 model version·scope·window·limit 및 complete normalized snapshot을
결속한다. 각 source snapshot의 ID/전체 hash를 반환하며 6개 feature의 evidenceRef는 같은 full input hash에서
파생한다. Output hash는 모든 반환 payload를 결속하고 결과는 deep-freeze한다. 이 reference는 계산 입력의
identity일 뿐 durable evidence artifact의 존재·원본 신뢰도·검증 완료를 뜻하지 않는다.

Daily/intraday interval은 scope와 hash에 보존한다. 누락 session/bar를 채우거나 calendar completeness,
동일 간격, source trust, adjusted-price/FX provenance, spread/실제 execution fit 또는 fundamental quality를
추론하지 않는다. 2개 관측의 변동성 0도 충분한 변동성 evidence라는 뜻은 아니다. 실제 원본 저장소의 전체
검증, feature evidence 저장/resolve, bucket policy의 required evidence·hard gate 및 scoring은 후속이다.
현재 함수는 selectionScore/eligibility를 만들지 않고 candidate input writer·runner·Risk에 연결하지 않는다.

`MarketTechnicalCandidateEvidenceRecord`는 이 계산의 전체 canonical input과 output을 함께 보존하는
재생 가능한 content contract다. `market_technical_candidate_evidence.v1`은 선언된 sourceContractId,
calculationInput, calculation, evidenceRef와 createdAt을 가진다. EvidenceHash는 자기 자신만 제외한
전체 record(생성 시각 포함)를 결속하며 evidenceRef는 기존 계산 input identity를 유지한다. 같은 input의
source contract 선언 또는 createdAt이 다르면 reference는 같아도 record hash는 다르므로 저장소의
exact retry로 자동 취급할 수 없다. CreatedAt은 asOf 및 포함된 모든 snapshot materialization 시각
이상이어야 한다. 과거 asOf 이후 생성된 이력을 포함할 수 있지만 point-in-time availability를 뜻하지 않는다.

Factory는 기존 계산기의 공용 normalizer로 snapshot/sourceRef/riskTag 순서를 정규화하며 계산식과
기존 v1 input/output hash 정의는 변경하지 않는다. Parser는 모든 지표를 재실행하고 canonical input,
모든 output/source hash, definition/value/ref, model version과 record hash 전체를 비교한다. 공격자가
틀린 지표의 output hash와 record hash를 함께 다시 계산해도 거절한다. 비정규 record 순서를 읽으면서
조용히 정렬하지 않으며 unknown field와 미지원 계산 model도 거절한다. 반환 내용은 deep-freeze한다.

`resolveMarketTechnicalCandidateSizingFeatures`는 sizing input과 evidence record를 독립 파싱·재생한 뒤
market/symbol/asOf instant와 생성 순서를 대조하고 6개 feature의 value 및 evidenceRefs가 정확히 같은지
확인한다. 그 외 feature나 score, 분류, exposure/liquidity cap, cost 및 sizing 값은 검증하지 않는다.
SourceContractId는 선언이며 실제 provider/file provenance 검증이 아니다. 이 분할은 파일 저장이나
원본 history의 complete read, required-evidence/hard-gate 정책, assignment/mandate 발급, Risk·runner
연결을 추가하지 않는다. Parser 또는 feature binding 성공을 candidate eligibility로 사용하면 안 된다.
기존 API·artifact 형식 변경은 없고 신규 content contract는 미연결 상태라 코드 rollback에 데이터 변환이 없다.

Historical 원본 관측 분할은 `FileHistoricalMarketSnapshotStore.withDurableVerifiedHistory`다.
저장소 append와 Yahoo/Toss historical ingest의 dataset 교체는 같은 per-file exclusive lock을 사용하고
검증 consumer 완료까지 잠금을 유지한다. 기존 `readAll`/`readUpTo`의 non-locking 조회와
corruptLineCount 계약은 유지한다. CLI의 dataset 교체 의미도 유지하되 완전히 쓴 임시 파일을 fsync한
뒤 rename으로 게시한다. 게시 전 write/fsync/rename 실패는 이전 source를 유지하고 실패한 임시 파일은
명시적 점검용으로 남긴다. Rename 이후 directory sync 실패는 새 dataset이 남을 수 있는 불확실한
결과이며 성공으로 바꾸지 않는다. Source append 성공만으로 durable observation이 발급되지는 않는다.
Recursive mkdir 이후에는 관측뿐 아니라 append/replace 작성 경로도 root부터 데이터 디렉터리까지
상위 directory chain을 먼저 sync한다. 지원되는 sync에서 실패하면 lock 획득이나 source 게시 전에
중단하므로 새 중첩 경로의 directory entry를 동기화하지 않고 dataset 성공을 반환하지 않는다.

새 관측 경로는 실제 전체 파일의 UTF-8 bytes와 strict snapshot schema, 정규 문자열·수치,
qualified timestamp/생성 순서, duplicate snapshot ID 및 torn final line을 검증한다. Corrupt suffix를
건너뛰거나 query/limit으로 숨기지 않는다.
검증 경로는 빈 줄·공백 줄도 record 오류로 거절하고 마지막 개행의 split sentinel만 제외한다.
0바이트 dataset과 정상 CRLF record는 허용한다. 기존 조회는 빈 줄을 계속 무시하므로 과거 Yahoo의
개행 한 줄짜리 빈 dataset도 조회 가능하지만 새 strict 관측에서는 거절하며 자동 정규화하지 않는다.
원본 descriptor와 directory를 sync한 뒤 같은 descriptor의 bytes 및 재개방한 path의
file identity/size/mtime/ctime를 대조한다. 파일이 없으면 directory sync 후
부재를 재확인하며 dataset을 만들지 않는다. 관측된 모든 record createdAt은 observedAt 이하여야 한다.
Volume 완전성·가격/volume safe integer·동일 instant 중복 등 feature별 조건은 계산기가 별도로 검증한다.

Callback 동안만 유효한 private WeakMap lease와 `recordCount`, complete recordsHash(생성 시각 포함),
observedAt을 반환한다. 저장된 관측값은 이후 append/restart에도 실제 prefix count/hash/시각을 재검증하며,
prefix 교체·삭제·createdAt 변경과 미래 관측값을 거절한다. Clone이나 callback 종료 후 참조는 lease가
아니다. Consumer 또는 lock release가 실패해도 lease는 만료한다. Lock은 monotonic timeout 안에서
exclusive open의 EEXIST 및 Windows EPERM만 재시도하고 초기화 실패·abandoned/replaced token은
자동 삭제하지 않는다. 재진입은 같은 lock과 경합하므로 consumer는 전달받은 history를 재사용해야 한다.

이는 지정된 local source의 관측이며 provider 신뢰도, 과거 시점의 availability, calendar completeness,
FX/adjustment provenance나 candidate eligibility를 증명하지 않는다. 잠금은 이 저장소와 연결한 ingest
writer의 협력 규약이며 외부에서 직접 파일을 수정하는 것을 OS 권한으로 금지하지 않는다. 관측 전/중
교체는 byte/identity 검증으로 거절하고 저장된 prefix는 후속 사용 시 다시 확인해야 한다. Windows의
directory sync EPERM 제한은 기존 저장소와 같으며 실제 전원 장애 복구 보장은 검증하지 않았다.
새 source 관측은 fsync와 lock을 쓰므로 조회 전용 MCP에 연결하지 않는다. Evidence 레코드의 실제
source-window 결속·저장과 bucket policy/score/sizing 연결은 후속이다. 기존 JSONL 형식과 safe defaults는
유지하며 rollback 시 구버전 writer를 새 관측 consumer와 섞지 않아야 한다. 실패 lock/임시 파일은
writer 부재와 원본 일관성을 확인한 후 명시적으로 복구해야 하며 자동 stale lock 회수는 제공하지 않는다.

원본과 지표의 연결 분할은 `MarketTechnicalEvidenceFileSource.withEvidence`다. 실제 지정된 historical
파일의 strict 관측과 writer lock 안에서 `market/symbol/interval/windowStart/asOf`가 일치하는 모든
record를 추출해 기존 지표 evidence factory로 전달한다. Query는 snapshots를 받지 않으며 caller가
선택한 배열이나 상위 N개로 source를 대체하지 않는다. 양 끝 시각을 포함하고 최소 관측 수·4096개
상한·freshness·중복 instant·가격/volume 검증은 기존 calculator normalizer를 사용한다. Scope 밖
record도 파일 전체 검증에서 제외하지 않는다. 실제 원본은 보존하고 계산 입력의 record/sourceRef
순서만 기존 규칙으로 정규화한다. 비동기 잠금 대기 전에 query를 복제한다.

`createMarketTechnicalEvidenceFromHistory`는 live history lease를 요구하고 관측 이후의 실제 생성
시각으로 evidence를 만든다. 생성 clock이 source 관측보다 역행하면 거절한다. 반환되는
`market_technical_source_binding.v1`은 complete evidence와 전체 source prefix 관측값을 묶는다.
`resolveMarketTechnicalEvidenceSourceBinding`은 실제 live history에서 저장 prefix를 검증하고 그
prefix의 같은 query 구간을 다시 추출·정규화해 complete calculationInput과 비교한다. 일부 bar 누락,
가격 바꾸기와 evidence 전체 rehash도 실제 source window와 다르면 거절한다. Evidence 생성 시각은
source 관측 시각 이상이어야 한다. 이후 append된 이력은 예전 receipt의 구간에 소급 포함하지 않으며
prefix 안의 관련 없는 record도 삭제·수정되면 hash 검증이 실패한다.

File source는 consumer가 끝날 때까지 writer lock을 유지하고 실제 history도 함께 전달한다. 새 관측
또는 downstream transaction이 필요하면 callback 안의 history를 재사용해야 한다. 종료 후 또는
clone한 history로는 factory/resolver를 사용할 수 없다. 반환 binding 자체는 저장 commit이나 독립
lease가 아니며 supplied receipt의 과거 발급 사실을 인증하지 않는다. 영구 보존에는 실제 source lock
안에서 receipt와 evidence를 함께 commit하고 조회 때 재검증하는 후속 append-only 저장소가 필요하다.
SourceContractId는 여전히 선언이며 provider 신뢰·PIT availability·calendar completeness·FX 검증이나
bucket policy가 선택한 window의 정당성을 증명하지 않는다. 후보 eligibility/score/sizing/실행 권한,
runner 자동 연결과 저장 artifact는 추가하지 않는다. 기존 API·JSONL·지표 v1 계산 형식은 유지하며
새 opt-in 연결 코드의 rollback에는 데이터 변환이 없다. 영구 evidence 저장과 실제 sizing 연결은 후속이다.

영구 보존 분할은 `MarketTechnicalEvidenceFileRepository`의 opt-in
`market-technical-evidence-records.jsonl`이다. `capture`는 query만 받아 실제 historical source에서
binding을 생성하며 supplied evidence/receipt/createdAt append를 제공하지 않는다. Historical source →
evidence log 순서로 잠금을 획득하고 전체 기존 log 검증, 신규 capture, 재시도와 조회 consumer 동안
원본 writer를 막는다. 각 entry는 complete binding, appendStartedAt, previousCommitHash와 entryHash를
보존하고 commit marker는 entryHash, committedAt과 commitHash를 결속한다. Source prefix 및 구간·모든
feature를 매번 재검증하며 log의 strict v1 pair/v2 triple, hash/chain, unique evidenceRef와 시각 순서도 확인한다.

같은 canonical 계산 입력과 sourceContractId의 capture는 최초 binding/createdAt/receipt/commit을
그대로 반환한다. API 입력에 createdAt이 없으므로 새 관측 시각으로 기존 record를 대체하지 않는다.
같은 evidenceRef의 다른 sourceContractId 또는 계산 payload는 collision이다. 이후 구간 밖 source
append는 기존 capture를 변경하지 않으며 새 matching bar로 계산 input hash가 달라지면 새 capture다.
이것은 capture 연산의 멱등성이지 서로 다른 createdAt을 가진 supplied record의 exact retry 승인이 아니다.

Pending 표시를 먼저 동기화하고 entry/commit marker와 신규 v2 completion을 각각 append/fsync한 후에만 pending을 제거한다.
중단된 쓰기, 남은 pending, blank/corrupt/torn line, 잘못된 UTF-8와 hash/시간/원본 불일치는 자동
복구하지 않는다. Pending 제거 이후 directory sync 실패는 complete capture가 남아 있을 수 있으므로
성공을 가정하지 않고 다음 접근에서 전체 source/log를 재검증한다. Commit 시각은 최종 flush 완료
시각이 아니다. 새 durable 관측은 log의 flush와 byte/path identity 재대조 후 callback 동안만 발급한다.
Receipt는 complete origins hash(원본 관측·본문·commit 시각과 hash 포함), count와 observedAt이며
저장 prefix를 이후 재시작/append에서도 재검증한다. Clone·만료된 history는 lease가 아니다.

새 중첩 log 경로는 ancestor chain을 먼저 sync한다. 잠금은 monotonic timeout과 exclusive open의
EEXIST/Windows EPERM 재시도만 허용하고 초기화 실패·foreign/abandoned token은 보존한다. Source와
destination의 직접 경로 중복은 거절한다. 기존 Windows directory sync EPERM 제한과 협력 writer
경계는 유지하며 OS 접근 제어·전원 장애 보장을 추가하지 않는다. `readAll` 결과는 새 lease가 아니므로
downstream 원자적 처리는 `withDurableVerifiedHistory` callback을 사용해야 한다. 기존 API/거래 설정과
runner는 변경하지 않고 새 artifact만 opt-in으로 작성한다. Rollback은 아래 v1/v2 호환성 경계를
따르며 artifact를 자동 삭제하지 않는다. 실제 sizing input의 evidence origin 연결은 아래 resolver가
수행한다. 정책·hard gate·score·배분/주문 실행은 후속이며 저장 성공을 후보 승인이나 source 신뢰 승격으로 쓰지 않는다.

저장된 sizing 입력의 시장 지표 연결은 `CandidateMarketTechnicalFeatureResolver.withResolvedFeatures`다.
Record ID로 실제 candidate sizing input을 읽고, 6개 versioned market feature의 evidenceRef를 실제
market technical evidence log의 unique committed origin에 연결한다. 기존 순수 feature resolver로
market/symbol/asOf instant, 각 definition/value/ref 전체를 재검증한다. 누락·복수·mixed ref나 다른
값은 input 자체를 다시 hash하고 정상 저장했더라도 거절한다. Evidence의 생성 시각뿐 아니라 실제
marker 동기화 이후 관측한 completion 시각이 sizing input createdAt 및 appendStartedAt보다 엄격히
앞서야 한다. 같은 밀리초 시각은 선후관계를 입증하지 못하므로 거절한다. 메모리에서 만든 evidence나
파일에 commit되지 않은 reference는 통과하지 않는다.

Lock 순서는 request → portfolio sizing snapshot → candidate input → historical source → market
technical evidence다. 기존 저장소의 실제 source/원본·hash/시각 재검증을 모두 사용하고 consumer
완료까지 잠금을 유지한다. 현재 evidence capture는 candidate input 저장소에 재진입하지 않으므로
이 순서와 역방향 의존성을 만들지 않는다. Consumer는 같은 source 저장소에 재진입하지 않아야 한다.
선택된 두 origin은 immutable binding으로 반환하며 `getCandidateMarketTechnicalFeatureSources`는
callback 동안만 실제 두 history의 durable 관측을 조회한다. Clone이나 callback 종료/실패 후의
binding은 lease가 아니며 별도 transaction/저장 성공을 인증하지 않는다.

이 연결은 저장된 시장 지표 6개에 한정한다. 나머지 feature, selectionScore/scoring model 지원,
classification·exposure/liquidity cap·execution cost·sizing 계산, 정책의 required evidence/선택 구간,
cutoff/PIT·provider 신뢰 및 eligibility를 평가하지 않는다. Request/portfolio snapshot 원본 검증은
기존 저장소를 사용하지만 active policy/trigger/gap/capacity 재계산을 대신하지 않는다. Runner/Risk나
주문 surface를 자동 연결하지 않으며 input 파일 형식·writer API·거래 기본값은 유지한다.

기존 evidence `committedAt`은 marker 쓰기·fsync 전에 채집한 시각이므로 후보 입력의 availability
근거로 사용하지 않는다. 신규 capture는 `market_technical_evidence_entry.v2`와 기존 commit marker를
먼저 file/directory sync하고, 그 이후의 `observedAt`, entryHash, commitHash를 담은
`market_technical_evidence_completion.v1`을 세 번째 줄로 기록·동기화한다. Completion hash는 세 번째
줄의 complete payload에서 계산하고 다음 entry의 predecessor 및 observation prefix hash에 포함한다.
Reader는 v2의 completion 누락·변조·미래/역행 시각, 다음 append보다 늦은 completion을 거절한다.
Completion 쓰기·동기화 실패와 clock 역행은 pending barrier를 유지한다. 이 증거는 앞의 entry/marker
동기화 완료를 증명하며 completion 자신의 저장 완료나 여러 artifact의 원자 transaction을 뜻하지 않는다.

기존 v1의 2줄 기록은 조회·exact capture retry에서 그대로 반환하고 completion을 소급 추가하지 않는다.
새 resolver는 completion 없는 v1 evidence를 후보 입력의 저장 완료 증거로 거절한다. V1/v2 혼합 이력은
기존 v1 commit hash 또는 신규 v2 completion hash를 predecessor로 이어 독립 검증한다. V1-only reader는
v2를 읽을 수 없으므로 writer보다 먼저 호환 reader를 배포해야 한다. Rollback은 새 capture/consumer를
비활성화하되 v1/v2 reader를 유지하고 기록을 삭제·v1으로 변환하지 않는다. 운영 artifact 변경은 실행하지 않았다.

- `selectionScore`는 같은 bucket 안에서 candidate 우선순위를 정한다.
- score는 target weight를 직접 결정하지 않는다.

점수 계산의 첫 구현은 `candidateScoringModel.ts`의 `weighted_clamped_feature_score.v1`이다.
모델에는 version과 createdAt, 모든 featureDefinitionRef별 양수 weight(최대 1), lowerBound,
upperBound 및 higher/lower-is-better 방향을 명시한다. 임의의 bucket 기본 가중치·threshold를
제공하지 않는다. Feature는 1~128개이며 모델과 입력의 definition 집합이 정확히 같아야 한다.
숫자가 아닌 값, 누락/초과/중복 feature, 중복 evidenceRef, unknown field, non-finite·음의 0,
역전/동일 정규화 구간과 절댓값이 Number.MAX_SAFE_INTEGER를 넘는 값·구간은 거절한다.

계산은 canonical feature 순서로 `(value - lowerBound) / (upperBound - lowerBound)`를 0~1로
제한하고 lower-is-better이면 `1 - normalizedValue`를 사용한다. Weight를 전체 양수 weight 합으로
먼저 나눈 후 normalizedValue와 곱하고, 기여도 합을 최종 0~1 score로 제한한다. 이는 명시된
JavaScript number/IEEE-754 계산 규칙이며 임의의 반올림 정밀도나 부동소수점 수학의 완전 정확성을
주장하지 않는다. 극소 양수 weight는 정규화 전에 곱해 underflow시키지 않는다.

모델 hash와 hash-derived ID는 createdAt을 포함한 complete parameter payload를 결속한다.
Version 문자열은 단독 registry identity나 활성 정책의 모델 선택 증명이 아니다. Factory는 feature와
evidenceRef 순서를 정렬하며 parser는 이미 canonical인 기록만 허용한다. 계산 결과에는 canonical
모델/입력, inputHash, feature별 normalizedValue/normalizedWeight/weightedScore/evidenceRefs 및
outputHash를 보존한다. `parseCandidateSelectionScore`는 모델과 계산을 다시 실행해 전체 결과를
비교하므로 score/기여도/참조를 변조한 뒤 outputHash를 다시 계산한 기록도 거절한다.

이 순수 모델은 source availability/PIT·provider trust, hard gate·eligibility, sizing·allocation,
버킷별 ordering/top-N, active selection policy와 모델의 exact hash 결속을 대신하지 않는다.
모델 exact reference/repository 연결은 아래 분할이 담당하며 실제 sizing input의 selectionScore 재검증은
PR 5의 `resolveStoredCandidateSelectionScore`가 연결한다.
API·artifact writer·기존 정책/거래 기본값 변경은 없으며 코드 rollback에 데이터 변환이 없다.

선택 정책의 모델 연결은 optional `scoringModelRef`의 exact record ID/version/hash다. Ref version은
기존 scoringModelVersion과 같아야 하며 complete selection policy hash/lineage에 포함된다. Ref가 없는
기존 정책의 bytes/hash/ID는 유지하지만 모델을 version label로 찾아 자동 추가하지 않는다.
`resolveSelectionScoringModel`은 실제 repository의 exact selection record에만 모델을 연결하며
ref 없는 정책은 거절한다. 모델 createdAt은 selection policy createdAt 이하여야 하고 모델 terms와
정책 featureDefinitionRefs 집합은 정확히 같아야 한다. 다른 hash/ID/version, 누락·추가 feature와
역전된 생성 시각은 독립 재검증에서 거절한다.

기존 `ImmutablePolicyDependencyRepository`는 optional scoringModels의 모든 기록을 재생하고 duplicate
ID 및 동일 version을 가진 복수 모델을 거절한다. 다른 createdAt/parameter의 모델은 다른 ID라도 같은
version을 재사용할 수 없으며 별도 version을 써야 한다. 등록된 모든 selection policy의 명시적 ref를
constructor에서 검증하므로 사용하지 않는 손상 모델이나 dangling ref도 전체 load를 실패시킨다.
Runtime bucket dependency identity resolution은 명시적 ref가 있을 때만 resolved scoringModel을 반환한다.
이 연결은 이미 존재하는 activation/dependency 검증 경로에 적용되지만 점수 계산·후보 선정은 자동 실행하지 않는다.

실제 파일 loader는 `candidate-scoring-model-records.jsonl`을 기존 의존성 파일들과 함께 읽는다.
모델 파일이 없고 ref도 없으면 기존 빈/legacy load를 유지하며 파일을 만들지 않는다. Ref가 있는데 모델이
없으면 거절하고, append 도중 누락된 모델이 두 번째 generation에 추가된 경우만 기존 제한된 재조회로
다시 검증한다. 모델 prefix의 삭제·교체나 지속적인 corrupt line/duplicate/version collision은 거절한다.
모델에는 legacy lineage backfill을 적용하지 않고 원본 model hash/createdAt을 그대로 검사한다.
빈 scoringModels는 기존 loaded.records의 모양을 유지하도록 생략한다. 기존 loader의 read-only/content
검증이며 새로운 durable lease/잠금·commit marker나 writer를 제공하지 않는다.

바깥 `readConsistentRuntimePortfolioPolicyActivationSnapshot`의 정책·event 재조회 경로도 scoringModels를
동일 generation 비교에 포함한다. 다른 policy/event collection이 append돼도 모델의 삭제·교체·재정렬이
있으면 전체 재조회를 거절한다. Legacy의 생략된 모델 목록은 빈 배열로 비교하며 기존 prefix를 보존한
신규 모델 append만 허용한다. 두 retry 경로 모두 모델 prefix 회귀와 정상 증가를 테스트한다.

배포는 모델을 읽을 수 있는 reader를 먼저 배포하고 모델 record를 준비한 뒤 이를 참조한 새 selection
policy를 활성화하는 순서다. 오래된 strict reader는 ref 포함 정책을 읽지 못한다. Rollback 시 신규 ref
정책을 비활성화하고 호환 reader를 유지하며 기존 record를 수정·삭제하거나 model ref를 소급 제거하지
않는다. 운영 artifact 작성/정책 활성화는 실행하지 않았다. 모델 ref 없는 legacy 정책의 기존 동작과
paper-only/mock/Risk 기본값은 유지한다.

- backend는 bucket gap, available slots, symbol cap, liquidity cap, concentration cap,
  cash reserve와 execution cost를 적용해 target range를 산정한다.
- 동일 candidate evidence, feature input과 scoring model version은 동일한 정렬과
  reason code를 만들어야 한다.
- sizing 재현성은 `policyHash`, versioned portfolio snapshot, selection request,
  candidate assignment, exposure/liquidity cap과 execution cost를 포함한 전체
  `sizingInputHash`에 묶는다. 동일한 전체 입력만 동일한 target range와 최대 notional을
  만들어야 한다.
- 동점은 `market`, `symbol` canonical order로 해소해 replay 재현성을 보장한다.

초기 sizing은 복잡한 최적화보다 다음 bounded allocation을 사용한다.

1. bucket gap을 available slot 수로 나눈 기본 notional을 계산한다.
2. candidate score에 따른 deterministic multiplier를 허용 범위 안에서 적용한다.
3. symbol, bucket, sector, country, currency, liquidity limit 중 가장 작은 cap을 적용한다.
4. selected rank 순으로 remaining request allocation budget을 reserve해 aggregate maximum이
   gap과 `maximumAdditionalExposureKrw` 중 작은 값을 넘지 않게 한다.
5. 최소 주문 단위보다 작거나 비용 대비 편익 threshold를 넘지 못하면 거래하지 않는다.
6. exact target을 추적하지 않고 min/max rebalance band 안에서는 유지한다.

#### 초기 notional의 버전 정책과 원본 재생

`candidate_gap_score_notional.v1`은 위 단계의 기본 금액·점수 배수·개별 cap·최소 KRW 금액을
계산한다. Selection policy의 optional `notionalSizingPolicy`에 minimum/maximum score multiplier와
minimumOrderNotionalKrw를 모두 명시한다. 배수는 0 이상의 finite safe-range 값이고 maximum은 양수,
minimum ≤ maximum이어야 한다. 최소 주문 금액은 양의 safe integer다. 필드가 없는 기존 정책의
payload/hash/ID/lineage는 유지하며 모델이나 parameter를 추정해 보충하지 않는다. 새 parameter 전체는
selection policy identity에 포함된다. 기록 가능한 모델 version과 실행 가능한 version은 구분하며
calculator는 v1 외 version과 sizing input의 불일치를 거절한다.

`calculateCandidateBoundedNotional`은 supplied runtime/selection policy, request와 sizing input을
독립 파싱하고 exact selection ref, portfolio/policy/bucket/market/시각 및 scoring/sizing version을
대조한다. BUY와 0~1 normalized score만 받는다. 기본 금액은 `floor(gapKrw / availableSlots)`, 배수는
`minimum + (maximum - minimum) * score`다. Canonical decimal을 BigInt로 변환해 보간한 뒤 기본 금액에
곱하고 원 단위로 내림한다. 중간 금액이 Number safe range를 넘어도 문자열로 보존하며, 최종 cap 적용
뒤에만 safe integer로 변환한다. Gap/additional exposure와 bucket/symbol/sector/country/currency/cash/
liquidity 중 작은 상한을 적용하고 명시된 최소 금액 미만이면 초기 금액은 0이다. Subnormal 배수와
큰 중간 곱에도 binary underflow/overflow나 상향 반올림을 허용하지 않는다.

`parseCandidateBoundedNotional`은 input부터 전체 계산을 다시 수행해 payload/hash와 비교한다.
`resolveStoredCandidateBoundedNotional`은 실제 policy·score·evidence·비용·유동성·cash·분류·position
상한 원본 조회를 연결하며, 선언된 cap이 실제 position 상한보다 크면 계산을 거절한다. 그러나 작은
cap이 정확한 pending/reservation-adjusted 값이라는 증명은 아니다. Required evidence/hard gate의
실패를 초기 금액으로 덮어쓰지 않으며 기존 assessment를 그대로 보존한다.

이는 initial notional 계산이며 최종 assignment/mandate 발급은 아니다. 요청 gap/slot의 현재 권한,
정확한 공용 ledger cap, 금액 변경 후 비용 재계산·비용 대비 편익 threshold, broker 최소 수량/lot,
weight band와 rank별 최종 reserve 연결은 후속이다. `initial_notional_available`은 eligibility 또는
주문 승인이 아니다. 반환된 finalSizing/currentExecutionAuthority는 각각 not_performed/not_granted다.
새 정책 field를 읽는 reader를 먼저 배포해야 하고 이전 strict reader는 해당 field가 있는 정책을
읽지 못한다. Rollback 시 새 field를 사용하는 정책의 소비를 중단하고 호환 reader를 유지하며 기존
immutable record를 수정·삭제하지 않는다. 운영 정책 활성화, 기존 기본값 변경과 실제 주문은 없다.

#### 초기 금액 기준 실행 비용 재계산

`calculateCandidateInitialExecutionCost`는 초기 notional 결과와 daily liquidity 결과를 각각 전체
재생한다. 실제 후보 feature/evidence scope, liquidity 입력 전체와 participation cap을 대조하고
선택 정책의 liquidity/cost-basis/cost estimation version을 확인한다. 기존 reference 금액의 비용과
참여율도 먼저 재생해 잘못된 원본 선언을 통과시키지 않는다. 이후 초기 배정 금액으로 daily proxy
참여율과 fee/tax/spread/slippage/impact 비용을 다시 계산한다. 금액과 참여율만 바꾸고 이전
estimatedCostKrw를 재사용하는 경로는 없다. 참여율은 기존 보수적 canonical decimal 반올림,
각 비용 항목은 기존 원 단위 올림 규칙을 유지한다. 초기 금액 0은 참여율/비용도 0이다.

`requiredCashKrw`는 초기 금액과 새 총비용의 BigInt 합을 문자열로 보존한다. `fitsDeclaredCash`는
이 합이 선언된 cashAvailableKrw 이하인지 비교한다. 예를 들어 초기 100원에 비용 4원이면 cash
100원에는 false, 104원에는 true다. False여도 여기서 금액을 임의 축소하거나 주문을 만들지 않는다.
개별 비용 또는 총비용이 기존 계산기의 safe KRW 범위를 초과하면 계산 오류를 전파한다.
`parseCandidateInitialExecutionCost`는 전체 입력과 새 비용 계산을 다시 실행하므로 재해시한
금액·비용·참여율·cash flag·authority 변조도 거절한다.

`resolveStoredCandidateInitialExecutionCost`는 `resolveStoredCandidateBoundedNotional`의 동일 원본
조회 결과에서 liquidity를 꺼내 사용한다. 별도 조회 결과를 섞거나 외부 cost/금액 override를 받지
않는다. 원래 evidence/hard gate 실패는 assessment에 그대로 남는다. 현재 cap의 정확성, 비용 대비
편익 threshold, 금액 재조정, 최소 수량/lot, band, 실제 fill 및 final sizing은 아직 부여하지 않는다.
이는 다음 최종 배정 단계에서 사용할 비용 재계산이며 새로운 정책 field/활성화, writer, API와
저장 형식 변경은 없다. 코드 rollback만으로 새 소비 경로를 제거할 수 있고 기존 원본은 변경하지 않는다.

#### 비용 포함 현금 상한에 맞춘 초기 금액 축소

`calculateCandidateCashAffordableNotional`은 위 비용 재계산 결과를 전체 재생한 뒤 초기 금액 이하의
정수 KRW 구간에서 `notional + estimatedCost(notional) <= cashAvailableKrw`를 만족하는 최대 금액을
찾는다. 선택된 v1 비용 모델의 nonnegative rate와 보수적 참여율/올림 비용은 단조 증가하므로
BigInt 상향 midpoint 이진 탐색을 사용한다. 구간이 safe integer라 탐색은 최대 53회이며, 각 후보
금액에서 참여율과 비용을 다시 계산한다. 기존 비용을 고정한 채 단순 차감하지 않는다.

탐색 결과가 명시된 최소 주문 금액보다 작으면 최종 반환 초기 금액은 0이며 비용도 0으로 재계산한다.
최소 금액 적용 전 최대값, 탐색 횟수, 선택 금액의 비용, 다음 1원의 필요 현금(초기 상한 도달 시 null)을
보존한다. 예를 들어 cash 100원/초기 100원/새 비용 4원인 fixture는 96원으로 축소되며, minimum 97원이면
0원이 된다. Parser는 전체 탐색과 비용을 다시 실행해 재해시한 비최대 결과나 잘못된 비용·현금 flag를
거절한다. 입력 비용 모델의 safe range 오류는 전파하며 무효한 원본을 탐색으로 숨기지 않는다.

`resolveStoredCandidateCashAffordableNotional`은 같은 실제 원본 비용 resolver에 연결하고 evidence/
hard gate 실패를 보존한다. 저장 snapshot의 reserve/pending gross 반영 현금 상한을 사용하는 것이며
현재 pending 비용·공용 reservation 권한까지 증명하지 않는다. Shared ledger reserve, benefit threshold,
최소 수량/lot, weight band, mandate/실행 및 final sizing은 후속이다. 추가 정책 parameter/default,
writer, API, artifact 변경은 없고 새 소비 경로 제거와 코드 rollback에 데이터 변환은 없다.

<!-- /spom-source -->

## 기존 PR 3의 세부 계약 · 원문 3619–3914행

<a id="spom-source-3619-3914"></a>
<!-- spom-source:3619-3914 sha256:fd55fd74d751669d5a7bf054e72a5ef5f32721e94915b97667f63d199395506f -->

예약 원본 계약 분할은 `ManualOpeningCapacityReservationRecord`의 strict
`new_position | increase_existing` variant와 factory/parser를 구현한다. Manual assignment ID/hash,
portfolio/policy/bucket/market/symbol, transaction의 current snapshot ID/hash, CAS ledger version,
예약 notional과 resulting aggregate notional, authorization ref 및 slot ordinal 또는 기존 position ref를
완전한 payload hash에 포함한다. ID/hash/createdAt만 digest에서 제외하고 ID는 digest에서 파생한다.
Safe-integer 금액·version·slot, 양수 예약 금액, aggregate >= individual 예약과 canonical UTC 시각을
검증하며 variant 간 필드 혼합·unknown field·정규화가 필요한 문자열을 거절한다.

Pure binding은 독립 rehash한 `open_or_increase` manual event의 exact ID/hash, scope, authorization,
maximum notional 및 생성 시각을 대조한다. `classify_existing_reduce_only`로는 opening 예약을 만들 수 없다.
Manual opening mandate와 연결할 때 기존 assignment binding에 더해 reservation ID/hash, 종류,
slot 또는 position ref, 예약 notional 전체와 생성 순서를 확인한다. Current transaction snapshot은
manual event의 과거 sizing snapshot과 다를 수 있으므로 동일하다고 강제하지 않는다.

이 분할은 불변 record와 원본 payload 간 결속 계약이며 현재 capacity를 예약·소비하는 권한은 아니다.
실제 current snapshot/position, active policy, evidence/sizing 원본, selector/manual 공용 ledger의
slot/budget/CAS 재계산, single-use mandate binding, reservation lifecycle event 저장과 manual event·
mandate activation의 원자 commit은 후속이다. 새 record 파일은 아직 쓰지 않으며 기존 mandate writer,
Risk 생성 및 실행 경로는 변경하지 않는다. Schema migration이나 artifact 변환이 없어 코드 rollback만
필요하다. 전체 수용 기준의 예약 원장 완료로 표시하지 않는다.

예약 lifecycle 이벤트 계약 분할은 `openingCapacityReservationEvent.ts`에서 `reserved`,
`bound_to_mandate`, `partially_consumed`, `consumed_by_position`, `released`의 strict union과
factory/parser를 구현한다. 최초 예약만 predecessor를 생략하며 manual/selector source와
취소/mandate terminal release origin을 별도 strict variant로 검증한다. ID/hash/createdAt을
제외한 전체 payload를 독립 rehash하고 hash-derived ID를 대조한다. Source/release origin도
freeze하며 safe integer, 음의 0, canonical UTC 및 `asOf <= createdAt`을 검사한다.

Reserved/bound/partial의 잔액은 양수이고 released는 잔액 0 및 slot 미점유다. Partial/position
consumption은 slot을 점유하지 않으며 selector의 신규 예약은 slot을 점유해야 한다. 신규 position의
첫 체결이 slot을 position으로 전환한 뒤에도 notional 잔액이 남을 수 있으므로
`consumed_by_position`에는 0 또는 양수 잔액을 허용한다. 이후 잔액 소진·terminal 판정은
단일 event의 이름만으로 결정하지 않고 후속 chain replay가 검증해야 한다.

Manual reserved event의 pure binding은 manual event와 reservation record를 독립 파싱하고
event의 reservation ID/hash, scope, ledger version, 초기 예약 금액과 new/increase slot flag,
source 생성 시각을 대조한다. 이는 실제 저장된 원본의 관측 증명이나 현재 capacity 권한이 아니다.
Predecessor의 실존/분기, global ledger version 순서, 잔액 감소·fill 금액 일치, selector 및 mandate/fill
실제 원본, 중복 binding/slot과 append-only 저장·원자 commit은 후속이다. 기존 writer나 Risk 경로에
연결하지 않으며 자동 migration·artifact 생성·live surface 변경은 없다. 계약만으로 예약 원장이나
전체 수용 기준이 완료됐다고 표시하지 않는다.

예약 이력 재생 분할은 `replayOpeningCapacityReservationEvents`로 단일 portfolio/policy/bucket의
supplied event 목록을 처음부터 fold한다. 빈 원장은 version 0이며 모든 event는 전체 원장 순서대로
1씩 증가한다. 여러 예약이 교차 진행할 수 있으므로 predecessor는 전역 직전 event가 아니라 해당
reservation의 현재 head여야 한다. 독립 event parser를 재사용하고 scope/hash 변경, version gap,
ID 재사용, branch, asOf/createdAt 역행 및 terminal 이후 전이를 거절한다.

Bind는 reserved에서 한 번만 가능하고 slot·notional을 유지하며 mandate ID는 다른 reservation에
재사용하지 않는다. Fill은 bound mandate ID/hash와 같고 잔액을 엄격히 줄여야 한다. 신규 slot의
첫 fill은 consumed_by_position이어야 하며 이후 partial에서도 이미 소비한 position ref를 보존한다.
같은 fill/paper record ID 재사용과 position 바꿔치기를 거절한다. 잔액 0 또는 released는 terminal이다.
Unbound 취소는 request_cancelled, bound 이후 해제는 같은 mandate의 terminal origin만 허용한다.
Selector assignment ID를 새 예약에서 재사용하지 않으며 모든 중간 단계의 aggregate notional을
BigInt로 계산해 safe integer 범위를 넘는 이력은 거절한다.

반환값은 immutable event 목록과 scope 및 complete event 목록(createdAt 포함)의 history hash,
reservation별 head·mandate·position ref·소비/해제 금액,
전체 잔액 및 pending/bound-unused 신규 slot 수다. 이 값은 source claim의 구조적 재생 결과이며
`BucketOpeningCapacityState`나 latest ledger/CAS 증명이 아니다. 실제 manual/selector/mandate terminal/
fill 원본, fill notional과 차감액 일치, manual/selector 전역 slot ordinal uniqueness, current snapshot의
active position과 gap/budget, policy migration 및 persistence/atomic commit은 후속이다. 유효한 prefix도
성공할 수 있으므로 이 결과만으로 최신 상태나 실행 권한을 발급하지 않는다. Artifact·기존 writer·Risk
동작과 live surface는 변경하지 않으며 데이터 migration 없이 코드 rollback이 가능하다.

예약 이벤트 저장 분할은 `OpeningCapacityReservationEventFileRepository`에서
`opening-capacity-reservation-events.jsonl`에 complete event와 appendStartedAt, 전역 previousCommitHash를
포함한 entry 및 별도 committedAt/commitHash marker를 append한다. Scope별 capacityLedgerVersion은
portfolio/policy/bucket 전체의 연속 version이고 reservation predecessor는 해당 예약의 head다.
모든 scope의 전체 이력을 독립 rehash하고 scope당 한 번 replay한 뒤에만 reader/consumer를 호출한다.
동일 complete event 재시도는 원래 origin을 반환하고 createdAt만 다른 ID 충돌, stale version,
분기·중복·terminal 후속·미래 시각과 직전 scope commit보다 이른 asOf는 쓰기 전에 거절한다.

Writer는 단일 파일 lock 안에서 검증·append를 직렬화한다. Pending barrier를 먼저 fsync하고 entry와
marker를 각각 fsync한 뒤 barrier를 제거한다. 중간 실패의 barrier·부분 bytes는 자동 정리하지 않으며
후속 read/append는 명시적 복구가 필요하다고 실패한다. Lock 초기화 실패도 barrier를 보존하고,
획득 EEXIST 및 Windows EPERM만 monotonic timeout 안에서 재시도한다. 현재/교체된 다른 소유자의
lock을 지우지 않는다. Reader는 regular file, strict UTF-8, descriptor/path identity 및 fsync 전후
bytes/stat을 대조한다. Absent 파일은 디렉터리 동기화 후 부재를 재확인하고 artifact를 만들지 않는다.
Windows directory fsync의 기존 EPERM 제한을 유지하며 그 밖의 오류를 성공으로 처리하지 않는다.

Verified history의 private storage-origin 인덱스는 실제 reader에서만 발급하고 clone/임의 객체를
거절한다. Callback 안의 durable observation lease는 lock을 유지하며 정상/예외 종료 모두 만료된다.
반환값의 범위는 stored_opening_capacity_event_history_only다. 저장된 manual/selector/mandate/fill
참조는 아직 source claim이며 실제 원본의 실존/금액, 전역 slot ordinal, current snapshot·active policy,
공용 budget/CAS allocator, mandate/fill과의 원자 transaction 및 최종 sizing 권한은 증명하지 않는다.
재시작 재검증은 보관된 파일 전체 기준이며 외부에서 완전한 suffix를 삭제한 사실을 독립적으로 증명하는
외부 checkpoint는 없다. 새 writer는 기존 실행/API/MCP에 연결하지 않는다. 데이터 변환 없이 consumer를
중단하고 코드 rollback할 수 있으며 이력·복구 barrier를 삭제하지 않는다. 최종 예약 원장 수용 기준은
실제 원본과 allocator 연결 및 통합 검증 후에만 완료할 수 있다.

수동 reserved root의 실제 원본 연결은 `resolveStoredManualOpeningCapacityEventOrigins`에서
portfolio의 모든 정책/bucket에 걸친 manual root를 actual event journal, manual reservation journal,
manual assignment 및 예약이 참조한 snapshot 이력과 대조한다. 각 저장소는 필터 전에 전체 이력을
재검증하며 terminal reservation의 root도 검사한다. 실제 reservation repository는 자신이 저장한
manual/snapshot prefix receipt를 현재 source lock 아래 재검증한다. Resolver는 해당 record와 실제
manual event를 기존 pure binding에 전달해 ID/hash, portfolio/policy/bucket, version, 초기 notional,
new/increase slot flag 및 생성 순서를 검사한다. Reservation commit은 event.asOf보다 엄격히 앞서야
하며 같은 millisecond는 선행 저장을 증명하지 못하므로 거절한다.

반환 bindings는 actual event origin, reservation origin 및 manual event를 보존하고 assessment에는
각 관측/generation hash와 binding hash를 기록한다. Input/options는 await 전에 복사하고 manual,
reservation, event 관측의 역행을 거절한다. Manual source는 먼저 관측 후 lock을 해제하며 reservation
reader의 manual -> snapshot -> reservation 잠금에 재진입하지 않는다. 마지막 event observation도
callback 종료 후 만료된다. 따라서 이는 순차적인 historical observation이지 다중 파일의 현재 lease가 아니다.

범위는 stored_manual_reserved_event_origins_only다. Selector root와 모든 successor의 ID를 각각
unverified 목록으로 반환하며 이들을 검증된 manual root 수에 포함하지 않는다. 정책/evidence/sizing,
전역 slot·budget allocator, successor의 mandate/fill/해제 원본, current execution 및 최종 sizing은
완료하지 않는다. 과거 event 작성 시 source-before-creation receipt를 저장하지 않았으므로 이를
소급 발급하지 않으며 historical disk availability도 증명하지 않는다. 기존 writer·API·안전 기본값과
저장 형식 변경은 없고 데이터 변환 없이 신규 consumer 중단과 코드 rollback이 가능하다.

수동 bound-to-mandate 원본 연결은 `resolveStoredManualOpeningCapacityMandateOrigins`에서 이미
검증된 manual root와 실제 `InvestmentMandateFileRepository`의 전체 record/event 이력을 조합한다.
모든 source 조회 후 event journal을 다시 관측하며 manual root를 확인했을 때와 generationHash가
다르면 부분 결과를 재사용하지 않고 실패한다. Mandate와 event 관측 시각 역행도 거절한다.

Root와 bound의 연결 키는 portfolio/policy/bucket/reservation ID 전체다. 다른 scope의 selector가 같은
reservation ID를 사용하는 경우 수동 root로 합치지 않는다. Manual root에 속한 모든 bound_to_mandate
이벤트는 실제 mandate ID/hash를 조회하고 기존
`resolveManualOpeningCapacityMandateBinding`으로 scope/evidence/range, manual authorization,
예약 ID/hash/notional 및 new/increase slot/position lineage를 대조한다. Mandate createdAt이 bound
event.asOf보다 늦으면 거절한다. 이미 해제/소진된 예약과 이전 policy의 binding도 검사에서 제외하지
않는다. Verified bound event와 연결된 root, actual mandate payload, event storage origin 및 mandate
전체 관측 hash를 보존한다. Selector와 fill/release 등 아직 검증하지 않은 이벤트는 unverified ID
목록으로 반환하며 root assessment hash를 함께 보존한다.

범위는 stored_manual_capacity_mandate_bindings_only다. Mandate 저장소는 record별 append commit
시각을 갖지 않으므로 `mandateAvailabilityAtBinding: not_proven`과
`sourceBeforeCreationReceipt: not_recorded`를 명시한다. Proposed mandate도 content binding의 대상이며
activation/current mandate 상태, 실제 slot/budget 할당, selector/fill/release 원본 및 최종 실행/sizing
권한을 부여하지 않는다. 순차적인 source 관측은 multi-file current lease가 아니다. 기존 writer/API와
artifact 형식 변경 없이 신규 consumer를 중단하고 코드 rollback할 수 있으며 원본을 삭제하지 않는다.

수동 예약 소비 원본 연결은 `resolveStoredManualOpeningCapacityFillOrigins`에서 actual manual root/
mandate binding과 실제 plan/event, Risk, paper fill 및 source price 이력을 조합한다. Plan 전체 prefix를
한 번씩 replay해 체결 직전 상태를 만들고 actual execution_applied event를 paperFillRecordId로
조회한다. 같은 portfolio의 여러 plan execution이 하나의 paper fill을 참조하면 실패한다.

기존 fill/Risk validator로 persisted Risk receipt, 실제 price projection, identity/금액/누계/cash cap과
commit 순서를 대조하고 Risk의 다음 action/target/pre-state를 재생한다. 실제 plan action은 연결된
manual mandate의 BUY여야 하며 fill의 portfolio/market/symbol, Risk의 policy/bucket도 capacity event와
일치해야 한다. 직전 capacity event 잔액과 현재 잔액의 차이는 실제 filledNotionalKrw와 같아야 하며,
수수료 등을 포함한 netAmountKrw를 차감 기준으로 대신 쓰지 않는다. Plan predecessor와 capacity
predecessor는 Risk 결정보다 먼저 commit돼야 하고 actual execution event도 소비 event.asOf보다
먼저 commit돼야 한다. Risk에 plan receipt가 있으면 actual plan/predecessor commit과 정확히 대조한다.
실제 mandate event 이력을 Risk 결정 시점으로 재생해 active open-or-increase 상태를 요구한다.
Risk에 mandate receipt가 있으면 실제 저장 prefix와 mandate/event identity도 다시 대조한다.
Receipt 없는 Risk는 저장된 event의 asOf/createdAt 기준 상태만 확인하며 당시 실제 저장 가용성을
증명하지 않는다. 이후 retire된 mandate의 정상 과거 체결은 당시 상태로 검사한다. Source lock은
price → mandate → capacity 순서이며 새 current execution 권한을 발급하지 않는다.

Portfolio 내 fill/Risk의 소비 재사용을 거절하며 terminal 예약의 과거 소비도 검사한다. Source 조회 후
capacity journal을 다시 관측하고 mandate binding 때의 generation과 다르면 실패한다. Manual root/
bound/fill 중 이번 composition이 검증한 event만 제외하고 selector/release 등 나머지 ID는 unverified
목록에 남긴다. 원본 payload, 각 storage origin 및 전체 source generation/observation hash를 반환한다.

범위는 stored_manual_capacity_fill_origins_only다. 실제 Risk 정책/required rule 재평가, current active
mandate, source freshness/trust, accounting과 resultingPositionRef의 실제 position/mark-state 연결,
공용 slot/budget allocator, 다중 artifact transaction과 최종 sizing/실행은 완료하지 않는다. 기존 실행
경로·API·writer와 artifact schema를 변경하지 않으며 신규 consumer 중단과 코드 rollback에 데이터
변환/삭제가 필요하지 않다. 저장된 claim의 원본 연결을 실제 자금 예약 또는 position 생성 승인으로
취급하지 않는다.

수동 예약의 retirement 해제 원본은 `resolveStoredManualOpeningCapacityTerminalOrigins`에서
선행 root/mandate/fill composition을 먼저 수행한 뒤 실제 mandate 전체 이력과 capacity journal을
다시 관측한다. Portfolio/policy/bucket/reservation 전체 키로 수동 bound 예약만 선택하며
mandate_terminal release의 exact mandate/event ID/hash를 실제 retired 상태 및 마지막 retirement
event와 대조한다. Active/review_required event, 없는 event, 다른 hash와 다른 실제 mandate payload는
거절한다. Terminal event의 asOf/createdAt은 release.asOf 이하여야 하며 capacity predecessor commit은
release.asOf보다 엄격히 앞서야 한다. 해제액은 이미 실제 fill과 대조한 직전 예약의 잔여 gross다.

선행 fill 관측 이후 capacity generation이 바뀌면 실패하고, 다시 전체 resolver를 실행해야 한다.
신규 source lock은 mandate → capacity 순서이며 선행 fill resolver의 lock은 모두 반환된 뒤 획득한다.
저장된 retirement가 실제로 release 전에 disk에 존재했다는 receipt는 기존 event 형식에 없으므로
retirementAvailabilityBeforeRelease는 not_proven, sourceBeforeCreationReceipt는 not_recorded다.
Scope는 stored_manual_capacity_retirement_origins_only이며 request_cancelled와 selector origin은
unverified 목록에 유지한다. 자유 형식 releaseReasonCode는 retirement의 원본 증명을 대체하지 않는다.
Target 충족에 따른 별도 해제 origin 계약, 실제 unbound 취소 authorization, accounting/position,
공용 allocator와 atomic writer는 후속이다. 전체 journal/suffix 소실은 외부 checkpoint 없이 과거
존재 여부를 증명하지 못하므로 빈 조회를 current capacity나 복구 완료로 간주하지 않는다.

Selector retirement 해제는 `resolveStoredSelectorOpeningCapacityTerminalOrigins`에서 실제
Selector assignment/root/mandate/fill 원본 연결을 선행한 뒤 같은 retirement 검증을 적용한다.
`storedOpeningCapacityTerminalOrigins.ts`의 private 공통 함수는 source-specific entrypoint가
직접 조회한 원본만 받으며 외부에서 검증 완료 객체나 resolver를 주입하는 API는 없다.
기존 수동 함수 import와 반환 타입의 root 정보는 유지하며 Selector 반환값에는 assignment/set
원본과 global slot ordinal이 보존된다. 양쪽 경로 모두 exact retired mandate/event ID/hash,
최종 retired 상태, asOf/createdAt 및 capacity predecessor commit 순서와 generation을 대조한다.

Scope는 stored_selector_capacity_retirement_origins_only다. 해제액은 체결 원본과 대조한 직전
예약의 remainingReservedNotionalKrw이며 수수료 포함 cash와 혼동하지 않는다. 미체결·부분체결 후
해제, 재시작, 손상·누락 원본 및 source 관측 중 generation 변경을 검증한다. Unbound selector
root와 request_cancelled, 다른 manual 예약은 unverified 목록에 남긴다. Retirement의 실제 저장
가용성 receipt, root allocator/CAS, current capacity·취소·target 충족 권한과 accounting/position은
이 조회로 승인하지 않는다. 소비가 끝났다는 이유만으로 해제 이벤트를 만들어 반환하지 않는다.
기존 writer·API·artifact schema·운영 기본값은 그대로이며 신규 consumer와 공통/legacy entrypoint를
함께 rollback할 수 있다. 데이터 변환·삭제는 필요 없다.

체결·해제 composition 테스트는 동일한 실제 임시 저장소 fixture를
storedManualOpeningCapacityTestFixtures.ts에서 공유한다. 기존 체결 테스트 8개의 본문/assertion을
유지하며 fixture import는 테스트를 등록하지 않는다. 기존 API/writer/artifact schema 변경 없이
consumer 중단과 코드 rollback이 가능하고 원본 변환·삭제는 수행하지 않는다.

수동 예약의 실제 원본 조회 선행 분할은 `ManualAssignmentFileRepository.withDurableVerifiedHistory`로
manual assignment의 전체 이력을 독립 검증·동기화하고 consumer가 끝날 때까지 기존 source lock을
유지한다. 일반 `readAll`과 동일한 strict JSONL parser를 사용해 torn/blank/corrupt/duplicate 이력을
거절하며, 새 조회는 regular file과 동일 descriptor의 bytes 및 inode/size/수정 시각을 동기화 전후에
대조한다. Pathname을 다시 열어 descriptor identity도 비교하므로 관측 중 rewrite/replace/append/
truncate를 정상 이력으로 승격하지 않는다. 없는 파일은 directory sync 후 부재를 재확인하며 빈
원본 파일을 생성하지 않는다. Windows directory fsync의 기존 EPERM 제한은 유지하고 그 외 오류는
consumer 호출 전에 거절한다.

관측값은 전체 event count와 createdAt을 포함한 complete event 목록의 hash, fsync 이후이면서
마지막 재검증 이전의 observedAt이다. Frozen history의 private WeakMap lease는 callback 동안에만
유효하고 정상 반환·예외 모두 즉시 폐기한다. 일반 read 결과, 복사한 history나 callback 밖에 보관한
객체는 durable observation으로 사용할 수 없다. 저장된 receipt는 현재 live lease 안에서 count/hash와
관측 시각 상한을 대조해 동일 prefix를 재검증할 수 있지만, receipt 문자열 자체를 신뢰하거나 과거
commit 시각·최신 원장·실행 권한을 증명하지 않는다. Consumer는 자신이 선택한 원본 repository에서
직접 lease를 취득해야 하며 같은 저장소를 callback 안에서 재진입하지 않는다.

테스트는 classification/opening 이력, absent/empty, append/restart prefix, createdAt 변경과 손상,
다른 프로세스의 writer 차단, fsync/directory 오류, 관측 중 원본 변경, 관측 시각과 callback 실패 후
lease/lock 해제를 검증한다. 기존 append 형식·기본값과 writer 호출 경로는 유지한다. 이 조회는
원본을 fsync하므로 순수 read-only I/O는 아니지만 domain event를 append하거나 고치지 않는다.
Manual reservation 저장소와 actual snapshot 결속, evidence/sizing/active policy, shared capacity
ledger/CAS 및 mandate activation 원자 commit은 후속이며 예약 원장 완료로 표시하지 않는다.
Artifact migration이 없고 신규 consumer를 중지한 뒤 코드 rollback이 가능하다.

수동 예약 기록 저장 분할은 `ManualOpeningCapacityReservationFileRepository`에서 계획한
`manual-opening-capacity-reservations.jsonl`을 실제 작성하고 재시작 시 재검증한다. Manual assignment →
portfolio sizing snapshot → reservation 순서로 lock을 획득하고 실제 두 source의 durable lease를
예약 파일 처리 및 consumer 종료까지 유지한다. Reservation record는 기존 독립 parser/binding을
통과해야 하며 실제 manual event의 ID/hash·authorization·scope·maximum notional과 실제 snapshot의
ID/hash·portfolio/policy·asOf를 대조한다. Source 관측보다 뒤의 event/snapshot, append 시각보다 뒤의
record/관측 시각은 거절한다. Snapshot이 실제 저장됐음을 검증하지만 최신 current portfolio라는
판단과 existing position 존재·gap/slot/budget 계산은 아직 이 저장소의 권한이 아니다.

각 entry는 complete reservation, createdAt을 포함한 manual/snapshot prefix 관측값,
appendStartedAt 및 previousCommitHash를 독립 hash하고, 별도 commit marker가 entryHash와
committedAt을 hash한다. Read/append마다 전체 pair와 실제 source prefix를 재검증하므로 source
삭제·변조·손상 suffix, 자체 재해시한 잘못된 source receipt, predecessor/marker/hash/시각 불일치와
duplicate ID를 거절한다. Exact retry는 원래 저장한 source 관측값을 그대로 반환하고 새 관측값으로
과거 origin을 덮어쓰지 않는다. 같은 record ID에 다른 createdAt은 collision이다.

Manual assignment, sizing snapshot 및 manual reservation 파일은 JSON/hash 검증 전에 UTF-8
decode/encode 왕복 bytes가 원본과 정확히 같은지 검사한다. 잘못된 byte가 U+FFFD로 대체돼
기존 허용 식별자와 같은 문자열·hash를 만드는 경우에도 fail-closed한다. 일반 read/resolve,
신규 append와 exact retry 및 durable callback 모두 이 검사를 거치며 손상 source에 의존한
예약 read/retry도 거절한다. 정상 UTF-8로 저장된 U+FFFD는 계속 허용하고 파일을 자동 변환하거나
복구하지 않는다. 회귀 테스트는 실제 source-bound 예약의 세 파일을 각각 0xff/0x80/0xc2로
변조하여 callback 미호출, 원본 bytes 보존, 정상 bytes 복원 후 restart/retry를 확인한다.
Artifact schema·ID/hash 계산·잠금 순서·거래 정책 변경은 없다. 코드 rollback은 가능하지만
이 잘못된 UTF-8 거절 경계가 사라지므로 손상 파일을 정상 이력으로 취급할 위험이 되돌아온다.

Append는 pending barrier를 먼저 동기화한 뒤 entry와 marker를 각각 append/fsync하고 마지막에
barrier를 제거·directory sync한다. 도중 실패 시 성공을 반환하지 않으며 남은 pending/torn/불완전
pair는 자동 복구하거나 삭제하지 않는다. Marker의 committedAt은 entry fsync 이후 marker 작성
시각이지 전체 transaction 완료 시각 증명이 아니다. 미래 consumer는 callback 동안만 유효한
`getDurableManualCapacityReservationObservation`의 새 관측 시각을 사용해야 한다. 유효한 이력
prefix만으로 latest ledger를 증명하지 않으며 여러 artifact의 rollback이나 예약 승인으로 승격하지 않는다.

Source와 destination의 파일 관측은 실제 bytes/descriptor/path identity를 재검증하고, callback의
정상/실패 종료에서 lease를 폐기한다. Destination lock은 monotonic deadline으로 획득 경합을 제한하고
초기화 실패 시 ownership을 추정해 pathname을 삭제하지 않는다. 테스트는 실제 파일·원본 재조회,
두 예약 variant와 retry/restart, 동시 exact retry, pending/entry/marker/fsync/remove 실패,
source lock 유지, 관측 중 rewrite, frozen wall clock의 abandoned lock을 검증한다.

수동 예약의 `withDurableVerifiedHistoryFromSources`는 이미 획득한 manual → snapshot의 실제
durable lease를 받아 reservation lock만 획득하는 조회 API다. 일반 조회도 같은 내부 경로를 사용한다.
각 source repository는 생성 시 절대 경로를 고정하고, callback 동안만 존재하는 private WeakMap에
발급 객체와 source 경로를 연결한다. 동일 bytes의 다른 디렉터리 관측, 복사 객체, 종료된 관측은
거절한다. `.`/`..`는 정규화하지만 다른 symlink·대소문자 alias를 같은 source로 승격하지 않는다.
이는 configured path 결속이며 OS 외부 writer의 임의 파일 교체를 막는 capability sandbox가 아니다.

호출자는 두 source callback 안에서 이 조회를 반드시 await해야 한다. Reservation lock 대기 전후,
파일 관측 뒤, consumer 정상 반환 전과 종속 observation getter에서 원본 lease 수명을 재검증한다.
원본 callback이 먼저 끝나면 아직 실행 중인 종속 callback의 관측도 즉시 무효이며 정상 성공을
반환하지 않는다. 예약 관측 시각이 어느 원본 관측 시각보다 앞서면 fail-closed한다. 기존 전체 pair,
source prefix, UTF-8, pending barrier와 descriptor/fsync 검사는 그대로 재사용한다.

실제 원본·예약을 이용한 테스트는 경로/수명 경계, 원본 lock 유지, consumer 실패 후 재사용,
lock 대기·I/O 도중 원본 종료, 시계 역행, 손상/pending 파일 보존과 populated history 동일성을
검증한다. 이 API는 append 재진입, 예약 할당/소비 권한 또는 current publisher wiring을 제공하지
않는다. Public observation·artifact schema는 유지하며 migration은 없다. 상대 경로는 생성 시
고정되므로 생성 후 process cwd 변경으로 저장소 위치가 이동하지 않는다. Rollback 전 신규 API
consumer를 함께 중지/되돌려야 하며 데이터는 보존한다. 새로운 경로·종속 수명 검증은 rollback하면
사라지므로 이를 전제로 하는 consumer만 남겨 두면 안 된다.

이 저장소는 opt-in source-bound record 보존이며 기존 mandate/Risk/runner에 연결하지 않는다.
Shared capacity event 저장·projection/CAS, manual event/예약/mandate activation의 원자 commit과
policy/evidence/sizing/current portfolio 연결은 후속이다. 기존 artifact 변환은 없고 rollback 시
새 consumer/writer를 중지한 뒤 파일을 보존해야 한다. 이전 코드가 새 artifact를 읽지 못하는 상태를
예약이 없는 것으로 취급해 실행하지 않도록 consumer 배포 순서를 별도로 검증해야 한다.

<!-- /spom-source -->

## 기존 PR 4의 세부 계약 · 원문 3923–4229행

<a id="spom-source-3923-4229"></a>
<!-- spom-source:3923-4229 sha256:39b887a647bdbf63aa7fc206bac4b044fa06b8a61a9734c20681cb277852aa6c -->

첫 분할은 active runtime policy와 같은 portfolio/policy scope의 verified exposure 및 opening capacity
입력에서 bucket gap을 계산하는 순수 `analyzePortfolioGaps`를 구현한다. bucket exposure와 capacity는
canonical complete bucket 순서를 강제하고, slot은 active position, pending reservation,
mandate-bound unused reservation을 모두 점유한 것으로 계산한다. `below_min`은 min gap만,
`entry_floor_on_due_cycle`은 due bucket의 entry-floor gap만 selection trigger로 인정하며 target gap은
관찰용으로만 남긴다. cash opening capacity는 target cash ratio와 절대 minimum 중 큰 reserve 및 pending
BUY exposure를 차감해 계산하고, reserve 부족이나 available slot 부재 시 bucket의
`maximumAdditionalExposureKrw`를 0으로 fail-closed한다. immutable sizing snapshot과 mark provenance,
selection request 저장은 후속 분할 전까지 구현 완료로 간주하지 않는다.

두 번째 분할은 `PortfolioExposureSnapshot` strict payload와 독립
`exposureSnapshotHash` 검증을 구현한다. bucket map은 complete lexical key set, symbol exposure는
canonical `(market, symbol)` 순서와 unique tuple을 강제하고 market/sector/country/currency map도
lexical key 순서로 보존한다. cash를 제외한 position exposure와 모든 dimension 합계가 같아야 한다.
bucket 차원은 bucket 합계와 별도 `unassignedExposureKrw`의 합으로 대조한다. 이 optional 필드는
미분류 보유분의 양수 노출이 있을 때만 기록하며 0, -0, undefined, 비정수·unsafe 값은 거절한다.
기존 분류 완료 snapshot에는 필드를 추가하지 않아 기존 payload hash/ID와 bytes를 유지한다.
market 합계는 symbol tuple에서 다시 집계한 값과 exact-match해야 한다. JavaScript object enumeration이
lexical order를 보존할 수 없는 integer-index 형태의 동적 classification key는 거절하고 `GICS:10`처럼
명시적인 비정수 namespace를 사용한다. 동적 classification map의 0 entry,
non-safe/non-finite/negative-zero 금액, current position exposure를 넘는 pending SELL은
fail-closed한다. full `PortfolioSizingSnapshot`, virtual portfolio/valuation/pending action replay resolver와
append-only repository는 후속 분할 전까지 구현 완료로 간주하지 않는다.

세 번째 분할은 full sizing snapshot에 들어갈 `PortfolioValuationInput`과
`PendingPortfolioActionInput` strict canonical array 계약을 구현한다. valuation은 mark를
`(market, symbol)`, FX를 `(baseCurrency, quoteCurrency)` identity로 중복 없이 정렬하고, pending
action은 `(market, symbol, side, planId, actionId)` 순서와 plan/action unique identity를 강제한다.
BUY는 opening capacity reservation ID/hash, SELL은 remaining quantity와 price evidence ref를
필수 origin으로 보존한다. pending BUY/SELL exposure는 canonical action의 remaining notional 합으로만
safe-integer 계산한다. exact mark/FX coverage, plan/reservation/fill chain replay와 snapshot 결속은 후속
분할 전까지 구현 완료로 간주하지 않는다.

네 번째 분할은 canonical `VirtualPortfolio`, verified exposure, valuation/pending input을 하나의
immutable `PortfolioSizingSnapshot`으로 결속한다. position은 `(market, symbol, strategyBucket)`
identity로 bucket 분할을 보존하면서 stable order와 duplicate 거절을 적용하고, nested set 성격의
risk tag와 price source ref도 정렬한다. snapshot hash는 ID/hash를 제외한 complete payload에서
계산하고 ID는 hash-derived identity로 만든다. portfolio scope, as-of chronology, cash와 pending
BUY/SELL exposure total mismatch는 fail-closed하며 virtual portfolio/position/price 시각도 numeric
offset 또는 UTC를 요구하고 price update는 enclosing position update보다 늦을 수 없다. JSON
hash에서 `0`과 구분되지 않는 virtual portfolio/position의
negative zero numeric field와 JSON persistence에서 누락되는 explicit `undefined` position field도
hash 전에 거절한다. exact mark/FX coverage와 virtual NAV/dimension
재계산, plan/fill/reservation chain replay 및 append-only persistence는 후속 분할 전까지 구현 완료로
간주하지 않는다.

다섯 번째 분할은 저장된 sizing snapshot을 downstream sizing/risk input으로 사용하기 전에
`resolvePortfolioSizingSnapshot`으로 두 hash를 재검증하고 valuation/exposure를 독립 replay한다.
보유 `(market, symbol)`마다 mark가 정확히 하나 있어야 하며 split-bucket position은 같은 mark를
공유한다. KR 보유는 KRW, US 보유는 USD로 분류하고 US exposure가 있으면 exact `USD/KRW` FX
provenance를 요구하며 unused mark/FX도 거절한다. resolver는 mark와 quantity에서 virtual NAV 및
bucket/symbol/market/sector/country/currency exposure를 safe-integer로 재계산하고 저장 exposure
payload/hash와 exact-match한다. strategy bucket이 없는 보유분은 bucket을 합성하지 않고 별도
unassigned exposure로 재생하며 symbol/market/sector/country/currency 및 전체 NAV에는 포함한다.
같은 종목의 assigned/unassigned lot은 각 bucket 여부를 유지하고 하나의 mark를 공유한다.
sector 또는 region이 없는 position과 embedded market price/value/PnL 불일치는 계속 fail-closed한다.
unassigned 필드 누락·잘못된 금액·가짜 bucket 집계는 valuation replay와 다르면 거절한다.
이 표현은 관측된 미분류 보유분의 평가일 뿐 mandate, legacy position-state 원본, BUY 권한이나
실행 승인을 합성하지 않는다. 신규 필드가 있는 artifact를 쓰기 전에 호환 reader를 배포해야 하며,
이후 rollback은 신규 생성을 중단하고 호환 reader를 유지해야 한다. 파일 삭제·자동 변환은 없다.
`resolveBucketSelectionRequest`는 미분류 노출이 있는 snapshot을 gap/slot/capacity 계산 전에 거절한다.
평가·조회 표현을 허용해도 미분류 보유분이 하나라도 있을 때 portfolio 신규 매수를 차단하는 경계는 유지한다.
FX rate는 이미 KRW로 정규화된 `priceKrw`의
conversion provenance이므로 이 분할에서 mark에 다시 곱하지 않는다. plan/fill/reservation chain
replay와 append-only snapshot/request persistence는 후속 분할 전까지 구현 완료로 간주하지 않는다.

FX 원본 연결의 선행 계약으로 `SourceFxEvidenceRecord`의 `source_fx_evidence.v1` strict schema를 제공한다.
현재 valuation/replay 범위와 같은 USD → KRW 방향만 지원하고, 역방향 rate의 자동 역수 변환이나 다른
currency pair를 합성하지 않는다. Semantic hash는 schemaVersion/sourceContractId/baseCurrency/
quoteCurrency/rate/observedAt/sourceRefs 전체를 포함하며 evidenceRef는 `source_fx_evidence` prefix와
hash로 파생한다. 자신의 ref/hash와 ingestion metadata인 createdAt만 hash에서 제외하고,
createdAt ≥ observedAt을 검증한다. createdAt은 durable commit 또는 과거 가용 시각의 증거가 아니다.
생성 함수는 sourceRefs 순서만 canonical 정렬하고, 저장 parser는 순서·중복·전체 payload hash·ID를
독립 재검증한다. Unknown field, 비정상 Unicode/공백 identifier, 잘못된 offset-qualified 시각,
비양수·비유한 rate와 price-domain ref는 거절한다. 결과와 provenance 배열은 immutable이다.
이 계약은 선언된 conversion evidence이며 source 신뢰, freshness, 실제 외부 조회, 저장 원본 또는
snapshot 결속을 보장하지 않는다. 전용 durable FX 저장소와 policy-bound current publisher 연결은
아래 저장 경로 및 PR7의 current publisher에서 추가한다. 기존 FX fixture parser, valuation input/schema,
snapshot 파일을 자동 변환하지 않으며 계약 자체의 추가에 데이터 migration이나 삭제는 없다.

`SourceFxEvidenceFileRepository`는 `source-fx-evidence.jsonl`의 full record entry와 post-record-fsync
commit marker를 별도 line으로 기록한다. Entry hash는 createdAt을 포함한 전체 record, append 시작 시각과
직전 commit hash에 결속되고 marker는 entry hash와 commit 시각을 독립 hash한다. Source contract/pair/
observed instant의 origin 충돌, 같은 ref의 다른 metadata, 중복 ref/origin, chain/chronology 불일치,
누락 marker, blank/torn/비정상 UTF-8 및 duplicate JSON key를 포함한 noncanonical line은 거절한다.
신규 append 후 전체 파일을 다시 read/fsync/recheck하고 exact retry도 실제 descriptor를 fsync한다.
잠금 안의 read는 descriptor bytes/stat 및 pathname이 가리키는 descriptor를 대조한 뒤 관측을 발급한다.
`withDurableVerifiedHistory` callback 동안 writer 잠금을 유지하고 origin/observation token은 callback 종료 시
만료된다. 순수 parser나 caller가 만든 객체는 원본 관측으로 사용할 수 없다. 이 관측도 외부 provider 신뢰,
freshness 또는 과거 시각의 디스크 존재를 인증하지 않으며 비협력 외부 파일 변경은 지원하지 않는다.
경합 timeout은 monotonic clock을 사용한다. 실패 bytes 및 소유권을 잃은/초기화 실패한 잠금은 보존하고,
부분 기록을 자동 삭제하거나 abandoned lock을 탈취하지 않는다. File/close/sync 실패는 전파하며
Windows directory sync EPERM만 기존 정책대로 예외 처리한다. 잠금 삭제 durability는 약속하지 않으므로
crash 후 남거나 재등장한 lock은 명시적 복구 대상이다. 기존 가격 저장소와의 데이터 migration은 없다.

여섯 번째 분할은 valuation/exposure replay를 통과한 snapshot만
`portfolio-sizing-snapshots.jsonl`에 저장하는 strict append-only repository를 구현한다. append와
read 모두 complete log의 schema, nested/outer hash 및 valuation/exposure replay를 다시 검증한다.
snapshot ID exact retry는 기존 record로 수렴하며 같은
`(portfolioId, portfolioVersion, policyHash, asOf)` origin의 다른 payload, duplicate ID/origin,
torn/blank/corrupt line을 거절한다. thread/process writer는 exclusive lock과 file/directory sync로
직렬화하고 abandoned lock은 자동 제거하지 않는다. pending plan/fill/reservation chain replay와
selection request contract/repository는 후속 분할 전까지 구현 완료로 간주하지 않는다.

일곱 번째 분할은 `BucketSelectionRequest` strict contract를 구현한다. request hash는
request ID/hash/createdAt을 제외한 cycle/trigger, portfolio snapshot, policy, bucket gap/slot/cap,
cutoff 전체 semantic payload에서 계산하고 ID는 hash에서 파생한다. gap, available slot,
maximum additional exposure는 양수 safe integer여야 하고 additional exposure는 gap을 넘을 수 없다.
`evidenceCutoffAt <= asOf <= createdAt`을 offset-qualified instant로 검증하며 normalized identifier,
malformed Unicode, unknown field와 stored identity tamper를 거절한다. createdAt은 semantic retry
identity에서 제외한다. snapshot/policy/gap 재해소, trigger 종류별 cutoff 파생과 append-only request
repository는 후속 분할 전까지 구현 완료로 간주하지 않는다.

여덟 번째 분할은 `bucket-selection-requests.jsonl` strict append-only repository를 구현한다.
append/read는 stored request의 complete payload hash와 hash-derived ID를 다시 검증한다. createdAt만
다른 동일 semantic request retry는 최초 record로 수렴하고, `(cycleId, bucket)` origin이 같은 다른
payload는 거절한다. complete history의 duplicate ID/origin, torn/blank/corrupt line을 fail-closed하며
thread/process writer는 exclusive lock과 file/directory sync로 직렬화한다. abandoned lock은 자동
제거하지 않는다. snapshot/policy/gap 재해소와 trigger별 cutoff 검증은 후속 resolver 전까지 구현
완료로 간주하지 않는다.

아홉 번째 분할은 저장된 request가 참조하는 `PortfolioSizingSnapshot`의 ID/hash/scope/as-of를
`resolvePortfolioSizingSnapshot`으로 다시 검증하고, activation-aware caller가 제공한 active runtime
policy와 mandate/reservation replay 경계가 제공한 canonical opening-capacity 입력으로 bucket gap,
available slot, maximum additional exposure를 독립 재계산하는 `resolveBucketSelectionRequest`를
구현한다. replay 후 request eligibility가 사라지거나 gap basis/금액/slot/cap 중 하나라도 다르면
fail-closed한다. 이 resolver는 `entry_floor_on_due_cycle` request를 due로 두고 gap만 재계산하며,
trigger identity/ref 및 canonical `evidenceCutoffAt` 파생은 trigger-specific resolver가 공급하고 검증하는
후속 분할 전까지 구현 완료로 간주하지 않는다.

열 번째 분할은 `PortfolioCycleTrigger`를 `scheduled`, `every_tick`, `policy_event`, `risk_breach`의
strict union으로 구현하고 complete trigger payload hash와 identity/ref/cutoff를 한 경로에서만
파생한다. scheduled는 boundary hash/slot ID/slot end, every-tick은 packet hash/as-of, policy event는
event type/hash/as-of, risk breach는 state-update kind/hash/as-of를 사용한다. Selection request resolver는
파생된 세 필드와 request를 exact-match하고 scheduled/every-tick cadence 및 선언된 policy event trigger
호환성도 검증한다. `risk_breach` cycle은 sell-first reduce-only이므로 selection request에서는
fail-closed한다. Schedule slot, packet, policy event, risk-state update의 원본 immutable record 해소는 각
source-specific resolver 후속 분할 전까지 구현 완료로 간주하지 않는다.

열한 번째 분할은 `every_tick` trigger가 참조하는 기존 `MarketPacket` complete history를 raw JSONL에서
strict schema로 다시 읽어 schema normalization 전 canonical form을 검증하고 각 packet payload hash를
독립 재계산하는 source resolver를 구현한다. trigger의
packet hash는 정확히 하나의 canonical packet으로 해소되어야 하며 `packetAsOf`는 packet에 저장된
`generatedAt`과 exact-match해야 한다. 누락·중복 packet hash, hash가 달라진 payload, cutoff drift와
관련 없는 손상 record도 fail-closed하며 JSON stringify hash 충돌을 만드는 nested negative zero도
canonical packet에서 거절한다. JSON parse 전에 object scope별 decoded member name을 검사해 duplicate
key collapse도 거절하고, raw line과 parse 후 compact JSON 재직렬화가 다르면 numeric precision 및
string escape의 lexical hash collision으로 간주한다. Schedule slot, policy event와 risk-state update의 원본
immutable record 해소는 각 후속 분할 전까지 구현 완료로 간주하지 않는다.

열두 번째 분할은 `every_tick` source resolver를 `BucketSelectionRequest` resolver에 연결한다. every-tick
request는 raw canonical packet history와 bucket policy가 exact-ref한 immutable selection policy를
반드시 제공해야 한다. resolver는 `verified-market-packet.v1` source/evidence contract, policy chronology,
packet portfolio ID, `maximumAgeSeconds`, packet expiry와 candidate market의 bucket `enabledMarkets` 포함을
검증하고, freshness 계산에 쓰는 packet/candidate timestamp는 offset-qualified 형식만 허용하며 source
packet/policy를 결과에 보존한다. 다른 trigger에 every-tick source를 제공하거나 source를
누락·무시하는 경로도 fail-closed한다. 현재 packet contract가 observation count를 증명하지 않으므로
`minimumObservationCount`를 요구하는 market evidence policy도 추정 없이 거절한다. Schedule slot, policy
event와 risk-state update source resolution은 후속 분할 전까지 구현 완료로 간주하지 않는다.

열세 번째 분할은 `PortfolioPolicyTriggerEvent`의 strict immutable contract를 구현한다. regime와 thesis
variant는 portfolio/policy scope, non-empty canonical evidence ref, offset-qualified `asOf`를 공유하고
previous/current 값이 반드시 달라야 한다. event hash는 ID/hash/createdAt을 제외한 complete payload에서
계산하며 ID는 hash-derived identity로 만든다. createdAt만 다른 semantic retry는 같은 identity로
수렴하고 stored payload/hash/ID drift, unknown field, duplicate evidence와 미래 as-of를 fail-closed한다.
Append-only repository, active mandate/evidence source 해소 및 cycle trigger 연결은 후속 분할 전까지 구현
완료로 간주하지 않는다.

열네 번째 분할은 검증된 `PortfolioPolicyTriggerEvent`만
`portfolio-policy-trigger-events.jsonl`에 저장하는 strict append-only repository를 구현한다. append와
read는 complete history의 strict schema와 payload hash/hash-derived ID를 다시 검증한다. 동일 semantic
event의 createdAt-only retry는 최초 record로 수렴하고, duplicate ID/hash, torn/blank/corrupt line을
fail-closed한다. thread/process writer는 exclusive lock과 file/directory sync로 직렬화하며 abandoned
lock은 자동 제거하지 않는다. Active mandate/evidence source 해소 및 cycle trigger 연결은 후속 분할 전까지
구현 완료로 간주하지 않는다.

열다섯 번째 분할은 `policy_event` cycle trigger를 complete immutable policy event history에 exact-bind하는
source resolver를 구현한다. repository/full-log parser가 만든 opaque verified history만 입력으로 받고,
history의 모든 event를 strict parse·rehash하고 duplicate ID/hash를 거절한 뒤
trigger의 event ID가 정확히 하나의 record로 해소되어야 한다. resolved record의 event hash/type/as-of는
trigger와 exact-match해야 하며 관련 없는 손상 event도 무시하지 않는다. Portfolio/policy/market scope,
active mandate와 evidence artifact 해소 및 selection request 연결은 후속 분할 전까지 구현 완료로 간주하지
않는다.

열여섯 번째 분할은 `PortfolioRiskStateUpdateRecord`의 strict immutable contract를 구현한다. market
mark, fill, fee, cash flow와 risk-state variant는 portfolio/policy scope 및 offset-qualified as-of를
공유하고 각 variant의 immutable origin ID/hash를 complete payload에 보존한다. fill accounting scope는
bucket과 legacy portfolio의 strict union으로 분리해 혼합을 거절한다. state-update hash는
ID/hash/createdAt을 제외한 payload에서 계산하고 record ID는 update kind와 hash에서 파생한다.
createdAt-only retry는 같은 identity로 수렴하며 payload/hash/ID drift와 미래 as-of를 fail-closed한다.
Append-only repository와 origin/state replay 및 risk-breach trigger 연결은 후속 분할 전까지 구현 완료로
간주하지 않는다.

열일곱 번째 분할은 `PortfolioRiskStateUpdateRecord`를
`portfolio-risk-state-updates.jsonl`에 보존하는 strict append-only repository를 구현한다. 모든 read와
append는 전체 log를 strict parse·rehash하고 duplicate ID/hash, blank/corrupt line과 torn final line을
fail-closed한다. createdAt-only retry는 최초 record로 수렴하고, thread/process writer는 exclusive lock과
file/directory sync로 직렬화한다. repository/full-log parser만 opaque verified history를 만들 수 있으며
abandoned lock은 자동 제거하지 않는다. 각 update kind의 immutable origin/state replay와 risk-breach cycle
trigger 연결은 후속 분할 전까지 구현 완료로 간주하지 않는다.

열여덟 번째 분할은 `risk_breach` cycle trigger를 complete immutable risk-state update history에
exact-bind하는 source resolver를 구현한다. repository/full-log parser가 만든 opaque verified history만
입력으로 받고 모든 record를 strict parse·rehash하며 duplicate ID/hash를 거절한다. trigger의 update ID는
정확히 하나의 record로 해소되어야 하고 update hash/kind/as-of가 exact-match해야 한다. 관련 없는 손상
record도 무시하지 않는다. 각 update kind의 portfolio/policy scope와 immutable origin/state replay 및
Risk Engine breach 판정 연결은 후속 분할 전까지 구현 완료로 간주하지 않는다.

열아홉 번째 분할은 `policy_event`와 `risk_breach` source resolver가 resolved immutable record의
`portfolioId`와 `policyHash`를 caller의 expected active scope와 exact-match하도록 강화한다. trigger의
ID/hash/type 또는 kind/as-of만 일치해도 다른 portfolio나 policy epoch의 source를 재사용할 수 없으며 scope
drift는 cycle 생성 전에 fail-closed한다. Policy event의 market/evidence/active mandate 검증과 risk-state
update kind별 origin/state replay는 후속 분할 전까지 구현 완료로 간주하지 않는다.

스무 번째 분할은 scheduled trigger를 immutable `ScheduleBoundaryRecord`와 versioned
`SessionCalendarRecord`에서 재현하는 source resolver를 구현한다. boundary/calendar의
ID/version/hash/lineage/market/timezone/createdAt 관계를 다시 검증하고 daily/weekly anchor는 open session
안이면 그대로, session 밖이면 actual close로 정규화한다. hourly는 anchor grid에서 session open 이후의
정시 boundary와 actual close를 생성한다. closed target date는 선언된 previous/next-session rule로 이동하고
같은 actual session으로 모인 slot은 하나로 수렴한다. Canonical slot ID는 boundary/calendar
ID/version/hash/lineage, market, exchange date, interval과 slot end의 complete hash에서 파생한다. Trigger의 boundary hash, slot ID와
slot end가 모두 exact-match하지 않으면 fail-closed한다. Runtime policy/request 연결은 후속 분할 전까지
구현 완료로 간주하지 않는다.

스물한 번째 분할은 scheduled source resolver를 `BucketSelectionRequest` replay에 연결한다. Scheduled
request는 boundary/calendar source를 반드시 제공해야 하며 runtime policy의 bucket cadence ref와
boundary ID/version/hash/lineage가 exact-match해야 한다. Boundary market은 bucket enabled market이어야
하고 boundary는 active runtime policy보다 늦게 생성될 수 없다. 다른 trigger variant에 scheduled source를
주입하거나 source를 생략하면 fail-closed한다. Policy-event source와 evidence/mandate 연결은 후속 분할
전까지 구현 완료로 간주하지 않는다.

스물두 번째 분할은 policy event의 raw evidence ref를 그대로 신뢰하지 않도록
`PortfolioPolicyTriggerEvidenceRecord` strict immutable contract를 구현한다. Regime/thesis variant는
upstream source contract와 immutable artifact ID/hash, portfolio/policy/market, 관측 시각 및 transition
값을 complete payload에 보존하고 thesis variant는 mandate/symbol scope도 필수로 가진다. Evidence hash는
ref/hash/createdAt을 제외한 payload에서 계산하고 ref는 hash-derived identity로 만들며, createdAt-only
retry는 같은 semantic identity로 수렴한다. Unknown field, identity drift, offset 없는 시각, observation보다
이른 생성 시각, 같은 previous/current 값과 noncanonical identifier는 fail-closed한다. Append-only
repository, contract-specific source artifact 검증 adapter, event evidence ref 해소, active mandate 및
selection request 연결은 후속 분할 전까지 구현 완료로 간주하지 않는다.

스물세 번째 분할은 검증된 `PortfolioPolicyTriggerEvidenceRecord`만
`portfolio-policy-trigger-evidence-records.jsonl`에 저장하는 strict append-only repository를 구현한다.
모든 read와 append는 complete history의 schema와 evidence hash/hash-derived ref를 다시 검증하고,
동일 semantic evidence의 createdAt-only retry는 최초 record로 수렴한다. Duplicate ref/hash,
torn/blank/corrupt line을 fail-closed하며 thread/process writer는 exclusive lock과 file/directory sync로
직렬화하고 abandoned lock은 자동 제거하지 않는다. Downstream resolver가 raw array를 verified history로
위조하지 못하도록 opaque history wrapper만 노출한다. Contract-specific source artifact 검증 adapter,
event evidence ref 해소, active mandate 및 selection request 연결은 후속 분할 전까지 구현 완료로
간주하지 않는다.

스물네 번째 분할은 every-tick packet, policy event와 risk-state update resolver가 complete history의
검증 여부를 discoverable Symbol property가 아니라 module-private `WeakSet` identity로 판정하도록
강화한다. 정상 history를 prototype으로 상속하거나 reflection으로 property를 복사해 임의 records를
주입한 wrapper도 verified history로 사용할 수 없어야 하며, parser/repository가 실제 생성한 frozen
instance만 source resolver에 전달할 수 있다. Policy-event evidence/active mandate와 risk-state kind별
origin/state replay 및 selection request 연결은 후속 분할 전까지 구현 완료로 간주하지 않는다.

스물다섯 번째 분할은 `policy_event` cycle trigger의 event `evidenceRefs`를 complete immutable
`PortfolioPolicyTriggerEvidenceRecord` history에 exact-bind한다. Opaque verified history의 모든 record를
strict parse·rehash하고 duplicate ref/hash를 거절한 뒤 event의 각 ref가 정확히 하나의 record로 해소되어야
한다. Resolved evidence의 portfolio/policy/market/type과 regime 또는 thesis transition은 event와
exact-match해야 하며 observation은 event `asOf` 이후일 수 없고 evidence `createdAt`은 event
`createdAt` 이후일 수 없다. 관련 없는 손상 record도 무시하지 않는다. Contract-specific source artifact
검증 adapter, thesis event의 as-of active mandate 및 selection request 연결은 후속 분할 전까지 구현 완료로
간주하지 않는다.

스물여섯 번째 분할은 thesis `policy_event`가 참조하는 mandate를 complete investment mandate
record/event history에서 event `asOf` 기준으로 replay한다. Complete history를 먼저 strict 검증해 cutoff
이후의 손상 record/event를 숨길 수 없게 하고, repository shared lock을 보유한 callback 안에서만 유효한
opaque history lease로 stale generation 재사용을 차단한다. `asOf` 이후 effective event와 event `createdAt`
이후에 알려진 record/event를 제외한 prefix를 다시 검증한다. Exact mandate ID와
portfolio/policy/market/symbol이 일치하고 event cutoff에서 `active` 또는 `review_required`이며
`validFrom <= asOf < expiresAt` 범위 안인 mandate가 정확히 하나여야 한다. Regime event에 mandate history를
주입하거나 thesis event에서 생략하면 fail-closed한다.
Contract-specific source artifact 검증 adapter와 selection request 연결은 후속 분할 전까지 구현 완료로
간주하지 않는다.

스물일곱 번째 분할은 policy-event source resolver를 `BucketSelectionRequest` replay에 연결한다.
`policy_event` request는 opaque verified event/evidence history를 반드시 제공해야 하며 thesis event는
investment mandate repository의 shared-lock lease 안에서 active mandate를 함께 해소해야 한다. Resolved
event market은 bucket enabled market이어야 하고 event `createdAt`은 request `createdAt` 이후일 수 없다.
Thesis mandate의 bucket과 review cadence는 request bucket/runtime policy와 exact-match해야 한다. 다른 trigger
variant에 policy-event source를 주입하거나 policy-event request에서 source를 생략하면 fail-closed한다.
Contract-specific source artifact 검증 adapter는 후속 분할 전까지 구현 완료로 간주하지 않는다.

스물여덟 번째 분할은 `market_mark` risk-state update가 참조하는 immutable
`PortfolioSizingSnapshot`을 risk-breach source resolver에서 독립 재현한다. Market-mark update는 snapshot
source를 반드시 제공해야 하며 resolver는 complete payload hash와 hash-derived ID를 다시 검증한 뒤 update의
snapshot ID/hash, portfolio/policy scope와 `asOf`를 exact-match한다. 다른 update kind에 market-mark source를
주입하거나 market-mark source를 생략하면 fail-closed한다. Fill/fee/cash-flow/risk-state update의 kind별
immutable origin/state replay와 Risk Engine breach 판정 연결은 후속 분할 전까지 구현 완료로 간주하지 않는다.

스물아홉 번째 분할은 `risk_state` update가 참조하는 immutable `BucketRiskState`를 risk-breach source
resolver에서 독립 재현한다. Risk-state update는 bucket risk-state source를 반드시 제공해야 하며 resolver는
complete payload hash를 다시 검증한 뒤 update의 epoch ID, last bucket equity event ID, state hash,
portfolio/policy/bucket scope와 `asOf`를 exact-match한다. 다른 update kind에 bucket risk-state source를
주입하거나 risk-state source를 생략하면 fail-closed한다. Fill/fee/cash-flow update의 kind별 immutable
origin/state replay와 Risk Engine breach 판정 연결은 후속 분할 전까지 구현 완료로 간주하지 않는다.

서른 번째 분할은 `fee`와 `cash_flow` update가 참조하는 immutable `BucketEquityEvent`를 risk-breach
source resolver에서 독립 재현한다. Fee는 `execution_cost`, cash flow는 `capital_flow` event만 허용하며
complete event payload hash와 hash-derived ID를 다시 검증한다. Event ID, plan/action/fill lineage,
portfolio/policy scope와 `asOf`를 update에 exact-match하고 다른 update kind의 event source 주입 및 source
누락을 fail-closed한다. Complete bucket equity event history의 predecessor/state replay, fill update origin과
Risk Engine breach 판정 연결은 후속 분할 전까지 구현 완료로 간주하지 않는다.

<!-- /spom-source -->

## 기존 PR 5의 세부 계약 · 원문 4416–4448행

<a id="spom-source-4416-4448"></a>
<!-- spom-source:4416-4448 sha256:4f0cf34277b6bc0a96ea9d47c72f4bf522318c63fad5d7daabc26d80b826f263 -->


Candidate input 저장의 source 의존성으로 `BucketSelectionRequestFileRepository`는
`withDurableVerifiedHistory`를 제공한다. 기존 request writer와 같은 lock을 consumer 완료까지
유지하고 실제 전체 파일의 strict parsing, ID/hash 및 cycle/bucket unique origin 검증을 재사용한다.
Regular file과 UTF-8 bytes를 확인한 뒤 file/directory sync, 동일 descriptor bytes 및 경로 재개방
identity/size/mtime/ctime 재검증을 수행한다. 파일이 없으면 directory sync 후 부재를 다시 확인하며
빈 artifact를 만들지 않는다. 관측 중 변경, 잘린 마지막 줄 또는 corrupt suffix는 consumer 호출 전에 거절한다.

Private WeakMap의 관측 lease는 callback 성공·실패·lock release 오류 모두에서 만료하며 clone이나
일반 `readAll()` 결과로 대체할 수 없다. 저장 가능한 관측값은 `requestCount`, complete request 배열의
`requestsHash`, flush 뒤 재검증 전 `observedAt`이다. Semantic request hash가 제외하는 `createdAt`도
이 prefix hash에는 포함한다. `resolveObservedBucketSelectionRequestHistory`는 현재 live lease에서
count/hash와 관측 시각을 대조해 과거 prefix를 다시 확인한다. 이후 append와 restart는 허용하지만
과거 prefix 삭제·교체·createdAt 변경은 거절한다. 기존 semantic retry는 최초 저장된 createdAt을 유지한다.
새 관측 발급 시 모든 request의 createdAt이 관측 시각 이하여야 하며, 과거 prefix 재검증에서도
각 request의 createdAt이 저장된 observedAt 이하여야 한다. 시계 역행·미래 시각의 복구 로그는 consumer
호출 전에 거절하고, 시계가 회복된 뒤라도 생성 이전 시각을 가진 과거 관측값을 승인하지 않는다.
동일 시각은 허용하며 offset 표기는 instant로 비교한다.

Lock 획득은 monotonic timeout 내 exclusive open의 EEXIST 및 Windows EPERM만 재시도한다.
Token write/fsync 실패는 재시도하지 않고 소유권을 확정할 수 없는 lock 파일을 복구용으로 보존한다.
기존/교체된 lock을 자동 삭제하지 않으며 wall clock 정지에도 경합 timeout이 끝난다. Consumer는 이미
받은 history를 재사용해야 하고 같은 저장소 재진입은 lock 경합이다.

이 기능은 실제 요청 파일 관측만 증명한다. 원래 append 완료 시각, trigger/policy/snapshot source,
gap/current capacity, feature/eligibility/score/cost/sizing 계산 또는 allocation 권한을 증명하지 않는다.
기존 `resolveBucketSelectionRequest`의 재계산과 실제 원본 결속은 downstream에서 별도로 필요하다.
원본 조회 자체는 candidate input을 저장하지 않는다. 입력 저장은 아래 저장 분할에서 다루며
selector/manual 공용 ledger 연결은 후속이다. 원본 조회의 새 artifact/기존 JSONL 형식과
runtime writer 연결 변경은 없으며 schema/data migration 없이 코드 rollback할 수 있다. 새 조회는
fsync를 수행하므로 pure filesystem read-only API로 보지 않는다. Windows directory sync의 기존 EPERM
제한은 유지하며 실제 저장 장치 장애 복구를 검증했다고 주장하지 않는다.

<!-- /spom-source -->

## 기존 PR 5의 세부 계약 · 원문 4461–5616행

<a id="spom-source-4461-5616"></a>
<!-- spom-source:4461-5616 sha256:9c5fec6dda96f956eddc58b445eb417a5c8fa8b9a6ae723f9b98199d88a8f847 -->

Selector sizing 입력의 첫 분할은 `candidateSizingInput.ts`의 strict `CandidateSizingInputRecord`
계약과 factory/parser 및 순수 request binding이다. Request/portfolio/snapshot/policy/as-of,
market/symbol/bucket, scoring/sizing version과 score, 분류 provenance, feature value/evidence,
모든 exposure cap, liquidity 및 complete execution-cost input을 명시적으로 보존한다. Cost input의
fill rule·fee/tax/spread/slippage·fractional/fill/liquidity/staleness/market-impact parameter는 기존
strict paper execution policy schema를 재사용하되 cost model version을 별도 식별자로 보존한다.
누락된 parameter를 runtime default로 보충하지 않는다.

Sizing input hash는 record ID/hash/createdAt을 제외한 complete payload다. Record ID는 이 hash가
아니라 `requestId + market + symbol` tuple에서 `candidate_sizing_input` domain prefix로 파생한다.
따라서 같은 candidate의 score/feature/cap/model 변경은 같은 ID의 다른 payload hash이며 후속
repository가 이를 exact retry와 구분해 collision으로 거절해야 한다. CreatedAt만 달라지면 ID/hash는
같지만 이 계약 자체가 저장소 retry를 승인하지 않는다.

Factory는 featureDefinitionRef와 각 evidence ref 배열을 UTF-8 순서로 정렬하고 duplicate feature/ref를
거절한다. Parser는 이미 canonical인 순서만 허용하고 hash/ID를 독립 계산한다. Unknown nested field,
필수 parameter 누락, non-finite·음의 0, unsafe/음수 KRW, 범위 밖 ratio, 잘못된 Unicode/identifier와
asOf 이전 createdAt을 거절한다. 결과 전체는 deep-freeze한다. Pure request binding은 request를 독립
파싱하고 request ID, portfolio/snapshot/policy/bucket과 asOf instant 및 생성 순서를 대조한다.

이는 supplied sizing input의 불변 계약이며 실제 feature/evidence/classification source, score와
eligibility/hard gate, exposure/liquidity cap 및 estimatedCostKrw의 독립 재계산을 증명하지 않는다.
Model version 문자열도 지원되는 실행 모델이나 계산 완료라는 증명이 아니다. Versioned 비용 추정은
아래 별도 분할이 담당하며 sizing range 계산, assignment/set 및 shared capacity ledger 연결은 후속이다.
기존 fill simulator의 계산과 다른 추정식을 같은 version의 결과로 합성하지 않는다. 기존 실행 경로에
연결하거나 artifact를 쓰지 않아 migration 없이 코드 rollback이 가능하다.

입력 저장 분할은 `CandidateSizingInputFileRepository`를 통해 계획된
`candidate-sizing-input-records.jsonl`에 canonical input과 실제 원본 관측값을 함께 보존한다.
Request → portfolio sizing snapshot → candidate input 순서로 source/destination lock을 획득하며
전체 조회·신규 append·exact retry 및 live consumer 동안 유지한다. `candidate_sizing_input_entry.v1`은
complete record, request/snapshot prefix 관측값, appendStartedAt, previousCommitHash와 entryHash를
보존하고 `candidate_sizing_input_commit.v1`은 해당 entryHash, committedAt 및 commitHash를 결속한다.
각 조회는 record hash/ID, entry/marker hash·연속 chain·시각·unique input ID를 독립 검증한다.

실제 request prefix에서 request를 찾고 input의 portfolio/snapshot/policy/bucket/as-of 및 생성 순서를
대조한다. 실제 snapshot prefix도 읽어 snapshot ID/hash, portfolio/policy/as-of와 관측 이전 존재 조건을
확인한다. 저장 당시 prefix는 이후 append/restart에서도 다시 검증하며 corrupt suffix를 무시하지 않는다.
같은 request/market/symbol의 완전히 같은 record만 최초 origin 그대로 반환한다. Score/feature/cap/cost/
model 또는 createdAt이 바뀐 동일 identity는 collision이며 새 observation으로 원래 origin을 덮어쓰지 않는다.

Pending barrier를 먼저 sync한 뒤 entry와 commit marker를 각각 append/fsync한다. 모든 단계가 성공한
뒤에만 pending을 제거하고 directory sync한다. Pending 존재, 불완전 pair 또는 corrupt log는 자동 복구하지
않으며 명시적인 복구가 필요하다. Pending 제거 후 마지막 directory sync 실패는 이미 pair가 남아 있을 수
있는 불확실한 결과이므로 성공으로 가정하지 않고 전체 source/log를 다시 검증해야 한다. Commit marker의
작성 시각은 전체 transaction의 durable completion 시각이 아니다. Getter의 durable observation은 새
원본/log flush·bytes/경로 identity 재검증을 마친 callback 동안만 유효하며 종료 시 만료한다. 잘못된 UTF-8,
관측 중 파일 변경, 과거/미래 시각 및 fsync 실패는 fail-closed한다.

저장은 supplied feature/score/cap/cost의 선언을 원본 요청·snapshot과 결속하는 책임이다. 실제 feature와
classification/evidence source 검증, active policy/trigger/gap의 재계산, eligibility·score·cost·sizing output
평가와 assignment/set/공용 capacity CAS는 아직 구현하지 않는다. 저장 성공을 후보 채택이나 mandate 발급
권한으로 사용하지 않는다. 기존 runner/Risk/writer의 자동 연결이나 거래 기본값 변경은 없고 새 opt-in
artifact만 추가한다. 코드 rollback으로 기존 경로를 유지할 수 있으며 신규 artifact를 자동 삭제하지 않는다.

실제 점수 재생 연결은 `resolveStoredCandidateSelectionScore`가 수행한다. 호출자는 storage root와
`sizingInputRecordId`만 지정하며 모델·정책·후보 payload·history prefix를 넘기지 않는다. 실제 전체
dependency/policy/activation snapshot을 읽고 candidate의 `asOf`에 활성인 정책을 해소한다.
후보의 policy hash, bucket과 enabled market을 검사한 뒤 bucket의 exact selection policy가 참조한
모델을 사용한다. 모델 없는 legacy 정책, 다른 version 또는 누락된 모델은 거절한다.

후보의 request → snapshot → input → historical source → evidence lock chain 안에서 시장 지표를
재생하고, 후보의 전체 feature 집합이 검증된 6개 market feature와 같을 때만 점수를 계산한다.
추가 선언 feature는 모델에 들어 있어도 검증된 feature로 승격하지 않는다. 실제 모델의 정규화 경계·
방향·가중치로 재계산한 score와 저장된 selectionScore가 정확히 일치해야 한다. 올바른 hash로
재생성한 잘못된 점수, 다른 모델 version, 변경된 지표도 실패한다.

결과의 `verificationScope: stored_score_replay_only`는 역사적 진단 범위다. 실제 input/evidence origin,
as-of active policy, bucket/selection policy, 독립 계산 결과와 읽은 전체 policy snapshot hash를
반환한다. Policy snapshot은 후보 source lock보다 먼저 읽고 policy lock을 잡은 채 source lock을
역순 획득하지 않는다. 여러 파일을 동시에 잠근 transaction이나 반환 후 유효한 live lease가 아니며,
snapshot hash도 인증 서명 또는 과거 디스크 존재 시각 증명이 아니다. 이후 retirement가 있어도
as-of에 활성인 정책의 과거 score를 재생할 수 있다. 현재 실행에 사용하려면 coordinator가 현재
policy/trigger/capacity와 모든 source를 다시 잠그고 검증해야 한다.

이 경로는 evidence source trust/PIT/cutoff/requiredEvidence/hard gate, 분류·노출·유동성·비용·sizing,
top-N/assignment 또는 Risk 승인을 계산하지 않는다. 성공한 score를 eligibility나 주문 권한으로
사용하지 않는다. Source reader의 기존 fsync/잠금은 수행하지만 candidate/정책/score artifact는
새로 쓰거나 수정하지 않는다. HTTP/MCP/runner 자동 연결과 거래 기본값 변경도 없다. 데이터 형식
변경이 없어 코드 rollback만 가능하며 기존 ref/model reader의 호환성 요구는 그대로 유지한다.
통합 테스트의 모델 가중치·경계는 synthetic 값이며 운용 기본값으로 도입하지 않는다.

`assessStoredCandidateEvidenceRequirements`는 위 실제 score 재생과 정책 해소를 거친 뒤 candidate
origin이 보존한 complete request prefix를 실제 durable request history에서 다시 검증한다. Cutoff는
caller가 입력하지 않고 해당 원본 request에서 읽는다. 이후 정상 append는 허용하지만 prefix 교체와
createdAt 변조는 거절한다. 새로운 함수는 기존 score 진단의 동작이나 반환 형식을 바꾸지 않는다.

각 requiredEvidence의 class/sourceContractId, maximumAgeSeconds와 optional minimumObservationCount를
실제 선택 정책에서 읽는다. 현재 연결된 class는 market_technical뿐이며 fundamental_quality,
portfolio_fit, execution_fit은 market 지표나 score로 대신하지 않고 required_evidence_missing으로
blocked한다. Source contract ID는 exact 비교하며 선언된 ID 일치가 외부 provider 신뢰의 증명은 아니다.
최소 관측 수는 계산 query의 최소값이 아니라 정책 최소값에 다시 대조한다.

Freshness는 request.asOf에서 마지막 원본 observedAt을 뺀 초 단위 값으로 계산한다. 최근 계산·capture
시각 또는 더 오래된 cutoff를 기준으로 age를 줄이지 않는다. 원본 행의 observedAt 또는 createdAt이
evidenceCutoffAt보다 늦으면 각각 observation_after_cutoff/source_materialized_after_cutoff 사유를
남긴다. 모든 원본 행을 검사하며 cutoff/freshness의 정확한 경계는 포함하고 timezone offset은 instant로
비교한다. Stale/count/source mismatch 등 여러 실패 사유는 모두 canonical order로 반환한다.

반환 assessment의 `verificationScope: stored_evidence_content_requirements_only`와 conditionsSatisfied는
이 내용 조건만 평가한 결과다. `sourceTrust: not_evaluated`, `historicalDiskAvailability: not_proven` 및
실행하지 않은 unevaluatedHardGateRuleIds를 함께 보존한다. 기록된 createdAt 비교는 과거 cutoff에 실제
파일이 존재했다는 별도 관측 증거가 아니다. Evidence 계산 자체가 나중에 실행될 수 있으므로 계산
createdAt/commit 시각을 원본 관측 freshness로 대체하지 않는다. 모든 내용 조건이 satisfied여도
eligible·mandate·주문 권한으로 승격하지 않는다. Source trust/PIT, 실제 hard gate, 분류·cap·cost·sizing과
현재 상태/CAS는 별도 실행 경계에서 여전히 필요하다.

Assessment hash는 request/input/policy/selection/evidence identity, cutoff/age, 요구 조건별 결과와
미검증 경계를 포함한 전체 assessment payload를 결속한다. 저장 artifact나 writer는 추가하지 않는다.
기존 score replay 후 request를 다시 관측하는 역사적 진단이며 cross-artifact atomic transaction이나
반환 후 live lease가 아니다. 기존 source lock/fsync 외에 운영 데이터·API·거래 기본값 변경은 없고
코드 rollback에 schema/data migration이나 artifact 삭제가 필요 없다.

Hard gate의 실행 파라미터는 optional `BucketSelectionPolicyRecord.hardGateRules`에 inline으로
보존한다. 별도 version label lookup이나 caller-selected threshold 대신 기존 selection policy의
version/hash/lineage가 전체 rule payload를 결속한다. 지원하는 strict variant는 다음과 같다.

```ts
type CandidateHardGateRule =
  | { ruleId: string; algorithm: "numeric_feature_range.v1";
      featureDefinitionRef: string; minimum?: number; maximum?: number }
  | { ruleId: string; algorithm: "market_interval.v1";
      allowedIntervals: Array<"1m" | "5m" | "15m" | "1h" | "1d"> };
```

Numeric rule은 적어도 한 경계가 있어야 하고 양쪽 경계가 있으면 minimum ≤ maximum이다.
Finite·음의 0 제외·절댓값 Number.MAX_SAFE_INTEGER 이하를 적용하며 equality는 통과한다.
Interval은 하나 이상을 명시하고 duplicate/미지원 값은 거절한다. Factory는 ruleId와 interval을
canonical 정렬하고 parser는 정렬된 기록만 허용한다. Rule definition ID 집합은 hardGateRuleIds와
정확히 같고 numeric feature는 selection policy의 featureDefinitionRefs에 포함되어야 한다.
Unknown algorithm/field, missing/extra/duplicate definition과 임의 실행 expression은 거절한다.

`assessStoredCandidateHardGates`는 실제 score/evidence condition 재생 이후 해소된 policy rule을
그 원본 지표와 interval에 평가한다. 모든 rule에 observedValue, exact rule payload, evidenceRef,
passed/blocked와 reasonCodes를 남긴다. 정의 없는 legacy rule은 missing_rule_definition으로
blocked하고, 경계 위반은 below_minimum/above_maximum, interval 위반은 interval_not_allowed다.
모든 hard gate가 통과해도 required evidence condition이 실패하면 contentChecksPassed는 false다.
전체 evaluation hash는 원래 evidence assessment hash, selection policy hash, 모든 rule 결과와
미검증 source 경계를 결속한다.

이는 `stored_market_hard_gate_content_only` 범위이며 provider trust/과거 디스크 존재, lifecycle,
분류·exposure·cost·sizing·현재 capacity/CAS·최종 eligibility/주문 승인은 포함하지 않는다.
기존 historical schema에 없는 lifecycle 상태를 임의로 active로 간주하지 않는다. 모든 내용 조건이
통과해도 sourceTrust=not_evaluated, historicalDiskAvailability=not_proven을 유지한다.

Ref 없는 legacy 정책과 마찬가지로 hardGateRules 없는 정책의 기존 bytes/hash는 유지한다. 새 필드를
누락했다고 이름만으로 기본 규칙을 합성하지 않는다. 배포는 새 reader 먼저, 명시적인 규칙을 담은
새 policy record/활성화 순서다. Old strict reader는 새 필드를 읽지 못하므로 rollback 시 새 정책을
비활성화하고 호환 reader를 유지해야 한다. 기존 record에서 field를 소급 제거하거나 artifact를
삭제하지 않는다. 이 PR에서 운영 policy 활성화, 저장 형식 변환, API/runner/거래 기본값 변경은 없다.

후보 비용 추정의 명시적 알고리즘은 `candidate_reference_notional_cost.v1`이다.
`calculateCandidateExecutionCost`는 complete execution-cost parameter에서 estimatedCostKrw만 제외한
입력을 받고, `referenceNotionalKrw`를 이미 정해진 계산 기준 금액으로 사용한다. Side와 비용률에 따라
다음 각 항목을 원 단위로 올림하고 합산한다.

```text
fee       = ceil(referenceNotionalKrw × feeBps / 10000)
tax       = SELL ? ceil(referenceNotionalKrw × taxBps / 10000) : 0
slippage  = ceil(referenceNotionalKrw × slippageBps / 10000)
spread    = ceil(referenceNotionalKrw × halfSpreadBps / 10000)
impact    = ceil(referenceNotionalKrw × participationRate × marketImpactBpsPerParticipationRate / 10000)
estimatedCostKrw = fee + tax + slippage + spread + impact
```

비용률은 finite·nonnegative·음의 0 제외·MAX_SAFE_INTEGER 이하이며 모든 파라미터가 명시되어야 한다.
각 JS number의 canonical decimal 표기를 기존 canonicalQuantityUnits/BigInt로 변환해 계산하므로 binary
곱셈의 경계 오차나 작은 양수의 underflow로 비용이 사라지지 않는다. 기준 금액 0과 participation 0은
해당 비용 0이다. 개별 비용 또는 합계가 safe-integer KRW를 넘으면 clamp하지 않고 거절한다.
증거 ref는 canonical unique 순서여야 한다. Complete input hash 및 모든 component/rounding/scope를
포함한 output hash를 반환하고 `parseCandidateExecutionCost`는 재해시뿐 아니라 전체 수식을 재계산한다.

이 모델은 기존 `paper_cost_model.v5` 또는 `execution_simulator.v4/v5`가 아니다. 해당 legacy version을
자동 매핑하지 않으며 새 계산기는 거절한다. 기존 fill simulator는 가격·수량·slippage 가격 반올림과
실제 fillable volume을 사용하므로 이 기준 금액 모델과 parity나 실제 비용의 상한을 주장하지 않는다.
fillRatio·fractionalShares·volume participation cap·staleness 설정도 input hash에 보존하지만 이미 지정된
기준 금액에 fillRatio를 다시 곱하거나 수량·체결 상태를 합성하지 않는다. 이 값들은 추후 fill/sizing
단계에서 별도로 적용해야 하며 비용 추정만으로 liquidity limit 준수를 증명하지 않는다.

`replayCandidateSizingExecutionCost`는 complete sizing input을 독립 파싱한 뒤 계산한 비용과 저장된
estimatedCostKrw의 정확한 일치를 요구한다. `resolveStoredCandidateExecutionCost`는 실제 저장 ID만 받아
기존 score/evidence/hard gate 경로를 거친 input의 비용을 재생한다. Caller override, 잘못된 비용을 담은
정상 hash의 record, unknown model과 손상된 실제 source는 거절한다. Hard gate가 blocked여도 진단용
비용 재생은 가능하지만 evidenceAndHardGateConditionsSatisfied=false를 그대로 보존한다.

반환 범위는 `stored_reference_notional_cost_only`이며 costParameterAuthority/costEvidenceAuthority는
not_verified, fillSimulation은 not_performed다. 아직 비용 파라미터의 active policy 선택, 실제 비용
source/participation/reference notional, 분류·cap·최종 sizing·eligibility·현재 실행 권한을 검증하지 않는다.
새 artifact, 운영 정책 활성화, writer/runner/API 또는 거래 기본값 변경은 없다. 기존 저장 parser는
변경하지 않아 legacy record는 그대로 읽히며 새 계산기를 사용하지 않으면 기존 동작에 영향이 없다.
코드 rollback에 데이터 변환이나 artifact 삭제는 필요 없고 새 버전 재생 기능만 사용할 수 없게 된다.

`resolveStoredPolicyCandidateExecutionCost`는 비용 선언의 산술 재생에 실제 as-of bucket 정책의
모델 선택과 파라미터 결속을 추가한다. 먼저 실제 dependency/policy/activation snapshot을 읽고 그 전체 hash를
기존 score/evidence/hard gate/cost 재생이 읽은 policySnapshotHash와 정확히 대조한다. 두 읽기 사이의
append라도 다른 generation을 혼합하지 않고 거절하며, 새로운 전체 호출로 재시도할 수 있다. Policy
snapshot은 candidate source lock보다 먼저 읽어 역순 잠금을 추가하지 않는다.

후보 asOf의 active bucket이 참조한 risk rule set에서 `paper_execution v1`을 찾고 side 적용 여부를
확인한다. Exact parameter record의 `portfolio_execution_rule.v1`과 candidate market 설정을 strict
파싱한 뒤 fill rule, fee/tax/slippage/spread/impact, fillRatio, fractional, participation cap, minimum
liquidity fill ratio와 stale 설정 전체를 candidate와 대조한다. Legacy reduce-only scope 또는 caller가
지정한 다른 파라미터로 대체하지 않는다. BUY에서 계산에 사용하지 않는 tax 설정도 일치해야 한다.
올바른 비용을 다시 계산해 저장했어도 정책과 파라미터가 다르면 거절한다.

결과는 exact rule-set/parameter ref, activation identity, policy/snapshot hash, 두 모델 version,
execution parameters와 비용 재생 assessment hash를 보존한다. Scope는
`stored_as_of_cost_parameter_binding_only`, costParameterAuthority는 as_of_policy_bound다.
선택 정책의 optional costEstimationModelVersion은 complete policy hash/identity/lineage에 포함된다.
강화된 비용 재생은 이 필드가 존재하고 실제 candidate 계산기의 modelVersion과 정확히 같은지 검사한다.
필드 누락이나 다른 version은 비용과 실행 파라미터가 일치해도 거절한다. Model 선택까지 검증한 결과의
costEstimationModelSelection은 as_of_selection_policy_bound다. Unknown model label을 정책 record로
보존할 수 있어도 지원되는 계산기로 재생되지 않으면 승인하지 않는다. Runtime 기본 모델은 합성하지 않는다.
이는 모델·파라미터의 as-of 정책 출처를 증명하지만 비용 증거의 진위는 증명하지 않는다. costEvidenceAuthority는 not_verified,
fillSimulation은 not_performed이고 이전 hard gate 실패를 그대로 유지한다. 가격 source allowlist와
freshness 설정도 원래 parameter ref에 결속되지만 이 함수 자체가 price evidence를 읽지는 않는다.
이후 정책 retirement가 있어도 과거 진단은 가능하며 현재 실행 권한으로 사용하지 않는다.

산술 전용 `resolveStoredCandidateExecutionCost`의 반환 형식과 candidate 입력 저장 계약·writer·정책
활성화·거래 기본값은 변경하지 않는다. 정책 결속 함수는 모델 선택 검사를 추가하고 해당 결과 값을
not_verified에서 as_of_selection_policy_bound로 변경한다.
새 API나 artifact는 없다. costEstimationModelVersion 없는 legacy policy의 기존 bytes/hash는 유지된다.
다만 강화된 함수는 모델 선택 필드가 없거나 실행 규칙/해당 시장 파라미터가 없는 legacy 기록을 거절한다.
기존 산술 전용 비용 진단은 계속 사용할 수 있다. 새 필드가 있는 정책은 호환 reader를 먼저 배포한 뒤
새 policy record로 활성화한다. Old strict reader가 새 필드를 거절하므로 rollback 시 새 정책 사용을
중단하고 호환 reader를 유지하며 append-only 기록에서 필드를 소급 삭제하지 않는다. 운영 정책 활성화와
데이터 변환은 실행하지 않았다.

일봉 기반 유동성 재생은 `candidate_daily_bar_liquidity.v1`을 선택 정책의 optional
`liquidityEstimationModelVersion`으로 명시한 경우에만 수행한다. `calculateCandidateDailyLiquidity`는
complete market evidence를 독립 재생하고 `interval=1d`를 요구한다. 분봉을 일봉으로 외삽하지 않는다.
각 일봉의 `lastPriceKrw × volume` 합을 관측 수로 나눈 뒤 원 단위로 내린 값을
`averageDailyNotionalKrw`에 저장한다. 이는 관측 일봉의 마지막 가격 기준 명목금액 proxy이며 실제
체결 거래대금, 거래일별 완전성, 휴장·누락 자료 또는 공식 provider의 신뢰성을 증명하지 않는다.
별도의 시장 통계로 승격하지 않으며 새로운 운용 기본 모델을 합성하지 않는다.

`maximumLiquidityNotionalKrw`는 위 정수 평균과 명시적 참여율을 곱해 다시 내린다. 합과 나눗셈은
BigInt, 참여율은 저장된 숫자의 canonical decimal units를 사용하여 중간 합 overflow와 이진 소수의
경계 오차를 피한다. 0 거래량/0 참여율은 0 한도이고 최소 금액으로 올려주지 않는다. 가격·거래량과
각 봉의 명목금액은 기존 evidence 계산기의 safe-integer 검증을 통과해야 한다. 결과의 inputHash와
outputHash는 complete evidence/모델/참여율 및 전체 계산 결과를 결속하고 parser는 독립 재계산한다.

`resolveStoredCandidateDailyLiquidity`는 실제 저장 정책 기반 비용 재생 결과를 사용한다. 동일
as-of selection policy의 유동성 모델을 확인하고 실제 `paper_execution` 파라미터의
`maxVolumeParticipationRate`를 참여율로 사용한다. Candidate에 기록된 전체 liquidityInput은
재계산한 평균·참여율·한도·exact evidenceRef와 정확히 같아야 한다. 호출자는 모델·원본·참여율을
덮어쓰지 못한다. 실제 후보 source chain에서 관측한 immutable evidence를 그대로 재생하므로
별도의 source 읽기를 섞거나 새로운 lock을 추가하지 않는다.

결과는 `stored_daily_bar_liquidity_only`이며 비용 재생 assessment hash와 유동성 output hash를
보존한다. 이전 evidence/hard gate 실패를 유지하고 sourceTrust는 not_evaluated,
historicalDiskAvailability는 not_proven이다. 실제 비용 참여율/reference notional, 분류·exposure
cap·sizing range, top-N/assignment, 현재 실행 권한이나 fill까지 검증하는 결과가 아니다.

새 파일 artifact, writer, HTTP/MCP/runner 및 거래 기본값은 변경하지 않는다. Legacy 정책의 필드
누락과 기존 bytes/hash는 유지되지만 새로운 유동성 함수는 모델 미선택으로 거절한다. 기존 비용 진단
함수는 변경하지 않는다. 새 정책 필드는 호환 reader를 먼저 배포한 뒤 새로운 정책 record로 도입한다.
이전 strict reader가 새 필드를 거절하므로 rollback 시 호환 reader를 유지하고 새 모델 사용을
중단해야 하며 append-only 기록을 소급 수정·삭제하지 않는다. 실제 운영 정책 활성화는 실행하지 않는다.

비용 참여율의 원본 재생은 선택 정책이 `costBasisModelVersion`으로
`candidate_daily_liquidity_cost_basis.v1`을 명시한 경우에 수행한다. 비용 모델과 유동성 모델을 각각
선택했다는 이유만으로 둘 사이의 참여율 정의를 추론하지 않는다. `calculateCandidateDailyCostBasis`는
complete daily liquidity 결과를 독립 재생하고 선언된 `referenceNotionalKrw`가 계산된 유동성 한도
이하인지 검사한다. 참조금액의 선정 자체, 현금·분류별 노출 한도 또는 최종 sizing을 승인하지 않는다.

참여율은 참조금액/정수 일봉 명목금액 평균으로 계산한다. 양수 참조금액은 양수 유동성을 요구하며
0 참조금액의 참여율은 0이다. 기본 JS 나눗셈 결과의 canonical decimal 값이 정확한 유리수보다 작으면
다음 큰 representable number로 한 단계 올린 뒤 BigInt 교차 곱으로 재검증한다. 예를 들어 1/3은
0.33333333333333337이다. 임의 epsilon을 더하지 않으며 참여율 과소 계산으로 비용이 줄지 않게 한다.
이 반올림은 일봉 proxy 비용 입력 전용이고 실제 체결 참여율이나 기존 simulator의 모델을 변경하지 않는다.

`resolveStoredCandidateDailyCostBasis`는 실제 유동성 재생 결과의 동일 선택 정책과 immutable 자료를
사용한다. 모델 선택과 참조금액 한도를 확인하고 candidate 비용 입력의 participationRate 및 전체
evidenceRefs가 재계산한 값과 exact 일봉 evidenceRef 하나에 일치해야 한다. 비용 산술·정책 파라미터가
맞더라도 다른 참여율 또는 ref는 거절한다. 전체 입력/결과 hash, 이전 liquidity assessment hash를
보존하고 기존 evidence/hard gate 실패를 유지한다.

결과 scope는 `stored_daily_liquidity_cost_basis_only`, costEvidenceBinding은 stored_daily_bar_proxy,
referenceNotionalAuthority는 declared_within_liquidity_cap이다. SourceTrust는 not_evaluated,
finalSizing은 not_performed로 남는다. 원본/정책/모델/참여율을 caller가 주입하지 못하며 기존 실제 파일
검증의 corruption·generation·lineage 방어를 재사용한다. 새 source 조회·lock·artifact·writer·API 또는
거래 기본값 변경은 없다. Runtime 기본 모델이나 투자금액을 합성하지 않는다.

`costBasisModelVersion`은 optional이라 legacy bytes/hash를 유지하지만 새 함수는 누락을 거절한다.
기존 비용·유동성 진단은 그대로 유지한다. 새 정책은 호환 reader 배포 후 새 record로 도입해야 하며,
이전 strict reader로 rollback하려고 append-only 필드를 제거하지 않는다. 새 모델 사용을 중단하고
호환 reader를 유지해야 한다. 실제 운영 정책 활성화나 데이터 변환은 실행하지 않는다.

후보의 현금 입력은 `resolveStoredCandidateCashCapacity`에서 실제 as-of 정책과 원래 저장
스냅샷에 결속한다. 앞선 일봉 비용 기준 재생 후, candidate 저장 시 관측한 snapshot prefix를
새 durable lease에서 다시 검증하고 exact snapshot ID/hash·portfolio·policy·as-of를 대조한다.
스냅샷의 mark/FX/exposure도 독립 재생하며 새 append 이후에도 원래 입력을 사용한다.

`cashAvailableKrw`는 이 경로에서 reserve와 pending BUY gross를 차감한 뒤, 이번 후보 비용을
차감하기 전의 현금 상한이다. Reserve는 기존 gap/Risk와 동일하게
`max(minimumCashReserveKrw, round(virtualNetWorthKrw * targetCashRatio))`다. 차감마다 0에서
포화시키고 pending SELL 대금을 가산하거나 caller ID로 pending BUY를 면제하지 않는다.
선언된 cashAvailableKrw가 계산값과 다르면 거절한다. 실제 모델로 재생한 이번 후보 비용과
참조금액이 이 현금 상한 안에 들어오는지는 overflow 없는 차감 비교로 평가한다. 부족하면
`cashConditionSatisfied: false`이며 0 참조금액을 포함한 진단 결과가 거래 가능성을 뜻하지 않는다.
SELL을 BUY cash capacity로 재해석하는 호출은 거절한다.

범위는 `stored_snapshot_cash_upper_bound_only`다. Pending BUY의 추가 비용과 reservation/plan
원본은 아직 재생하지 않으므로 `pendingCostAndReservationAuthority: not_verified`를 유지한다.
따라서 이 값은 최종 사용 가능 현금이나 reservation 승인이 아니다. Evidence/hard gate 실패는
그대로 전달하며 분류·다른 노출 cap·request capacity·최종 sizing과 현재 실행 권한은 후속이다.
새 writer/API/정책 필드/저장 형식과 거래 기본값 변경이 없고 데이터 변환 없이 코드 rollback이
가능하다. 과거 candidate가 임의 현금값을 가졌다면 새 검증이 거절할 수 있으며 append-only 원본을
소급 수정하지 않는다. 실제 장치 장애·운영 배포·전체 운용 E2E는 이 분할의 검증 범위가 아니다.

분류 원본 연결은 `candidate_packet_classification.v1`로 명시한다. 선택 정책의 optional
`classificationModelVersion`이 이 모델을 선택했을 때만 `resolveStoredCandidateClassification`을
사용한다. `classificationEvidenceRef`는 complete packet hash·market·symbol·모델의 content address다.
실제 market packet JSONL 전체를 canonical parsing한 뒤 exact ref와 packet ID가 각각 한 번만
해소되어야 한다. Packet portfolio와 후보 market/symbol을 확인하고, 선언된 sector/region 및 시장
결제통화를 재생하여 candidate의 모든 exposureKeys와 대조한다. 순수 parser도 전체 packet과
projection을 독립 재생하므로 output만 수정해 재해시한 입력을 거절한다.

`country`는 기존 portfolio snapshot의 `position.region`과 같은 KR/US/GLOBAL 지역 분류이며 기업
법적 소재지를 뜻하지 않는다. `currency`는 KR→KRW, US→USD 시장 결제통화이고 ETF·기업의 실제
look-through 환위험을 뜻하지 않는다. Sector는 명시적인 값이 필요하고 공백/비정규 Unicode,
배열 인덱스 형태 및 prototype 관련 예약 key를 거절한다. Source refs는 중복 없이 보존한다.
관측된 strategyBucket은 metadata로만 반환하며 후보 bucket 배정에 사용하지 않는다.

Candidate collectedAt은 packet generatedAt 이하여야 하고 generatedAt은 expiresAt/staleAfter보다
엄격히 이전이어야 한다. 실제 연결은 generatedAt ≤ request evidenceCutoffAt 및 request asOf가
두 만료 시각보다 엄격히 이전임을 요구한다. 분류·현금·기존 evidence/hard gate 결과는 각각 구분한다.
분류가 일치한다고 required portfolio_fit evidence나 최종 eligibility로 승격하지 않는다.

Scope는 `stored_packet_classification_content_only`이며 source trust와 과거 디스크 가용성은
검증하지 않는다. Canonical packet read는 durable lease가 아니며 임의 파일 재작성에 대한 외부 인증이
아니다. 후속 정상 append는 기존 분류 projection을 바꾸지 않지만 관측한 전체 sourceHistoryHash와
record count는 바뀐다. Corrupt/torn/비canonical suffix 또는 중복 원본은 자동 수리하지 않는다.
새 artifact/writer/API·거래 기본값 변경은 없다. Legacy 정책에는 필드를 합성하지 않으며 새 함수는
모델 누락을 거절한다. 새 정책 사용 전 호환 reader를 배포하고 rollback 시 호환 reader를 유지한 채
새 모델 사용을 중단한다. Append-only 정책 필드를 소급 제거하지 않는다. 실제 외부 source 호출,
운영 정책 활성화, 노출 cap·최종 sizing·배정·전체 운용 E2E는 후속이다.

분류 projection과 content ref의 symbol은 `candidateSizingInputPayloadSchema.shape.symbol`을
재사용해 기존 후보의 1~240자 canonical 식별자 계약을 유지한다. 업종·source ref의 160자
제한을 종목 식별자에 적용하지 않는다. 161자·240자 후보는 실제 historical 원본과 packet을
저장한 통합 재생으로 검증하며 241자·공백 정규화·잘못된 Unicode는 거절한다.
업종 key는 `prototype`과 `Object.prototype`의 모든 own property 이름을 거절한다.
`toString`, `valueOf`, `hasOwnProperty`처럼 기존 plain-object 노출 합산에서 상속값을
읽게 만드는 이름도 저장 packet 분류 단계에서 차단한다.

보유분 기준 노출 상한 분할은 `candidate_position_exposure_bounds.v1`이다. 선택 정책의 optional
`exposureLimitPolicy`는 modelVersion과 (0, 1]의 maximumSectorExposureRatio를 함께 보존한다.
선택 정책 hash/ID/lineage가 두 값을 결속하고 legacy 정책에 필드나 기본 한도를 합성하지 않는다.
업종 비율은 해당 선택 정책이 후보 편입에 요구하는 portfolio-wide 업종 ceiling이며, 모든 bucket에
새 전역 기본값을 설정하는 의미가 아니다. Bucket은 실제 runtime bucket maxWeightRatio,
symbol/country/currency는 실제 runtime exposurePolicy를 사용한다.

`calculateCandidatePositionExposureBounds`는 supplied runtime policy, exact selection policy ref,
완전한 sizing snapshot과 packet classification을 독립 재생하고 scope/model/chronology를 확인한다.
각 상한은 canonical decimal NAV×ratio의 BigInt 곱을 원 단위로 내림하며 보유 exposure를 차감하고
0에서 자른다. Symbol은 market+symbol 전체 보유분, sector/country/currency는 모든 bucket의 보유분,
bucket은 대상 bucket만 차감한다. 전체 input/output hash와 independent parser를 제공한다.

`resolveStoredCandidatePositionExposureBounds`는 실제 분류·현금·스냅샷 원본 경로 뒤에서 이 계산을
수행하고 후보가 선언한 다섯 cap 각각이 position-only 상한 이하인지 진단한다. 낮은 선언 cap의
정확성은 증명하지 않는다. Scope는 `stored_position_exposure_upper_bounds_only`, exactCandidateCaps와
pendingAndReservationAuthority는 `not_verified`, finalSizing은 `not_performed`다. Pending BUY/SELL
총액은 결과에 보존하지만 보유 노출과 혼합하지 않으며 SELL 예정 금액으로 보유 여력을 늘리지 않는다.
대기 BUY의 분류별 차감·opening reservation·request budget·비용·최종 sizing 검증은 후속이며
allDeclaredCapsWithinPositionBounds를 eligibility 또는 execution 권한으로 사용하면 안 된다.

새 writer/API·정책 활성화·거래 기본값 변경은 없다. 기존 artifact는 계속 읽을 수 있지만 신규 필드가
있는 정책은 이전 strict reader가 거절하므로 호환 reader를 먼저 배포해야 한다. Rollback 시 새 모델
사용을 중단하고 신규 필드를 읽는 reader를 유지한다. Append-only 정책을 소급 수정하지 않는다.

완료 조건:

- 같은 입력은 같은 ordering과 reason code를 만든다.
- policy가 요구하는 evidence/source/freshness rule을 exact record에서 읽는다.
- required evidence가 없는 candidate는 fail-closed한다.
- assignment 전체 payload rehash와 eligibility/score/reason code 재계산이 일치한다.
- sizing input record에서 feature, exposure/liquidity cap과 cost input을 재구성해 같은 hash와
  output range를 만든다.
- 같은 snapshot의 selector와 manual 요청이 경합해도 unique slot과 opening budget을 초과하지 않는다.
- mandate만 활성화되고 fill이 늦어져도 unused opening capacity가 해제되지 않는다.

#### 후보 assignment와 요청 단위 budget 결과 계약

`candidateAssignment.ts`는 CandidateAssignment의 strict content contract와 supplied request/sizing
binding을 구현한다. Factory는 reason/evidence ref를 canonical sort하고 duplicate를 거절한다.
Assignment ID는 request/market/symbol에서 파생하며 assignmentHash는 ID/hash/createdAt을 제외한
전체 payload를 결속한다. SizingOutputHash는 min/target/max weight와 maximumNotionalKrw를 별도로
결속한다. Parser는 range 순서, finite ratio·음의 0 제외·safe integer 금액, 생성 시각, ref 순서와 두
hash를 독립 검증한다. 생성 시각은 identity에서 제외되지만 미래 저장소의 exact retry는 전체
record를 비교해야 한다.

`resolveCandidateAssignmentSizingBinding`은 supplied request 및 sizing input을 각각 독립 파싱한 뒤
request/portfolio/policy/snapshot/bucket/asOf, sizing input ID/hash, instrument, scoring model/score와
생성 순서를 대조한다. 이는 declared score/eligibility, cap 또는 target range의 독립 계산을 의미하지
않는다. Scope는 supplied_assignment_content_binding_only이고 eligibilityAndExactSizing은
not_verified, currentExecutionAuthority는 not_granted다.

`candidateAssignmentSet.ts`는 supplied assignment 전체의 request-local ordering과 budget 예약 결과를
계산한다. Eligible을 먼저 두고 같은 eligibility 우선순위에서는 score 내림차순, market/symbol
canonical 순으로 정렬한다. Watch와 blocked 사이에 별도 우선순위는 넣지 않는다. Request budget은
min(gapKrw, maximumAdditionalExposureKrw)이며 앞의 min(availableSlots, eligibleCount)개에 대해
individual maximum과 남은 budget의 최솟값을 BigInt 정수로 순차 예약한다. 0원은 selected 목록에서
제외하지만 N 밖 후보로 보충하지 않는다. selectedRank는 기존 selector mandate와 같은 1-based 순위라서
0원 candidate가 있으면 빈 rank가 남을 수 있다. 이는 전역 reservedSlotOrdinal이 아니다.

Set parser는 full hash/ID, 후보 identity·중복·정렬, selected identity/rank, positive reservation과
budget 합계를 검사한다. Ordered rows에 individual maximum이 없으므로 구조 parser만으로 정확한
개별 예약액이나 누락된 selection을 증명하지 않는다. `resolveCandidateAssignmentSetBinding`은
실제 전달된 request/assignment 전체로 factory를 다시 실행하고 full record가 같은지 검사한다.
같은 값들의 입력 순서만 바뀌면 같은 set이 나온다. Scope는 supplied_assignment_set_allocation_only다.

이 분할은 assignment/set 저장소, request당 단일 seal, actual source completeness, eligibility 및
최종 sizing 재계산, 공용 ledger slot/notional CAS와 mandate 발급을 완료하지 않는다. Hash가 맞는
supplied input을 실제 저장된 원본이나 current capacity 승인으로 승격하지 않는다. 기존 API/writer/
artifact reader와 거래 기본값 변경이 없으며, 신규 contract 사용 중단과 코드 rollback에 기존 데이터
변환·삭제가 필요하지 않다.

#### 후보 결과의 실제 원본 저장과 요청별 단일 확정

`CandidateAssignmentFileRepository`는 assignment와 set을 같은
`candidate-assignment-records.jsonl`의 entry/commit pair로 저장한다. `appendAssignment`는 실제
request/snapshot/sizing input 이력을 잠근 상태에서 입력 ID/hash, scope, score/model 및 생성 시점을
대조한다. `sealRequest(requestId)`는 외부 후보 목록이나 배분 결과를 받지 않고 같은 journal에 앞서
저장된 해당 request의 전체 assignment로 순위·top-N·예산을 독립 재계산한다. Empty request도 실제
request가 존재할 때만 빈 set으로 확정할 수 있다. 이는 후보 탐색이 완료됐다는 증거는 아니다.

잠금 순서는 request → snapshot → sizing input → assignment다. Sizing input reader의 callback은
이미 보유한 request history lease를 두 번째 인자로 제공해 request lock 재진입 없이 원본을 재사용한다.
기존 단일 인자 callback과 파일 형식은 유지한다. Assignment와 set은 같은 writer lock을 공유하므로
확정과 추가가 경쟁해도 추가가 먼저 저장돼 set에 포함되거나, 확정 후 추가가 거절되는 결과만 허용한다.
확정 후 같은 assignment의 exact retry와 같은 request seal retry는 원래 record를 반환하고 쓰지 않는다.
다른 payload/createdAt의 같은 assignment ID, 두 번째 set 및 확정 후 신규 assignment는 거절한다.

Entry는 kind, complete record, 실제 request prefix observation과 sizing input prefix count/generation,
관측·append 시각 및 previous commit hash를 결속한다. Record fsync 후 채집한 committedAt과 entry hash는
별도 marker hash로 결속한다. Reader는 전체 journal과 원본 이력을 먼저 검증하고, 저장된 prefix를 현재
잠긴 source에 대조한 뒤 assignment/set을 순서대로 재생한다. Set의 후보 누락이나 개별 배분 변조는
hash를 다시 계산했어도 앞선 실제 assignment 전체와 달라 거절한다. 원본 commit이 결과 createdAt보다
늦은 경우도 거절하지만 이 비교만으로 marker 자체의 flush가 과거 createdAt 전에 완료됐다고 증명하지 않는다.

쓰기 시작 전 pending barrier를 sync하고 entry/marker 저장과 sync가 끝난 뒤 제거한다. Interrupted pair,
pending barrier, torn line, invalid UTF-8, 원본/이력 변조 또는 관측 도중 교체는 자동 수리 없이 fail-closed한다.
잠금 획득의 EEXIST/Windows EPERM만 monotonic timeout 내 재시도한다. 초기화 실패·소유권 변경·abandoned
lock은 자동 삭제하지 않는다. Callback lease는 종료/예외 시 폐기하며 clone이나 만료된 history는 사용할 수 없다.

이 기능이 보장하는 completeness는 **현재 남아 있는 journal에서 해당 seal보다 앞선 assignment 전체**다.
Universe 탐색 완료, 파일 전체 또는 완전한 suffix 삭제 탐지에는 별도의 외부 checkpoint/선택 완료 증거가
필요하다. Eligibility/required evidence/최종 sizing 재평가, 현재 shared capacity CAS, 실제 mandate 발급과
paper orchestrator 연결은 후속이다. 저장 성공을 실행 승인으로 사용하지 않는다. 기존 artifact/API/default는
변경하지 않으며 rollback은 신규 저장소 사용 중단과 코드 복구로 가능하다. 불완전 barrier는 원본과 실행 중인
writer 유무를 확인하는 별도 복구가 필요하고 자동으로 지우지 않는다.

#### 대기 action의 실제 계획 진행 이력 연결

`pending_plan_action_progress.v1`은 full plan/event chain을 독립 재생해 approved 또는
execution_applied 상태의 모든 미완료 action을 계산한다. 다음 실행 action만 선택하지 않으며
previewed/rejected/stale/applied 및 목표가 완료된 action은 제외한다. `remainingNotionalCapKrw`는
action maximum에서 cumulative filled notional을 뺀 값이다. Fractional BUY의
`remainingTargetNotionalKrw`와 quantity target의 canonical decimal `remainingQuantity`는 별도로
보존한다. Quantity target의 reference notional에서 실제 fill 금액을 뺀 값을 잔여 평가금액으로
사용하지 않는다. 수량이 남고 금액 cap이 0인 action도 누락하지 않으며 실행 가능으로 승격하지 않는다.
전체 입력·결과 hash와 independent parser는 잔여값을 바꾼 뒤 재해시한 결과도 거절한다.

`resolveStoredPendingPlanActionProgress`는 실제 plan/event repository의 durable full-history
검증 뒤 portfolio 전체의 commit-cutoff prefix를 재생한다. 이전 policyHash의 대기 계획도 포함하고
foreign portfolio 및 cutoff 이후 suffix의 손상을 무시하지 않는다. Event의 주장 asOf가 아니라
저장 commit 시각이 cutoff보다 엄격히 앞선 event만 포함하며 동일 밀리초 경계는 모호하므로 거절한다.
Cutoff는 조회 시작보다 미래일 수 없다. 평가 시점 이후의 정상 append는 기존 projectionHash를
바꾸지 않지만 source generation/count와 관측 assessmentHash는 변경될 수 있다.
Plan commit origin, 포함한 event의 commit origin, full plan/event content와 execution target hash를
결과에 보존한다. Assessment observedAt은 빈 history를 포함해 저장소 잠금 안의 durable 관측 시각이다.
잠금 해제 후 새 writer가 append해도 이전 generation의 시각을 조회 반환 시각으로 늦추지 않는다.
새 artifact·API·runner·거래 활성화 또는 저장 형식 변경은 없다.

`withStoredPendingPlanActionProgress`는 별도 callback 경로로 실제 event → plan writer 잠금을
소비자 완료까지 유지한다. 각 원본을 같은 descriptor에서 읽고 fsync한 뒤 bytes·파일 identity·stat와
현재 경로를 재검증하며, 손상·교체·비정상 UTF-8·다중 hard link·fsync 실패는 callback 전에 거절한다.
빈 이력도 directory durability를 확인한다. Plan/event repository의 held observation은 callback
안에서만 조회할 수 있고 복사본·일반 historical history·callback 종료 후 토큰은 거절한다.
Callback 실패 시에도 두 잠금을 해제하며 기존 historical origin 조회와 projection/assessment 계약은 유지한다.
이는 협력하는 repository writer의 배제이며 잠금을 무시한 외부 파일 변경을 방지하는 권한은 아니다.
아래 policy-bound current snapshot publisher가 이 callback을 사용한다. Callback 자체는
reservation 및 fill/Risk 원본 검증을 제공하지 않는다.

이 단계는 stored_pending_plan_action_progress_only이다. Commit 시각은 당시 disk availability의
증명이 아니며 full history도 현재 generation lease 또는 진짜 fill/Risk 원본 검증이 아니다.
BUY opening reservation, SELL의 실제 가격 원본, snapshot pending 입력과의 exact 대조 및 최종
분류별 exposure 차감은 후속 연결이다. 기존 snapshot과 Risk 경로의 not_verified를 해제하지 않는다.
Rollback은 신규 조회 consumer를 중단하고 코드만 되돌리며 기존 append-only 파일을 변환하지 않는다.

#### Snapshot pending 목록과 계획·잔여 gross 금액 대조

`appendPolicyBoundCurrentPortfolioSizingSnapshot`와 `appendForActivePolicy`는 신규 저장과 exact
retry 모두 실제 잠긴 plan/event 이력의 cutoff prefix와 pending 입력을 대조한다. 잠금 순서는
portfolio(현재 잔고 publisher) → price → FX(입력이 있으면) → sizing → event → plan → mandate → policy
→ activation → Risk → fill이다. 원본 잠금은 destination fsync까지 유지한다. 보유 position이나
pending 입력이 없어도 종료된 계획의 실행 기록이 있을 수 있으므로 실제 가격 이력을 읽는다.
Pending 입력이 빈 배열이어도 plan/event 전체를 읽어 누락을 거절한다.

공통 `bindSnapshotPendingPlanProgress`는 historical resolver와 publisher의 exact membership,
plan/event/target hash, 잔여 수량 및 gross 금액 비교를 공유한다. Fractional BUY는 남은 금액 목표,
whole-share BUY는 계획 원본 가격, SELL은 명시적 저장 가격과 남은 수량으로 평가한다.
기존 `append`와 `appendCurrentPortfolioSizingSnapshot`의 historical 계약 및 JSONL schema는 유지한다.
Policy-bound 경로에서 caller-only pending, 누락·추가·손상 source는 더 이상 저장·재시도할 수 없다.
정상 cutoff 이후 event는 해당 과거 prefix를 바꾸지 않으며 이 결과가 현재 실행 허가를 뜻하지 않는다.
실제 reservation, Risk 규칙 권한, resulting accounting, 외부 가격 trust/freshness와 분류별
exposure 최종 차감은 별도 gate다. 저장된 fill/Risk 원본 대조는 아래 연결을 사용한다.
Rollback은 강화된 publisher consumer를 중단하고 코드만 되돌리며 기존 snapshot을 변환하지 않는다.

`resolveStoredSnapshotPendingActions`는 caller의 pending array 대신 실제 immutable snapshot을
읽고 보유 valuation/exposure를 독립 재생한 뒤, 같은 asOf의 실제 대기 계획 진행 조회와 대조한다.
이전 policyHash의 계획도 포함하며 pending action의 누락·추가·대체, plan/event ID/hash,
execution target hash, market/symbol/side 불일치를 거절한다. Pending 입력 시각은 해당 plan의
마지막 포함 event commit보다 엄격히 뒤여야 한다. BUY 예약 ref 자체는 아직 실제 예약에 대조하지 않는다.

Fractional BUY gross는 잔여 금액 목표와 정확히 같아야 한다. Whole-share BUY는 plan target의
priceEvidenceRef가 가리키는 실제 durable 가격과 referencePriceKrw 및 plan cutoff 이전 가용성을
검증한 뒤 잔여 수량×가격을 원 단위 반올림한다. SELL은 pending 입력이 직접 보존한 가격 ref를
실제 durable 원본에 해소해 market/symbol·pending 시각 이전 가용성을 검증하고 exact 잔여 수량의
gross를 같은 방식으로 평가한다. 따라서 SELL은 계획 시점 가격과 다른 명시적 가격으로 재평가할 수 있다.
0원·overflow·불일치 gross를 거절하며 금액 cap이나 원래 목표액을 잔여 평가금액으로 대신하지 않는다.
가격과 금액 cap의 비교는 현재 실행 승인이 아니라 후속 Risk 재평가의 책임이다.
기존 가격 parser/저장소는 observedAt ≤ createdAt ≤ appendStartedAt ≤ committedAt을 강제한다.
따라서 commit이 pending/BUY plan cutoff보다 엄격히 앞서는 검증은 생성·관측 시각도 함께 제한한다.
시각 역전 record의 append와 전체 entry/marker를 재해시한 위조 이력의 조회도 기존 원본 검증에서 거절한다.

각 저장소 잠금은 다음 저장소를 읽기 전에 해제한다. Snapshot observation, 실제 plan assessment,
가격의 잠금 내부 observation, action별 origin/계산값과 결과 hash를 보존하지만 multi-file lease나
현재 generation을 주장하지 않는다. 가격 파일은 quantity target이 있을 때만 조회하며 사용되는
파일의 손상 suffix는 자동 보정하지 않는다. 실제 가격의 정책상 허용 source/freshness/trust,
진짜 fill/Risk 원본, opening reservation과 최종 sizing은 여전히 미검증이다. 이 연결만으로 기존
candidate/Risk의 미검증 플래그를 해제하지 않는다. 새 저장 형식·API·runner·거래 기본값 변경이
없으므로 신규 consumer를 중단하고 코드만 rollback하며 append-only 원본을 수정하지 않는다.

#### Snapshot pending 계산에 사용된 체결·Risk 원본 연결

Policy-bound current publisher는 plan 뒤, policy 앞에서 실제 mandate record/event 저장소의
`withDurableVerifiedHistory`를 획득한다. 두 파일 전체를 검증·fsync한 동일 lease를 destination
신규 저장·exact retry 완료까지 유지한다. Mandate 관측이 plan 관측보다, activation 관측이 mandate
관측보다 이르거나 mandate record/event 생성이 관측보다 미래이면 거절한다. 기존 Risk writer의
snapshot → mandate → policy/activation 순서를 역전하지 않는다.

Pending mandate action은 원래 plan의 policy/portfolio/market/symbol과 snapshot cutoff의 생명주기를
대조한다. 이전 정책의 미완료 계획을 현재 정책으로 바꾸지 않는다. BUY는 active open-or-increase
mandate만 허용하고 manual/selector의 예약 ID/hash를 pending 입력과 비교한다. SELL에는
review_required와 classify_existing_reduce_only를 허용하며 legacy reduce-only action에 mandate를
합성하지 않는다. Terminal plan을 포함한 모든 execution의 실제 Risk 결정은 결정 시점 mandate,
bucket과 BUY 권한을 재검증한다. Risk에 mandate receipt가 있으면 관측 prefix hash/count와 해당
event identity도 대조한다. Receipt의 prefix에 있는 모든 record/event는 해당 관측 시각까지 생성됐어야
한다. 오래된 pending 입력 시각으로 snapshot cutoff 이전의 종료·만료·review_required를 우회하지
못한다. 후속 정상 retirement는 과거 Risk 시점의 상태를 바꾸지 않는다.

이 연결은 reservation **참조** 대조이며 실제 발급·소비 ledger나 사용 가능한 예약 잔액을 인증하지
않는다. Mandate 자체의 assignment 원본, 과거 디스크 존재, Risk 수치 규칙과 resulting accounting도
별도 gate다. Receipt 없는 과거 Risk에 과거 관측 증거를 합성하지 않는다. Historical resolver,
일반 snapshot append/read, JSONL 형식과 scheduler는 변경하지 않는다. Caller-only mandate 참조는
강화된 publisher에서 거절하며 rollback은 consumer 중지 후 코드 복구로 수행한다. 원본 삭제나
자동 migration은 없다. 협력 writer 잠금만 배제하고 비협력 외부 파일 수정은 지원하지 않는다.

Risk 및 paper fill repository의 `withDurableVerifiedHistory`는 실제 writer 잠금을 callback
종료까지 유지한다. Plan/event 원본에서 사용하는 descriptor-bound reader를 재사용해 bytes·경로
identity·stat·UTF-8 및 fsync를 검증하고, 모든 record의 commit과 fill v3 completion이 관측보다
미래가 아닌지 확인한다. Commit 없는 legacy prefix는 새 held 경로에서 거절하지만 기존 historical
조회는 유지한다. `getHeldPortfolioActionRiskDecisionObservation`과
`getHeldPaperFillExecutionObservation`은 callback 안의 실제 history만 허용하며 성공·실패 종료 후
만료된다. 기존 origin 조회 권한은 historical 설명 용도로 유지된다. 두 lock의 경합 timeout은
monotonic clock을 사용하며 artifact에 기록하는 시각은 기존 wall clock이다.

Policy-bound current snapshot publisher는 activation 안쪽에서 Risk → fill 잠금을 획득하고
snapshot 신규 저장·exact retry의 destination fsync가 끝날 때까지 유지한다. Risk 관측은 activation
관측보다, fill 관측은 Risk 관측보다 이전이면 거절한다. 공통 `bindSnapshotPendingExecutionOrigins`는
historical resolver와 동일한 persisted execution 대조를 수행하며, terminal plan과 cutoff prefix의
모든 실행을 포함한다. Fill에 저장된 Risk receipt, 실제 가격 원본, pre-state·누계·cap 및 predecessor
commit 순서를 검증하고 위조·누락·손상된 이력으로 pending 금액을 줄일 수 없게 한다.
Fill v3에 완료 증거가 있으면 그 completedAt도 execution event의 asOf보다 엄격히 이전이어야
하며, 동일 밀리초·이후 완료는 신규 snapshot 및 exact retry에서 거절한다. 기존 historical
resolver의 조회 결과와 v2 fill의 계약은 유지한다.

이 연결은 actual Risk 규칙 재평가, reservation 또는 결과 portfolio accounting 권한을 발급하지
않는다. 잠금을 따르는 repository writer만 배제하며 외부 파일 변경을 통제하거나 삭제된 완전한
history suffix의 존재를 증명하지 않는다. Schema와 기존 historical append/조회 contract는 유지하며,
강화된 경로는 commit 없는 legacy Risk/fill 원본을 거절한다. Rollback은 신규 consumer 사용 중단과
코드 복구로 수행하고 원본 데이터를 변환하지 않는다. 기존 Risk 경로의 미검증 flag를 해제하지 않는다.

`resolveStoredSnapshotPendingExecutionOrigins`는 실제 snapshot pending 대조 결과에 포함된 모든
plan prefix의 execution_applied를 실제 저장 Risk 결정·paper fill·source price에 연결한다.
미완료 action뿐 아니라 rejected/applied 등 terminal plan의 체결도 검증해 잘못된 완료 이력으로
pending이 사라지는 것을 허용하지 않는다. 같은 portfolio의 fill/Risk identity 재사용을 거절한다.
원본 파일 전체를 검사하며 참조되지 않은 손상 suffix도 보존한 채 실패한다.

기존 fill/Risk validator의 identity·금액·누계·cash cap·가격 원본·commit 순서 검증에 더해,
Plan prefix 전체를 한 번 재생하면서 각 체결 직전 다음 action과 실행 state만 캡처한다.
`replayRebalancePlanExecutionContexts`는 기존 replay와 같은 검증을 사용하며, 매 체결마다
늘어나는 prefix를 복사·재파싱하지 않는다. 기존 replay 호출에는 context를 수집하지 않는다.
Risk/fill/price 원본 resolver는 전체 history 검증·중복 거절 뒤 private WeakMap metadata에
ID/ref 인덱스를 보관한다. 체결마다 records.filter를 반복하지 않으며 외부 입력이나 cloned
history에 인덱스/원본 권한을 부여하지 않는다. 새 조회는 새 인덱스를 발급하므로 과거 history가
후속 append를 암묵적으로 포함하지 않는다. Legacy durable origin 거절은 그대로 유지한다.
Risk 결정의 exact target hash, 다음 action,
pre-state, prior cumulative, 잔여 action cap/target을 대조하며 직전 event commit이 결정 시각보다
엄격히 앞서야 한다. Risk에 plan receipt가 있으면 실제 plan/predecessor의 ID/hash/commit 및
관측 시각과 대조한다. Receipt가 없는 기존 record는 소급 source-before-creation 증명을 얻지 않는다.

반환 결과는 snapshot 대조 assessment hash, 체결별 event/Risk/fill/price origin, 실제 Risk/fill
record 집합 hash와 가격 durable observation을 보존한다. 범위는
stored_snapshot_pending_execution_origins_only이며 정책·required Risk rule의 독립 평가,
mandate/turnover 권한, resulting state·회계 원본, opening reservation, 가격 freshness/trust,
현재 generation/CAS 및 최종 sizing은 완료하지 않는다. 잠금은 순차 해제하며 과거 source 조회를
현재 실행 권한으로 사용하지 않는다. 기존 조회/API/runner·저장 형식·안전 기본값은 그대로이며
신규 consumer 중단과 코드 rollback에 append-only 데이터 변환·삭제는 필요 없다.

#### Snapshot pending BUY의 실제 예약 원본 및 잔액 연결

`resolveStoredSnapshotPendingReservationOrigins`는 위 pending execution 원본 대조를 먼저 수행하고
manual/Selector의 실제 root·mandate·fill·retirement 원본을 함께 읽는다. 세 조회의 plan generation,
두 예약 경로 및 마지막 capacity 관측의 generation과 관측 시각 순서를 비교한다. 체결·종료·최종
mandate 관측의 record/event count와 hash도 일치해야 하며 중간에 원본이 추가되면 재조회를 요구한다. Source별 조회는
각각 한 번 수행하며 마지막 잠금은 mandate → capacity 순서다. 전체 이력의 손상은 기준 시점 이후
suffix에 있더라도 숨기지 않는다.

각 pending BUY의 action mandate와 plan의 원래 policy를 기준으로 exact reservation ID/hash,
portfolio/market/symbol 및 bound mandate를 대조한다. Snapshot의 현재 policy hash로 이전 policy의
미완료 주문을 지우거나 강제로 재분류하지 않는다. Snapshot asOf보다 먼저 commit된 capacity event
prefix에서 reservation head를 선택하며 같은 millisecond commit은 모호하므로 거절한다. 이후의
정상 체결·retirement는 과거 head와 잔액을 바꾸지 않는다. 기준 시점에 아직 bound되지 않았거나
released/소진된 예약, 비활성·review_required·만료 mandate의 pending BUY는 거절한다. Mandate 상태는
실제 전체 이력을 검증한 뒤 instrument별 원래 event 순서를 보존해 cutoff 기준으로 재생한다.

해당 pending action의 모든 선행 actual execution에는 같은 예약의 actual 소비 event가 있어야 하며
기준 시점 head의 version 이내여야 한다. Plan 체결만 있고 예약 차감이 누락되었거나 아직 기록되지
않았다면 실패한다. 같은 예약을 참조하는 여러 pending BUY의 remainingNotionalKrw는 BigInt로 합산해
기준 시점 remainingReservedNotionalKrw를 초과하지 않아야 한다. 이는 gross 잔액 대조이며 net cash,
실제 position 소유권이나 최종 주문 수량 계산을 대신하지 않는다. SELL은 선행 pending/체결 원본 검증을
유지하고 opening reservation binding 대상으로 승격하지 않는다.

반환값은 actual pending·manual/Selector 원본 결과, reservation root/bound/head origin, 당시 mandate
상태, 선행 소비 origin과 reservation별 pending/remaining gross 합계를 보존한다. 두 원본 경로 모두
확인하지 못한 capacity event는 미검증 ID 목록에 유지한다. Scope는
stored_snapshot_pending_reservation_bindings_only이며 root allocator/CAS, current slot/budget 배정,
현재 실행 권한, 회계/resulting state, Risk policy/rule, 가격 freshness/trust와 최종 sizing을 승인하지
않는다. Commit/createdAt만으로 실제 과거 disk 가용성을 소급 증명하지 않는다. 기존 snapshot·이벤트
형식, API/runner/writer와 운영 기본값은 변경하지 않으며 신규 consumer 중단과 코드 rollback에
데이터 변환·삭제가 필요 없다.

#### Selector opening reservation 발급 기록 계약

`SelectorOpeningCapacityReservationRecord`는 Selector의 예약 ID/hash가 가리키는 독립 발급 payload다.
`selectorOpeningCapacityReservation.ts`의 factory/parser는 다음 모든 payload 필드를 canonical hash에
포함하고 ID는 `selector_capacity_reservation` prefix와 hash에서 파생한다. ID/hash와 canonical UTC
`createdAt`만 identity 계산에서 제외한다. Unknown field, 비정규 식별자, unsafe integer, 음수 0,
0인 rank/version/금액 및 개별 예약보다 작은 aggregate 금액은 거절한다.

```text
selectionRequestId / selectionRequestHash
candidateAssignmentSetId / candidateAssignmentSetHash
candidateAssignmentId / candidateAssignmentHash / selectedRank
portfolioId / policyHash / bucket / market / symbol
currentPortfolioSnapshotId / currentPortfolioSnapshotHash
capacityLedgerVersion / reservedSlotOrdinal
reservedMaximumNotionalKrw / resultingReservedNotionalKrw
```

`resolveSelectorOpeningCapacityReservationBinding`은 supplied request·assignment 전체·sealed set을
독립 재생하고 선택된 exact rank/금액 및 BUY sizing 원본을 대조한다. Request-local rank를 전역 slot
ordinal로 추론하지 않는다. Current transaction snapshot은 이전 request snapshot과 다를 수 있지만
동일 portfolio/policy의 exact ID/hash여야 하며 request asOf 이후·발급 시각 이하여야 한다. Set 생성보다
이른 발급은 거절한다. Selector의 배정액을 현재 잔액에 맞춰 임의로 줄이는 것은 허용하지 않는다.
실제 용량 충돌은 기존 계약대로 transaction rollback과 stale request 재평가 대상이다.

`resolveSelectorOpeningCapacityReservedEventBinding`은 기존 root event의 exact reservation ID/hash,
scope, version, set/assignment, 전역 slot, notional과 시각을 발급 기록에 대조한다.
`resolveSelectorOpeningCapacityMandateBinding`은 기존 전체 Selector mandate 대조에 더해 발급 ID/hash,
전역 slot과 생성 순서를 검증한다. 기존 event/mandate schema를 바꾸지 않는다.

이 단계는 supplied contract이며 실제 저장 원본 completeness, eligibility/정확한 sizing,
현재 snapshot 권한, aggregate budget/slot unique/CAS 배정 권한을 증명하지 않는다. 발급 기록 저장,
durable origin, actual source resolver 및 공용 allocator와 activation의 원자적 연결은 후속이다.
기존 opaque Selector 예약 ID를 소급해 발급 원본이 검증된 것으로 취급하지 않는다. 기존 writer/API 및
안전 기본값 변경은 없으며 현재 단계 rollback은 신규 consumer 중단과 코드 rollback만 필요하다.

#### Selector opening reservation 발급 원본 저장

`SelectorOpeningCapacityReservationFileRepository`는 `selector-opening-capacity-reservations.jsonl`에
발급 record와 request/snapshot/sizing/assignment 원본 관측을 entry/commit pair로 저장한다.
Entry는 complete record/source, append 시작 시각, predecessor commit hash를 포함하며 commit marker는
entry hash와 committedAt을 다시 hash한다. 실제 전체 source 저장소 검증 후 관측한 prefix의 count/hash와
commit hash를 재대조하고, exact selected allocation·BUY sizing·현재 snapshot scope/시각을 확인한다.
발급 createdAt은 실제 set commit 이전일 수 없다. Source 관측 순서는 request→snapshot→sizing→assignment→append이며
시계 역행을 허용하지 않는다. 기존 assignment 저장소가 전체 sealed set을 재생한 결과를 인덱싱하여
발급 후보마다 같은 set 전체를 다시 재생하지 않는다.

`CandidateSizingInputFileRepository`와 `CandidateAssignmentFileRepository`의 durable callback은 이미
잠금 안에 있는 snapshot history를 추가 인자로 공유한다. 기존 callback은 기존 인자만 계속 사용할 수
있으며 저장 형식과 기존 append 동작은 바뀌지 않는다. 신규 발급 저장은 request→snapshot→sizing→assignment→reservation
순서로 source 잠금을 commit까지 보유하고 callback 안에서 같은 저장소를 재진입하지 않는다.
Durable observation은 repository 발급 객체의 callback lifetime에만 유효하며 복사본·종료된 lease는 거절한다.

원본 공유 조회 분할은 sizing input, assignment, selector reservation 각각에
`withDurableVerifiedHistoryFromSources`를 제공한다. 이미 보유한 request → snapshot → input →
assignment를 재취득하지 않고 해당 단계의 destination lock만 취득한다. 기존 일반 조회도 이 경로를
사용한다. Request repository는 생성 시 절대 경로를 고정하고 발급 history와 경로를 private WeakMap에
연결하며, input/assignment 관측도 자신의 경로와 상위 원본 수명 검증 함수를 보존한다. 같은 bytes라도
다른 디렉터리의 관측, 복사 객체 또는 종료된 관측은 거절한다. `.`/`..`만 정규화하고 다른 symlink나
대소문자 alias를 같은 configured source로 추정하지 않는다.

각 단계는 lock 대기 전후, 원본 파일 관측 뒤, consumer 정상 반환 전 및 observation getter에서
상위 lease를 재검증한다. 상위 callback이 먼저 종료되면 아직 실행 중인 input/assignment/reservation의
getter도 즉시 실패하며 최상위 원본 만료가 모든 하위 관측에 전파된다. 예약/결과 관측 시각이 어느
상위 원본 관측보다 앞서면 fail-closed한다. Caller는 모든 원본 callback 안에서 후속 조회를 await하고
기존 잠금 순서를 지켜야 한다. 이 API는 재진입 append나 write/할당 권한을 제공하지 않는다.

테스트는 세 단계별 경로/clone/만료 경계, source·destination lock 유지, consumer/lock 대기/I/O 중 만료,
시계 역행, fsync 실패, corrupt/torn/UTF-8/pending bytes 보존, 원본 만료의 다단계 전파 및 실제
populated 전체 이력의 동일성을 확인한다. Public observation/entry/commit 형식과 기존 append/seal
규칙은 유지한다. 이 조회 자체는 current publisher 연결이 아니며 root 검증 연결은 아래 별도 분할이
담당한다. Scheduler, 실제 shared allocator/소비/원자 commit은 후속이다. 설정된 경로 결속은
비협조적인 OS writer를 차단하는 sandbox가 아니다.

Migration은 없다. 상대 경로는 repository 생성 시 고정되므로 이후 process cwd가 바뀌어도 source가
이동하지 않는다. 신규 API consumer보다 repository를 먼저 배포하고 rollback 시 consumer도 함께
중지/되돌린다. Artifact는 보존한다. Rollback으로 경로·종속 lease 수명 검증이 사라지는 점과 기존
일반 조회에 추가된 관측 시각 역행 거절을 고려해야 한다.

현재 원본 조합의 선행 분할인 `bindOpeningCapacityRootOrigins`는 실제 callback 안에서 살아 있는
manual assignment, manual/selector 발급 및 capacity event 관측을 받아 해당 portfolio의 모든 reserved
root를 검증한다. 오래된 policy나 successor가 존재하는 root도 제외하지 않는다. 세 journal 관측에
private configured path 결속을 추가하고 manual 원본과 함께 같은 baseDir인지 검증한다. 같은 bytes의
다른 디렉터리, 복사본, 종료된 관측은 빈 root 집합에서도 거절한다. 상위 source 수명도 기존 getter를
통해 재검증한다. Public observation 및 저장 entry/commit 형식은 바뀌지 않는다.

수동 root는 실제 authorization과 발급 record에, selector root는 이미 request/snapshot/input/assignment
원본 검증을 통과한 발급 record에 결속한다. 기존 record/event validator로 identity/hash/scope/금액/slot/
ledger version을 확인하고 발급 commit이 root 평가 시각보다 엄격히 앞서는지 검사한다. 같은 밀리초의
발급은 순서를 증명하지 못하므로 실패한다. Capacity 관측은 두 발급 관측보다 앞설 수 없으며 호출 시
시계 역행도 거절한다. 이 함수는 동기 검증이며 lock을 새로 취득하거나 artifact를 쓰지 않는다.

현재 policy-bound snapshot 발행 경로도 이 root binder를 사용한다. Portfolio → price → FX 다음에
manual → request → sizing → input → assignment → manual reservation → selector reservation을 잠그고,
기존 event → plan → mandate → policy → activation → Risk → fill 뒤 capacity event 잠금을 추가한다.
Snapshot 저장소는 destination lock을 한 번만 취득하고 private 잠금 내부 관측을 발급해 하위 조회에
공유한다. 이 관측은 append 전 prefix이며 외부 caller에게 노출하지 않고 발행 작업 종료 시 폐기한다.
후속 조회는 기존 source-sharing API를 사용하므로 snapshot lock 재진입이 없다.

최초 append와 exact retry 모두 해당 portfolio의 모든 root를 실제 원본에 대조한 다음 destination을
동기화한다. Pending BUY가 없어도 미발급 root나 손상된 발급 원본을 무시하지 않으며 오래된 policy의
root도 검증한다. Capacity 관측은 fill 관측보다 앞설 수 없다. 원본·capacity lock은 최종 destination
fsync까지 유지하고 일반 append/current publisher의 비정책 경로는 바꾸지 않는다. 추가 관측 fsync는
최종 저장 fsync와 구분하며 기존 최종 policy/dependency 잠금·오류 주입 검증을 유지한다.

이 연결은 root 발행 출처와 bound mandate 내용을 확인하며 후속 소비 결속도 아래에 연결한다. Pending BUY의 잔여 금액, shared allocator,
CAS, resulting accounting 및 실행 권한은 아직 연결 완료가 아니다. 기존에 원본 없는 root나 손상된
미사용 원본 파일을 가진 호출도 이제 fail-closed할 수 있다. 저장 형식 migration은 없고 코드 rollback은
가능하지만 root 검증 보장이 사라지므로 이 보장에 의존하는 consumer도 함께 되돌려야 한다.

결과는 immutable 값이지 callback 밖에서 사용할 수 있는 새 lease나 실행 권한이 아니다. Caller는
manual → request → snapshot → input → assignment → manual reservation → selector reservation →
capacity 순서로 원본을 보유하는 조합 등을 사용하고 같은 저장소를 재진입하지 않는다.
Root binder만으로 소비/잔여 금액이나 실제 allocator/CAS/원자 commit을 인증하지 않는다.
Migration은 없고 rollback 시 신규 binder consumer도 함께 되돌린다. 테스트는 실제 두 종류의 원본,
successor/restart, 경로/복사/만료, clock/lock 및 재해시한 잘못된 root claim과 bytes 보존을 확인한다.

후속 `bindOpeningCapacityMandateOrigins`는 root 검증기를 내부에서 호출한 뒤 같은 디렉터리의 실제
request/input/assignment/mandate 관측을 추가 검증한다. 모든 원본 callback과 선행 snapshot 관측은
살아 있어야 하며 빈 집합에서도 복사본·다른 경로·만료된 관측을 거절한다. Mandate 저장소의 private
configured path 결속은 durable callback에서만 유효하고 상대 경로는 생성 시 절대 경로로 고정한다.
Public observation/record/event 형식은 바꾸지 않는다.

각 bound event는 실제 mandate ID/hash 및 발급 root에 결속한다. 수동은 실제 authorization·전체 예약
lineage를, selector는 실제 request·전체 selected set·assignment·BUY sizing 입력과 rank/금액/slot/
정책/종목/비중/증거를 기존 validator로 대조한다. 같은 set 검증 context는 호출 안에서 재사용한다.
Root commit ≤ mandate createdAt ≤ bound event asOf 및 실제 관측 시각을 검사한다. 이는 저장된
createdAt의 내용 검증이지 mandate 생성 당시 원본을 보유했다는 새 receipt 증명이 아니다.

함수는 동기식이며 읽기/쓰기나 잠금 취득을 추가하지 않는다. Caller는 기존 source-sharing 순서 뒤
mandate → capacity를 보유하며 다시 진입하지 않는다. 결과는 immutable 값이며 새 lease가 아니다.
Binder 자체는 mandate activation·소비·잔여 금액·실제 sizing/allocator/CAS/실행 권한을 검증하지 않는다.
Proposed mandate도 내용 검증 대상이며 실행 허가로 승격하지 않는다.
Migration은 없고 신규 consumer보다 binder/repository를 먼저 배포한다. Rollback은 consumer와 함께
되돌리며 저장 artifact는 보존한다. 복사/다른 경로/만료, clock/consumer 실패, 실제 수동·selector 및
increase/restart, 누락·hash·scope·lineage·시각 불일치를 임시 filesystem 테스트로 검증한다.

Policy-bound current publisher는 보유한 request/input/assignment 관측을 private source 묶음에 포함하고
최종 capacity 관측 안에서 소비 binder를 통해 `bindOpeningCapacityMandateOrigins`를 호출한다. 기존 root 검증도
내부에 포함된다. 별도 repository 조회나 추가 lock 취득은 없으며 기존 mandate/정책/Risk/fill 검증을
유지한다. 최초 append와 exact retry 모두 실제 bound mandate 내용을 재검증하고 원본 잠금을 최종
destination fsync까지 보유한다. Pending BUY가 없어도 누락/손상/불일치한 bound mandate를 거절한다.
과거 policy의 root/bound 기록도 제외하지 않는다. 기존 non-policy publisher와 일반 append는 불변이다.

수동·Selector 실제 발급/mandate를 가진 publisher 통합 테스트는 proposed 상태의 내용 검증, 첫 발행/
retry, source bytes/portfolio revision 보존, missing/corrupt/재해시한 lineage mismatch 및 최종 저장까지
request/input/assignment/mandate lock 보유를 확인한다. 기존 root 테스트의 setup을 공유 fixture로 옮기고
Selector fixture의 예약 단계만 분리해 plan/Risk/fill이 없는 조합도 만들며 기존 실행 fixture는 유지한다.
Schema migration은 없지만 과거에 허용되던 잘못된 bound 기록은 이제 발행을 막을 수 있다. Source
integrity/lock 오류를 운영에서 확인하고 자동 복구하지 않는다. Rollback 시 이 내용 검증 보장이
사라지므로 의존 consumer도 함께 되돌린다. 잔액·allocator/원자 commit/accounting은 여전히 후속이다.

실제 소비 원본 조합의 선행 단계로 plan/plan event/Risk/fill/price repository는 각각 active durable
관측의 configured path를 private WeakMap에 결속한다. 새 source assertion은 관측 수명과 같은
baseDir의 source 경로를 검사하고 event assertion은 주입된 plan repository의 경로/수명도 확인한다.
빈 기록도 복사본·다른 디렉터리·callback 종료/실패 후 관측·일반 historical read로 대체할 수 없다.
Public observation/record/entry/commit 형식은 불변이며 assertion 자체는 I/O나 잠금을 추가하지 않는다.

상대 baseDir는 repository 생성 시 절대 경로로 고정한다. 이후 process cwd가 바뀌어도 실제 읽기와
assertion 대상이 이동하지 않는다. 실제 capacity 소비 binder와 current publisher가 아래의 조합에서
이 assertion을 사용한다. 같은 source라는 확인은 Risk 정책·외부 가격
trust·원자 회계·실행 권한을 부여하지 않는다. Migration 없이 consumer보다 repository를 먼저 배포하고,
rollback 시 새 assertion에 의존하는 consumer도 함께 되돌린다. Journal bytes는 변환/삭제하지 않는다.
회귀 테스트는 다섯 source의 empty/copied/foreign/expired/historical, consumer 실패, cwd 변경,
다른 plan repository 주입 및 실제 populated plan/Risk/fill/price 원본을 확인한다.

`bindOpeningCapacityConsumptionOrigins`는 caller가 동시에 보유한 실제 source lease로 모든
portfolio 소비 event를 결속한다. 기존 root/mandate binder를 내부 호출해 수동·selector 발급 출처를
재검증하고, plan event(주입된 plan 포함)·Risk·fill·price도 같은 baseDir의 live lease여야 한다.
가격 → plan → mandate → Risk → fill → capacity 관측 시각의 역행을 거절한다. 별도 I/O나 잠금을
취득하지 않으며 반환값은 새로운 lease가 아니다. 현재 snapshot 발행 경로는 아래처럼 연결한다.

실제 plan replay의 실행과 선행 상태, fill의 저장된 Risk origin, 실제 가격 원본, BUY mandate 계보,
bucket/policy/종목을 대조한다. 예약 감소량은 수수료를 포함한 net cash가 아닌 실제 filled gross와
같아야 한다. Risk의 실제 mandate 상태와 저장된 plan/mandate receipt를 검증하고, 선행 capacity와
plan commit은 Risk 결정보다, 실제 실행 event commit은 소비 평가보다 엄격히 먼저여야 한다.
Fill completion이 있는 형식은 completion도 실행 event보다 엄격히 먼저여야 한다. 같은 portfolio의
fill/Risk 재사용을 거절하고, terminal/과거 policy 예약의 소비도 제외하지 않는다.

Mandate 기록·event의 생성 시각은 현재 관측보다 늦을 수 없으며, receipt prefix의 생성 시각도
receipt 관측보다 늦을 수 없다. 실제 전체 mandate 이력과 receipt prefix에서 각각 Risk 결정 시점의
상태를 재구성해 같은 identity인지 검사한다. Risk 이후의 정상 retirement는 허용하지만, 뒤늦게
추가된 소급 retirement로 당시 상태가 충돌하면 과거 receipt만으로 소비를 승인하지 않는다.

소비마다 전체 mandate history를 다시 parse/replay하지 않도록 `createHeldRiskMandateStateResolver`가
실제 검증된 durable generation을 한 번 인덱싱한다. Canonical array prefix 해시는 기존 canonical
직렬화를 사용해 원본당 한 번 순회하며, receipt는 count/hash·생성 시각·record/successor 참조 포함
여부를 O(1)로 확인한다. 종목 scope별 검증된 단조 lifecycle timeline을 이진 탐색하고 mandate/cutoff/
prefix별 상태를 캐시한다. Cache hit도 원래 lease 수명을 다시 검사하므로 callback 밖에서는 무효다.
전체 journal의 hash/chain/lifecycle 검증은 repository가 먼저 수행하며 생략하지 않는다. 기존
historical API는 바꾸지 않는다. Prefix 해시의 기존 방식 동등성, successor/expiry/receipt 경계의
기존 replay 동등성, 500종목의 10,000개 조회 중 추가 해시 계산 없음과 만료된 resolver를 검증한다.

이 결속은 release 원본, 결과 position/accounting, 실제 Risk 정책·규칙의 권위, 가격 trust/freshness,
receipt 없는 Risk의 당시 mandate 가용성, 잔여 pending coverage, allocator/CAS/원자 commit을
인증하지 않는다. 기존 historical 조회 API와 저장 형식은 불변이다.
Migration 없이 후속 consumer보다 먼저 배포하고 rollback 시 해당 consumer도 함께 되돌린다.
회귀 검증은 실제 수동·selector gross/partial/terminal 및 재조회, 잘못된 계보·상태·receipt·시각,
누락/손상 원본 보존, 복사·다른 경로·만료된 lease, completion 경계와 실패 후 lock 해제를 다룬다.

Policy-bound current publisher는 최종 capacity callback의 pending/terminal binder를 통해
`bindOpeningCapacityConsumptionOrigins`를 호출한다. 이미 보유한 source 묶음과 actual plan event/plan·Risk·fill·price를 그대로 전달하며
추가 read/fsync/lock 취득은 없다. `withStoredPendingPlanActionProgress`는 callback의 두 번째 인자로
cutoff로 잘라내기 전 실제 전체 history를 제공한다. 기존 단일 인자 callback은 호환되고 반환 projection
형식은 불변이며 실제 history lease는 callback 종료 시 폐기된다.

최초 발행과 exact retry 모두 모든 actual 소비를 검증한 뒤 destination을 저장한다. Snapshot cutoff
이후의 실제 실행도 전체 history로 결속하므로 cutoff-filtered pending projection으로 대체하지 않는다.
Terminal/과거 policy의 소비도 검사한다. 잘못된 gross 차감이나 실제 실행 없는 소비는 source와
destination/portfolio bytes를 보존한 채 거절한다. 원본 잠금은 최종 append/retry fsync까지 유지한다.
통합 테스트는 수동·selector terminal 소비의 cutoff 전후 발행·retry, post-cutoff 잘못된 소비 거절,
최종 plan/event/Risk/fill/price 잠금 및 callback history의 수명을 확인한다. 이는 결과 portfolio
accounting의 정확성을 인증하는 테스트가 아니다. 기존 일반 append와 non-policy publisher는 불변이다.
Schema migration은 없지만 기존 불일치 소비가 발행을 막을 수 있다. 자동 복구 없이 source 오류를
확인해야 하며 rollback 시 의존 consumer도 함께 되돌린다. Pending 잔액 coverage는 아래 통합 binder
연결에서 처리한다. 취소 권한·allocator/CAS/원자 accounting·외부 trust·실행 권한은 여전히 후속이다.

`bindOpeningCapacityTerminalOrigins`는 실제 보유 원본에서 종료 mandate에 따른 해제만 결속한다.
내부에서 소비 binder를 먼저 실행하므로 root/mandate와 전체 실제 gross 소비를 생략하거나 caller가
검증 완료 결과를 대신 주입할 수 없다. 모든 실제 source의 같은 경로/live lease와 관측 시각을 검사한
뒤 해당 portfolio의 모든 `mandate_terminal` release를 조회한다. 과거 policy와 terminal 예약도 포함한다.
Bound mandate payload, 실제 retired 상태와 최종 종료 event의 ID/hash를 대조한다. 종료 event의
asOf/createdAt은 release.asOf 이하여야 하고 capacity predecessor의 실제 commit은 엄격히 앞서야 한다.
해제 금액은 실제 체결 gross와 대조한 predecessor의 잔여 금액이며 수수료 포함 cash가 아니다.

`request_cancelled`는 검증한 해제 목록에 넣지 않고 `unverifiedReleaseEventIds`로 명시적으로 반환한다.
존재하지 않는 해제를 생성하지 않으며 전체 source를 검증한 뒤에도 unbound 취소 권한은 부여하지 않는다.
반환값은 동결된 원본 연결 결과이지 새 lease나 해제/재할당/실행 권한이 아니다. 별도 I/O/lock과 저장
형식 변경은 없고 현재 snapshot publisher는 아래처럼 연결한다. 기존 historical resolver도 바꾸지 않는다.
Mandate event에는 실제 저장 시점 receipt가 없으므로 release 전에 disk에 존재했다는 보장은 여전히
not_proven이다. Pending coverage, allocator/CAS/원자 accounting, target 충족 해제와 취소 권한도 별도다.

임시 filesystem 테스트는 두 원본 종류의 미체결·부분체결 후 해제와 restart, 누락·잘못된 hash·
active/review_required event·시각 불일치, 잘못된 선행 소비, 손상 원본 보존, 미검증 취소 구분,
copied/foreign/expired 관측, 실제 lock 보유와 consumer 실패 후 해제를 확인한다. Migration 없이
신규 consumer보다 binder를 먼저 배포하고 rollback 시 의존 consumer를 함께 되돌린다. Source integrity
오류는 자동 복구하거나 journal을 삭제하지 않는다. Live 경로와 frozen execution model은 불변이다.

Policy-bound current publisher의 최종 capacity callback은 pending binder 내부의 `bindOpeningCapacityTerminalOrigins`로
모든 실제 종료 해제를 검사한다. 선행 소비/root/mandate 검증은 내부에서 유지하며 기존 source와 잠금
순서를 그대로 사용한다. `unverifiedReleaseEventIds`가 하나라도 있으면 최초 append/exact retry 모두
저장 전에 fail-closed한다. 취소 원본 계약과 authorization이 없는데 취소된 capacity를 승인하는 것이
아니라, 해당 source를 가진 발행을 거절하는 경계다. Cutoff 이후/과거 policy의 해제도 제외하지 않는다.

수동·selector의 cutoff 전후 정상 해제, post-cutoff 부분 소비 후 해제, 최초/retry의 원본·시각 불일치와
미검증 취소 거절 및 source/destination/portfolio 보존을 통합 검증한다. 종료 mandate/capacity 잠금은
최종 destination fsync까지 유지되고 종료 후 해제된다. 합성 portfolio fixture는 실행과의 accounting
일치성을 증명하지 않는다. Pending coverage는 아래 통합 연결에서 다루며 allocator/CAS/원자 accounting·
실행 권한은 여전히 후속이다.
일반 append/non-policy current publisher는 불변이다. 저장 형식 migration은 없지만 이전에 허용된
잘못된 해제/미검증 취소가 policy-bound 발행을 막을 수 있으므로 원본 오류를 확인해야 한다.
Rollback은 의존 consumer와 함께 수행하며 journal 삭제나 자동 복구를 포함하지 않는다.

`bindHeldSnapshotPendingReservationOrigins`는 실제 보유 source만으로 snapshot의 pending BUY 예약
소속과 gross 잔액을 재구성한다. 입력 snapshot을 독립 rehash/valuation replay한 뒤 terminal binder로
모든 root/mandate/소비/종료 원본을 검사하고 미검증 취소를 거절한다. Snapshot 안의 virtualPortfolio나
현재 정책을 실제 원본으로 인증하는 함수는 아니다. Policy-bound current publisher는 아래 별도
연결 경계에서 실제 portfolio/활성 정책 검증과 함께 이 함수를 사용한다.

`projectHeldPendingPlanActionProgress`는 같은 baseDir의 live event/plan history에서 cutoff projection을
동기식으로 재계산한다. Historical 반환값·복사·다른 경로·만료된 source와 관측 이후 cutoff는 거절한다.
기존 historical/보유 callback API의 동작은 그대로이며 추가 reader/lock을 취득하지 않는다. 새 binder는
이 projection을 사용해 pending 집합·가격 기반 gross·실제 Risk/fill·mandate 상태와 completion 시각을
대조하므로 caller가 검증 완료 projection/체결 목록을 대신 전달하는 입력은 없다. SELL도 실제 체결
검증은 유지하지만 opening 예약 대상으로 승격하지 않는다.

Capacity의 실제 commit이 cutoff보다 엄격히 앞선 prefix에서 각 예약 head를 선택한다. 같은 밀리초
commit은 모호하므로 거절한다. Pending BUY는 원래 plan policy의 실제 bound mandate/예약 ID/hash와
일치해야 하며 available bound head가 있어야 한다. 각 선행 체결은 같은 예약/head version 이내의
실제 소비로 결속돼야 하고 소비 commit도 cutoff보다 앞서야 한다. 같은 예약의 미완료 BUY gross를
BigInt로 합산해 잔액 이하인지 검사한다. 이후 소비/종료는 과거 cutoff의 head를 덮어쓰지 않는다.

반환값은 immutable snapshot/projection/체결·종료·예약 원본과 예약별 합계이며 새 lease가 아니다.
가격 trust/freshness, 활성 정책, 실제 portfolio state, allocator/CAS/회계·최종 실행 권한과 과거 disk
가용성 receipt는 인증하지 않는다. 실제 임시 저장소 테스트는 양쪽 원본의 0~3회 체결·과거 policy·
재시작, 소비 누락/모호한 cutoff, 공유 예약 초과, 나중 체결/종료 이후 과거 잔액, 미검증 취소·unbound,
가짜 pending 집합/gross/lineage, inactive mandate, SELL completion과 lease/lock 실패 경계를 확인한다.
저장 형식은 불변이며 migration은 없다. Consumer보다 먼저 배포하고 rollback은 의존 consumer와
함께 수행한다. Source 오류는 자동 복구·삭제하지 않는다.

Current pending 테스트의 opening BUY fixture는 placeholder 예약 대신 실제 수동/selector 발급 원본을
저장한다. `currentSizingPendingCapacityTestFixtures.ts`는 source snapshot과 manual event 또는
request/input/assignment set을 먼저 생성하고 400 KRW 예약을 발급한다. 공통 fixture가 root 이후
mandate와 bound event, 기존 plan/Risk/fill 이후 실제 gross 소비를 저장한다. Fractional BUY는
잔액 360/pending 60, whole BUY는 잔액 300/pending 200으로 historical 예약 resolver에서도 검증된다.
Source snapshot이 destination journal에 이미 존재하므로 최초 발행 실패도 기존 bytes 보존으로
검사하고 exact retry의 record 수는 초기 source snapshot 수를 포함한다. SELL/reduce-only는 새
opening 예약을 만들지 않는다. 이 변경은 테스트 데이터와 보존 assertion의 보강이며 production
publisher 연결·검증 규칙·저장 형식은 바꾸지 않는다. 합성 원본은 실제 portfolio 회계, allocator,
manual evidence sizing 또는 외부 가격 trust를 증명하지 않는다.

Policy-bound current publisher의 최종 capacity callback은 `bindHeldSnapshotPendingReservationOrigins`를
호출한다. 실제 root/mandate/소비/종료 검증에 pending 집합·Risk/fill/mandate·cutoff 예약 잔액과
예약별 BUY 합계 제한을 함께 적용하므로 최초 발행과 exact retry 모두 동일 gate를 통과해야 한다.
기존 앞단 pending/실행/mandate 계산은 제거하고 최종 binder에서 한 번 수행한다. 내부 gate 순서가
바뀌어 일부 부정 입력은 이전보다 앞선 capacity provenance 검증의 오류 메시지로 거절된다.

`withStoredPendingPlanActionHistory`는 strict/canonical 요청과 시작 시각·관측 시각을 확인한 뒤
event→plan 잠금의 전체 실제 history만 callback에 제공한다. Cutoff projection/체결/예약 권한은
인증하지 않으며 callback 종료 시 lease가 만료된다. 기존 historical 및 projection callback API는
그대로 유지된다. Publisher는 이 새 helper를 사용하여 projection을 중복 계산하지 않는다.

Portfolio→price→FX→capacity source→event→plan→mandate→policy→activation→Risk→fill→capacity
잠금 순서와 destination append/retry fsync 경계는 불변이다. 실제 저장소 테스트는 수동/selector의
소비 누락·동일 cutoff commit·늦은 소비를 최초/재시도에서 거절하고 source/destination/portfolio
bytes를 보존한다. 공유 예약 합계가 잔액과 같으면 허용하고 초과하면 거절한다. SELL completion,
전체 history와 callback 수명·잠금·소비자 실패 후 해제·미래 cutoff·시계 역행도 확인한다.
기존 plan/Risk/fill/mandate/예약 해제 잠금 테스트는 계속 적용된다. 외부 trust/freshness, 실제 회계,
공유 allocator/CAS와 최종 실행 권한은 별도 미완료 항목이다. 잘못된 기존 pending/소비 이력은 이제
발행을 막을 수 있으므로 해당 원본 오류를 확인해야 한다. Rollback은 이 연결과 후속 consumer를
함께 되돌리며 journal 삭제·변환을 포함하지 않는다. 일반 append/non-policy publisher는 불변이다.

`bindHeldSnapshotOpeningCapacity`는 실제 보유 reservation/pending 원본으로 supplied policy의 bucket별
슬롯 점유와 gross 예약 합계를 재계산한다. 정책 내용은 독립 rehash하고 portfolio/hash/생성 시각이
snapshot과 일치하는지 확인하지만 실제 활성 정책임을 인증하지 않는다. `policyActivationAuthority`와
`actualPortfolioAndValuationAuthority`는 `not_verified`, 실행 권한은 `not_granted`다. 현재 publisher나
capacity document CAS에 연결하지 않으며 별도 I/O·lock·write·lease를 만들지 않는다.

내부에서 held pending binder를 실행하므로 root/mandate/소비/종료와 pending 집합·잔액 원본을 caller가
검증 완료 목록으로 대신 전달할 수 없다. 실제 commit이 cutoff보다 앞선 event prefix만 점유 계산에
사용하며 나중 이력의 무결성도 선행 binder에서 검사한다. 모든 bucket의 명시적 opening capacity
policy를 요구하고 legacy 한도는 합성하지 않는다. 과거 policy의 남은 예약도 현재 점유에 포함하지만
ledger version/last reservation은 전달한 policy의 event epoch만 반영한다.

`projectSnapshotOpeningOccupancy`는 역사적 resolver와 held binder가 공유하는 동기식 산술 함수다.
원본 인증·재해시·cutoff 선택·pending coverage는 각 caller가 먼저 수행해야 하며 이 함수 자체는
검증 증거/할당 권한이 아니다. 보유 종목, 미제출 bound 슬롯과 pending 예약을 구분하고 pending은
기존 예약의 슬롯/금액에 한 번만 포함한다. 미분류/중복 보유분·중복 슬롯/신규 종목·unsafe 합계를
거절하며 과점유 슬롯은 0으로 자른다. 기존 historical generation 재확인과 assessment 형식은 유지한다.

실제 filesystem 테스트는 수동/selector의 0~3회 체결과 과거 cutoff를 기존 historical 결과와 대조하고
복사/다른 경로/만료된 source, hash/정책 한도/시각 오류, 비활성 supplied policy의 비권한 경계,
중복 슬롯/종목, increase 예약·과점유, 손상 bytes 보존·시계 역행·consumer 실패 후 lock 해제를 확인한다.
정책 활성화·실제 portfolio 회계·현재 공유 allocator/CAS·외부 가격 trust는 별도다. 저장 형식 변경이나
migration은 없으며 rollback은 새 consumer와 함께 수행하고 기존 journal을 변환·삭제하지 않는다.

`bindHeldSnapshotOpeningBudget`는 held occupancy의 전체 실제 원본 검증을 내부에서 실행한 뒤
예약 차감 공용 현금과 bucket max-band 상한을 계산한다. Caller가 계산한 occupancy나 면제 예약
목록을 주입하지 않는다. `projectSnapshotOpeningBudget`의 산술을 기존 historical resolver와 공유하며
기존 historical assessment와 저장 형식은 유지한다. 공통 함수 자체는 인증기가 아니다.

Pending BUY는 이미 예약 gross에 포함되므로 두 번 차감하지 않는다. 미제출 reserved/bound 금액도
현금과 band에서 차감하고 pending SELL의 예상 대금은 더하지 않는다. Cash reserve는 기존 정책의
minimum/target 규칙을 유지하며 max band는 canonical decimal을 사용해 KRW 아래로 자른다.
부족한 현금/band는 0으로 자르고 BigInt 합계로 overcommit을 판정한다. 각 bucket의 현금 상한은
하나의 pool을 공유하므로 여러 bucket에서 독립적으로 사용할 수 있는 예산이 아니다. Slot이 0이어도
금액 상한은 별도 값이며 selectionTrigger/최종 sizing/할당 허용을 의미하지 않는다.

새 결과는 supplied policy와 supplied portfolio 내용에 대한 계산일 뿐 활성 정책/실제 현재 상태,
회계·shared ledger CAS·실행 권한은 인증하지 않는다. I/O·lock·write·새 lease와 current publisher
연결은 추가하지 않는다. 실제 source lease, gross fill 0~3회, unbound/bound 예약, 공유 현금,
safe integer·decimal floor·과점유 경계를 테스트하며 historical 결과와 대조한다. 손상 원본은
수정하지 않고 실패하며 재시작 재계산은 동일하다. Migration은 없고 새 consumer와 함께 코드로
rollback하며 원본 journal 삭제·변환은 하지 않는다.

`appendOpeningBudgetBoundCurrentPortfolioSizingSnapshot`는 실제 journaled portfolio revision과
현재 활성 정책을 기존 source lock 순서로 결속하고, 같은 callback에서 held budget을 계산한 뒤
snapshot append 또는 exact-retry fsync까지 잠금을 유지한다. 신규 repository 경로
`appendWithOpeningBudgetForActivePolicy`는 actual active policy를 내부 조회하며 supplied budget이나
policy를 caller가 주입하지 못한다. Pending/terminal 검증은 budget 내부에서 한 번만 수행한다.

결과는 `{snapshot, openingBudget}`이며 반환 뒤에는 잠금이 해제된 관측 결과다. 향후 할당 시점의
lease/CAS 승인이나 accounting/실행 권한이 아니다. Repository 단독 호출은 실제 portfolio 인증이
아니며 current wrapper가 그 잠금을 소유한다. 하위 budget assessment의 비권한 범위는 그대로다.
기존 current/policy-bound API의 반환 snapshot 형식과 legacy 정책 동작은 유지한다. 새 진입점만
모든 bucket의 명시적 opening 한도를 요구하며 legacy 한도를 합성하지 않는다. Cash/band 과점유는
계산 결과로 반환하며 관측 발행 자체를 신규 매수 승인으로 취급하지 않는다.

수동/selector 실제 저장소 테스트는 current revision·정책 hash·historical 계산 일치, exact retry,
legacy 호환성, caller override·정책/예약 손상 거절과 bytes 보존, 첫 발행/재시도 fsync 중 portfolio·
price·activation·capacity 잠금 유지, retry fsync 실패 전파와 해제를 확인한다. 저장 schema 변화나
migration은 없다. Rollback은 새 진입점 consumer와 함께 수행하며 기존 snapshot journal을 삭제하지
않는다. 공용 allocator/CAS와 전체 회계 원자성은 여전히 후속이고 최종 수용 기준은 완료로 표시하지 않는다.

`withPublishedCurrentOpeningBudget`는 동일 발행 경로의 source 잠금을 후속 내부 callback 종료까지
유지한다. Repository의 recorded-time coverage 경로는 아래 기록 시각 검사 뒤 snapshot append/retry fsync와
dependency 확인을 거쳐 callback을 실행하고 정상 반환 후 dependency를 다시 확인한다. Actual portfolio
잠금은 current wrapper가 계속 소유한다. 기존 append API의 반환과 저장 형식은 불변이다.

`assertHeldCurrentOpeningBudget`는 current wrapper가 발급한 실제 callback 객체를 private WeakMap으로
인증하고 baseDir/portfolioPath와 관측 후 시계 역행을 검사한다. 복사·structured clone·다른 경로,
일반 append 반환값과 callback 정상/예외 종료 후 값은 거절한다. Scope는 finally에서 폐기하며
새 callback 중에도 이전 객체가 다시 유효해지지 않는다. 원본 내용은 이후 읽을 수 있지만 scope
검사를 통과하지 못하므로 후속 현재 상태 저장의 보유 증거로 사용할 수 없다. Scope identity 검사
자체는 cutoff 완전성 검사가 아니다. Current publisher는 아래 plan/fill/capacity 기록 시각 coverage를
별도로 검사하며 정책/증거 freshness와 현재 할당 가능성은 후속 consumer의 별도 gate다.

이는 trusted internal composition 경계이며 source lock을 다시 취득하는 repository를 callback
안에서 호출하면 안 된다. Snapshot은 callback 시작 전에 durable하므로 consumer 실패가 기존
발행이나 임의 consumer write를 rollback하지 않는다. 실패는 전파하고 정확한 snapshot retry와
명시적 복구를 사용해야 한다. 소비자 commit·공유 ledger CAS·allocation·전체 회계 transaction은
아직 연결하지 않는다. 실제 테스트는 async callback 중 portfolio/price/activation/capacity 잠금,
객체/경로/수명, source 손상 시 callback 미호출·bytes 보존, consumer 및 시계 오류 뒤 폐기·재시도를
검증한다. 영구 artifact/schema migration은 없고 후속 consumer와 함께 코드 rollback한다.

`BucketOpeningCapacityStateFileRepository.refreshFromCurrentPublication`은 문서 잠금을 먼저 취득하고
기존 문서를 historical replay로 확인한 뒤 current publication callback을 실행한다. Actual portfolio·
policy·reservation source 잠금이 유지된 callback에서 전체 bucket payload를 재계산하고 document CAS와
temporary file fsync/rename을 수행한다. 일반 historical `refresh`/`readVerifiedSnapshot`은 유지한다.
두 계산 경로는 `projectBucketOpeningCapacityStates`의 payload 조립을 공유하며 이 helper 자체는
source 인증기가 아니다. 기존 schema/ID/hash/정렬 및 다른 portfolio 항목 보존 규칙은 불변이다.

Strict 입력은 `{snapshotInput, expectedDocumentHash}`이며 baseDir는 repository가 소유한다.
Snapshot 입력은 current publisher의 동일 schema에서 baseDir만 제외하고 await 전에 캡처한다.
Caller state/budget/source scope나 baseDir override는 허용하지 않는다. 실제 current scope와
문서 소유권을 확인하고, 동일 문서는 원래 expected hash가 이전 값이어도 fsync 후 반환한다.
변경 문서는 expected hash가 일치해야 하고 asOf가 이전 항목보다 엄격히 증가해야 한다. 같은
cutoff의 portfolio ABA replacement와 시간 역행은 거절한다. 갱신 전체가 같은 문서 잠금으로
직렬화되므로 동시 exact retry는 수렴하고 서로 다른 CAS 경쟁은 하나만 성공한다.

Snapshot publication이 document CAS보다 먼저이므로 CAS 실패 시 immutable snapshot은 남을 수
있지만 기존 capacity 문서는 유지된다. Temporary file fsync 실패는 rename 전에 기존 bytes를
보존하며 정상 재시도로 수렴한다. Rename 뒤 동기화/소유권/시계/dependency 실패는 이미 새 문서가
보일 수 있으므로 전체 rollback이나 다중 artifact atomic commit을 주장하지 않는다. 결과 오류 시
자동 삭제하지 않고 실제 문서/source 검증과 exact retry 또는 명시적 복구를 사용한다.

실제 테스트는 수동/selector의 historical 결과·재시작·기존 refresh 호환성, stale CAS의 snapshot
잔존과 문서 보존, 같은 시각 ABA, concurrent exact/competing CAS, 입력 캡처, 문서/portfolio/source
잠금 유지, pre-rename 실패와 원본/문서 손상 bytes 보존을 확인한다. 저장된 문서는 여전히 cutoff
projection이며 source 변경이 없는 최신 할당 승인이 아니다. Read-only replay도 current lease를
발급하지 않는다. Allocation/최신성 gate/전체 회계 원자성은 후속이다. Migration은 없고 새 consumer와
함께 코드 rollback하며 정상 기존 schema 문서는 historical reader로 계속 확인할 수 있다.

현재 callback 발행은 `withPublishedOpeningBudgetForRecordedTimeCoverage`를 거쳐 snapshot 저장/exact retry
전에 `assertHeldOpeningRecordedTimeCoverage`를 실행한다. 대상 portfolio의 실제 plan 전체
(event 없는 plan 포함), plan event, paper fill/완료 marker, capacity event에 기록된 시각이 cutoff보다
엄격히 앞서야 한다. Record 자체가 과거 createdAt을 담아도 marker 시각이 cutoff 이후이면 거절한다.
같은 millisecond는 선후관계가 모호하므로 거절한다. 다른 portfolio의 정상 이력은 이 cutoff 검사에서
제외하지만 전체 journal 구조 검증은 기존 저장소가 먼저 수행한다. Empty source도 실제 경로·callback
수명 확인을 생략하지 않으며 copied/foreign/expired source와 관측 시계 역행은 거절한다.

이 검사는 현재 `withPublishedCurrentOpeningBudget`와 이를 사용하는 capacity 문서 refresh에
연결된다. 늦게 append된 event 없는 plan도 기존 문서의 exact retry를 무효화하며 callback이나
snapshot/document write 전에 거절한다. 새 cutoff로 재평가하고 정상 expected hash를 제출해야 한다.
Detached `appendOpeningBudgetBoundCurrentPortfolioSizingSnapshot` 및 일반 historical reader/refresh와
`withPublishedOpeningBudgetForActivePolicy`는 과거 cutoff 재생 의미를 유지한다.

검사 범위는 지금 잠금 아래 durable하게 관측한 전체 journal의 **기록 시각 coverage**다. Marker의
`committedAt`은 해당 marker fsync 전에, fill의 `completedAt`은 completion line fsync 전에 정해질 수
있으므로 이 값으로 **과거 cutoff의 durable availability를 인증하지 않는다**. Marker fsync가 cutoff를
넘어도 기록 자체는 현재 관측한 generation에 포함돼 계산 대상이며, 결과의 `historicalDiskAvailability`
값은 계속 `not_proven`이다. 과거 가용성 인증이 필요한 consumer는 별도의 post-fsync availability
receipt 계약이 없으면 승인하면 안 된다. 이 PR은 그러한 receipt나 historical approval을 발급하지 않는다.

모든 business source의 freshness나 실제 portfolio 회계 반영도 증명하지 않는다. Fill의 기록 시각이
cutoff보다 앞서 있다는 사실만으로 portfolio 반영,
capacity consumption 또는 mandate/selection eligibility가 완료됐다고 판단하면 안 된다. 활성 정책,
root/mandate/consumption/pending 결속은 기존 publisher가 별도로 계속 검증하며, selection evidence
freshness·allocator·원자 회계·실행 승인은 후속이다. Persistent schema는 변경하지 않고 consumer와
함께 코드 rollback한다. Actual journal 경계·orphan fill·독립 completion marker·event 없는 plan 및
현재 발행/문서 retry의 bytes 보존을 테스트한다. 실제 marker fsync를 cutoff 뒤로 지연하는 테스트도
historical availability가 `not_proven`으로 남음을 확인하며 최종 수용 기준 완료를 주장하지 않는다.

Opening publication callback의 두 번째 인자는 새 snapshot을 포함한 실제
`VerifiedPortfolioSizingSnapshotHistory`다. Publisher가 이미 소유한 snapshot lock 아래 append/exact
retry 뒤 파일을 다시 읽고 rehash·valuation replay·fsync·descriptor/path 재검증을 수행한다. 이 전체
generation은 발행 전 이력에 실제 새 snapshot 하나를 추가한 값(또는 exact retry의 동일 이력)과
일치해야 한다. 다른 snapshot의 삭제·교체·추가를 새 source로 승인하지 않는다. 이전 이력은 기존
issuance receipt 검증용 private prefix로만 유지하고 소비자에게 새 이력을 전달한다.

기존 인자 하나만 받는 callback은 그대로 동작하며 standalone append의 반환/저장 형식은 불변이다.
소비자는 source repository를 재진입하지 않고 이 실제 이력의 관측/hash와 source 인증기를 사용한다.
새 source 관측은 capacity 관측보다 빠를 수 없고, current publication scope의 시계 기준도 이 나중
관측을 사용한다. 정상/예외 종료 후 source lease와 current scope는 폐기하며 내용만 historical로
읽을 수 있다. 복사/다른 경로/만료 source는 후속 source 인증을 통과하지 못한다.

발행 뒤 재읽기/fsync/generation 검사 실패는 consumer를 호출하지 않지만 이미 저장된 snapshot은
남을 수 있다. 예상과 다른 파일 bytes를 자동 복구하거나 삭제하지 않는다. 소비자 실패도 기존
snapshot/임의 consumer write를 rollback하지 않는다. 실제 테스트는 새 generation·exact retry,
잠금/수명·consumer 실패·발행 후 fsync 실패·유효한 snapshot만 남긴 prefix 삭제·나중 관측 시계
역행을 검증한다. 이 연결은 snapshot 원본 전달이며 reservation write capability, allocator, 과거
cutoff의 durable availability나 원자 회계 승인이 아니다. Schema migration 없이 consumer와 함께
코드를 rollback하며 정상 journal은 보존한다.

같은 ID의 exact retry는 전체 원본과 journal 검증 후 기존 origin을 반환하며 새 pair를 쓰지 않는다.
수동 예약 repository의 내부 `withAppendSessionFromSources`는 실제 활성 manual/snapshot lease를
인증하고 reservation lock을 한 번 소유한 callback 안에서 append를 수행한다. 호출자가 제공한
배열·복사·외부 경로·만료 source는 허용하지 않는다. 세션의 append는 겹쳐 실행할 수 없고,
각 append 직전의 실제 commit generation이 세션 시작 이력과 자신의 성공한 append 결과에서
벗어나면 유효한 짧은 prefix여도 거절하며 bytes를 자동 복구하지 않는다.
callback이 먼저 반환해도 시작한 write가 끝나기 전에는 lock을 풀지 않는다. Write 실패를 callback이
잡아도 세션 전체는 실패하며 종료 후 캡처한 append 함수는 만료된다. Consumer 실패는 이미 durable한
예약을 rollback하지 않고, journal write 실패의 pending barrier는 명시적 복구용으로 보존한다.

선행 snapshot prefix를 포함한 나중의 실제 snapshot source를 전달하는 내부 계약도 갖지만,
현재 publisher의 예약 source reader를 이 writer session으로 연결하는 composition은 후속이다.
이 primitive는 기존 source-bound journal 저장 규칙만 재사용한다. 반복 authorization/slot 배정의
적법성, active selection evidence/freshness, 공용 capacity CAS, mandate/event 원자 발행이나 매수
승인을 부여하지 않는다. 단위 fixture의 추가 journal record를 실제 allocator 승인으로 해석하지 않는다.
저장 schema 변경 없이 호출 consumer와 함께 코드 rollback하며 기존 journal bytes는 보존한다.

CreatedAt이 달라진 같은 ID는 collision이고, 새 ID를 만들어도 이미 발급된 candidateAssignmentId는
재사용할 수 없다. 이 unique issuance는 실제 shared slot unique/CAS 또는 activation을 대신하지 않는다.
Torn line, hash/chain/receipt mismatch, duplicate issuance, 손상 suffix와 관측 중 파일 변경은 fail-closed다.

Selector reservation repository도 실제 request/snapshot/sizing/assignment source lease를 재사용하는
내부 append session을 제공할 수 있다. 이 session은 reservation lock을 재진입하지 않고 generation과
source lease를 append 경계마다 재검증한다. 이는 selector issuance의 allocator 적법성이나 mandate/event
원자 발행 권한을 부여하지 않으며, publisher composition 연결은 별도 단계다.
Journal bytes는 UTF-8 decode/encode 왕복이 정확히 일치해야 하며 malformed byte의 대체 문자 변환으로
JSON/hash가 우연히 같아지는 경우도 거절한다. 올바르게 인코딩된 U+FFFD 식별자는 계속 허용한다.
Pending barrier는 entry/marker 중단 시 남겨 자동 재시도나 읽기가 불완전한 기록을 성공으로 간주하지 않게 한다.
잠금 획득의 EEXIST 및 Windows EPERM만 monotonic deadline 안에서 재시도하고 초기화 실패/소유권 변경은
자동 복구하지 않는다. 원본 데이터를 삭제하거나 거래를 활성화하지 않는다.

신규 파일만 추가되며 기존 opaque 예약을 자동 변환하지 않는다. 실제 원장 allocator/CAS·mandate activation
동일 transaction·accounting/position 반영·과거 disk 가용성 증명은 후속이다. Rollback은 신규 consumer를
중단하고 코드를 되돌리며 새 journal을 보존한다. Pending barrier가 남았으면 진행 writer와 원본 무결성을
별도로 확인한 명시적 복구가 필요하고 이 PR은 자동 복구 명령을 제공하지 않는다.

<!-- /spom-source -->

## 기존 PR 후속의 세부 계약 · 원문 6720–6726행

<a id="spom-source-6720-6726"></a>
<!-- spom-source:6720-6726 sha256:8a0f763ffa8811d1546580c2cbc4ee81060f4d5695c0941f589389b50d7d32e6 -->

이번 단계에서는 `credential-free-fundamental.v1` immutable envelope만 추가한다. issuer/symbol/
fiscal period, 관측 시각, 원문 URI와 문서 hash, metric period를 canonical payload에 결속하고,
evidence ref/hash를 파생한다. 외부 네트워크 호출이나 provider 권위 승격은 하지 않으며,
`unavailable` 상태는 evidence로 저장하지 않는다. 실제 공식 provider adapter와 license/계정
검토는 별도 owner 판단 단계로 남긴다. `FundamentalEvidenceFileRepository`는 이 envelope를
credential-free append-only JSONL artifact로 저장하고 exact retry/replay만 제공한다.

<!-- /spom-source -->
