# PR Implementation Plan

> Codex is not the trading engine. PRs must preserve `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`, and read-only-first tool exposure until an explicit later milestone changes the boundary.

## 원칙

이 계획은 작은 PR 단위로 vertical slice를 쌓기 위한 작업 순서입니다. 각 PR은 독립적으로 review 가능해야 하며, 실거래 기능을 열지 않습니다.

공통 완료 조건:

- `BROKER_PROVIDER=mock`
- `TRADING_ENABLED=false`
- `AI_DECISION_MODE=paper_only`
- raw `tossctl` 실행 MCP tool 없음
- raw `codex exec` 실행 MCP tool 없음
- 계좌번호, token, order ID, execution data 원문 저장 없음
- paper trading 결과를 투자 조언이나 수익 보장처럼 표현하지 않음

공통 제외 범위:

- live order placement
- live `TradingSignal` 자동 생성
- official Toss Open API adapter 구현
- `tossinvest-cli` fork vendoring
- Codex가 shell command를 직접 고르는 agent loop

## PR-00: Repository Baseline

목표:

- 현재 문서 작업을 Git baseline으로 고정합니다.
- 이후 PR 단위 review가 가능하도록 repository를 초기화합니다.

작업 범위:

- `git init`
- 현재 문서 commit
- 기본 `.gitignore` 추가
- README에서 implementation plan 링크 확인

검증:

- `git status --short`가 clean
- 문서에 real credential 없음
- `.env.example`만 존재하고 real `.env`는 commit하지 않음

제외:

- runtime code
- package manager 설정
- MCP server 구현

## PR-01: TypeScript Runtime Scaffold

목표:

- backend worker와 MCP server 구현을 위한 최소 TypeScript/Node 프로젝트를 만듭니다.

작업 범위:

- `package.json`
- `tsconfig.json`
- test runner 설정
- `src/` 디렉터리
- `src/index.ts` placeholder
- build/test script
- `.gitignore` 보강

검증:

- `npm install`
- `npm run build`
- `npm test`

제외:

- domain logic
- Codex CLI 호출
- `tossctl` 호출
- MCP tool 구현

## PR-02: Domain Schemas and Validation

목표:

- paper trading과 read-only intelligence의 핵심 contract를 먼저 고정합니다.

작업 범위:

- `MarketPacket`
- `MarketCandidate`
- `VirtualDecision`
- `VirtualRiskDecision`
- `VirtualPortfolio`
- `VirtualTrade`
- `AuditEvent`
- schema validation helper
- fixture 기반 schema tests

검증:

- valid fixture 통과
- invalid action reject
- missing `data_ref` reject
- stale timestamp reject helper test
- `npm test`

제외:

- 파일 저장소
- Codex CLI 호출
- paper order 체결 로직

## PR-03: Local Store and Audit Log

목표:

- paper state와 audit event를 local persistent store에 저장합니다.

작업 범위:

- append-only JSONL audit store
- virtual portfolio store
- virtual decision store
- virtual trade store
- masking helper
- repository interfaces
- file path config

검증:

- audit append/read test
- portfolio read/write test
- corrupted JSONL line handling test
- sensitive field masking test

제외:

- MCP tools
- Codex CLI 호출
- `tossctl` collector

## PR-04: Paper Trading Core

목표:

- AI 없이도 `virtual_decision` fixture를 검증하고 가상 체결까지 처리합니다.

작업 범위:

- `VirtualRiskEngine`
- `PaperOrderEngine`
- `VirtualLedger`
- virtual cash/position update
- average price calculation
- realized/unrealized PnL placeholder
- reject code mapping

검증:

- cash 부족 reject
- max symbol exposure reject
- stale decision reject
- valid `VIRTUAL_BUY` fills virtual trade
- `VIRTUAL_SELL` updates virtual position
- rejected decision does not mutate portfolio

제외:

- Codex CLI
- real order router
- broker adapter

## PR-05: Market Packet Builder with Mock Data

목표:

- mock candidates와 virtual portfolio에서 Codex input인 compact `market_packet`을 생성합니다.

작업 범위:

- `MarketPacketBuilder`
- top N candidate trimming
- source refs inclusion
- constraints inclusion
- packet expiry
- fixture generator

검증:

- packet max candidates 적용
- packet expiry 생성
- missing source ref reject 또는 warning
- virtual portfolio snapshot 포함
- snapshot에 sensitive data 없음

제외:

- `tossctl` collector
- Codex CLI 호출
- MCP tools

