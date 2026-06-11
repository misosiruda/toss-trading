# Portfolio Positioning

> Codex is not the trading engine. Codex is an MCP-based operations interface for inspecting, explaining, and safely controlling a deterministic trading backend.

## Positioning

이 프로젝트는 "자동매매로 수익을 내는 프로젝트"가 아니라 "금융성 도메인에서 안전한 백엔드 시스템 경계를 설계하는 프로젝트"로 소개해야 합니다.

핵심 메시지는 다음과 같습니다.

- Trading Engine은 deterministic backend입니다.
- Codex는 MCP 기반 operations interface입니다.
- Risk Engine은 주문 전 최종 gate입니다.
- 실거래는 기본 비활성화이며 mock provider first로 개발합니다.
- 모든 side effect는 approval, audit log, idempotency를 가져야 합니다.

## Technical Capabilities Demonstrated

이 프로젝트로 보여줄 수 있는 백엔드 역량:

- domain-driven component boundary 설계
- deterministic strategy and risk pipeline
- MCP tool exposure policy 설계
- read-only first operations interface
- idempotent order routing 설계
- audit logging and masking
- safe-by-default configuration
- mock provider 기반 개발 및 테스트
- fail-closed risk handling
- scheduler and worker boundary 설계
- portfolio/reporting use case를 위한 query API 설계

## What Not to Claim

다음 표현은 사용하지 않습니다.

- "수익을 보장하는 자동매매 시스템"
- "LLM이 매수/매도를 판단하는 AI 트레이더"
- "Toss Securities 공식 프로젝트"
- "실계좌 검증 완료"
- "무위험 전략"
- "리스크 없이 자동으로 매매"
- "Codex가 autonomously buy/sell stocks"

투자 성과, 수익률, 실거래 이력은 사실과 증거가 없으면 언급하지 않습니다.

## Suggested GitHub Description

```text
Safe-by-default personal trading backend architecture with a Codex MCP operations interface, deterministic strategy/risk boundaries, mock provider first workflow, and audit-focused runtime design.
```

## Suggested Resume Description

```text
Designed a personal trading backend architecture that separates deterministic market-data, screener, strategy, risk, and order-routing runtime from a Codex MCP operations interface. Documented read-only-first MCP tool policies, disabled-by-default live order tools, mock-provider-first development, risk gating, kill switch behavior, and audit/masking requirements.
```

## Suggested Korean Project Summary

```text
개인 트레이딩 백엔드에서 LLM을 실시간 매매 엔진으로 사용하지 않고, Codex를 MCP 기반 운영 인터페이스로만 사용하는 안전한 시스템 경계를 설계했습니다. Screener, StrategyEngine, RiskEngine, OrderRouter를 결정론적 백엔드 컴포넌트로 분리하고, read-only first MCP tool 정책, mock provider first 개발 흐름, kill switch, audit logging, masking 요구사항을 문서화했습니다.
```

## Interview Talking Points

- LLM을 trading loop에서 배제한 이유
- Risk Engine을 최종 gate로 둔 이유
- MCP tool을 read-only by default로 설계한 이유
- `place_order`를 기본 disabled tool로 둔 이유
- mock provider first가 금융성 프로젝트에서 중요한 이유
- Codex CLI 판단을 live trading이 아니라 paper trading으로 격리한 이유
- auditability와 reproducibility가 low-latency system에서 중요한 이유
- 포트폴리오 프로젝트에서 투자 성과 대신 백엔드 설계 역량을 강조하는 이유

## Portfolio Caveats

- 실제 Toss Securities API 연동은 official adapter design milestone로 분리해 처리합니다.
- 비공식 `tossinvest-cli` fork는 optional read-only intelligence source로만 검토하며 실거래 adapter로 사용하지 않습니다.
- Codex CLI 기반 AI 판단은 `VirtualPortfolio` 대상 paper trading에만 사용하고 실계좌 주문으로 연결하지 않습니다.
- 실계좌 정보, credential, 주문/체결 원문 데이터는 저장소에 포함하지 않습니다.
- 문서와 예시 데이터는 투자 조언이 아닙니다.
