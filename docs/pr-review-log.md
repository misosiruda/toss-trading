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
