# Validation Role-Regime Replay Smoke Results

이 문서는 `validation_role_regime_replay_plan.v1`을 deterministic fixture provider로 실행한 2026-07-22 paper-only smoke 결과를 기록한다. 검증 대상은 ready plan 재생성, exact-window batch workflow 연결, provenance 보존, selection trial과 aggregate report 생성이다.

이 결과는 workflow plumbing 검증이다. 특정 전략, 종목 또는 투자 행동을 추천하지 않으며 전략 유효성, 수익성 또는 실거래 적합성을 증명하지 않는다.

## 실행 범위

| 항목 | 값 |
| --- | --- |
| Mode | `paper_only` |
| Provider | `deterministic_fixture` |
| Strategy preset | `short_term` |
| Source data | `data/replay-2023-01-2026-05-global-broad-yahoo-daily` |
| Universe | `docs/historical-universe.global-broad.json` |
| Feasibility | `data/validation-feasibility/short-term-role-regime-feasibility.json` |
| Validation split | `data/validation-splits/strategy-bucket-validation-assignments.json` |
| Calendar fixture | `data/validation-feasibility/observed-session-calendar-fixtures.json` |
| Batch ID | `validation-role-regime-plan-smoke-20260722-001` |
| Generated artifacts | local temp directory, not committed |

Safe runtime boundary:

```powershell
$env:BROKER_PROVIDER = "mock"
$env:TRADING_ENABLED = "false"
$env:AI_DECISION_MODE = "paper_only"
```

`--use-codex-ai`는 사용하지 않았다. Live order, broker mutation, natural language order, raw `codex exec`, raw `tossctl`, `place_order` surface는 실행하거나 추가하지 않았다. Final sizing과 gate는 기존 deterministic backend와 Risk Engine 경계를 유지했다.

## 실행 명령

Ready plan은 temp path에 재생성했다. 아래 재현 명령은 npm version별 argument forwarding 차이를 피하기 위해 build 후 CLI entrypoint를 직접 호출한다.

```powershell
$RunToken = [guid]::NewGuid().ToString("N")
$Root = Join-Path $env:TEMP "toss-role-regime-smoke-$RunToken"
New-Item -ItemType Directory -Path $Root | Out-Null
$PlanPath = Join-Path $Root "short-term-role-regime-replay-plan.json"

npm run build
node dist/cli/validationRoleRegimeReplayPlan.js --feasibility-path data/validation-feasibility/short-term-role-regime-feasibility.json --source-data-dir data/replay-2023-01-2026-05-global-broad-yahoo-daily --universe-path docs/historical-universe.global-broad.json --coverage-path data/replay-2023-01-2026-05-global-broad-yahoo-daily/historical-universe-coverage.json --validation-splits-path data/validation-splits/strategy-bucket-validation-assignments.json --calendar-fixtures-path data/validation-feasibility/observed-session-calendar-fixtures.json --selection-policy exhaustive_role_regime_candidates.v1 --calendar-evidence-class observed_session_only --output-path $PlanPath
```

Plan의 50개 ordered run은 weekly replay step과 run별 decision call 상한 1로 실행했다.

```powershell
$OutputDir = Join-Path $Root "batch-replay"

node dist/cli/historicalBatchReplay.js --source-data-dir data/replay-2023-01-2026-05-global-broad-yahoo-daily --output-dir $OutputDir --batch-id validation-role-regime-plan-smoke-20260722-001 --seed validation-role-regime-plan-smoke-20260722-001 --strategy-preset short-term --validation-role-regime-plan-path $PlanPath --universe-path docs/historical-universe.global-broad.json --coverage-path data/replay-2023-01-2026-05-global-broad-yahoo-daily/historical-universe-coverage.json --calendar-fixtures-path data/validation-feasibility/observed-session-calendar-fixtures.json --calendar-rule KR:KRX:Asia/Seoul --calendar-rule US:NYSE:America/New_York --decision-frequency once_per_week --max-decision-calls 1 --step-seconds 604800 --max-snapshot-age-seconds 2678400 --min-window-snapshots 1
```

Batch run과 selection trial로 aggregate report를 생성했다.

