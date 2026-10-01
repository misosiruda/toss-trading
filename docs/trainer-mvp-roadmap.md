# 개인 AI 투자 트레이너 MVP 제안

## 상태와 범위

- 작성: 2026-10-01, main 코드 기준 `d9818e7`
- 확정된 방향: 개인 AI 투자 트레이너, 기존 paper-only 인프라 활용, 문서부터 전체 방향 정리
- 제안: 단일 전략의 end-to-end paper 운용·평가 흐름을 먼저 완성하고 결과 설명·학습 경험을 연결한 뒤 다중 버킷으로 확장
- 미정: 전략 종류, 대상 시장·종목군·기간, 첫 화면, 자동 실행 범위, Jev 등 추가 provider 채택
- 이 문서는 구현·실험 실행 승인이나 기능 완료 보고가 아니다.

[프로젝트 개요](project-overview.md)가 전체 목표와 현재 상태를 설명한다.
이 문서는 다음 작은 제품 단위를 고르기 위한 제안이며 기존 안전·domain contract를 대체하지 않는다.
아래 학습·코칭 흐름은 첫 사용자 경험의 제안이다. 제품의 전체 목적을 교육 UX만으로 한정하지 않는다.

## MVP가 답할 하나의 질문

> 사용자가 하나의 투자 가설을 정하고, 고정된 조건의 paper 실험에서 판단 근거·Risk 거절·결과를
> 검토한 뒤 다음에 무엇을 검증할지 설명할 수 있는가?

첫 성공은 높은 수익률이 아니라 이 질문에 필요한 근거가 끊기지 않는 것이다.
결과가 나쁘거나 거래가 없거나 데이터가 부족한 경우도 유효한 학습 결과로 설명해야 한다.

## 첫 범위 제안

- 전략 하나, 명시적인 시장/종목군, 제한된 입력 기간과 평가 질문 하나
- 기존 isolated paper/historical workflow를 우선 재사용
- deterministic 기준선을 먼저 확보하고 AI proposal을 같은 평가 조건에 연결
- 실행 전 가설·데이터·policy·비용·benchmark·cutoff를 고정
- decision → 정규화/sizing → Risk → paper 결과 → audit/report를 추적
- 단순한 결과 검토 화면 또는 보고서에서 근거·한계·다음 실험을 함께 설명

단일 전략은 제안된 범위 축소 방식이다. 특정 전략·시장·보유기간을 이 문서가 대신 선택하지 않는다.
이미 구현한 다중 버킷 계약을 제거하지 않으며, 미완성 shared allocator를 우회해서 연결하지 않는다.

첫 MVP에서 자동 활성화하지 않을 항목:

- 다중 버킷 동시 scheduler와 전체 자금 자동 배분
- live order, broker/account mutation, 무인 실시간 매매
- 새로운 유료 AI provider나 외부 계정·credential
- 미검증 점수로 final sizing/Risk 또는 source trust를 대체하는 경로
- 최고의 backtest를 사후 선택해 전략 유효성으로 제시하는 UX

## 단계와 완료 증거

### T0. 제품 범위와 문서 정합성

산출물:

- [프로젝트 개요](project-overview.md), 이 MVP 제안, [문서 탐색 지도](README.md)
- 현재 구현/부분 연결/제안의 구분
- 첫 전략·입력·질문·결과 검토 방식에 대한 결정 목록

완료 증거:

- 사용자가 첫 사용자 흐름과 선택이 필요한 항목을 검토함
- stale 문장과 실제 코드가 구분되고 계약·경로가 보존됨

현재는 문서 초안 단계다. 초안 작성만으로 T0의 사용자 검토를 완료 처리하지 않는다.

### T1. 한 실험의 입력과 평가 계약 고정

기존 market packet, historical source, policy, manifest와 replay contract를 조사하여
새로운 중복 모델을 만들지 않고 한 실험을 설명할 최소 입력을 정한다.

고정할 항목:

- 가설, strategy/version, 시장·종목군·기간, evidence cutoff
- source provenance/coverage와 fixture 여부
- risk/allocation/cost policy, benchmark, 결과 해석 제한
- provider mode, 호출/시간 budget, 실패·취소 동작

완료 증거:

- 같은 입력 artifact와 version을 식별할 수 있음
- missing/stale/미래 evidence를 정상 입력처럼 처리하지 않음
- 데이터 가용성 부족과 strategy 부적합을 구분함

### T2. 기존 deterministic paper 경로로 한 번 끝까지 연결

먼저 기존 fixture/static provider 경로로 입력부터 보고서까지 연결 지점을 확인한다.
새 execution engine을 만들지 않고 기존 `paperDecisionPipeline` 또는 해당 historical
workflow 중 선택한 사용자 흐름에 맞는 경로를 사용한다.

완료 증거:

- 성공, HOLD/no-trade, Risk 거절, 입력 실패가 각각 기록·설명됨
- decision/Risk/fill/report와 입력 버전의 연결을 확인함
- 고정 fixture의 deterministic 결과와 replay lineage를 재현함
- 재실행이 잘못된 중복 거래나 기존 artifact 파괴를 만들지 않음

기존 paper 경로의 보장과 새 strategy-portfolio 경로의 미완성 transaction 보장을 혼동하지 않는다.
필요한 안전 경계가 빠져 있으면 그 연결을 작은 선행 변경으로 다룬다.

