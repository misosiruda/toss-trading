# 비용 직접 입력 backend 실행 계약 PR 범위

기준 main51b5d2a / 사용자 승인 정본 approved-options-contract-20261006.md. 구현 순서1이며 UI·benchmark 표시·coverage·canonical 저장·clone은 별도 PR이 소유한다.

포함: optional executionCosts 객체의 명시 feeBps/taxBps/slippageBps, 기존 historical replay execution-policy schema의 유한 비음수 숫자 의미 재사용, default 요청 호환, resolver→validation/create→기존 runner→metadata/cost hash 전달, negative/HTTP runner spy/합성 paper fill·실제 fixture runner provenance 검증.

비범위: high_cost preset 수치·새 비용 model·spread/impact/liquidity 정책 변경·benchmark 계산 변경·membership filtering·UI 노출·실거래·유료 AI 활성화.

완료: 세 필드 누락/음수/비유한/잘못된 타입/알 수 없는 비용 옵션을 거절하고 기본 요청의0bps·기존 정책을 보존한다. 사용자 명시 숫자를 validation/create/runner/기록에서 동일하게 확인하며 합성 buy/sell fill의 수수료·매도세·slippage 계산을 검증한다. fixture 테스트 숫자는 업무 preset이나 현실 비용 제안이 아니다. validation의 storage/provider/runner 효과0, create1회와 기존 guard·409·accepted 의미 유지. build/quality/tooling/관련 API·실제 replay 검증 후 한국어 Draft로 독립 검토에 전달한다. 최신 full은 별도 실제 결과에만 귀속한다.
