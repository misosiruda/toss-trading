# Validation Split Role-Local Regime Feasibility 결과

이 문서는 [Validation Split Role-Local Regime Feasibility 계획](validation-split-regime-feasibility-plan.md)에 사전 고정한 입력으로 실행한 paper-only deterministic preflight 결과를 기록한다.

이 결과는 replay 성과, strategy 유효성, 특정 종목 판단, 투자 조언 또는 예상 수익의 근거가 아니다. Generated fixture와 artifact는 `data/validation-feasibility/`에만 보관하며 PR에는 포함하지 않는다.

## 검증 범위

| 항목 | 값 |
| --- | --- |
| 실행 commit | `aa0aebe0f8ba89e025b63aff311cdb8c9cbd11dc` |
| Mode | `paper_only` |
| Source snapshot | `data/replay-2023-01-2026-05-global-broad-yahoo-daily/historical-market-snapshots.jsonl` |
| Universe | `docs/historical-universe.global-broad.json` |
| Coverage | `data/replay-2023-01-2026-05-global-broad-yahoo-daily/historical-universe-coverage.json` |
| Validation split | `data/validation-splits/strategy-bucket-validation-assignments.json` |
| Calendar fixture | `data/validation-feasibility/observed-session-calendar-fixtures.json` |
| Output artifact | `data/validation-feasibility/short-term-role-regime-feasibility.json` |
| Candidate scope | `short_term` |
| Window | 1개월 |
| Timezone offset | 540분 |
| Target regimes | `bull`, `bear`, `sideways`, `mixed` |
| Minimum candidates | role-regime 조합별 1 |
| Safety | `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=false` |

Provider, risk profile, execution policy 또는 order option은 사용하지 않았다. Replay, signal 생성, sizing, broker 접근과 주문 경로는 실행하지 않았다.

## Source와 Hash

Filesystem SHA-256:

| Input / artifact | SHA-256 |
| --- | --- |
| Snapshot JSONL | `sha256:19f454aadc2cc00b1bca7d34ffc651a9278359519ccf6d2361b0c3d3760ce92e` |
| Universe JSON | `sha256:98aa2626d533e327c5938e97dcd3cdfcbe31c23222f718be976e9d0214fab4fc` |
| Coverage JSON | `sha256:e54abf4d88e31cb67cbb9a9deddec8e063839190bc870b889ffcbd3dff17c69c` |
| Validation split JSON | `sha256:c97a37d3b6c16b53c651d92e077596adc423bfc70407042a714f36f7799e58c7` |
| Calendar fixture JSON | `sha256:571363e78a2601a7711bb7b7f85d35f1fa075d55ae11b2b20eaee888a43e7fff` |
| Feasibility artifact JSON | `sha256:b099eaa253f43ebc8390e4fb1d4dec1bb1e19c2725532c2a4f27f87f7d247744` |

Artifact canonical provenance:

| Provenance field | Hash |
| --- | --- |
| `dataSnapshotHash` | `sha256:4decee7783560e1740ea93189ac061d7cc8f09cdd01cc8d9ffa3aede2b555623` |
| `universeHash` | `sha256:e5f2d120e9ca70d5839e503f9ebfd3537786935ebc97aa9b7a7b17eab9f21b4b` |
| `coverageHash` | `sha256:d8e4f9ba1efeebbf8ba4d1a247e67bb88c6eba8e137001331d7fca742f9a6114` |
| `validationSplitHash` | `sha256:4ab0f093ebd60843ed6c87dd47339b81243eba8e729cd82847ba4be84dff42d4` |
| `calendarHash` | `sha256:1500fbb78d5b439381ade50973ae81be44c1472f57eccc0a2f8bbfd4d5b11e96` |
| `marketRegimeClassifierHash` | `sha256:f1a60e8cd9c3412fd4d956d2190da8dc52863ada3e36fcf25ba6d35ea2133f23` |

Filesystem hash는 raw file byte를 식별하고 artifact provenance hash는 schema validation과 canonical normalization 이후의 contract input을 식별하므로 서로 같은 값일 필요가 없다.

## Calendar Fixture 근거와 한계

저장된 calendar fixture가 없었으므로 snapshot JSONL의 관측 session date를 기준으로 schema-valid observed-session fixture를 생성했다.

