# Strategy Preset Candidate Scope Audit

이 문서는 `--strategy-preset`과 historical replay candidate의 `strategyBucket` 귀속이 현재 어떻게 분리되어 있는지 확인하고, bucket-specific paper validation을 위한 다음 구현 contract를 고정한다.

이 문서는 특정 종목 판단, 투자 조언, 성과 보장 또는 live trading signal이 아니다. 구현 전 audit와 fail-closed candidate scope 설계만 다룬다.

## 확인 배경

[Short-Term Liquidity Stress Validation 결과](short-term-liquidity-stress-results.md)에서 liquidity fixture 자체는 `valid`였지만 partial fill 11건과 9건이 모두 aggregate report의 `UNKNOWN` strategy bucket에 귀속됐다. `short_term` bucket partial fill은 0이었다.

이 상태에서는 `strategyPreset=short_term` 실행 결과를 `short_term` bucket candidate만 사용한 결과로 해석할 수 없다.

## 현재 Contract

### `strategyPreset` 책임

`src/replay/strategyReplayPreset.ts`의 preset은 다음 replay configuration을 제공한다.

- replay window와 step seconds
- decision frequency와 call cap
- risk profile 및 일부 risk policy
- paper exit policy
- 일부 market regime allocation 또는 dynamic cash reserve policy

`strategyPreset`은 candidate universe filter가 아니며 candidate나 trade의 `strategyBucket`을 preset 이름으로 덮어쓰지 않는다.

### Candidate metadata 흐름

현재 historical replay의 bucket metadata 흐름은 다음과 같다.

1. `HistoricalMarketSnapshot.strategyBucket`이 있으면 `HistoricalMarketPacketBuilder`가 `MarketCandidate.strategyBucket`으로 전달한다.
2. Deterministic `FirstPricedHistoricalDecisionProvider`는 priced candidate를 순서대로 평가하며 bucket을 기준으로 후보를 제한하지 않는다.
3. `PaperOrderEngine`은 기존 position bucket 또는 candidate bucket만 trade에 복사한다.
4. Candidate와 position 모두 bucket이 없으면 trade에도 bucket을 만들지 않는다.
5. Report는 bucket이 없는 trade를 aggregation에서만 `UNKNOWN`으로 분류한다.

Preset을 fallback bucket으로 사용하지 않는 현재 propagation은 안전하다. Metadata가 없는 symbol을 특정 strategy에 귀속시키지 않기 때문이다.

### Universe manifest 책임

현재 `HistoricalMarketPacketBuilder`는 universe manifest에서 lifecycle metadata를 조회하지만 `strategyBucket`을 snapshot에 backfill하지 않는다. Universe manifest의 bucket metadata와 snapshot metadata는 research hash와 coverage에 보존되지만, packet candidate의 bucket source는 snapshot이다.

## Artifact 확인

현재 broad daily source의 snapshot과 symbol bucket 분포:

| Bucket | Snapshot count | Symbol count |
| --- | ---: | ---: |
| Missing | 160,953 | 192 |
| `long_term` | 5,867 | 7 |
| `swing` | 5,049 | 6 |
| `short_term` | 2,512 | 3 |
| `hedge` | 2,519 | 3 |
| `intraday` | 811 | 1 |

Liquidity stress `min-0.1` scenario의 partial fill 11건은 다음 7개 symbol에서 발생했고 모두 snapshot bucket이 없었다.

- `222800`
- `261220`
- `039030`
- `263750`
- `140860`
- `214150`
- `267260`

이 목록은 root-cause evidence이며 종목 추천이나 strategy 적합성 판단이 아니다.

## Root Cause

`strategyPreset=short_term`은 short-term cadence/risk/exit configuration을 선택했지만 broad source의 모든 screened candidate를 대상으로 deterministic decision을 만들었다. Broad source의 unique snapshot symbol 212개 중 192개는 bucket metadata가 없으므로 expansion candidate가 선택되면 trade는 `UNKNOWN`으로 남는다. Universe coverage의 available symbol 211개와 source unique symbol count는 같은 지표가 아니다.

따라서 원인은 report aggregation 오류가 아니라 preset과 candidate scope가 별도 contract인데 protocol 문구와 검증 해석이 이를 충분히 구분하지 않은 것이다.

## 금지하는 해결 방식

- Preset 이름을 모든 candidate, position 또는 trade의 bucket으로 강제 backfill하지 않는다.
- Bucket metadata가 없는 snapshot을 `short_term`으로 간주하지 않는다.
- AI decision output에 bucket 선택이나 bucket override 권한을 추가하지 않는다.
- Report에서 `UNKNOWN`을 preset bucket으로 표시만 바꾸지 않는다.
- 결과를 맞추기 위해 broad source fixture를 사후 편집하지 않는다.

