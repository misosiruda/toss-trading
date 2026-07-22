# Validation Role-Local Regime Replay Selection 계획

이 문서는 `validation_split_regime_feasibility.v1` 결과를 실제 paper-only replay window schedule로 변환하기 전에 selection contract, provenance, cross-role 중복 처리와 fail-closed gate를 고정한다.

이 계획은 replay를 실행하거나 strategy를 선택하지 않는다. 특정 종목 판단, 투자 조언, 성과 보장, live order, broker mutation, natural language order, raw `codex exec`, raw `tossctl` 또는 `place_order` surface는 범위에 포함하지 않는다.

## 배경

[Validation Split Role-Local Regime Feasibility 결과](validation-split-regime-feasibility-results.md)는 고정 minimum 1 기준으로 train, validation, test aggregate가 `bull`, `bear`, `sideways`, `mixed` candidate를 모두 가진다고 판정했다.

현재 `historicalBatchReplay` workflow는 `validationSplitAssignments[runIndex]`를 받으면 `selectBatchReplayWindow()`에서 assignment role 전체 범위를 즉시 `fixed_range`로 선택한다. 따라서 `--window-sampling balanced_regime`과 `--target-regimes`를 함께 전달해도 validation assignment가 있으면 regime sampler를 실행하지 않는다.

기존 standalone `balanced_regime` sampler는 전체 range에서 seed와 `runIndex`로 candidate 하나를 선택하며 validation split role과 embargo provenance를 소유하지 않는다. 이 sampler를 validation path에 그대로 연결하면 다음 문제가 생긴다.

- Candidate가 어느 split과 role에서 허용됐는지 보존되지 않는다.
- Rolling split에서 같은 calendar window가 여러 assignment 또는 role에 속할 수 있다.
- Seed 기반 일부 추출은 현재 적은 bear/sideways evidence를 임의로 버릴 수 있다.
- 같은 `candidateHash`를 여러 role의 independent return sample로 중복 계산할 수 있다.
- 기존 run count 9와 필요한 role-local candidate schedule 수가 일치하지 않는다.

## 이번 문서 PR 범위

- `validation_role_regime_replay_plan.v1` artifact contract
- Feasibility artifact와 validation split source 입력 gate 및 canonical hash
- Role 내 candidate deduplication과 assignment ownership
- Cross-role shared evidence group 처리
- Deterministic exhaustive schedule과 ordering
- Batch workflow, manifest, run record 연결 방향
- 구현 PR 분할과 test requirement

다음은 포함하지 않는다.

- Schema, parser, writer 또는 CLI 구현
- Batch workflow, sampler, manifest 또는 selection trial 변경
- Replay 실행 또는 generated plan artifact
- Provider, prompt, risk, sizing, execution 또는 order 설정 변경
- Strategy 판정 변경

## 현재 Evidence 구조

Feasibility artifact의 `scopeAvailable=true` target candidate를 role 안에서 `candidateHash`로 deduplicate하면 다음과 같다.

| Role | Bull | Bear | Sideways | Mixed | Role-local unique |
| --- | ---: | ---: | ---: | ---: | ---: |
| Train | 9 | 1 | 5 | 14 | 29 |
| Validation | 6 | 1 | 2 | 3 | 12 |
| Test | 5 | 1 | 2 | 1 | 9 |

Role-local row는 총 50개지만 global `candidateHash`는 39개다. 11개 hash가 rolling split 경계 때문에 둘 이상의 role에 나타난다.

특히 train bear와 validation bear는 같은 `candidateHash` 하나만 가진다. 따라서 12개 role-regime cell을 모두 채우면서 모든 cell에 서로 다른 calendar window를 배정하는 것은 현재 source에서 불가능하다. Selection plan은 이 중복을 숨기지 않고 같은 evidence group으로 기록해야 한다.

Role별 29, 12, 9 candidate는 모두 현재 Sharpe minimum 30보다 작다. 50개 replay row를 실행하더라도 role별 또는 global independent sample 50개를 확보했다고 해석하지 않는다.

