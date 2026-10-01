# 문서 체계 정리 PR 설계

## 목적과 기능 단위

사용자가 프로젝트 목적, 실제 구현 범위, 실행 절차와 다음 작업을 구분해 찾을 수 있고,
관리자가 문서를 역할별로 갱신해도 기존 계약·실험 기록·프로그램 참조가 깨지지 않는 문서 체계를 만든다.

이 목적을 하나의 기능 PR로 계획한다. 제품 개요와 현재 상태 설명, 물리적 폴더 분류,
참조 무결성은 같은 독서·유지보수 경험을 완성하는 데 필요한 범위다.
커밋 수를 PR 생성 조건으로 사용하지 않는다. 아래 범위와 수용 기준을 충족하면 PR을 검토 대상으로 올린다.

- 기준 main: `d9818e74fdf932588ebecce5eecc2525baa6421f` (2026-10-01 원격 확인)
- 작업 branch: `docs/personal-investment-trainer-structure`
- 상태: 구현 전 설계. 최종 진행 상태와 검증 결과는 PR 설명에 기록한다.
- PR788의 source 변경과 미병합 테스트는 별도 checkout에 보존하며 이 PR에 포함하지 않는다.

## 포함 범위

1. 개인 AI 투자 트레이너의 전체 목적과 기존 paper-only 구현 지도를 짧은 진입점으로 정리
2. 단일 전략의 paper 운용·검토 MVP를 제안 상태로 문서화하고 미정 선택을 명시
3. `docs/architecture`, `contracts`, `runbooks`, `plans`, `research`, `archive`로 실제 문서 이동
4. 역할별 index와 root 독서 경로 제공, 이전 위치와 새 위치의 대응 기록
5. 확인된 API/UI/CLI 상태 설명의 정정
6. 이동과 같은 변경 단위에서 Markdown 링크, 명령 예시, rule/script의 문서 경로 갱신
7. 기존 문서의 계약·완료 기준·식별자·고정 결과 보존 및 정적/해당 tooling 검증

## 분류 기준

- `architecture/`: 제품/현재 구조/책임/운영 UI routing
- `contracts/`: runtime, AI, Risk, MCP, broker와 데이터 사용의 안전·도메인 경계
- `runbooks/`: 실행, 검증, 유지보수, 보안·코드 작업 절차
- `plans/`: 현재 또는 참조 가능한 구현·리팩토링 계획; 연구 확장 계획도 활성 계획이면 여기 유지
- `research/`: 검증 protocol·사전 등록·고정 실험 결과와 분석; 필요 시 `protocols/`, `results/`로 구분
- `archive/`: 초기 PR 계획, 과거 review 묶음, 대체 관계가 명시된 정적 dashboard 초기 계획

파일명에 `plan`이 있다는 이유로 archive에 넣지 않는다. Archive의 미완료 제안은 완료로
바꾸지 않으며 활성 계획의 해당 후속 범위를 연결한다. `docs/historical-universe*.json` 4개는
CLI와 테스트가 읽는 실행 입력이므로 기존 root 경로에 유지한다.

## 제외 범위

- production domain code, schema, artifact 의미, 실행 동작 변경
- PR788 수정/검증/병합 또는 simulation/AI 호출
- live order, broker mutation, credential·외부 계정·유료 provider 활성화
- 6,905행 포트폴리오 계약의 내용 분할·재설계: 이번에는 위치와 탐색을 정리하고 별도 후속 PR로 설계
- 연구 결과 재해석, active plan의 임의 archive, 완료 상태 자동 승격
- 사용자 승인 없는 push/PR 게시

## 책임별 작업 순서

