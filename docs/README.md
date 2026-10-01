# 문서 안내와 정리 계획

## 먼저 읽을 문서

| 알고 싶은 것 | 시작점 | 다음 문서 |
| --- | --- | --- |
| 무엇을 만들고 왜 만드는가 | [프로젝트 개요](architecture/project-overview.md) | [Trainer MVP 제안](plans/trainer-mvp-roadmap.md) |
| 지금 무엇이 구현되어 있는가 | [프로젝트 개요의 구현 지도](architecture/project-overview.md) | [코드 구조](architecture/PROJECT_STRUCTURE.md), 실제 source |
| 어떻게 실행하고 확인하는가 | [AI paper 운영 절차](runbooks/ai-paper-trading-runbook.md) | [historical replay](runbooks/historical-replay.md), [dashboard 실행](../apps/dashboard/README.md) |
| 다음에 무엇을 만들 것인가 | [Trainer MVP 제안](plans/trainer-mvp-roadmap.md) | 해당 단계의 기존 domain contract |
| 변경할 때 지켜야 할 기준은 무엇인가 | [AGENTS.md](../AGENTS.md) | [검증 절차](runbooks/test-verification.md), [코드 컨벤션](runbooks/CODE_CONVENTION.md) |

문서 감사 기준은 2026-10-01, 원격과 일치함을 확인한 `main`의 `d9818e7`이다.
별도로 미병합 PR788의 `dd132a3`를 검토했으며 해당 변경은 이 문서 branch의 코드에 포함하지 않는다.
이는 코드 관찰 기준이며 배포 상태나 새 테스트 통과 증거가 아니다.
이번 정리는 문서 진입점과 상태 설명을 보완하고 실제 역할별 폴더로 이동했다.
[기능 PR 설계](plans/documentation-system-refactor-plan.md)의 범위와 수용 기준을 따른다.

## 문서별 책임과 상태 읽는 법

- `project-overview.md`: 현재 제품 방향과 구현 지도를 요약하는 진입점. 상세 계약을 복제하지 않는다.
- `trainer-mvp-roadmap.md`: 새 제품 방향에 맞춘 단계 제안. 미정 선택과 완료 증거를 구분한다.
- `PROJECT_STRUCTURE.md`: 실제 코드 위치와 수정 경계. 기능 완료 판정은 해당 구현·검증 증거와 함께 읽는다.
- domain contract: schema, invariant, source authority, 실패·복구와 compatibility의 상세 기준.
- runbook: 실행 조건, 명령, 산출물, 실패 시 확인 순서.
- plan: 목표와 구현 분해. 제목에 `plan`이 있어도 현재 구현 기록이 섞일 수 있다.
- result/review: 명시된 시점·입력·설정에서 얻은 관찰. 최신 코드나 다른 데이터의 검증 결과로 재사용하지 않는다.

요약 문서의 상태는 다음 의미로 사용한다.

| 상태 | 의미 |
| --- | --- |
| 구현 확인 | 해당 코드 경로가 존재함. 이번 감사에서 실행 성공을 재검증했다는 뜻은 아님 |
| 부분 연결 | 계약·저장소·일부 workflow는 있지만 최종 사용자 흐름의 연결 또는 검증이 남음 |
| 제안 | 구현 순서나 제품 선택 초안. 사용자 승인 또는 구현 완료로 해석하지 않음 |
| 과거 범위 기록 | 기존 PR/실험의 범위와 판단을 보존함. 현재 전체 상태와 구분 |
| 외부 검증 별도 | 실제 credential, source coverage, 계정·비용·라이선스 검토 등이 필요한 경계 |

안전 기준은 [AGENTS.md](../AGENTS.md)와 해당 domain contract를 유지한다. 요약과 코드가
다르면 차이를 명시하고 원문을 확인한다. 오래된 계획의 한 문장이나 구현 존재만으로
새 실행 권한, source trust 또는 완료 상태를 추정하지 않는다.

## 현재 문서 지도

### 제품·아키텍처·개발

- [프로젝트 개요](architecture/project-overview.md), [Trainer MVP 제안](plans/trainer-mvp-roadmap.md)
- [Architecture](architecture/architecture.md): 장기 책임 분리와 목표 설계
- [Project Structure](architecture/PROJECT_STRUCTURE.md): 현재 코드 위치
- [Code Convention](runbooks/CODE_CONVENTION.md), [Refactoring Guide](plans/REFACTORING_GUIDE.md)
- [기존 Roadmap](plans/roadmap.md), [PR Implementation Plan](archive/pr-implementation-plan.md), [PR Review Log](archive/pr-review-log.md)
- [AI Process Refactoring Plan](plans/ai-investment-process-refactoring-plan.md)
- [Portfolio Positioning](architecture/portfolio-positioning.md): 기존 backend engineering 설명

### 안전·실행·포트폴리오 계약

