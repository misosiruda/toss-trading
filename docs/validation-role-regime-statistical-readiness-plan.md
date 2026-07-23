# Validation Role-Regime 통계 준비도 보강 계획

## 목적

이 문서는 `validation_role_regime_replay_plan.v1` smoke 이후 남은 통계 준비도 gap과 후속 검증 순서를 사전 고정한다. 현재 결과는 exact-window replay plumbing, provenance 보존, 전역 evidence deduplication을 확인했지만 전략 유효성은 `inconclusive`다.

이 계획의 목적은 결과 metric을 본 뒤 표본, window, regime 또는 판정 기준을 바꾸는 일을 막고, 어떤 근거가 충족돼야 paper-only research 판정을 다시 수행할 수 있는지 명시하는 것이다.

다음 항목은 이 계획을 최초 추가한 문서 PR의 범위가 아니었다. 실제 후속 구현 상태는 아래 작은 PR 순서에 기록한다.

- 새 replay 실행, artifact 생성 또는 기존 결과 재해석
- 통계 calculator, report schema, dashboard 또는 API 구현
- 특정 strategy bucket의 유효성 판정이나 후보 간 순위 결정
- 실거래, broker mutation, 주문 surface, sizing 또는 Risk Engine 우회

## 기준 문서와 현재 상태

- [Validation Role-Local Regime Replay Selection 계획](validation-role-regime-replay-selection-plan.md)
- [Validation Role-Regime Replay Smoke 결과](validation-role-regime-replay-smoke-results.md)
- [Sharpe Statistical Validation Contract](sharpe-statistical-validation-contract.md)
- [Strategy Bucket Validation Protocol](strategy-bucket-validation-protocol.md)
- [Validation Split Role-Local Regime Feasibility 결과](validation-split-regime-feasibility-results.md)

현재 smoke의 count는 다음과 같다.

| 구분 | Train | Validation | Test | 전체 |
| --- | ---: | ---: | ---: | ---: |
| Planned role row | 29 | 12 | 9 | 50 |
| 현재 Sharpe minimum 충족 | 아니오 | 아니오 | 아니오 | role 합산으로 판정하지 않음 |
| Global unique evidence group | - | - | - | 39 |
| Cross-role shared evidence group | - | - | - | 11 |

Role-regime cell의 completed count는 다음과 같다.

| Role | Bull | Bear | Sideways | Mixed |
| --- | ---: | ---: | ---: | ---: |
| Train | 9 | 1 | 5 | 14 |
| Validation | 6 | 1 | 2 | 3 |
| Test | 5 | 1 | 2 | 1 |

`plannedRunCount=50`은 독립 표본 수가 아니다. 전역 aggregate는 같은 `evidenceGroupHash`를 한 번만 사용해 39개 return sample을 집계한다. 반면 role 진단은 계획된 row를 유지하므로, 같은 evidence가 여러 role에 존재하는 상태에서 role 간 차이를 독립 holdout 비교로 해석할 수 없다.

## 현재 확인된 것과 확인되지 않은 것

| 차원 | 현재 상태 | 허용되는 해석 | 금지되는 해석 |
| --- | --- | --- | --- |
| Plan 재현성 | pass | 같은 입력에서 같은 ordered plan과 hash가 생성됨 | 전략 가정이 유효함 |
| Exact-window 실행 | pass | 50개 row가 계획 window와 일치함 | 50개 독립 표본을 확보함 |
| 전역 evidence 집계 | pass | 39개 unique evidence만 전역 통계에 사용됨 | Role별 표본 부족이 해소됨 |
| Role별 sample | blocked | Train 29, validation 12, test 9를 그대로 기록함 | Role 합산 또는 duplicate로 minimum 30을 충족함 |
| Role-regime 반복 근거 | blocked | 모든 cell에 실행 row가 존재함 | Candidate 1개인 cell에서 일반화함 |
| Serial dependence | inconclusive | `NON_IID_RETURN_SAMPLE`을 경고로 보존함 | Trading-date overlap 0만으로 IID를 주장함 |
| Multiple testing | inconclusive | Selection context가 없음을 기록함 | 관측된 최고 metric을 사후 선택함 |
| Calendar | blocked | 관측 session mapping이 실행 입력과 일치함 | 공식 holiday, 누락 session, early close 정합성을 주장함 |
| Provider realism | fixture-only | Deterministic paper plumbing을 검증함 | 실제 시장 체결 또는 실거래 성과를 추정함 |

