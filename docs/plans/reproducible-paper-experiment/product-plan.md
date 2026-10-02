# 재현 가능한 단일 paper 실험 기획

## 상태와 읽는 순서

- 기준일: 2026-10-02, 코드 기준 `bc1423bd992171cf86b5c5d288e9c1c915cc2333` (`origin/main` 확인)
- 상태: 구현 전 기획·설계. 이 문서 PR의 검수·병합 뒤 아래 기능 PR을 순서대로 시작한다.
- 사용자 요청 순서: 기획 → 기술 설계 → 기능별 PR 작업 문서 → 문서 PR 게시·검수·병합 → 구현
- 정본: 이 문서는 목적·범위, [기술 설계](technical-design.md)는 계약·실패 경계,
  [PR 작업 계획](pr-work-plan.md)은 구현 단위·완료 조건·검증을 소유한다.
- 상위 방향: [Trainer MVP](../trainer-mvp-roadmap.md). 기존 안전·운용 계약과
  `TR-MVP-01`~`TR-MVP-08`, `SPOM-AC-01`~`SPOM-AC-12`의 미완료 상태를 바꾸지 않는다.

## 먼저 해결할 문제

실험 입력을 고정하고 같은 backend를 다시 실행하여, 무엇을 사용했고 왜 행동하거나
거절·관망했는지 결과에서 되짚는 한 경로가 필요하다. 높은 수익률, 전략 순위 또는 실제 시장
적합성을 입증하는 작업이 아니다. 첫 결과 검토 수단은 파일 기반 한국어 보고서와 CLI다.
새 dashboard나 AI 대화 서버는 이 흐름의 선행 조건이 아니다.

첫 학습 질문은 다음으로 고정한다.

> 같은 synthetic fixture, 시뮬레이션 시각, 초기 자금, policy와 비용을 주었을 때
> decision → Risk → paper fill/no-trade → 결과 근거가 반복 가능하고 누락 없이 설명되는가?

실제 전략·시장 선택이 없어도 이 engineering 질문은 검증할 수 있다. `KR` 등의 schema 값과
가상 symbol은 fixture 형식을 맞추는 값이며 실제 시장·종목 채택이나 투자 추천이 아니다.
실제 전략의 경제적 가설, 종목군·기간, 실제 source 채택과 AI 비교는 다음 별도 범위다.

## 현재 기반과 연결할 빈틈

| 현재 확인한 기반 | 이번 작업에서 추가할 연결 |
| --- | --- |
| `runHistoricalReplayWorkflow`와 deterministic fixture provider, packet/Risk/fill/report가 있음 | 고정 입력을 검증하고 이 workflow에 전달하는 얇은 adapter |
| `ReplayResearchManifest`의 config/data/universe/coverage/prompt/schema/risk/cost hash가 있음 | hash에 대응하는 실제 정규화 입력·source를 보존하고 결과와 대조 |
| `paperSimulationRuns`는 일반 paper config를 batch workflow로 실행함 | 이 API의 표시 필드를 그대로 실행 계약으로 오인하지 않고 직접 기존 single workflow 사용 |
| `strategyBucketTestRuns`는 queued record와 audit만 저장함 | 이번에는 연결하지 않음. configHash/policyHash/sourceDataDir만으로 full config 복원 불가 |
| 기존 report에 비용·benchmark·제약이 있음 | 근거 링크와 한계를 묶은 읽기 전용 검토 보고서 |

