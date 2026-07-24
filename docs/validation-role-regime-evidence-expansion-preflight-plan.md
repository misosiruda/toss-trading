# Validation Role-Regime Evidence Expansion Preflight 계획

이 문서는 expanded paper-only replay를 실행하기 전에 source와 candidate capacity만으로 확장 가능성을 판정하는 계약을 고정한다.

Preflight는 전략 성과를 평가하지 않는다. Replay return, PnL, Sharpe, PSR, DSR, PBO, hit rate, drawdown, selection score 또는 기존 전략 판정은 입력으로 읽지 않는다. AI decision 결과도 사용하지 않는다. 입력 provenance, calendar-valid source coverage, deterministic candidate enumeration과 의존성 진단에 필요한 시간 구조만 사용한다.

이 문서는 특정 종목 판단, 투자 조언, 성과 보장, live order, broker mutation, natural language order, raw `codex exec`, raw `tossctl`, `place_order` surface 또는 Risk Engine 우회를 포함하지 않는다.

## 배경

현재 구현은 다음 근거를 제공한다.

- `validation_split_regime_feasibility.v1`은 현재 source에서 role-local candidate, role-regime count, calendar/scope rejection과 pairwise trading-date overlap을 계산한다.
- `validation_role_regime_replay_plan.v1`은 role 안에서 candidate를 deduplicate하고 cross-role shared evidence를 보존한 deterministic replay schedule을 만든다.
- `validation_role_regime_statistical_readiness.v1`은 role-local, role-exclusive, global unique와 shared evidence count를 분리하고 blocker를 계산한다.
- `official_market_calendar_evidence.v1`은 KRX/NYSE official calendar evidence가 주장해야 할 provenance와 session invariant를 정의한다.

현재 artifact는 이미 실행한 source의 상태를 설명하지만 다음 결정을 소유하지 않는다.

- 확장 source의 사전 고정된 범위와 provenance
- 현재 baseline과 확장 candidate의 중복 및 인접성
- Role 및 role-regime별 목표와 capacity gap
- Effective sample size 계산에 전달할 dependency diagnostic 입력
- 충족할 수 없는 cell과 제외된 candidate의 구조화된 사유
- 결과 metric을 보지 않았음을 검증할 input boundary

따라서 expanded replay 전에 별도 preflight artifact가 필요하다.

## 목적

첫 contract version의 목적은 다음과 같다.

1. 결과 metric을 읽지 않고 확장 source가 목표 evidence matrix를 구조적으로 지원할 수 있는지 계산한다.
2. Baseline과 expansion candidate의 source-bound provenance identity와 source-independent evidence identity를 분리해 비교한다.
3. Role-local count, role-exclusive count와 cross-role shared count를 구분한다.
4. Overlap, adjacency와 effective sample diagnostic 입력을 결과 해석 전에 고정한다.
5. 부족하거나 사용할 수 없는 role-regime cell과 제외 사유를 artifact에 남긴다.
6. 모든 gate가 충족되지 않으면 expanded replay 승격을 fail-closed로 차단한다.

`ready_for_expansion_replay`는 사전 고정한 paper-only replay를 실행할 구조적 준비가 됐다는 뜻만 가진다. 전략 유효성, 통계적 유의성, 수익성 또는 live 사용 가능성을 뜻하지 않는다.

## Input Boundary

### 허용 입력

Preflight builder는 다음 artifact와 source만 읽는다.

- Baseline `validation_split_regime_feasibility.v1`
- Baseline `validation_role_regime_replay_plan.v1`
- Baseline `validation_role_regime_statistical_readiness.v1`
- Expansion historical snapshot source
- Expansion universe manifest와 coverage artifact
- Validation split assignment source
- Calendar validation rule과 fixture
- 사용 가능한 경우 `official_market_calendar_evidence.v1`
- Version이 고정된 deterministic market regime classifier config
- 사전 고정한 role 및 role-regime target matrix
- Overlap, adjacency와 effective sample diagnostic input policy

Snapshot의 price와 timestamp는 deterministic candidate enumeration과 regime classification에만 사용할 수 있다. Candidate 또는 source를 성과 순으로 정렬하거나 선택하는 데 사용하지 않는다.

### 금지 입력

