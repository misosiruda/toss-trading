# Validation Split Role-Local Regime Feasibility 계획

이 문서는 walk-forward train/validation/test 경계를 유지하면서 각 split role 내부에 regime-balanced replay window가 실제로 존재하는지 확인하기 위한 read-only feasibility contract를 사전 고정한다.

이 검증은 특정 종목 판단, 투자 조언, 성과 보장 또는 live trading signal이 아니다. 결과가 `available`이어도 strategy 유효성이나 실거래 parameter를 뜻하지 않는다.

## 배경

[Strategy Bucket Validation Research 결과](strategy-bucket-validation-research-results.md)는 fixed validation assignment 9개가 bull 7, mixed 2에 편중되고 bear와 sideways가 없음을 기록했다. [Short-Term Scoped Liquidity Stress Validation 결과](short-term-scoped-liquidity-stress-results.md)에서는 partial fill이 세 role에 나타났지만 fail-closed no-fill 47건과 50건이 train에만 발생해 execution fixture를 `inconclusive`로 판정했다.

현재 `historicalBatchReplay` CLI는 `--validation-splits-path`를 읽으면 출력상의 effective sampling mode를 `fixed_range`로 기록한다. Workflow의 `selectBatchReplayWindow()`도 validation assignment가 있으면 role 전체 범위를 즉시 선택하고 `balanced_regime` branch를 실행하지 않는다. 따라서 현재 artifact만으로는 다음을 구분할 수 없다.

- Validation/test role 내부에 bear 또는 sideways candidate window가 원래 없는가?
- Candidate window는 있지만 fixed role 전체 분류에 가려졌는가?
- `short_term` scoped candidate coverage나 calendar gate 때문에 후보가 제거되는가?
- Role-local 후보가 있더라도 overlap이 커서 independent sample로 볼 수 없는가?

Replay selection semantics를 바꾸기 전에 이 질문을 별도 artifact로 답해야 한다.

## 이번 문서 PR 범위

포함:

- Validation split role-local regime feasibility의 입력, artifact와 판정 contract
- Split boundary, embargo, calendar, candidate scope와 hash provenance gate
- Overlap과 statistical sample 해석 제한
- 후속 구현 PR의 작은 분할 순서

포함하지 않음:

- CLI, workflow, sampler 또는 schema 구현
- Historical replay 실행 또는 기존 artifact 재해석
- Validation assignment, regime threshold 또는 liquidity ratio 변경
- Historical universe symbol 추가
- Sharpe 최소 sample 충족 주장
- CPCV/PBO candidate matrix 생성
- Strategy 판정 변경 또는 candidate 선택
- Codex AI provider 사용
- Live order, broker mutation 또는 운영 배포

## 현재 상태

| 항목 | 확인된 상태 |
| --- | --- |
| Source coverage | `2022-12-31T15:00:00Z` to `2026-05-31T14:59:59.999Z` |
| Validation assignment | 9개, train/validation/test 각 3 |
| Existing role selection | Assignment의 role 전체 범위, `fixed_range` |
| Existing requested sampling | `balanced_regime`를 전달해도 validation assignment가 우선 |
| Aggregate regime | bull 7, mixed 2, bear 0, sideways 0 |
| Available `short_term` symbols | 3 |
| Role return sample | 각 3, Sharpe minimum 30 미만 |
| Scoped liquidity no-fill | train에만 발생 |

현재 3개 role sample을 단순 복제하거나 overlapping window를 추가해 30으로 만드는 것은 independent evidence 확장이 아니다. Feasibility artifact는 candidate window 수와 statistical sample 수를 같은 값으로 취급하지 않는다.

최초 feasibility 실행 입력은 결과 확인 전에 다음 값으로 고정한다.