## Selection 결정

첫 selection policy는 `exhaustive_role_regime_candidates.v1`로 고정한다.

- Feasibility artifact의 target regime과 `scopeAvailable=true` candidate를 전부 사용한다.
- Seed로 candidate 일부를 추출하지 않는다.
- 같은 role 안에서는 `candidateHash`를 한 번만 schedule한다.
- 같은 hash가 여러 assignment에 있으면 source assignment reference를 모두 보존한다.
- 같은 hash가 여러 role에 있으면 role별 replay row는 유지하되 하나의 global evidence group으로 묶는다.
- `insufficient_data`와 target regime 밖 candidate는 schedule하지 않고 제외 count만 기록한다.
- Requested regime이 없으면 다른 regime으로 대체하지 않는다.
- Plan은 window schedule만 소유하며 provider, prompt, risk, sizing 또는 execution policy를 소유하지 않는다.

이 정책의 현재 예상값은 planned replay row 50, global unique evidence group 39, cross-role shared evidence group 11이다.

## 제안 Artifact Contract

후속 구현은 다음 형태의 `validation_role_regime_replay_plan.v1` JSON artifact를 생성한다.

```ts
interface ValidationRoleRegimeReplayPlan {
  schemaVersion: "validation_role_regime_replay_plan.v1";
  mode: "paper_only";
  purpose: "role_local_regime_diagnostic";
  status: "ready_for_paper_diagnostic" | "insufficient" | "invalid";
  generatedAt: string;
  source: {
    feasibilitySchemaVersion: "validation_split_regime_feasibility.v1";
    feasibilityArtifactHash: string;
    feasibilityStatus: "available" | "insufficient" | "invalid";
    dataSnapshotHash: string;
    universeHash: string;
    coverageHash: string;
    validationSplitHash: string;
    calendarHash: string;
    marketRegimeClassifierHash: string;
  };
  config: {
    selectionPolicyVersion: "exhaustive_role_regime_candidates.v1";
    candidateStrategyBucket: "short_term";
    targetRegimes: Array<"bull" | "bear" | "sideways" | "mixed">;
    windowMonths: number;
    timezoneOffsetMinutes: number;
    roleOrder: Array<"train" | "validation" | "test">;
    regimeOrder: Array<"bull" | "bear" | "sideways" | "mixed">;
  };
  summary: {
    requiredRoleRegimeCellCount: number;
    coveredRoleRegimeCellCount: number;
    plannedRunCount: number;
    globalUniqueEvidenceGroupCount: number;
    crossRoleSharedEvidenceGroupCount: number;
    nonTargetCandidateCount: number;
    roleRunCounts: Record<"train" | "validation" | "test", number>;
    roleRegimeRunCounts: Record<string, number>;
  };
  runs: ValidationRoleRegimeReplayPlanRun[];
  warnings: ValidationRoleRegimeReplayPlanWarning[];
  planHash: string;
}
```

`status=ready_for_paper_diagnostic`는 deterministic paper replay schedule을 만들 수 있다는 뜻만 가진다. Strategy 유효성, statistical sufficiency, role 간 일반화 또는 live 사용 가능성을 뜻하지 않는다.

Schema-valid source가 required role-regime cell을 채우지 못하면 `status=insufficient`, source provenance, candidate hash, boundary 또는 aggregate validation이 실패하면 `status=invalid`로 기록한다. Missing, empty, corrupt 또는 schema-invalid source에서는 신뢰할 수 있는 plan artifact를 만들지 않는다. `insufficient`와 `invalid` plan은 `runs=[]`이며 batch workflow 입력으로 사용할 수 없다.

## Plan Run Contract

각 `ValidationRoleRegimeReplayPlanRun`은 최소한 다음 필드를 가진다.

