# 실행·안전 계약

현재 구현과 후속 개발이 지켜야 할 책임·권한·실패 경계를 모은다. 계약의 존재는 해당 기능의 실행 또는 외부 source 검증 완료를 의미하지 않는다.

## AI와 운영 인터페이스

- [LLM boundary](llm-boundary.md)
- [MCP tool 목록](mcp-tools.md)
- [Codex CLI paper provider](codex-cli-paper-trading.md)
- [Automation boundary](automation.md)

## Backend와 데이터

- [Trading runtime](trading-runtime.md)
- [Risk policy](risk-policy.md)
- [Read-only intelligence sources](read-only-intelligence-sources.md)
- [Instrument asset taxonomy](instrument-asset-taxonomy.md)
- [Market regime allocation](market-regime-allocation.md)

## 공식 broker 경계

- [Official Toss API adapter](official-toss-open-api-adapter-design.md)
- [Token authentication](official-token-auth-design.md)
- [Live trading threat model](live-trading-threat-model.md): 미래 위험·승인 경계이며 live enablement 아님

연구 검증 protocol과 활성 포트폴리오 계획은 [전체 문서 지도](../README.md)에서 별도로 찾는다.

- 전략 포트폴리오 상세: [policy/lifecycle](strategy-portfolio/policy-lifecycle.md), [mandate/state](strategy-portfolio/mandate-state.md), [selection/sizing/reservation](strategy-portfolio/selection-sizing-reservation.md), [rebalance/Risk/fill](strategy-portfolio/rebalance-risk-fill.md)
