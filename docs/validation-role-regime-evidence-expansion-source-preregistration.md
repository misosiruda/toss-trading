# Validation Role-Regime Evidence Expansion Source 사전 등록

## 목적

이 문서는 `short_term` evidence expansion preflight에 사용할 actual
expansion source contract를 결과 확인 전에 고정한다.

사전 등록 대상은 source provider와 path, 기간, universe, coverage policy,
validation split policy, preflight `generatedAt`과 temp output root다. 이
문서는 source 수집, coverage 또는 split artifact 생성, official calendar
ingestion, preflight 실행과 replay 실행을 수행하지 않는다.

Replay return, PnL, Sharpe, PSR, DSR, PBO, hit rate, drawdown, selection
score와 AI decision 결과는 입력으로 사용하지 않았다.

## 등록 Contract

| 항목 | 사전 등록 값 |
| --- | --- |
| 목적 | `short_term` paper-only evidence expansion preflight |
| Provider | Yahoo chart daily read-only ingestion |
| Source range | 2013-01-01T00:00:00+09:00부터 2022-12-31T23:59:59.999+09:00 |
| Snapshot directory | `data/replay-2013-01-2022-12-global-broad-yahoo-daily` |
| Snapshot file | `data/replay-2013-01-2022-12-global-broad-yahoo-daily/historical-market-snapshots.jsonl` |
| Ingest report | `data/replay-2013-01-2022-12-global-broad-yahoo-daily/historical-yahoo-ingest-report.json` |
| Universe source | `docs/historical-universe.global-broad.json` |
| Universe identity | `global-paper-broad-v1`, `snapshotDate=2026-06-17` |
| Coverage artifact | `data/replay-2013-01-2022-12-global-broad-yahoo-daily/historical-universe-coverage.json` |
| Validation split source | `tmp/validation-role-regime-evidence-expansion/03381bec-861a-49db-8c38-a871d0cee5d9/sources/expansion-validation-splits.json` |
| Preflight `generatedAt` | `2026-08-01T00:00:00.000Z` |
| Temp output root | `tmp/validation-role-regime-evidence-expansion/03381bec-861a-49db-8c38-a871d0cee5d9` |
| Preflight bundle path | `tmp/validation-role-regime-evidence-expansion/03381bec-861a-49db-8c38-a871d0cee5d9/preflight/source-bundle.json` |
| Preflight artifact path | `tmp/validation-role-regime-evidence-expansion/03381bec-861a-49db-8c38-a871d0cee5d9/preflight/preflight.json` |

모든 `data/`와 `tmp/` path는 gitignored local artifact path다. Directory
존재, 수정 시각 또는 file name만으로 provenance를 인정하지 않는다. Strict
schema와 canonical hash 검증을 통과한 payload만 source bundle에 포함한다.

2026-07-31 사전 등록 시점에 snapshot directory와 temp output root는 모두
존재하지 않는다.

## Source 선택 근거

Baseline source는 2023-01-01부터 2026-05-31 KST까지의 Yahoo daily
history다. 등록한 expansion range는 2022-12-31 KST에 끝나므로 baseline
interval과 겹치지 않는다. 두 range는 인접하므로 동일 market history의 serial
dependence가 없다고 해석하지 않으며 adjacency diagnostic을 유지한다.

Provider와 universe contract는 baseline과 같은 Yahoo daily 및
`global-paper-broad-v1`을 사용한다. 이는 provider 또는 universe 변경으로
생기는 추가 변수를 제한하기 위한 선택일 뿐, 두 source의 독립성이나 strategy
유효성을 뜻하지 않는다.

Universe의 `snapshotDate=2026-06-17`은 expansion range보다 늦으므로
survivorship 및 universe selection limitation을 유지한다. Historical
lifecycle metadata, coverage와 후속 selection-bias warning이 이 한계를
해소했다고 간주하지 않는다. 이 universe로 strict coverage를 충족하지
못하더라도 결과 확인 후 다른 universe로 교체하지 않는다.

현재 host의 TossInvest daily source는 2024-01-01부터 2026-06-17 KST까지로
baseline과 대부분 겹치고 저장된 coverage artifact에 strategy-bucket
coverage가 없다. 이 source는 이번 actual expansion input으로 등록하지
않는다.

## Coverage Policy

Coverage는 기존 global-broad daily contract를 낮추지 않고 다음 값으로
고정한다.

| 항목 | 값 |
| --- | ---: |
| `timezoneOffsetMinutes` | 540 |
| `minMonthlyCoverageRatio` | 1 |
| `minSnapshotsPerSymbol` | 1 |
| `minAvailableSymbolCount` | 120 |
| `requiredMarkets` | `KR`, `US` |
| `requiredAssetTypes` | `STOCK`, `ETF` |
| `requiredStrategyBuckets` | `long_term`, `swing`, `short_term`, `intraday`, `hedge` |
| `minAvailableMarketSymbolCounts` | `KR:50`, `US:50` |
| `minAvailableAssetTypeSymbolCounts` | `STOCK:80`, `ETF:30` |
| `minAvailableStrategyBucketSymbolCounts` | 각 bucket 1 |
| `requireOptionalSymbols` | `false` |
| `corruptLineCount` | 0 |

Coverage가 `available`이 아니거나 `short_term` bucket이 unavailable이면
source pair와 preflight artifact를 생성하지 않는다. 실제 확보량에 맞춰
minimum, range 또는 universe를 사후 변경하지 않는다.

