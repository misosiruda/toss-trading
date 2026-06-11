# Roadmap

> Codex is not the trading engine. Codex is an MCP-based operations interface for inspecting, explaining, and safely controlling a deterministic trading backend.

실제 구현 순서와 PR 단위는 [pr-implementation-plan.md](pr-implementation-plan.md)를 기준으로 진행합니다.

## Milestone 1: Documentation and Architecture

목표:

- README 작성
- architecture 문서 작성
- Codex CLI paper trading 문서 작성
- LLM boundary 문서 작성
- MCP tool policy 문서 작성
- risk policy 문서 작성
- automation boundary 문서 작성
- portfolio positioning 문서 작성
- `.env.example` 작성
- `.codex/config.example.toml` 작성
- `AGENTS.md` 작성

완료 기준:

- Codex가 실시간 trading engine이 아니라는 경계가 명확함
- Trading Engine, Screener, StrategyEngine, RiskEngine, OrderRouter, MCP Server, Codex 책임이 분리됨
- safe/unsafe automation 예시가 있음
- 실계좌 정보와 real credential이 없음

## Milestone 2: Mock MCP Server

목표:

- read-only MCP tools의 mock response 구현
- limited operational tools의 audit-only 또는 in-memory mock 구현
- disabled-by-default tools는 노출하지 않음
- masking helper 추가

완료 기준:

- `get_account_summary`, `get_positions`, `get_screened_candidates`, `get_latest_signals`, `get_risk_decisions`, `get_audit_events`가 mock data로 동작
- `place_order`가 enabled tools에 없음
- MCP tool contract가 docs와 일치

## Milestone 3: Mock Trading Runtime

목표:

- mock market data generator
- scheduler loop
- in-memory 또는 local persistent stores
- AuditLogger prototype

완료 기준:

- Codex 없이 runtime이 동작
- screener와 strategy가 deterministic output 생성
- audit events가 저장됨

## Milestone 4: Screener and Signal Store

목표:

- deterministic screener factors 구현
- CandidateStore 구현
- StrategyEngine signal generation 구현
- stale candidate/signal handling

완료 기준:

- 후보와 signal이 구조화된 schema로 저장됨
- LLM이 live `TradingSignal` final generator가 아님
- factor와 reason code가 audit 가능함

## Milestone 5: Risk Engine

목표:

- max order amount
- max daily loss
- max position exposure
- symbol allowlist
- market allowlist
- market hours
- duplicate order prevention
- cooldown
- open order count
- market order policy
- kill switch
- preview-before-place

완료 기준:

- risk-related logic에 테스트가 있음
- reject code가 구조화됨
- failure는 fail-closed로 처리됨
- Codex가 risk policy를 우회할 수 없음

## Milestone 6: Official Toss Open API Adapter Design

목표:

- 공식 Toss Securities Open API reference 검토
- authentication 방식 문서화
- rate limit, order endpoint, execution endpoint, account endpoint contract 확인
- adapter interface와 mock provider 차이 분석
- sandbox 또는 paper trading 지원 여부 확인

완료 기준:

- 공식 문서 기반 adapter 설계
- real credentials 저장 금지
- `TRADING_ENABLED=false` 기본 유지
- 실거래 path는 별도 명시적 승인 없이는 활성화하지 않음

## Milestone 7: Optional Read-only Intelligence Source

목표:

- `tossinvest-cli` fork를 non-production research reference로 검토
- official API에 없는 market ranking, market signals, screener, quote flows 등 read-only 정보 표면 정리
- `TossInvestCliReadOnlyCollector` adapter contract 설계
- command allowlist와 mutation blocklist 정의
- `ExternalMarketSignalStore` 또는 `MarketSnapshotStore` enrichment schema 정의
- provenance, stale policy, masking, audit event 설계

완료 기준:

- `tossinvest-cli`는 source of truth가 아니라 optional read-only intelligence source로 문서화됨
- `order`, `auth`, `config`, watchlist mutation, `--execute`가 wrapper 레벨에서 차단됨
- Codex MCP tool에 raw `tossctl` 실행 tool이 없음
- 수집 record가 `source=tossinvest_cli`, `official=false`, `collected_at`, `stale_after`를 포함함
- source failure가 trading path를 열거나 risk policy를 완화하지 않음

## Milestone 8: Codex CLI Paper Trading Decision Provider

목표:

- `MarketPacketBuilder` 설계
- `virtual_decision` JSON Schema 정의
- `CodexCliDecisionProvider` wrapper 설계
- `codex exec --sandbox read-only` 기반 dry-run 절차 정의
- `VirtualRiskEngine` 설계
- `PaperOrderEngine`, `VirtualPortfolio`, `VirtualLedger` contract 정의
- usage budget, timeout, failure policy 문서화

완료 기준:

- Codex CLI는 `AI_DECISION_MODE=paper_only`에서만 호출됨
- Codex 출력은 schema validation을 통과해야만 paper order로 변환됨
- Codex 출력이 live `TradingSignal` 또는 live `OrderIntent`로 승격되지 않음
- `run_codex_exec` 같은 raw execution MCP tool이 없음
- Codex 실패, usage limit, timeout, invalid JSON이 모두 no-trade/no-paper-order로 처리됨
- paper trading report가 투자 조언이나 수익 보장으로 읽히지 않음

자세한 설계는 [codex-cli-paper-trading.md](codex-cli-paper-trading.md)를 참고합니다.

## Milestone 9: Portfolio Polish

목표:

- architecture diagram 정리
- README portfolio section 개선
- sample reports 추가
- test coverage summary 추가
- threat model 문서 추가
- demo script 작성

완료 기준:

- 투자 성과가 아니라 backend engineering quality를 보여줌
- mock demo만으로 프로젝트를 설명 가능
- financial advice로 오해될 표현이 없음
