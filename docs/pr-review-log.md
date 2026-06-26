# PR Review Log

> 각 PR 단위는 merge-ready로 간주하기 전에 3회 검토를 수행합니다. 검토는 `scope/safety`, `tests/validation`, `diff/integration` 순서로 기록합니다.

## PR-00: Repository Baseline

### Review 1: Scope and Safety

- 범위는 repository baseline에 한정합니다.
- runtime code, package manager 설정, MCP server 구현은 포함하지 않습니다.
- `.gitignore`는 `.env`와 local runtime state를 제외하고 `.env.example`은 추적 가능하게 유지합니다.
- `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`, read-only-first 문서 경계를 변경하지 않습니다.

### Review 2: Tests and Validation

- `git init` 이후 `git status --short`로 추적 대상 파일을 확인합니다.
- 문서에서 real credential, API key, token 원문이 없는지 검색합니다.
- `.env` 파일이 없는지 확인합니다.

### Review 3: Diff and Integration

- README가 `docs/pr-implementation-plan.md`를 링크하는지 확인합니다.
- baseline commit은 문서와 safe defaults만 포함합니다.
- PR-01에서 TypeScript scaffold를 별도 commit으로 시작할 수 있어야 합니다.

## PR-01: TypeScript Runtime Scaffold

### Review 1: Scope and Safety

- 범위는 TypeScript/Node runtime scaffold에 한정했습니다.
- domain logic, MCP tool, `tossctl` 호출, Codex CLI 호출은 추가하지 않았습니다.
- `src/index.ts`는 safe default metadata만 노출합니다.
- scope 검색에서 `tossctl`, `codex exec`, `place_order`, `TradingSignal`, `TRADING_ENABLED=true`, `AI_DECISION_ENABLED=true`가 `src`, `package.json`, `tsconfig.json`에 없음을 확인했습니다.

### Review 2: Tests and Validation

- `npm install` 성공.
- `npm run build` 성공.
- `npm test` 성공.
- Node built-in test runner로 scaffold safe default test 1개가 통과했습니다.

### Review 3: Diff and Integration

- `package.json`, `package-lock.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts`만 runtime scaffold로 추가했습니다.
- `dist/`와 `node_modules/`는 `.gitignore`에 의해 추적되지 않습니다.
- PR-02에서 domain schema를 추가할 수 있는 `src/` 기반이 준비되었습니다.

## PR-02: Domain Schemas and Validation

### Review 1: Scope and Safety

- 범위는 domain schema, validation helper, fixture test에 한정했습니다.
- local store, Codex CLI 호출, `tossctl` collector, MCP tool은 추가하지 않았습니다.
- scope 검색에서 `child_process`, `spawn`, `exec`, `tossctl`, `codex exec`, `place_order`, `TRADING_ENABLED=true`, `AI_DECISION_ENABLED=true`, file IO 사용이 없음을 확인했습니다.
- `virtual_decision`은 `VIRTUAL_*` action만 허용하며 live action string인 `BUY`는 reject합니다.

### Review 2: Tests and Validation

- `npm run build` 성공.
- `npm test` 성공.
- valid `MarketPacket` fixture validation 통과.
- invalid action reject test 통과.
- missing `dataRefs` reject test 통과.
- non-hold decision risk factor requirement test 통과.
- stale timestamp helper reject test 통과.

### Review 3: Diff and Integration

- `zod`를 runtime dependency로 추가했습니다.
- `src/domain/schemas.ts`와 `src/domain/schemas.test.ts`를 추가했습니다.
- PR-03에서 local store와 audit log가 같은 schema를 사용할 수 있습니다.

## PR-03: Local Store and Audit Log

### Review 1: Scope and Safety

- 범위는 local persistent store, append-only audit log, masking helper에 한정했습니다.
- Codex CLI provider, `tossctl` collector, MCP tool, paper order engine은 추가하지 않았습니다.
- scope 검색에서 `child_process`, `spawn`, `exec`, `tossctl`, `codex exec`, `place_order`, `TRADING_ENABLED=true`, `AI_DECISION_ENABLED=true`, live broker path가 `src`에 없음을 확인했습니다.
- local runtime state는 caller-provided path에만 쓰며 repo root의 `data/`나 `logs/`는 생성하지 않았습니다.

### Review 2: Tests and Validation

- `npm run build` 성공.
- `npm test` 성공.
- audit append/read test 통과.
- virtual portfolio read/write test 통과.
- corrupted JSONL line handling test 통과.
- sensitive text/object masking tests 통과.

### Review 3: Diff and Integration

- `src/storage`에 `JsonFileStore`, `JsonlStore`, file-backed repository classes를 추가했습니다.
- `src/security/masking.ts`에 masking helper를 추가했습니다.
- PR-04에서 `VirtualRiskEngine`과 `PaperOrderEngine`이 같은 repository contract를 사용할 수 있습니다.

## PR-04: Paper Trading Core

### Review 1: Scope and Safety

- 범위는 `VirtualRiskEngine`, `PaperOrderEngine`, `VirtualLedger`에 한정했습니다.
- broker adapter, `OrderRouter`, MCP tool, Codex CLI provider, `tossctl` collector는 추가하지 않았습니다.
- scope 검색에서 `child_process`, `spawn`, `exec`, `tossctl`, `codex exec`, `place_order`, `TRADING_ENABLED=true`, `AI_DECISION_ENABLED=true`, broker/live order path가 없음을 확인했습니다.
- `PaperOrderEngine`은 `MarketPacket` candidate price와 `VirtualPortfolio`만 사용하며 외부 API를 호출하지 않습니다.

### Review 2: Tests and Validation

- `npm run build` 성공.
- `npm test` 성공.
- virtual cash 부족 reject test 통과.
- max symbol exposure reject test 통과.
- stale decision reject test 통과.
- valid `VIRTUAL_BUY` virtual fill test 통과.
- `VIRTUAL_SELL` virtual position update test 통과.
- rejected decision portfolio no-mutation test 통과.
- `VirtualLedger` immutable record test 통과.

### Review 3: Diff and Integration

- `VirtualDecisionItem` type export를 추가했습니다.
- `src/paper/riskEngine.ts`, `src/paper/orderEngine.ts`, `src/paper/ledger.ts`와 테스트를 추가했습니다.
- PR-05에서 `MarketPacketBuilder`가 만든 packet을 바로 `PaperOrderEngine` 입력으로 사용할 수 있습니다.

## PR-05: Market Packet Builder with Mock Data

### Review 1: Scope and Safety

- 범위는 mock/draft candidate를 compact `market_packet`으로 변환하는 builder에 한정했습니다.
- `tossctl` collector, Codex CLI provider, MCP tool, scheduler는 추가하지 않았습니다.
- scope 검색에서 `child_process`, `spawn`, `exec`, `tossctl`, `codex exec`, `place_order`, `TRADING_ENABLED=true`, `AI_DECISION_ENABLED=true`, broker/live path, file IO가 `src/market`에 없음을 확인했습니다.
- raw draft candidate의 extra sensitive field는 packet output에 포함하지 않습니다.

### Review 2: Tests and Validation

- `npm run build` 성공.
- `npm test` 성공.
- max candidates trimming test 통과.
- packet expiry from TTL test 통과.
- missing `sourceRefs` warning and exclusion test 통과.
- virtual portfolio snapshot inclusion test 통과.
- sensitive extra field drop test 통과.
- mock packet fixture generation test 통과.

### Review 3: Diff and Integration

- `src/market/packetBuilder.ts`와 테스트를 추가했습니다.
- builder output은 `marketPacketSchema`로 검증됩니다.
- PR-06에서 Codex CLI provider가 이 packet을 input으로 사용할 수 있습니다.

## PR-06: Codex CLI Decision Provider Dry Run

### Review 1: Scope and Safety

- 범위는 `codex exec` command wrapper, process runner abstraction, in-memory daily run budget에 한정했습니다.
- 실제 Codex CLI는 테스트에서 호출하지 않고 `FakeRunner`로만 검증했습니다.
- `sandbox` config type은 `"read-only"`만 허용합니다.
- scope 검색에서 `tossctl`, `place_order`, `TRADING_ENABLED=true`, `AI_DECISION_ENABLED=true`, `workspace-write`, `danger-full-access`, broker/live order path가 `src/ai`에 없음을 확인했습니다.
- `--search`는 config가 true일 때만 추가되고, 기본 테스트는 `--search`가 포함되지 않음을 확인합니다.

### Review 2: Tests and Validation

- `npm run build` 성공.
- `npm test` 성공.
- provider disabled mode does not execute test 통과.
- command args include `exec --sandbox read-only --output-schema` test 통과.
- timeout returns `AI_DECISION_FAILED` test 통과.
- invalid JSON output no decision test 통과.
- valid JSON output parse test 통과.
- daily run budget limit test 통과.

### Review 3: Diff and Integration

- `src/ai/processRunner.ts`, `src/ai/runBudget.ts`, `src/ai/codexCliDecisionProvider.ts`와 tests를 추가했습니다.
- provider output은 `virtualDecisionSchema`로 검증됩니다.
- PR-07에서 `MarketPacketBuilder`, `CodexCliDecisionProvider`, `PaperOrderEngine`을 연결할 수 있습니다.

## PR-07: End-to-End Paper Decision CLI

### Review 1: Scope and Safety

- 범위는 mock packet, decision provider, paper order engine, local stores를 연결하는 paper-only run-once workflow에 한정했습니다.
- `tossctl` collector, live broker adapter, MCP tool, scheduler는 추가하지 않았습니다.
- scope 검색에서 `tossctl`, `place_order`, `TRADING_ENABLED=true`, `AI_DECISION_ENABLED=true`, `workspace-write`, `danger-full-access`, broker/live order path가 `src/workflows`와 `src/cli`에 없음을 확인했습니다.
- CLI dry-run은 `StaticDecisionProvider`를 사용하며 실제 Codex CLI를 호출하지 않습니다.

### Review 2: Tests and Validation

- `npm run build` 성공.
- `npm test` 성공.
- mocked Codex provider end-to-end test 통과.
- failed provider leaves existing portfolio unchanged test 통과.
- successful run writes virtual trade and audit event chain test 통과.
- `npm run paper:run-once:dry -- <temp-dir>` 성공.
- dry-run report가 `Paper trading report`와 `not financial advice` 문구를 포함함을 확인했습니다.

### Review 3: Diff and Integration

- `src/workflows/paperRunOnce.ts`와 tests를 추가했습니다.
- `src/cli/paperRunOnce.ts` CLI wrapper를 추가했습니다.
- `paper:run-once`와 `paper:run-once:dry` npm scripts를 추가했습니다.
- temp data dir에 `audit-events.jsonl`, `virtual-decisions.jsonl`, `virtual-portfolio.json`, `virtual-trades.jsonl`이 생성됨을 확인했습니다.
- repo 내부 `data/`는 생성되지 않았습니다.

## PR-08: Read-only TossInvest CLI Collector

### Review 1: Scope and Safety

- 범위는 `tossctl` read-only command allowlist wrapper에 한정했습니다.
- MCP tool, live broker adapter, order routing, Codex CLI decision workflow 변경은 추가하지 않았습니다.
- collector는 `commandKey` enum-style allowlist만 받고 raw shell command string을 받지 않습니다.
- `order`, `auth`, `config`, `watchlist`, `transactions`, `account`, `portfolio`, `orders` group과 `--execute` argv를 실행 전에 차단합니다.
- scope 검색에서 `run_tossctl`, `execute_tossctl`, `run_codex_exec`, `place_order`, `TradingSignal`, `OrderIntent`, `TRADING_ENABLED=true`, `AI_DECISION_ENABLED=true`, `workspace-write`, `danger-full-access`가 `src`와 `package.json`에 없음을 확인했습니다.

### Review 2: Tests and Validation

- `npm run build` 성공.
- `npm test` 성공.
- allowlisted command가 `--output json`과 함께 실행되는 test 통과.
- non-allowlisted `order.place` command가 runner 실행 전에 차단되는 test 통과.
- `--execute` argv가 runner 실행 전에 차단되는 test 통과.
- disabled collector, timeout, invalid JSON degraded 상태 test 통과.

### Review 3: Diff and Integration

- `src/collectors/tossInvestCliCollector.ts`와 테스트를 추가했습니다.
- collector result는 `ok`, `blocked`, `degraded` 상태와 `unofficial_read_only` metadata를 포함합니다.
- 실패한 수집은 exception 대신 degraded/blocked result로 반환되어 PR-09 normalizer에서 source 상태를 판단할 수 있습니다.
- PR-09에서 sample `tossctl` JSON fixture를 이 collector output contract에 맞춰 `MarketPacketBuilder` 입력으로 변환할 수 있습니다.

## PR-09: Market Packet from TossInvest Data

### Review 1: Scope and Safety

- 범위는 collector result JSON을 `MarketCandidateDraft`로 정규화하고 `MarketPacketBuilder`에 연결하는 helper에 한정했습니다.
- live `tossctl` 실행, Codex CLI 실행, MCP tool, live broker adapter, order routing은 추가하지 않았습니다.
- normalizer는 `market.ranking`, `market.signals`, `quote.get`, `quote.batch`의 이미 수집된 JSON만 입력으로 받습니다.
- stale source는 candidate에서 제외하고 degraded warning으로 남깁니다.
- scope 검색에서 `run_tossctl`, `execute_tossctl`, `run_codex_exec`, `place_order`, `TradingSignal`, `OrderIntent`, `TRADING_ENABLED=true`, `AI_DECISION_ENABLED=true`, `child_process`, `spawn`, `exec`, `tossctlPath`, `runner.run`이 `src/market`, `src/workflows`, `src/cli`, `package.json`에 없음을 확인했습니다.

### Review 2: Tests and Validation

- `npm run build` 성공.
- `npm test` 성공.
- sample `tossctl` ranking/signals/quote JSON fixture parse test 통과.
- malformed output degraded test 통과.
- stale source excluded test 통과.
- generated packet compactness and sensitive raw field exclusion test 통과.

### Review 3: Diff and Integration

- `src/market/tossInvestMarketData.ts`와 테스트를 추가했습니다.
- `normalizeTossInvestCollectorResults`는 source별 `sourceRefs`, `reasonCodes`, `collectedAt`, `staleAfter`를 생성합니다.
- `buildMarketPacketFromTossInvestData`는 정규화 결과와 기존 `MarketPacketBuilder`를 결합하고 warning을 병합합니다.
- 기존 `runPaperDecisionOnce` 기본 경로는 mock packet 그대로 유지되어 live data dependency가 생기지 않았습니다.

## PR-10: MCP Read-only Virtual Portfolio Tools

### Review 1: Scope and Safety

- 범위는 MCP stdio server scaffold와 virtual portfolio 조회 tool 5개에 한정했습니다.
- enabled tool은 `get_virtual_portfolio`, `get_virtual_positions`, `get_virtual_decisions`, `get_virtual_trades`, `get_virtual_performance`뿐입니다.
- 각 tool은 local store read만 수행하고 `readOnlyHint=true`, `destructiveHint=false` annotation을 설정합니다.
- MCP에서 `tossctl`, Codex CLI, broker adapter, order routing을 호출하는 tool은 추가하지 않았습니다.
- scope 검색에서 금지 tool 이름은 테스트의 exclusion/error 검증에만 나타나며 실제 registry에는 포함되지 않음을 확인했습니다.

### Review 2: Tests and Validation

- `npm install @modelcontextprotocol/sdk` 성공.
- `npm run build` 성공.
- `npm test` 성공.
- tool list가 read-only이고 `place_order`, `run_tossctl`, `run_codex_exec`를 포함하지 않는 test 통과.
- `get_virtual_positions`, `get_virtual_decisions`, `get_virtual_performance` handler unit tests 통과.
- sensitive text masking과 unknown/forbidden tool error result test 통과.

### Review 3: Diff and Integration

- `@modelcontextprotocol/sdk` dependency를 추가했습니다.
- `src/mcp/server.ts`에서 SDK `Server`, `StdioServerTransport`, `tools/list`, `tools/call` handler를 연결했습니다.
- `src/mcp/virtualPortfolioTools.ts`에서 local virtual portfolio/decision/trade store 조회 tool을 구현했습니다.
- `src/index.ts` 실행 경로는 MCP stdio server를 시작하고, import 시 기존 `getRuntimeInfo`는 유지합니다.
- stdout은 MCP transport에만 사용하고 start failure는 stderr로 보고합니다.

## PR-11: Scheduler and Run Budget

### Review 1: Scope and Safety

- 범위는 paper-only one-shot scheduler gate, daily budget, lock file, failure backoff, manual run command에 한정했습니다.
- OS-level service installer, cloud deployment, live trading scheduler, 실시간 무한 루프는 추가하지 않았습니다.
- scheduler는 호출 시 실행 여부만 판단하고 backend trading loop를 소유하지 않습니다.
- manual/scheduled command도 기존 `runPaperDecisionOnce` paper-only workflow를 호출하며 live order path를 만들지 않습니다.
- scope 검색에서 `place_order`, `run_tossctl`, `run_codex_exec`, live trading flag, `setInterval`, `while (true)`, process spawn/exec가 PR-11 범위에 없음을 확인했습니다.

### Review 2: Tests and Validation

- `npm run build` 성공.
- `npm test` 성공.
- max runs per KST day enforced test 통과.
- concurrent lock blocked test 통과.
- failed run audit and backoff test 통과.
- disabled scheduler does not run provider job test 통과.
- scheduled trigger before market close skip test 통과.
- `npm run paper:scheduler:run:dry -- <temp-dir>` 성공.

### Review 3: Diff and Integration

- `src/scheduler/paperRunScheduler.ts`와 테스트를 추가했습니다.
- scheduler state는 `paper-scheduler-state.json`, lock은 `paper-run.lock`에 저장됩니다.
- 실패한 run은 `SCHEDULED_PAPER_RUN_FAILED` audit event를 남기고 backoff를 적용합니다.
- `src/cli/paperSchedulerRun.ts`와 `paper:scheduler:run`, `paper:scheduler:run:dry` scripts를 추가했습니다.
- dry-run은 repo 외부 temp dir에만 runtime state를 생성했고 repo 내부 `data/`는 생성되지 않았습니다.

## PR-12: Reports and Portfolio Polish

### Review 1: Scope and Safety

- 범위는 local paper state 기반 daily report, report CLI, README demo 갱신에 한정했습니다.
- live account reporting, performance guarantee, backtest overclaim, live order path는 추가하지 않았습니다.
- report는 `VirtualPortfolio`, `VirtualDecisionStore`, `VirtualTradeStore`, `AuditLog`만 읽습니다.
- report disclaimer는 paper-only, not financial advice, not a performance guarantee, cannot place live orders를 명시합니다.
- scope 검색에서 live order/raw execution tool 문자열은 README의 disabled policy와 테스트/부정문 설명으로만 나타남을 확인했습니다.

### Review 2: Tests and Validation

- `npm run build` 성공.
- `npm test` 성공.
- daily paper report fixture summary test 통과.
- rendered sample report masking and disclaimer test 통과.
- ISO calendar date가 account masking에 오탐되지 않는 test 통과.
- `npm run paper:report -- <temp-dir> --date <date>` 성공.

### Review 3: Diff and Integration

- `src/reports/paperDailyReport.ts`와 테스트를 추가했습니다.
- `src/cli/paperDailyReport.ts`와 `paper:report` npm script를 추가했습니다.
- report는 decision outcome, virtual trade summary, rejected risk summary, source status summary를 포함합니다.
- masking helper가 ISO date를 보존하면서 account/order-like 값을 계속 masking하도록 조정했습니다.
- README에 paper-only demo와 anonymized sample output을 추가했습니다.

## PR-13: TossInvest Collector Execution CLI

### Review 1: Scope and Safety

- 범위는 read-only TossInvest collection CLI, env config, source JSONL store, masked persistence에 한정했습니다.
- `TOSSINVEST_CLI_ENABLED=false` 기본값을 유지하며 disabled 상태에서는 runner를 호출하지 않습니다.
- command key allowlist를 통과한 command만 collector에 전달하고 mutation command는 저장/실행 전에 skip합니다.
- raw `tossctl` MCP tool, raw `codex exec` MCP tool, live order path는 추가하지 않았습니다.
- scope 검색에서 account/order/auth 관련 문자열은 blocklist, 테스트 fixture, 문서 제외 범위로만 나타남을 확인했습니다.

### Review 2: Tests and Validation

- `npm run build` 성공.
- `npm test` 성공.
- disabled collection no runner/no source save test 통과.
- allowlisted command save and masking test 통과.
- mutation command skip before runner execution test 통과.
- degraded command result persistence test 통과.
- `npm run tossinvest:collect -- <temp-dir>`는 safe default에서 skipped로 종료하고 audit만 기록했습니다.

### Review 3: Diff and Integration

- `src/collectors/tossInvestCollectionWorkflow.ts`와 tests를 추가했습니다.
- `src/cli/tossInvestCollect.ts`와 `tossinvest:collect` npm script를 추가했습니다.
- `tossinvest-sources.jsonl` store를 `createStoragePaths`에 추가했습니다.
- collector result schema와 `isTossInvestReadOnlyCommandKey` guard를 추가했습니다.
- `.env.example`에 collection command와 timeout 설정을 추가했습니다.

## PR-14: Market Data Ingestion Workflow

### Review 1: Scope and Safety

- 범위는 저장된 `tossinvest-sources.jsonl`을 읽어 paper-only `market_packet`을 생성/저장하는 workflow에 한정했습니다.
- live `tossctl` 호출, Codex CLI 호출, live `TradingSignal`, live `OrderIntent`, order routing은 추가하지 않았습니다.
- source가 stale/degraded/corrupt이거나 valid candidate가 없으면 empty packet을 저장하지 않고 fail-closed합니다.
- workflow는 local store read/write와 audit event만 수행합니다.
- scope 검색에서 raw process execution, raw MCP tool, live order/signal 관련 문자열이 PR-14 범위에 없음을 확인했습니다.

### Review 2: Tests and Validation

- `npm run build` 성공.
- `npm test` 성공.
- stored TossInvest source fixture에서 packet 생성/저장 test 통과.
- all stale source fail-closed test 통과.
- corrupt source line warning/failure test 통과.
- `npm run market:ingest -- <temp-dir>`가 temp source fixture에서 `market-packets.jsonl`을 생성함을 확인했습니다.

### Review 3: Diff and Integration

- `src/workflows/marketDataIngestion.ts`와 tests를 추가했습니다.
- `src/cli/marketIngest.ts`와 `market:ingest` npm script를 추가했습니다.
- `market-packets.jsonl` store를 `createStoragePaths`에 추가했습니다.
- ingestion 설정용 source/packet TTL, max candidates, max new positions env 예시를 추가했습니다.
- CLI 검증은 repo 외부 temp dir에서만 수행했고 repo 내부 `data/`는 생성되지 않았습니다.

## PR-15: AI Decision Prompt and Schema Pack

### Review 1: Scope and Safety

- 범위는 Codex CLI paper decision prompt 분리, prompt version metadata, output JSON schema artifact에 한정했습니다.
- real Codex CLI 호출, live signal generation, live order path는 추가하지 않았습니다.
- prompt는 stdin `market_packet`만 사용하고 shell command, broker API, `tossctl`, real order 생성을 금지합니다.
- prompt는 weak/stale/missing evidence에서 `VIRTUAL_HOLD`를 선호하도록 명시합니다.
- scope 검색에서 financial advice/recommendation/performance guarantee는 금지 문구로만 존재함을 확인했습니다.

### Review 2: Tests and Validation

- `npm run build` 성공.
- `npm test` 성공.
- provider command가 prompt version과 guarded prompt를 포함하는 test 통과.
- prompt boundary wording test 통과.
- `schemas/virtual-decision.schema.json` action enum/additionalProperties test 통과.
- output schema path가 `schemas/virtual-decision.schema.json`으로 연결됨을 확인했습니다.

### Review 3: Diff and Integration

- `src/ai/decisionPrompt.ts`를 추가했습니다.
- `CodexCliDecisionProvider`가 prompt pack과 `promptVersion` preview를 사용하도록 변경했습니다.
- `schemas/virtual-decision.schema.json` artifact를 추가했습니다.
- `.env.example`에 `CODEX_OUTPUT_SCHEMA_PATH` 기본 예시를 추가했습니다.
- 기존 provider disabled, timeout, invalid JSON, budget guard 동작은 유지됩니다.

## PR-16: Paper Portfolio Analytics

### Review 1: Scope and Safety

- 범위는 local virtual portfolio/decision/trade 객체 기반 analytics 계산과 daily report 통합에 한정했습니다.
- 실계좌 PnL, broker reconciliation, performance guarantee, live account reporting은 추가하지 않았습니다.
- realized PnL은 broker-grade fills/cost basis가 필요하므로 명시적 `null` placeholder로 유지했습니다.
- analytics disclaimer는 paper-only virtual simulation이며 investment performance가 아니라고 명시합니다.
- scope 검색에서 성과/조언 관련 표현은 부정문 disclaimer와 placeholder 설명으로만 존재함을 확인했습니다.