| 항목 | 고정값 |
| --- | --- |
| Window | 1개월 |
| Timezone offset | 540분 |
| Target regimes | `bull,bear,sideways,mixed` |
| Candidate scope | `short_term` |
| Minimum candidates per aggregated role-regime | 1 |
| Validation assignments | 현재 `validation_split_assignment.v1` 9개 |
| Calendar rules | `KR:KRX:Asia/Seoul`, `US:NYSE:America/New_York` |
| Calendar fixture | 실행 전에 schema-valid artifact path와 hash를 고정하고 결과 확인 후 변경 금지 |

Minimum 1은 role-regime 조합의 존재 여부를 확인하는 feasibility 기준일 뿐 statistical sufficiency 기준이 아니다. 이 minimum은 assignment 하나가 아니라 같은 `splitRole`의 모든 assignment에서 deduplicate한 candidate 집합에 적용한다.

현재 assignment role boundary와 기존 `replayWindowCandidates()`를 사용한 read-only structural preflight 결과는 다음과 같다. Calendar, candidate scope와 regime classification을 적용하기 전 capacity다.

| Role | Assignment별 full-window capacity | Role aggregate unique capacity |
| --- | --- | ---: |
| `train` | 23, 23, 23 | 29 |
| `validation` | 6, 6, 6 | 12 |
| `test` | 3, 3, 3 | 9 |

각 test assignment는 네 target regime을 모두 포함할 수 없지만 test role aggregate의 unique capacity는 9이므로 role-level 네 regime gate가 구조적으로 불가능하지는 않다. 이 표는 candidate capacity만 확인하며 실제 regime coverage나 statistical independence를 증명하지 않는다.

## 검증 질문

1. 각 assignment의 split role 허용 범위 안에 full replay window가 몇 개 존재하는가?
2. 각 candidate window의 regime label은 bull, bear, sideways, mixed 중 무엇인가?
3. 요청한 regime이 같은 role의 assignment를 합친 train, validation, test aggregate 각각에 존재하는가?
4. Train candidate는 embargo를 침범하지 않는가?
5. Candidate window가 validation/test 또는 다른 split role 경계를 넘지 않는가?
6. Calendar validation과 `candidateStrategyBucket=short_term` availability를 적용한 뒤에도 후보가 남는가?
7. 같은 role의 candidate끼리 또는 split 간 candidate끼리 얼마나 겹치는가?
8. 현재 source로 role-local replay plan을 만들 수 없는 경우 threshold나 scope를 바꾸지 않고 `insufficient`로 닫는가?

## 제안 Artifact Contract

후속 구현은 `validation_split_regime_feasibility.v1` JSON artifact를 생성한다. 이 artifact는 replay run이나 selection trial이 아니며 order, sizing 또는 signal을 포함하지 않는다.

```typescript
interface ValidationSplitRegimeFeasibilityArtifact {
  schemaVersion: "validation_split_regime_feasibility.v1";
  mode: "paper_only";
  status: "available" | "insufficient" | "invalid";
  generatedAt: string;
  config: {
    windowMonths: number;
    timezoneOffsetMinutes: number;
    targetRegimes: Array<"bull" | "bear" | "sideways" | "mixed">;
    candidateStrategyBucket: "short_term";
    minimumCandidatesPerRoleRegime: number;
    calendarValidation: {
      rules: Array<{
        market: "KR" | "US";
        exchange: string;
        timezone: "Asia/Seoul" | "America/New_York";
      }>;
    };
  };
  provenance: {
    dataSnapshotHash: string;
    universeHash: string;
    coverageHash: string;
    validationSplitHash: string;
    calendarHash: string;
  };
  summary: {
    assignmentCount: number;
    roleCounts: Record<"train" | "validation" | "test", number>;
    candidateCount: number;
    uniqueCandidateCount: number;
    roleCapacityCounts: Record<"train" | "validation" | "test", number>;
    boundaryViolationCount: number;
    embargoViolationCount: number;
    unavailableRoleRegimeCount: number;
  };
  roles: RoleRegimeFeasibility[];
  assignments: AssignmentRegimeFeasibility[];
  warnings: FeasibilityWarning[];
}
```

`RoleRegimeFeasibility`는 같은 `splitRole`의 assignment candidate를 `candidateHash`로 deduplicate한 aggregate이며 최소한 다음 필드를 가진다.

