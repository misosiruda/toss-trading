## 변경 범위

- 변경 요약을 작성합니다.

## 안전 경계 확인

- [ ] live order, broker mutation, natural language order, raw `codex exec`, raw `tossctl`, `place_order` surface를 추가하지 않았습니다.
- [ ] `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only` safe default를 변경하지 않았습니다.
- [ ] secret, token, account number, order ID, execution data 원문을 source/docs/tests/PR body에 포함하지 않았습니다.
- [ ] 투자 조언, 특정 종목 추천, 수익 보장 표현을 추가하지 않았습니다.
- [ ] risk/safety 관련 변경은 fail-closed 동작을 테스트했습니다. 해당 없음이면 사유를 본문에 적었습니다.

## 검증

- [ ] `git diff --check`
- [ ] `npm run check`
- [ ] 문서 Markdown bare tilde 사용 여부 확인

실행하지 않은 항목:

- 해당 없음 또는 미실행 항목을 작성합니다.