1. 제품 개요·현재 상태·PR 설계를 작성하고 커밋
2. architecture/contracts 이동과 소비자 경로를 함께 정리한 뒤 커밋
3. runbooks/plans 이동과 규칙·실행 안내를 함께 정리한 뒤 커밋
4. 연구 protocol/result를 분류하고 연결을 갱신한 뒤 커밋
5. 역사 기록과 전체 index/이전 경로 대응을 정리하고 커밋
6. 최종 범위·내용 보존·링크·tooling 검증. 수정이 필요하면 해당 책임의 후속 커밋

책임이 바뀌기 전에 검토 가능한 상태를 커밋한다. 목록의 개수는 PR 완료 조건이나 강제 커밋 수가 아니다.

## 수용 기준

- [ ] `DOCSYS-01`: 제품 목적/현재 상태/실행/다음 계획에 각각 명확한 진입점이 있음
- [ ] `DOCSYS-02`: 문서가 실제 역할별 폴더에 있고 각 폴더의 선택 기준이 명확함
- [ ] `DOCSYS-03`: main 구현, 미병합 PR 관찰, 제안, 과거 결과가 구분됨
- [ ] `DOCSYS-04`: 기존 안전 계약, 실험 값, 단계·수용 기준 식별자와 history가 보존됨
- [ ] `DOCSYS-05`: 이동한 Markdown의 상대 링크/anchor, rule/script 경로와 예시가 정상임
- [ ] `DOCSYS-06`: MCP tool 목록 검사와 runtime JSON fixture 경로가 유지됨
- [ ] `DOCSYS-07`: PR788 source·untracked 테스트 및 production behavior가 포함되지 않음
- [ ] `DOCSYS-08`: 최종 검증 결과와 미실행 범위를 기록하고 변경 내용이 PR 설계 범위와 일치함

## 검증 계획

- 이동 전후 파일 대응과 내용 비교: 경로/링크/상태 정정 외 계약 본문이 삭제되거나 바뀌지 않았는지 확인
- 전체 tracked Markdown의 local file target과 가능한 heading anchor 검사
- repo-root 문서 경로 literal 참조, qualityGate 소비자, AGENTS/runbook 링크, fixture 경로 조사
- `git diff --check`, 실제 `quality:gate`, `npm run check:review`
- changed-test runner가 경로 소비자 변경으로 추가 검증 또는 전체 fallback을 선택하면 결과를 그대로 기록
- 명령 수행은 문서/tooling 검증만 대상. simulation, 외부 AI/데이터 호출과 credential 설정은 하지 않음
- 최종 변경 경로 목록, commit, 기준 main과 독립 검토 결과를 대조한 뒤 게시 여부를 확인

## 이전 경로와 새 경로 대응

이전 경로는 이 PR 이전의 위치다. 새 위치가 정본이며 파일명과 기존 heading을 유지한다.
이전 repository 경로는 이 표와 Git history로 추적한다. 기존 commit에 고정된 URL은 유지되지만,
옛 `main/docs/...` bookmark를 새 URL로 자동 redirect하지는 않는다. 무분별한 root stub을 남겨
두 정본을 만들지 않는다. 고정 review payload 안의 원래 경로는 provenance로 보존한다.

