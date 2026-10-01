# 프로젝트 개요: 개인 AI 투자 트레이너

## 문서 상태

- 제품 방향 정리: 2026-10-01
- 구현 기준: remote-verified `main`, `d9818e7`
- 별도 검토: 미병합 PR788 branch `feat/current-opening-budget-sessions`, `dd132a3`; 이 문서 branch에는 해당 코드 변경을 포함하지 않음
- 이 문서는 현재 코드와 제품 목표를 구분한다. 실행·테스트·배포 성공을 새로 확인한 보고서는 아니다.
- 다음 구현 순서는 [Trainer MVP 제안](trainer-mvp-roadmap.md)에서 검토한다.
- 상세 안전 기준과 계약은 [AGENTS.md](../AGENTS.md) 및 [문서 지도](README.md)의 원문을 유지한다.

## 제품 목적

현재 정리한 제품 방향은 **개인 AI 투자 트레이너**다. 개인이 AI 전략과 포트폴리오를
설정하고 paper-only로 운용·평가하며 판단과 전략을 개선할 수 있게 한다.
포트폴리오·리스크·증거·replay 인프라는 이 흐름의 기반이다.
결과를 설명하고 사용자의 학습을 돕는 코칭 경험은 그 위에 제안하는 사용자 흐름 중 하나다.

제품이 궁극적으로 답하려는 질문은 다음과 같다.

- 어떤 가설과 정보로 판단했으며, 당시 알 수 없었던 정보가 섞이지 않았는가?
- 무엇을 편입하거나 관망하려 했고, deterministic sizing/Risk가 무엇을 허용·거절했는가?
- 비용·유동성·현금·노출 한도 때문에 제안과 모의 결과가 어떻게 달라졌는가?
- 같은 조건의 단순 기준선과 비교할 때 무엇을 배웠으며 무엇은 아직 판단할 수 없는가?
- 다음 실험에서 하나만 바꾼다면 무엇을 검증해야 하는가?

이 질문들을 일관되게 다루는 제품 흐름은 아직 연결 중이다. 대화·학습 UX의 구체적인 형태도
미정이다. 기존 저장소 계약에 따라 특정 종목 권유, 수익 보장, 실제 계좌 주문은 이번 범위에 포함하지 않는다.

## 이미 있는 시스템과 목표 흐름

현재 실행 가능한 코드 기반은 다음 paper pipeline이다.

`MarketPacket → VirtualDecision → 검증/정규화 → deterministic Risk/sizing → PaperOrderEngine → 가상 잔고·감사·보고서`

CLI의 일반 paper run, 저장된 packet 기반 run, historical/batch replay와 운영 화면이 존재한다.
안전 기본값은 `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`,
`AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=false`다. 일반 `paper:run-once`는
Codex provider를 선택하고 환경 설정의 enabled 값을 읽으며, `--dry-run`만 static provider를
선택한다. 별도 workflow의 명시적 provider 설정과 환경을 실제 실행 전에 확인해야 한다.

이를 활용한 전체 제품 방향은 `전략·포트폴리오 설정 → paper 운용 → 근거와 결과 평가 → 개선`이다.
첫 MVP의 한 가지 사용자 흐름으로 다음 실험·검토 경험을 제안한다.

`학습 질문/가설 → 고정된 전략·입력·기준선 → paper 실험 → 결정/Risk/결과 근거 검토 → 다음 학습 과제`

앞의 pipeline은 구현 기반이고 뒤의 실험·검토 경험은 구현 순서를 정하기 위한 제안이다.

## 전체 구현 지도

