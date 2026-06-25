# AI Paper Trading Runbook

## 목적

이 문서는 Codex CLI를 paper-only decision provider로 사용할 때 실행 전, 실행 중, 실행 후에 사람이 확인해야 할 운영 절차를 정리한다.

대상은 실제 주문이 아니라 `VirtualDecision`을 생성하고 deterministic backend가 schema validation, semantic validation, normalization, `VirtualRiskEngine`, `PaperOrderEngine`, storage, audit, report를 처리하는 paper-only workflow다.

이 runbook은 live trading enable 절차가 아니다. 실계좌 주문, live `TradingSignal`, live `OrderIntent`, broker adapter, `OrderRouter` 연결은 포함하지 않는다.

## 기본 원칙

- `TRADING_ENABLED=false`를 유지한다.
- `BROKER_PROVIDER=mock`을 유지한다.
- `AI_DECISION_MODE=paper_only`를 유지한다.
- `AI_DECISION_ENABLED=false`가 기본값이다.
- Codex CLI를 사용할 때도 backend가 만든 `market_packet`만 입력으로 사용한다.
- Codex CLI output은 `VirtualDecision` JSON으로만 처리한다.
- 모든 가상 주문은 `VirtualRiskEngine`과 `PaperOrderEngine`을 통과한다.
- provider failure, validation reject, risk reject는 no-trade로 처리한다.
- dashboard와 Local Operations API는 read-only 조회만 수행한다.
- report와 운영 메모는 투자 조언, 수익률 보장, 실계좌 성과처럼 작성하지 않는다.

## 실행 전 체크리스트

### 1. 코드와 문서 상태

```powershell
git status --short
npm run check
git diff --check
```

확인 기준:

- 작업 중인 변경이 실행 검증과 섞여 있지 않다.
- `npm run check`가 build, quality gate, test suite를 통과한다.
- 문서나 예시에 real account data, API key, token, order ID, execution data가 없다.

### 2. 로컬 환경 변수

Codex CLI를 호출하지 않는 dry-run은 별도 AI 설정 없이 실행할 수 있다.

Codex CLI provider를 사용할 때만 프로젝트 루트 `.env`에 아래 값을 둔다.

```env
AI_DECISION_MODE=paper_only
AI_DECISION_ENABLED=true
CODEX_EXEC_PATH=codex
CODEX_EXEC_TIMEOUT_SECONDS=300
AI_DECISION_OUTPUT_SCHEMA_PATH=schemas/virtual-decision.schema.json
AI_DECISION_MAX_RUNS_PER_DAY=5
CODEX_ALLOW_WEB_SEARCH=false
```

확인 기준:

- `.env`는 Git에서 추적하지 않는다.
- `AI_DECISION_MODE`는 `paper_only`다.
- `AI_DECISION_ENABLED=true`는 Codex provider 실행을 의도한 경우에만 사용한다.
- `CODEX_EXEC_PATH`는 실제 Codex CLI binary 또는 `codex` alias를 가리킨다.
- output schema path는 `schemas/virtual-decision.schema.json` 또는 동일 contract의 명시 경로다.
- `CODEX_ALLOW_WEB_SEARCH=false`를 기본으로 둔다.

Windows Store alias가 `Access is denied`를 반환하면 `CODEX_EXEC_PATH`에 실제 `codex.exe` 경로를 지정한다.

### 3. 입력 데이터

Stored packet paper run:

- `tossinvest-sources.jsonl`이 있거나 `npm run tossinvest:collect`로 read-only source를 수집할 수 있다.
- `market-packets.jsonl`이 있거나 `npm run market:ingest`로 생성할 수 있다.

Historical replay:

- `historical-market-snapshots.jsonl`이 source data directory에 있다.
- replay window의 snapshot coverage를 먼저 확인한다.

```powershell
npm run historical:availability -- -- --data-dir data/replay-2023-01-2026-05-global-yahoo-daily --random-window --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --random-window-seed batch-seed-001 --window-months 1 --min-window-snapshots 1
```

Universe manifest를 쓰는 경우:

