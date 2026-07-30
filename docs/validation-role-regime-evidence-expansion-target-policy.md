# Validation Role-Regime Evidence Expansion Target 정책

## 목적

이 문서는 `short_term` evidence expansion preflight의
`roleRegimeSampleMinimum`을 실제 expansion 결과 확인 전에 고정한다.

이번 정책은 다음 값만 결정한다.

| 항목 | 값 |
| --- | ---: |
| `roleSampleMinimum` | 30 |
| `roleRegimeSampleMinimum` | 8 |
| 적용 role | `train`, `validation`, `test` |
| 적용 regime | `bull`, `bear`, `sideways`, `mixed` |

`roleSampleMinimum=30`은 기존 statistical readiness contract를 그대로
사용한다. 새로 고정하는 값은 각 role-regime cell의 capacity floor 8이다.

이 값은 replay return, PnL, Sharpe, PSR, DSR, PBO, hit rate, drawdown,
selection score 또는 AI decision 결과를 입력으로 사용하지 않는다. 특정 전략,
종목 또는 시장 상태의 유효성을 주장하지 않는다.

## 결정 근거

각 role은 네 regime을 모두 독립 cell로 유지한다. Cell minimum을 8로 고정하면
모든 cell을 충족한 role은 최소 32개의 role-local evidence group을 가져야 한다.

```text
4 regimes * 8 evidence groups = 32 evidence groups
32 >= roleSampleMinimum 30
```

따라서 네 regime을 모두 충족하면서 role 전체 minimum 30에는 미달하는 target
조합을 만들지 않는다. 반대로 role 전체 count만 30 이상이고 특정 regime이
희소한 상태는 통과시키지 않는다.

8은 통계적 유의성, power 또는 전략 유효성을 보장하는 표본 수가 아니다.
첫 expansion preflight에서 다음 두 목적에만 사용한다.

- 단일 candidate 또는 소수 regime 관측을 반복 근거로 승격하지 않는 capacity
  floor
- 세 role과 네 regime에 같은 규칙을 적용하는 deterministic target matrix

Regime별 metric 해석에는 effective sample size, serial dependence,
cross-role independence, multiple-testing context와 official calendar gate가
별도로 필요하다. 해당 gate가 충족되지 않으면 count가 8 이상이어도 최종
판정은 `inconclusive`를 유지한다.

## 집계 규칙

Target은 각 role에 동일하게 적용한다.

```ts
{
  train: {
    roleLocalUniqueMinimum: 30,
    roleExclusiveMinimum: 30,
    byRegime: { bull: 8, bear: 8, sideways: 8, mixed: 8 }
  },
  validation: {
    roleLocalUniqueMinimum: 30,
    roleExclusiveMinimum: 30,
    byRegime: { bull: 8, bear: 8, sideways: 8, mixed: 8 }
  },
  test: {
    roleLocalUniqueMinimum: 30,
    roleExclusiveMinimum: 30,
    byRegime: { bull: 8, bear: 8, sideways: 8, mixed: 8 }
  }
}
```

- Count는 검증된 `evidenceGroupHash`를 role 안에서 deduplicate한 뒤 계산한다.
- 같은 evidence를 반복 실행해 count를 늘리지 않는다.
- Cross-role shared evidence는 role-local 진단에는 남기지만
  `roleExclusiveMinimum` 충족 근거로 사용하지 않는다.
- 하나의 candidate를 여러 regime에 중복 집계하지 않는다.
- Calendar-invalid, scope-unavailable 또는 provenance-invalid candidate는
  target count에서 제외한다.
- Source correction이나 universe 재수집으로 같은 market-history interval을 새
  독립 evidence group으로 만들지 않는다.

## Fail-Closed 규칙

Actual preflight source bundle은 `roleRegimeSampleMinimum=8`을 명시해야 한다.

- 값이 누락되거나 `null`이면 `ROLE_REGIME_TARGET_UNDEFINED` blocker를
  유지한다.
- 8이 아닌 non-null 값은 declared-policy verifier가 source bundle 검증
  단계에서 fail-closed로 거부한다.
- Role-local, role-exclusive 또는 role-regime target 중 하나라도 미달하면
  `ready_for_expansion_replay`로 승격하지 않는다.
- 부족한 cell에 맞춰 source range, classifier threshold 또는 target을 사후
  변경하지 않는다.
- Target 변경이 필요하면 결과 artifact와 분리된 새 정책 PR에서 근거와
  version을 먼저 고정한다.

## 현재 Baseline과의 관계

현재 baseline readiness count는 이 정책의 입력 근거가 아니라 gap 진단에만
사용한다. Existing baseline은 role-local count가 train 29, validation 12,
test 9이고 일부 role-regime cell은 1개뿐이다. 따라서 현재 artifact는 새
target을 충족하지 않으며 계속 `inconclusive`다.

Expansion source range, universe, coverage, validation split, canonical
`generatedAt`과 temp output root는 이번 문서에서 선택하지 않는다. 해당
입력은 source overlap과 실제 확보 가능 범위를 별도 검토한 다음 결과 확인
전에 후속 문서 PR로 고정한다.

## Non-Goals

이번 정책은 다음을 수행하지 않는다.

- Expansion source 선택 또는 수집
- Official calendar ingestion 또는 fixture 생성
- Feasibility, replay plan, replay, readiness 또는 preflight artifact 생성
- Strategy metric 계산 또는 유효성 판정
- 특정 종목 추천, 투자 조언 또는 수익 보장
- Live order, broker mutation, natural language order, raw `codex exec`, raw
  `tossctl`, `place_order` surface 추가
- Deterministic backend 또는 Risk Engine 우회

AI는 decision/evidence provider에만 머물며 final sizing과 gate는
deterministic backend와 Risk Engine이 담당한다.
