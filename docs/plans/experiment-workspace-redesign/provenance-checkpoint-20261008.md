# Provenance 구현 checkpoint — 2026-10-08

확인 기준 main: `3cbd1ebc8bd959aed3ff3cdf53f1885ed887513a`,
tree: `1a8d1e7508ec6f18718e521dd8f03bc7e616b54a`.
GitHub 병합 상태와 현재 소스를 대조한 기록이다. 과거 원장의 당시 미구현 표시는 이력으로 유지한다.

## 완료와 남은 경계

| 단위 | 현재 완료 | 아직 없는 근거 |
| --- | --- | --- |
| 요청 비용 | [PR812](https://github.com/misosiruda/toss-trading/pull/812)의 명시 비용 실행·기록 계약, [PR813](https://github.com/misosiruda/toss-trading/pull/813)의 wizard 입력 | 새로운 비용 model이나 숫자 preset을 승인한 것은 아님 |
| 표시·복제 | PR814 benchmark 표시, PR815 원래 batch 요청 저장·읽기, PR816 새 검증·새 ID 복제, PR817 상세 탐색 선택 보존 | 통제된 성과 비교, child 실효 입력 전체 복제, 모든 legacy payload 이전 |
| 접수 입력 | [PR819](https://github.com/misosiruda/toss-trading/pull/819)의 requested/effective/notices와 acceptance hash 결속 | 실제 child source·적용 설정·runtime/dependency/result 결속 |
| 초기 portfolio | [PR820](https://github.com/misosiruda/toss-trading/pull/820)의 실제 runner 초기 상태 snapshot·hash·immutable 예약과 provider 전 동기화 | 전체 source/input/runtime/result 완전성, 공개 reader, 비교 가능성 |

PR820은 `replay_initial_portfolio_observation.v1` 부분 관측이다. `completeInput=false`,
source/configuration/runtime/dependencies/result/comparability의 unavailable 의미를 유지한다.
현재 원래 요청 clone은 동작하지만, 입력·runtime 정본 전체를 복제하거나 비교하는 기능은 아니다.

## 현재 소비 경계의 확인

1. `historicalReplayWorkflow`는 `FileHistoricalMarketSnapshotStore.readAll()`의 유효 `records`와
   `corruptLineCount`를 받는다. 이 경로는 `withDurableVerifiedHistory()`의 durable lease를 사용하지 않는다.
2. `createHistoricalReplayWorkflowPlan`은 같은 배열을 `replayInput.snapshots`에 전달한다.
3. `runCodexHistoricalReplay`는 이 배열로 `HistoricalMarketSnapshotIndex`를 만들고, 별도로
   market regime allocation과 exit/provider 결정의 Risk 계산에도 원래 배열을 전달한다.
4. index는 wrapper를 정렬하지만 각 snapshot 객체는 참조한다. 초기 portfolio의 deep copy가
   source 배열·중첩 `riskTags`/`sourceRefs`의 격리를 대신하지 않는다.
5. 기존 research hash는 snapshot의 optional 값을 null/빈 배열로 정규화하고 정렬한다.
   소비된 배열의 원래 순서·중복·presence를 보존한 versioned snapshot과 같은 계약이 아니다.

관련 구현: [workflow](../../../src/workflows/historicalReplayWorkflow.ts),
[plan](../../../src/workflows/historicalReplayWorkflowPlan.ts),
[runner](../../../src/replay/codexHistoricalReplayRunner.ts),
[index](../../../src/market/historicalPacketBuilder.ts),
[JSONL reader](../../../src/storage/jsonlStore.ts).

## 다음 작은 기능

[Child source 관측 설계](child-source-observation-scope.md)는 승인된
[입력·runtime 계약](input-runtime-provenance-contract.md)의 2단계 안에서 소비 배열을 고정하는
다음 기능을 정의한다. 현재 PR은 설계 문서만 추가하며 producer·reader 구현 완료가 아니다.

순서는 다음과 같다.

1. 실제 소비 source의 제한된 immutable 관측과 초기 상태·child 결속
2. 실제 적용 configuration 및 접수 입력의 결속
3. 실제 process/build/Node/로드된 dependency와 소비 시점의 결속
4. 완료한 exact child의 결과/report 내용과 입력/runtime 결속
5. bounded historical read 및 baseline 1/candidate 1–3 UI

각 단계의 완료를 상위 2단계 전체 완료로 확대하지 않는다. source 파일·acquisition 신뢰, 공식
calendar의 non-exporting evidence, AI 결정 재현성 및 metric 비교 조건은 각각 별도 경계다.
실거래·유료 AI·새 데이터 수집·membership filtering은 추가하지 않는다.

## 검증·운영 원칙

- 새 backend 구현은 exact candidate의 독립 검토와 공식 full을 갖춘다. 문서 검증을 구현 검증으로 쓰지 않는다.
- 실패와 후속 성공은 분리한다. SIGKILL은 종료 신호의 관측이며 별도 근거 없이 OOM을 원인으로 확정하지 않는다.
- 시험용 임시 자료의 자원 사용을 확인하고 heavy 검증은 같은 컴퓨터의 다른 작업과 순차 조율한다.
- 원래 runner·assertion·skip·timeout·보호 조건을 완화하지 않는다. 지원 밖 filesystem은 fail-closed다.
- [작업 계획](pr-work-plan.md)의 branch 보존 지시와 수동 자동-review/Actions 중복 요청 금지를 유지한다.

전체 `ROADMAP_COMPLETE` 또는 완전한 비교 가능성을 선언하지 않는다.