## 준비도 판정 계약

후속 결과는 각 차원을 독립적으로 판정한다. 하나의 성과 metric이 다른 blocker를 상쇄하지 않는다.

### 1. Provenance와 integrity

다음 조건을 모두 충족할 때만 pass다.

- Source, universe, coverage, validation split, calendar, feasibility와 plan hash를 보존한다.
- Run의 `planIndex`, `candidateHash`, exact `startAt`/`endAt`, `validationSplit`과 recomputed regime이 plan과 일치한다.
- Plan이 있는 run과 legacy run을 한 aggregate에 섞지 않는다.
- 같은 `evidenceGroupHash`의 상태 또는 aggregate input이 충돌하지 않는다.
- Planned, role-local, global unique, shared evidence count를 서로 다른 field로 유지하고 observed count와 대조한다.

Hash mismatch, partial provenance, mixed input 또는 count conflict가 있으면 report 생성을 fail-closed로 거부한다.

### 2. Role별 sample

현재 구현된 statistical minimum은 role별 30개 return sample이다. 각 role은 그 role 안에서 `evidenceGroupHash`를 deduplicate한 count로 독립 판정한다.

- Train, validation, test가 각각 30 이상이어야 role별 Sharpe 계산 준비도를 통과한다.
- 다른 role의 row를 빌리거나 같은 evidence를 반복 실행해 minimum을 채우지 않는다.
- 전역 unique count가 30 이상이어도 validation 또는 test readiness를 대신하지 않는다.
- Minimum 미만인 role의 Sharpe 계열 metric은 기존 contract대로 `null`과 `INSUFFICIENT_RETURN_SAMPLES`를 유지한다.

30은 계산 가능성의 최소 gate이며 전략 유효성의 충분조건이 아니다.

### 3. Role-regime cell 반복 근거

현재 feasibility minimum 1은 실행 가능성 확인 기준일 뿐 통계적 일반화 기준이 아니다. Candidate가 하나뿐인 cell은 `ROLE_REGIME_SINGLE_CANDIDATE`를 유지하고 해당 regime의 반복성을 판정하지 않는다.

Role-regime별 통계 minimum은 아직 계약되지 않았다. 후속 구현 전에 다음을 별도 문서에서 사전 결정해야 한다.

- 판정 대상 metric과 효과 크기
- 허용 오차와 confidence 또는 power 기준
- Serial dependence를 반영한 effective sample size 계산 방식
- Market별 분리 여부와 sparse regime 처리
- Cell minimum 미달 시 `inconclusive`로 닫는 규칙

현재 결과를 보고 cell minimum을 정하거나, 부족한 cell만 좋은 결과가 나올 때까지 반복하지 않는다.

### 4. Cross-role 독립성

같은 evidence group이 여러 role에 존재하면 각 role의 실행 진단에는 남기되 role 간 일반화 비교의 독립 근거로 사용하지 않는다.

Cross-role comparison readiness는 다음을 요구한다.

- Shared group과 role-exclusive group을 report에서 구분한다.
- Train에서 사용한 evidence가 validation 또는 test의 holdout 개선 근거로 다시 계산되지 않는다.
- Role별 metric 비교에는 공통 evidence를 제거한 exclusive view 또는 dependence를 명시적으로 반영한 사전 계약을 사용한다.
- Exclusive view의 sample이 minimum 미만이면 cross-role 판정은 `inconclusive`다.

후속 report schema가 exclusive count와 metric을 제공하기 전에는 train 대비 validation/test 일반화를 판정하지 않는다.

### 5. Serial dependence와 Sharpe

Trading date overlap이 0이어도 같은 universe와 연속 market history를 공유하므로 IID를 증명하지 않는다.