다음 artifact 또는 field를 읽어 target, source range, candidate 포함 여부나 제외 여부를 결정하지 않는다.

- Historical replay run report
- Batch aggregate research report
- Strategy bucket result 또는 comparison report
- Virtual decision, virtual trade, virtual portfolio
- Return, PnL, Sharpe, PSR, DSR, PBO, hit rate, drawdown
- Selection metric, candidate rank, selected candidate key
- AI rationale, recommendation 또는 action

Source parser가 금지된 result artifact를 입력 option으로 받지 않도록 command surface를 allowlist로 제한한다. Strict source schema에 성과 field가 섞이면 무시하지 않고 `RESULT_METRIC_INPUT_FORBIDDEN`으로 `invalid` 처리한다.

## 제안 Artifact Contract

후속 구현은 다음 `validation_role_regime_evidence_expansion_preflight.v1` artifact를 사용한다.

```ts
interface ValidationRoleRegimeEvidenceExpansionPreflight {
  schemaVersion:
    "validation_role_regime_evidence_expansion_preflight.v1";
  mode: "paper_only";
  purpose: "evidence_expansion_preflight";
  status: "ready_for_expansion_replay" | "inconclusive" | "invalid";
  generatedAt: string;
  source: {
    baselineFeasibilityArtifactHash: string;
    baselinePlanHash: string;
    baselineReadinessArtifactHash: string;
    expansionDataSnapshotHash: string;
    expansionUniverseHash: string;
    expansionCoverageHash: string;
    validationSplitHash: string;
    calendarHash: string;
    officialCalendarArtifactHash: string | null;
    marketRegimeClassifierHash: string;
  };
  config: {
    candidateStrategyBucket: "short_term";
    targetRegimes: Array<"bull" | "bear" | "sideways" | "mixed">;
    windowMonths: number;
    timezoneOffsetMinutes: number;
    roleSampleMinimum: 30;
    roleRegimeSampleMinimum: number | null;
    inputPolicyVersion: "result_blind_capacity_scan.v1";
    dependencyDiagnosticPolicyVersion:
      "overlap_adjacency_inputs.v1";
  };
  targetMatrix: EvidenceExpansionTargetMatrix;
  capacity: EvidenceExpansionCapacitySummary;
  dependencyInputs: EvidenceExpansionDependencyInputs;
  exclusions: EvidenceExpansionExclusion[];
  blockers: EvidenceExpansionBlocker[];
  preflightHash: string;
}
```

첫 version에서 `candidateStrategyBucket`은 현재 검증 대상인 `short_term`으로 고정한다. 다른 bucket 확장은 별도 사전 계획과 artifact로 분리한다.

## Target Matrix

Target matrix는 결과 확인 전에 고정하며 다음 단위를 분리한다.

```ts
interface EvidenceExpansionTargetMatrix {
  byRole: {
    train: EvidenceExpansionRoleTarget;
    validation: EvidenceExpansionRoleTarget;
    test: EvidenceExpansionRoleTarget;
  };
}

interface EvidenceExpansionRoleTarget {
  roleLocalUniqueMinimum: 30;
  roleExclusiveMinimum: 30;
  byRegime: {
    bull: number | null;
    bear: number | null;
    sideways: number | null;
    mixed: number | null;
  };
}
```

현재 계약된 role sample minimum은 30이다. Role-regime statistical minimum은 아직 결정되지 않았으므로 첫 artifact에서 `byRegime` target은 `null`을 허용하고 `ROLE_REGIME_TARGET_UNDEFINED` blocker를 생성한다.

`null` target을 0으로 취급하거나 current candidate count로 채우지 않는다. Role-regime minimum이 별도 사전 계약으로 결정되기 전에는 preflight status를 `ready_for_expansion_replay`로 만들 수 없다.

Role-local candidate가 30개여도 cross-role shared candidate를 제외한 role-exclusive count가 30 미만이면 해당 role target은 미충족이다.

## Capacity Scan

Capacity scan은 기존 feasibility semantics를 재사용하되 baseline과 expansion을 분리해 기록한다.

