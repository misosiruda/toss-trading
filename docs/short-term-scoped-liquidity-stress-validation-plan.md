# Short-Term Scoped Liquidity Stress Validation 계획

이 문서는 `short_term` candidate scope가 적용된 paper-only historical replay에서 liquidity participation cap과 minimum fill gate를 다시 검증하기 위한 사전 고정 계획이다.

이 검증은 특정 종목 판단, 투자 조언, 성과 보장 또는 live trading signal이 아니다. Scenario ratio는 deterministic execution contract를 확인하기 위한 synthetic paper fixture이며 실제 시장 체결 가능성이나 실거래 parameter를 나타내지 않는다.

## 검증 배경

[Short-Term Liquidity Stress Validation 결과](short-term-liquidity-stress-results.md)의 기존 3개 scenario는 liquidity execution fixture gate를 충족했다. 그러나 partial fill 11건과 9건이 모두 `UNKNOWN` strategy bucket에 귀속됐고 `short_term` bucket partial fill은 0이었다.

[Strategy Preset Candidate Scope Audit](strategy-preset-candidate-scope-audit.md)에 따라 preset과 candidate universe가 별도 contract임을 확인했고, 이후 deterministic backend와 CLI에 explicit candidate scope가 추가됐다. 따라서 기존 broad run을 strategy evidence로 재해석하지 않고 같은 liquidity scenario를 `short_term` candidate로 제한해 새 artifact로 실행해야 한다.

## 검증 질문

- Batch manifest, run metadata, research config hash와 selection trial이 모두 `candidateStrategyBucket=short_term`을 기록하는가?
- New-buy candidate와 generated trade가 `short_term` bucket에만 귀속되고 missing 또는 다른 bucket으로 fallback하지 않는가?
- 같은 scoped assignment에서 participation cap이 partial fill과 `VIRTUAL_LIQUIDITY_INSUFFICIENT` no-fill을 만드는가?
- 같은 cap에서 minimum fill ratio를 높이면 낮은 fill-ratio proposal이 fail-closed no-fill로 전환되는가?
- Scope 적용 후 stress event가 없을 때 결과를 유리하게 만들기 위한 broad fallback이나 threshold 변경 없이 `inconclusive`로 닫는가?

## 범위

포함:

- `short_term` candidate scope가 적용된 control 및 2개 liquidity stress scenario
- 기존 walk-forward assignment 9개의 parity 검증
- Candidate, trade, metadata, hash와 selection identity provenance 검증
- Partial fill, no-fill, modeled liquidity와 split-role 분포 검증
- Generated artifact를 기반으로 한 별도 결과 문서

포함하지 않음:

- 다른 strategy bucket 실행
- Codex 또는 다른 AI decision provider 사용
- Threshold 탐색, scenario 추가 또는 결과 기반 parameter 조정
- 실제 spread, order book depth, queue position 또는 opportunity cost modeling
- Strategy winner 선택, 실거래 적용 또는 기존 `inconclusive` 판정 승격
- Live order, broker mutation 또는 운영 배포

## 고정 입력

| 항목 | 값 |
| --- | --- |
| Preset | `short_term` |
| Candidate scope | `short_term` |
| Provider | `deterministic_fixture` |
| Assignment | scenario별 9, train/validation/test 각 3 |
| Source | `data/replay-2023-01-2026-05-global-broad-yahoo-daily` |
| Universe | `docs/historical-universe.global-broad.json` |
| Coverage | `data/replay-2023-01-2026-05-global-broad-yahoo-daily/historical-universe-coverage.json` |
| Validation splits | `data/validation-splits/strategy-bucket-validation-assignments.json` |
| Range | `2023-01-01T00:00:00+09:00` to `2026-05-31T23:59:59.999+09:00` |
| Seed | `short-term-scoped-liquidity-20260720-001` |
| Fee | 10 bps |
| Tax | 20 bps |
| Slippage | 5 bps |
| Half-spread | 0 bps |
| Market impact coefficient | 5,000 |
| Safety | `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=false` |

현재 coverage artifact에는 available symbol 211개와 `short_term` symbol 3개가 기록돼 있다. 이 값은 실행 가능성 preflight 기준이며 표본 충분성 또는 strategy 유효성 근거가 아니다.

## 사전 고정 Scenario

| Scenario | Max participation | Minimum fill ratio | 의도 |
| --- | ---: | ---: | --- |
| `control` | 0.1 | 0.1 | Scoped default liquidity policy control |
| `cap-1e-5-min-0.1` | 0.00001 | 0.1 | 낮은 cap의 partial fill 및 extreme participation no-fill 관측 |
| `cap-1e-5-min-0.5` | 0.00001 | 0.5 | 같은 cap에서 minimum fill gate 강화 효과 격리 |

Scenario 수치와 assignment는 결과 확인 후 변경하지 않는다. Fixture gate가 충족되지 않으면 이 실행을 `invalid` 또는 `inconclusive`로 기록하고, 다른 threshold가 필요하면 별도 사전 계획 PR을 작성한다.

## 실행 전 Gate