- Snapshot 177,711개에서 market과 `observedAt` local date 조합을 deduplicate했다.
- KR 830개, US 854개로 총 1,684개 fixture를 생성했다.
- 같은 market/session date의 모든 snapshot이 동일한 `observedAt`을 가지는지 확인했다.
- `marketOpen`은 저장된 daily snapshot의 `observedAt`, `marketClose`는 그 시각부터 6시간 30분 뒤로 고정했다.
- 각 `sourceRefs`는 snapshot file SHA-256, market과 session date를 포함한다.
- `createdAt`은 결과 확인 전에 `2026-07-21T00:00:00.000Z`로 고정했다.

이 fixture는 snapshot이 존재하는 날짜와 timestamp의 session mapping만 검증한다. 공식 KRX/NYSE calendar와 독립적으로 holiday, 누락 trading date 또는 early close를 검증하지 않는다. 따라서 `calendarRejectedCandidateCount=0`은 공식 exchange calendar 정합성 증명이 아니며, 공식 calendar fixture를 확보하면 다른 `calendarHash`로 preflight를 다시 실행해야 한다.

## Effective Config

| 항목 | 값 |
| --- | --- |
| Calendar rules | `KR:KRX:Asia/Seoul`, `US:NYSE:America/New_York` |
| Classifier version | `market_regime_classifier.v1` |
| `minSymbols` | 1 |
| `minSnapshotsPerSymbol` | 2 |
| Bull threshold | 0.03 |
| Bear threshold | -0.03 |
| Sideways absolute threshold | 0.01 |
| Breadth threshold | 0.6 |

Classifier threshold, minimum, target regime, candidate scope와 role-regime minimum은 결과를 본 뒤 변경하지 않았다.

## Preflight 판정

| 항목 | 결과 |
| --- | --- |
| Schema | `validation_split_regime_feasibility.v1` |
| Status | `available` |
| Assignment | 9개 |
| Role assignment | train 3, validation 3, test 3 |
| Candidate rows | 96 |
| Global unique candidates | 39 |
| Boundary violation | 0 |
| Embargo violation | 0 |
| Unavailable role-regime | 0 |
| Artifact warning | 0 |

`available`은 세 role aggregate에 네 target regime의 candidate가 최소 1개씩 존재한다는 뜻이다. Candidate를 선택하거나 replay한 결과가 아니며, sample 수가 통계적으로 충분하다는 뜻도 아니다.

## Role Aggregate

| Role | Assignment | Structural capacity | Unique candidate | Bull | Bear | Sideways | Mixed | Insufficient data | Max pairwise overlap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 3 | 29 | 29 | 9 | 1 | 5 | 14 | 0 | 0 |
| Validation | 3 | 12 | 12 | 6 | 1 | 2 | 3 | 0 | 0 |
| Test | 3 | 9 | 9 | 5 | 1 | 2 | 1 | 0 | 0 |

모든 role aggregate가 `bull`, `bear`, `sideways`, `mixed`를 각각 1개 이상 포함해 `capacityStatus=sufficient`로 판정됐다. Bear는 각 role에 1개뿐이고 test의 mixed도 1개뿐이므로 threshold를 2 이상으로 바꾸면 현재 결과는 `insufficient`가 된다.

## Assignment 진단

| Split | Role | Capacity | Bull | Bear | Sideways | Mixed | Calendar reject | Scope unavailable | Assignment-local unavailable |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 0 | Train | 23 | 8 | 0 | 4 | 11 | 0 | 0 | bear |
| 0 | Validation | 6 | 2 | 1 | 0 | 3 | 0 | 0 | sideways |
| 0 | Test | 3 | 3 | 0 | 0 | 0 | 0 | 0 | bear, sideways, mixed |
| 1 | Train | 23 | 7 | 0 | 5 | 11 | 0 | 0 | bear |
| 1 | Validation | 6 | 4 | 0 | 0 | 2 | 0 | 0 | bear, sideways |
| 1 | Test | 3 | 1 | 0 | 2 | 0 | 0 | 0 | bear, mixed |
| 2 | Train | 23 | 6 | 1 | 5 | 11 | 0 | 0 | 없음 |
| 2 | Validation | 6 | 4 | 0 | 2 | 0 | 0 | 0 | bear, mixed |
| 2 | Test | 3 | 1 | 1 | 0 | 1 | 0 | 0 | sideways |