### Review 2: Tests and Validation

- `npm run build` 성공.
- `npm test` 성공.
- exposure/allocation calculation test 통과.
- realized PnL placeholder and unrealized PnL summary test 통과.
- decision-to-trade linkage test 통과.
- daily report analytics integration test 통과.

### Review 3: Diff and Integration

- `src/analytics/paperPortfolioAnalytics.ts`와 tests를 추가했습니다.
- analytics는 cash allocation, position allocation, market exposure, symbol allocation을 계산합니다.
- decision/trade linkage는 packetId, market, symbol, action 기준으로 연결합니다.
- `src/reports/paperDailyReport.ts`가 analytics section을 렌더링하도록 통합했습니다.
- 외부 API, collector, Codex CLI, broker path와는 연결하지 않았습니다.

## PR-17: Replay and Backfill Simulation

### Review 1: Scope and Safety

- 범위는 저장된 `market_packet`과 `virtual_decision`을 재생하는 paper-only replay에 한정했습니다.
- replay runner는 `PaperOrderEngine`만 사용하며 process runner, `tossctl`, Codex CLI provider를 주입받지 않습니다.
- replay는 stored wrapper에서도 `virtual-portfolio.json`이나 `virtual-trades.jsonl`을 쓰지 않고 읽은 fixture로 결과만 반환합니다.
- stale packet과 packet mismatch는 simulation 전에 fail-closed로 처리합니다.
- 범위 검색에서 `tossctl`, `codex exec`, raw execution tool, live order flag, process spawn/exec 문자열이 PR-17 파일에 없음을 확인했습니다.

### Review 2: Tests and Validation

- `npm run build` 성공.
- `npm test` 성공.
- same fixture deterministic replay test 통과.
- stale market packet reject test 통과.
- packet mismatch reject test 통과.
- stored replay no-mutation test 통과.
- `npm run paper:replay -- --data-dir <temp-dir>`가 temp fixture에서 paper replay summary를 출력하고 repo 내부 `data/`를 생성하지 않음을 확인했습니다.

### Review 3: Diff and Integration

- `src/replay/paperReplay.ts`와 tests를 추가했습니다.
- replay result는 prompt version, risk decisions, virtual trades, rejected count, initial/final portfolio를 포함합니다.
- `src/cli/paperReplay.ts`와 `paper:replay` npm script를 추가했습니다.
- 저장소 wrapper는 latest market packet과 matching latest decision만 읽어 replay input을 구성합니다.
- historical downloader, backtest 성과 주장, live scheduler integration은 추가하지 않았습니다.

## PR-18: MCP Operations Extension

### Review 1: Scope and Safety

- 범위는 운영 조회용 MCP read-only tool 확장에 한정했습니다.
- 추가 tool은 `get_paper_report`, `get_scheduler_status`, `get_source_health`, `get_market_packets`입니다.
- 모든 추가 tool은 local store 또는 local state file read만 수행하며 scheduler run, collector run, Codex CLI 실행을 트리거하지 않습니다.
- tool annotations는 기존 helper를 통해 `readOnlyHint=true`, `destructiveHint=false`를 유지합니다.
- 범위 검색에서 `place_order`, `run_tossctl`, `run_codex_exec`는 부정 테스트와 기존 문서 기록에만 나타나며 enabled registry에는 포함되지 않음을 확인했습니다.

### Review 2: Tests and Validation

- `npm run build` 성공.
- `npm test` 성공.
- MCP tool list read-only/exclusion test 통과.
- `get_paper_report` handler test 통과.
- `get_scheduler_status` state/lock read test 통과.
- `get_source_health` source status summary test 통과.
- `get_market_packets` recent packet limit test 통과.

### Review 3: Diff and Integration

- `src/mcp/virtualPortfolioTools.ts`에 운영 조회 tool을 추가했습니다.
- `get_paper_report`는 기존 `buildPaperDailyReport`를 재사용합니다.
- `get_scheduler_status`는 `paper-scheduler-state.json`과 `paper-run.lock`만 읽고 실행을 호출하지 않습니다.
- `get_source_health`는 `tossinvest-sources.jsonl` 상태와 corrupt line count를 요약합니다.
- `get_market_packets`는 `market-packets.jsonl`의 최근 packet을 제한 개수만큼 반환합니다.

## PR-19: Local Operations API

### Review 1: Scope and Safety

- 범위는 local dashboard/API가 사용할 read-only HTTP API에 한정했습니다.
- Node built-in `http`만 사용했고 외부 server dependency는 추가하지 않았습니다.
- API는 `GET`/`HEAD`만 허용하며 mutation method는 `405 method_not_allowed`로 거부합니다.
- live order endpoint, live broker adapter, official Toss API adapter, collector trigger, Codex CLI trigger는 추가하지 않았습니다.
- 모든 JSON 응답은 `maskObject`를 거쳐 account/order-like 문자열을 masking합니다.

### Review 2: Tests and Validation

- `npm run build` 성공.
- `npm test` 성공.
- `/health`와 `/virtual/portfolio` JSON response test 통과.
- `/virtual/decisions` sensitive text masking test 통과.
- `/paper/report`와 `/scheduler/status` read-only endpoint test 통과.
- mutation method reject와 `/place_order` 404 test 통과.
- `node dist/cli/localOperationsApi.js --data-dir <temp-dir> --host 127.0.0.1 --port <temp-port>` smoke에서 `/health` 응답을 확인했습니다.

### Review 3: Diff and Integration

- `src/api/localOperationsServer.ts`와 tests를 추가했습니다.
- `src/cli/localOperationsApi.ts`와 `ops:api` npm script를 추가했습니다.
- `.env.example`에 `OPS_API_HOST=127.0.0.1`, `OPS_API_PORT=8787` safe local defaults를 추가했습니다.
- endpoints는 `/health`, `/virtual/portfolio`, `/virtual/decisions`, `/virtual/trades`, `/paper/report`, `/scheduler/status`만 제공합니다.
- API는 local paper store와 scheduler state file만 읽고 runtime state를 변경하지 않습니다.

## PR-20: Stored Market Packet Paper Run

### Review 1: Scope and Safety

- 범위는 저장된 latest `market_packet`을 paper-only AI decision과 virtual order simulation에 연결하는 workflow/CLI에 한정했습니다.
- workflow는 `market-packets.jsonl`을 읽고 기존 `PaperOrderEngine`으로만 가상 체결을 수행합니다.
- stale packet은 provider 호출 전에 fail-closed 처리합니다.
- `virtual_decision.packetId`가 selected packet과 다르면 decision/trade를 저장하지 않습니다.
- workflow 내부에서 `tossctl` 호출, collector 실행, MCP trigger, live order path, official API adapter는 추가하지 않았습니다.

### Review 2: Tests and Validation

- `npm run build` 성공.
- `npm test` 성공.
- stored packet success path가 decision/trade/portfolio/audit을 기록하는 test 통과.
- stale packet이 provider 호출 전에 실패하는 test 통과.
- packet mismatch가 decision/trade 저장 없이 실패하는 test 통과.
- dry-run provider가 stored candidate에서 paper decision을 만드는 test 통과.
- provider failure가 paper order를 만들지 않는 test 통과.

### Review 3: Diff and Integration

- `src/workflows/paperRunFromMarketPacket.ts`와 tests를 추가했습니다.
- `src/cli/paperRunFromMarketPacket.ts`를 추가했습니다.
- `paper:run-from-market-packet`, `paper:run-from-market-packet:dry` npm scripts를 추가했습니다.
- README demo에 TossInvest 조회 기반 paper-only 실행 경로를 추가했습니다.
- PR 계획 문서에 PR-20 범위를 추가했습니다.

## PR-21: Local Env Loading and Paper Hold Risk

### Review 1: Scope and Safety

- 범위는 local `.env` loading, local 실행 경로 문서화, paper-only HOLD risk 처리 보정에 한정했습니다.
- `.env`는 Git ignored 상태를 유지하고, `.env.example`에는 safe defaults만 둡니다.
- `TRADING_ENABLED=false`, `BROKER_PROVIDER=mock`, `CODEX_EXEC_SANDBOX=read-only` 경계를 유지합니다.
- live order path, official Toss Open API adapter, MCP-triggered collector/AI execution은 추가하지 않았습니다.
- `VIRTUAL_HOLD`는 주문을 만들지 않으므로 candidate price 필수 조건에서 제외하되, packet 밖 종목은 fail-closed 처리합니다.

### Review 2: Tests and Validation

- `npm test` 성공.
- `.env` load unit test 통과.
- 가격 없는 `VIRTUAL_HOLD` approved test 통과.
- packet 밖 decision rejected test 통과.
- `PaperOrderEngine`이 approved hold에서 portfolio를 변경하지 않는 test 통과.
- local `.env`만으로 `tossinvest:collect`, `market:ingest`, `paper:run-from-market-packet` smoke 성공.

### Review 3: Diff and Integration

- `src/config/loadEnv.ts`와 tests를 추가했습니다.
- env를 사용하는 CLI entrypoint와 MCP server entrypoint에서 `.env`를 자동으로 읽습니다.
- `.env.example`, README, Codex CLI paper trading 문서에 local env 사용 방식을 반영했습니다.
- `src/paper/riskEngine.ts`는 `VIRTUAL_CANDIDATE_NOT_FOUND`와 HOLD price exemption을 구분합니다.

## PR-22: Read-only Paper Dashboard Foundation

### Review 1: Scope and Safety

- 범위는 local read-only dashboard foundation과 dashboard에 필요한 read-only HTTP endpoint 확장에 한정했습니다.
- dashboard는 same-origin GET endpoint만 호출하며 `POST`, `PUT`, `DELETE` 같은 mutation method를 사용하지 않습니다.
- local operations server는 기존처럼 non-GET/HEAD 요청을 `405 method_not_allowed`로 거부합니다.
- dashboard-triggered collection, dashboard-triggered Codex run, live order endpoint, official Toss Open API adapter는 추가하지 않았습니다.
- UI는 paper-only 상태와 AI 판단 근거를 표시하지만 실주문처럼 오해될 수 있는 buy/sell 실행 버튼을 제공하지 않습니다.

### Review 2: Tests and Validation

- `npm test` 성공.
- dashboard asset serving test 통과.
- dashboard script에 mutation method 문자열이 없는지 test에서 확인했습니다.
- `/source/health` read-only response test 통과.
- `/market/packets` read-only response test 통과.
- `/place_order` 404와 mutation method 405 기존 test가 계속 통과했습니다.
- Chrome headless desktop screenshot에서 portfolio, source, AI decision, risk panel 렌더링을 확인했습니다.
- Chrome headless mobile screenshot에서 주요 패널과 긴 source command 줄바꿈을 확인했습니다.

### Review 3: Diff and Integration

- `dashboard/index.html`, `dashboard/styles.css`, `dashboard/app.js`를 추가했습니다.
- `src/api/localOperationsServer.ts`는 `/dashboard`, `/dashboard/app.js`, `/dashboard/styles.css` 정적 asset을 제공합니다.
- local API에 `/source/health`, `/market/packets`를 추가해 MCP read-only 조회와 HTTP dashboard 조회의 관측 범위를 맞췄습니다.
- `src/cli/localOperationsApi.ts`는 dashboard URL을 로그로 출력합니다.
- `package.json`에 `dashboard` script를 추가했습니다.
- README와 PR 계획 문서에 dashboard 실행 방법과 PR-22 범위를 반영했습니다.

## PR-23: AI Decision Timeline Filters

### Review 1: Scope and Safety

- 범위는 dashboard의 AI decision 탐색성 개선에 한정했습니다.
- action filter와 symbol filter는 client-side view state만 바꾸며 저장 데이터, paper run, collector, Codex CLI를 실행하지 않습니다.
- dashboard script는 기존 read-only endpoint fetch만 사용하고 mutation method를 추가하지 않았습니다.
- live order path, decision mutation, Risk Engine bypass는 추가하지 않았습니다.

### Review 2: Tests and Validation

- `npm test` 성공.
- dashboard asset test에서 action filter markup과 symbol filter markup을 확인했습니다.
- dashboard script에 `renderDecisionTimeline`이 포함되고 mutation method 문자열이 없는지 확인했습니다.
- Chrome headless desktop screenshot에서 action counts, symbol filter, per-symbol summary, expired indicator를 확인했습니다.
- Chrome headless mobile screenshot에서 filter control을 2열 layout으로 표시해 버튼 잘림을 방지했습니다.

### Review 3: Diff and Integration

- `dashboard/index.html`에 segmented action filter, symbol search, decision group 영역을 추가했습니다.
- `dashboard/app.js`는 decision records를 flatten한 뒤 action/symbol filter, action counts, per-symbol summary를 렌더링합니다.
- expired decision은 metadata에서 빨간 강조로 표시합니다.
- `dashboard/styles.css`는 desktop/mobile filter layout과 decision group summary 스타일을 추가했습니다.
- `src/api/localOperationsServer.test.ts`의 dashboard asset test를 PR-23 UI 요소까지 확장했습니다.

## PR-24: AI Decision Risk and Trade Linkage

### Review 1: Scope and Safety

- 범위는 AI decision card에 read-only audit/trade outcome을 연결하는 데 한정했습니다.
- `/audit/events`는 local audit JSONL을 읽기만 하며 `maskObject`를 거쳐 응답합니다.
- dashboard는 `/audit/events`, `/virtual/trades`, 기존 read-only endpoint만 호출하고 mutation method를 추가하지 않았습니다.
- Risk Engine 결과를 표시만 하며 risk policy, decision, portfolio, ledger를 수정하지 않습니다.
- live order path, dashboard-triggered paper run, collector trigger는 추가하지 않았습니다.

### Review 2: Tests and Validation

- `npm test` 성공.
- `/audit/events` endpoint test에서 recent event count와 masking을 확인했습니다.
- dashboard asset test에서 `/audit/events` fetch와 `decisionOutcomeRow` 렌더링 경로를 확인했습니다.
- Chrome headless desktop screenshot에서 decision card의 `risk APPROVED`와 `no virtual trade` badge를 확인했습니다.
- Chrome DevTools Protocol 측정에서 mobile `innerWidth=390`, `document.scrollWidth=390`, decision card width가 viewport 안에 있음을 확인했습니다.

### Review 3: Diff and Integration

- `src/api/localOperationsServer.ts`에 `/audit/events` read-only endpoint를 추가했습니다.
- `src/api/localOperationsServer.test.ts`에 masked audit events test를 추가했습니다.
- `dashboard/app.js`는 decision item과 recent audit/trade records를 packet, market, symbol, action 기준으로 연결합니다.
- `dashboard/styles.css`는 risk/trade outcome badge와 모바일 줄바꿈 보정을 추가했습니다.
- PR-24 계획과 검토 기록을 문서에 반영했습니다.

## PR-25: Dashboard Daily Paper Report

### Review 1: Scope and Safety

- 범위는 기존 `/paper/report` 응답을 dashboard에서 더 명확히 표시하는 데 한정했습니다.
- 새 HTTP endpoint, collector trigger, Codex CLI trigger, paper run trigger는 추가하지 않았습니다.
- dashboard는 기존 same-origin GET endpoint만 사용하고 mutation method를 추가하지 않았습니다.
- 리포트는 paper-only summary와 disclaimer를 표시하며 투자 조언이나 수익 보장 표현을 추가하지 않았습니다.
- live account reporting, live order path, report editing UI는 추가하지 않았습니다.

### Review 2: Tests and Validation

- dashboard asset test에서 daily report heading/detail markup을 확인합니다.
- dashboard asset test에서 `/paper/report` fetch와 `renderDailyReport` 렌더링 경로를 확인합니다.
- dashboard script에 `POST`, `PUT`, `DELETE` 문자열이 없는지 기존 검증을 유지합니다.
- full test suite로 API read-only 경계와 기존 dashboard asset serving을 함께 확인합니다.
- desktop/mobile screenshot으로 report panel layout을 확인합니다.

### Review 3: Diff and Integration

- `dashboard/index.html`에 `오늘 리포트` panel을 추가했습니다.
- `dashboard/app.js`는 report decision/trade/risk/source KPI와 detail list를 렌더링합니다.
- `dashboard/styles.css`는 report panel grid와 모바일 1열 전환을 추가했습니다.
- `src/api/localOperationsServer.test.ts`의 dashboard asset test를 PR-25 UI 요소까지 확장했습니다.
- PR-25 계획과 검토 기록을 문서에 반영했습니다.

## PR-26: AI Decision Evidence Layout

### Review 1: Scope and Safety

- 범위는 dashboard decision card의 설명성 개선에 한정했습니다.
- 새 decision schema field를 만들지 않고 기존 `thesis`, `riskFactors`, `dataRefs`, `confidence`, `budgetKrw`, `expiresAt`, `packetId`만 표시합니다.
- AI decision, risk decision, trade, portfolio, report 데이터를 수정하지 않습니다.
- dashboard-triggered Codex run, paper run, live order path는 추가하지 않았습니다.
- Buy/Sell/Hold 판단 근거를 표시하지만 투자 조언이나 성과 보장 문구를 추가하지 않았습니다.

### Review 2: Tests and Validation

- dashboard asset test에서 `decisionRationale` renderer와 `Risk Factors` section을 확인합니다.
- dashboard script에 `POST`, `PUT`, `DELETE` 문자열이 없는지 기존 검증을 유지합니다.
- full test suite로 API read-only 경계와 dashboard asset serving을 확인합니다.
- desktop/mobile screenshot에서 decision evidence layout과 줄바꿈을 확인합니다.
- mobile viewport에서 가로 overflow가 없는지 확인합니다.

### Review 3: Diff and Integration

- `dashboard/app.js`는 decision card 본문을 rationale/evidence block으로 구조화했습니다.
- `dashboard/styles.css`는 evidence section, risk factor list, decision context line 스타일을 추가했습니다.
- `src/api/localOperationsServer.test.ts`의 dashboard asset test를 PR-26 렌더링 요소까지 확장했습니다.
- PR-26 계획과 검토 기록을 문서에 반영했습니다.

## PR-27: Dashboard Partial Failure UX and Runbook

### Review 1: Scope and Safety

- 범위는 dashboard의 read-only endpoint 조회 실패 표시와 README dashboard 설명 갱신에 한정했습니다.
- dashboard는 endpoint를 독립적으로 조회하되 기존 same-origin GET fetch만 사용합니다.
- 실패한 endpoint가 있어도 collection, ingestion, paper run, Codex CLI run을 자동으로 재시도하거나 실행하지 않습니다.
- local operations server endpoint나 저장소 mutation 경로는 변경하지 않았습니다.
- live order path와 report/decision editing UI는 추가하지 않았습니다.

### Review 2: Tests and Validation

- dashboard asset test에서 `fetchEndpointData`와 `endpointFailures` helper를 확인합니다.
- dashboard script에 `POST`, `PUT`, `DELETE` 문자열이 없는지 기존 검증을 유지합니다.
- full test suite로 API read-only 경계와 dashboard asset serving을 확인합니다.
- browser normal load에서 상태 pill이 정상 연결 상태로 표시되는지 확인합니다.
- README endpoint 목록이 dashboard fetch 목록과 일치하는지 확인합니다.

### Review 3: Diff and Integration

- `dashboard/app.js`는 endpoint별 실패를 `{ error }`로 격리하고 가능한 데이터는 계속 렌더링합니다.
- 실패 endpoint가 있으면 header status를 `부분 연결`로 표시하고 오류 배너에 endpoint key를 표시합니다.
- `src/api/localOperationsServer.test.ts`의 dashboard asset test를 partial failure helper까지 확장했습니다.
- README dashboard 설명에 `/audit/events`와 부분 실패 표시 동작을 반영했습니다.
- PR-27 계획과 검토 기록을 문서에 반영했습니다.

## PR-28: Historical Market Data Store

### Review 1: Scope and Safety

- 범위는 historical market snapshot schema, JSONL store path, read-up-to query에 한정했습니다.
- historical downloader, replay runner, Codex CLI execution, dashboard trigger는 추가하지 않았습니다.
- `readUpTo`는 `asOf` 이후 snapshot을 제외해 lookahead를 막는 저장소 조회 계층입니다.
- 이 PR은 market data 조회 기반만 추가하며 portfolio, decision, risk, trade state를 수정하지 않습니다.
- live order path, raw `tossctl` MCP tool, raw `codex exec` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- historical snapshot schema validation test를 추가했습니다.
- high/low price inversion reject test를 추가했습니다.
- `asOf` 이후 historical snapshot exclusion test를 추가했습니다.
- from/symbol filter와 corrupt JSONL line handling test를 추가했습니다.
- full test suite로 기존 read-only API/MCP/risk 경계를 함께 확인합니다.

### Review 3: Diff and Integration

- `src/domain/schemas.ts`에 `HistoricalMarketSnapshot` contract를 추가했습니다.
- `src/storage/repositories.ts`에 `historical-market-snapshots.jsonl` path와 `FileHistoricalMarketSnapshotStore`를 추가했습니다.
- `readUpTo`는 observed time, market, symbol, snapshot id 기준으로 deterministic sort를 수행합니다.
- PR-28부터 PR-36까지 historical accelerated replay 계획을 implementation plan에 반영했습니다.

## PR-29: Simulated Clock and Replay Window

### Review 1: Scope and Safety

- 범위는 replay 전용 simulated clock과 session window guard에 한정했습니다.
- 실제 `setInterval`, background worker, OS scheduler, realtime trading loop는 추가하지 않았습니다.
- `speedMultiplier`는 metadata로만 보관하고 sleep, timer, process execution을 만들지 않습니다.
- AI decision, paper order execution, portfolio mutation, dashboard UI는 변경하지 않았습니다.
- live order path, raw `tossctl` MCP tool, raw `codex exec` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- inclusive tick progression test를 추가했습니다.
- market session 밖 timestamp skip test를 추가했습니다.
- weekday-only session guard test를 추가했습니다.
- invalid replay window, invalid step, invalid session time reject test를 추가했습니다.
- full test suite로 기존 paper/risk/dashboard 경계를 함께 확인합니다.

### Review 3: Diff and Integration

- `src/replay/simulatedClock.ts`에 `SimulatedClock`, `ReplaySessionWindow`, `SimulatedTick`을 추가했습니다.
- session guard는 configured timezone offset으로 local HH:mm을 계산해 replay window를 필터링합니다.
- clock은 입력 `Date`만 사용하므로 real clock 의존 없이 deterministic하게 동작합니다.
- PR-30 historical packet builder가 이 clock의 `simulatedAt` tick을 기준 시간으로 사용할 수 있습니다.

## PR-30: Historical Market Packet Builder

### Review 1: Scope and Safety

- 범위는 historical snapshot을 paper-only `MarketPacket` 후보로 변환하는 계층에 한정했습니다.
- 기존 `MarketPacketBuilder`를 재사용해 packet schema, virtual portfolio snapshot, constraints contract를 유지했습니다.
- simulated time 이후 snapshot은 후보에서 제외하고 warning으로만 남깁니다.
- stale snapshot만 있는 경우 packet을 만들지 않고 `NO_HISTORICAL_CANDIDATES`로 fail-closed합니다.
- Codex CLI execution, paper order execution, dashboard trigger, live order path는 추가하지 않았습니다.

### Review 2: Tests and Validation

- future snapshot exclusion test를 추가했습니다.
- latest snapshot per symbol selection test를 추가했습니다.
- max candidates deterministic trimming test를 추가했습니다.
- all stale snapshots fail-closed test를 추가했습니다.
- full test suite로 기존 market packet, risk, dashboard, MCP 경계를 함께 확인합니다.

### Review 3: Diff and Integration

- `src/market/historicalPacketBuilder.ts`를 추가했습니다.
- historical candidate sourceRefs는 `historical_snapshot:<snapshotId>`와 원 source refs를 포함합니다.
- candidate freshness는 snapshot `observedAt + maxSnapshotAgeSeconds`로 계산합니다.
- PR-31 replay runner는 이 builder를 simulated clock tick마다 호출할 수 있습니다.

## PR-31: Accelerated Replay Runner Without AI

### Review 1: Scope and Safety

- 범위는 in-memory historical replay runner와 deterministic non-AI decision provider에 한정했습니다.
- Codex CLI execution, `tossctl` execution, file persistence, dashboard trigger, live order path는 추가하지 않았습니다.
- runner는 `SimulatedClock`, `HistoricalMarketPacketBuilder`, `PaperOrderEngine`을 연결하되 실시간 loop를 소유하지 않습니다.
- Risk Engine은 기존 `PaperOrderEngine` 내부 gate를 그대로 사용하며 reject 시 portfolio mutation이 없습니다.
- replay 결과는 paper-only virtual portfolio/timeline/audit 배열로만 반환합니다.