### T3. 운용 결과와 판단 근거를 검토 가능하게 전달

기존 report·Risk trace·audit를 사용해 첫 검토 경험을 구성한다.
처음부터 자유형 AI 채팅 서버나 별도의 inference API를 필수로 만들지 않는다.

보고서/화면에 필요한 내용:

- 실험 질문과 사용한 근거, 실제 관측된 결과
- 제안과 backend가 최종 허용한 행동의 차이
- 비용·거절·노출·관망 이유와 같은 조건의 기준선 비교
- 데이터/표본/fixture/모델 한계와 판단할 수 없는 부분
- 다음 실험 후보와 그 후보가 확인하려는 질문

완료 증거:

- 설명의 각 핵심 주장에 source 또는 계산 근거가 있음
- unavailable/inconclusive를 0 또는 성공으로 표시하지 않음
- 투자 권유·수익 보장·실거래 적합 판정으로 표현하지 않음

### T4. 기존 CLI AI proposal을 제한적으로 비교

선택한 흐름에 AI proposal이 필요한 경우 기존 CLI provider의 인증·가용성·usage budget을
확인하고 명시적으로 활성화한 paper 실행만 사용한다. T2의 deterministic 경로는 비교 기준과
회귀 검증 수단으로 유지한다.

완료 증거:

- 동일한 입력 범위와 policy에서 기준선과 AI proposal을 비교할 수 있음
- schema/semantic/evidence 검증을 거치고 sizing/Risk는 backend가 유지함
- timeout, budget 초과, invalid output, provider unavailable은 no-paper-order와 원인 기록으로 종료함
- 모델 응답 재생과 새로운 모델 호출을 구분하며 외부 응답의 완전한 결정성을 주장하지 않음
- 실제 사용 한도와 호출 수를 관찰하고 별도 API 비용을 암묵적으로 추가하지 않음

Jev 등 추가 scorer의 실험은 이 단계의 필수 조건이 아니다. 채택 전 별도 평가 계획과
사용자 선택이 필요하다. dot은 결과 검토 대화에 활용할 수 있지만 backend가 호출 가능한
일반 inference API라는 가정은 넣지 않는다.

### T5. 첫 MVP 수용과 다음 확장 선택

아래 `TR-MVP` 기준을 검증 증거에 연결한 뒤 사용자에게 첫 흐름을 보여준다.
검증 명령은 [test-verification.md](test-verification.md)를 따르며, 실제 코드 변경 시
영향 범위에 맞는 unit/integration/UI 검증을 선택한다. 문서 검토 자체가 테스트 통과를 대신하지 않는다.

이후 확장 후보는 관찰한 사용자 가치와 실패 경계에 따라 선택한다.

- 학습 질문·비교·회고 경험 보강
- 승인된 범위의 실제 source coverage 확보
- 단일 전략의 추가 regime/기간 검증
- 필요성이 확인된 multi-bucket 운용 연결
- 별도 scorer/provider 평가

## 제안된 MVP 수용 기준

아래 ID는 새 Trainer 범위의 기준이다. 기존 포트폴리오 계획의 최종 기준을 대체하거나
완료로 전환하지 않는다. 현재는 모두 미검증이다.

- [ ] `TR-MVP-01`: 하나의 학습 질문과 명시적 전략·입력·policy 범위가 고정됨
- [ ] `TR-MVP-02`: 기존 paper workflow로 입력부터 결과 검토까지 한 경로가 연결됨
- [ ] `TR-MVP-03`: 모든 행동·거절·관망을 decision/Risk/결과 근거로 추적할 수 있음
- [ ] `TR-MVP-04`: 같은 조건의 기준선과 비교하고 비용·coverage·통계 한계를 표시함
- [ ] `TR-MVP-05`: 실패·취소·재실행에서 fail-closed와 artifact 보존 경계가 검증됨
- [ ] `TR-MVP-06`: AI provider 역할·실패·사용 한도가 명시되고 backend 권한을 침범하지 않음
- [ ] `TR-MVP-07`: 사용자가 결과에서 배운 점과 다음에 검증할 질문을 확인할 수 있음
- [ ] `TR-MVP-08`: paper-only 기본값, read-only MCP, no live/raw-command surface가 유지됨

## 기존 계획과의 관계

- [기존 roadmap](roadmap.md)과 [PR plan](pr-implementation-plan.md)은 기존 기반의 순서·이력을 보존한다.
- [전략 포트폴리오 계획](strategy-portfolio-operating-model-plan.md)은 장기 multi-bucket 운용 계약을 유지한다.
- [Research Hardening](research-hardening-milestone-plan.md)과 evidence expansion은 연구 결과의 한계를 판단하는 기준이다.
- [Next.js 계획](nextjs-dashboard-architecture-plan.md)과 [routing 정책](dashboard-routing-policy.md)은 기존 UI 경계를 유지한다.

이 계획들에서 MVP에 필요한 안전·증거 의존성만 먼저 연결하되, 완성되지 않은 기능을
완료라고 설명하거나 기존 제약을 건너뛰지 않는다. 구체적인 첫 구현 PR은 T0 검토와
현재 코드 연결 분석 후 결정한다.