| 영역 | 코드에서 확인한 기반 | 남은 경계와 해석 |
| --- | --- | --- |
| 데이터·packet | mock 및 저장 market packet, read-only TossInvest 수집, historical ingestion와 coverage | 비공식 source를 broker/account source of truth나 live 권한으로 승격하지 않음 |
| AI proposal | `CodexCliDecisionProvider`, prompt/schema, timeout·실행 budget, semantic validation | 기본 disabled. provider 결과는 paper-only 제안이며 최종 수량·위험 승인이 아님 |
| Paper execution | 공통 decision pipeline, `VirtualRiskEngine`, `PaperOrderEngine`, revision/prepared application 및 로그 결속 | 기존 paper 경로와 새 전략 포트폴리오 전체 원자 연결을 구분해야 함 |
| Historical research | 단일/batch replay, manifest/hash, split/embargo, 비용·유동성, benchmark, 통계/label 모듈 | 모듈 존재는 충분한 표본·공식 calendar coverage·전략 유효성의 증거가 아님 |
| 전략 포트폴리오 | runtime policy/activation, mandate/state, gap/sizing, 후보 evidence/scoring, 예약 lifecycle, current snapshot/budget 원본 결속 | shared allocator부터 mandate·Risk·fill·회계·multi-cadence까지 전체 운용 연결은 미완성 |
| Operations API/UI | 조회 ViewModel, Next.js 기본 UI, 제한된 paper simulation/policy/test `POST` | API 전체가 read-only인 것은 아님. strategy-test create는 queued 기록이며 runner 시작과 다름 |
| MCP | 가상 포트폴리오와 운영 artifact를 읽는 enabled tool | live order·raw command 실행 surface 없음 |
| 공식 Toss 경계 | token/auth, read-only adapter contract, calendar 전용 transport/coordinator·preflight, 독립 live Risk, synthetic router dry-run | 일반 account/order network 경로와 live gateway는 연결되지 않음. 실제 credential 검증은 별도 |
| 코칭 경험 | 검토에 사용할 decision/risk/audit/report 자료가 있음 | 학습 질문·회고·다음 실험을 연결한 Trainer 화면/계약은 제안 단계 |

주요 코드 근거:

- [paperDecisionPipeline](../src/workflows/paperDecisionPipeline.ts), [paper run CLI](../src/cli/paperRunOnce.ts), [provider](../src/ai/codexCliDecisionProvider.ts)
- [historical workflow](../src/workflows/historicalReplayWorkflow.ts), [batch workflow](../src/workflows/historicalBatchReplayWorkflow.ts)
- [current portfolio snapshot](../src/portfolio/currentPortfolioSizingSnapshotFiles.ts), [capacity document](../src/portfolio/bucketOpeningCapacityStateFiles.ts), [bucket valuation workflow](../src/workflows/bucketValuationRunOnce.ts)
- [API surface](../src/api/localOperationsSurface.ts), [paper simulation execution](../src/api/paperSimulationRuns.ts), [ViewModels](../src/api/dashboardViewModels.ts)
- [MCP tools](../src/mcp/virtualPortfolioTools.ts), [dashboard 실행 안내](../apps/dashboard/README.md)
- [공식 adapter 구현 범위](official-toss-open-api-adapter-design.md), [statistical readiness의 한계](validation-role-regime-statistical-readiness-plan.md)

## 현재 포트폴리오 작업이 제품에서 맡는 역할

장기 운용 모델은 종목부터 고르는 구조에서 정책이 자금의 역할을 먼저 정하는 구조로 전환한다.
`long_term`, `swing`, `short_term`, `intraday`, `hedge`와 현금의 목표를 세우고 부족한 역할에만
탐색·편입 예산을 사용한다. 이것은 AI 전략의 가상 운용과 판단·위험 검토를 연결하는 기반이다.

최근 Git 이력의 주요 묶음은 다음과 같다.

- #734~739: 버킷 보유 한도, 예약 차감 현금, 공용 capacity 상태와 projection CAS
- #740~745: 실제 paper 잔고의 동시 갱신·revision·prepared execution·로그 완료 증거
- #746~778: 실제 잔고를 정책·가격/FX·pending plan·Risk/fill·mandate·예약 원본에 연결
- #779/#782/#783/#785: 발행 직후 snapshot 이력과 예약 writer session의 잠금·수명 경계
- 진행 중인 PR788 branch: current publication callback에 수동/selector session을 전달하는 composition
- #784/#786/#787: credential-free Fundamental evidence envelope·append-only 저장·replay 검증