### Review 2: Tests and Validation

- same input same output deterministic replay test를 추가했습니다.
- risk reject leaves portfolio unchanged test를 추가했습니다.
- future-only snapshot skip packet test를 추가했습니다.
- full test suite로 기존 paper replay, dashboard, MCP, risk 경계를 함께 확인합니다.
- scope search로 raw execution/live order 경로가 추가되지 않았는지 확인합니다.

### Review 3: Diff and Integration

- `src/replay/historicalReplayRunner.ts`를 추가했습니다.
- `FirstPricedHistoricalDecisionProvider`는 AI 없이 첫 priced candidate만 deterministic virtual buy fixture로 변환합니다.
- runner는 packet, decision, risk decision, trade, audit event, portfolio timeline을 반환합니다.
- PR-32에서는 이 runner의 provider 경계에 Codex CLI paper-only provider를 연결할 수 있습니다.

## PR-32: Codex AI Historical Decision Provider

### Review 1: Scope and Safety

- 범위는 existing Codex CLI paper-only provider를 historical replay에서 사용할 adapter와 prompt guard에 한정했습니다.
- adapter는 raw `codex exec` tool을 노출하지 않고 delegate provider의 `decide(packet)`만 호출합니다.
- prompt는 `packet.generatedAt`을 simulated current time으로 취급하고 미래 데이터 사용을 금지합니다.
- replay별 max Codex call budget을 adapter에서 추가로 제한합니다.
- live `TradingSignal`, live `OrderIntent`, dashboard-triggered AI run, live order path는 추가하지 않았습니다.

### Review 2: Tests and Validation

- historical replay prompt no-lookahead wording test를 추가했습니다.
- config helper가 `sandbox: read-only`와 historical prompt version을 유지하는지 확인했습니다.
- decision packet mismatch fail-closed test를 추가했습니다.
- max calls per replay budget enforcement test를 추가했습니다.
- full test suite로 기존 Codex provider disabled/budget/read-only command tests를 함께 확인합니다.

### Review 3: Diff and Integration

- `src/replay/codexHistoricalDecisionProvider.ts`를 추가했습니다.
- `withHistoricalReplayPrompt`는 기존 `CodexCliDecisionProviderConfig`에 historical replay prompt/version을 주입합니다.
- `CodexHistoricalReplayDecisionProvider`는 delegate result를 검증하고 packet mismatch를 `AI_DECISION_FAILED`로 반환합니다.
- PR-33 sampling policy는 이 adapter의 `maxCallsPerReplay`와 함께 AI 호출 빈도를 제한할 수 있습니다.

## PR-33: Replay Speed and Sampling Policy

### Review 1: Scope and Safety

- 범위는 historical replay에서 decision provider 호출 빈도를 제한하는 sampling policy와 runner hook에 한정했습니다.
- policy는 packet 생성 이후 provider 호출 전 gate로 동작하며 live trading signal이나 order intent를 생성하지 않습니다.
- raw `codex exec`, raw `tossctl`, dashboard-triggered replay/AI run은 추가하지 않았습니다.
- skipped step은 portfolio를 변경하지 않고 audit event와 sampling decision record만 남깁니다.
- replay speed는 real timer가 아니라 simulated tick progression metadata로만 유지합니다.

### Review 2: Tests and Validation

- every N steps policy가 deterministic하게 provider 호출 수를 제한하는지 검증했습니다.
- candidate changed only policy가 동일 candidate fingerprint를 skip하는지 검증했습니다.
- once per day/once per week policy가 simulated local date 기준으로 동작하는지 검증했습니다.
- max decision calls budget이 provider 호출 전 fail-closed skip으로 동작하는지 검증했습니다.
- runner integration test로 sampled-out step에서 portfolio가 유지되고 skip audit이 남는지 확인합니다.

### Review 3: Diff and Integration

- `src/replay/replaySamplingPolicy.ts`를 추가해 sampling 상태와 metadata를 runner 밖으로 분리했습니다.
- `runHistoricalReplay`는 optional `samplingPolicy`를 받아 decision provider 호출 전 `shouldEvaluate`를 확인합니다.
- 결과에는 `decisionProviderCallCount`, `decisionSkippedCount`, `samplingDecisions`, `progressSummary`를 추가했습니다.
- default path는 sampling policy가 없으면 기존처럼 모든 packet에서 decision provider를 호출합니다.

## PR-34: Historical Replay Report

### Review 1: Scope and Safety

- 범위는 `HistoricalReplayResult`를 paper-only 리포트 구조와 마크다운 문자열로 변환하는 read-only report layer에 한정했습니다.
- 리포트는 replay 결과를 요약할 뿐 외부 API, Codex CLI, TossInvest CLI, live order path를 호출하지 않습니다.
- 리포트 문구는 paper-only historical replay simulation으로 제한하고 투자 조언/성과 보장 표현을 금지했습니다.
- 민감한 계좌번호/order-like 문자열은 기존 `maskSensitiveText`를 통해 렌더 단계에서 마스킹합니다.
- final virtual net worth는 가상 포트폴리오 상태 요약이며 투자 성과 주장으로 표현하지 않습니다.

### Review 2: Tests and Validation

- replay summary, final virtual portfolio, decision outcome, trade summary를 fixture replay 결과로 검증했습니다.
- sampling skip reason과 provider call count가 리포트에 반영되는지 검증했습니다.
- future snapshot warning count와 lookahead guard status가 리포트에 반영되는지 검증했습니다.
- rendered report가 계좌번호/order-like 값을 마스킹하는지 검증했습니다.
- disclaimer에 `not financial advice`, `not a performance guarantee`, `cannot place live orders`가 유지되는지 확인합니다.

### Review 3: Diff and Integration

- `src/reports/historicalReplayReport.ts`를 추가했습니다.
- 기존 `buildPaperPortfolioAnalytics`와 `maskSensitiveText`를 재사용했습니다.
- report 입력은 in-memory `HistoricalReplayResult`이며 저장소 mutation이나 dashboard-triggered replay를 추가하지 않았습니다.
- PR-35에서는 이 report shape을 read-only dashboard/API 조회용으로 노출할 수 있습니다.

## PR-35: Dashboard Replay View

### Review 1: Scope and Safety

- 범위는 저장된 historical replay report를 read-only API와 dashboard panel로 조회하는 데 한정했습니다.
- `/replay/report`는 `historical-replay-report.json`을 읽기만 하며 replay 실행, Codex CLI 실행, TossInvest CLI 실행을 트리거하지 않습니다.
- dashboard에는 replay 실행 버튼, paper run 버튼, collector trigger, live order control을 추가하지 않았습니다.
- endpoint는 기존 local operations server의 GET/HEAD read-only method guard 안에서 동작합니다.
- 응답은 기존 `maskObject` 경로를 통과하므로 account/order-like 문자열이 마스킹됩니다.

### Review 2: Tests and Validation

- dashboard asset test에서 replay heading, timeline table, `/replay/report` fetch, `renderReplayReport`/`renderReplayTimeline` 경로를 확인합니다.
- `/replay/report` endpoint test에서 stored report를 read-only로 반환하는지 확인합니다.
- endpoint test에서 stored report 내부 계좌번호/order-like 문자열이 응답에서 마스킹되는지 확인합니다.
- dashboard script에 `POST`, `PUT`, `DELETE` 문자열이 없는 기존 검증을 유지합니다.
- full test suite로 기존 dashboard, API, paper report, replay report 경계를 함께 확인합니다.

### Review 3: Diff and Integration

- `StoragePaths`에 `historicalReplayReportPath`를 추가했습니다.
- `src/api/localOperationsServer.ts`에 `/replay/report` read-only endpoint를 추가했습니다.
- `dashboard/index.html`에 historical replay summary/timeline panel을 추가했습니다.
- `dashboard/app.js`는 저장된 replay report status, summary, sampling, lookahead warning, portfolio timeline을 렌더링합니다.
- `README.md` dashboard endpoint 목록에 `/replay/report`와 dashboard-triggered replay 제외 문구를 반영했습니다.

## PR-36: Historical Replay Workflow and CLI

### Review 1: Scope and Safety

- 범위는 저장된 `historical-market-snapshots.jsonl`을 읽어 paper-only historical replay를 실행하고 `historical-replay-report.json`을 쓰는 local CLI/workflow에 한정했습니다.
- CLI는 live order, official Toss API, TossInvest CLI collector, dashboard-triggered replay를 추가하지 않습니다.
- dry-run path는 deterministic fixture decision provider를 사용하고 AI 호출을 수행하지 않습니다.
- Codex path는 기존 `CodexCliDecisionProvider`를 historical no-lookahead prompt와 `sandbox: read-only` config로 감싼 뒤 paper-only decision result만 처리합니다.
- provider failure나 packet mismatch는 paper order 없이 audit event와 timeline만 남기고 넘어갑니다.

### Review 2: Tests and Validation

- async Codex-style replay runner가 mocked provider decision을 paper Risk Engine/OrderEngine에 연결하는지 검증했습니다.
- provider failure가 paper order를 만들지 않고 portfolio를 유지하는지 검증했습니다.
- storage workflow가 historical snapshots를 읽고 stored historical replay report JSON을 쓰는지 검증했습니다.
- `npm test`로 128개 테스트 통과를 확인했습니다.
- `npm run historical:replay:dry -- data\\replay-cli-smoke 2025-01-02T09:00:00+09:00 2025-01-02T09:01:00+09:00 60 2` smoke 성공을 확인했습니다.

### Review 3: Diff and Integration

- `src/replay/codexHistoricalReplayRunner.ts`를 추가해 async Codex-style provider를 replay loop에 연결했습니다.
- `src/workflows/historicalReplayWorkflow.ts`를 추가해 storage read, replay execution, report write를 orchestration합니다.
- `src/cli/historicalReplay.ts`와 `historical:replay`, `historical:replay:dry` npm scripts를 추가했습니다.
- CLI는 positional fallback을 지원해 npm argument forwarding에서 option name이 제거되는 경우에도 실행할 수 있습니다.
- README에 historical replay dry-run/Codex path 실행 예시를 추가했습니다.

## PR-37: Final Historical Replay Safety Audit

### Review 1: Scope and Safety

- 범위는 historical replay의 lookahead guard, wall-clock dependency, 문서화 상태를 최종 점검하는 데 한정했습니다.
- live trading, official Toss API adapter, order router, dashboard-triggered replay, raw command MCP tool은 추가하지 않았습니다.
- future snapshot이 현재 simulated tick의 packet, decision, trade, final portfolio에 영향을 주지 않는지 별도 safety test를 추가했습니다.
- core replay module에서 `Date.now()`와 인자 없는 `new Date()`를 사용하지 않는지 static safety test를 추가했습니다.
- 문서에는 paper-only, no investment advice, no performance guarantee, no live order boundary를 유지했습니다.

### Review 2: Tests and Validation

- future snapshot이 excluded warning으로만 남고 현재 tick candidate에 포함되지 않는지 검증했습니다.
- future snapshot이 추가되어도 single-tick replay final portfolio와 trade symbol이 baseline과 동일한지 검증했습니다.
- `historicalReplayRunner`, `codexHistoricalReplayRunner`, `historicalPacketBuilder`, `simulatedClock`에 current wall-clock API 사용이 없는지 검증했습니다.
- full test suite로 historical store, packet builder, replay runner, Codex adapter, workflow, dashboard 경계를 함께 확인합니다.
- safety grep으로 live order/raw MCP execution/realtime loop 패턴을 다시 확인합니다.

### Review 3: Diff and Integration

- `src/replay/historicalReplaySafety.test.ts`를 추가했습니다.
- `docs/historical-replay.md`를 추가해 input/output, flow, 실행 방법, lookahead guard, safety boundary, dashboard 조회 방식을 정리했습니다.
- README에 historical replay 문서 링크를 추가했습니다.
- PR-28부터 PR-37까지의 historical accelerated replay slice가 dashboard 조회까지 연결됐습니다.

## PR-38: AI Decision Semantic Validation

### Review 1: Scope and Safety

- 범위는 paper-only AI decision을 저장 또는 가상 체결 전에 packet 근거와 대조하는 semantic validator에 한정했습니다.
- live trading, broker adapter, raw `codex exec` MCP tool, raw `tossctl` MCP tool, AI-driven live signal/order intent 경로는 추가하지 않았습니다.
- validator는 `packetId`, candidate presence, allowed action, duplicate `market:symbol`, candidate `sourceRefs` 기반 `dataRefs` 검증만 수행합니다.
- semantic reject는 `VIRTUAL_DECISION_REJECTED` audit event로 기록하고, decision/trade 저장 및 portfolio mutation 전에 fail closed 처리합니다.

### Review 2: Tests and Validation

- validator unit tests에서 valid decision, packet mismatch, packet 밖 symbol, hallucinated `dataRefs`, cross-symbol `dataRefs`, duplicate decision, disallowed action을 검증했습니다.
- one-shot paper run과 stored market packet run에서 semantic-invalid decision이 `virtual-decisions.jsonl`과 `virtual-trades.jsonl`에 저장되지 않는지 검증했습니다.
- historical Codex replay provider에서 hallucinated `dataRefs`가 `AI_DECISION_FAILED`로 변환되어 replay order execution으로 넘어가지 않는지 검증했습니다.
- `npm test`로 전체 test suite 통과를 확인했습니다.

### Review 3: Diff and Integration

- `src/paper/virtualDecisionValidation.ts`를 추가해 `VirtualDecision`과 `MarketPacket` 사이의 semantic validation을 독립 모듈로 분리했습니다.
- `src/workflows/paperRunOnce.ts`와 `src/workflows/paperRunFromMarketPacket.ts`는 AI decision 저장 전에 validator를 호출합니다.
- `src/replay/codexHistoricalDecisionProvider.ts`는 delegate decision을 historical replay runner에 반환하기 전에 같은 validator를 적용합니다.
- 기존 v1 `virtual_decision` schema와 paper-only storage file format은 변경하지 않았으며, HOLD reason code와 backend sizing 전환은 후속 PR로 남겼습니다.

## PR-39: Virtual Hold Reason Code

### Review 1: Scope and Safety

- 범위는 paper-only `VIRTUAL_HOLD` 판단에 machine-readable 보류 사유를 붙이는 contract/gate 변경에 한정합니다.
- `holdReasonCode`는 optional schema field로 추가해 기존 저장된 v1 decision 읽기 호환성을 유지합니다.
- 새 AI output은 semantic validator에서 `VIRTUAL_HOLD`의 `holdReasonCode` 누락을 fail-closed 처리합니다.
- BUY/SELL에 `holdReasonCode`가 붙으면 abstention 사유 오용으로 reject합니다.
- live trading, broker adapter, raw `codex exec` MCP tool, raw `tossctl` MCP tool, dashboard-triggered AI run은 추가하지 않습니다.

### Review 2: Tests and Validation

- schema test에서 허용된 `holdReasonCode` parse와 unknown reason reject를 검증했습니다.
- validator unit test에서 HOLD reason 누락 reject를 검증했습니다.
- validator unit test에서 non-HOLD reason code 오용 reject를 검증했습니다.
- `runPaperDecisionOnce` workflow test에서 HOLD reason 누락 decision이 storage 전에 reject되는지 검증했습니다.
- Codex prompt test에서 HOLD reason code 요구와 BUY/SELL 금지 문구를 검증했습니다.
- JSON schema artifact test에서 `holdReasonCode` enum을 검증했습니다.
- `npm test`로 전체 test suite 167개 통과를 확인했습니다.

### Review 3: Diff and Integration

- `src/domain/schemas.ts`에 `virtualHoldReasonCodeSchema`와 optional `holdReasonCode`를 추가했습니다.
- `schemas/virtual-decision.schema.json`은 HOLD decision에 `holdReasonCode`를 조건부 required로 요구합니다.
- `src/paper/virtualDecisionValidation.ts`는 workflow 저장 전에 HOLD reason 누락 및 non-HOLD 오용을 reject합니다.
- `src/ai/decisionPrompt.ts`는 `paper-v4`로 version을 올리고 HOLD reason code 출력을 요구합니다.
- 변경 코드 파일 safety grep에서 live order/raw MCP execution/process execution 경로가 추가되지 않았음을 확인했습니다.
- 이번 PR은 hold reason distribution report/dashboard 표시는 포함하지 않고 후속 PR로 남깁니다.

## PR-40: Virtual Decision Packet Hash Binding

### Review 1: Scope and Safety

- 범위는 paper-only AI decision과 입력 `marketPacket`의 내용 바인딩을 강화하는 데 한정합니다.
- `packetHash`는 stable JSON 기반 `sha256:<hex>` 문자열이며, broker/order/risk sizing 권한을 추가하지 않습니다.
- zod schema는 기존 저장된 v1 decision read path 호환을 위해 optional field로 확장합니다.
- Codex output schema artifact와 semantic validator는 신규 AI output에 `packetHash`를 요구합니다.
- live trading, broker adapter, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않습니다.

### Review 2: Tests and Validation

- packet hash helper test에서 object key order와 무관한 deterministic hash를 검증했습니다.
- packet 내용 변경 시 hash가 변경되는지 검증했습니다.
- validator unit test에서 missing `packetHash` reject를 검증했습니다.
- validator unit test에서 같은 `packetId`지만 내용이 다른 packet hash mismatch reject를 검증했습니다.
- workflow test에서 `packetHash` mismatch decision이 storage 전에 reject되는지 검증했습니다.
- Codex CLI provider test에서 stdin envelope에 `packetHash`와 `marketPacket`이 포함되는지 검증했습니다.
- `npm test`로 전체 test suite 172개 통과를 확인했습니다.

### Review 3: Diff and Integration

- `src/market/packetHash.ts`를 추가해 packet hash 계산을 순수 함수로 분리했습니다.
- `src/ai/codexCliDecisionProvider.ts`는 stdin을 `{ packetHash, marketPacket }` envelope로 전달합니다.
- `src/paper/virtualDecisionValidation.ts`는 `packetHash` 누락과 mismatch를 semantic reject로 처리합니다.
- `StaticDecisionProvider`와 `MarketPacketDryRunDecisionProvider`는 dry-run fixture가 현재 packet hash를 포함하도록 바인딩합니다.
- `schemas/virtual-decision.schema.json`은 top-level `packetHash`를 required로 요구합니다.
- 이번 PR은 promptVersion/modelId/policyVersion audit metadata와 normalized order layer는 포함하지 않고 후속 PR로 남깁니다.

## PR-41: Virtual Decision Identity Metadata

### Review 1: Scope and Safety

- 범위는 paper-only AI decision의 prompt/model/schema/policy version metadata를 기록하고 누락을 reject하는 데 한정합니다.
- metadata는 audit/provenance 목적이며 order routing, broker adapter, live signal 생성 권한을 추가하지 않습니다.
- zod schema는 기존 저장 decision read path 호환을 위해 optional field로 확장합니다.
- Codex output schema artifact와 semantic validator는 신규 AI output에 identity metadata를 요구합니다.
- live trading, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않습니다.

### Review 2: Tests and Validation

- Codex CLI provider test에서 stdin envelope에 `promptVersion`, `modelId`, `schemaVersion`, `policyVersion`이 포함되는지 검증했습니다.
- prompt test에서 identity metadata 복사 지시를 검증했습니다.
- output schema artifact test에서 identity metadata required를 검증했습니다.
- validator unit test에서 identity metadata 누락 decision reject를 검증했습니다.
- historical Codex adapter fixture가 metadata gate를 통과하도록 보강했습니다.
- `npm test`로 전체 test suite 173개 통과를 확인했습니다.

### Review 3: Diff and Integration

- `src/paper/decisionIdentity.ts`를 추가해 version metadata 기본값과 static fixture metadata를 분리했습니다.
- `src/ai/codexCliDecisionProvider.ts`는 packet envelope에 identity metadata를 함께 전달합니다.
- `src/paper/virtualDecisionValidation.ts`는 metadata 누락을 `VIRTUAL_DECISION_IDENTITY_METADATA_REQUIRED`로 reject합니다.
- `StaticDecisionProvider`와 `MarketPacketDryRunDecisionProvider`는 static fixture metadata를 자동 바인딩합니다.
- `schemas/virtual-decision.schema.json`은 신규 Codex output에서 identity metadata를 required로 요구합니다.
- 이번 PR은 metadata value registry, side-by-side model evaluation, normalized order layer는 포함하지 않습니다.

## PR-42: Virtual Decision Normalizer and Backend Sizing

### Review 1: Scope and Safety

- 범위는 paper-only AI decision raw sizing hint를 backend-computed `NormalizedVirtualOrder`로 변환하는 정규화 계층에 한정합니다.
- `DecisionNormalizer`는 BUY budget을 packet constraint로 cap하고, SELL sizing은 현재 virtual position과 candidate price를 기준으로 reduce-only notional로 변환합니다.
- `VirtualRiskEngine`과 `PaperOrderEngine`은 raw AI `budgetKrw`, `sellQuantity`, `sellRatio`, `targetWeightPct`, `sellAll`을 직접 해석하지 않고 normalizer가 만든 `targetNotionalKrw`를 사용합니다.
- schema v1 compatibility를 위해 기존 decision fields는 제거하지 않고, raw AI sizing은 backend sizing input hint로만 유지합니다.
- live trading, broker adapter, `TradingSignal`, `OrderIntent`, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- `DecisionNormalizer` unit test에서 BUY budget cap, SELL ratio sizing, oversize SELL quantity clip, HOLD zero-notional reduce-only 처리를 검증했습니다.
- `PaperOrderEngine` integration test에서 oversize reduce-only SELL quantity가 현재 position 수량으로 clip되어 virtual position을 초과 매도하지 않는지 검증했습니다.
- 기존 `VirtualRiskEngine` cash reserve와 NAV weight reject test는 packet cap이 Risk 조건을 가리지 않도록 packet constraint를 명시적으로 조정했습니다.
- historical Codex replay risk rejection test도 packet cap이 의도한 rejection을 숨기지 않도록 replay constraint를 조정했습니다.
- `npm test`로 전체 test suite 178개 통과를 확인했습니다.

### Review 3: Diff and Integration

- `src/paper/decisionNormalizer.ts`와 `src/paper/decisionNormalizer.test.ts`를 추가했습니다.
- legacy `src/paper/decisionSizing.ts`를 제거하고, Risk/Order notional source를 `normalizeVirtualDecision(input).targetNotionalKrw`로 통일했습니다.
- SELL oversize는 Risk reject 전에 backend normalizer에서 available virtual position value로 clip되므로 paper execution이 position을 음수로 만들지 않습니다.
- Codex CLI paper trading 문서는 raw AI sizing hint와 backend normalized sizing의 책임 경계를 설명하도록 갱신했습니다.
- 이번 PR은 confidence decomposition, normalized order persistence, decision schema v2 전환은 포함하지 않고 후속 PR로 남깁니다.

## PR-43: Market Packet Candidate Action Eligibility

### Review 1: Scope and Safety

- 범위는 paper-only `market_packet` candidate에 policy-safe action eligibility metadata를 추가하는 데 한정합니다.
- `buyEligible`, `sellEligible`, `blockedReasonCodes`, `budgetTierAllowed`, `positionExists`, `cooldownActive`는 AI가 policy 범위 밖 BUY/SELL proposal을 덜 내도록 돕는 입력 metadata입니다.
- `MarketPacketBuilder`는 virtual portfolio와 packet constraints로 계산 가능한 eligibility만 채웁니다.
- `VirtualDecision` schema v1의 raw sizing fields는 이번 PR에서 제거하지 않습니다.
- live trading, broker adapter, live `TradingSignal`, live `OrderIntent`, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- `MarketPacketBuilder` test에서 empty portfolio candidate가 BUY eligible, SELL ineligible로 생성되는지 검증했습니다.
- `MarketPacketBuilder` test에서 기존 position candidate가 SELL eligible로 생성되고, `maxNewPositions`에 도달한 신규 candidate BUY가 blocked되는지 검증했습니다.
- semantic validator test에서 `buyEligible=false` candidate에 대한 `VIRTUAL_BUY` decision이 `VIRTUAL_DECISION_ACTION_NOT_ELIGIBLE`로 reject되는지 검증했습니다.
- Codex prompt test에서 eligibility fields와 ineligible action 금지 지시가 포함되는지 검증했습니다.
- `npm test`로 전체 test suite 181개 통과를 확인했습니다.

### Review 3: Diff and Integration

- `src/domain/schemas.ts`의 `MarketCandidate` schema에 optional eligibility fields와 `VirtualBudgetTier`를 추가했습니다.
- `src/market/packetBuilder.ts`는 candidate normalize 과정에서 eligibility metadata를 deterministic하게 계산합니다.
- `src/paper/virtualDecisionValidation.ts`는 candidate-level eligibility가 명시적으로 false인 BUY/SELL proposal을 storage 전에 reject합니다.
- `src/ai/decisionPrompt.ts`는 `paper-v7`로 version을 올리고 eligibility fields 준수를 요구합니다.
- 이번 PR은 RiskPolicy cooldownEntries를 packet builder에 연결하지 않고, candidate draft의 `cooldownActive`가 true인 경우에만 BUY blocker로 반영합니다.

