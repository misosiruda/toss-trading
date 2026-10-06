# 실행과 작업 절차

이미 구현된 경로의 실행·검증·유지보수 절차를 모은다. 기능 설계는 [plans](../plans/README.md), 세부 안전 경계는 [contracts](../contracts/README.md)를 확인한다.

- [AI paper 운영](ai-paper-trading-runbook.md): CLI provider와 paper/batch 실행 조건·실패 확인
- [Historical replay](historical-replay.md): 데이터 준비, 실행 mode, 산출물과 검증 한계
- [고정 fixture paper 실험](paper-experiment.md): 입력 검증·격리 저장 library, 무결성·retry 경계와 미구현 CLI
- [Strategy bucket validation](strategy-bucket-validation-runbook.md): isolated 실험과 결과 기록
- [Test verification](test-verification.md): review/merge profile, 영향 범위와 완료 증거
- [Maintenance delegation](codex-maintenance-delegation-policy.md): 기능 PR 설계, 책임별 커밋, 리뷰와 중단 경계
- [Repository security](repository-access-security-policy.md): repository access와 public review 보안
- [Code convention](CODE_CONVENTION.md): 레이어 책임, naming, 코드·문서 변경 규칙

Universe JSON 입력 4개는 CLI/test compatibility를 위해 상위 `docs/`의 기존 경로에 남아 있다.
전체 탐색은 [문서 안내](../README.md)에서 시작한다.
