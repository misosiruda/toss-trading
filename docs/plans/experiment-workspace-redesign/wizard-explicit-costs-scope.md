# Wizard 직접 비용 입력 범위

기준: main5d468b6a / PR812의 executionCosts 계약. 승인된 기능별 계획 2단계.

- 기존 wizard 2단계에 feeBps/taxBps/slippageBps 직접 입력, 소수와 명시0 보존. 빈 값·음수·비유한 값은 제출 불가. 기존0 기본값 이외 preset·상한을 만들지 않는다.
- 요청/실효 비용 일치를 확인하고 확인 화면에 두 값을 표시한다. 비용 변경은 기존 검증 receipt를 무효화한다.
- 기존 raw session draft는 비용 필드가 전부 없을 때 기존0 기본값으로 복원한다. 부분 비용 그룹은 복원하지 않는다. token/receipt/accepted barrier와 create1회·최신 navigation 경계는 유지한다.
- backend runner·benchmark 계산/표시 선택·coverage·canonical 저장·clone은 범위 밖이다.
- 완료: serializer/migration/응답 binding unit, lint/type/실제 변경 소스 production build, 합성 fixture production 3viewport/axe/비용 수정/정확 payload/create1회/accepted ID/Back/reload. timeout/assertion 변경 없음.
- PR812 backend 동일 입력의 독립 full4503 및 비용 실행 증거를 재사용한다. frontend 변경 영향 검증은 새 후보에서 실행한다.