## PR-44: Virtual Decision Feature Refs Grounding

### Review 1: Scope and Safety

- 범위는 paper-only `market_packet` candidate의 deterministic `featureRefs`와 AI decision의 optional `featureRefs` subset validation에 한정합니다.
- `featureRefs`는 backend가 만든 candidate feature path를 AI가 복사해 근거로 남기는 audit/provenance metadata입니다.
- validator는 packet candidate 밖 featureRef를 hard reject하지만, feature value 계산이나 claim-level support mapping은 추가하지 않습니다.
- 기존 `dataRefs` gate, packetHash, identity metadata, candidate eligibility gate는 유지합니다.
- live trading, broker adapter, live `TradingSignal`, live `OrderIntent`, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- `MarketPacketBuilder` test에서 candidate featureRefs가 deterministic path로 생성되는지 검증했습니다.
- semantic validator test에서 같은 candidate에서 복사한 `featureRefs`가 통과하는지 검증했습니다.
- semantic validator test에서 hallucinated `featureRefs`가 `VIRTUAL_DECISION_FEATURE_REF_NOT_IN_CANDIDATE`로 reject되는지 검증했습니다.
- Codex output schema artifact test에서 optional `featureRefs` array가 허용되는지 검증했습니다.
- Codex prompt test에서 featureRefs 복사 규칙이 포함되는지 검증했습니다.
- `npm test`로 전체 test suite 183개 통과를 확인했습니다.

### Review 3: Diff and Integration

- `src/domain/schemas.ts`에 `MarketCandidate.featureRefs`와 `VirtualDecisionItem.featureRefs` optional fields를 추가했습니다.
- `src/market/packetBuilder.ts`는 price/ranking/score/reason/eligibility field path를 candidate featureRefs로 생성합니다.
- `src/paper/virtualDecisionValidation.ts`는 decision featureRefs가 candidate featureRefs의 부분집합인지 확인합니다.
- `schemas/virtual-decision.schema.json`은 AI output에서 optional `featureRefs` array를 허용합니다.
- `src/ai/decisionPrompt.ts`는 `paper-v8`로 version을 올리고 featureRefs 복사 규칙을 명시합니다.
- 이번 PR은 `claimSupport[]`, feature value scoring, confidence decomposition은 포함하지 않고 후속 PR로 남깁니다.

## PR-45: Virtual Decision Backend Hash

### Review 1: Scope and Safety

- 범위는 paper-only `VirtualDecision` 저장 레코드에 backend-generated `decisionHash`를 붙이는 데 한정합니다.
- `decisionHash`는 AI output contract가 아니며, `schemas/virtual-decision.schema.json`에는 추가하지 않았습니다.
- runtime `virtualDecisionSchema`는 저장된 레코드 읽기 호환을 위해 optional `decisionHash`를 허용합니다.
- semantic validator는 AI가 제공한 `decisionHash`를 `VIRTUAL_DECISION_HASH_NOT_ALLOWED`로 reject합니다.
- live trading, broker adapter, live `TradingSignal`, live `OrderIntent`, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- `decisionHash` unit test에서 object key order와 무관한 deterministic hash를 검증했습니다.
- 기존 `decisionHash` field가 hash input에서 제외되어 self-reference가 생기지 않는지 검증했습니다.
- decision content 변경 시 hash가 변경되는지 검증했습니다.
- `FileVirtualDecisionStore` test에서 append 시 backend-generated hash가 기록되는지 검증했습니다.
- historical replay workflow test에서 progress snapshot과 decision log에 `decisionHash`가 기록되는지 검증했습니다.
- semantic validator test에서 AI-supplied `decisionHash`가 storage 전에 reject되는지 검증했습니다.
- `npm test`로 전체 test suite 189개 통과를 확인했습니다.

### Review 3: Diff and Integration

- `src/paper/decisionHash.ts`와 `src/paper/decisionHash.test.ts`를 추가했습니다.
- `src/domain/schemas.ts`의 `VirtualDecision` schema에 optional `decisionHash` field를 추가했습니다.
- `src/storage/repositories.ts`는 `FileVirtualDecisionStore.append`에서 저장 직전 hash를 바인딩합니다.
- `src/replay/historicalReplayAuditLog.ts`와 `src/replay/historicalReplayProgress.ts`는 replay decision record에도 같은 backend hash를 바인딩합니다.
- `src/paper/virtualDecisionValidation.ts`는 AI가 직접 보낸 `decisionHash`를 reject합니다.
- 이번 PR은 external signing, hash registry, immutable storage backend는 포함하지 않습니다.

## PR-46: Virtual Decision Claim Support

### Review 1: Scope and Safety

- 범위는 paper-only AI decision item의 핵심 claim을 packet 내부 ref와 연결하는 `claimSupport[]` contract에 한정합니다.
- `claimSupport`는 natural-language thesis를 backend policy로 해석하지 않고, 각 claim이 어떤 `dataRefs`/`featureRefs`에 기대는지만 audit 가능하게 남기는 metadata입니다.
- runtime schema는 기존 저장 record read compatibility를 위해 optional field로 확장합니다.
- Codex output schema artifact는 신규 AI output에서 `claimSupport`를 required로 요구합니다.
- semantic validator는 누락된 `claimSupport`, candidate 밖 dataRef, candidate 밖 featureRef를 hard reject합니다.
- live trading, broker adapter, live `TradingSignal`, live `OrderIntent`, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- domain schema test에서 claimSupport가 ref 없이 들어오면 reject되는지 검증했습니다.
- Codex output schema artifact test에서 decision item required에 `claimSupport`가 포함되는지 검증했습니다.
- Codex prompt test에서 claimSupport mapping 지시가 포함되는지 검증했습니다.
- semantic validator test에서 claimSupport 누락 decision이 `VIRTUAL_DECISION_CLAIM_SUPPORT_REQUIRED`로 reject되는지 검증했습니다.
- semantic validator test에서 claimSupport dataRef/featureRef가 candidate 밖 ref를 참조하면 reject되는지 검증했습니다.
- dry-run/stored packet/historical replay fixture에 claimSupport를 추가해 기존 paper-only workflow가 gate를 통과하도록 했습니다.
- `npm test`로 전체 test suite 193개 통과를 확인했습니다.

### Review 3: Diff and Integration

- `src/domain/schemas.ts`에 `virtualDecisionClaimSupportSchema`와 `VirtualDecisionItem.claimSupport`를 추가했습니다.
- `schemas/virtual-decision.schema.json`은 신규 AI output에서 item별 `claimSupport`를 required로 요구합니다.
- `src/paper/virtualDecisionValidation.ts`는 claimSupport 누락과 packet 밖 claim support ref를 reject합니다.
- `src/ai/decisionPrompt.ts`는 `paper-v9`로 version을 올리고 claimSupport 작성 규칙을 명시합니다.
- dry-run CLI, scheduler dry-run, stored market packet dry-run, historical replay fixture provider에 claimSupport를 추가했습니다.
- `git diff --check`로 whitespace error가 없음을 확인했습니다.
- 금지 경계 grep에서 live order, raw `codex exec`, raw `tossctl`, sandbox escalation 관련 신규 노출이 없음을 확인했습니다.
- 이번 PR은 natural-language claim entailment 검증, confidence decomposition, decision schema v2 전면 전환은 포함하지 않습니다.

## PR-47: Market Candidate Feature Scores

### Review 1: Scope and Safety

- 범위는 paper-only `market_packet` candidate metadata에 backend-calculated `featureScores[]`를 추가하는 데 한정합니다.
- `featureScores[]`는 AI output field가 아니라 packet 내부 feature value를 0-100 scale로 정규화한 read-only metadata입니다.
- `featureScores[]`는 투자 성과 보장, live execution signal, risk approval gate로 사용하지 않습니다.
- runtime schema는 기존 packet read compatibility를 위해 optional field로 확장합니다.
- live trading, broker adapter, live `TradingSignal`, live `OrderIntent`, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- market packet schema test에서 `featureScores[].featureRef`가 같은 candidate의 `featureRefs` 밖을 참조하면 reject되는지 검증했습니다.
- packet builder test에서 ranking feature score가 deterministic하게 계산되는지 검증했습니다.
- packet builder test에서 SELL 불가 candidate의 `sellEligible` feature score가 0으로 계산되는지 검증했습니다.
- packet builder test에서 max new positions로 BUY가 막힌 candidate의 `buyEligible`와 `budgetTierAllowed` feature score가 0으로 계산되는지 검증했습니다.
- historical packet builder test에서 point-in-time으로 계산된 candidate `score`가 `featureScores`에 반영되는지 검증했습니다.
- prompt test에서 `featureScores`를 backend-normalized feature value metadata로만 사용하도록 지시하는지 검증했습니다.
- `npm test`로 전체 test suite 194개 통과를 확인했습니다.

### Review 3: Diff and Integration

- `src/domain/schemas.ts`에 `MarketCandidateFeatureScore` schema/type과 feature score ref consistency validation을 추가했습니다.
- `src/market/packetBuilder.ts`는 `featureRefs`와 같은 prefix를 사용하는 deterministic `featureScores[]`를 생성합니다.
- `src/ai/decisionPrompt.ts`는 `paper-v10`으로 version을 올리고 `featureScores` 사용 경계를 명시합니다.
- `docs/codex-cli-paper-trading.md`는 `featureScores` packet contract와 prompt version 예시를 갱신했습니다.
- 코드 변경 파일 대상 금지 경계 grep에서 live order, raw `codex exec`, raw `tossctl`, sandbox escalation 관련 신규 노출이 없음을 확인했습니다.
- `git diff --check`로 whitespace error가 없음을 확인했습니다.
- 이번 PR은 confidence decomposition, feature score risk gate, AI output schema feature score 추가, decision schema v2 전환은 포함하지 않습니다.

## PR-48: Backend Confidence Breakdown

### Review 1: Scope and Safety

- 범위는 paper-only decision item에 backend-generated `confidenceBreakdown` 저장 metadata를 추가하는 데 한정합니다.
- AI가 제공하는 `confidence`는 `modelConfidence` audit input으로만 보존하고, evidence/data/policy/execution component score는 backend가 packet과 decision item을 비교해 계산합니다.
- `confidenceBreakdown`은 Codex output schema artifact에 추가하지 않고, semantic validator가 AI-supplied `confidenceBreakdown`을 reject합니다.
- runtime schema는 기존 저장 record read compatibility를 위해 optional field로 확장합니다.
- live trading, broker adapter, live `TradingSignal`, live `OrderIntent`, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- confidence helper test에서 `modelConfidence`, evidence/data/policy/execution/overall score와 reason code를 검증했습니다.
- confidence helper test에서 policy-blocked candidate의 `policyEligibilityScore`가 낮게 계산되는지 검증했습니다.
- semantic validator test에서 AI-supplied `confidenceBreakdown`이 `VIRTUAL_DECISION_CONFIDENCE_BREAKDOWN_NOT_ALLOWED`로 reject되는지 검증했습니다.
- Codex output schema artifact test에서 `confidenceBreakdown` property를 허용하지 않는지 검증했습니다.
- paper run workflow test에서 저장된 decision item에 backend confidence breakdown이 남는지 검증했습니다.
- stored market packet workflow test에서 저장된 decision item에 backend confidence breakdown이 남는지 검증했습니다.
- historical replay runner와 Codex historical replay runner test에서 result/progress decision에 backend confidence breakdown이 남는지 검증했습니다.
- `npm test`로 전체 test suite 198개 통과를 확인했습니다.

### Review 3: Diff and Integration

- `src/domain/schemas.ts`에 `VirtualDecisionConfidenceBreakdown` schema/type과 `VirtualDecisionItem.confidenceBreakdown` optional field를 추가했습니다.
- `src/paper/decisionConfidence.ts`는 packet candidate, cited refs, feature scores, action eligibility, execution hint를 사용해 backend confidence components를 계산합니다.
- `src/paper/virtualDecisionValidation.ts`는 AI-supplied confidence breakdown을 reject합니다.
- paper run, stored market packet run, historical replay runner는 validation 이후 저장/result decision에 confidence breakdown을 bind합니다.
- `docs/codex-cli-paper-trading.md`는 `confidenceBreakdown`이 backend-generated 저장 metadata이며 Codex output field가 아님을 명시합니다.
- 이번 PR은 confidence threshold gate, Risk Engine approval 연동, calibration policy, decision schema v2 전환은 포함하지 않습니다.

## PR-49: Virtual Decision Regression Suite

### Review 1: Scope and Safety

- 범위는 paper-only virtual decision validation의 regression test와 PR 계획 문서 갱신에 한정합니다.
- production validation rule, scoring threshold, calibration, conformal/abstention policy는 변경하지 않았습니다.
- golden fixture는 semantic validation과 validation 이후 backend confidence binding만 검증합니다.
- adversarial fixture는 packet 밖 ref, cross-symbol ref, AI-supplied backend-only field, eligibility violation이 hard reject되는지 고정합니다.
- live trading, broker adapter, live `TradingSignal`, live `OrderIntent`, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- golden regression test에서 packet/decision pair가 semantic validation을 통과하는지 검증했습니다.
- golden regression test에서 `confidenceBreakdown`이 AI output에는 없고 validation 이후 backend binding으로 생성되는지 검증했습니다.
- adversarial regression table에서 unknown `dataRef`, cross-symbol `dataRef`, unknown `featureRef`를 검증했습니다.
- adversarial regression table에서 `claimSupport` 누락, candidate 밖 `claimSupport.dataRefs`, candidate 밖 `claimSupport.featureRefs`를 검증했습니다.
- adversarial regression table에서 AI-supplied `decisionHash`, AI-supplied `confidenceBreakdown`, ineligible BUY를 검증했습니다.
- `npm test`로 전체 test suite 208개 통과를 확인했습니다.
- `git diff --check`로 whitespace error가 없음을 확인했습니다.

### Review 3: Diff and Integration

- `src/paper/virtualDecisionRegression.test.ts`를 추가해 golden/adversarial fixture 기반 regression suite를 구성했습니다.
- `docs/pr-implementation-plan.md`에 PR-49 계획, 검증 기준, 제외사항을 추가했습니다.
- 변경 파일 대상 금지 경계 grep에서 신규 테스트에는 live/order/broker 경계 확장이 없고, 계획 문서에는 제외사항 문구로만 관련 키워드가 남는 것을 확인했습니다.
- 이번 PR은 production code 변경 없이 regression coverage와 계획 문서만 추가합니다.

## PR-50: Replay Window Sampler

### Review 1: Scope and Safety

- 범위는 paper-only historical replay용 calendar-month window 선택 계층과 CLI option wiring에 한정합니다.
- sampler는 seed 기반 deterministic 선택만 수행하며 replay 반복 실행, market regime 분류, 수익성 집계는 포함하지 않습니다.
- `--print-window-only`는 선택된 window metadata를 JSON으로 출력하고 replay workflow를 실행하지 않습니다.
- historical replay 실행 경로는 기존 Risk Engine과 PaperOrderEngine 경계를 그대로 사용합니다.
- live trading, broker adapter, live `TradingSignal`, live `OrderIntent`, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- sampler unit test에서 같은 seed/range가 같은 calendar-month window를 선택하는지 검증했습니다.
- sampler unit test에서 2023-01부터 2026-05까지 41개 월 후보가 계산되는지 검증했습니다.
- sampler unit test에서 후보 window가 지정 range 안에 완전히 포함되는지 검증했습니다.
- sampler unit test에서 multi-month window와 full window가 없는 짧은 range의 fail-closed 동작을 검증했습니다.
- CLI smoke로 `--print-window-only`가 selected window JSON만 출력하는지 확인했습니다.
- `npm test`로 전체 test suite 212개 통과를 확인했습니다.
- `git diff --check`로 whitespace error가 없음을 확인했습니다.
- 변경 파일 대상 금지 경계 grep에서 live/order/broker/raw command 관련 신규 노출이 없음을 확인했습니다.

### Review 3: Diff and Integration

- `src/replay/replayWindowSampler.ts`를 추가해 seed, range, window size, timezone offset 기반의 deterministic window 선택을 구현했습니다.
- `src/replay/replayWindowSampler.test.ts`를 추가해 단일/복수 월 후보, 재현성, fail-closed 동작을 검증했습니다.
- `src/cli/historicalReplay.ts`는 기존 positional `startAt/endAt` 실행을 유지하면서 `--random-window`가 있을 때만 sampler 결과를 사용합니다.
- `docs/historical-replay.md`는 `--print-window-only`와 선택된 window로 dry-run replay를 실행하는 예시를 추가했습니다.
- `docs/pr-implementation-plan.md`는 PR-50 범위와 PR-51~PR-58 batch replay 후속 순서를 기록했습니다.
- 이번 PR은 반복 batch 실행, 데이터 가용성 scan, regime classification, aggregate report, dashboard batch view를 포함하지 않습니다.

## PR-51: Historical Data Availability Check

### Review 1: Scope and Safety

- 범위는 replay 실행 전 `historical-market-snapshots.jsonl`을 읽어 window/symbol coverage를 판정하는 paper-only 사전 검사에 한정합니다.
- `--check-data-availability`는 availability report JSON을 출력하고 replay workflow를 실행하지 않습니다.
- `--require-data-availability`는 데이터가 부족한 경우 replay 시작 전 fail-closed로 중단합니다.
- availability helper는 외부 데이터 수집, broker API 호출, 주문 생성, AI 판단 호출을 수행하지 않습니다.
- CLI positional fallback은 named option value가 섞이지 않도록 수집 규칙만 보강했습니다.
- live trading, broker adapter, live `TradingSignal`, live `OrderIntent`, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- availability helper test에서 window snapshot count, symbol summary, required symbol coverage를 검증했습니다.
- availability helper test에서 window snapshot이 없으면 `WINDOW_SNAPSHOT_MISSING`과 `WINDOW_SNAPSHOT_COUNT_BELOW_MINIMUM`으로 insufficient 처리되는지 검증했습니다.
- availability helper test에서 required symbol이 없거나 window 안 snapshot이 부족하면 insufficient 처리되는지 검증했습니다.
- availability helper test에서 corrupt snapshot line count가 있으면 insufficient 처리되는지 검증했습니다.
- CLI regression test에서 `--required-symbols`와 min option value가 positional fallback을 오염시키지 않는지 검증했습니다.
- 실제 `data/replay-2026-04-12-2026-06-12` snapshot으로 availability CLI가 available report를 exit 0으로 출력하는지 확인했습니다.
- `npm run historical:availability -- -- --data-dir ...` 형태의 npm script invocation이 option name을 보존하는지 확인했습니다.
- window 밖 구간을 대상으로 한 availability CLI smoke에서 insufficient report와 exit 1을 확인했습니다.
- `npm test`로 전체 test suite 218개 통과를 확인했습니다.
- `git diff --check`로 whitespace error가 없음을 확인했습니다.

### Review 3: Diff and Integration

- `src/replay/historicalDataAvailability.ts`를 추가해 snapshot/window/required symbol coverage report와 issue code를 생성합니다.
- `src/replay/historicalDataAvailability.test.ts`를 추가해 available, missing window, missing/insufficient required symbol, corrupt line, invalid option 케이스를 검증합니다.
- `src/cli/historicalReplay.ts`는 `--check-data-availability`, `--require-data-availability`, `--min-window-snapshots`, `--min-snapshots-per-symbol`, `--required-symbols`를 historical replay CLI에 연결합니다.
- `src/cli/historicalReplayCli.test.ts`를 추가해 named option value와 positional fallback의 통합 동작을 고정합니다.
- `package.json`에 `historical:availability` script를 추가했습니다.
- `docs/historical-replay.md`는 availability 확인, required symbol coverage, replay 전 fail-closed 사용 예시를 추가했습니다.
- `docs/pr-implementation-plan.md`는 PR-51 범위와 PR-52 이후 batch replay 후속 순서를 갱신했습니다.
- 변경 코드 파일 대상 금지 경계 grep에서 live/order/broker/raw command 관련 신규 노출이 없음을 확인했습니다.
- 이번 PR은 외부 historical data 수집기, 반복 batch runner, regime classification, aggregate report, dashboard batch view를 포함하지 않습니다.

## PR-52: Batch Replay Run Metadata

### Review 1: Scope and Safety

- 범위는 기존 `historical-replay-run-metadata.json`에 batch 분석용 identity/window/configuration metadata를 추가하는 데 한정합니다.
- `identity`는 `runId`, optional `batchId`, optional `runIndex`만 저장하며 실행 정책을 바꾸지 않습니다.
- `window`는 explicit/random window source, selected month, seed, timezone offset을 재현성 근거로 저장합니다.
- `configuration`은 clock, sampling policy, initial cash, packet/risk constraint snapshot을 저장합니다.
- CLI의 `--batch-id`, `--batch-run-index`, `--run-id`는 metadata 기록용 옵션이며 replay sampling, AI decision, risk decision, paper order 정책을 변경하지 않습니다.
- live trading, broker adapter, live `TradingSignal`, live `OrderIntent`, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- workflow test에서 `runId`, `batchId`, `runIndex`가 `historical-replay-run-metadata.json`에 저장되는지 검증했습니다.
- workflow test에서 random window selection의 `selectedMonth`, `seed`, `timezoneOffsetMinutes`가 metadata에 저장되는지 검증했습니다.
- workflow test에서 clock/sampling/initial cash configuration이 metadata에 저장되는지 검증했습니다.
- CLI integration test에서 `--batch-id`, `--batch-run-index`, `--run-id`가 dry-run 실행 후 metadata 파일까지 전달되는지 검증했습니다.
- CLI integration test에서 기존 availability positional fallback regression이 계속 통과하는지 확인했습니다.
- `npm test`로 전체 test suite 219개 통과를 확인했습니다.
- `git diff --check`로 whitespace error가 없음을 확인했습니다.

### Review 3: Diff and Integration

- `src/replay/historicalReplayAuditLog.ts`에 run identity/window/configuration schema와 metadata context type을 추가했습니다.
- `src/workflows/historicalReplayWorkflow.ts`는 clock, sampling policy, batch option, random window selection을 metadata context로 묶어 audit log recorder에 전달합니다.
- `src/cli/historicalReplay.ts`는 metadata 전용 batch option을 파싱하고 workflow option으로 전달합니다.
- `src/cli/historicalReplayCli.test.ts`는 CLI batch metadata 저장 경로를 검증합니다.
- `src/workflows/historicalReplayWorkflow.test.ts`는 stored metadata 구조를 검증합니다.
- `docs/historical-replay.md`는 run metadata 필드와 batch run metadata CLI 예시를 추가했습니다.
- `docs/pr-implementation-plan.md`는 PR-52 범위와 PR-53 이후 batch replay 후속 순서를 기록했습니다.
- 변경 코드 파일 대상 금지 경계 grep에서 live/order/broker/raw command 관련 신규 노출이 없음을 확인했습니다.
- 이번 PR은 반복 batch 실행 loop, batch run directory layout, regime classification, aggregate report, dashboard batch view를 포함하지 않습니다.

## PR-53: Batch Replay Runner

### Review 1: Scope and Safety

- 범위는 seed 기반 random window를 여러 번 선택해 deterministic paper historical replay를 반복 실행하고 결과 manifest/JSONL을 남기는 데 한정합니다.
- batch runner는 source data directory의 저장된 `historical-market-snapshots.jsonl`만 읽습니다.
- run별 출력은 batch output directory 아래에 분리해 저장하며 source snapshot 파일은 복사하거나 수정하지 않습니다.
- 각 run은 replay 전 availability preflight를 수행하고, insufficient이면 replay workflow를 실행하지 않고 `skipped` record만 남깁니다.
- 현재 batch runner는 Codex CLI AI batch 호출, 외부 data 수집, broker API 호출, 주문 생성을 수행하지 않습니다.
- live trading, broker adapter, live `TradingSignal`, live `OrderIntent`, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- batch workflow test에서 manifest와 per-run JSONL이 생성되는지 검증했습니다.
- batch workflow test에서 completed run summary와 run별 `historical-replay-run-metadata.json`의 batch identity/window가 저장되는지 검증했습니다.
- batch workflow test에서 insufficient window가 `skipped`, `DATA_INSUFFICIENT`, `reportPath: null`로 기록되는지 검증했습니다.
- CLI integration test에서 `historicalBatchReplay.js`가 batch manifest와 run JSONL을 생성하는지 검증했습니다.
- npm script smoke에서 `historical:batch:replay:dry`가 double separator invocation으로 completed summary를 출력하는지 확인했습니다.
- `npm test`로 전체 test suite 224개 통과를 확인했습니다.
- `git diff --check`로 whitespace error가 없음을 확인했습니다.