Assignment 하나가 네 regime을 모두 포함하지 않는 경우가 많다. `available` 판정은 같은 role의 세 assignment candidate를 합치고 `candidateHash`로 deduplicate한 aggregate에만 적용된다. 후속 replay selection은 이 결과를 split 경계 무시 또는 assignment 간 performance 합산 근거로 사용하면 안 된다.

## Rejection과 Overlap

- Calendar rejected candidate: 0
- `short_term` scope unavailable candidate: 0
- Boundary violation: 0
- Embargo violation: 0
- Role별 `maximumPairwiseOverlapRatio`: 모두 0

이번 1개월 full-window candidate는 같은 role aggregate 안에서 local trading date가 겹치지 않았다. 그러나 overlap 0은 candidate return의 통계적 독립성을 증명하지 않는다. Candidate는 같은 symbol universe와 연속된 market history를 공유하며 serial dependence, regime persistence와 selection dependence를 별도로 검증하지 않았다.

## Determinism 확인

같은 source/config를 별도 output path로 다시 실행했다. 두 artifact는 `generatedAt`만 달랐고 이를 제외한 전체 JSON payload가 일치했다. Exit-check 실행은 exit code 0으로 종료됐다.

| 실행 | `generatedAt` |
| --- | --- |
| 최초 artifact | `2026-07-21T04:50:15.154Z` |
| Exit-check artifact | `2026-07-21T05:01:41.276Z` |

검증용 두 번째 artifact와 실행 log는 비교 후 삭제했다.

## 실행 명령

Windows PowerShell에서 package script option을 보존하기 위해 npm delimiter 뒤에 literal `--`를 하나 더 전달했다.

```powershell
$env:BROKER_PROVIDER = "mock"
$env:TRADING_ENABLED = "false"
$env:AI_DECISION_MODE = "paper_only"
$env:AI_DECISION_ENABLED = "false"

npm run historical:validation:regime-feasibility -- -- --source-data-dir data/replay-2023-01-2026-05-global-broad-yahoo-daily --universe-path docs/historical-universe.global-broad.json --coverage-path data/replay-2023-01-2026-05-global-broad-yahoo-daily/historical-universe-coverage.json --validation-splits-path data/validation-splits/strategy-bucket-validation-assignments.json --calendar-fixtures-path data/validation-feasibility/observed-session-calendar-fixtures.json --calendar-rule KR:KRX:Asia/Seoul --calendar-rule US:NYSE:America/New_York --candidate-strategy-bucket short_term --window-months 1 --timezone-offset-minutes 540 --target-regimes "bull,bear,sideways,mixed" --min-candidates-per-role-regime 1 --output-path data/validation-feasibility/short-term-role-regime-feasibility.json
```

단일 delimiter로 실행한 최초 시도에서는 npm이 option 이름을 제거해 CLI가 positional argument를 거부했고 artifact는 생성되지 않았다. 위 command로 수정한 뒤에만 결과 artifact를 생성했다.

## Safety 확인

| 항목 | 결과 |
| --- | --- |
| Live order / broker mutation | 실행하거나 추가하지 않음 |
| Natural language order / `place_order` | 실행하거나 추가하지 않음 |
| Raw `codex exec` / raw `tossctl` | 실행하거나 추가하지 않음 |
| Provider / AI decision | 사용하지 않음 |
| Final sizing / Risk Engine | 변경 없음 |
| Generated fixture commit | 없음 |
| Generated feasibility artifact commit | 없음 |

## 결론과 다음 단계

고정한 minimum 1 기준에서는 role-local regime feasibility가 `available`이다. 따라서 계획의 다음 단계인 별도 role-local replay selection 계획을 작성할 수 있다.

다음 계획은 candidate의 원래 split ID와 role을 보존하고, assignment 간 결과를 독립 sample처럼 합치지 않으며, bear와 test mixed의 단일 candidate 의존성을 명시해야 한다. 공식 exchange calendar, holiday/early-close 독립 검증, replay 성과, Sharpe/PBO readiness와 strategy 유효성은 이번 결과에서 확인되지 않았다.