```ts
interface EvidenceExpansionCapacitySummary {
  baseline: EvidenceExpansionCapacityView;
  expansion: EvidenceExpansionCapacityView;
  combined: EvidenceExpansionCapacityView;
  incremental: EvidenceExpansionCapacityView;
}

interface EvidenceExpansionCapacityView {
  globalUniqueEvidenceGroupCount: number;
  crossRoleSharedEvidenceGroupCount: number;
  byRole: Record<
    "train" | "validation" | "test",
    {
      roleLocalUniqueEvidenceGroupCount: number;
      roleExclusiveEvidenceGroupCount: number;
      byRegime: Record<
        "bull" | "bear" | "sideways" | "mixed",
        number
      >;
    }
  >;
}
```

- `baseline`은 baseline plan과 readiness provenance에서 재검증한 evidence group이다.
- `expansion`은 expansion source에서 열거한 candidate를 source-independent evidence group으로 집계한 결과다.
- `combined`는 baseline과 expansion을 합친 뒤 동일 `evidenceGroupHash`를 deduplicate한 결과다.
- `incremental`은 combined에서 baseline과 동일한 evidence group을 제외한 신규 capacity다.
- 같은 evidence group이 여러 assignment에 있어도 role 안에서는 한 번만 센다.
- 같은 evidence group이 여러 role에 있으면 role-local row에는 남기되 global unique와 role-exclusive count에서 구분한다.
- Candidate count는 replay return sample count나 independent sample count가 아니다.

Capacity scan은 role-regime target을 충족하지 못한 cell을 다른 regime candidate로 대체하지 않는다.

## Candidate Identity와 Provenance

Baseline과 expansion candidate는 서로 다른 두 identity를 가진다.

### Existing hash compatibility

Baseline `validation_split_regime_feasibility.v1`의 `marketRegimeClassifierHash`는 기존 `createValidationFeasibilityClassifierHash()`로 classifier config에서 재계산한다. `candidateHash`는 기존 `createValidationFeasibilityCandidateHash()` payload와 helper로만 재검증한다. 새 field를 기존 hash payload에 추가하거나 hash equality를 새 preflight identity와 비교하지 않는다.

현재 `validation_role_regime_replay_plan.v1`의 `candidateHash`와 `evidenceGroupHash`가 같은 값인 계약도 source artifact 검증에서는 그대로 유지한다. 이 기존 `evidenceGroupHash`는 baseline plan provenance를 검증하는 legacy field이며, baseline과 expansion 사이의 preflight deduplication key로 사용하지 않는다.

기존 artifact가 새 identity field를 갖지 않는다는 이유만으로 `invalid` 처리하지 않는다. Parser는 기존 schema/version을 먼저 검증한 뒤 아래 두 preflight identity를 별도로 계산한다.

### Source-bound variant identity

`sourceVariantHash`는 preflight 안에서 candidate row가 어떤 source와 validation config에서 생성됐는지 검증하는 새 versioned identity다.

```ts
interface SourceCandidateVariantReference {
  feasibilityCandidateHash: string;
  legacyReplayPlanEvidenceGroupHash: string | null;
  sourceVariantHashVersion: "evidence_expansion_source_variant.v1";
  sourceVariantHash: string;
  observedTradingDatesHash: string;
  universeMembershipHash: string;
}
```

`sourceVariantHash` payload는 다음 field를 포함한다.

- 아래에서 계산한 새 `evidenceGroupHash`
- 기존 contract로 검증한 `feasibilityCandidateHash`
- `scopeAvailable`
- `calendarHash`
- `marketRegimeClassifierHash`
- `dataSnapshotHash`, `universeHash`, `coverageHash`
- `validationSplitHash`
- Source variant에서 관측한 `observedTradingDatesHash`
- Source variant의 `universeMembershipHash`

Source를 확장하거나 동일 기간을 다시 수집하면 provenance hash, 기존 `feasibilityCandidateHash`와 새 `sourceVariantHash`는 달라질 수 있다. 이 차이는 artifact provenance를 보존하지만 신규 independent evidence capacity를 뜻하지 않는다.

### Source-independent evidence identity

`evidenceGroupHash`는 baseline과 expansion 사이의 deduplication, incremental capacity, cross-role shared 판정에만 사용한다. 첫 version은 다음 canonical payload로 계산한다.

```ts
interface EvidenceGroupHashInput {
  startAt: string;
  endAt: string;
  candidateStrategyBucket: "short_term";
  windowMonths: number;
  timezoneOffsetMinutes: number;
}
```