다음 조건 중 하나라도 충족하지 않으면 batch replay를 시작하지 않는다.

- `npm run check`가 통과한다.
- Source snapshot file, universe, coverage, validation split file이 모두 존재한다.
- Coverage status가 `available`이고 corrupt line이 0이다.
- Coverage의 `short_term` available symbol count가 3 이상이다.
- Validation split은 assignment 9개이며 train/validation/test가 각각 3개다.
- Source date range가 모든 assignment window를 포함한다.
- 새 batch ID의 output directory가 존재하지 않는다.
- Environment safety 값이 고정값과 일치한다.

Coverage나 scoped snapshot이 부족하면 `UNKNOWN` 또는 broad candidate로 fallback하지 않는다. 기존 output directory가 있으면 삭제하거나 덮어쓰지 않고 새 계획을 고정한다.

## Scope Provenance Gate

Scenario 결과를 liquidity metric보다 먼저 다음 순서로 검증한다.

1. Batch manifest의 `strategyPreset`과 `candidateStrategyBucket`이 모두 `short_term`이다.
2. 9개 run metadata configuration의 `candidateStrategyBucket`이 모두 `short_term`이다.
3. Selection trial 9개의 config와 candidate identity가 `short_term` scope를 기록한다.
4. Buy-eligible packet candidate는 모두 `strategyBucket=short_term`이다.
5. 모든 generated buy trade와 신규 position은 `strategyBucket=short_term`이다.
6. `UNKNOWN`, missing 또는 다른 bucket의 new-buy trade가 0이다.
7. Partial fill trade는 모두 `short_term`에 귀속되고, no-fill risk decision의 symbol은 scoped candidate 또는 scoped position으로 연결된다.
8. Scenario별 assignment ID, split role, window, data/universe/coverage/prompt/schema/risk hash가 일치한다.
9. Candidate scope가 config input과 selection identity에 포함되며, 같은 assignment의 기존 broad run과 scoped run은 `configHash`로 구분된다.

Window와 execution policy가 다르면 `configHash`도 달라지므로 scenario 전체의 exact hash equality를 요구하지 않는다. 비교는 같은 assignment와 의도적으로 고정한 input 단위로 수행한다.

하나라도 위반하면 liquidity event 수와 관계없이 scoped fixture를 `invalid`로 판정한다. Held-position-only candidate가 존재하면 sell-only provenance를 별도로 확인하며 이를 new-buy scope 위반으로 집계하지 않는다.

## Liquidity Fixture Gate

Scope provenance gate를 통과한 뒤 다음 조건으로 execution fixture를 판정한다.

### `valid`

- 모든 scenario가 completed 9, skipped 0, failed 0이다.
- `control`의 partial fill과 `VIRTUAL_LIQUIDITY_INSUFFICIENT`가 0이다.
- `cap-1e-5-min-0.1`에서 scoped partial fill과 no-fill이 각각 1건 이상 발생한다.
- `cap-1e-5-min-0.5`의 scoped no-fill이 `cap-1e-5-min-0.1`보다 적지 않다.
- 모든 scenario의 `notModeledLiquidityCount`가 0이다.

### `inconclusive`

- Scope provenance와 실행 무결성은 통과했지만 stress scenario에 scoped partial fill 또는 no-fill이 없다.
- Stress event가 특정 split role에만 있어 다른 role로 일반화할 수 없다.
- Scoped symbol 또는 event 수가 결과 해석에 충분하지 않다.

### `invalid`

- Scope provenance가 깨진다.
- Failed/skipped run, provider failure 또는 assignment parity 위반이 있다.
- Volume 부재로 liquidity가 `not_modeled`된다.
- Broad, missing 또는 다른 bucket new-buy trade가 생성된다.
- 결과 확인 후 threshold, source, assignment 또는 scenario를 변경한다.

`valid`는 scoped deterministic liquidity execution fixture에만 적용한다. 이 판정만으로 `short_term` strategy의 기존 `inconclusive` 판정을 변경하지 않는다.

## 측정 항목

### 실행 및 provenance

- completed, skipped, failed count
- assignment ID, split role와 window parity
- batch/run/selection candidate scope
- config, data snapshot, universe, coverage, prompt, schema, risk policy와 cost model hash
- packet candidate와 trade의 strategy bucket 분포
- no-fill risk decision symbol의 scoped candidate/position 연결
- AI/provider failure count

### Liquidity path

- full fill, partial fill과 `VIRTUAL_LIQUIDITY_INSUFFICIENT` count
- requested notional, filled notional과 fill ratio 분포
- maximum participation rate
- `notModeledLiquidityCount`
- train/validation/test별 partial fill과 no-fill 분포

### 부수 지표

- trade와 meaningful reject count
- fee, tax, slippage, spread, impact와 total cost
- split role별 paper return, cash, exposure와 max drawdown

Return과 cost는 path 변화 확인용 부수 metric이다. Scenario 우열, 향후 성과 또는 parameter 선택 근거로 사용하지 않는다.

## 실행 절차