- `splitRole`
- `assignmentCount`
- `structuralCapacityCount`
- `uniqueCandidateCount`
- `regimeCounts`
- `availableTargetRegimes`, `unavailableTargetRegimes`
- `minimumCandidatesPerRoleRegime`
- `capacityStatus`: `sufficient` 또는 `insufficient`
- `maximumPairwiseOverlapRatio`
- `warnings`

`AssignmentRegimeFeasibility`는 진단용 row이며 최소한 다음 필드를 가진다.

- `splitId`, `splitIndex`, `splitRole`
- `roleStart`, `roleEnd`, train의 `effectiveRoleEnd`
- `structuralCapacityCount`
- `candidateCount`
- `regimeCounts`
- `availableTargetRegimes`, `unavailableTargetRegimes`
- `candidates`: `startAt`, `endAt`, `regime`, `scopeAvailable`, `candidateHash`
- `maximumPairwiseOverlapRatio`
- `calendarRejectedCandidateCount`
- `scopeUnavailableCandidateCount`
- `warnings`

Raw snapshot, 종목별 성과 또는 candidate ranking은 artifact에 복제하지 않는다. Candidate window를 식별하는 데 필요한 start/end와 hash만 기록한다.

Assignment 하나가 모든 target regime을 포함할 필요는 없다. 예를 들어 3개월 test assignment에는 1개월 full window가 구조적으로 최대 3개뿐이므로 네 regime Cartesian product를 assignment-level gate로 적용하지 않는다. 세 test assignment에서 생성한 candidate를 합치고 동일 `candidateHash`를 제거한 test role aggregate에 target regime gate를 적용한다.

`config.calendarValidation.rules`는 `market`, `exchange`, `timezone` 순으로 정렬한 normalized rule을 기록한다. `provenance.calendarHash`는 schema validation을 통과한 rule과 fixture를 다음 방식으로 정규화한 뒤 기존 `createReplayResearchHash()`로 계산한다.

- Rule은 `market`, `exchange`, `timezone` 순으로 정렬한다.
- Fixture는 `market`, `exchange`, `sessionDate`, `calendarId` 순으로 정렬한다.
- Fixture의 `sourceRefs`는 사전순으로 정렬하고, optional `holidayName` 부재는 `null`로 정규화한다.
- Fixture의 `calendarId`, `exchange`, `market`, `timezone`, `sessionDate`, `marketOpen`, `marketClose`, `isHoliday`, `holidayName`, `sourceRefs`, `createdAt`을 모두 hash input에 포함한다.

CLI의 rule 또는 fixture 입력 순서만 바뀌면 같은 `calendarHash`가 생성돼야 한다. Rule, timezone, session, holiday 또는 fixture provenance가 달라지면 hash도 달라져야 한다. `candidateHash`는 `startAt`, `endAt`, timezone, window length, `calendarHash`, candidate scope와 source provenance로 계산하고 `splitId`, `splitIndex`, `splitRole`은 제외한다. 따라서 overlapping assignment가 같은 window를 열거해도 role aggregate capacity를 중복 증가시키지 않는다.

## Role Boundary Contract

Role-local candidate enumeration은 기존 `validationRoleWindow()` 의미와 일치해야 한다.

| Role | Candidate 허용 범위 |
| --- | --- |
| `train` | `trainStart`부터 embargo를 제외한 effective train end까지 |
| `validation` | `validationStart`부터 `validationEnd`까지 |
| `test` | `testStart`부터 `testEnd`까지 |

모든 candidate window는 시작과 끝이 해당 role 범위 안에 완전히 포함돼야 한다. Full window가 맞지 않으면 짧게 자르지 않는다. Train은 `trainEnd`와 `validationStart - embargoDurationDays` 중 더 이른 경계를 사용하고, 계산 결과가 train start보다 앞서면 `invalid`로 닫는다.