- `autocorrelationMaxLag`를 실행 전 고정한다.
- 절댓값 0.2 이상 autocorrelation이 있으면 기존 `NON_IID_RETURN_SAMPLE` warning을 유지한다.
- Serial correlation 보정이 계산 가능한 경우 `loAdjustedSharpe`를 sample Sharpe와 함께 기록한다.
- 보정을 계산할 수 없으면 `SERIAL_CORRELATION_NOT_ADJUSTED`를 유지하고 Sharpe 단독 판정을 금지한다.
- Sample Sharpe, confidence interval, PSR 또는 DSR 중 하나만 유리하다고 선택하지 않는다.

Lag와 해석 기준은 결과를 보기 전에 run contract 또는 artifact provenance에 기록한다.

### 6. Multiple testing과 selection context

Strategy, preset, parameter, window 또는 policy 후보를 비교한다면 전체 trial universe를 실행 전에 고정한다.

- `candidateCount` 또는 `trialCount`의 출처를 기록한다.
- `multipleTestingAdjustment`를 `candidate_count` 또는 `trial_log`로 명시한다.
- Trial Sharpe dispersion과 `selectedByMetric`을 보존한다.
- 독립 trial count가 2 미만이거나 dispersion이 양수가 아니면 DSR을 계산하지 않는다.
- Context가 없으면 `MULTIPLE_TESTING_CONTEXT_MISSING` 또는 `SELECTION_CONTEXT_MISSING`을 유지한다.

Smoke의 `selected=false` trial은 자동 승격 방지 확인용이며 candidate superiority evidence가 아니다.

### 7. Calendar evidence

현재 observed-session fixture는 snapshot에 존재하는 session만 매핑한다. Calendar readiness는 KRX와 NYSE에 대해 독립적으로 확인 가능한 exchange calendar 근거를 고정한 뒤 다시 판정한다.

필수 검증 범위:

- 정규 session trading date
- Holiday와 임시 휴장
- Early close 또는 단축 session
- Exchange timezone과 DST 적용
- Source dataset에 누락된 expected session과 예상하지 않은 session
- Calendar source identifier, version 또는 retrieval date와 canonical hash

Calendar source와 갱신 정책은 별도 contract에서 결정한다. Source가 없거나 hash가 맞지 않거나 expected session mismatch가 있으면 해당 market/window를 `inconclusive`로 닫고 replay input으로 승격하지 않는다.

## 데이터 확장 원칙

추가 evidence는 성과 결과가 아니라 readiness gap을 기준으로 수집한다.

1. 현재 source의 시작일과 종료일, window 길이, cadence, role boundary와 embargo를 baseline으로 보존한다.
2. 필요한 role별 minimum과 sparse cell을 먼저 계산하고 목표 evidence matrix를 기록한다.
3. 확장 가능한 source date range와 market coverage를 결과 metric을 보기 전에 고정한다.
4. Candidate 생성, regime classification, deduplication과 exclusion 규칙을 현재 version 또는 명시적 새 version으로 고정한다.
5. 기존 evidence와 신규 evidence의 overlap, adjacency, shared universe와 regime persistence를 진단한다.
6. 목표 count를 채우지 못하면 threshold를 낮추지 않고 `inconclusive`를 유지한다.

Data source, classifier, window 또는 split policy가 바뀌면 기존 결과에 단순 append하지 않는다. 새 provenance hash와 별도 batch로 실행하고 compatibility를 확인한다.

## 후속 작은 PR 순서

### PR 1. Statistical readiness artifact contract

- `validation_role_regime_statistical_readiness.v1` strict schema
- Role-local unique, role-exclusive, global unique, shared evidence count
- Role-regime cell count와 blocker code
- Expected/observed provenance count conflict 시 `invalid` 강제
- 계산기, writer 또는 report 연결 없이 fixture contract test

구현 위치:

```text
src/replay/validationRoleRegimeStatisticalReadiness.ts
src/replay/validationRoleRegimeStatisticalReadiness.test.ts
```

이 단계의 `ready_for_statistical_validation` fixture는 schema의 일관성 검증용이다. Fixture의 `roleRegimeSampleMinimum=2`는 합성 contract 입력이며 운영 threshold 또는 후속 통계 결정을 뜻하지 않는다. 실제 smoke artifact를 생성하거나 현재 `inconclusive` 판정을 변경하지 않는다.