Generated artifact는 `data/batch-replay/` 아래에만 저장하고 commit하지 않는다.

```powershell
$env:BROKER_PROVIDER = "mock"
$env:TRADING_ENABLED = "false"
$env:AI_DECISION_MODE = "paper_only"
$env:AI_DECISION_ENABLED = "false"

$SourceDataDir = "data/replay-2023-01-2026-05-global-broad-yahoo-daily"
$OutputDir = "data/batch-replay"
$UniversePath = "docs/historical-universe.global-broad.json"
$CoveragePath = "$SourceDataDir/historical-universe-coverage.json"
$ValidationSplitsPath = "data/validation-splits/strategy-bucket-validation-assignments.json"
$RangeStart = "2023-01-01T00:00:00+09:00"
$RangeEnd = "2026-05-31T23:59:59.999+09:00"
$Seed = "short-term-scoped-liquidity-20260720-001"

npm run check

$Scenarios = @(
  @{ Name = "control"; BatchSlug = "control"; MaxParticipation = 0.1; MinFill = 0.1 },
  @{ Name = "cap-1e-5-min-0.1"; BatchSlug = "cap-1e-5-min-0_1"; MaxParticipation = 0.00001; MinFill = 0.1 },
  @{ Name = "cap-1e-5-min-0.5"; BatchSlug = "cap-1e-5-min-0_5"; MaxParticipation = 0.00001; MinFill = 0.5 }
)

foreach ($Scenario in $Scenarios) {
  $BatchId = "short-term-scoped-liquidity-$($Scenario.BatchSlug)-20260720-001"
  $BatchDir = "$OutputDir/$BatchId"
  if (Test-Path -LiteralPath $BatchDir) {
    throw "output directory already exists: $BatchDir"
  }

  node dist/cli/historicalBatchReplay.js --source-data-dir $SourceDataDir --output-dir $OutputDir --batch-id $BatchId --seed $Seed --runs 9 --random-window-from $RangeStart --random-window-to $RangeEnd --strategy-preset short_term --candidate-strategy-bucket short_term --universe-path $UniversePath --window-sampling balanced_regime --target-regimes "bull,bear,sideways,mixed" --validation-splits-path $ValidationSplitsPath --paper-fee-bps 10 --paper-tax-bps 20 --paper-slippage-bps 5 --paper-half-spread-bps 0 --paper-market-impact-bps-per-participation-rate 5000 --paper-max-volume-participation-rate $Scenario.MaxParticipation --paper-min-liquidity-fill-ratio $Scenario.MinFill

  node dist/cli/historicalBatchReport.js --runs-path "$BatchDir/batch-replay-runs.jsonl" --universe-coverage-path $CoveragePath --expected-sampled-cpcv-split-count 9 --output-path "$BatchDir/batch-replay-aggregate-report.json"
}
```

`--use-codex-ai`는 사용하지 않는다. Batch ID에는 filesystem path 정규화에 의존하는 `.`을 넣지 않는다.

## Artifact 경계

결과 확인 대상:

- `batch-replay-manifest.json`
- `batch-replay-runs.jsonl`
- `selection-trials.jsonl`
- `batch-replay-aggregate-report.json`
- 각 run의 metadata, packet, trade, risk decision과 research manifest artifact

Repository에 포함할 결과 PR 범위:

- 별도 Markdown 결과 문서
- 필요하면 기존 audit 문서의 후속 단계 문구

Repository에 포함하지 않을 범위:

- `data/batch-replay/` generated artifact
- Raw account, broker, execution 또는 secret data
- Threshold나 strategy implementation 변경

## 결과 문서 필수 항목

- 실제 commit, 명령과 environment safety 값
- Source, universe, coverage와 validation split preflight 결과
- Scenario별 batch/run/selection scope provenance
- Assignment 및 hash parity
- Scoped bucket candidate/trade 분포
- Partial fill, no-fill과 modeled liquidity 결과
- `valid`, `inconclusive` 또는 `invalid` gate 판정
- 기존 broad 결과와 직접 성과 비교하지 않는 이유
- Generated artifact가 commit되지 않았는지 여부
- 미검증 항목과 다음 단계

## Safety Boundary

- Paper-only historical replay만 실행한다.
- Live order, broker mutation, natural language order 또는 `place_order`를 추가하거나 실행하지 않는다.
- Raw `codex exec` 또는 raw `tossctl` surface를 추가하거나 실행하지 않는다.
- AI provider를 사용하지 않으며 AI에 candidate scope, sizing 또는 gate 책임을 부여하지 않는다.
- Deterministic backend와 Risk Engine이 final sizing과 risk gate를 유지한다.
- Stress ratio를 실제 liquidity 또는 향후 체결 품질로 일반화하지 않는다.
- 특정 종목, strategy winner, 실거래 parameter 또는 예상 수익을 제시하지 않는다.

## 후속 범위

이 계획 문서가 merge된 뒤 별도 PR에서만 3개 scenario를 실행하고 결과를 기록한다. 실행 결과를 확인하기 전에는 scenario, gate 또는 해석 규칙을 변경하지 않는다.