### Review 3: Diff and Integration

- `src/workflows/historicalBatchReplayWorkflow.ts`를 추가해 batch manifest, run JSONL, run별 historical replay workflow 실행을 orchestration합니다.
- `src/workflows/historicalReplayWorkflow.ts`는 source snapshot path와 output storage dir을 분리할 수 있도록 `historicalMarketSnapshotsPath` option을 추가했습니다.
- `src/cli/historicalBatchReplay.ts`를 추가해 batch id, seed, run count, random window range, sampling/availability option을 CLI로 받습니다.
- `package.json`에 `historical:batch:replay:dry` script를 추가했습니다.
- `src/workflows/historicalBatchReplayWorkflow.test.ts`는 completed/skipped batch run을 검증합니다.
- `src/cli/historicalReplayCli.test.ts`는 batch CLI integration path를 검증합니다.
- `docs/historical-replay.md`는 batch runner CLI 예시와 출력 구조를 추가했습니다.
- `docs/pr-implementation-plan.md`는 PR-53 범위와 PR-54 이후 후속 순서를 기록했습니다.
- 변경 코드 파일 대상 금지 경계 grep에서 live/order/broker/raw command 관련 신규 노출이 없음을 확인했습니다.
- 이번 PR은 regime classification, aggregate report, benchmark comparison hardening, dashboard batch view를 포함하지 않습니다.

## PR-54: Regime Classifier

### Review 1: Scope and Safety

- 범위는 batch replay run record에 window별 market regime metadata를 추가하는 데 한정합니다.
- regime classifier는 저장된 historical snapshot의 window 안 first/last price return만 사용합니다.
- regime label은 후속 aggregate report의 grouping key이며 trading signal, risk approval, order intent로 사용하지 않습니다.
- batch runner는 기존처럼 deterministic paper replay만 실행하며 Codex CLI AI batch 호출, 외부 data 수집, broker API 호출, 주문 생성을 수행하지 않습니다.
- live trading, broker adapter, live `TradingSignal`, live `OrderIntent`, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- classifier unit test에서 상승 window가 `bull`로 분류되는지 검증했습니다.
- classifier unit test에서 하락 window가 `bear`로 분류되는지 검증했습니다.
- classifier unit test에서 횡보 window가 `sideways`로 분류되는지 검증했습니다.
- classifier unit test에서 방향성이 엇갈린 window가 `mixed`로 분류되는지 검증했습니다.
- classifier unit test에서 분류 가능한 데이터가 부족하면 `insufficient_data`로 분류되는지 검증했습니다.
- batch workflow test에서 completed run record에 `marketRegime.label = bull`이 저장되는지 검증했습니다.
- batch workflow test에서 skipped run record에 `marketRegime.label = insufficient_data`가 저장되는지 검증했습니다.
- `npm test`로 전체 test suite 229개 통과를 확인했습니다.
- `git diff --check`로 whitespace error가 없음을 확인했습니다.

### Review 3: Diff and Integration

- `src/analytics/marketRegimeClassifier.ts`를 추가해 symbol별 first/last return, 평균/중앙값 return, breadth ratio, label/reason을 계산합니다.
- `src/analytics/marketRegimeClassifier.test.ts`를 추가해 bull/bear/sideways/mixed/insufficient classification을 검증합니다.
- `src/workflows/historicalBatchReplayWorkflow.ts`는 각 run window에 대해 regime을 계산하고 `BatchReplayRunRecord.marketRegime`에 저장합니다.
- `src/workflows/historicalBatchReplayWorkflow.test.ts`는 completed/skipped run의 regime label 저장을 검증합니다.
- `docs/historical-replay.md`는 regime label과 기본 threshold를 문서화했습니다.
- `docs/pr-implementation-plan.md`는 PR-54 범위와 PR-55 이후 후속 순서를 기록했습니다.
- 변경 코드 파일 대상 금지 경계 grep에서 live/order/broker/raw command 관련 신규 노출이 없음을 확인했습니다.
- 이번 PR은 aggregate report, regime별 수익률 비교표, benchmark comparison hardening, dashboard batch view를 포함하지 않습니다.

## PR-55: Batch Aggregate Report

### Review 1: Scope and Safety

- 범위는 완료된 `batch-replay-runs.jsonl`을 읽어 전체 및 market regime별 aggregate report를 생성하는 데 한정합니다.
- report helper는 batch run record summary와 regime label만 사용하며 replay workflow를 실행하지 않습니다.
- CLI는 `--runs-path` JSONL 입력을 읽고 optional `--output-path` JSON report를 쓰는 사후 분석 도구입니다.
- Codex CLI AI 호출, 외부 data 수집, broker API 호출, 주문 생성, strategy 자동 조정은 추가하지 않았습니다.
- 집계 결과는 paper-only 시뮬레이션 요약이며 투자 조언, 성과 보장, live trading signal로 사용하지 않는 disclaimer를 포함합니다.

### Review 2: Tests and Validation

- aggregate helper test에서 전체 completed/skipped/failed count, return sample count, regime count를 검증했습니다.
- aggregate helper test에서 전체 및 regime별 average/median/win rate 계산을 검증했습니다.
- render test에서 markdown report가 paper-only disclaimer를 포함하고 live order wording을 포함하지 않는지 검증했습니다.
- CLI integration test에서 batch runner가 만든 `runsPath`를 `historicalBatchReport.js`가 읽고 aggregate JSON report를 쓰는지 검증했습니다.
- targeted test로 `node --test dist\\reports\\batchReplayReport.test.js` 통과를 확인했습니다.
- targeted test로 `node --test dist\\cli\\historicalReplayCli.test.js` 통과를 확인했습니다.
- `npm test`로 전체 test suite 231개 통과를 확인했습니다.
- `git diff --check`로 whitespace error가 없음을 확인했습니다.

### Review 3: Diff and Integration

- `src/reports/batchReplayReport.ts`를 추가해 overall 및 regime별 aggregate metric을 계산하고 markdown summary를 렌더링합니다.
- `src/reports/batchReplayReport.test.ts`를 추가해 completed/skipped/failed run이 섞인 fixture의 aggregate 결과를 고정했습니다.
- `src/cli/historicalBatchReport.ts`를 추가해 `batch-replay-runs.jsonl` 입력과 optional JSON report 출력을 지원합니다.
- `src/cli/historicalReplayCli.test.ts`는 batch replay CLI smoke 뒤 aggregate report CLI까지 이어서 검증합니다.
- `package.json`에 `historical:batch:report` script를 추가했습니다.
- `docs/historical-replay.md`는 aggregate report CLI 예시, 출력 metric, paper-only 해석 경계를 문서화했습니다.
- `docs/pr-implementation-plan.md`는 PR-55 범위와 PR-56 이후 후속 순서를 기록했습니다.
- 변경 파일 대상 금지 경계 grep에서 신규 실행 경로는 없고, 신규 match는 disclaimer와 문서상 제외/금지 경계 문구로만 확인했습니다.
- 이번 PR은 benchmark comparison hardening, dashboard batch view, aggregate 결과 기반 전략 자동 조정은 포함하지 않습니다.

## PR-56: Benchmark Comparison Hardening

### Review 1: Scope and Safety

- 범위는 historical replay benchmark report의 비교 contract 보강에 한정합니다.
- 기존 `strategy`, `cashOnly`, `equalWeightBuyAndHold`, `initialPortfolioBuyAndHold` raw metric은 유지하고, strategy minus benchmark delta를 `comparisons`에 추가합니다.
- equal-weight benchmark는 첫 priced replay packet 이후에만 진입하며, priced candidate가 없으면 unavailable comparison으로 기록합니다.
- benchmark 비교는 저장된 replay packet과 portfolio timeline만 사용하는 paper-only 사후 분석입니다.
- live trading, broker adapter, live `TradingSignal`, live `OrderIntent`, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- benchmark unit test에서 strategy vs cash-only, strategy vs equal-weight delta를 검증했습니다.
- benchmark unit test에서 equal-weight benchmark가 첫 priced replay packet 이후에만 진입하는지 검증했습니다.
- benchmark unit test에서 priced candidate가 없으면 `benchmarkAvailable=false`와 `null` delta가 기록되는지 검증했습니다.
- historical replay report test에서 `benchmark_comparisons` 렌더링을 검증했습니다.
- targeted test로 `node --test dist\\reports\\historicalReplayBenchmark.test.js` 통과를 확인했습니다.
- targeted test로 `node --test dist\\reports\\historicalReplayReport.test.js` 통과를 확인했습니다.
- `npm test`로 전체 test suite 234개 통과를 확인했습니다.
- `git diff --check`로 whitespace error가 없음을 확인했습니다.

### Review 3: Diff and Integration

- `src/reports/historicalReplayBenchmark.ts`에 `HistoricalReplayBenchmarkComparisons`와 comparison delta 계산을 추가했습니다.
- `src/reports/historicalReplayBenchmark.test.ts`를 추가해 comparison delta, equal-weight entry point, unavailable benchmark contract를 고정했습니다.
- `src/reports/historicalReplayReport.ts`는 markdown report에 `benchmark_comparisons`를 출력합니다.
- `src/reports/historicalReplayReport.test.ts`는 새 comparison field가 report와 rendered output에 포함되는지 검증합니다.
- `docs/historical-replay.md`는 comparison delta semantics와 unavailable benchmark 표현을 문서화했습니다.
- `docs/pr-implementation-plan.md`는 PR-56 범위와 PR-57 이후 후속 순서를 기록했습니다.
- 변경 파일 대상 금지 경계 grep에서 신규 실행 경로는 없고, match는 문서상 제외/금지 경계 문구로만 확인했습니다.
- 이번 PR은 Sharpe/Sortino/Calmar, 외부 market index benchmark, dashboard batch view를 포함하지 않습니다.

## PR-57: Batch Replay Dashboard Read-only View

### Review 1: Scope and Safety

- 범위는 저장된 batch aggregate report를 Local Operations API와 dashboard에서 조회하는 read-only view에 한정합니다.
- `/batch/replay/report`는 `batch-replay-aggregate-report.json`을 읽어 `mode: paper_only`, `readOnly: true`와 함께 반환합니다.
- dashboard는 batch replay 실행, aggregate report 생성, AI 호출, strategy 자동 조정, 주문 생성을 트리거하지 않습니다.
- Local Operations API의 기존 method gate를 유지해 `GET`/`HEAD` 외 요청은 거절됩니다.
- live trading, broker adapter, live `TradingSignal`, live `OrderIntent`, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- API test에서 `/batch/replay/report`가 저장된 batch aggregate report를 read-only payload로 반환하는지 검증했습니다.
- dashboard asset test에서 batch replay panel DOM hook, `/batch/replay/report` endpoint 문자열, `renderBatchReplayReport` renderer 포함 여부를 검증했습니다.
- 기존 Local Operations API mutation method 거절 테스트를 유지해 read-only boundary가 깨지지 않았는지 확인했습니다.
- `npm run build` 통과를 확인했습니다.
- `node --check dashboard\app.js` 통과를 확인했습니다.
- targeted test로 `node --test dist\api\localOperationsServer.test.js` 10개 통과를 확인했습니다.
- browser verification에서 임시 서버 기준 desktop/mobile viewport 모두 batch panel rendering, API 연결 상태, console error 없음, mobile horizontal overflow 없음이 확인되었습니다.
- `npm test`로 전체 test suite 235개 통과를 확인했습니다.
- `git diff --check`로 whitespace error가 없음을 확인했습니다.

### Review 3: Diff and Integration

- `src/storage/repositories.ts`에 `batchReplayAggregateReportPath`를 추가해 dashboard data dir에서 aggregate report path를 표준화했습니다.
- `src/api/localOperationsServer.ts`에 `/batch/replay/report` route와 read-only JSON reader를 추가했습니다.
- `dashboard/index.html`은 반복 리플레이 요약 KPI, 장세별 결과, 상세, disclaimer panel을 추가했습니다.
- `dashboard/app.js`는 batch aggregate report를 fetch하고 전체/장세별 metric을 렌더링합니다.
- `dashboard/styles.css`는 batch replay panel layout과 mobile responsive rule을 추가했습니다.
- `src/api/localOperationsServer.test.ts`는 API endpoint, dashboard DOM hook, renderer wiring을 검증합니다.
- `docs/historical-replay.md`는 dashboard에서 batch aggregate report를 조회하는 방법과 실행 버튼이 없다는 경계를 문서화했습니다.
- `docs/pr-implementation-plan.md`는 PR-57 범위와 PR-58 후속 순서를 기록했습니다.
- 변경 파일 대상 금지 경계 grep에서 신규 실행 경로는 없고, match는 기존 `/place_order` 거절 테스트, 문서상 제외/금지 경계, 신규 paper-only disclaimer로만 확인했습니다.
- 이번 PR은 dashboard batch 실행 버튼, report 생성, live trading 연결, strategy 자동 조정은 포함하지 않습니다.

## PR-58: Regression And Safety Tests

### Review 1: Scope and Safety

- 범위는 batch replay 분석 흐름의 회귀/안전 테스트 보강에 한정합니다.
- 신규 정적 테스트는 batch workflow, aggregate report, batch CLI, Local Operations API, dashboard source에서 live execution surface가 추가되지 않았는지 검사합니다.
- aggregate report 테스트는 skipped/failed/null-return run이 수익률 표본에 섞이지 않는지 검증합니다.
- Local Operations API 테스트는 `/batch/replay/report`가 `POST`를 거절하고 `HEAD`는 body 없이 조회되는지 검증합니다.
- production scheduler, batch replay 실행 policy, aggregate metric 산식, dashboard 기능은 변경하지 않았습니다.
- live trading, broker adapter, live `TradingSignal`, live `OrderIntent`, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- targeted safety test로 `node --test dist\replay\historicalReplaySafety.test.js` 3개 통과를 확인했습니다.
- targeted report test로 `node --test dist\reports\batchReplayReport.test.js` 3개 통과를 확인했습니다.
- targeted API test로 `node --test dist\api\localOperationsServer.test.js` 10개 통과를 확인했습니다.
- `npm run build` 통과를 확인했습니다.
- `npm test`로 전체 test suite 237개 통과를 확인했습니다.
- `git diff --check`로 whitespace error가 없음을 확인했습니다.

### Review 3: Diff and Integration

- `src/replay/historicalReplaySafety.test.ts`에 batch replay 관련 source file 대상 금지 실행 표면 정적 테스트를 추가했습니다.
- `src/reports/batchReplayReport.test.ts`에 unavailable return sample 제외 회귀 테스트를 추가했습니다.
- `src/api/localOperationsServer.test.ts`는 `/batch/replay/report`의 `POST` 거절과 `HEAD` read-only 조회를 검증합니다.
- `docs/pr-implementation-plan.md`는 PR-58 범위와 planned batch replay PR 완료 상태를 기록했습니다.
- 변경 파일 대상 금지 경계 grep에서 신규 실행 경로는 없고, match는 새 정적 테스트의 금지 패턴, 기존 `/place_order` 거절 테스트, 문서상 제외/금지 경계, 기존 paper-only disclaimer로만 확인했습니다.
- 이번 PR은 신규 runtime feature, scheduler 변경, dashboard 실행 버튼, strategy 자동 조정, live trading 연결을 포함하지 않습니다.

## PR-59: Batch Replay Codex AI Provider

### Review 1: Scope and Safety

- 범위는 batch replay에서 실제 Codex CLI paper-only provider를 명시 옵션으로 주입하는 데 한정합니다.
- 기본 batch replay는 계속 deterministic provider를 사용하며 `--use-codex-ai`가 없으면 Codex CLI를 호출하지 않습니다.
- `--use-codex-ai`는 `AI_DECISION_MODE=paper_only`와 enabled provider 환경이 아니면 fail-fast 됩니다.
- Codex CLI provider는 `read-only` sandbox, batch-level daily budget, run-level call cap, replay sampling cap을 함께 사용합니다.
- Codex output은 기존 `VirtualDecision` 검증, packet validation, `VirtualRiskEngine`, `PaperOrderEngine` 경로만 통과합니다.
- live trading, broker adapter, live `TradingSignal`, live `OrderIntent`, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- workflow test에서 batch replay가 run별 provider factory를 호출하고 manifest에 `codex_cli` metadata를 기록하는지 검증했습니다.
- CLI test에서 기본 batch replay output과 manifest가 `deterministic_fixture` provider metadata를 유지하는지 검증했습니다.
- CLI test에서 `--use-codex-ai`가 enabled provider 환경 없이 실행되면 fail-fast 되는지 검증했습니다.
- CLI test에서 `--max-codex-calls-per-run=0`이 fail-fast 되는지 검증했습니다.
- targeted test로 `node --test dist\workflows\historicalBatchReplayWorkflow.test.js` 3개 통과를 확인했습니다.
- targeted test로 `node --test dist\cli\historicalReplayCli.test.js` 5개 통과를 확인했습니다.
- targeted safety test로 `node --test dist\replay\historicalReplaySafety.test.js` 3개 통과를 확인했습니다.
- `npm run build` 통과를 확인했습니다.
- `npm test`로 전체 test suite 240개 통과를 확인했습니다.

### Review 3: Diff and Integration

- `src/workflows/historicalBatchReplayWorkflow.ts`에 `decisionProviderFactory`와 provider metadata manifest 기록을 추가했습니다.
- `src/cli/historicalBatchReplay.ts`는 `--use-codex-ai`, `--max-codex-calls-per-run`, enabled env fail-fast, read-only Codex provider wiring을 추가했습니다.
- `package.json`에 `historical:batch:replay` script를 추가하고 기존 dry script는 유지했습니다.
- `src/workflows/historicalBatchReplayWorkflow.test.ts`는 injected Codex-style provider가 run별로 사용되는지 검증합니다.
- `src/cli/historicalReplayCli.test.ts`는 default provider metadata와 Codex AI guard를 검증합니다.
- `docs/historical-replay.md`는 실제 Codex AI batch 실행 명령, 권장 10회 설정, call cap, safety boundary를 문서화했습니다.
- `docs/pr-implementation-plan.md`는 PR-59 범위와 후속 계획 상태를 기록했습니다.
- 변경 파일 대상 금지 경계 grep에서 신규 live/order/broker/MCP tool 노출은 없고, match는 기존 CLI test의 `node:child_process`와 문서상 제외/금지 경계로만 확인했습니다.
- 이번 PR은 retry/backoff scheduler, 병렬 batch execution, dashboard-triggered replay, live trading 연결을 포함하지 않습니다.

## PR-60: Codex Structured Output Replay Fix

### Review 1: Scope and Safety

- 범위는 실제 Codex CLI historical/batch replay가 구조화 출력 스키마를 사용해 `VirtualDecision`을 남기도록 수정하는 데 한정합니다.
- Codex output schema artifact는 Codex structured output에서 거부되는 `allOf`, `if`, `then`, numeric/string bound keyword를 제거하고 action별 branch schema로 분리했습니다.
- historical replay CLI와 batch replay CLI는 `AI_DECISION_*` 값을 우선 사용하고 기존 paper CLI 호환 설정인 `CODEX_OUTPUT_SCHEMA_PATH`, `CODEX_DECISION_MAX_RUNS_PER_DAY`, `CODEX_DECISION_ALLOW_WEB_SEARCH`를 fallback으로 읽습니다.
- 기본 batch replay는 `--use-codex-ai`가 없으면 계속 deterministic provider를 사용합니다.
- Codex CLI provider는 기존처럼 `read-only` sandbox와 paper-only `VirtualDecision` 경로만 사용합니다.
- live trading, broker adapter, live `TradingSignal`, live `OrderIntent`, raw `codex exec` MCP tool, raw `tossctl` MCP tool은 추가하지 않았습니다.
- `git diff --check`로 whitespace error가 없음을 확인했습니다.
- 금지 경계 grep에서 신규 live/order/broker/MCP tool 노출이 없음을 확인했습니다.

### Review 2: Tests and Validation

- direct Codex CLI structured output smoke에서 `schemas/virtual-decision.schema.json`을 명시 전달했을 때 `VIRTUAL_BUY` decision 1건이 schema와 domain parser를 통과하는지 확인했습니다.
- 실제 historical batch smoke에서 `CODEX_OUTPUT_SCHEMA_PATH` fallback만으로 `decisionProviderCallCount=1`, `decisionRecordCount=1`, `tradeCount=1`이 기록되는지 확인했습니다.
- 실제 10회 Codex batch replay `batch-codex-datafull-20260613-002`가 completed 10, skipped 0, failed 0으로 완료되는지 확인했습니다.
- 10회 batch 결과에서 Codex 호출 48회, decision record 48개, decision item 51개, paper trade 24건, risk reject 8건이 기록되는지 확인했습니다.
- aggregate report에서 전체 평균 수익률 0.014421, median 0.01439, win rate 0.7이 계산되는지 확인했습니다.
- targeted test로 `node --test dist/cli/codexDecisionEnv.test.js dist/ai/codexCliDecisionProvider.test.js dist/replay/codexHistoricalDecisionProvider.test.js dist/cli/historicalReplayCli.test.js` 22개 통과를 확인했습니다.
- `npm test`로 전체 test suite 243개 통과를 확인했습니다.

### Review 3: Diff and Integration

- `schemas/virtual-decision.schema.json`은 Codex structured output 호환 branch schema로 변경했습니다.
- `src/ai/decisionPrompt.ts`는 `paper-v11` prompt로 packet identity, direct schema output, non-empty candidate decision rule을 명시합니다.
- `src/cli/codexDecisionEnv.ts`와 test를 추가해 historical Codex env alias 해석을 고정했습니다.
- `src/cli/historicalReplay.ts`와 `src/cli/historicalBatchReplay.ts`는 새 env resolver를 사용합니다.
- `src/ai/codexCliDecisionProvider.test.ts`는 unsupported schema keyword가 남지 않았는지, action별 branch와 `claimSupport` contract가 유지되는지 검증합니다.
- `src/replay/codexHistoricalDecisionProvider.test.ts`는 historical prompt가 no-lookahead boundary와 non-empty decision rule을 함께 포함하는지 검증합니다.
- `docs/historical-replay.md`는 historical replay에서 `CODEX_*` fallback env와 output schema 전달 방식을 문서화했습니다.
- `docs/pr-implementation-plan.md`는 PR-60 범위와 이후 paper return 실험 PR 순서를 기록했습니다.
- 이번 PR은 aggressive risk profile, 목표 수익률 최적화, 장세 균형 sampler, live trading 연결을 포함하지 않습니다.

## PR-61: Aggressive Paper Risk Profile

### Review 1: Scope and Safety

- 범위는 historical replay와 batch replay의 paper-only risk profile 선택에 한정합니다.
- 기본 profile은 기존 constraint와 호환되는 `conservative`이며, `aggressive_paper`는 `--risk-profile aggressive_paper`를 명시할 때만 적용됩니다.
- profile은 packet constraint와 `VirtualRiskEngine` policy override만 정규화하며, live `RiskEngine`, `TradingSignal`, `OrderIntent`, `OrderRouter`, broker adapter 경로로 전파하지 않습니다.
- batch manifest와 run metadata에는 선택 profile과 정규화된 risk policy를 기록해 사후 분석의 재현 근거로만 사용합니다.
- 목표 수익률 보장, strategy 자동 조정, take-profit/stop-loss/rebalance 규칙, aggressive profile 전용 Codex prompt policy는 포함하지 않았습니다.

### Review 2: Tests and Validation

- targeted test로 `node --test dist/paper/riskProfile.test.js dist/paper/orderEngine.test.js` 24개 통과를 확인했습니다.
- targeted test로 `node --test dist/workflows/historicalReplayWorkflow.test.js dist/workflows/historicalBatchReplayWorkflow.test.js dist/cli/historicalReplayCli.test.js` 10개 통과를 확인했습니다.
- `npm test`로 전체 test suite 250개 통과를 확인했습니다.
- `git diff --check`로 whitespace error가 없음을 확인했습니다.
- deterministic dry-run batch smoke `batch-aggressive-profile-smoke-20260613-001`가 completed 1, skipped 0, failed 0으로 완료되는지 확인했습니다.
- smoke manifest와 run metadata에서 `riskProfile=aggressive_paper`, `maxNewPositions=5`, `maxBudgetPerSymbolKrw=400000`, `maxSymbolExposureKrw=600000`, `maxPositionWeightRatio=0.65`, `minCashReserveRatio=0.05`가 저장되는지 확인했습니다.

### Review 3: Diff and Integration

