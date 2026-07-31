# Validation Role-Regime Evidence Expansion Split Provenance 계획

## 목적

이 문서는 `short_term` evidence expansion에서 baseline과 expansion의
validation split provenance를 분리하는 후속 contract를 사전 고정한다.

현재 preflight verifier는 baseline과 expansion의 `validationSplitHash`가
같아야 한다. 이 조건은 같은 기간과 같은 assignment를 재검증하는 데는
보수적이지만, baseline 범위 밖의 신규 evidence interval을 expansion
candidate로 열 수 없다.

이번 계획은 source, split assignment 또는 artifact를 생성하지 않는다.
Replay return, PnL, Sharpe, PSR, DSR, PBO, hit rate, drawdown, selection score와
AI decision 결과를 입력으로 사용하지 않는다.

## 현재 Contract의 구조적 Blocker

2026-07-30 실행 host에서 확인한 local source 범위는 다음과 같다.

| Source | Range | 비고 |
| --- | --- | --- |
| Baseline Yahoo daily | 2023-01-01\~2026-05-31 KST | 현재 baseline provenance source |
| Local TossInvest daily | 2024-01-01\~2026-06-17 KST | Baseline과 대부분 겹치며 strategy-bucket coverage가 현재 artifact에 없음 |
| 다른 local Yahoo daily | 2023-01-01\~2026-05-31 KST | Baseline과 같은 기간 |

Local directory 존재와 수정 시각은 canonical provenance가 아니다. 위 표는
source 선택이 아니라 현재 host inventory 진단이다.

현재 contract에서는 다음 조건이 동시에 성립한다.

1. Baseline raw source의 validation split hash는 baseline feasibility와 정확히
   일치해야 한다.
2. Expansion validation split hash는 baseline validation split hash와
   일치해야 한다.
3. Candidate는 assignment role window 안에서만 열거한다.
4. `evidenceGroupHash`는 source, universe, coverage, split hash와 role을
   제외한 동일 `[startAt, endAt]` interval identity다.

따라서 expansion source에 baseline 이전 또는 이후 snapshot을 추가해도 같은
assignment를 사용하면 신규 기간은 candidate가 아니다. 같은 기간을 다른
source로 다시 수집하면 candidate가 생기더라도 baseline과 같은
`evidenceGroupHash`로 deduplicate된다.

이 상태에서 local source를 actual expansion input으로 등록하면 신규
independent capacity를 확보하지 못하거나, split hash mismatch로 artifact
생성 전에 거부된다.

## Split Provenance Contract

후속 `validation_role_regime_evidence_expansion_preflight.v1` source identity는
single `validationSplitHash` 대신 두 hash를 분리해 보존한다.

```ts
interface EvidenceExpansionPreflightSource {
  baselineFeasibilityArtifactHash: string;
  baselinePlanHash: string;
  baselineReadinessArtifactHash: string;
  expansionDataSnapshotHash: string;
  expansionUniverseHash: string;
  expansionCoverageHash: string;
  baselineValidationSplitHash: string;
  expansionValidationSplitHash: string;
  calendarHash: string;
  officialCalendarArtifactHash: string | null;
  marketRegimeClassifierHash: string;
}
```

- `baselineValidationSplitHash`는 baseline feasibility provenance와 정확히
  일치해야 한다.
- `expansionValidationSplitHash`는 strict-validated expansion assignment
  source에서 별도로 계산한다.
- 두 hash의 equality는 필수 조건이 아니다.
- 두 hash가 같다는 사실만으로 신규 evidence를 주장하지 않는다.
- 두 hash가 다르다는 사실만으로 독립 evidence를 주장하지 않는다.

Actual artifact는 아직 생성되지 않았으므로 이번 변경 방향에는 stored
artifact migration이 없다. Schema 구현 PR은 single field를 두 field로
교체하고 fixture, hash와 inspect test를 함께 갱신해야 한다.

## Split Compatibility Gate

Expansion split source가 baseline과 다른 경우에도 다음 조건은 유지한다.

- 모든 assignment는 기존 strict `validation_split_assignment.v1` schema와
  role boundary validation을 통과해야 한다.