`evidenceGroupHash`에는 다음 값을 넣지 않는다.

- `dataSnapshotHash`, `universeHash`, `coverageHash`
- `validationSplitHash`, `calendarHash`
- `marketRegimeClassifierHash` 또는 regime label
- `scopeAvailable`
- Role, split, assignment
- 결과 metric 또는 selection state

따라서 동일 기간과 window policy를 가진 baseline·expansion row는 source 재수집, coverage 확장, calendar 갱신 또는 classifier 재계산으로 기존 `feasibilityCandidateHash`와 새 `sourceVariantHash`가 달라져도 같은 evidence group으로 집계한다. Source correction이나 universe 확장이 동일 market-history interval을 새 독립 근거로 만들지 못하게 하는 보수적 규칙이다.

동일 evidence group이 다른 role이나 assignment에 나타나면 shared evidence로 기록한다. Regime label이 다르면 identity를 분리하지 않고 `CANDIDATE_IDENTITY_CONFLICT` blocker로 남긴다.

Baseline artifact의 기존 `candidateHash`와 replay-plan `evidenceGroupHash`는 기존 version의 payload/helper로 재검증한다. 그 검증이 끝난 source row에서 새 `sourceVariantHash`와 source-independent `evidenceGroupHash`를 계산한다. Expansion에도 동일한 preflight hash builder를 적용한다.

다음 mismatch는 `invalid`다.

- 기존 feasibility `candidateHash`가 기존 helper의 재계산 결과와 다름
- 기존 replay-plan `candidateHash`와 legacy `evidenceGroupHash`가 현재 contract와 다름
- 같은 source-bound variant payload가 서로 다른 `sourceVariantHash`를 가짐
- 같은 `sourceVariantHash`가 서로 다른 source-bound variant payload를 가짐
- 같은 source-independent payload가 서로 다른 `evidenceGroupHash`를 가짐
- 같은 `evidenceGroupHash`가 서로 다른 source-independent payload를 가짐
- 같은 evidence group의 baseline과 expansion regime label이 충돌함
- Baseline과 expansion이 다른 classifier version 또는 effective config를 사용함
- Calendar, universe, coverage 또는 validation split hash를 재계산할 수 없음
- Expansion source가 baseline range와 겹치지만 overlap provenance가 누락됨

## Calendar Gate

Expansion candidate는 market별 calendar validation을 통과해야 한다.

- Calendar fixture/rule mismatch candidate는 capacity에서 제외하고 사유를 기록한다.
- Official calendar artifact가 제공되면 artifact hash, freshness와 expected session을 검증한다.
- Official calendar artifact가 없으면 current `observed_session_only` 한계를 blocker로 남긴다.
- Missing official holiday, special closure 또는 early-close evidence를 정규 session으로 추정하지 않는다.
- Calendar mismatch candidate를 다른 날짜나 market으로 자동 대체하지 않는다.

현재 official source ingestion과 runtime 연결이 없으므로 실제 preflight는 `OFFICIAL_CALENDAR_EVIDENCE_MISSING` blocker를 유지해야 한다. Contract fixture만으로 calendar readiness pass를 주장하지 않는다.

## Dependency Diagnostic Inputs

Preflight는 effective sample size를 계산하지 않는다. 계산 방식이 아직 사전 계약되지 않았기 때문이다. 대신 후속 통계 계산이 재현 가능하도록 다음 입력을 보존한다.

```ts
interface EvidenceExpansionDependencyInputs {
  candidateIntervals: Array<{
    evidenceGroupHash: string;
    sourceVariants: SourceCandidateVariantReference[];
    splitRoles: Array<"train" | "validation" | "test">;
    targetRegime: "bull" | "bear" | "sideways" | "mixed";
    startAt: string;
    endAt: string;
    canonicalTradingDatesHash: string;
    combinedUniverseMembershipHash: string;
  }>;
  pairwise: Array<{
    leftEvidenceGroupHash: string;
    rightEvidenceGroupHash: string;
    tradingDateOverlapCount: number;
    tradingDateUnionCount: number;
    tradingDateOverlapRatio: number;
    adjacencyTradingDayGap: number | null;
    sharedUniverse: boolean;
    sameRegime: boolean;
    crossRole: boolean;
  }>;
}
```

