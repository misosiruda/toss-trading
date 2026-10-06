# 전략 포트폴리오: 현재 구현과 남은 연결

[운용 모델 진입점](../plans/strategy-portfolio-operating-model-plan.md) · [구현 단계](../plans/strategy-portfolio/implementation-stages.md) · [최종 수용 기준](../plans/strategy-portfolio/validation-and-acceptance.md#16-최종-수용-기준) · [과거 기준선](../archive/strategy-portfolio-operating-model-history.md)

## 관찰 기준과 상태 의미

- 기준: 2026-10-02 KST 확인한 원격 `main`, `8eede864a26143ac91a912671d7f98bd222632e0`
- “구현 확인”은 source 경로·연결이 존재한다는 뜻이다. 배포 확인이나 이번 감사의 runtime 실행 통과가 아니다.
- “남은 연결”은 개별 contract/repository가 있어도 전체 운용 수용 기준으로 확인되지 않은 경계다.
- 아래 `PR 1`~`PR 8`은 원문 내부 단계명이다. GitHub PR 번호나 각 단계의 완료 선언이 아니다.
- 옛 2·4절의 부재 설명은 [이력](../archive/strategy-portfolio-operating-model-history.md)에 보존했다. 현재 상태의 근거로 재사용하지 않는다.

## main에서 확인한 범위

| 내부 단계 | 구현 확인과 source | 남은 연결·완료 한계 |
| --- | --- | --- |
| PR 1. Runtime policy | Immutable dependency/runtime policy, activation event 저장과 single-active as-of fold, durable active-policy 관측. [activation repository](../../src/portfolio/runtimePortfolioPolicyActivationFiles.ts#L245-L361) | 정책 계약의 존재와 전체 multi-bucket runner 연결은 별개 |
| PR 2. Compliance | Portfolio `updatedAt` 기준 active policy를 해소하여 target/band/hash를 ViewModel에 반영. missing과 corrupt를 정상 0으로 대체하지 않음. [조회·계산](../../src/api/dashboardViewModels.ts#L818-L855), [as-of/lineage](../../src/api/dashboardViewModels.ts#L1206-L1271) | Read-only compliance는 allocation/Risk/실행 완료를 증명하지 않음 |
| PR 3. Mandate/state | [Mandate record/event 저장](../../src/portfolio/investmentMandateFiles.ts#L64-L164), [position state CAS·dependency 검증](../../src/portfolio/positionStrategyStateFiles.ts#L88-L130), [bucket valuation workflow](../../src/workflows/bucketValuationRunOnce.ts#L76-L128) | 신규 position 전체의 mandate 강제, reservation·mandate activation·fill accounting 통합, cadence별 호출 |
| PR 4. Gap/request | [Policy-bound gap/cash capacity](../../src/portfolio/portfolioGapAnalyzer.ts#L118-L158), [request의 snapshot/policy/trigger 결속과 gap 재계산](../../src/portfolio/bucketSelectionRequestResolver.ts#L108-L175) | Activation-aware caller와 실제 capacity replay 경계를 공급해야 함. 자동 scheduler/claim 실행 완료가 아님 |
| PR 5. Selector | [Stored feature/score replay](../../src/portfolio/storedCandidateSelectionScore.ts#L13-L50), [assignment set/top-N/budget 계약](../../src/portfolio/candidateAssignmentSet.ts#L21-L76), source-bound reservation journal과 append-session primitive | Shared allocator의 할당 적법성·slot/budget 할당 CAS 및 reservation→mandate activation 원자 발행. Historical replay는 현재 eligibility/실행 승인이 아님 |
| PR 6. Rebalance/Risk | Immutable plan/event 저장·replay, [원본을 결속하는 Risk 생성 메서드](../../src/portfolio/portfolioActionRiskDecisionFiles.ts#L266-L334), [남은 action execution preview](../../src/portfolio/portfolioPlanExecutionPreview.ts#L23-L94) | End-to-end sell-first plan 생성·소비, 모든 Risk 수치의 독립 평가, 현재 cash/quantity 예약과 fill/accounting 원자 coordinator. Sequential drift 검사는 multi-file lease가 아님 |
| PR 7. Shared paper | 기존 [paper pipeline](../../src/workflows/paperDecisionPipeline.ts#L66-L146)의 revision CAS, prepared intent, log plan/receipt, [revision v3 검증](../../src/storage/virtualPortfolioRevisionJournal.ts#L45-L103). Current sizing publication과 source lock/opening budget projection도 구현 | Multi-bucket scheduler/conflict resolver, trigger exactly-once, 전체 strategy-portfolio 원자 회계 및 자동 recovery |
| PR 8. Integrated replay/UI | 기존 historical replay 및 read-only compliance 기반 존재. [Compliance ViewModel의 isolated artifact 제외 경계](../../src/api/dashboardViewModels.ts#L868-L892) | Mandate timeline·rebalance dashboard·shared multi-bucket integrated replay 수용 기준은 완료로 확인되지 않음 |

## 현재 projection과 실행 권한의 구분

“Capacity CAS가 없다” 또는 “reservation append session이 없다”로 요약하면 현재 구현을 잘못 설명한다.

- [BucketOpeningCapacityStateFileRepository](../../src/portfolio/bucketOpeningCapacityStateFiles.ts#L34-L110)의 `refreshFromCurrentPublication`은 실제 portfolio/source lock 아래 whole-document projection CAS를 수행한다. 이 projection은 allocation/execution 권한을 부여하지 않는다.
- [Manual append session](../../src/portfolio/manualOpeningCapacityReservationFiles.ts#L113-L177)과 [selector append session](../../src/portfolio/selectorOpeningCapacityReservationFiles.ts#L117-L162)은 main에 존재한다.
- Main의 [current publisher callback](../../src/portfolio/currentPortfolioSizingSnapshotFiles.ts#L59-L79)은 `publication, snapshots` 두 인자만 제공한다. 예약 append-session 전달 composition은 이 main에 포함되지 않았다.
- Stored observation, historical replay, current live lease, allocation 승인, atomic execution은 서로 다른 보장이다. Prefix/hash 또는 잠금 하나로 나머지를 충족했다고 간주하지 않는다.
- 기존 paper pipeline에는 intent/log receipt/revision이 이미 있다. 남은 범위는 전체 strategy-portfolio 원자 coordinator와 trigger exactly-once/자동 recovery이며 기존 journal 자체의 부재가 아니다.

이 구분의 상세 안전·실패·복구 정본은 [selection/sizing/reservation](../contracts/strategy-portfolio/selection-sizing-reservation.md)과 [rebalance/Risk/fill](../contracts/strategy-portfolio/rebalance-risk-fill.md)이다.

## 미병합 변경과 제안

### GitHub PR #788

[PR #788](https://github.com/misosiruda/toss-trading/pull/788)은 위 기준일에 열린 미병합 변경이다.
이전 문서 감사에서 관찰한 `dd132a3`는 current publication callback에 예약 append session을
전달하는 변경이다. 이 관찰은 PR의 최신 head 테스트 통과·승인·병합 증거가 아니며, 이번 문서
branch의 코드에 포함하지 않았다. Chronology/lifetime 검토와 최종 merge 검증도 이 문서 분리로
완료 처리하지 않는다. 해당 연결만으로 shared allocator나 원자 mandate 발행이 완성되는 것도 아니다.

### Fundamental evidence와 Trainer MVP

`credential-free-fundamental.v1` envelope와 저장소는 구현되어 있다. 실제 공식 provider adapter,
credential·비용·license·계정 검토는 후속이며 데이터 권위나 투자 품질을 자동 승격하지 않는다.
[기존 후속 단계](../plans/strategy-portfolio/implementation-stages.md#후속-단계-fundamental-evidence-source)와 [상세 계약](../contracts/strategy-portfolio/selection-sizing-reservation.md#spom-source-6720-6726)을 함께 읽는다.

[Trainer MVP](../plans/trainer-mvp-roadmap.md)의 단일 전략 우선 흐름은 제안이다. 전략, 시장·종목군·기간,
첫 화면, 자동 실행 범위 및 Jev 등 provider 선택은 미정이며 이번 분리에서 결정하지 않는다.

## 다음 구현 판단에 필요한 증거

1. 현재 publisher/source lease와 reservation writer가 같은 lifetime 안에서 실제로 연결되는지
2. Projection CAS와 별개로 shared allocator가 slot/budget을 중복 배정하지 않는지
3. Reservation·mandate activation·position/fill/accounting 변경의 원자 commit과 실패 복구가 연결되는지
4. Scheduler/claim, sell-first plan, 각 action의 현재 Risk 재검증 및 trigger dedupe가 실제 운용 경로에 적용되는지
5. Shared replay/UI가 같은 policy와 lineage를 사용하며 원래 최종 수용 기준 12개를 검증하는지

이는 남은 경계를 읽는 순서이며 새 runtime 구현 승인이나 자동 실행 계획이 아니다.
[최종 수용 기준](../plans/strategy-portfolio/validation-and-acceptance.md#16-최종-수용-기준) 12개는 모두 미완료로 유지한다.