| 이전 경로 | 현재 경로 |
| --- | --- |
| `docs/architecture.md` | [docs/architecture/architecture.md](../../docs/architecture/architecture.md) |
| `docs/PROJECT_STRUCTURE.md` | [docs/architecture/PROJECT_STRUCTURE.md](../../docs/architecture/PROJECT_STRUCTURE.md) |
| `docs/project-overview.md` | [docs/architecture/project-overview.md](../../docs/architecture/project-overview.md) |
| `docs/dashboard-routing-policy.md` | [docs/architecture/dashboard-routing-policy.md](../../docs/architecture/dashboard-routing-policy.md) |
| `docs/portfolio-positioning.md` | [docs/architecture/portfolio-positioning.md](../../docs/architecture/portfolio-positioning.md) |
| `docs/automation.md` | [docs/contracts/automation.md](../../docs/contracts/automation.md) |
| `docs/codex-cli-paper-trading.md` | [docs/contracts/codex-cli-paper-trading.md](../../docs/contracts/codex-cli-paper-trading.md) |
| `docs/instrument-asset-taxonomy.md` | [docs/contracts/instrument-asset-taxonomy.md](../../docs/contracts/instrument-asset-taxonomy.md) |
| `docs/live-trading-threat-model.md` | [docs/contracts/live-trading-threat-model.md](../../docs/contracts/live-trading-threat-model.md) |
| `docs/llm-boundary.md` | [docs/contracts/llm-boundary.md](../../docs/contracts/llm-boundary.md) |
| `docs/market-regime-allocation.md` | [docs/contracts/market-regime-allocation.md](../../docs/contracts/market-regime-allocation.md) |
| `docs/mcp-tools.md` | [docs/contracts/mcp-tools.md](../../docs/contracts/mcp-tools.md) |
| `docs/official-token-auth-design.md` | [docs/contracts/official-token-auth-design.md](../../docs/contracts/official-token-auth-design.md) |
| `docs/official-toss-open-api-adapter-design.md` | [docs/contracts/official-toss-open-api-adapter-design.md](../../docs/contracts/official-toss-open-api-adapter-design.md) |
| `docs/read-only-intelligence-sources.md` | [docs/contracts/read-only-intelligence-sources.md](../../docs/contracts/read-only-intelligence-sources.md) |
| `docs/risk-policy.md` | [docs/contracts/risk-policy.md](../../docs/contracts/risk-policy.md) |
| `docs/trading-runtime.md` | [docs/contracts/trading-runtime.md](../../docs/contracts/trading-runtime.md) |
| `docs/CODE_CONVENTION.md` | [docs/runbooks/CODE_CONVENTION.md](../../docs/runbooks/CODE_CONVENTION.md) |
| `docs/ai-paper-trading-runbook.md` | [docs/runbooks/ai-paper-trading-runbook.md](../../docs/runbooks/ai-paper-trading-runbook.md) |
| `docs/codex-maintenance-delegation-policy.md` | [docs/runbooks/codex-maintenance-delegation-policy.md](../../docs/runbooks/codex-maintenance-delegation-policy.md) |
| `docs/historical-replay.md` | [docs/runbooks/historical-replay.md](../../docs/runbooks/historical-replay.md) |
| `docs/repository-access-security-policy.md` | [docs/runbooks/repository-access-security-policy.md](../../docs/runbooks/repository-access-security-policy.md) |
| `docs/strategy-bucket-validation-runbook.md` | [docs/runbooks/strategy-bucket-validation-runbook.md](../../docs/runbooks/strategy-bucket-validation-runbook.md) |
| `docs/test-verification.md` | [docs/runbooks/test-verification.md](../../docs/runbooks/test-verification.md) |
| `docs/REFACTORING_GUIDE.md` | [docs/plans/REFACTORING_GUIDE.md](../../docs/plans/REFACTORING_GUIDE.md) |
| `docs/ai-investment-process-refactoring-plan.md` | [docs/plans/ai-investment-process-refactoring-plan.md](../../docs/plans/ai-investment-process-refactoring-plan.md) |
| `docs/nextjs-dashboard-architecture-plan.md` | [docs/plans/nextjs-dashboard-architecture-plan.md](../../docs/plans/nextjs-dashboard-architecture-plan.md) |
| `docs/official-market-calendar-source-acquisition-plan.md` | [docs/plans/official-market-calendar-source-acquisition-plan.md](../../docs/plans/official-market-calendar-source-acquisition-plan.md) |
| `docs/quant-research-paper-simulation-plan.md` | [docs/plans/quant-research-paper-simulation-plan.md](../../docs/plans/quant-research-paper-simulation-plan.md) |
| `docs/research-hardening-milestone-plan.md` | [docs/plans/research-hardening-milestone-plan.md](../../docs/plans/research-hardening-milestone-plan.md) |
| `docs/roadmap.md` | [docs/plans/roadmap.md](../../docs/plans/roadmap.md) |
| `docs/short-term-liquidity-stress-validation-plan.md` | [docs/plans/short-term-liquidity-stress-validation-plan.md](../../docs/plans/short-term-liquidity-stress-validation-plan.md) |
| `docs/short-term-scoped-liquidity-stress-validation-plan.md` | [docs/plans/short-term-scoped-liquidity-stress-validation-plan.md](../../docs/plans/short-term-scoped-liquidity-stress-validation-plan.md) |
| `docs/strategy-portfolio-operating-model-plan.md` | [docs/plans/strategy-portfolio-operating-model-plan.md](../../docs/plans/strategy-portfolio-operating-model-plan.md) |
| `docs/trainer-mvp-roadmap.md` | [docs/plans/trainer-mvp-roadmap.md](../../docs/plans/trainer-mvp-roadmap.md) |
| `docs/validation-role-regime-evidence-expansion-preflight-plan.md` | [docs/plans/validation-role-regime-evidence-expansion-preflight-plan.md](../../docs/plans/validation-role-regime-evidence-expansion-preflight-plan.md) |
| `docs/validation-role-regime-evidence-expansion-split-provenance-plan.md` | [docs/plans/validation-role-regime-evidence-expansion-split-provenance-plan.md](../../docs/plans/validation-role-regime-evidence-expansion-split-provenance-plan.md) |
| `docs/validation-role-regime-replay-selection-plan.md` | [docs/plans/validation-role-regime-replay-selection-plan.md](../../docs/plans/validation-role-regime-replay-selection-plan.md) |
| `docs/validation-role-regime-statistical-readiness-plan.md` | [docs/plans/validation-role-regime-statistical-readiness-plan.md](../../docs/plans/validation-role-regime-statistical-readiness-plan.md) |
| `docs/validation-split-regime-feasibility-plan.md` | [docs/plans/validation-split-regime-feasibility-plan.md](../../docs/plans/validation-split-regime-feasibility-plan.md) |
| `docs/cpcv-pbo-validation-contract.md` | [docs/research/protocols/cpcv-pbo-validation-contract.md](../../docs/research/protocols/cpcv-pbo-validation-contract.md) |
| `docs/replay-calendar-fx-contract.md` | [docs/research/protocols/replay-calendar-fx-contract.md](../../docs/research/protocols/replay-calendar-fx-contract.md) |
| `docs/sharpe-statistical-validation-contract.md` | [docs/research/protocols/sharpe-statistical-validation-contract.md](../../docs/research/protocols/sharpe-statistical-validation-contract.md) |
| `docs/strategy-bucket-validation-protocol.md` | [docs/research/protocols/strategy-bucket-validation-protocol.md](../../docs/research/protocols/strategy-bucket-validation-protocol.md) |
| `docs/triple-barrier-label-contract.md` | [docs/research/protocols/triple-barrier-label-contract.md](../../docs/research/protocols/triple-barrier-label-contract.md) |
| `docs/validation-role-regime-evidence-expansion-source-preregistration.md` | [docs/research/protocols/validation-role-regime-evidence-expansion-source-preregistration.md](../../docs/research/protocols/validation-role-regime-evidence-expansion-source-preregistration.md) |
| `docs/validation-role-regime-evidence-expansion-target-policy.md` | [docs/research/protocols/validation-role-regime-evidence-expansion-target-policy.md](../../docs/research/protocols/validation-role-regime-evidence-expansion-target-policy.md) |
| `docs/historical-replay-diagnostic-brief.md` | [docs/research/results/historical-replay-diagnostic-brief.md](../../docs/research/results/historical-replay-diagnostic-brief.md) |
| `docs/short-intraday-cost-revalidation-results.md` | [docs/research/results/short-intraday-cost-revalidation-results.md](../../docs/research/results/short-intraday-cost-revalidation-results.md) |
| `docs/short-term-liquidity-stress-results.md` | [docs/research/results/short-term-liquidity-stress-results.md](../../docs/research/results/short-term-liquidity-stress-results.md) |
| `docs/short-term-scoped-liquidity-stress-results.md` | [docs/research/results/short-term-scoped-liquidity-stress-results.md](../../docs/research/results/short-term-scoped-liquidity-stress-results.md) |
| `docs/short-term-spread-impact-sensitivity-results.md` | [docs/research/results/short-term-spread-impact-sensitivity-results.md](../../docs/research/results/short-term-spread-impact-sensitivity-results.md) |
| `docs/strategy-bucket-validation-research-results.md` | [docs/research/results/strategy-bucket-validation-research-results.md](../../docs/research/results/strategy-bucket-validation-research-results.md) |
| `docs/strategy-bucket-validation-smoke-results.md` | [docs/research/results/strategy-bucket-validation-smoke-results.md](../../docs/research/results/strategy-bucket-validation-smoke-results.md) |
| `docs/strategy-preset-candidate-scope-audit.md` | [docs/research/results/strategy-preset-candidate-scope-audit.md](../../docs/research/results/strategy-preset-candidate-scope-audit.md) |
| `docs/validation-role-regime-replay-smoke-results.md` | [docs/research/results/validation-role-regime-replay-smoke-results.md](../../docs/research/results/validation-role-regime-replay-smoke-results.md) |
| `docs/validation-split-regime-feasibility-results.md` | [docs/research/results/validation-split-regime-feasibility-results.md](../../docs/research/results/validation-split-regime-feasibility-results.md) |
| `docs/quant-research-paper-simulation-review.md` | [docs/research/reviews/quant-research-paper-simulation-review.md](../../docs/research/reviews/quant-research-paper-simulation-review.md) |
| `docs/paper-simulation-dashboard-plan.md` | [docs/archive/paper-simulation-dashboard-plan.md](../../docs/archive/paper-simulation-dashboard-plan.md) |
| `docs/pr-implementation-plan.md` | [docs/archive/pr-implementation-plan.md](../../docs/archive/pr-implementation-plan.md) |
| `docs/pr-review-log.md` | [docs/archive/pr-review-log.md](../../docs/archive/pr-review-log.md) |
| `docs/chatgpt-review/README.md` | [docs/archive/chatgpt-review/README.md](../../docs/archive/chatgpt-review/README.md) |
| `docs/chatgpt-review/historical-replay-log-summary-2026-06-12-1553-kst.json` | [docs/archive/chatgpt-review/historical-replay-log-summary-2026-06-12-1553-kst.json](../../docs/archive/chatgpt-review/historical-replay-log-summary-2026-06-12-1553-kst.json) |
| `docs/chatgpt-review/chatgpt-analysis-summary-2026-06-12.md` | [docs/archive/chatgpt-review/chatgpt-analysis-summary-2026-06-12.md](../../docs/archive/chatgpt-review/chatgpt-analysis-summary-2026-06-12.md) |
| `docs/chatgpt-review/historical-replay-progress-snapshot-2026-06-12-1553-kst.json` | [docs/archive/chatgpt-review/historical-replay-progress-snapshot-2026-06-12-1553-kst.json](../../docs/archive/chatgpt-review/historical-replay-progress-snapshot-2026-06-12-1553-kst.json) |
| `docs/chatgpt-review/chatgpt-analysis-raw-2026-06-12.md` | [docs/archive/chatgpt-review/chatgpt-analysis-raw-2026-06-12.md](../../docs/archive/chatgpt-review/chatgpt-analysis-raw-2026-06-12.md) |
| `docs/chatgpt-review/chatgpt-review-prompt-2026-06-12.md` | [docs/archive/chatgpt-review/chatgpt-review-prompt-2026-06-12.md](../../docs/archive/chatgpt-review/chatgpt-review-prompt-2026-06-12.md) |