- `src/paper/riskProfile.ts`를 추가해 `conservative`, `balanced`, `aggressive_paper` profile resolver와 parser를 구현했습니다.
- `src/cli/historicalReplay.ts`와 `src/cli/historicalBatchReplay.ts`는 `--risk-profile`, `--max-new-positions`, `--max-budget-per-symbol-krw`를 profile 기반 constraint와 risk policy로 정규화합니다.
- `src/replay/historicalReplayRunner.ts`와 `src/replay/codexHistoricalReplayRunner.ts`는 simulated tick의 `now`와 profile risk policy를 함께 `PaperOrderEngine`에 전달합니다.
- `src/workflows/historicalReplayWorkflow.ts`와 `src/workflows/historicalBatchReplayWorkflow.ts`는 run metadata와 batch manifest에 profile 정보를 저장합니다.
- `src/replay/historicalReplayAuditLog.ts`는 metadata schema에 nullable `riskProfile`과 `riskPolicy`를 추가했습니다.
- `src/paper/riskProfile.test.ts`, `src/workflows/historicalBatchReplayWorkflow.test.ts`, `src/workflows/historicalReplayWorkflow.test.ts`, `src/cli/historicalReplayCli.test.ts`는 profile default, aggressive fill, metadata 저장, CLI integration을 검증합니다.
- `docs/historical-replay.md`, `docs/risk-policy.md`, `docs/pr-implementation-plan.md`는 profile 표, CLI 예시, paper-only 적용 경계를 문서화했습니다.
- 변경 파일 대상 금지 경계 grep에서 신규 live/order/broker/MCP tool 노출은 없고, match는 문서상 제외/금지 경계와 기존 Codex AI enable 예시로만 확인했습니다.

## PR-62: Market Regime Balanced Batch Sampler

### Review 1: Scope and Safety

- 범위는 batch replay window selection mode에 `balanced_regime`을 추가하는 데 한정합니다.
- 기본 batch replay는 기존 `random` sampling을 유지하며, balanced sampling은 `--window-sampling balanced_regime`을 명시할 때만 적용됩니다.
- sampler는 저장된 historical snapshot과 기존 `MarketRegimeClassifier`만 사용해 후보 month를 분류합니다.
- target regime은 window 선택 metadata이며 trading signal, risk approval, order intent, strategy 자동 조정으로 사용하지 않습니다.
- Codex prompt policy, 목표 수익률 hit-rate report, take-profit/stop-loss/rebalance 규칙, live trading 연결은 포함하지 않았습니다.

### Review 2: Tests and Validation

- targeted test로 `node --test dist/replay/regimeBalancedWindowSampler.test.js dist/workflows/historicalBatchReplayWorkflow.test.js` 8개 통과를 확인했습니다.
- targeted test로 `node --test dist/cli/historicalReplayCli.test.js dist/replay/historicalReplaySafety.test.js dist/reports/batchReplayReport.test.js` 11개 통과를 확인했습니다.
- `npm test`로 전체 test suite 254개 통과를 확인했습니다.
- `git diff --check`로 whitespace error가 없음을 확인했습니다.
- deterministic dry-run batch smoke `batch-balanced-regime-smoke-20260613-001`가 completed 4, skipped 0, failed 0으로 완료되는지 확인했습니다.
- smoke manifest에서 requested target `bull,bear,sideways,mixed`, active target `bull,bear,sideways,mixed`, bucket count `bull=19`, `bear=10`, `sideways=2`, `mixed=10`, `insufficient_data=0`을 확인했습니다.
- smoke run records에서 run target/actual regime/month가 `bull/bull/2025-10`, `bear/bear/2024-01`, `sideways/sideways/2024-04`, `mixed/mixed/2025-05`로 저장되는지 확인했습니다.

### Review 3: Diff and Integration

- `src/replay/regimeBalancedWindowSampler.ts`를 추가해 전체 candidate month를 사전 분류하고 active target regime을 순환 선택합니다.
- `src/workflows/historicalBatchReplayWorkflow.ts`는 `windowSamplingMode`, `targetRegimes` option을 받아 random 또는 balanced window selection을 수행합니다.
- batch manifest에는 `windowSampling` summary를 저장하고, run record에는 `windowSampling.targetRegime`, `targetCandidateCount`, actual `marketRegime`을 함께 저장합니다.
- `src/cli/historicalBatchReplay.ts`는 `--window-sampling random|balanced_regime`과 `--target-regimes`를 파싱하고 stdout에 선택 mode를 출력합니다.
- `src/replay/regimeBalancedWindowSampler.test.ts`, `src/workflows/historicalBatchReplayWorkflow.test.ts`, `src/cli/historicalReplayCli.test.ts`, `src/reports/batchReplayReport.test.ts`는 sampler, workflow, CLI, aggregate fixture contract를 검증합니다.
- `src/replay/historicalReplaySafety.test.ts`는 신규 sampler source file을 금지 실행 표면 정적 검사 대상에 포함했습니다.
- `docs/historical-replay.md`와 `docs/pr-implementation-plan.md`는 balanced sampling 사용법, 저장 metadata, 제외 범위를 문서화했습니다.
- 변경 파일 대상 금지 경계 grep에서 신규 live/order/broker/MCP tool 노출은 없고, match는 문서상 제외/금지 경계와 기존 Codex AI enable 예시로만 확인했습니다.

## PR-63: Target Return Hit-rate Aggregate Report

### Review 1: Scope and Safety

- 범위는 완료된 batch replay run record를 읽는 aggregate report에 target return hit-rate를 추가하는 데 한정합니다.
- hit-rate는 `completed` run 중 `totalReturnRatio` sample이 있는 record만 대상으로 계산합니다.
- 기본 threshold는 `0.15`, `0.30`이며 CLI에서 `--target-return-thresholds`로 명시 threshold를 전달할 수 있습니다.
- 이 지표는 paper-only 사후 분석 결과이며 투자 조언, 성과 보장, live trading signal로 사용하지 않습니다.
- replay 실행, Codex AI 호출, strategy 자동 조정, take-profit/stop-loss/rebalance 규칙은 포함하지 않았습니다.

### Review 2: Tests and Validation

- targeted test로 `node --test dist/reports/batchReplayReport.test.js` 4개 통과를 확인했습니다.
- targeted test로 `node --test dist/cli/historicalReplayCli.test.js` 5개 통과를 확인했습니다.
- `npm test`로 전체 test suite 255개 통과를 확인했습니다.
- `git diff --check`로 whitespace error가 없음을 확인했습니다.
- deterministic aggregate report smoke에서 `--target-return-thresholds "0.02,0.05,0.15,0.30"`이 JSON report와 markdown output에 반영되는지 확인했습니다.
- smoke report에서 overall hit-rate가 `0.02=2/4/0.5`, `0.05=1/4/0.25`, `0.15=1/4/0.25`, `0.30=0/4/0`으로 계산되는지 확인했습니다.

### Review 3: Diff and Integration

- `src/reports/batchReplayReport.ts`는 report option에 `targetReturnThresholds`를 추가하고 전체/regime별 `targetReturnHitRates`를 계산합니다.
- `targetReturnHitRates`는 threshold, sample count, hit count, hit rate, hit run ID를 포함합니다.
- `src/cli/historicalBatchReport.ts`는 `--target-return-thresholds`를 comma-separated ratio list로 파싱합니다.
- `src/reports/batchReplayReport.test.ts`는 기본 threshold, custom threshold, skipped/failed/null-return 제외, markdown render를 검증합니다.
- `src/cli/historicalReplayCli.test.ts`는 aggregate report CLI가 custom threshold를 JSON report에 저장하는지 검증합니다.
- `docs/historical-replay.md`와 `docs/pr-implementation-plan.md`는 CLI 사용법, metric 의미, 제외 범위를 문서화했습니다.
- 변경 파일 대상 금지 경계 grep에서 신규 live/order/broker/MCP tool 노출은 없고, match는 문서상 제외/금지 경계와 기존 Codex AI enable 예시로만 확인했습니다.

## PR-64: Paper Exit Policy Replay

### Review 1: Scope and Safety

- 범위는 historical replay와 batch replay의 paper-only exit policy에 한정합니다.
- take-profit, stop-loss, rebalance rule은 deterministic `VirtualDecision`만 생성합니다.
- exit decision은 기존 `VirtualRiskEngine`과 `PaperOrderEngine` 경로만 통과합니다.
- exit rule은 AI/provider call count에 포함하지 않고, decision/risk/trade log에는 기록합니다.
- live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter, raw `codex exec`, raw `tossctl` MCP tool은 추가하지 않았습니다.

### Review 2: Tests and Validation

- targeted test로 `node --test dist/paper/exitPolicy.test.js dist/replay/historicalReplayRunner.test.js dist/replay/codexHistoricalReplayRunner.test.js dist/workflows/historicalReplayWorkflow.test.js dist/workflows/historicalBatchReplayWorkflow.test.js dist/cli/historicalReplayCli.test.js dist/reports/historicalReplayReport.test.js dist/reports/historicalReplayBenchmark.test.js` 33개 통과를 확인했습니다.
- `npm test`로 전체 test suite 264개 통과를 확인했습니다.
- `git diff --check`와 `git diff --cached --check`로 whitespace error가 없음을 확인했습니다.
- deterministic dry-run batch smoke `batch-exit-policy-smoke-20260613-001`가 completed 2, skipped 0, failed 0으로 완료되는지 확인했습니다.
- smoke 첫 run에서 `paper_exit_policy_v1` decision record 1개와 `VIRTUAL_SELL` trade 1개가 생성되는지 확인했습니다.
- manifest, run metadata, historical report에 `paperExitPolicy`가 저장되는지 확인했습니다.

### Review 3: Diff and Integration

- `src/paper/exitPolicy.ts`는 policy 정규화와 exit decision 생성을 담당합니다.
- `src/replay/historicalReplayRunner.ts`와 `src/replay/codexHistoricalReplayRunner.ts`는 packet 생성 직후 exit policy를 실행하고, 체결 종목의 provider item을 suppress합니다.
- `src/replay/historicalReplayAuditLog.ts`는 같은 packet의 exit/provider decision을 모두 남길 수 있도록 decision hash 기준 중복 제거로 변경했습니다.
- `src/cli/historicalReplay.ts`와 `src/cli/historicalBatchReplay.ts`는 paper exit policy CLI 옵션을 받습니다.
- `src/workflows/historicalReplayWorkflow.ts`, `src/workflows/historicalBatchReplayWorkflow.ts`, `src/reports/historicalReplayReport.ts`는 policy metadata를 저장/출력합니다.
- `docs/historical-replay.md`와 `docs/pr-implementation-plan.md`는 사용법, metadata, 제외 범위를 문서화했습니다.
- PR #28로 merge 완료했습니다.

## PR-65: Historical Universe Coverage

### Review 1: Scope and Safety

- 범위는 paper-only historical universe manifest와 저장 snapshot coverage 검증에 한정합니다.
- `docs/historical-universe.kr-expanded.json`은 core required symbol과 optional expansion target을 분리합니다.
- coverage CLI는 저장된 `historical-market-snapshots.jsonl`만 읽고 외부 데이터 수집, broker API 호출, replay 실행, 주문 생성을 수행하지 않습니다.
- batch replay의 `--universe-path`는 availability check의 required symbol 입력으로만 사용합니다.
- optional expansion symbol은 기본 status를 깨지 않고 gap으로 기록하며, `--require-optional-symbols` 또는 `--require-optional-universe-symbols`를 명시할 때만 fail-closed 대상이 됩니다.
- live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter, raw `codex exec`, raw `tossctl` MCP tool은 추가하지 않습니다.

### Review 2: Tests and Validation

- `npm run build`: pass.
- `node --test dist/replay/historicalUniverseCoverage.test.js dist/cli/historicalReplayCli.test.js dist/replay/historicalReplaySafety.test.js`: pass, 15 tests.
- `npm run historical:universe:coverage -- -- --data-dir data/replay-2023-01-2026-05-yahoo-daily --universe-path docs/historical-universe.kr-expanded.json --range-start 2023-01-01T00:00:00+09:00 --range-end 2026-05-31T23:59:59.999+09:00 --min-monthly-coverage-ratio 1 --min-snapshots-per-symbol 1 --output-path data/replay-2023-01-2026-05-yahoo-daily/historical-universe-coverage.json --json`: pass.
- coverage smoke 결과는 `status=available`, `availableRequiredSymbolCount=6`, `missingRequiredSymbols=[]`, `missingOptionalSymbols=7`, `corruptLineCount=0`입니다.
- `npm run historical:batch:replay:dry -- -- --source-data-dir data/replay-2023-01-2026-05-yahoo-daily --output-dir data/batch-replay --batch-id batch-universe-coverage-smoke-20260613-001 --seed batch-seed-universe-001 --runs 2 --random-window-from 2023-01-01T00:00:00+09:00 --random-window-to 2026-05-31T23:59:59.999+09:00 --window-months 1 --decision-frequency once_per_week --max-decision-calls 1 --step-seconds 604800 --max-snapshot-age-seconds 2678400 --min-window-snapshots 1 --universe-path docs/historical-universe.kr-expanded.json --risk-profile aggressive_paper`: pass, `completedCount=2`, `skippedCount=0`, `failedCount=0`.
- `npm test`: pass, 271 tests.
- `git diff --check`: pass. Git line-ending conversion warnings only, whitespace errors 없음.

### Review 3: Diff and Integration

- `src/replay/historicalUniverseCoverage.ts`는 manifest parsing, required symbol extraction, monthly coverage report를 계산합니다.
- `src/cli/historicalUniverseCoverage.ts`는 coverage report CLI와 optional JSON/output file 작성을 제공합니다.
- `src/cli/historicalReplay.ts`와 `src/cli/historicalBatchReplay.ts`는 `--universe-path`로 manifest required symbol을 availability check에 반영합니다.
- `package.json`은 `historical:universe:coverage` script를 추가합니다.
- `src/replay/historicalReplaySafety.test.ts`는 신규 coverage source와 CLI를 live execution surface 정적 검사 대상에 포함합니다.
- `docs/historical-replay.md`와 `docs/pr-implementation-plan.md`는 coverage 사용법, PR-65 범위, 제외 범위를 문서화합니다.

## PR-66: Aggressive Codex Prompt Policy

### Review 1: Scope and Safety

- 범위는 historical replay의 Codex CLI paper-only prompt policy 분리에 한정합니다.
- `conservative`, `balanced` profile은 기존 default historical prompt와 version을 유지합니다.
- `aggressive_paper` profile만 별도 prompt policy와 prompt version을 사용합니다.
- aggressive prompt는 더 넓은 paper-only risk envelope을 인지시키되, 월 15~30% 수익률 목표를 쫓기 위한 trade 강제를 금지합니다.
- prompt policy는 Codex output을 `VirtualDecision`으로만 제한하며 기존 `VirtualRiskEngine`과 `PaperOrderEngine` 경로를 우회하지 않습니다.
- live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter, raw `codex exec`, raw `tossctl` MCP tool은 추가하지 않습니다.

### Review 2: Tests and Validation

- `npm run build`: pass.
- `node --test dist/replay/codexHistoricalDecisionProvider.test.js dist/workflows/historicalBatchReplayWorkflow.test.js dist/cli/historicalReplayCli.test.js dist/replay/historicalReplaySafety.test.js`: pass, 22 tests.
- `npm test`: pass, 273 tests.
- `git diff --check`: pass. Git line-ending conversion warnings only, whitespace errors 없음.
- 실제 Codex CLI 호출 smoke는 실행하지 않았습니다. 이번 PR은 prompt resolver, CLI wiring, manifest metadata를 unit/integration test로 검증하고 live/cost-dependent provider 실행은 범위에서 제외합니다.

### Review 3: Diff and Integration

- `src/replay/codexHistoricalDecisionProvider.ts`는 `HistoricalReplayPromptPolicy` resolver와 `aggressive_paper` prompt/version을 추가합니다.
- `withHistoricalReplayPrompt`는 risk profile option을 받아 default 또는 aggressive policy를 주입합니다.
- `src/cli/historicalReplay.ts`와 `src/cli/historicalBatchReplay.ts`는 선택된 `riskProfile.name`을 prompt policy 선택에 전달합니다.
- `src/workflows/historicalBatchReplayWorkflow.ts`는 batch manifest의 decision provider metadata에 nullable `promptPolicy`, `promptVersion`을 추가합니다.
- `src/replay/codexHistoricalDecisionProvider.test.ts`는 default/balanced policy 유지와 aggressive prompt guard 문구를 검증합니다.
- `src/workflows/historicalBatchReplayWorkflow.test.ts`는 Codex-style provider metadata에 aggressive prompt policy/version이 기록되는지 검증합니다.
- `docs/historical-replay.md`, `docs/codex-cli-paper-trading.md`, `docs/pr-implementation-plan.md`는 prompt policy 동작, 감사 metadata, 제외 범위를 문서화합니다.

## PR-67: Batch AI Failure Accounting

### Review 1: Scope and Safety

- 범위는 batch replay 사후 분석 summary/report에 Codex provider failure count를 추가하는 데 한정합니다.
- `HISTORICAL_AI_DECISION_FAILED` audit event는 완료된 replay 내부의 provider failure로 집계하고, workflow 자체가 throw한 경우만 run `failed`로 둡니다.
- trading decision, risk limit, order execution, allocation, exit policy, prompt/schema는 변경하지 않습니다.
- live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter, raw `codex exec`, raw `tossctl` MCP tool은 추가하지 않았습니다.
- 변경 code file 대상 금지 경계 grep 결과 신규 live/order/raw execution surface match가 없음을 확인했습니다.

### Review 2: Tests and Validation

- `npm run build`: pass.
- `node --test dist/workflows/historicalBatchReplayWorkflow.test.js dist/reports/batchReplayReport.test.js`: pass, 11 tests.
- `npm test`: pass, 275 tests.
- `git diff --check`: pass. Git line-ending conversion warnings only, whitespace errors 없음.
- 안전 grep: code 변경 파일에서는 금지 문자열 match 없음. 문서 match는 기존 금지/예시 경계 문구와 PR-67 제외 범위로만 확인했습니다.

### Review 3: Diff and Integration

- `src/workflows/historicalBatchReplayWorkflow.ts`는 completed run summary에 `aiDecisionFailureCount`를 저장합니다.
- `src/reports/batchReplayReport.ts`는 completed run의 `aiDecisionFailureCount`를 `totalAiDecisionFailureCount`로 합산하고 markdown render에 표시합니다.
- `src/workflows/historicalBatchReplayWorkflow.test.ts`는 provider failure가 있어도 replay가 완료되면 batch run이 `completed`로 남고 AI failure count가 1로 기록되는지 검증합니다.
- `src/reports/batchReplayReport.test.ts`는 completed run 내부 AI failure count와 failed run count가 분리되는지 검증합니다.
- `docs/historical-replay.md`와 `docs/pr-implementation-plan.md`는 AI failure accounting 의미, 검증 기준, 제외 범위를 문서화합니다.

## PR-68: Codex CLI Batch Session Budget

### Review 1: Scope and Safety

- 범위는 historical replay의 Codex CLI paper-only provider 실행 방식에 한정합니다.
- batch replay는 run마다 새 `CodexCliDecisionProvider`를 생성해 `--max-codex-calls-per-run`을 per-run budget으로 적용합니다.
- Codex CLI 실행은 `--ephemeral`을 사용해 이전 CLI 세션 상태와 섞이지 않게 합니다.
- preflight는 paper-only empty candidate packet으로 연결 실패를 조기에 드러내는 용도이며 trading decision, risk limit, order policy를 바꾸지 않습니다.
- live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter, raw `codex exec`, raw `tossctl` MCP tool은 추가하지 않습니다.

### Review 2: Tests and Validation

- `npm run build`: pass.
- `node --test dist/ai/codexCliDecisionProvider.test.js dist/replay/codexHistoricalReplayRunner.test.js dist/cli/historicalReplayCli.test.js`: pass, 23 tests.
- `git diff --check`: pass. Git line-ending conversion warnings only, whitespace errors 없음.
- provider command에 `--ephemeral`이 포함되는지 확인했습니다.
- fake Codex CLI fixture로 preflight 1회와 2개 replay run 호출이 모두 `--ephemeral`로 실행되고, per-run cap 1에서도 batch가 `completedCount=2`로 끝나는지 확인했습니다.
- provider failure stderr summary가 핵심 `api.openai.com` error line은 남기고 prompt noise는 제외하는지 확인했습니다.

### Review 3: Diff and Integration

- `src/ai/codexCliDecisionProvider.ts`는 `ephemeral` option을 받아 `codex exec --ephemeral`을 구성합니다.
- `src/cli/historicalReplay.ts`와 `src/cli/historicalBatchReplay.ts`는 historical Codex provider 생성 시 ephemeral 실행을 사용합니다.
- `src/cli/historicalBatchReplay.ts`는 batch 전체에서 provider를 공유하지 않고 run마다 새 provider를 생성합니다.
- batch Codex preflight는 `--skip-codex-preflight`가 없을 때 실행되며, 실패 summary는 `summarizeCodexCliDecisionFailure`로 압축합니다.
- `src/replay/codexHistoricalReplayRunner.ts`는 `HISTORICAL_AI_DECISION_FAILED` audit summary에 stderr 핵심 error line을 포함합니다.
- `src/cli/historicalReplayCli.test.ts`, `src/ai/codexCliDecisionProvider.test.ts`, `src/replay/codexHistoricalReplayRunner.test.ts`는 CLI budget/session, command flag, failure summary를 검증합니다.

## PR-69: Paper Allocation Target Exposure

### Review 1: Scope and Safety

- 범위는 historical replay의 paper-only allocation snapshot과 target exposure gate에 한정합니다.
- allocation snapshot은 market packet에 포함되는 deterministic metadata이며, live trading signal이나 order intent로 승격하지 않습니다.
- AI/provider가 큰 budget을 제안해도 normalizer와 `VirtualRiskEngine`이 target exposure, per-decision budget, symbol exposure, cash reserve를 최종 제한합니다.
- aggressive profile의 initial cash scaling은 paper replay profile에만 적용합니다.
- live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter, raw `codex exec`, raw `tossctl` MCP tool은 추가하지 않습니다.

### Review 2: Tests and Validation

- `npm run build`: pass.
- `node --test dist/paper/allocationPolicy.test.js dist/market/packetBuilder.test.js dist/paper/decisionNormalizer.test.js dist/paper/orderEngine.test.js dist/paper/riskProfile.test.js dist/replay/historicalReplayRunner.test.js dist/workflows/historicalBatchReplayWorkflow.test.js dist/cli/historicalReplayCli.test.js`: pass, 67 tests.
- `git diff --check`: pass. Git line-ending conversion warnings only, whitespace errors 없음.
- allocation snapshot, packet eligibility, BUY budget cap, target exposure reject, first-priced fixture multi-candidate allocation, manifest/run metadata 저장을 확인했습니다.
- 금지 경계 grep은 batch disclaimer의 `cannot place live orders` 문구만 match했고 신규 live/raw execution surface는 없습니다.

### Review 3: Diff and Integration

- `src/paper/allocationPolicy.ts`는 target exposure, cash reserve, per-decision budget, symbol exposure cap을 계산합니다.
- `src/domain/schemas.ts`, `src/market/packetBuilder.ts`, `src/market/historicalPacketBuilder.ts`는 `portfolioAllocation`을 packet contract에 추가합니다.
- `src/paper/decisionNormalizer.ts`와 `src/paper/riskEngine.ts`는 allocation budget cap과 target exposure reject를 적용합니다.
- `src/paper/riskProfile.ts`는 profile별 allocation policy와 initial cash 기반 aggressive budget scaling을 제공합니다.
- `src/replay/historicalReplayRunner.ts`는 allocation이 있을 때 first-priced fixture를 여러 eligible 후보로 분산합니다.
- `src/replay/codexHistoricalReplayRunner.ts`, `src/workflows/historicalReplayWorkflow.ts`, `src/workflows/historicalBatchReplayWorkflow.ts`, CLI는 allocation policy를 replay와 metadata에 전달합니다.
- `docs/historical-replay.md`와 `docs/pr-implementation-plan.md`는 target exposure profile, metadata, 제외 범위를 문서화합니다.

## PR-70: Paper Exit Policy Telemetry

### Review 1: Scope and Safety

- 범위는 historical replay의 paper-only exit policy와 사후 분석 metric 확장에 한정합니다.
- `partial_then_trail` state는 replay runner 내부 state이며 live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter로 전달하지 않습니다.
- exit decision은 기존과 동일하게 reduce-only `VirtualDecision`을 만들고 `VirtualRiskEngine`과 `PaperOrderEngine`을 통과합니다.
- aggregate/report metric은 사후 분석용이며 buy/sell signal, risk approval, strategy 자동 조정에 사용하지 않습니다.
- live trading, broker adapter, raw `codex exec`, raw `tossctl` MCP tool은 추가하지 않습니다.

### Review 2: Tests and Validation