Pairwise row는 evidence hash canonical order로 정렬한다. 자기 자신과의 pair는 기록하지 않는다.

- `candidateIntervals`는 `evidenceGroupHash`별로 하나만 존재한다.
- `sourceVariants`와 `splitRoles`는 중복을 제거하고 canonical order로 정렬한다.
- `sourceVariants`는 `sourceVariantHash`, `feasibilityCandidateHash` 순으로 정렬한다.
- Baseline과 expansion의 기존 candidate hash와 새 source variant hash가 달라도 같은 evidence group row에 provenance variant로 보존한다.
- 각 source variant의 `observedTradingDatesHash`는 해당 variant snapshot에서 계산하며 다른 variant 값으로 덮어쓰지 않는다.
- `canonicalTradingDatesHash`는 검증된 `official_market_calendar_evidence.v1`에서 interval과 required market의 expected session date를 계산한 hash다.
- Accepted source variant의 `observedTradingDatesHash`가 `canonicalTradingDatesHash`와 하나라도 다르면 `TRADING_DATE_SET_CONFLICT`로 `invalid` 처리하고 pairwise row를 계산하지 않는다.
- Official calendar evidence가 없거나 canonical trading-date set을 계산할 수 없으면 기존 `OFFICIAL_CALENDAR_EVIDENCE_MISSING` 또는 `DEPENDENCY_INPUT_INCOMPLETE` blocker를 유지하고 pairwise row를 계산하지 않는다.
- `combinedUniverseMembershipHash`는 source variant universe membership의 canonical union을 hash한 값이다. Pairwise `sharedUniverse`는 이 union 간 실제 symbol intersection 존재 여부로 계산해 source 확장에 따른 shared universe를 누락하지 않는다.
- Overlap ratio는 intersection trading-date count를 union trading-date count로 나눈 값이다.
- Overlap이 있으면 `adjacencyTradingDayGap=null`이다.
- 겹치지 않으면 두 interval 사이의 source trading-day gap을 기록한다.
- Calendar date 차이를 trading-day gap으로 대체하지 않는다.
- Shared universe와 regime persistence는 serial dependence 진단 입력이지 독립성 증명이나 exclusion threshold가 아니다.
- Effective sample size, autocorrelation correction 또는 cluster rule은 별도 사전 계약 전까지 계산하지 않는다.

## Exclusion Contract

모든 structural candidate는 accepted 또는 excluded로 설명 가능해야 한다. 제외 row는 삭제하지 않고 count와 사유를 보존한다.

```ts
interface EvidenceExpansionExclusion {
  sourceVariants: SourceCandidateVariantReference[];
  evidenceGroupHash: string;
  splitRole: "train" | "validation" | "test" | null;
  targetRegime: "bull" | "bear" | "sideways" | "mixed" | null;
  reason:
    | "CALENDAR_SESSION_REJECTED"
    | "SCOPE_UNAVAILABLE"
    | "ROLE_BOUNDARY_VIOLATION"
    | "EMBARGO_VIOLATION"
    | "DUPLICATE_BASELINE_EVIDENCE"
    | "DUPLICATE_EXPANSION_EVIDENCE"
    | "CROSS_ROLE_SHARED_EVIDENCE"
    | "INSUFFICIENT_REGIME_DATA";
  message: string;
}
```

`CROSS_ROLE_SHARED_EVIDENCE`는 role-local diagnostic row를 제거한다는 뜻이 아니다. Role-exclusive capacity에서 제외되는 이유를 기록한다.

Summary의 structural count는 accepted unique evidence-group count와 exclusion count로 재계산 가능해야 한다. 같은 candidate가 여러 사유에 해당하면 canonical primary reason 하나와 별도 blocker를 사용해 이중 집계를 방지한다. Source variant가 여러 개여도 같은 `evidenceGroupHash`의 exclusion은 capacity에서 한 번만 센다.

## Blocker와 Status

Blocker code 첫 version은 다음을 사용한다.