## Validation Split Policy

Expansion split은 다음 단일 `walk_forward` plan으로 고정한다.

| 항목 | 값 |
| --- | ---: |
| `rangeStart` | `2012-12-31T15:00:00.000Z` |
| `rangeEnd` | `2022-12-31T14:59:59.999Z` |
| `trainMonths` | 40 |
| `validationMonths` | 40 |
| `testMonths` | 40 |
| `stepMonths` | 120 |
| `timezoneOffsetMinutes` | 540 |
| `purgeDurationDays` | 0 |
| `embargoDurationDays` | 5 |
| `splitCount` | 1 |

Expected split identity와 boundary는 다음과 같다.

```text
splitId:
  wf_001_train_2013-01-01_2016-04-30_validation_2016-05-01_2019-08-31_test_2019-09-01_2022-12-31

train:
  2012-12-31T15:00:00.000Z
  2016-04-30T14:59:59.999Z

validation:
  2016-04-30T15:00:00.000Z
  2019-08-31T14:59:59.999Z

test:
  2019-08-31T15:00:00.000Z
  2022-12-31T14:59:59.999Z
```

세 role의 raw boundary는 서로 겹치지 않는다. 각 role의 40개월은
`roleRegimeSampleMinimum=8`과 네 regime에 필요한 최소 32개보다 큰
structural candidate range를 제공한다. 이는 calendar, embargo, coverage,
scope, regime distribution과 deduplication 전의 상한일 뿐이다. 실제
role-local, role-exclusive 또는 role-regime capacity 충족을 주장하지
않는다.

## 등록 실행 명령

다음 명령은 후속 실행에서 이 contract 그대로 사용한다. 이번 문서 PR에서는
실행하지 않는다.

```bash
npm run historical:yahoo:ingest -- -- --data-dir data/replay-2013-01-2022-12-global-broad-yahoo-daily --universe-path docs/historical-universe.global-broad.json --range-start 2013-01-01T00:00:00+09:00 --range-end 2022-12-31T23:59:59.999+09:00 --allow-partial --json

npm run historical:universe:coverage -- -- --data-dir data/replay-2013-01-2022-12-global-broad-yahoo-daily --universe-path docs/historical-universe.global-broad.json --range-start 2013-01-01T00:00:00+09:00 --range-end 2022-12-31T23:59:59.999+09:00 --min-monthly-coverage-ratio 1 --min-snapshots-per-symbol 1 --require-markets 'KR,US' --require-asset-types 'STOCK,ETF' --require-strategy-buckets 'long_term,swing,short_term,intraday,hedge' --min-available-symbols 120 --min-available-market-symbols 'KR:50,US:50' --min-available-asset-type-symbols 'STOCK:80,ETF:30' --min-available-strategy-bucket-symbols 'long_term:1,swing:1,short_term:1,intraday:1,hedge:1' --output-path data/replay-2013-01-2022-12-global-broad-yahoo-daily/historical-universe-coverage.json

npm run historical:validation:splits -- -- --range-start 2013-01-01T00:00:00+09:00 --range-end 2022-12-31T23:59:59.999+09:00 --train-months 40 --validation-months 40 --test-months 40 --step-months 120 --timezone-offset-minutes 540 --embargo-duration-days 5 --output-path tmp/validation-role-regime-evidence-expansion/03381bec-861a-49db-8c38-a871d0cee5d9/sources/expansion-validation-splits.json
```

`historical:validation:splits` CLI의 `generatedAt`은 실행 시각을 기록하지만
split hash는 strict-validated assignment payload에서 별도로 계산한다.
Preflight CLI에는 사전 등록한
`2026-08-01T00:00:00.000Z`를 명시적으로 전달해야 한다.

## Fail-Closed Gate

- Source path가 없거나 snapshot JSONL이 empty 또는 corrupt이면 중단한다.
- Ingest range, provider 또는 universe identity가 등록값과 다르면 중단한다.
- Coverage policy 또는 recomputed coverage artifact가 등록값과 다르면
  중단한다.
- Coverage status가 `available`이 아니면 threshold를 낮추지 않고 중단한다.
- Split policy, assignment boundary 또는 canonical split hash가 등록 contract와
  다르면 중단한다.
- Existing temp output root 또는 output path가 있으면 덮어쓰지 않는다.
- Official-derived calendar fixture가 준비되지 않았거나 baseline chain과
  `calendarHash`가 다르면 preflight를 실행하지 않는다.
- Preflight `generatedAt` 또는 output root를 변경해야 하면 결과를 확인하기
  전에 별도 문서 PR로 다시 등록한다.
- Capacity가 target을 충족하지 못하면 source range, split duration, target
  또는 classifier threshold를 사후 조정하지 않고 `inconclusive`를 유지한다.

## Non-Goals

- Source 수집, coverage 또는 validation split artifact 생성
- Official calendar ingestion 또는 fixture 생성
- Baseline feasibility, plan, replay 또는 readiness chain 재생성
- Preflight source bundle 또는 artifact 생성
- Expanded replay 실행, strategy metric 계산 또는 유효성 판정
- 특정 종목 추천, 투자 조언 또는 수익 보장
- Live order, broker mutation, natural language order, raw `codex exec`, raw
  `tossctl`, `place_order` surface 추가
- Deterministic backend 또는 Risk Engine 우회

AI는 decision/evidence provider에만 머물며 final sizing과 gate는
deterministic backend와 Risk Engine이 담당한다.