- `npm test`: pass, 290 tests.
- `git diff --check`: pass. Git line-ending conversion warnings only, whitespace errors 없음.
- partial take-profit 후 trailing stop, default `full_exit` metadata, portfolio construction metric, dust/no-op reject 분리, batch aggregate metric을 테스트로 확인했습니다.
- 금지 경계 grep에서 신규 실행 경로는 없고, match는 문서상 금지/비전파 문구와 paper-only disclaimer로만 확인했습니다.

### Review 3: Diff and Integration

- `src/paper/exitPolicy.ts`는 `full_exit` 기본값을 유지하면서 `partial_then_trail` 모드에서 최초 partial sell과 이후 peak drawdown 기반 trailing sell-all을 생성합니다.
- `src/replay/historicalReplayRunner.ts`와 `src/replay/codexHistoricalReplayRunner.ts`는 replay별 exit state를 만들고 포지션 정리 후 stale state를 prune합니다.
- `src/cli/historicalReplay.ts`와 `src/cli/historicalBatchReplay.ts`는 새 paper exit option을 파싱합니다.
- `src/reports/historicalReplayReport.ts`는 portfolio construction metric과 meaningful/dust reject count를 출력합니다.
- `src/reports/batchReplayReport.ts`와 `src/workflows/historicalBatchReplayWorkflow.ts`는 run summary와 aggregate report에 exposure/cash/time-in-market/target gap/dust reject metric을 전달합니다.
- `docs/historical-replay.md`와 `docs/pr-implementation-plan.md`는 option, metric, 제외 범위를 문서화합니다.

## Phase 25: AI Paper Trading 운영 Runbook 정리

### Review 1: Scope and Safety

- 범위는 Codex AI paper run과 historical/batch replay 운영 절차 문서화에 한정합니다.
- `docs/ai-paper-trading-runbook.md`를 새로 추가하고 README, Codex CLI paper trading, historical replay, automation 문서에서 runbook으로 진입할 수 있게 연결했습니다.
- code behavior, API route, dashboard asset, risk/order/replay 로직, package script는 변경하지 않았습니다.
- runbook은 `TRADING_ENABLED=false`, `BROKER_PROVIDER=mock`, `AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=false` 기본 경계를 유지합니다.
- live trading enable 절차, 실계좌 주문 절차, raw `codex exec`/raw `tossctl` MCP tool, `place_order` enabled surface는 추가하지 않았습니다.

### Review 2: Tests and Validation

- `npm run check`: pass, 335 tests.
- `git diff --check`: pass. Git line-ending conversion warnings only, whitespace errors 없음.
- 실제 CLI 파일에서 `paper:run-once:dry`, `paper:report`, `paper:run-from-market-packet`, `historical:replay`, `historical:batch:replay`, `ops:api`의 argument 이름을 확인했습니다.
- `src/cli/codexDecisionEnv.ts`에서 Codex provider env 우선순위와 `read-only` sandbox 고정을 확인했습니다.
- `src/api/localOperationsSurface.ts`에서 runbook의 read-only endpoint 목록이 실제 route 목록과 일치하는지 확인했습니다.

### Review 3: Diff and Integration

- `docs/ai-paper-trading-runbook.md`는 실행 전 `.env`, schema path, data availability, budget/sampling, 실행 중 progress/audit, 실행 후 decision/risk/trade count와 retry 판단 순서를 정리합니다.
- stored packet paper run, single historical replay, batch historical replay, aggregate report, dashboard read-only 조회 절차를 실제 package script 기준으로 작성했습니다.
- failure triage table은 provider disabled, Codex executable/auth/usage limit, timeout, invalid schema, packet mismatch, risk reject, data availability 부족을 artifact 기준으로 분리합니다.
- 금지 경계 grep 결과 match는 기존 금지 예시와 paper-only disclaimer 문구로만 확인했고 신규 live/raw execution surface는 없습니다.
- README와 관련 docs는 긴 절차를 중복하지 않고 새 runbook 링크만 추가해 운영 source of truth를 분산하지 않도록 했습니다.

## Phase 26: Process Quality Gate 보강

### Review 1: Scope and Safety

- 범위는 `scripts/qualityGate.mjs`와 quality gate 설명 문서 갱신에 한정합니다.
- `quality:gate`가 Codex decision provider safe default와 alias precedence drift를 build artifact 기준으로 검사하도록 보강했습니다.
- `BROKER_PROVIDER`, `TRADING_ENABLED`, live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter, raw `codex exec`, raw `tossctl` MCP tool은 변경하지 않았습니다.
- provider 기본값은 disabled, `read-only` sandbox, web search disabled를 유지합니다.
- dashboard/API route, dashboard asset, MCP enabled tool surface, package script 동작은 변경하지 않았습니다.

### Review 2: Tests and Validation

- `npm run check`: pass, 335 tests.
- `git diff --check`: pass. Git line-ending conversion warnings only, whitespace errors 없음.
- `package.json` script를 확인했으며 별도 browser E2E, 성능 지표, 접근성 자동 검사 script는 없습니다.
- 이번 phase는 dashboard/API behavior 또는 asset 변경이 없어 browser E2E smoke, 성능 지표 측정, 접근성 자동 검사는 실행 대상에서 제외했습니다.
- `npm run check`가 `quality:gate`를 선행 실행하고 전체 Node.js test suite를 실행하는 구조를 유지하는지 확인했습니다.

### Review 3: Diff and Integration

- `scripts/qualityGate.mjs`는 `readCodexDecisionProviderConfig({})`의 safe default를 검사합니다.
- `scripts/qualityGate.mjs`는 `readHistoricalCodexDecisionEnv({})`의 historical replay Codex call cap과 web search default를 검사합니다.
- `scripts/qualityGate.mjs`는 `AI_DECISION_*` alias가 `CODEX_*` fallback보다 우선되는지 검사합니다.
- `docs/PROJECT_STRUCTURE.md`와 `docs/CODE_CONVENTION.md`는 `quality:gate` 검사 범위에 Codex decision provider safe default가 포함된다는 점을 반영했습니다.
- 신규 runtime behavior, API contract, data model, migration, dashboard UI 변경은 없습니다.

## Phase 27: Official Toss Open API Adapter Design

### Review 1: Scope and Safety

- 범위는 official Toss Open API adapter 설계 문서와 관련 문서 링크 추가에 한정합니다.
- official API 실제 호출 코드, token auth 구현, live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter 구현은 추가하지 않았습니다.
- `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=false` 기본 경계를 변경하지 않았습니다.
- Codex MCP enabled surface, Local Operations API route, dashboard asset, package script는 변경하지 않았습니다.
- 설계 문서에는 후속 구현 전 OpenAPI JSON 재확인, mock-first 순서, Risk Engine 선행 조건, MCP/dashboard mutation 금지 조건을 명시했습니다.

### Review 2: Tests and Validation

- `npm run check`: pass, 335 tests.
- `git diff --check`: pass. Git line-ending conversion warnings only, whitespace errors 없음.
- 공식 문서 확인: `developers.tossinvest.com/llms.txt`, overview markdown, OpenAPI markdown, OpenAPI JSON metadata를 확인했습니다.
- 확인한 OpenAPI metadata는 `openapi=3.1.0`, `info.version=1.1.1`, server `https://openapi.tossinvest.com`입니다.
- 이번 phase는 docs-only 변경이라 browser E2E smoke, 성능 지표 측정, 접근성 자동 검사는 실행 대상에서 제외했습니다.

### Review 3: Diff and Integration

- `docs/official-toss-open-api-adapter-design.md`는 공식 endpoint category, OAuth2 Client Credentials, `X-Tossinvest-Account`, rate limit, error envelope, idempotency, audit/masking, PR 분리 순서를 문서화합니다.
- `README.md`와 `docs/architecture.md`는 official adapter가 아직 구현되지 않았고 설계 문서만 존재한다는 경계를 연결합니다.
- `docs/PROJECT_STRUCTURE.md`는 새 설계 문서를 구조/책임 경계 문서 목록에 추가합니다.
- `docs/pr-implementation-plan.md`는 Later PRs의 official adapter design 범위를 설계 문서로 구체화하고 구현 제외 범위를 명시합니다.
- Codex review 후속 수정으로 live trading threat model을 official order gateway보다 앞에 배치했습니다.
- 신규 runtime behavior, API contract implementation, data model, migration, dashboard UI 변경은 없습니다.

## Phase 28: Official Token Auth Design

### Review 1: Scope and Safety

- 범위는 official Toss Open API token auth 설계 문서와 관련 문서 링크 추가에 한정합니다.
- token auth client, config parser, token cache, official API 실제 호출 코드, account/order adapter는 추가하지 않았습니다.
- `.env.example`은 변경하지 않았고 real `client_id`, `client_secret`, `access_token`, account id를 문서에 넣지 않았습니다.
- `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=false` 기본 경계를 변경하지 않았습니다.
- Codex MCP enabled surface, Local Operations API route, dashboard asset, package script는 변경하지 않았습니다.

### Review 2: Tests and Validation

- `npm run check`: pass, 335 tests.
- `git diff --check`: pass. Git line-ending conversion warnings only, whitespace errors 없음.
- 공식 문서 확인: Auth Markdown과 OpenAPI JSON에서 `POST /oauth2/token`, OAuth2 Client Credentials, `application/x-www-form-urlencoded`, refresh token 없음, client당 유효 token 1개, `AUTH` rate limit group을 확인했습니다.
- 확인한 OpenAPI metadata는 `openapi=3.1.0`, `info.version=1.1.1`, server `https://openapi.tossinvest.com`입니다.
- 이번 phase는 docs-only 변경이라 browser E2E smoke, 성능 지표 측정, 접근성 자동 검사는 실행 대상에서 제외했습니다.

### Review 3: Diff and Integration

- `docs/official-token-auth-design.md`는 token endpoint 계약, secret handling, process memory token cache, expiry margin, guarded reissue, single-flight, multi-process 제약, MCP/dashboard token value 노출 금지 정책을 문서화합니다.
- `README.md`는 official adapter와 token auth client가 아직 구현되지 않았고 설계 문서만 존재한다는 current status를 연결합니다.
- `docs/architecture.md`는 official adapter 설계와 token auth 설계의 참조 경계를 분리합니다.
- `docs/PROJECT_STRUCTURE.md`와 `docs/official-toss-open-api-adapter-design.md`는 새 token auth 설계 문서를 관련 문서와 PR 분리 계획에 추가합니다.
- `docs/pr-implementation-plan.md`는 Later PRs의 official token auth design 범위, 포함 항목, 제외 항목을 구체화했습니다.
- 신규 runtime behavior, API contract implementation, data model, migration, dashboard UI 변경은 없습니다.

## Phase 29: Official Token Config Parser

### Review 1: Scope and Safety

- 범위는 official Toss Open API token auth config parser, safe default quality gate, placeholder env, 관련 문서 갱신에 한정합니다.
- token auth HTTP client, token issue request builder, token cache, official API 실제 호출, account/order adapter는 추가하지 않았습니다.
- `.env.example`에는 `TOSS_OPEN_API_AUTH_ENABLED=false`와 빈 `TOSS_OPEN_API_CLIENT_ID`, `TOSS_OPEN_API_CLIENT_SECRET` placeholder만 추가했고 real credential은 포함하지 않았습니다.
- `readTossOpenApiAuthConfig({})`는 `enabled=false`, `status=disabled`를 기본값으로 유지합니다.
- Codex MCP enabled surface, Local Operations API route, dashboard asset, package script는 변경하지 않았습니다.

### Review 2: Tests and Validation

- `npm run build`: pass.
- `node --test dist/config/tossOpenApiAuthConfig.test.js`: pass, 5 tests.
- `npm run check`: pass, 340 tests.
- `git diff --check`: pass. Git line-ending conversion warnings only, whitespace errors 없음.
- secret-like token/key pattern grep: no matches.
- 금지 경계 grep 결과 신규 code에는 `place_order`, raw `tossctl`, raw `codex exec`, live order HTTP call, `/oauth2/token` 호출 surface가 없고, match는 문서상 금지/설계 문구와 기존 safe default 예시로만 확인했습니다.
- 이번 phase는 dashboard/API behavior 또는 asset 변경이 없어 browser E2E smoke, 성능 지표 측정, 접근성 자동 검사는 실행 대상에서 제외했습니다.

### Review 3: Diff and Integration

- `src/config/tossOpenApiAuthConfig.ts`는 `TOSS_OPEN_API_AUTH_ENABLED`, `TOSS_OPEN_API_BASE_URL`, `TOSS_OPEN_API_CLIENT_ID`, `TOSS_OPEN_API_CLIENT_SECRET`을 해석합니다.
- enabled 상태에서 client id 또는 client secret이 없으면 `status=invalid`와 issue code로 fail-closed 상태를 반환합니다.
- `summarizeTossOpenApiAuthConfig`는 credential value를 반환하지 않고 존재 여부만 반환합니다.
- `scripts/qualityGate.mjs`는 default Toss Open API auth config가 disabled 상태인지 build artifact 기준으로 검사합니다.
- `.env.example`, README, `docs/PROJECT_STRUCTURE.md`, `docs/CODE_CONVENTION.md`, `docs/official-token-auth-design.md`, `docs/official-toss-open-api-adapter-design.md`, `docs/pr-implementation-plan.md`는 parser 구현 상태와 후속 PR 분리 계획을 반영합니다.
- 신규 network call, API contract implementation, data model, migration, dashboard UI 변경은 없습니다.

## Phase 30: Mocked Token Auth Client

### Review 1: Scope and Safety

- 범위는 injected issuer 기반 `TossOpenApiAuthClient`, token issue request builder, token response parser, process memory cache, single-flight, 관련 문서 갱신에 한정합니다.
- real HTTP token transport, official API 실제 호출, persistent token store, account/order adapter, Local Operations API/MCP/dashboard token surface는 추가하지 않았습니다.
- disabled/invalid config는 token issuer 호출 전에 fail-closed 처리합니다.
- `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=false` 기본 경계를 변경하지 않았습니다.
- 테스트 credential은 local dummy string만 사용하며, real `client_id`, `client_secret`, `access_token`, account id는 추가하지 않았습니다.

### Review 2: Tests and Validation

- `npm run build`: pass.
- `node --test dist/broker/tossOpenApiAuthClient.test.js`: pass, 9 tests.
- `npm run check`: pass, 349 tests.
- `git diff --check`: pass.
- secret-like token/key pattern grep: no matches.
- code-only forbidden boundary grep: no matches for live order/raw command/network/persistent write surface.
- 이번 phase는 dashboard/API behavior 또는 asset 변경이 없어 browser E2E smoke, 성능 지표 측정, 접근성 자동 검사는 실행 대상에서 제외했습니다.

### Review 3: Diff and Integration

- `src/broker/tossOpenApiAuthClient.ts`는 `application/x-www-form-urlencoded` token issue request를 만들고, `Bearer` response와 positive `expires_in`을 검증합니다.
- `TossOpenApiAuthClient`는 process memory token cache, expiry safety margin, concurrent request single-flight를 제공하지만, 실제 HTTP transport는 injected `TossOpenApiTokenIssuer` 밖에 두었습니다.
- `src/broker/tossOpenApiAuthClient.test.ts`는 request body, disabled/invalid config fail-closed, cache, single-flight, invalid response no-cache, non-`Bearer` rejection, malformed response shape rejection을 검증합니다.
- README, `docs/PROJECT_STRUCTURE.md`, `docs/CODE_CONVENTION.md`, `docs/official-token-auth-design.md`, `docs/official-toss-open-api-adapter-design.md`, `docs/pr-implementation-plan.md`는 mocked auth client 구현 상태와 후속 제외 범위를 반영합니다.
- 신규 network call, persistent token store, API route, data model, migration, dashboard UI 변경은 없습니다.

## Phase 31: Authenticated Read-only HTTP Client

### Review 1: Scope and Safety

- 범위는 injected token provider와 injected transport 기반 `TossOpenApiReadOnlyHttpClient`, read-only request builder, auth config fail-closed guard, HTTP status/error/rate mapping, nested error code parsing, 401 token failure 1회 guarded reissue, 관련 문서 갱신에 한정합니다.
- actual network transport, official API 실제 호출, market endpoint adapter, account snapshot reader, persistent token store, Local Operations API/MCP/dashboard broker surface는 추가하지 않았습니다.
- read-only client는 `GET`만 허용하고 mutation method는 token 발급 또는 transport 호출 전에 fail-closed 처리합니다.
- `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=false` 기본 경계를 변경하지 않았습니다.
- 테스트 token은 local dummy string만 사용하며 real `client_id`, `client_secret`, `access_token`, account id는 추가하지 않았습니다.

### Review 2: Tests and Validation

- official OpenAPI JSON 확인: `openapi=3.1.0`, `info.version=1.1.1`, server `https://openapi.tossinvest.com`, read-only `GET /api/v1/prices`, `GET /api/v1/orderbook`, `GET /api/v1/accounts`, mutation `POST /api/v1/orders` 등을 확인했습니다.
- `npm run build`: pass.
- `node --test dist/broker/tossOpenApiReadOnlyHttpClient.test.js`: pass, 13 tests.
- `npm run check`: pass, 362 tests.
- `git diff --check`: pass.
- secret-like token/key pattern grep: no matches.
- code-only forbidden boundary grep: no matches for direct network call, persistent write surface, live order/raw command surface.
- 이번 phase는 dashboard/API behavior 또는 asset 변경이 없어 browser E2E smoke, 성능 지표 측정, 접근성 자동 검사는 실행 대상에서 제외했습니다.

### Review 3: Diff and Integration

- `src/broker/tossOpenApiReadOnlyHttpClient.ts`는 root-relative path와 https base URL만 허용하고, disabled/invalid auth config를 token provider 호출 전에 차단하며, Bearer token을 request header에 주입합니다.
- `TossOpenApiReadOnlyHttpClient`는 injected token provider와 injected transport만 호출하며 direct `fetch`, `http.request`, `https.request`를 사용하지 않습니다.
- HTTP response mapping은 nested `error.code`, 401 auth failure, 403 forbidden, 429 rate limit과 `Retry-After`, generic 4xx/5xx, invalid status를 구분합니다.
- `401 invalid-token`/`expired-token` 계열은 optional `clearToken()` hook이 있을 때만 cache clear 후 `GET`을 1회 재시도합니다.
- `src/broker/tossOpenApiReadOnlyHttpClient.test.ts`는 Bearer injection, query serialization, mutation method block, disabled/invalid auth config fail-closed, invalid path/base URL, nested error code parsing, 401 token retry, 401/403/429/4xx/5xx mapping, invalid response status를 검증합니다.
- README, `docs/PROJECT_STRUCTURE.md`, `docs/CODE_CONVENTION.md`, `docs/official-token-auth-design.md`, `docs/official-toss-open-api-adapter-design.md`, `docs/pr-implementation-plan.md`는 authenticated read-only HTTP client 구현 상태와 후속 제외 범위를 반영합니다.
- 신규 actual network call, market adapter, account snapshot reader, persistent token store, API route, data model, migration, dashboard UI 변경은 없습니다.

## Phase 32: Read-only Market Data Adapter

### Review 1: Scope and Safety

- 범위는 injected read-only JSON client 기반 `TossOpenApiMarketDataAdapter`, market endpoint path/query mapping, input validation, 관련 문서 갱신에 한정합니다.
- actual network transport, official API 실제 호출, account snapshot reader, account header handling, persistent token store, Local Operations API/MCP/dashboard broker surface는 추가하지 않았습니다.
- adapter는 `/api/v1/prices`, `/api/v1/orderbook`, `/api/v1/trades`, `/api/v1/candles`, `/api/v1/stocks/{symbol}/warnings`, `/api/v1/market-calendar/{KR|US}`만 호출합니다.
- live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter 구현을 추가하지 않았습니다.
- `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=false` 기본 경계를 변경하지 않았습니다.
- real `client_id`, `client_secret`, `access_token`, account id, order id, execution data는 추가하지 않았습니다.

### Review 2: Tests and Validation

- official OpenAPI JSON 확인: `openapi=3.1.0`, `info.version=1.1.1`, server `https://openapi.tossinvest.com`.
- official market endpoint parameter 확인: `prices.symbols` 1-200개 limit, `orderbook.symbol`, `trades.symbol/count`, `candles.symbol/interval/count/before/adjusted`, `stocks/{symbol}/warnings`, `market-calendar/{KR|US}.date`.
- `npm run build`: pass.
- `node --test dist/broker/tossOpenApiMarketDataAdapter.test.js`: pass, 5 tests.
- `npm run check`: pass, 367 tests.
- `git diff --check`: pass.
- secret-like token/key pattern grep: no matches.
- source-only forbidden boundary grep: no matches for direct network call, persistent write surface, live order/raw command surface, live `TradingSignal`/`OrderIntent`/`OrderRouter`.
- 이번 phase는 dashboard/API behavior 또는 asset 변경이 없어 browser E2E smoke, 성능 지표 측정, 접근성 자동 검사는 실행 대상에서 제외했습니다.

### Review 3: Diff and Integration

- `src/broker/tossOpenApiMarketDataAdapter.ts`는 injected read-only JSON client만 호출하며 direct `fetch`, `http.request`, `https.request`를 사용하지 않습니다.
- `getPrices`, `getOrderbook`, `getTrades`, `getCandles`, `getStockWarnings`, `getMarketCalendar`는 official read-only market endpoint path와 query만 구성합니다.
- `prices.symbols`는 1-200개만 허용하고, symbol은 letters, numbers, dot, dash만 허용하며, path segment는 `encodeURIComponent`로 구성합니다.
- `trades.count`는 1-50, `candles.count`는 1-200, `candles.interval`은 `1m` 또는 `1d`, market calendar region은 `KR` 또는 `US`만 허용합니다.
- `src/broker/tossOpenApiMarketDataAdapter.test.ts`는 prices/orderbook/trades/candles/warnings/calendar mapping, 201개 이상 prices symbols fail-closed, invalid input fail-closed, order endpoint 미호출을 검증합니다.
- README, `docs/PROJECT_STRUCTURE.md`, `docs/CODE_CONVENTION.md`, `docs/official-toss-open-api-adapter-design.md`, `docs/pr-implementation-plan.md`는 read-only market data adapter 구현 상태와 후속 제외 범위를 반영합니다.
- 신규 actual network call, account snapshot reader, account/order mutation, API route, data model, migration, dashboard UI 변경은 없습니다.

## Phase 33: Read-only Account Snapshot Reader

### Review 1: Scope and Safety

- 범위는 injected account read-only JSON client 기반 `TossOpenApiAccountSnapshotReader`, accounts/holdings endpoint boundary, account number/accountSeq masking, source status, 관련 문서 갱신에 한정합니다.
- actual network transport, official API 실제 호출, persistent account store, portfolio mutation, Local Operations API/MCP/dashboard broker surface는 추가하지 않았습니다.
- reader는 `/api/v1/accounts`, `/api/v1/holdings`만 호출합니다.
- holdings 조회는 explicit `accountSeq`가 있을 때만 수행하고, 없으면 degraded source status로 남깁니다.
- live `TradingSignal`, live `OrderIntent`, `OrderRouter`, broker adapter 구현을 추가하지 않았습니다.
- `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=false` 기본 경계를 변경하지 않았습니다.
- real `client_id`, `client_secret`, `access_token`, account id, order id, execution data는 추가하지 않았습니다.

### Review 2: Tests and Validation

- official OpenAPI JSON 확인: `GET /api/v1/accounts`는 account list를 반환하고, `GET /api/v1/holdings`는 `X-Tossinvest-Account` header와 optional `symbol` query를 사용합니다.
- `npm run build`: pass.
- `node --test dist/broker/tossOpenApiAccountSnapshotReader.test.js`: pass, 6 tests.
- `npm run check`: pass, 375 tests.
- `git diff --check`: pass.
- changed-file diff review: real secret, real account id, real order id, execution data는 없고, test fixture의 dummy `accountNo`는 masking assertion 용도로만 사용합니다.
- source-only forbidden boundary grep: no matches for direct network call, persistent write surface, live order/raw command surface, live `TradingSignal`/`OrderIntent`/`OrderRouter`.
- 이번 phase는 dashboard/API behavior 또는 asset 변경이 없어 browser E2E smoke, 성능 지표 측정, 접근성 자동 검사는 실행 대상에서 제외했습니다.

### Review 3: Diff and Integration