## PR-06: Codex CLI Decision Provider Dry Run

목표:

- `market_packet`을 `codex exec`에 전달하고 `virtual_decision` JSON을 받아 검증하는 provider를 구현합니다.

작업 범위:

- `CodexCliDecisionProvider`
- command construction
- stdin input support
- `--sandbox read-only`
- `--output-schema` support
- timeout
- run budget guard
- invalid output handling
- provider disabled mode

검증:

- `AI_DECISION_ENABLED=false`이면 실행하지 않음
- command args에 `read-only` sandbox 포함
- timeout은 `AI_DECISION_FAILED`
- invalid JSON은 no paper order
- mocked process runner로 success path test

제외:

- scheduled run
- real Codex 호출을 CI 필수로 만들기
- MCP raw execution tool

## PR-07: End-to-End Paper Decision CLI

목표:

- 한 명령으로 mock packet 생성, Codex decision dry-run, schema validation, paper order 기록까지 실행합니다.

작업 범위:

- local CLI command 또는 script
- `paper:run-once`
- dry-run mode
- output paths
- summary report
- audit event chain

검증:

- mocked Codex provider로 end-to-end test
- 실패 시 portfolio 불변
- 성공 시 virtual trade와 audit event 생성
- report에 paper trading 문구 포함

제외:

- cron/scheduler
- `tossctl` live data
- MCP server

## PR-08: Read-only TossInvest CLI Collector

목표:

- `tossctl` read-only command allowlist wrapper를 구현합니다.

작업 범위:

- `TossInvestCliReadOnlyCollector`
- command key enum
- mutation blocklist
- `--execute` 차단
- output JSON parsing
- timeout
- source metadata
- degraded status

검증:

- allowlisted command만 실행
- `order`, `auth`, `config`, `watchlist` mutation 차단
- argv에 `--execute` 포함 시 차단
- timeout은 degraded status
- mocked process runner tests

제외:

- real `tossctl auth login`
- real credentials/session handling
- live order/preview execution

## PR-09: Market Packet from TossInvest Data

목표:

- `tossctl` read-only output을 normalized candidate로 변환해 paper decision packet에 포함합니다.

작업 범위:

- parser/normalizer per selected command
- market ranking to candidate
- market signals to reason codes
- quote fields normalization
- stale policy
- source refs

검증:

- sample `tossctl` JSON fixture parse
- malformed output degraded
- stale source excluded
- generated packet remains compact

제외:

- live `tossctl` dependency in tests
- order/account/portfolio source of truth

## PR-10: MCP Read-only Virtual Portfolio Tools

목표:

- Codex가 paper trading 결과를 조회할 수 있는 MCP read-only tools를 구현합니다.

작업 범위:

- MCP server scaffold completion
- `get_virtual_portfolio`
- `get_virtual_positions`
- `get_virtual_decisions`
- `get_virtual_trades`
- `get_virtual_performance`
- masking and output contracts

검증:

- tools are read-only
- no `run_codex_exec`
- no `run_tossctl`
- no `place_order`
- sample MCP call tests or handler unit tests

제외:

- side-effect tools
- direct collector execution through MCP
- direct Codex CLI execution through MCP

## PR-11: Scheduler and Run Budget

목표:

- paper decision run을 낮은 빈도로 자동 실행할 수 있게 합니다.

작업 범위:

- scheduler abstraction
- daily run budget
- market close run config
- manual run command
- lock file or idempotency key
- failure backoff

검증:

- max runs per day enforced
- concurrent run blocked
- failed run audit logged
- disabled provider does not run

제외:

- OS-level service installer
- cloud deployment
- live trading scheduler

## PR-12: Reports and Portfolio Polish

목표:

- paper trading 결과를 운영 리포트와 포트폴리오 설명 자료로 정리합니다.

작업 범위:

- daily paper report
- decision outcome summary
- rejected virtual risk summary
- source status summary
- README demo section
- sample anonymized output

검증:

- report includes paper trading disclaimer
- no investment advice wording
- no real account data
- sample report generated from fixtures

제외:

- performance guarantee
- backtest overclaim
- live account reporting

## Later PRs

다음 작업은 위 vertical slice가 안정된 뒤 별도 계획으로 분리합니다.

- Official Toss Open API adapter design
- official token auth
- live Risk Engine implementation
- live OrderRouter
- threat model for live trading
- deployment packaging

이 later PR들은 사용자 명시 지시 없이는 시작하지 않습니다.