- `RESULT_METRIC_INPUT_FORBIDDEN`
- `SOURCE_PROVENANCE_INVALID`
- `BASELINE_PROVENANCE_CONFLICT`
- `EXPANSION_SOURCE_COVERAGE_MISSING`
- `OFFICIAL_CALENDAR_EVIDENCE_MISSING`
- `OFFICIAL_CALENDAR_EVIDENCE_INVALID`
- `ROLE_LOCAL_CAPACITY_BELOW_TARGET`
- `ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET`
- `ROLE_REGIME_TARGET_UNDEFINED`
- `ROLE_REGIME_CAPACITY_BELOW_TARGET`
- `DEPENDENCY_INPUT_INCOMPLETE`
- `TRADING_DATE_SET_CONFLICT`
- `CANDIDATE_IDENTITY_CONFLICT`
- `EXCLUSION_COUNT_CONFLICT`

### `ready_for_expansion_replay`

다음 조건을 모두 만족할 때만 사용할 수 있다.

- 모든 source schema와 provenance hash가 검증됨
- 금지된 result metric 입력이 없음
- Official calendar evidence가 market별로 검증됨
- Role-local 및 role-exclusive target이 모두 충족됨
- Role-regime target이 모두 정의되고 충족됨
- Candidate/evidence identity와 exclusion count conflict가 없음
- Dependency diagnostic input이 완전하고 canonical함
- 모든 accepted source variant의 trading-date set이 official calendar 기반 canonical set과 일치함
- Blocker가 없음

### `inconclusive`

Source와 provenance는 유효하지만 capacity 또는 사전 결정이 부족한 상태다.

- Role-local 또는 role-exclusive target 미달
- Role-regime target 미정 또는 target 미달
- Official calendar source가 아직 연결되지 않음
- Dependency diagnostic policy에 필요한 row가 부족함

`inconclusive` artifact는 capacity gap 진단에는 사용할 수 있지만 expanded replay input으로 승격하지 않는다.

### `invalid`

입력 또는 artifact integrity를 신뢰할 수 없는 상태다.

- 금지된 result metric 입력
- Missing, empty, corrupt 또는 schema-invalid source
- Provenance, candidate/evidence identity, summary 또는 exclusion count conflict
- Calendar artifact hash/freshness/session mismatch
- Accepted source variant의 trading-date set이 canonical set과 다름
- Role boundary 또는 embargo 위반 candidate를 accepted로 집계
- Canonical order 또는 preflight hash mismatch

`invalid` artifact에서는 부분 capacity를 성공처럼 사용하지 않는다.

## Canonical Hash

`preflightHash`는 `preflightHash` field를 제외한 strict payload 전체의 canonical hash다.

다음 order를 고정한다.

- Role: `train`, `validation`, `test`
- Regime: `bull`, `bear`, `sideways`, `mixed`
- Candidate interval: role 목록, regime, start, end, evidence group hash, source variant 목록
- Pairwise diagnostic: left hash, right hash
- Exclusion: reason, role, regime, evidence group hash, source variant 목록
- Blocker: code, role, regime, message

Object key insertion order, raw JSON whitespace 또는 source file 입력 순서는 hash를 바꾸지 않아야 한다. Semantic source, target, candidate, dependency input, exclusion 또는 blocker 변경은 hash를 바꿔야 한다.

## Fail-Closed 중단 조건

다음 조건이면 ready artifact를 만들지 않는다.

- Baseline feasibility, plan 또는 readiness artifact 누락
- Expansion snapshot, universe, coverage 또는 validation split source 누락
- Corrupt source line 존재
- `short_term` scope coverage 미충족
- Calendar rule, fixture 또는 official artifact mismatch
- Classifier version/effective config mismatch
- Role-regime target을 결과 확인 후 수정
- Baseline과 expansion overlap을 신규 capacity로 중복 집계
- Role boundary 또는 embargo를 넘는 candidate
- Pairwise dependency input 누락 또는 count mismatch
- Existing output path collision

부족한 cell만 유리한 결과가 나올 때까지 source range를 반복 변경하지 않는다. Source 범위 또는 target matrix를 변경하려면 새 provenance와 별도 preflight artifact를 만든다.

## 구현 순서

이 계획 이후 구현은 작은 PR로 분리한다.

1. Strict schema, blocker/status invariant와 합성 fixture contract test
2. Baseline/expansion source verifier와 result-metric input boundary
3. Deterministic capacity scan, target matrix와 exclusion 집계
4. Overlap/adjacency dependency input과 canonical hash
5. Exclusive writer와 read-only CLI
6. 사전 고정 source로 실제 preflight artifact 및 결과 문서 생성

