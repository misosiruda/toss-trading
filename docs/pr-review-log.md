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
