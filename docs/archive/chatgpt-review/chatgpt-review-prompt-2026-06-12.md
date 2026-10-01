# ChatGPT 검토 요청 프롬프트

너는 알고리즘 트레이딩 백테스트/페이퍼 트레이딩 시스템을 검토하는 시니어 엔지니어이자 퀀트 리서치 리뷰어다.

첨부파일을 기준으로 검토해라.

첨부파일:

- `historical-replay-log-summary-2026-06-12-1553-kst.json`: 핵심 지표 요약
- `historical-replay-progress-snapshot-2026-06-12-1553-kst.json`: raw progress snapshot
- `historical-replay-diagnostic-brief.md`: 현재 개선 포인트와 PR 단위 계획

중요한 안전 경계:

- 이 시스템은 실거래가 아니라 `paper_only` historical replay다.
- 실거래 주문은 없다.
- AI 판단은 paper-only virtual decision이다.
- Risk Engine이 최종 gate다.
- unofficial data source는 조회/정보 수집용이며 live trading path에는 쓰지 않는다.
- 결과를 수익률 보장이나 투자 조언으로 해석하면 안 된다.

검토 목표:

1. 이 로그만 기준으로 현재 알고리즘의 투자성을 판단하기에 충분한가?
2. 부족하다면 어떤 데이터가 더 필요한가?
3. 현재 구조에서 가장 먼저 고쳐야 할 시스템 결함은 무엇인가?
4. AI decision schema, Risk Engine, PaperOrderEngine, Portfolio timeline 중 어떤 순서로 개선해야 하는가?
5. Sell 판단이 amount 관련 reject로 반복 반려되는 문제를 어떻게 설계적으로 해결할 수 있는가?
6. 현금 reserve, exposure limit, cooldown 정책을 어떤 형태로 넣는 것이 좋은가?
7. 이 AI paper strategy가 단순 buy-and-hold보다 나은지 판단하려면 어떤 benchmark와 metric이 필요한가?
8. dashboard에는 어떤 진단 패널이 추가되어야 운영자가 빠르게 문제를 파악할 수 있는가?
9. 위 정보를 바탕으로 PR 단위 개선 계획을 우선순위로 제안해라.

답변 형식:

1. 투자성 판단 가능 여부
2. 근거
3. 데이터 한계
4. 우선 개선점
5. 추가 수집 데이터
6. PR 단위 계획

제약:

- 종목 추천이나 실제 매수/매도 조언은 하지 마라.
- 투자 조언을 하지 마라.
- 시스템 설계, 백테스트 신뢰도, 리스크 관리, 데이터 로깅 관점으로만 답해라.
- 현재 숫자만으로 성과를 과장하지 마라.