```ts
interface ValidationRoleRegimeReplayPlanAssignment {
  validationProtocol: "walk_forward";
  splitId: string;
  splitIndex: number;
  splitRole: "train" | "validation" | "test";
  trainStart: string;
  trainEnd: string;
  validationStart: string;
  validationEnd: string;
  testStart: string | null;
  testEnd: string | null;
  purgeDurationDays: number;
  embargoDurationDays: number;
}

interface ValidationRoleRegimeReplayPlanRun {
  planIndex: number;
  runKey: string;
  splitRole: "train" | "validation" | "test";
  targetRegime: "bull" | "bear" | "sideways" | "mixed";
  candidateOrdinalWithinRoleRegime: number;
  candidateHash: string;
  evidenceGroupHash: string;
  startAt: string;
  endAt: string;
  sourceAssignments: ValidationRoleRegimeReplayPlanAssignment[];
  executionAssignment: ValidationRoleRegimeReplayPlanAssignment;
  sharedAcrossRoles: boolean;
  sharedRoles: Array<"train" | "validation" | "test">;
}
```

`candidateHash`와 `evidenceGroupHash`는 첫 version에서 같은 값이다. 별도 field를 두는 이유는 replay row identity와 statistical evidence grouping을 구분하기 위해서다. 같은 candidate가 train과 validation에 각각 schedule돼도 global independent evidence count는 한 번만 증가한다.

기존 feasibility `candidateHash`는 regime label을 포함하지 않으므로 그 hash만으로 `targetRegime`을 신뢰하지 않는다. Builder의 source 기반 feasibility 전체 재생성 비교로 label을 검증하고, 검증된 `targetRegime`을 포함한 ordered run payload를 `planHash`에 넣어 plan provenance에 결합한다.

`runKey`는 `splitRole`, `targetRegime`, `candidateHash`로 계산하며 output directory에 안전한 canonical encoding을 사용한다. `planIndex`는 canonical ordering 이후 0부터 연속된 값이다.

## Source Gate

Plan builder는 feasibility artifact와 생성에 사용한 snapshot, universe, coverage, validation split, calendar fixture source를 각각 기존 schema로 검증하고 다음 조건을 모두 확인한다.

1. `mode=paper_only`다.
2. Schema version이 `validation_split_regime_feasibility.v1`이다.
3. Ready plan을 만들 때 status가 `available`이다.
4. Candidate scope가 `short_term`이다.
5. Target regime이 중복 없이 artifact config와 일치한다.
6. Snapshot, universe, coverage, validation split, calendar fixture source와 artifact의 classifier config에서 여섯 provenance hash를 다시 계산했을 때 feasibility provenance와 모두 일치한다.
7. Feasibility assignment마다 `splitId`, `splitIndex`, `splitRole`이 같은 validation split source assignment가 정확히 하나 존재한다.
8. Source assignment의 전체 boundary와 `embargoDurationDays`로 role window와 `effectiveRoleEnd`를 다시 계산했을 때 feasibility assignment와 일치한다.
9. Feasibility artifact의 config와 `generatedAt`을 그대로 사용해 기존 deterministic builder를 다시 실행한다.
10. 재생성 artifact와 입력 feasibility artifact의 semantic-normalized payload가 전체 일치한다. Candidate `regime`, `scopeAvailable`, assignment/role aggregate, warning과 status도 비교 대상이다.
11. Assignment와 role aggregate count를 candidate row에서 다시 계산할 수 있다.
12. Candidate payload와 `candidateHash`가 feasibility provenance에 맞는다.
13. 모든 candidate가 원본 source assignment에서 다시 계산한 role boundary와 embargo를 지킨다.
14. Train, validation, test와 모든 target regime cell이 하나 이상 존재한다.
15. Feasibility artifact hash와 source provenance hash를 plan에 그대로 기록한다.

Source status가 `insufficient` 또는 `invalid`이면 empty success plan을 만들지 않는다. 각각 non-ready plan status와 source warning을 기록할 수 있지만 `runs`는 비워야 하며 batch workflow 입력으로 사용할 수 없다.

