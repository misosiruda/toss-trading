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