- `src/broker/tossOpenApiAccountSnapshotReader.ts`는 injected account read-only JSON client만 호출하며 direct `fetch`, `http.request`, `https.request`를 사용하지 않습니다.
- `readSnapshot`은 input `accountSeq`/`symbol`을 HTTP client 호출 전에 검증합니다.
- `accountSeq`가 없으면 holdings 조회를 수행하지 않고 degraded source status와 warning을 반환합니다.
- `accountSeq`가 있으면 `/api/v1/accounts`와 `/api/v1/holdings`를 호출하고, holdings query에는 optional normalized `symbol`만 추가합니다.
- account number와 accountSeq는 snapshot output에서 `****`로 masking합니다.
- `src/broker/tossOpenApiAccountSnapshotReader.test.ts`는 account/holdings mapping, masking, missing `accountSeq` degraded status, invalid input fail-closed, malformed envelope fail-closed, order endpoint 미호출을 검증합니다.
- README, `docs/PROJECT_STRUCTURE.md`, `docs/CODE_CONVENTION.md`, `docs/official-toss-open-api-adapter-design.md`, `docs/pr-implementation-plan.md`는 read-only account snapshot reader 구현 상태와 후속 제외 범위를 반영합니다.
- 신규 actual network call, order mutation, portfolio mutation, API route, data model, migration, dashboard UI 변경은 없습니다.

### Codex Review Fix: Account Header Contract

- Review finding: account snapshot reader가 `{ accountSeq }` option을 넘기지만 기존 `TossOpenApiReadOnlyHttpClient`는 query array만 받아 `X-Tossinvest-Account` header를 만들지 못했습니다.
- Fix review 1: `TossOpenApiReadOnlyHttpClient.getJson`는 기존 query array 호출을 유지하면서 `{ query, accountSeq }` options object를 추가로 받도록 확장했습니다.
- Fix review 2: `accountSeq`는 positive integer만 허용하고 invalid value는 token provider/transport 호출 전에 `TOSS_OPEN_API_READONLY_INVALID_ACCOUNT_SEQ`로 fail-closed 처리합니다.
- Fix review 3: `TossOpenApiAccountSnapshotReader`는 ad-hoc local options interface 대신 공용 `TossOpenApiReadOnlyRequestOptions` contract를 사용합니다.
- 추가 테스트: read-only HTTP client가 `/api/v1/holdings` 요청에서 `X-Tossinvest-Account` header를 주입하는지 검증합니다.
- 추가 테스트: invalid `accountSeq`가 auth/transport 호출 전에 차단되는지 검증합니다.

## Phase 34: Live RiskEngine Policy

### Review 1: Scope and Safety

- 범위는 `src/risk`의 deterministic `LiveRiskEngine`, live risk policy, 관련 단위 테스트와 문서 갱신에 한정합니다.
- `LiveRiskEngine`은 이미 구조화된 live order intent와 risk snapshot만 입력으로 받으며, 자연어 주문 또는 Codex CLI `virtual_decision`을 해석하지 않습니다.
- broker gateway, official order endpoint, `OrderRouter`, execution tracking, Local Operations API/MCP/dashboard mutation surface는 추가하지 않았습니다.
- 기본 policy는 fail-closed이며 명시 policy 없이는 live order approval이 열리지 않습니다.
- `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=false` 기본 경계를 변경하지 않았습니다.
- real account number, token, order id, execution data는 추가하지 않았습니다.

### Review 2: Tests and Validation

- `npm run build`: pass.
- `node --test dist/risk/liveRiskEngine.test.js`: pass, 28 tests.
- `npm run check`: pass, 403 tests.
- `git diff --check`: pass.
- `src/risk` forbidden boundary grep: no matches for direct network call, filesystem write, live order/raw command surface, `TRADING_ENABLED=true`, `AI_DECISION_ENABLED=true`.
- valid limit order approval path를 검증합니다.
- default policy fail-closed를 검증합니다.
- stale signal, market hours unknown/closed, duplicate intent, idempotency reuse, cooldown, max order amount, daily loss, exposure caps, market order policy, sell position, preview policy를 검증합니다.
- stale risk snapshot이 fail-closed reject code로 차단되는지 검증합니다.
- duplicate position row가 있을 때 symbol exposure가 모든 matching row를 합산하는지 검증합니다.
- duplicate position row가 있을 때 sellable quantity가 모든 matching row를 합산하는지 검증합니다.
- missing/null root live risk payload가 throw 없이 fail-closed 되는지 검증합니다.
- malformed numeric order intent와 risk snapshot을 fail-closed reject code로 차단하는지 검증합니다.
- malformed snapshot audit metadata를 fail-closed reject code로 차단하는지 검증합니다.
- malformed enum/identity/symbol intent field를 fail-closed reject code로 차단하는지 검증합니다.
- malformed live order preview를 fail-closed reject code로 차단하는지 검증합니다.
- 동일 `orderIntentId`를 가진 open order가 있으면 signal/idempotency 재생성 여부와 무관하게 duplicate로 차단하는지 검증합니다.
- pending BUY open order의 notional을 exposure cap에 반영하는지 검증합니다.
- pending BUY open order의 notional이 없으면 snapshot invalid로 fail-closed 되는지 검증합니다.
- pending SELL open order의 quantity를 보유 수량 계산에 반영하는지 검증합니다.
- pending SELL open order의 quantity가 없으면 snapshot invalid로 fail-closed 되는지 검증합니다.
- malformed numeric risk policy를 `INVALID_RISK_POLICY`로 fail-closed 차단하는지 검증합니다.
- malformed boolean risk policy를 `INVALID_RISK_POLICY`와 safe fallback으로 fail-closed 차단하는지 검증합니다.
- malformed risk policy collection이 throw 없이 `INVALID_RISK_POLICY`로 fail-closed 되는지 검증합니다.
- malformed cooldown expiry를 `INVALID_RISK_POLICY`로 fail-closed 차단하는지 검증합니다.
- unknown market order policy를 `INVALID_RISK_POLICY`와 disabled fallback으로 fail-closed 차단하는지 검증합니다.
- malformed snapshot collection이 throw 없이 `INVALID_RISK_SNAPSHOT`으로 fail-closed 되는지 검증합니다.
- sell intent는 exposure를 증가시키지 않는지 검증합니다.
- 이번 phase는 dashboard/API behavior 또는 asset 변경이 없어 browser E2E smoke, 성능 지표 측정, 접근성 자동 검사는 실행 대상에서 제외합니다.

### Review 3: Diff and Integration

- `src/risk/liveRiskPolicy.ts`는 live risk reject code, rule id, fail-closed policy default, symbol normalization을 정의합니다.
- `src/risk/liveRiskEngine.ts`는 pure in-memory evaluation만 수행하며 filesystem, network, broker, storage를 호출하지 않습니다.
- `src/risk/liveRiskEngine.ts`는 raw root payload를 안전한 evaluation input으로 정규화한 뒤 rule evaluation을 수행합니다.
- `RiskDecision`은 `orderIntentId`, `signalId`, `approved`, `rejectCodes`, `checkedRules`, `riskSnapshotRef`, `createdAt`을 반환합니다.
- `docs/PROJECT_STRUCTURE.md`, `docs/CODE_CONVENTION.md`, `docs/risk-policy.md`, `docs/pr-implementation-plan.md`는 live risk module 위치와 제외 범위를 반영합니다.
- 신규 official API call, order mutation, broker gateway, `OrderRouter`, API route, MCP tool, dashboard UI, data model, migration 변경은 없습니다.

### Codex Review Fix

- P2 `Fail closed on invalid live intent fields`: runtime에서 `side`, `orderType`, `market`, `orderIntentId`, `signalId`, `idempotencyKey`, `symbol`을 검증하도록 `INVALID_ORDER_INTENT` 조건을 확장했습니다.
- P2 `Reject duplicate orderIntentId before approval`: snapshot open order의 `orderIntentId`가 incoming intent와 같으면 `DUPLICATE_ORDER_INTENT`로 차단하도록 보강했습니다.
- 추가 테스트: malformed enum/identity intent field reject, duplicate `orderIntentId` reject.

### Codex Review Fix 2

- P2 `Reserve pending buy exposure before approving`: `LiveOpenOrder`에 optional `estimatedGrossAmountKrw`를 추가하고, BUY open order의 pending notional을 symbol/market/total exposure 계산에 반영했습니다.
- P2 `Validate symbol before normalizing it`: intent symbol과 snapshot symbol을 `safeNormalizeLiveRiskSymbol`로 처리해 malformed symbol이 throw가 아니라 fail-closed reject code로 귀결되도록 보강했습니다.
- 추가 테스트: pending BUY exposure cap 반영, pending BUY notional 누락 snapshot reject, non-string symbol malformed intent reject.

### Codex Review Fix 3

- P2 `Guard malformed snapshots before iterating arrays`: `positions`, `openOrders`, `marketSessions`를 array/object 여부 확인 후 접근하도록 `safeRiskPositions`, `safeOpenOrders`, `safeMarketSessions`를 추가했습니다.
- 추가 테스트: malformed snapshot collection이 throw 없이 `INVALID_RISK_SNAPSHOT`으로 reject되는지 검증합니다.

### Codex Review Fix 4

- P1 `Reserve open sell quantities before approving SELLs`: `LiveOpenOrder`에 optional `quantity`를 추가하고, SELL open order의 pending quantity를 보유 수량 계산에 반영했습니다.
- P1 `Validate policy limits before approving`: risk policy numeric limit을 finite/non-negative 값으로 정규화하고 invalid 입력은 `INVALID_RISK_POLICY`로 fail-closed 처리하도록 보강했습니다.
- 추가 테스트: pending SELL quantity 예약, pending SELL quantity 누락 snapshot reject, malformed numeric risk policy reject.

### Codex Review Fix 5

- P2 `Fail closed on unknown market order policies`: untyped source에서 들어온 unknown `marketOrderPolicy`를 `INVALID_RISK_POLICY`로 reject하고 `disabled`로 정규화하도록 보강했습니다.
- 추가 테스트: invalid market order policy가 MARKET order approval로 이어지지 않고 `INVALID_RISK_POLICY`, `MARKET_ORDER_DISABLED`로 reject되는지 검증합니다.

### Codex Review Fix 6

- P1 `Reject malformed boolean risk gates`: `killSwitch`, `requireMarketOpen`, `requirePreview`가 boolean이 아니면 `INVALID_RISK_POLICY`로 reject하고 safe fallback으로 정규화하도록 보강했습니다.
- P2 `Guard policy collections before iterating`: `allowedSymbols`, `allowedMarkets`, `cooldownEntries`를 배열 여부와 element shape 검증 후 정규화해 malformed collection이 throw가 아니라 fail-closed reject로 귀결되도록 보강했습니다.
- 추가 테스트: malformed boolean policy gate reject, malformed policy collection reject.

### Codex Review Fix 7

- P1 `Reject malformed live order previews`: `previewId`, `orderIntentId`, `estimatedGrossAmountKrw`, `expiresAt`를 runtime preview shape로 검증해 blank preview reference가 approval로 이어지지 않도록 보강했습니다.
- P2 `Reject invalid cooldown expiry dates`: `cooldownEntries.activeUntil`을 parse 가능한 timestamp로 검증해 malformed expiry가 cooldown을 조용히 비활성화하지 않고 `INVALID_RISK_POLICY`로 reject되도록 보강했습니다.
- 추가 테스트: malformed live order preview reject, invalid cooldown expiry reject.

### Codex Review Fix 8

- P2 `Guard missing live risk payloads before dereferencing`: `evaluate()` 진입점에서 raw root payload를 `NormalizedLiveRiskEvaluationInput`으로 정규화해 null/missing `intent` 또는 `snapshot`이 throw가 아니라 `INVALID_ORDER_INTENT`, `INVALID_RISK_SNAPSHOT`으로 귀결되도록 보강했습니다.
- P2 `Reject snapshots without audit identity`: `riskSnapshotRef`와 `capturedAt`를 snapshot shape 검증에 포함해 blank snapshot reference 또는 unparseable timestamp가 approval로 이어지지 않도록 보강했습니다.
- 추가 테스트: missing live risk input reject, malformed root payload reject, snapshot audit metadata reject.

### Codex Review Fix 9

- P1 `Fail closed when risk snapshots are stale`: `LiveRiskPolicy.maxSnapshotAgeMs`와 `RISK_SNAPSHOT_STALE` reject code를 추가해 stale/future `capturedAt` snapshot이 live approval로 이어지지 않도록 보강했습니다.
- P1 `Sum all matching positions for symbol exposure`: `currentSymbolExposureKrw`가 첫 position row만 보지 않고 동일 market/symbol position row 전체를 합산하도록 수정했습니다.
- 추가 테스트: stale risk snapshot reject, duplicate position row symbol exposure aggregation.

### Codex Review Fix 10

- P2 `Aggregate sellable position rows before rejecting sells`: `evaluateSellPosition`이 첫 matching position row만 보지 않고 동일 market/symbol position row 전체의 quantity를 합산해 SELL 가능 수량을 판단하도록 수정했습니다.
- 추가 테스트: duplicate position row sellable quantity aggregation.

## Strategy Bucket Test Create UI

### Review 1: Scope and Boundary

- 이번 PR은 Next.js strategy test lab에서 validation을 통과한 현재 request에 대해 queued strategy bucket test record를 생성하는 route handler와 UI 연결만 다룹니다.
- replay runner 시작, SSE/polling progress refresh, result metric aggregation, live order surface는 추가하지 않았습니다.
- `/dashboard/lab/strategy-tests/create`는 browser가 Local Operations API를 직접 cross-origin 호출하지 않도록 server-side proxy만 수행합니다.
- backend create 응답과 UI copy는 `storageMutationEnabled: true`, `liveTradingEnabled: false`, `orderPlacementEnabled: false`, `replayRunnerStarted: false` 경계를 노출합니다.

### Review 2: ViewModel and Persistence Contract

- `GET /dashboard/view-model/strategy-test-lab`은 `strategy-bucket-test-records.jsonl`을 읽어 queued/running record를 active test summary로 반환합니다.
- malformed strategy bucket test record는 화면 contract를 깨지 않도록 ViewModel summary에서 제외합니다.
- active test table은 test id, bucket, phase, heartbeat, progress count만 표시하고 raw provider output이나 live execution detail을 표시하지 않습니다.
- backend test는 create endpoint가 queued record와 audit event를 저장하고 runner를 호출하지 않으며, ViewModel active summary가 같은 `testId`와 `configHash`를 노출하는지 확인합니다.

### Review 3: Tests and Docs

- Next.js E2E는 validation 전 create button disabled, validation 성공 후 queued record 생성, invalid window에서 create button disabled, live order/trade/buy/sell control 부재를 확인합니다.
- docs는 Next.js create route handler가 queued record와 audit event만 저장하고 replay runner를 시작하지 않는다고 명시합니다.
- `npm run check`, `npm --prefix apps/dashboard run build`, `npm --prefix apps/dashboard run lint`, `npm --prefix apps/dashboard run test:e2e`, targeted Local Operations API tests, `git diff --check`를 실행했습니다.
- changed-file forbidden boundary grep에서 신규 live order, raw command, `replayRunnerStarted: true`, `orderPlacementEnabled: true` surface는 확인되지 않았습니다.

### Codex Review Fix

- Review finding: `/dashboard/lab/strategy-tests/create`가 어떤 incoming POST에도 backend operation header와 origin을 주입해 queued record 저장 mutation을 proxy할 수 있었습니다.
- Fix review 1: create proxy는 backend 호출 전에 `x-toss-trading-dashboard-intent: strategy-bucket-test-create`를 요구하고, 누락 시 `dashboard_intent_required`로 403을 반환합니다.
- Fix review 2: create proxy는 incoming `origin`/`referer`/`sec-fetch-site`에서 명시적인 cross-origin metadata를 확인하고, 해당 요청은 `same_origin_required`로 403을 반환합니다.
- Fix review 3: E2E는 intent 누락 요청과 cross-origin 요청이 storage mutation 없이 차단되는지 확인하고, 정상 UI create flow는 기존 queued record boundary를 유지하는지 확인합니다.

### Codex Review Fix 2

- Review finding: queued/running strategy bucket test의 persisted heartbeat status를 그대로 렌더링하면 `staleAfterSeconds`가 지난 record도 `fresh`로 보일 수 있었습니다.
- Review finding: dashboard intent header가 있어도 `origin`, `referer`, `sec-fetch-site`가 모두 없는 direct POST는 create proxy를 통과할 수 있었습니다.
- Fix review 1: strategy test lab ViewModel은 조회 시점의 `now`와 `lastSeenAt + staleAfterSeconds`를 비교해 heartbeat status를 `fresh`, `stale`, `missing`으로 재계산합니다.
- Fix review 2: Local Operations routing은 테스트와 운영 기준 시각이 어긋나지 않도록 strategy test lab ViewModel에 server `now`를 전달합니다.
- Fix review 3: create proxy는 dashboard intent header 외에도 positive same-origin `origin`, `referer`, `sec-fetch-site` evidence를 요구하고, metadata가 없으면 `same_origin_required`로 403을 반환합니다.

### Codex Review Fix 3

- Review finding: create 성공 후 client local result만 갱신되고 server-rendered active test count/progress table은 이전 ViewModel snapshot에 머물 수 있었습니다.
- Fix review 1: create state가 현재 request의 `queued` 상태로 전환되면 `router.refresh()`를 한 번 호출해 strategy test lab Server Component 데이터를 다시 읽습니다.
- Fix review 2: create 결과 test id와 active progress row에 test id 기반 `data-testid`를 추가해 같은 queued record가 progress table에 반영되는지 E2E에서 검증합니다.
- Fix review 3: E2E는 create 성공 후 새 test id가 `Bucket Test Progress` row로 나타나고 bucket/phase가 표시되는지 확인합니다.

### Codex Review Fix 4

- Review finding: append-only record에 같은 `testId`의 queued record 뒤 terminal record가 추가되면, status 필터를 먼저 적용한 active summary가 과거 queued row를 계속 표시할 수 있었습니다.
- Fix review 1: strategy test lab ViewModel은 record를 뒤에서 앞으로 읽어 `testId`별 최신 parseable record를 먼저 선택합니다.
- Fix review 2: 최신 record가 `completed`, `failed`, `cancelled`이면 해당 `testId`의 과거 queued/running record를 active summary에 포함하지 않습니다.
- Fix review 3: Local Operations API 테스트는 같은 `testId`의 queued record 뒤 completed record가 append된 경우 active test list가 비는지 검증합니다.

### Codex Review Fix 5

- Review finding: create proxy가 `origin`/usable `referer` 없이 `sec-fetch-site: same-site`만 있어도 same-origin fallback으로 허용할 수 있었습니다.
- Fix review 1: create proxy fallback은 `sec-fetch-site: same-origin`만 positive same-origin evidence로 인정합니다.
- Fix review 2: `sec-fetch-site: same-site` 직접 POST는 dashboard intent header가 있어도 `same_origin_required` 403으로 차단합니다.
- Fix review 3: E2E는 same-site metadata request가 storage mutation 없이 거절되는지 검증합니다.

### Codex Review Fix 6

- Review finding: create proxy가 public dashboard intent header와 request metadata만으로 queued record mutation을 허용할 수 있었습니다.
- Fix review 1: create proxy는 server-side `DASHBOARD_MUTATION_TOKEN`과 request `x-toss-trading-dashboard-mutation-token` header가 일치하지 않으면 fail-closed 처리합니다.
- Fix review 2: strategy bucket test form은 mutation token 입력값을 create request header로만 전달하고 request preview나 result payload에는 표시하지 않습니다.
- Fix review 3: E2E는 missing/invalid token, missing metadata, same-site metadata, cross-origin metadata가 storage mutation 없이 차단되고 valid token flow만 queued record를 생성하는지 검증합니다.

### Codex Review Fix 7

- Review finding: create proxy가 incoming `content-type`을 확인하지 않고 body를 읽은 뒤 backend에 `application/json`으로 전달할 수 있었습니다.
- Fix review 1: create proxy는 body를 읽기 전에 incoming `content-type`이 `application/json`인지 확인하고 아니면 `unsupported_media_type` 415로 차단합니다.
- Fix review 2: 실패 응답은 기존 guard payload와 동일하게 storage mutation, live trading, order placement, replay runner를 모두 false로 유지합니다.
- Fix review 3: E2E는 valid token과 same-origin evidence가 있어도 `text/plain` create 요청이 storage mutation 없이 415로 차단되는지 검증합니다.

## Strategy Bucket Test Progress Polling

### Review 1: Scope and Boundary

- 이번 PR은 strategy bucket test의 read-only progress 조회와 Next.js polling fallback만 다룹니다.
- Local Operations API는 `GET /dashboard/view-model/strategy-test-lab/tests/{testId}/progress`에서 append-only record의 최신 parseable progress summary를 반환합니다.
- replay runner 시작, SSE stream, result metric aggregation, live order surface는 추가하지 않습니다.

### Review 2: ViewModel and UI Contract

- progress endpoint는 `mode: paper_only`, `readOnly: true`, `storageMutationEnabled: false`, `liveTradingEnabled: false`, `orderPlacementEnabled: false`, `replayRunnerStarted: false`를 명시합니다.
- Next.js route handler는 browser가 Local Operations API를 직접 cross-origin 호출하지 않도록 server-side read-only proxy로 동작합니다.
- active progress table은 SSR initial snapshot을 렌더링한 뒤 queued/running test만 polling fallback으로 갱신합니다.

### Review 3: Tests and Docs

- backend test는 queued record가 단건 progress endpoint에서도 동일한 test id, phase, heartbeat, count로 조회되는지 확인합니다.
- E2E는 queued create 이후 progress route payload와 progressbar 렌더링, live order/trade/buy/sell control 부재를 확인합니다.
- docs는 N5 여섯 번째 구현 단위가 polling fallback만 포함하고 runner/SSE/result aggregation은 제외한다고 명시합니다.

### Codex Review Follow-up: Overlapping Refresh Guard

- Fix review 1: progress refresh는 in-flight `AbortController`가 있으면 다음 interval/manual refresh를 시작하지 않습니다.
- Fix review 2: active test set이 바뀌면 진행 중인 request를 abort하고 request id가 맞는 최신 응답만 state에 반영합니다.
- Fix review 3: `fetchProgressUpdates`는 shared `AbortSignal`을 각 progress fetch에 전달해 cleanup 시 누적 요청을 중단합니다.

### Codex Review Follow-up: Active Row Lifecycle

- Fix review 1: stale heartbeat가 된 queued/running test도 계속 polling 대상에 포함해 이후 fresh/terminal append-only record를 받을 수 있게 했습니다.
- Fix review 2: progress endpoint가 completed/failed/cancelled 최신 record를 반환하면 active progress table에서 해당 row를 제거합니다.
- Fix review 3: active row lifecycle 판정은 server ViewModel active list와 동일하게 test status 기준 queued/running으로 제한합니다.

## Dashboard Compliance Analytics

### Review 1: Scope and Boundary

- 이번 PR은 기존 `portfolio-compliance` read-only ViewModel과 `/dashboard` summary 렌더링만 확장합니다.
- 새 저장 schema, migration, policy artifact persistence, replay runner, SSE stream, live order surface는 추가하지 않습니다.
- browser client는 strategy bucket, cash reserve, hedge, cost/turnover metric을 재계산하지 않고 backend ViewModel을 렌더링만 합니다.

### Review 2: ViewModel and UI Contract

- `PolicyComplianceViewModel`에 `complianceAnalytics`를 추가해 strategy bucket mix, cash reserve, hedge effectiveness, cost/turnover 요약을 한 payload에서 제공합니다.
- dynamic cash reserve는 backend가 market regime을 기준으로 target ratio, minimum reserve, cash gap, reserve status를 계산합니다.
- hedge effectiveness는 hedge exposure coverage, net downside exposure ratio, hedge cost drag proxy를 read-only metric으로 노출합니다.
- `/dashboard`는 `Compliance Analytics` section을 추가하고 기존 portfolio compliance table과 risk gate summary contract를 유지합니다.

### Review 3: Tests and Docs

- backend ViewModel contract test는 dynamic cash reserve, hedge coverage, hedge cost drag, strategy bucket concentration, bucket-level cost/turnover 값을 검증합니다.
- Next.js E2E는 `/dashboard`에서 `Compliance Analytics`, `Strategy Bucket Mix`, `Cash Reserve`, `Hedge Effectiveness`, `Cost & Turnover`가 표시되는지 확인합니다.
- docs는 N6 첫 구현 단위와 제외 범위를 분리해 runner/SSE/result aggregation/live order surface가 이번 PR 범위가 아님을 명시합니다.

### Codex Review Fix

- Review finding: 현재 hedge position이 없고 과거 hedge trade만 남은 경우 hedge coverage가 0인데도 hedge status가 `ok`로 떨어질 수 있었습니다.
- Fix review 1: hedge status는 gross exposure가 있고 current hedge exposure가 0 이하이면 hedge trade 이력과 무관하게 `ineffective`로 판정하도록 변경했습니다.
- Fix review 2: `hedgeEnabled`의 이력 표시 의미는 유지하되, healthy/over-hedged 판정 경로는 positive current hedge exposure가 있을 때만 도달하게 했습니다.
- Fix review 3: 현재 long-term exposure만 있고 stale hedge trade가 남은 ViewModel test를 추가해 hedge compliance와 compliance analytics가 모두 `ineffective`를 반환하는지 검증합니다.