`feasibilityArtifactHash`는 schema parsing을 통과한 feasibility artifact를 semantic-normalized payload로 만든 뒤 기존 `createReplayResearchHash()`로 계산한다. Object key 정렬만으로는 array 순서가 보존되므로 hash 전에 다음 array를 명시적으로 정렬한다.

- `config.targetRegimes`, role과 assignment의 available/unavailable regime: `bull`, `bear`, `sideways`, `mixed` 순서
- `config.calendarValidation.rules`: `market`, `exchange`, `timezone` 순서
- `roles`: `train`, `validation`, `test` 순서
- `assignments`: `splitIndex`, role 순서, `splitId` 순서
- Assignment `candidates`: `startAt`, `endAt`, `bull`, `bear`, `sideways`, `mixed`, `insufficient_data` regime 순서, `candidateHash` 순서
- Artifact, role, assignment `warnings`: `code`, `splitRole`(`null` 우선, 이후 role 순서), `splitId`(`null` 우선), `message` 순서

Source의 `generatedAt`은 normalized payload에 포함해 실제로 입력한 artifact instance를 식별한다. 따라서 raw JSON whitespace, object key insertion order 또는 위 source array들의 입력 순서만 바뀐 경우에는 같은 `feasibilityArtifactHash`가 생성되고, semantic field나 `generatedAt`이 바뀌면 hash도 바뀐다.

## Deduplication과 Ownership

### Role 내 deduplication

같은 role에서 같은 `candidateHash`가 여러 assignment에 나타나면 plan run은 하나만 만든다. Start/end, regime, scope와 hash payload가 다르면 source corruption으로 `invalid` 처리한다.

### Source assignment references

Deduplicate된 candidate가 속한 모든 assignment를 `splitIndex`, `splitId`, `splitRole` canonical order로 `sourceAssignments`에 남긴다. 각 row에는 원본 validation split source에서 검증한 train/validation/test boundary, purge와 embargo duration을 함께 보존한다. Assignment를 ID reference만 남기거나 하나의 split에서만 유래한 것처럼 기록하지 않는다.

### Execution assignment

현재 batch run record는 validation assignment 하나만 받을 수 있으므로 첫 implementation은 `sourceAssignments`의 canonical 첫 row 전체를 `executionAssignment`로 사용한다. 선택 기준은 결과 metric, seed 또는 regime 성과를 사용하지 않는다.

Workflow와 run record는 plan provenance를 별도로 보존해야 한다. `executionAssignment` 하나만 보고 candidate가 그 assignment에만 속한다고 해석하지 않는다.

### Cross-role shared evidence

같은 `candidateHash`가 여러 role에 있으면 각 role schedule row의 `sharedAcrossRoles=true`, `sharedRoles`와 공통 `evidenceGroupHash`를 기록한다. 다음 aggregate는 분리한다.

- `plannedRunCount`: 실제 paper replay row 수
- Role-local sample count: role 안에서 deduplicate한 candidate 수
- `globalUniqueEvidenceGroupCount`: 모든 role에서 hash를 deduplicate한 수

Selection trial, report, Sharpe/PBO input은 `plannedRunCount`를 independent sample count로 사용하면 안 된다.

## Deterministic Ordering과 Hash

Plan run은 다음 순서로 정렬한다.

1. Role: `train`, `validation`, `test`
2. Regime: `bull`, `bear`, `sideways`, `mixed`
3. `startAt`
4. `endAt`
5. `candidateHash`

Input assignment, candidate 또는 target regime array 순서가 달라도 같은 ordered run list와 `planHash`가 생성돼야 한다.

`planHash`는 `generatedAt`과 `planHash` 자체를 제외하고 다음 canonical payload를 기존 `createReplayResearchHash()`로 계산한다.

- Schema version, mode, purpose와 status
- Source feasibility hash와 여섯 provenance hash
- Effective config와 ordering policy
- Summary
- Ordered run 전체 payload
- Ordered warning

## Warning Contract

최소 warning code:

| Code | 조건 | 영향 |
| --- | --- | --- |
| `CROSS_ROLE_EVIDENCE_SHARED` | 같은 `candidateHash`가 여러 role에 존재 | Independent count deduplication 필수 |
| `ROLE_REGIME_SINGLE_CANDIDATE` | Role-regime cell candidate가 1개 | 해당 cell 일반화 금지 |
| `ROLE_SAMPLE_BELOW_STATISTICAL_MINIMUM` | Role-local count가 statistical minimum 미만 | Sharpe readiness 불충족 |
| `CALENDAR_EVIDENCE_OBSERVED_SESSION_ONLY` | 현재 result의 observed-session fixture 사용 | 공식 holiday/early-close 검증 미완료 |
| `NON_TARGET_CANDIDATE_EXCLUDED` | `insufficient_data` 또는 target 밖 candidate 존재 | 제외 count 기록 |

현재 source에서는 적어도 cross-role shared evidence, 단일 candidate bear cell, test mixed 단일 candidate, 세 role 모두 sample 30 미만과 observed-session calendar warning을 기록해야 한다.

## 제안 CLI Contract

후속 read-only CLI는 다음 형태를 기준으로 한다.

```powershell
npm run historical:validation:role-regime-plan -- -- --feasibility-path data/validation-feasibility/short-term-role-regime-feasibility.json --source-data-dir data/replay-2023-01-2026-05-global-broad-yahoo-daily --universe-path docs/historical-universe.global-broad.json --coverage-path data/replay-2023-01-2026-05-global-broad-yahoo-daily/historical-universe-coverage.json --validation-splits-path data/validation-splits/strategy-bucket-validation-assignments.json --calendar-fixtures-path data/validation-feasibility/observed-session-calendar-fixtures.json --selection-policy exhaustive_role_regime_candidates.v1 --calendar-evidence-class observed_session_only --output-path data/validation-feasibility/short-term-role-regime-replay-plan.json
```

CLI는 feasibility artifact와 그 artifact 생성에 사용한 snapshot, universe, coverage, validation split, calendar fixture source를 읽고 plan artifact만 생성한다. 다섯 source option은 모두 필수다. CLI는 artifact config와 `generatedAt`으로 feasibility를 메모리에서 재생성하고 semantic-normalized payload 전체가 입력 artifact와 같을 때만 selection plan을 만든다. Candidate `regime`은 snapshot source와 classifier config로 다시 계산되므로, 기존 `candidateHash`가 같더라도 label이 다르면 거부한다. Source artifact나 replay output을 새로 쓰지 않으며 provider, Risk Engine 또는 order path를 실행하지 않는다.

허용 option은 feasibility source, 재검증에 필요한 다섯 source path, fixed selection policy, calendar evidence classification과 output path로 제한한다. Calendar rule, classifier, target regime, window와 minimum은 feasibility artifact의 hashed config를 사용하며 CLI override를 받지 않는다. Seed, run count, provider, prompt, risk profile, sizing, execution 또는 order option도 받지 않는다. Existing output path는 덮어쓰지 않는다.

## Batch Workflow 연결 계획

Plan artifact 구현 이후 별도 PR에서 `historicalBatchReplay`에 명시적 `--validation-role-regime-plan-path`를 추가한다.

연결 규칙:

- `--validation-role-regime-plan-path`는 기존 `--validation-splits-path`, `--window-sampling`, `--target-regimes`, fixed window와 상호 배타적이다.
- Run count는 plan의 `runs.length`에서 결정하며 사용자가 override하지 않는다.
- `--runs`, `--random-window-from`, `--random-window-to`, `--window-months`, `--timezone-offset-minutes` override도 거부하고 range, window month, timezone은 plan에서 결정한다.
- Runtime source 재검증을 위해 `--universe-path`, `--coverage-path`, `--calendar-fixtures-path`, 하나 이상의 `--calendar-rule`을 필수로 받는다.
- 새 sampling mode는 `validation_role_regime_plan`으로 기록한다.
- Workflow는 plan row의 exact start/end를 사용하고 random 또는 balanced sampler를 다시 호출하지 않는다.
- Plan row의 full-boundary `executionAssignment`, `sourceAssignments`, `candidateHash`, `evidenceGroupHash`, `targetRegime`, `planHash`를 manifest와 run record에 남긴다.
- Replay 직전에 embedded assignment의 boundary와 embargo로 effective role window를 다시 계산하고 selected window가 그 안에 완전히 포함되는지 확인한다.
- Selected window의 recomputed regime과 target regime이 다르면 replay 전에 fail-closed로 중단한다.
- Candidate scope, calendar validation, availability와 universe/range gate를 replay 직전에 다시 적용한다.
- Plan provenance mismatch 또는 unavailable source는 run을 skipped success로 바꾸지 않고 batch 시작 전에 거부한다.
- Snapshot, universe source, coverage, calendar와 default classifier hash를 plan provenance와 비교하고 모든 planned candidate hash, scope availability, recomputed regime을 artifact 생성 전에 재검증한다.
- Plan mode의 batch output directory가 이미 존재하면 기존 artifact를 지우지 않고 거부한다.

기존 `--validation-splits-path`의 9개 full-role `fixed_range` 동작과 standalone `balanced_regime` sampler는 그대로 유지한다.

## Selection Trial과 Report

Selection trial은 run 결과를 winner로 자동 선택하지 않으며 기존 `selection.selected=false`를 유지한다.

후속 schema 연결은 최소한 다음을 보존해야 한다.

- `planHash`, `planIndex`, `candidateHash`, `evidenceGroupHash`
- `splitRole`, `targetRegime`, `sourceAssignments`, `executionAssignment`
- Planned run count와 global unique evidence group count
- Cross-role shared evidence warning
- Role-regime별 completed/skipped/failed count
- Candidate hash 기준 independent evidence count

Report는 50 planned rows를 50 independent samples로 표시하면 안 된다. 같은 hash의 duplicate role run은 role 진단에는 남기되 global statistical aggregate에서 한 evidence group으로 처리한다.

## Fail-Closed 중단 조건

다음 조건이면 ready plan 또는 batch run을 만들지 않는다.

- Feasibility file missing, empty, corrupt 또는 schema mismatch
- Validation split source missing, empty, corrupt 또는 schema mismatch
- Snapshot, universe, coverage 또는 calendar fixture source missing, corrupt, empty 또는 schema mismatch
- Feasibility status가 `available`이 아님
- Mode가 `paper_only`가 아님
- Validation split source hash와 feasibility `validationSplitHash` mismatch
- Validation split assignment missing, duplicate 또는 boundary/embargo mismatch
- Recomputed candidate regime, scope, aggregate, warning 또는 status mismatch
- Source provenance 또는 artifact hash mismatch
- Candidate hash payload mismatch
- Candidate가 source assignment role/embargo boundary를 벗어남
- Required role-regime cell 누락
- Unknown 또는 duplicate target regime
- `scopeAvailable=false` candidate가 run에 포함됨
- Duplicate `planIndex` 또는 `runKey`
- Summary와 ordered run 재계산 불일치
- `planHash` mismatch
- Existing output collision
- Plan mode와 기존 validation/random/balanced option 동시 사용
- Replay 직전 regime, calendar, scope 또는 source gate mismatch

Unavailable regime을 broad fallback, 다른 bucket 또는 다른 role candidate로 대체하지 않는다.

## 구현 PR 분할

1. `validation_role_regime_replay_plan.v1` schema와 pure exhaustive builder
2. Cross-role evidence grouping, canonical hash와 parser 검증
3. Exclusive writer와 read-only plan CLI
4. Batch manifest/run record plan provenance contract
5. Workflow exact-window 연결과 fail-closed E2E
6. [Deterministic fixture provider smoke 결과 문서](validation-role-regime-replay-smoke-results.md)

각 PR은 앞 단계 contract와 test만 포함한다. Plan artifact parser와 writer가 완성되기 전에는 batch workflow semantics를 변경하지 않는다.

## 테스트 요구사항