이 방식들은 provenance를 숨기거나 전략별 비용·리스크 집계를 오염시킨다.

## 다음 구현 Contract

다음 구현 PR은 batch replay CLI에 opt-in `--candidate-strategy-bucket <bucket>`을 추가하는 범위로 제한한다.

### 입력 규칙

- 허용값은 `long_term`, `swing`, `short_term`, `intraday`, `hedge`다.
- `regime_cash`는 strategy bucket이 아니므로 허용하지 않는다.
- 값 누락, unknown 값, 빈 값은 replay 시작 전에 fail-closed로 거절한다.
- Option이 없으면 기존 broad candidate 동작을 유지한다.
- `--strategy-preset`과 값이 다른 candidate bucket을 명시하면 시작 전에 거절한다.
- `strategyPreset=regime_cash`와 candidate bucket scope를 함께 사용하면 시작 전에 거절한다.

### Candidate scope 규칙

- 새 매수 후보는 snapshot `strategyBucket`이 requested bucket과 정확히 일치하는 candidate만 허용한다.
- Bucket metadata가 없는 candidate는 scoped new-buy path에서 제외한다.
- 기존 held position의 mark-to-market, deterministic exit와 reconciliation에 필요한 snapshot은 candidate scope 때문에 숨기지 않는다.
- Held position을 requested bucket으로 재분류하지 않는다.
- Scope 적용 후 eligible new-buy candidate가 0이어도 held-position snapshot 또는 deterministic exit/reconciliation work가 있으면 replay를 계속하고 new buy만 만들지 않는다.
- Eligible new-buy candidate와 처리할 held-position snapshot 또는 exit/reconciliation work가 모두 0일 때만 broad universe로 fallback하지 않고 명시적 unavailable reason으로 종료한다.

### 책임 배치

- CLI layer는 option 값과 preset 조합을 검증한다.
- Historical packet/backend layer는 deterministic candidate scope를 적용한다.
- Decision provider는 scoped packet만 보고 proposal을 생성하며 scope를 변경할 수 없다.
- Risk Engine과 `PaperOrderEngine`은 기존 final gate와 execution 책임을 유지한다.

### Metadata와 hash

다음 artifact에 requested/effective candidate scope를 기록한다.

- batch manifest
- run metadata configuration
- replay research manifest config hash
- selection trial config와 candidate key

Scope가 다른 run은 같은 validation candidate로 합치지 않는다. Cost model hash는 execution policy가 같으면 유지하고 candidate scope는 config/candidate identity에서 분리한다.

## 테스트 조건

### 정상 흐름

- `--strategy-preset short_term --candidate-strategy-bucket short_term`에서 new-buy packet candidate가 모두 `short_term`이다.
- Scoped candidate의 bucket이 position과 trade에 보존된다.
- Matching new-buy candidate가 없어도 held position이 있으면 mark-to-market과 deterministic exit/reconciliation을 계속한다.
- Batch/run/selection metadata가 scope를 기록한다.
- 같은 input과 seed에서 scoped replay가 deterministic하다.

### Fail-closed 흐름

- 값 누락, 빈 값, schema 밖 bucket을 거절한다.
- preset과 candidate bucket mismatch를 거절한다.
- `regime_cash` 조합을 거절한다.
- Matching new-buy candidate와 held-position work가 모두 0이면 broad 또는 `UNKNOWN` candidate로 fallback하지 않고 unavailable로 종료한다.
- Metadata가 없는 candidate가 scoped trade로 생성되지 않는다.

### 호환성

- Option이 없는 기존 replay test와 output contract는 유지한다.
- Existing held position의 exit와 mark-to-market은 candidate scope에서도 유지한다.
- `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only` 기본 경계를 유지한다.

## 후속 검증 순서

1. 명시적 candidate strategy bucket CLI와 backend scope를 구현한다.
2. Targeted CLI, packet builder, held-position, metadata/hash 회귀 테스트를 실행한다.
3. Merge 후 `short_term` bucket scoped liquidity stress 계획을 별도 문서로 사전 고정한다.
4. Generated artifact는 `data/`에만 두고 결과 문서 PR에서 bucket 귀속과 fixture gate를 다시 판정한다.

이번 audit PR에서는 구현, replay 재실행, threshold 변경 또는 strategy 판정 변경을 하지 않는다.

## Safety Boundary

- Paper-only historical replay candidate scope만 계획한다.
- Live order, broker mutation, natural language order, `place_order` surface를 추가하지 않는다.
- Raw `codex exec` 또는 raw `tossctl` surface를 추가하지 않는다.
- AI는 candidate scope나 final sizing/gate를 결정하지 않는다.
- Deterministic backend와 Risk Engine이 최종 gate를 유지한다.
- 특정 종목, strategy winner, 실거래 parameter를 추천하지 않는다.