Purge/embargo를 완화하거나 validation/test 데이터를 train candidate 분류에 포함하지 않는다. Regime classification에 필요한 snapshot도 candidate window 밖에서 가져오지 않는다.

## Candidate Enumeration Contract

후속 구현은 기존 replay calendar candidate filter와 market regime classifier를 재사용한다.

1. Validation assignment와 role boundary를 schema로 검증한다.
2. Role 범위 안에 완전히 들어오는 월 단위 full window를 열거한다.
3. Calendar validation을 적용해 session-invalid candidate를 제외한다.
4. Candidate window에서 `short_term` scoped new-buy snapshot availability를 확인한다.
5. 남은 candidate를 기존 deterministic market regime classifier로 분류한다.
6. Candidate start/end, regime, scope availability와 hash를 기록한다.
7. 같은 role 및 split 간 pairwise overlap ratio를 계산한다.
8. Assignment별 structural capacity와 candidate 분포를 기록한다.
9. 같은 `splitRole`의 candidate를 hash로 deduplicate해 role-level capacity와 target regime count를 집계한다.
10. Target regime별 candidate count와 warning을 집계한다.

Feasibility 단계에서는 후보를 선택하거나 replay하지 않는다. Seeded selection, target rotation과 run count는 후속 replay-plan PR에서 별도로 고정한다.

Date ordering과 role boundary가 유효하지만 1개월 full window가 하나도 맞지 않으면 enumeration failure로 throw하지 않는다. Assignment의 `structuralCapacityCount=0`과 `ROLE_FULL_WINDOW_CAPACITY_ZERO` warning을 기록하고 role aggregate gate에서 `insufficient`로 판정한다.

## 제안 CLI Contract

후속 read-only CLI는 다음 형태를 기준으로 한다. Command와 script 이름은 구현 PR에서 package script 존재 여부와 함께 검증하되 input 의미를 바꾸지 않는다.

```powershell
npm run historical:validation:regime-feasibility -- --source-data-dir data/replay-2023-01-2026-05-global-broad-yahoo-daily --universe-path docs/historical-universe.global-broad.json --coverage-path data/replay-2023-01-2026-05-global-broad-yahoo-daily/historical-universe-coverage.json --validation-splits-path data/validation-splits/strategy-bucket-validation-assignments.json --calendar-fixtures-path $CalendarFixturesPath --calendar-rule KR:KRX:Asia/Seoul --calendar-rule US:NYSE:America/New_York --candidate-strategy-bucket short_term --window-months 1 --timezone-offset-minutes 540 --target-regimes "bull,bear,sideways,mixed" --min-candidates-per-role-regime 1 --output-path data/validation-feasibility/short-term-role-regime-feasibility.json
```

CLI는 calendar fixture와 market rule을 필수 입력으로 받고 artifact에 normalized rule과 `calendarHash`를 남긴다. Provider, risk profile, execution policy 또는 order option을 받지 않는다. Existing output path가 있으면 덮어쓰지 않고 fail-closed로 종료한다.

## Scope Availability Contract

Regime classification은 broad market snapshot으로 수행할 수 있지만 replay feasibility는 `candidateStrategyBucket=short_term` availability를 별도로 통과해야 한다.

- Window 안에 `short_term` new-buy candidate snapshot이 없으면 해당 candidate를 scoped replay available로 세지 않는다.
- Existing held-position-only work는 new-buy candidate availability를 대체하지 않는다.
- Missing, `UNKNOWN` 또는 다른 bucket으로 fallback하지 않는다.
- Universe 변경이 필요하면 symbol과 기간을 결과 확인 전에 별도 universe plan에서 고정한다.
- 현재 available symbol 3개를 충분한 표본이라고 해석하지 않는다.

## Overlap And Independence Contract

Candidate window 수는 Sharpe `returnSampleCount`나 independent holdout 수가 아니다.