### 정상 흐름

- 현재 artifact에서 role run count 29, 12, 9와 planned 50 생성
- Global unique evidence group 39와 cross-role shared group 11 계산
- 12개 role-regime cell coverage
- 같은 role assignment 중복 candidate를 hash로 한 번만 schedule
- 모든 source assignment reference 보존과 canonical execution assignment 선택
- 원본 validation split source hash 일치 및 full boundary/embargo contract 보존
- 원본 source로 재생성한 feasibility payload 전체 일치
- Input ordering과 무관한 run ordering 및 `planHash`
- Source assignment/candidate 배열, role 및 assignment available/unavailable regime 배열과 warning 순서가 달라도 같은 `feasibilityArtifactHash`
- Plan 자체의 `generatedAt`만 다른 plan의 hash 동일
- Cross-role duplicate run이 같은 `evidenceGroupHash` 사용
- Existing fixed validation과 standalone balanced sampling 미변경

### Fail-closed 흐름

- Missing/corrupt/schema-invalid feasibility 거절
- Missing/corrupt/schema-invalid validation split source 거절
- Missing/corrupt/schema-invalid snapshot, universe, coverage 또는 calendar fixture source 거절
- `insufficient`와 `invalid` source는 empty non-ready plan으로 닫고 batch 입력 거절
- Non-paper mode 거절
- Validation split source hash mismatch 거절
- Snapshot, universe, coverage, calendar 또는 classifier provenance hash mismatch 거절
- Split assignment missing, duplicate, boundary 또는 embargo mismatch 거절
- Candidate hash가 같아도 recomputed regime label이 다르면 거절
- Recomputed scope, aggregate, warning 또는 status mismatch 거절
- Feasibility provenance와 artifact hash mismatch 거절
- Same hash/different payload 거절
- Role/embargo boundary 밖 candidate 거절
- Missing role-regime cell은 `insufficient`, fallback 없음
- Scope unavailable 또는 non-target candidate scheduling 거절
- Duplicate plan index/run key와 aggregate mismatch 거절
- Plan hash mismatch 거절
- Existing output path 보존
- Conflicting batch CLI option을 source/replay 접근 전에 거절
- Replay 직전 candidate regime/hash mismatch 거절

## 해석 제한

- Planned run 수는 independent sample 수가 아니다.
- Role-local candidate 수는 모두 statistical minimum 30 미만이다.
- Train과 validation bear는 같은 sole evidence group을 공유한다.
- Same-window cross-role 결과로 role 일반화를 주장하지 않는다.
- Pairwise trading-date overlap 0은 serial independence를 증명하지 않는다.
- Observed-session fixture는 공식 exchange holiday/early-close evidence가 아니다.
- 첫 workflow smoke는 deterministic fixture provider로 plumbing만 검증한다.
- AI evidence, performance metric 또는 report가 deterministic Risk Engine을 우회하지 않는다.

## Safety Boundary

- Paper-only historical replay plan만 다룬다.
- Live order, broker mutation, natural language order 또는 `place_order` surface를 추가하지 않는다.
- Raw `codex exec` 또는 raw `tossctl` surface를 추가하지 않는다.
- AI가 window, regime, sample grouping, sizing 또는 final gate를 결정하지 않는다.
- Plan은 provider/risk/execution option을 포함하지 않는다.
- Deterministic backend와 Risk Engine의 기존 최종 책임을 변경하지 않는다.
- 특정 strategy winner, 종목, 실거래 parameter 또는 예상 성과를 제안하지 않는다.

## 이번 PR 완료 기준

- 현재 fixed validation path와 standalone balanced sampler의 책임을 코드 기준으로 기록한다.
- Exhaustive role-local schedule과 cross-role evidence grouping을 고정한다.
- Plan artifact, CLI, workflow provenance와 fail-closed contract를 정의한다.
- 후속 구현을 작은 PR 단위로 분리한다.
- Code/schema 변경, generated plan, replay 실행 또는 strategy 판정 변경을 포함하지 않는다.