- `validationProtocol`은 `walk_forward`를 유지한다.
- Candidate bucket은 `short_term`, window는 1개월, timezone offset은
  540분을 유지한다.
- Expansion assignment의 `purgeDurationDays`와 `embargoDurationDays`는
  baseline policy와 일치해야 한다.
- Split source는 결과 metric 확인 전에 path, canonical hash, range, role
  duration과 step policy를 별도 문서 PR로 고정해야 한다.
- 같은 split identity가 서로 다른 payload를 가리키거나 role boundary가
  겹치면 fail-closed로 거부한다.

Expansion split은 baseline coverage 밖의 interval을 포함할 수 있다. 해당
interval이 target capacity에 포함되려면 expansion source coverage,
official-derived calendar fixture, candidate scope와 provenance 검증을 모두
통과해야 한다.

## Candidate Identity 연결

Baseline candidate의 `sourceVariantHash`는
`baselineValidationSplitHash`를 사용한다. Expansion candidate의
`sourceVariantHash`는 `expansionValidationSplitHash`를 사용한다.

Source-independent `evidenceGroupHash` payload는 변경하지 않는다.

- 같은 interval은 split source가 달라도 하나의 evidence group이다.
- 신규 expansion interval만 incremental capacity가 될 수 있다.
- 같은 interval의 regime label이 source variant 사이에서 다르면
  `CANDIDATE_IDENTITY_CONFLICT` blocker를 유지한다.
- Cross-role shared 판정은 두 split source를 합친 뒤 기존 evidence group
  identity로 계산한다.

## Fail-Closed 규칙

- Baseline split hash가 baseline artifact와 다르면 source pair를 생성하지
  않는다.
- Expansion split source가 strict validation을 통과하지 못하면 expansion
  capacity를 생성하지 않는다.
- Split policy가 사전 등록되지 않았거나 purge/embargo policy가 baseline과
  다르면 actual preflight를 실행하지 않는다.
- Source variant가 자신의 split hash를 사용하지 않으면 artifact를
  생성하지 않는다.
- Incremental capacity가 target을 충족하지 못하면 target을 낮추거나 같은
  interval을 중복 집계하지 않고 `inconclusive`를 유지한다.

## 후속 작은 PR 순서

1. Preflight source schema와 canonical hash에 baseline/expansion split hash
   분리
2. Source-pair verifier의 unconditional hash equality 제거 및 split
   compatibility verifier 추가
3. Identity, bundle, writer, inspect와 CLI 회귀 테스트 갱신
4. Expansion source range, universe, coverage, split policy, canonical
   `generatedAt`과 temp output root 사전 등록

각 PR은 뒤 단계의 source 확보, artifact 생성 또는 readiness 통과를 주장하지
않는다.

2026-07-31 기준 1단계의 preflight source schema와 canonical hash 분리,
2단계의 split compatibility verifier와 unconditional hash equality 제거가
구현됐다. Compatibility gate는 strict assignment 검증 이후 source별 uniform
`walk_forward`, purge, embargo policy와 동일 split identity의 boundary
일관성을 확인하고 preflight config는 `short_term`, 1개월, KST 540분을
literal로 제한한다. Distinct hash는 이 gate를 통과해야 보존되지만 그 자체로
신규 evidence를 뜻하지 않는다. Bundle, writer, inspect와 CLI 전체 회귀
갱신은 3단계 범위다.

## Non-Goals

- Expansion source 선택, 수집 또는 coverage 생성
- Validation split assignment 또는 preflight artifact 생성
- Official calendar ingestion 또는 full legacy fixture 생성
- Replay 실행, strategy metric 계산 또는 유효성 판정
- 특정 종목 추천, 투자 조언 또는 수익 보장
- Live order, broker mutation, natural language order, raw `codex exec`, raw
  `tossctl`, `place_order` surface 추가
- Deterministic backend 또는 Risk Engine 우회

AI는 decision/evidence provider에만 머물며 final sizing과 gate는
deterministic backend와 Risk Engine이 담당한다.