구현 근거와 정확한 차이는 [기술 설계의 source 표](technical-design.md#기준-source-대응)에
고정한다. 코드 경로 존재는 이번 기능의 실행 성공이나 재시작 안전성 증거가 아니다.

## 포함 범위

1. 작은 local synthetic fixture 하나의 완전한 입력을 strict 검증·정규화하고 보존
2. 기존 config/schema/manifest/hash/clock/sampling/policy를 재사용하는 입력 계약
3. attempt별 빈 저장소에서 기존 single historical paper workflow를 실행
4. 성공, HOLD, Risk 거절, 입력·실행 실패를 구분하는 evidence 연결
5. 취소·프로세스 중단·명시적 재실행에서 기존 artifact를 보존하고 fail-closed 처리
6. 동일 조건 반복 실행의 semantic 결과 비교와 기존 cash benchmark를 포함한 결과 검토
7. fixture·coverage·비용 가정·통계적 판단 불가·다음 검증 질문을 한국어로 표시

## 비범위와 고정 안전 조건

- 실제 전략 선택·최적화, 수익률 주장, backtest 순위 선정, 실제 source 수집·성능 실험
- 새로운 execution/Risk/sizing engine, 별도 canonical hash 알고리즘 또는 범용 job scheduler
- `strategyBucketTestRuns` queue 소비, multi-bucket 운용·allocator·transaction 완성
- GitHub PR #788의 source 포함·수정·병합, publication session 작업
- Codex CLI 실행, 새 AI/provider/API/credential/유료 도구·외부 데이터 호출
- dashboard/API/MCP mutation route 신설, 기존 simulation API 의미 변경
- live order, 실제 account/portfolio mutation, broker 연결, GitHub 보호·승인 정책 변경

기본값 `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`,
`AI_DECISION_ENABLED=false`를 유지한다. Fixture 경로는 환경변수로 AI mode를 승격하지 않는다.
Risk Engine은 최종 gate다. static test provider도 schema·candidate scope·Risk를 우회하지 않는다.

## 사용 흐름과 사용자에게 남을 것

1. 검증: local fixture 입력을 읽고 범위·cutoff·source·policy·cost·benchmark와 검증 오류를 확인
2. 실행: 검증된 입력을 새 attempt에 고정하고 기존 workflow를 한 번 실행
3. 관찰: attempt 식별자와 현재/종료 상태, 원래 입력과 result artifact 위치를 확인
4. 검토: 질문·입력 → 행동/거절/관망의 근거 → 비용·기준선·한계 → 다음 질문 순서로 읽기
5. 재실행: 동일 입력을 새 attempt로 실행하고 이전 결과를 덮어쓰지 않은 상태로 비교

최종 산출물은 보존된 입력, 기존 replay manifest와 audit/report, 얇은 attempt 상태 기록,
한국어 review 보고서다. 취소·실패한 실행은 완성된 수익률 보고서처럼 보이지 않아야 한다.
실제 CLI 이름·예시는 [PR 작업 계획](pr-work-plan.md)의 구현 후 명령 계약을 따른다.

## 첫 fixture와 평가 한계

- 작은 schema-compatible synthetic symbol 집합, 고정 UTC 기간·tick, 초기 현금만 사용
- 기존 `FirstPricedHistoricalDecisionProvider`의 fixture 행동을 사용. 버전·코드 기준을 기록
- primary benchmark는 기존 `cashOnly`; 동일 초기 현금·평가 tick의 no-trade 기준선
- 기존 equal-weight/initial-hold 통계는 보조 진단으로 표시하고 비용·표본 정렬 차이를 명시
- synthetic 가격은 실제 거래일·체결·시장 coverage를 증명하지 않음
- 단일 fixture에서 Sharpe/유의성/우월성·일반화·실거래 적합성을 결론내리지 않음
- negative scenario는 같은 기능의 안전 검증용 fixture 변형이며 전략 후보 탐색이 아님

## 수용 증거와 Trainer 기준의 관계

아래는 이번 engineering slice가 공급할 증거의 범위다. 문서 작성이나 fixture 테스트만으로
전체 Trainer MVP 또는 기존 portfolio 최종 AC를 완료로 표시하지 않는다.

| 기준 | 이번에 만들 증거 | 이번만으로 완료할 수 없는 부분 |
| --- | --- | --- |
| `TR-MVP-01` | 한 engineering 질문·fixture·policy·cutoff가 보존됨 | 실제 투자 가설·전략·시장 선택 |
| `TR-MVP-02` | 입력 → 기존 workflow → 보고서 CLI의 end-to-end 테스트 | 실제 source와 제품 UI의 사용 검증 |
| `TR-MVP-03` | success/HOLD/Risk denial/no-candidate/failure의 audit 연결 | 모든 실제 전략 상황의 설명 가능성 |
| `TR-MVP-04` | cash 기준선·비용·coverage·통계 한계와 반복 비교 | 비용 동등한 투자전략 비교·통계 유효성 |
| `TR-MVP-05` | 격리·충돌·취소·중단·retry·부분 artifact 보존 테스트 | shared/multi-bucket 또는 분산 운용 복구 |
| `TR-MVP-06` | 외부 AI 호출 0, fixture만 허용, backend 권한 경계 | 실제 AI provider의 budget/timeout/품질 검증 |
| `TR-MVP-07` | 근거에 연결된 관찰·한계·다음 질문 템플릿 | 사용자가 학습 내용을 확인하는 제품 수용 |
| `TR-MVP-08` | safe defaults·기존 read-only MCP·no live/raw surface 회귀 | 이후 추가 경로에 대한 별도 검증 |

이번 slice의 완료 조건은 네 기능 PR의 AC와 필수 검증·current-head review·GitHub 보호 조건을
충족하고, 다른 빈 디렉터리의 두 실행에서 동일 semantic 결과를 입증하는 것이다.
실제 사용자용 실행 예시와 제한을 runbook에 남긴다. AI/실제 전략 비교는 별도 설계 후 확장한다.
