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