- 같은 snapshot date를 공유하는 candidate는 overlap으로 기록한다.
- Pairwise overlap ratio는 두 window의 union trading-date 수 대비 intersection trading-date 수로 계산한다.
- 같은 split의 train/validation/test 경계는 겹치면 안 된다.
- 다른 walk-forward split 간 overlap은 허용될 수 있지만 명시적으로 집계한다.
- Overlapping candidate를 반복 실행해 Sharpe minimum 30을 충족했다고 주장하지 않는다.
- 이 feasibility artifact에는 overlap 허용 threshold를 두지 않으며 `maximumPairwiseOverlapRatio`는 informational evidence로만 기록한다.
- Overlap ratio는 `available`, `insufficient`, `invalid` status 계산에 사용하지 않는다.
- Independent sample 기준은 feasibility 결과를 확인한 뒤 별도 statistical validation plan에서 고정한다.

## 판정 Gate

### `available`

- 모든 input과 provenance hash가 존재한다.
- Artifact의 normalized calendar rule과 다시 계산한 `calendarHash`가 입력 fixture 및 rule과 일치한다.
- Assignment count와 role count가 input summary와 일치한다.
- Boundary 및 embargo violation이 0이다.
- Train/validation/test role aggregate와 target regime의 Cartesian product가 사전 고정한 minimum candidate count를 모두 충족한다.
- 각 role의 deduplicated structural capacity가 `targetRegimes.length * minimumCandidatesPerRoleRegime` 이상이다.
- Calendar 및 scoped availability를 통과한 candidate가 존재한다.
- Unknown fallback이나 corrupt source가 없다.

### `insufficient`

- Contract와 provenance는 유효하지만 하나 이상의 role-regime candidate가 부족하다.
- 한 assignment의 짧은 role window는 허용되지만, 같은 role의 전체 assignment를 합친 deduplicated structural capacity가 target gate보다 작다.
- 유효한 role range가 1개월 full window를 담지 못해 structural capacity가 0이다.
- Calendar 또는 scoped availability 적용 후 필수 candidate가 사라진다.
- Bear/sideways 또는 validation/test role evidence가 현재 source에 없다.

### `invalid`

- Candidate window가 role boundary나 embargo를 침범한다.
- Assignment, source 또는 hash contract가 깨진다.
- Calendar fixture/rule이 누락되거나 malformed/duplicate이고, normalized calendar config 또는 `calendarHash`가 누락되거나 다시 계산한 값과 다르다.
- Missing bucket을 broad/`UNKNOWN` candidate로 대체한다.
- Corrupt line 또는 schema failure를 무시하고 candidate를 생성한다.
- 결과 확인 후 regime threshold, role range, scope 또는 minimum count를 바꾼다.

`available`은 role-local candidate가 존재한다는 뜻뿐이다. 높은 overlap이 있어도 위 availability gate를 충족하면 status는 `available`이며, 이 값은 independent evidence 확보를 뜻하지 않는다. Replay fixture, strategy 유효성, Sharpe/PBO readiness는 별도 판정이다.

Role aggregate가 `available`이어도 개별 split이 모든 regime을 지원한다는 뜻은 아니다. 후속 replay selection 계획은 candidate의 원래 `splitId`와 `splitRole`을 보존하고 서로 다른 split의 performance를 하나의 independent sample처럼 합치지 않는다.

## Fail-Closed 중단 조건

다음 조건이면 artifact를 성공처럼 기록하지 않는다.

- Source, universe, coverage 또는 validation split 파일 누락
- Calendar fixture 또는 market rule 누락
- Coverage status가 `available`이 아님
- Corrupt line이 0이 아님
- `short_term` required coverage 미충족
- Validation assignment role 또는 date ordering 오류
- Test role에 test start/end 누락
- Train embargo 적용 후 유효 범위 없음
- Enumerator가 truncated window 또는 role boundary를 넘는 candidate를 생성함
- Requested target regime 목록이 비어 있음
- 기존 output artifact와 path collision

Unavailable target regime은 다른 regime으로 자동 대체하지 않는다. Artifact를 `insufficient`로 남기고 후속 replay plan을 만들지 않는다.