```powershell
npm run historical:universe:coverage -- -- --data-dir data/replay-2023-01-2026-05-global-yahoo-daily --universe-path docs/historical-universe.global-broad.json --range-start 2023-01-01T00:00:00+09:00 --range-end 2026-05-31T23:59:59.999+09:00 --min-monthly-coverage-ratio 1 --min-snapshots-per-symbol 1
```

확인 기준:

- coverage status가 `available`이거나 부족한 symbol/window를 사람이 확인했다.
- optional symbol gap을 required failure로 오해하지 않는다.
- coverage CLI에서 optional symbol까지 강제하려면 `--require-optional-symbols`를 사용한다.
- single replay와 batch replay에서 universe optional symbol까지 availability check에 포함하려면 `--require-optional-universe-symbols`를 사용한다.

### 4. Budget과 sampling

One-shot 또는 stored packet paper run:

- `AI_DECISION_MAX_RUNS_PER_DAY`는 하루 provider 호출 상한이다.

Single historical replay:

- `--max-decision-calls`는 replay sampling에서 provider 호출 후보 횟수를 제한한다.
- `--max-codex-calls`는 single replay의 Codex provider 호출 상한이다.

Batch historical replay:

- `--max-decision-calls`는 각 replay run의 sampling call cap이다.
- `--max-codex-calls-per-run`은 각 replay run 안의 Codex provider call cap이다.
- batch replay는 run마다 별도 Codex provider를 생성한다.
- `AI_DECISION_MAX_RUNS_PER_DAY`는 일반 provider env 해석에 쓰이며 batch per-run cap과 같은 의미가 아니다.

## 실행 절차

### 1. 안전 dry-run

Codex CLI 호출 없이 mock/static provider로 paper-only 경로를 확인한다.

```powershell
$dataDir = "data/process-refactor-smoke"
npm run paper:run-once:dry -- --data-dir $dataDir
npm run paper:report -- --data-dir $dataDir
```

확인 artifact:

- `virtual-portfolio.json`
- `virtual-decisions.jsonl`
- `virtual-trades.jsonl`
- `audit-events.jsonl`

### 2. Stored market packet paper run

Read-only source를 수집하고 packet을 만든 뒤 dry-run으로 먼저 확인한다.

```powershell
$dataDir = "data/paper"
npm run tossinvest:collect -- --data-dir $dataDir
npm run market:ingest -- --data-dir $dataDir
npm run paper:run-from-market-packet:dry -- --data-dir $dataDir
```

Codex CLI provider를 의도적으로 사용할 때만 dry-run을 제거한다.

```powershell
npm run paper:run-from-market-packet -- --data-dir data/paper
```

확인 기준:

- packet이 stale이면 AI 호출 없이 no-trade로 끝난다.
- packet mismatch 또는 hallucinated ref는 decision 저장 전에 reject된다.
- provider failure는 portfolio를 변경하지 않는다.

### 3. Single historical replay

Dry-run replay:

```powershell
npm run historical:replay:dry -- -- --data-dir data/replay-2023-01-2026-05-global-yahoo-daily --random-window --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --random-window-seed replay-smoke-001 --window-months 1 --step-seconds 604800 --every-n-steps 1 --require-data-availability
```

Codex CLI provider를 사용할 때:

```powershell
npm run historical:replay -- -- --data-dir data/replay-2023-01-2026-05-global-yahoo-daily --random-window --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --random-window-seed replay-codex-001 --window-months 1 --step-seconds 604800 --every-n-steps 1 --max-codex-calls 5 --require-data-availability
```

확인 artifact:

- `historical-replay-progress.json`
- `historical-replay-report.json`
- `historical-replay-run-metadata.json`
- `historical-replay-packets.jsonl`
- `historical-replay-decisions.jsonl`
- `historical-replay-risk-decisions.jsonl`
- `historical-replay-trades.jsonl`
- `historical-replay-portfolio-timeline.jsonl`

### 4. Batch historical replay

먼저 deterministic dry-run batch로 data/window/risk profile을 확인한다.