PR788의 변경은 내부 연결 단계이며, chronology/lifetime 검토가 남아 있다. 이를 전체 운용
완성으로 해석하지 않는다. Fundamental evidence도 실제 공식 재무 데이터 취득이나 long-term
quality 판정을 제공하지 않는다.

[전략 포트폴리오 계획](strategy-portfolio-operating-model-plan.md)의 최종 수용 기준 12개는
관찰 시점에 전부 미체크다. 앞부분의 초기 기준선과 뒤쪽의 최신 구현 기록을 구분해야 한다.
현재 Trainer MVP가 이 모든 확장을 먼저 완료해야 하는지는 별도 제품 범위 결정이다.

## 연구 결과를 해석하는 기준

기존 Q1~Q9 계획은 당시 paper research 기반 범위를 완료로 기록한다. 이후 RH 및
role/regime/evidence expansion은 데이터 정합성과 검증 신뢰도를 강화하는 별도 작업이다.
각 문서의 완료는 그 문서가 정의한 범위에 한정한다.

- 재현 가능한 코드·hash와 재현 가능한 모델 응답은 다르다. 외부 AI의 응답을 고정 seed만으로 보장하지 않는다.
- fixture 결과와 실제 source evidence를 분리한다.
- missing/stale evidence, 부족한 표본, 중복·겹치는 window, 비용 가정은 보고서에 남긴다.
- official broker observed calendar와 KRX/NYSE official exchange evidence를 혼합하지 않는다.
- 외부 source의 과거 coverage나 신뢰는 envelope/hash가 있다는 이유로 승격하지 않는다.
- 좋은 결과가 나왔다는 이유로 policy 활성화, 통계적 유의성 또는 투자 성과를 주장하지 않는다.

## AI 역할과 비용 방향

현재 선호는 별도 AI API 비용을 추가하지 않고 이미 사용하는 CLI 기반 provider를 우선 활용하는 것이다.
다만 구독의 인증·사용 한도·환경 가용성과 실제 실행 허용 여부는 별도로 확인해야 한다.
구독이 무제한 추론이나 모든 환경의 무료 API 사용을 보장한다고 가정하지 않는다.

| 구성요소 | 역할 | 현재 결정 |
| --- | --- | --- |
| Codex CLI provider | 근거에 연결된 구조화 paper proposal 생성 | 기존 구현을 우선 평가. 기본 disabled와 budget/failure gate 유지 |
| deterministic backend | 계산, sizing, Risk, 가상 체결, 기록·재생 | 최종 수치·안전 권한을 계속 소유 |
| Jev 같은 구조화 점수 모델 | 추후 별도 수치·확률 평가 후보 | 채택·접근 방식·도메인 품질·비용 미정. MVP의 필수 의존성으로 두지 않음 |
| dot 대화 | 사용자의 결과 검토와 학습 설명을 돕는 대화 경험 | 일반 호출형·무료 무제한 inference API가 존재한다고 가정하지 않음 |

Jev 검토의 참고점은 [TypeSafe 공식 소개](https://typesafe.ai/blog/introducing-system-one-models-and-jev)다.
후보 평가 시 실제 input/output contract, evidence cutoff, calibration, 실패 동작, 비용과
사용 조건을 별도로 확인한다. 점수 모델을 쓰더라도 sizing/Risk를 대신하지 않는다.
dot의 기능·사용 한도는 [공식 안내](https://learn.chatgpt.com/docs/dots)를 확인하며,
backend 설계를 미확인 dot runtime API에 의존시키지 않는다.

## 다음 결정

우선 제품의 최소 운용·검토 흐름과 기존 구현의 재사용 지점을 문서로 합의한다.
[Trainer MVP 제안](trainer-mvp-roadmap.md)은 단일 전략으로 첫 end-to-end 경험을 닫는
방안을 제안하지만 전략·시장·기간·세부 UI 또는 Jev 채택이 승인된 상태는 아니다.

실행 절차는 기존 runbook에 두고 이 문서에 복제하지 않는다. 상세 개발을 시작할 때는
최신 branch/PR, 해당 contract와 실제 검증 증거를 다시 확인한다.