유효한 role range가 full window보다 짧은 경우는 중단 조건이 아니다. Zero-capacity assignment와 warning을 포함한 artifact를 끝까지 생성해 `insufficient` 근거로 보존한다.

## 구현 PR 분할

1. `validation_split_regime_feasibility.v1` schema와 pure role-boundary/candidate enumeration test
2. Calendar 및 candidate scope availability 연결
3. Overlap summary와 deterministic hash/provenance 연결
4. Read-only CLI와 generated artifact writer
5. 실제 source preflight 및 feasibility 결과 문서
6. 결과가 `available`일 때만 별도 role-local replay selection 계획

각 PR은 앞 단계 contract와 test만 포함한다. CLI 추가 전에는 workflow replay semantics를 변경하지 않는다.

## 테스트 요구사항

후속 구현 PR은 최소한 다음을 검증한다.

### 정상 흐름

- Train/validation/test role별 full candidate window 열거
- 같은 role assignment candidate의 deterministic deduplication과 aggregate gate
- Timezone offset과 local month boundary 보존
- Train embargo effective end 적용
- Existing regime classifier와 동일한 label
- `short_term` candidate availability가 있는 window만 scoped available로 집계
- 같은 input과 고정 `generatedAt`에서 candidate hash와 artifact가 deterministic
- Calendar rule/fixture 순서만 다른 동일 입력에서 normalized rule과 `calendarHash`가 동일
- Calendar rule, timezone, session, holiday 또는 fixture provenance 변경 시 `calendarHash`와 candidate hash가 변경
- 높은 overlap에서도 role-regime availability gate만으로 status를 계산하고 `maximumPairwiseOverlapRatio`를 그대로 기록

### Fail-closed 흐름

- Role 경계를 넘는 candidate 거절
- Embargo 침범 candidate 거절
- Test dates 누락 및 잘못된 date ordering 거절
- Missing/invalid strategy bucket 거절
- Corrupt source와 unavailable coverage 거절
- Missing/malformed/duplicate calendar fixture 또는 rule 거절
- Artifact의 normalized calendar config 또는 `calendarHash` 누락과 hash mismatch 거절
- Requested regime 부재 시 broad fallback 없이 `insufficient`
- Full window보다 짧지만 date ordering이 유효한 role은 capacity 0과 `insufficient` 기록
- Truncated window 또는 role boundary를 넘는 candidate 생성 시 `invalid`

### 호환성

- 기존 `--validation-splits-path` replay는 계속 `fixed_range`로 동작
- 기존 standalone `balanced_regime` sampling 동작 유지
- Existing batch manifest, run record와 selection trial schema 변경 없음
- `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=false` 경계 유지

## 결과 문서 필수 항목

- 실제 commit과 실행 명령
- Source, universe, coverage, validation split, calendar fixture path와 hash
- Config, normalized calendar rule과 target regime
- Assignment/role별 candidate 및 regime count
- Calendar/scope rejection count
- Boundary/embargo violation count
- Overlap summary와 independence 제한
- `available`, `insufficient` 또는 `invalid` 판정
- Generated artifact 비포함 여부
- 미검증 항목과 다음 단계

## Safety Boundary

- Paper-only historical data feasibility만 다룬다.
- Live order, broker mutation, natural language order 또는 `place_order` surface를 추가하지 않는다.
- Raw `codex exec` 또는 raw `tossctl` surface를 추가하지 않는다.
- AI는 regime, window, sizing 또는 final gate를 결정하지 않는다.
- Deterministic backend와 Risk Engine의 기존 책임을 변경하지 않는다.
- 특정 종목, strategy winner, 실거래 parameter 또는 예상 성과를 제안하지 않는다.

## 이번 PR 완료 기준

- 현재 fixed split과 balanced regime sampling의 비호환 상태를 코드 기준으로 기록한다.
- Role boundary, scope availability, overlap과 판정 contract를 고정한다.
- 후속 구현을 작은 PR 순서로 분리한다.
- Replay 실행, generated artifact, code/schema 변경 또는 strategy 판정 변경을 포함하지 않는다.