- [LLM boundary](contracts/llm-boundary.md), [MCP tools](contracts/mcp-tools.md), [risk policy](contracts/risk-policy.md)
- [trading runtime](contracts/trading-runtime.md), [automation boundary](contracts/automation.md)
- [Codex CLI paper provider](contracts/codex-cli-paper-trading.md), [read-only intelligence](contracts/read-only-intelligence-sources.md)
- [전략 포트폴리오 운용 모델](plans/strategy-portfolio-operating-model-plan.md)
- [market regime allocation](contracts/market-regime-allocation.md), [asset taxonomy](contracts/instrument-asset-taxonomy.md)
- [공식 API adapter](contracts/official-toss-open-api-adapter-design.md), [token auth](contracts/official-token-auth-design.md)
- [live threat model](contracts/live-trading-threat-model.md): 미래 live 경계의 설계이며 live 구현 승인이 아님

### 운영·UI·검증 절차

- [AI paper runbook](runbooks/ai-paper-trading-runbook.md), [historical replay](runbooks/historical-replay.md)
- [strategy bucket validation runbook](runbooks/strategy-bucket-validation-runbook.md)
- [검증 명령과 병합 절차](runbooks/test-verification.md), [maintenance 위임 범위](runbooks/codex-maintenance-delegation-policy.md)
- [repository access/security](runbooks/repository-access-security-policy.md), [root security policy](../SECURITY.md)
- [Next.js dashboard](plans/nextjs-dashboard-architecture-plan.md), [dashboard routing](architecture/dashboard-routing-policy.md)
- [정적 dashboard 초기 계획](archive/paper-simulation-dashboard-plan.md): 과거 제품화 범위와 현행 상태를 분리해 읽음

### 연구 계약·확장 계획

- [Quant Research Plan](plans/quant-research-paper-simulation-plan.md), [Review](research/reviews/quant-research-paper-simulation-review.md)
- [Research Hardening](plans/research-hardening-milestone-plan.md), [bucket validation protocol](research/protocols/strategy-bucket-validation-protocol.md)
- [calendar/FX contract](research/protocols/replay-calendar-fx-contract.md), [official calendar acquisition](plans/official-market-calendar-source-acquisition-plan.md)
- [Sharpe validation](research/protocols/sharpe-statistical-validation-contract.md), [CPCV/PBO](research/protocols/cpcv-pbo-validation-contract.md), [triple barrier](research/protocols/triple-barrier-label-contract.md)
- [split/regime feasibility](plans/validation-split-regime-feasibility-plan.md), [role/regime replay selection](plans/validation-role-regime-replay-selection-plan.md), [statistical readiness](plans/validation-role-regime-statistical-readiness-plan.md)
- Evidence expansion: [source preregistration](research/protocols/validation-role-regime-evidence-expansion-source-preregistration.md), [split provenance](plans/validation-role-regime-evidence-expansion-split-provenance-plan.md), [target policy](research/protocols/validation-role-regime-evidence-expansion-target-policy.md), [preflight](plans/validation-role-regime-evidence-expansion-preflight-plan.md)
- Liquidity stress: [일반 계획](plans/short-term-liquidity-stress-validation-plan.md), [범위 제한 계획](plans/short-term-scoped-liquidity-stress-validation-plan.md)

### 고정 실험 결과·참고 자료

- `*-results.md`, [candidate scope audit](research/results/strategy-preset-candidate-scope-audit.md), [replay diagnostic brief](research/results/historical-replay-diagnostic-brief.md)는 해당 실험의 입력·제약과 함께 보존한다.
- [chatgpt-review](archive/chatgpt-review/README.md)는 과거 외부 검토용 묶음이다. 원문·요약·진행 snapshot을 현재 정본으로 승격하지 않는다.
- `historical-universe*.json`은 실행·테스트 입력으로도 쓰인다. 단순 문서 첨부나 archive 대상으로 취급하지 않는다.

## 왜 정리가 필요한가

변경 전 감사 범위는 `docs/` 전체 69개 파일·47,290행이며, 그중 Markdown은 63개·36,669행이다.
최상위 Markdown만 세면 59개·35,598행이다. 큰 JSON snapshot을 포함한 수치와 문서 본문 수치를 구분한다.

주요 문제는 파일 수보다 역할과 상태의 혼합이다.

1. 제품 목적을 파악하려면 초기 backend 소개, 여러 roadmap, 최신 portfolio 계획을 함께 해석해야 한다.
2. 같은 주제가 roadmap → PR plan → refactoring guide → domain plan에 반복되며 일부 상태 설명이 다르다.
3. 6,905행의 포트폴리오 운영 계획에 목표, 계약, 저장·복구 규칙, PR별 구현 이력, 테스트와 최종 수용 기준이 함께 있다.
4. API 전체가 `GET`/`HEAD` 전용이라는 과거 설명과 현재 guarded paper-only `POST`가 충돌한다.
5. Next.js를 skeleton으로 설명하는 과거 문장과 현재 운영 UI가 공존한다.

이번 변경은 진입점을 추가하고 역할별 폴더링·참조 갱신·확인된 오래된 설명 정정을 수행한다. 기존 domain contract의
제약을 축약해 버리거나 수백 개의 구현 항목을 완료로 다시 분류하지 않는다.

## 문서 분류와 이동 원칙