```powershell
$BatchDir = Join-Path $OutputDir "validation-role-regime-plan-smoke-20260722-001"

node dist/cli/historicalBatchReport.js --runs-path (Join-Path $BatchDir "batch-replay-runs.jsonl") --universe-coverage-path data/replay-2023-01-2026-05-global-broad-yahoo-daily/historical-universe-coverage.json --output-path (Join-Path $BatchDir "batch-replay-aggregate-report.json")
```

## Command Correction

PowerShell과 npm `10.9.2`에서 plan npm script를 단일 separator로 실행했을 때 npm이 option 이름을 제거해 CLI가 다음 오류로 중단됐다.

```text
Error: unexpected positional argument: data/validation-feasibility/short-term-role-regime-feasibility.json
```

Plan이나 replay artifact는 생성되지 않았다. 같은 환경에서는 이중 separator가 option 이름을 정상 전달해 smoke가 통과했지만, npm 11은 두 번째 separator를 literal `--`로 Node CLI에 전달한다. 재현 명령은 npm version별 separator 동작에 의존하지 않도록 `npm run build` 후 `node dist/cli/...`를 직접 호출한다.

## Ready Plan 결과

| 항목 | 값 |
| --- | ---: |
| Status | `ready_for_paper_diagnostic` |
| Mode | `paper_only` |
| Plan hash | `sha256:621488804b7d2492b7e382d4902ee18119e3a7345348d40a5481644b1d787ebf` |
| Planned run count | `50` |
| Global unique evidence group count | `39` |
| Cross-role shared evidence group count | `11` |
| Train run count | `29` |
| Validation run count | `12` |
| Test run count | `9` |

Target regime별 planned count:

| Regime | Planned |
| --- | ---: |
| `bull` | `20` |
| `bear` | `3` |
| `sideways` | `9` |
| `mixed` | `18` |

Plan warning에는 `CALENDAR_EVIDENCE_OBSERVED_SESSION_ONLY`, 11개 `CROSS_ROLE_EVIDENCE_SHARED`, 4개 `ROLE_REGIME_SINGLE_CANDIDATE`, 세 role의 `ROLE_SAMPLE_BELOW_STATISTICAL_MINIMUM`이 포함됐다. Observed-session calendar는 공식 exchange holiday 또는 early-close evidence로 해석하지 않는다.

## Workflow 결과

| 항목 | 값 |
| --- | ---: |
| Manifest status | `completed` |
| Completed | `50` |
| Skipped | `0` |
| Failed | `0` |
| Provider mode | `deterministic_fixture` |
| AI decision failure trial | `0` |
| Selection trial count | `50` |
| Selected trial count | `0` |
| Exact plan/run mismatch | `0` |
| Unique candidate hash count | `39` |
| Unique evidence group count | `39` |

`planIndex`, exact `startAt`/`endAt`, `candidateHash`, recomputed regime을 50개 run record와 ordered plan row 사이에서 대조했다. Mismatch는 없었다. 11개 shared evidence group의 duplicate role run은 같은 deterministic fixture return을 기록했지만 role 진단에는 각각 남아 있다.

Role-regime별 run status:

| Role | Regime | Completed | Skipped | Failed |
| --- | --- | ---: | ---: | ---: |
| `train` | `bull` | `9` | `0` | `0` |
| `train` | `bear` | `1` | `0` | `0` |
| `train` | `sideways` | `5` | `0` | `0` |
| `train` | `mixed` | `14` | `0` | `0` |
| `validation` | `bull` | `6` | `0` | `0` |
| `validation` | `bear` | `1` | `0` | `0` |
| `validation` | `sideways` | `2` | `0` | `0` |
| `validation` | `mixed` | `3` | `0` | `0` |
| `test` | `bull` | `5` | `0` | `0` |
| `test` | `bear` | `1` | `0` | `0` |
| `test` | `sideways` | `2` | `0` | `0` |
| `test` | `mixed` | `1` | `0` | `0` |

이 표는 실행 plumbing과 cell coverage만 확인한다. Candidate가 하나뿐인 cell과 cross-role shared evidence가 있으므로 role 또는 regime 일반화 근거가 아니다.