```powershell
npm run historical:batch:replay:dry -- -- --source-data-dir data/replay-2023-01-2026-05-global-yahoo-daily --output-dir data/batch-replay --batch-id batch-dryrun-smoke --seed batch-seed-001 --runs 4 --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --window-months 1 --decision-frequency once_per_week --max-decision-calls 1 --step-seconds 604800 --max-snapshot-age-seconds 2678400 --min-window-snapshots 1 --window-sampling balanced_regime --target-regimes bull,bear,sideways,mixed --universe-path docs/historical-universe.global-broad.json
```

Codex CLI provider를 사용할 때는 `--use-codex-ai`와 `AI_DECISION_ENABLED=true`가 모두 필요하다.

```powershell
npm run historical:batch:replay -- -- --use-codex-ai --source-data-dir data/replay-2023-01-2026-05-global-yahoo-daily --output-dir data/batch-replay --batch-id batch-codex-paper-001 --seed batch-seed-001 --runs 10 --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --window-months 1 --decision-frequency once_per_week --max-decision-calls 5 --max-codex-calls-per-run 5 --step-seconds 604800 --max-snapshot-age-seconds 2678400 --min-window-snapshots 1 --window-sampling balanced_regime --target-regimes bull,bear,sideways,mixed --universe-path docs/historical-universe.global-broad.json --risk-profile aggressive_paper
```

Codex preflight:

- 기본값은 batch 시작 전 preflight decision을 1회 실행한다.
- 이미 같은 환경에서 Codex 연결을 확인한 경우에만 `--skip-codex-preflight`를 사용한다.
- preflight 실패는 batch를 시작하기 전에 환경 문제를 드러내기 위한 fail-fast다.

Aggregate report:

```powershell
npm run historical:batch:report -- -- --runs-path data/batch-replay/batch-codex-paper-001/batch-replay-runs.jsonl --output-path data/batch-replay/batch-codex-paper-001/batch-replay-aggregate-report.json --target-return-thresholds "0.15,0.30"
```

## 실행 중 모니터링

Single replay:

- `historical-replay-progress.json`의 `status`, `processedTickCount`, `recentEvents`를 본다.
- provider timeout, invalid output, packet mismatch는 progress와 audit event로만 남아야 한다.

Batch replay:

- `batch-replay/<batchId>/batch-replay-manifest.json`에서 `status`, `completedCount`, `skippedCount`, `failedCount`를 본다.
- `batch-replay/<batchId>/batch-replay-runs.jsonl`에서 run별 `status`, `skipReason`, `failureReason`, `aiDecisionFailureCount`를 본다.
- completed run 내부 provider failure는 batch run failure와 구분한다.

Local Operations API:

```powershell
npm run dashboard -- --data-dir data/paper --host 127.0.0.1 --port 8787
```

Read-only endpoint:

```text
GET /virtual/portfolio
GET /virtual/decisions
GET /virtual/trades
GET /paper/report
GET /replay/report
GET /replay/progress
GET /research/replay/report
GET /batch/replay/report
GET /batch/replay/runs
GET /dashboard/view-model/portfolio-compliance
GET /dashboard/view-model/strategy-test-lab
GET /dashboard/view-model/risk-gate-trace
GET /dashboard/view-model/validation-lab
GET /scheduler/status
GET /source/health
GET /market/packets
GET /audit/events
```

`GET /research/replay/report`는 저장된 batch replay aggregate artifact를 `replay_research_report.v1` 요약 payload로 파생해 validation, overfitting warning, provider failure, risk reject, exposure summary를 read-only로 보여준다.

`GET /dashboard/view-model/*`는 Next.js dashboard 전환을 위한 화면 전용 read model이다. browser가 raw artifact를 직접 조합하지 않도록 backend가 portfolio compliance, strategy test capability, risk gate trace, validation lab 요약을 계산해서 내려준다. policy draft 저장소와 isolated strategy bucket replay artifact가 없으면 해당 값은 `missing` 또는 disabled capability로 표현한다.