### PR 2. Aggregate readiness summary

- Evidence-aware report에 `validationRoleRegimeStatisticalReadiness` 연결
- Planned provenance row에서 global, role-local, role-exclusive, shared와 role-regime count 계산
- Role minimum 30, single-candidate, empty cell, shared evidence blocker 생성
- 미정인 role-regime minimum은 `null`과 `ROLE_REGIME_STATISTICAL_MINIMUM_UNDEFINED`로 보존
- Legacy report는 readiness를 `null`로 유지
- Mixed, partial, conflicting provenance 입력은 기존 report gate와 readiness schema에서 fail-closed 처리

구현 위치:

```text
src/reports/batchReplayReport.ts
src/replay/validationRoleRegimeStatisticalReadiness.ts
```

이 단계는 aggregate report 생성 시 readiness artifact를 계산하지만 기존 smoke artifact를 다시 실행하거나 결과 문서를 갱신하지 않는다. 실제 smoke 재검증은 expanded paper-only replay 단계에서 별도로 기록한다.

### PR 3. Calendar source contract

- `official_market_calendar_evidence.v1` strict contract
- KRX/NYSE publisher, source URL, retrieval/stale time와 source document hash provenance
- Coverage 전체 exchange-date row와 canonical order
- Regular, early-close, holiday, special-closure, weekend session validation
- IANA timezone 기반 local session date/time과 NYSE DST validation
- Missing coverage, stale source, artifact hash mismatch와 session mismatch fail-closed test

구현 위치:

```text
src/replay/officialMarketCalendarEvidence.ts
src/replay/officialMarketCalendarEvidence.test.ts
```

이 단계의 source와 `.invalid` URL은 합성 contract fixture다. 실제 official KRX/NYSE source 확보, artifact writer, observed-session fixture 교체, replay/CLI 연결 또는 calendar readiness 통과는 포함하지 않는다.

### PR 4. Evidence expansion preflight plan

- 결과 metric을 읽지 않는 source/candidate capacity scan
- Role 및 role-regime 목표 matrix
- Overlap, adjacency와 effective sample diagnostic 입력
- 충족 불가 cell과 제외 사유 기록

첫 작은 범위는 [Validation Role-Regime Evidence Expansion Preflight 계획](validation-role-regime-evidence-expansion-preflight-plan.md)에서 input allowlist, result-metric 금지 boundary, target/capacity/dependency/exclusion contract와 fail-closed status를 사전 고정한다. 이 문서 단계에는 schema, source scan, writer, CLI, generated artifact 또는 replay 실행을 포함하지 않는다.

### PR 5. Expanded paper-only replay와 결과 기록

- 사전 고정한 plan으로 deterministic replay 실행
- 실제 명령, artifact hash, count와 warning 기록
- Readiness gate 재판정
- Gate를 모두 통과하지 못하면 전략 판정을 계속 `inconclusive`로 유지

각 PR은 한 단계만 구현하며 뒤 단계의 체크리스트나 완료 주장을 포함하지 않는다.

## 최종 판정 규칙

현재 baseline 판정은 `inconclusive`다. 다음 조건이 모두 충족돼야 strategy bucket validation protocol에 따른 별도 판정 작업을 시작할 수 있다.

- Provenance와 evidence integrity pass
- Train, validation, test 각각 role-local unique sample 30 이상
- Role-regime cell minimum 계약 완료 및 해당 gate 충족
- Cross-role exclusive/dependence-aware comparison 제공
- Serial dependence diagnostic과 필요한 보정 제공
- Multiple-testing selection context 제공
- Official-calendar contract에 따른 market별 검증 pass

이 준비도 통과는 paper-only research 판정을 시작할 수 있다는 의미일 뿐, 실거래 적용, 특정 종목 판단, 수익 기대 또는 Risk Engine 우회를 뜻하지 않는다. AI는 decision/evidence provider에 머물며 final sizing과 gate는 deterministic backend와 Risk Engine이 담당한다.