## 초기 Aggregate Report 제한

Aggregate report 생성은 통과했으며 다음 값을 기록했다.

| 항목 | 값 |
| --- | ---: |
| Run count | `50` |
| Return sample count | `50` |
| Train samples | `29` |
| Validation samples | `12` |
| Test samples | `9` |
| Selected trial count | `0` |
| AI decision failure count | `0` |

세 role의 Sharpe validation은 모두 `unavailable`이다. 공통 warning은 `INSUFFICIENT_RETURN_SAMPLES`, `NON_IID_RETURN_SAMPLE`, `MULTIPLE_TESTING_CONTEXT_MISSING`이다.

현재 aggregate report는 50개 planned role row를 `returnSampleCount=50`으로 집계하고 `globalUniqueEvidenceGroupCount=39`를 독립 sample count로 노출하거나 global statistical aggregate에 적용하지 않는다. 따라서 aggregate report의 global return, Sharpe, hit-rate 또는 ranking 값은 이 smoke의 research evidence로 사용하면 안 된다. Report schema와 calculator가 evidence group 기준 deduplication을 적용하기 전까지 이 항목은 미완료 gate다.

## Aggregate Report 후속 재검증

2026-07-23에 같은 source, coverage, calendar, strategy preset을 사용하고 새 GUID temp root에서 ready plan부터 aggregate report까지 다시 실행했다. Plan provenance가 있는 보고서는 `evidenceGroupHash` 기준으로 전역 통계를 집계하며 역할별 진단에는 planned role row를 유지한다.

| 항목 | 값 |
| --- | ---: |
| Plan status | `ready_for_paper_diagnostic` |
| Planned run count | `50` |
| Plan global unique evidence group count | `39` |
| Report run count | `50` |
| Report return sample count | `39` |
| Report overall run count | `39` |
| Report global unique evidence group count | `39` |
| Report cross-role shared evidence group count | `11` |

동일 evidence group의 상태와 집계 입력 결과는 서로 일치해 fail-closed conflict gate를 통과했다. 이 결과는 전역 표본 독립성 집계 계약을 확인하지만, 아래 statistical strategy validation의 표본 수와 일반화 한계를 해소하지는 않는다.

## 판정

| Gate | 판정 | 근거 |
| --- | --- | --- |
| Ready plan source 재검증 | pass | Source drift 없이 동일 plan hash 생성 |
| Exact-window workflow 연결 | pass | 50개 ordered run mismatch 0 |
| Runtime preflight 입력 정합성 | pass | 50개 run 모두 source/hash/regime gate 통과 |
| Provenance 보존 | pass | Manifest/run에 plan hash와 39 unique evidence group 보존 |
| Selection 자동 승격 방지 | pass | 50개 trial 모두 `selected=false` |
| Statistical strategy validation | inconclusive | Role sample 부족, shared evidence, observed-session calendar 제한 |
| Global report independence | pass | 50 planned rows를 39 independent evidence로 deduplicate하고 plan count와 일치 확인 |

이번 smoke로 ready plan에서 deterministic fixture batch와 evidence-aware aggregate report까지의 plumbing은 확인했다. 전략 유효성 판정은 완료되지 않았으며, 역할별 planned row 50개를 독립 표본으로 해석하지 않는다.

남은 role별 sample, cross-role 독립성, serial dependence, multiple-testing context와 calendar evidence gate는 [Validation Role-Regime 통계 준비도 보강 계획](validation-role-regime-statistical-readiness-plan.md)에 사전 고정한다.

## Artifact 정책

기록 대상 실행과 후속 재검증 artifact는 `%TEMP%` 아래에서만 생성했으며 repository에 commit하지 않는다. 재현 명령은 기존 artifact를 삭제하거나 덮어쓰지 않고 매번 GUID 기반 root를 새로 만든다.

```text
short-term-role-regime-replay-plan.json
batch-replay/validation-role-regime-plan-smoke-20260722-001/
├── batch-replay-manifest.json
├── batch-replay-runs.jsonl
├── batch-replay-selection-trials.jsonl
├── batch-replay-aggregate-report.json
└── runs/
```