각 단계는 뒤 단계의 실행 또는 readiness 통과를 주장하지 않는다. Expanded paper-only replay는 preflight가 `ready_for_expansion_replay`인 별도 artifact를 제공할 때만 다음 PR에서 실행한다.

현재 1단계는 `validationRoleRegimeEvidenceExpansionPreflight.ts`의 strict
schema와 합성 fixture contract test로 구현했다. 2단계의 첫 범위로
`validationRoleRegimeEvidenceExpansionBaselineVerifier.ts`가 baseline
feasibility, plan, readiness artifact의 strict schema와 hash, provenance,
config 및 count 연결을 fail-closed로 검증한다. `invalid` baseline status는
검증 결과로 반환하지 않으며 readiness blocker는 canonical key 순서로
정규화한 뒤 hash한다. Feasibility target regime은 plan의 canonical regime
순서로 정규화한 뒤 config를 비교한다. Readiness의 role-local, role-exclusive 및 role-regime
evidence는 plan run에서 재구성한 deterministic 집계와 일치해야 한다.
Feasibility candidate hash는 config와 provenance에서 재계산하며 plan run은
동일 role, window, regime, hash 및 source assignment를 가진 scope-available
feasibility candidate에 연결되어야 한다. Available feasibility의 모든
scope-available target candidate는 exhaustive plan run에 포함되어야 하며,
insufficient feasibility의 non-ready plan은 zero-run summary를 source에서
재계산한 값과 일치시킨다. Baseline validation split assignment source는
`validationSplitHash`와 feasibility role window를 재검증하며 plan에 기록된
전체 `ValidationSplitAssignment` payload와 일치해야 한다. Expansion source verifier와
capacity builder, preflight canonical hash 검증, writer, CLI와 실제 preflight
artifact는 아직 구현하지 않았다.

`validationRoleRegimeEvidenceExpansionInputBoundary.ts`는 preflight builder
입력을 baseline, expansion, calendar, classifier, target matrix와 dependency
policy의 strict allowlist로 제한한다. 어느 깊이에서든 result artifact,
성과 metric, selection 결과 또는 AI action key가 발견되면 경로를 canonical
정렬하고 `RESULT_METRIC_INPUT_FORBIDDEN` blocker가 있는 `invalid` 결과로
fail-closed 처리한다. 금지 용어가 scalar value에만 있는 경우에는 key 기반
분류에 포함하지 않는다. `ReplayPerformanceMetrics`의
`totalReturnRatio`, `costAdjustedTotalReturnRatio`, `maxDrawdownRatio`,
`profitFactor`, `sharpeRatio` 같은 compound result key와 selection trial의
`finalVirtualNetWorthKrw`를 명시적으로 차단한다. 허용 source evidence의
`averageReturnRatio`처럼 용도가 다른 field를 오탐하지 않도록 임의의
`*ReturnRatio` suffix 전체를 차단하지는 않는다. Batch aggregate의
`averageTotalReturnRatio`, `medianTotalReturnRatio`, `winRate`,
selection/holdout return metric, rank, degradation 및 PBO result key도
동일하게 차단한다. CPCV selection record의 selected train/test metric,
test rank percentile 및 tie-break result도 입력으로 허용하지 않는다.
Virtual position/trade의 realized/unrealized PnL key도 차단한다. Optional
official calendar artifact 외의 모든 allowlisted source는 field 누락이나
명시적 `undefined`를 허용하지 않는다. Sharpe validation의 sample,
Lo-adjusted, probabilistic 및 deflated metric과 read-only summary의
namespaced status/value/probability key도 결과 입력으로 차단한다.

## 이번 문서 PR의 완료 기준

- 실제 코드와 기존 artifact가 제공하는 baseline 기능을 구분한다.
- 결과 metric 금지 boundary와 허용 source allowlist를 명시한다.
- Target matrix, capacity view, dependency input, exclusion과 blocker contract를 고정한다.
- `ready_for_expansion_replay`, `inconclusive`, `invalid` 상태 전이를 fail-closed로 정의한다.
- 구현, writer, CLI, source scan 또는 replay 실행은 포함하지 않는다.