아래 역할별 분류가 현재 구조다. 각 이동은 들어오는 링크와 프로그램 소비자 경로를 함께 갱신했다.
상세 [이전→새 경로 대응](plans/documentation-system-refactor-plan.md#이전-경로와-새-경로-대응)은 기능 PR 설계에 보존한다.
기존 commit에 고정된 링크는 유지된다. 옛 main 경로 bookmark의 자동 redirect는 제공하지 않으며
새 정본 위치는 이 대응표로 찾는다. 고정 review payload의 원래 경로는 당시 provenance로 보존한다.

| 분류 | 책임 | 분류 대상 |
| --- | --- | --- |
| [architecture/](architecture/README.md) | 제품·현재 구조·책임·결정 | 프로젝트 개요, architecture, 구조 지도 |
| [contracts/](contracts/README.md) | 실행·안전·권한·호환성 | runtime, Risk, MCP, AI, broker 계약 |
| [runbooks/](runbooks/README.md) | 실행·운영·복구·검증 | paper, replay, test verification |
| [plans/](plans/README.md) | 구현 목표·단계·미완료 조건 | Trainer MVP, portfolio, UI와 연구 확장 계획 |
| [research/](research/README.md) | 사전 등록·검증 protocol·고정 결과 | protocols/, results/, reviews/ |
| [archive/](archive/README.md) | 과거 계획·review | 초기 PR 기록, 정적 dashboard 초기 계획, 고정 review 묶음 |

### 이번 PR에서 정리한 범위

- 세 개의 짧은 문서로 제품 개요, 독서 경로, 다음 단계 제안을 분리한다.
- 기존 파일명과 계약·실험·완료 기준을 보존한다.
- stale 문장을 확인된 코드에 맞추되 새 mutation이나 provider 채택을 승인하지 않는다.

### 다음 별도 기능 PR: 큰 계획의 내용 분리

포트폴리오 운영 계획은 분리하는 편이 좋다. 다만 원문을 새 문서 여러 개에 복사하여
동시에 유지하지 않는다. 각 절의 정본을 하나만 정한 뒤 순차적으로 옮긴다.

- 제품 목표와 운용 순서: 기존 1~5절을 짧은 상위 설명으로 정리
- 계약: 기존 6~10절의 policy/mandate/state, selection/sizing/reservation, rebalance/risk/fill로 책임별 분할
- 구현 상태와 남은 작업: 13절의 현재 상태를 계약과 분리하고 실제 코드 근거를 연결
- 구현 이력: 이미 완료된 작은 PR의 상세 경위를 별도 역사 기록으로 보존
- 검증·호환성·최종 수용 기준: 기존 14~16절을 추적 가능한 체크리스트로 보존

기존 `PR 1`~`PR 8`은 문서 내부 구현 단계명이며 GitHub PR 번호와 다르다.
`PR-xx`, `Qx`, `RHx`, `Nx`, `Phase xx` 같은 기존 식별자는 재번호를 부여하지 않는다.
기존 최종 수용 기준 12개에는 고정 ID가 없으므로, 분할 시 원문 순서에 따라
`SPOM-AC-01`~`SPOM-AC-12`를 부여하는 대응표를 먼저 만든다. 대응표는 원문 문장,
기존 절/항목 순서, 기준 commit, 새 위치를 보존하고 완료 상태를 바꾸지 않아야 한다.

원래 파일은 개요·목차·이전 위치 안내를 남기는 안정적인 진입점으로 유지한다.
기존 heading/anchor도 가능한 한 보존하고, 바뀌는 anchor는 이전→이후 매핑으로 검토한다.
분할 자체는 이번 변경 범위가 아니다.

### 참조를 보존하는 소규모 이동

다음 문서는 프로그램 또는 작업 규칙이 직접 참조하므로 소비자도 같은 변경에서 갱신했다.
Universe JSON은 실행 입력이므로 이번 PR에서 위치를 유지한다.

- `docs/contracts/mcp-tools.md`, `docs/contracts/llm-boundary.md`: `scripts/qualityGate.mjs`가 파일과 backtick tool 목록을 검증
- `docs/historical-universe*.json`: CLI 기본값과 test fixture가 참조
- `docs/runbooks/codex-maintenance-delegation-policy.md`: `AGENTS.md`가 참조
- `docs/runbooks/test-verification.md`: 유지보수 절차가 참조

향후 이동할 때도 inbound/outbound 링크, heading anchor, README/runbook 명령 예시,
스크립트·테스트의 literal path를 함께 조사한다. 한 책임씩 이동하고 원본→대체 문서 관계를
남긴다. 실행 fixture의 이동은 문서 전용 변경과 분리한다. 정적 링크 검사에 더해 경로를
소비하는 검증을 통과한 뒤 이동 완료로 판단한다.

### 정리 완료 판단

- 처음 읽는 사람이 제품 목적, 현재 구현, 실행 절차, 다음 제안에 각각 한 진입점으로 도달함
- 같은 규칙의 정본이 두 곳에 생기지 않음
- 기존 계약·수용 기준·PR 식별자·고정 실험 결과가 추적 가능함
- broken link와 executable path 참조가 없음
- 문서 이동으로 safety boundary나 기능 완료 판정이 바뀌지 않음