Dashboard의 `/dashboard/virtual/validation` 화면은 같은 payload를 연구 리포트 패널로 렌더링한다. 이 패널은 저장된 artifact 조회와 요약 표시만 수행하며 replay 실행, Codex CLI 실행, TossInvest collection, live order를 trigger하지 않는다.

조회 endpoint는 `GET`/`HEAD`만 허용한다. Guarded `POST` 예외는 `/paper/simulations`, `/paper/policies/validate`, `/paper/simulations/strategy-bucket-tests/validate`, `/paper/simulations/strategy-bucket-tests`처럼 `src/api/localOperationsSurface.ts`에 명시된 route만 허용하며 same-origin, JSON body, explicit operation header를 요구한다. Strategy bucket test create는 queued record와 audit event만 저장하고 replay runner는 시작하지 않는다. Dashboard는 Codex CLI 실행, TossInvest collection, live order를 trigger하지 않는다.

## 실행 후 검토

### 1. Decision과 trade count

확인 순서:

1. `market-packets.jsonl` 또는 `historical-replay-packets.jsonl`에서 candidate와 packet hash를 확인한다.
2. `virtual-decisions.jsonl` 또는 `historical-replay-decisions.jsonl`에서 validation을 통과한 decision만 저장됐는지 확인한다.
3. `historical-replay-risk-decisions.jsonl` 또는 `audit-events.jsonl`에서 reject code를 확인한다.
4. `virtual-trades.jsonl` 또는 `historical-replay-trades.jsonl`에서 risk-approved item만 fill로 이어졌는지 확인한다.
5. `virtual-portfolio.json` 또는 `historical-replay-portfolio-timeline.jsonl`에서 portfolio 변경이 trade와 일치하는지 확인한다.

### 2. Provider failure와 retry 판단

| 조건 | 확인 artifact | 재실행 판단 |
| --- | --- | --- |
| `AI_DECISION_ENABLED=false` | `audit-events.jsonl`, batch manifest preflight failure | 설정 의도 확인 후 필요할 때만 true로 재실행 |
| Codex executable 없음 | audit/progress failure summary | `CODEX_EXEC_PATH` 수정 후 재실행 |
| Codex auth/usage limit | audit/progress failure summary | 인증 또는 usage limit 확인 후 재실행 |
| timeout | `AI_DECISION_FAILED`, `HISTORICAL_AI_DECISION_FAILED` | timeout 증가 또는 decision call cap 축소 후 재실행 |
| invalid JSON/schema | audit/progress, decision artifact 부재 | prompt/schema drift 확인 후 재실행 |
| packet mismatch/ref mismatch | validation reject event | source packet과 prompt version 확인 후 재실행 |
| risk reject | risk decision artifact | 정상 no-trade일 수 있음. risk policy를 자동 완화하지 않음 |
| data availability 부족 | availability report, batch run `skipped` | data range 또는 universe requirement 조정 후 재실행 |

재실행 전에 같은 `batchId`를 덮어쓸지 새 `batchId`로 분리할지 결정한다. 사후 비교가 필요하면 새 `batchId`를 사용한다.

### 3. Report 문구

허용 표현:

- paper-only simulation
- 가상 포트폴리오
- 사후 분석 지표
- provider failure count
- risk reject count

금지 표현:

- 수익 보장
- 실계좌 성과
- 매수/매도 추천
- 목표 수익률 달성 보장
- Risk Engine 우회 또는 한도 완화 권고

Target return hit-rate는 paper-only batch sample을 요약하는 사후 분석 지표다. 전략 자동 조정, live signal, 투자 권유로 사용하지 않는다.

## 문서 갱신 기준

아래 항목이 바뀌면 이 runbook과 관련 문서를 같이 갱신한다.

- `package.json` script 이름
- Codex decision env 우선순위
- Local Operations API route
- storage artifact file name
- batch manifest/run record field
- risk profile 또는 paper exit policy option
- report disclaimer 또는 metric 의미

관련 문서:

- `docs/codex-cli-paper-trading.md`
- `docs/historical-replay.md`
- `docs/automation.md`
- `docs/risk-policy.md`
- `docs/PROJECT_STRUCTURE.md`
