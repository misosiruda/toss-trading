# 구현 상태 checkpoint — 2026-10-29

## 기준과 읽는 방법

- 기준: 원격 `main`의 `6260c5bd28b7e109f60500f52cf55318babadacf`,
  tree `f0c51623a45ad0e68a9cb521a045a5eb2cbc4bc1`.
- Git 이력과 현재 source/contract를 대조한 상태표다. 이후 main의 자동 갱신 상태표가 아니다.
- **완료**는 표에 적힌 작은 기능 또는 고정 실험의 구현·병합 범위다. 상위 제품 수용,
  실제 외부 데이터 검증, 배포 또는 운영 완료를 뜻하지 않는다.
- **부분 완료**는 구현된 기반과 아직 연결되지 않은 범위가 함께 있는 경우다.
- **미완료**는 해당 연결 또는 최종 수용 증거가 남은 경우다. 기존 primitive가 없다는 뜻은 아니다.
- **결정 미정·원인 미확정**은 구현 누락과 별도로 표시한다. 기존 assertion·timeout·skip·보호 조건,
  evidence class와 `unavailable`/complete flag의 의미는 바꾸지 않는다.

이 문서는 상태 정정만 수행한다. 원래 기능 범위·설계·검증 계약은 각 정본을 계속 적용하며,
과거 head의 실행·실패·review 기록을 이번 후보의 통과 증거로 대체하지 않는다.

## 완료한 제한 범위

| 기능 단위 | 상태와 현재 근거 | 완료로 확대하지 않는 범위 |
| --- | --- | --- |
| Current publication의 예약 session 전달 | **완료**. [PR #788](https://github.com/misosiruda/toss-trading/pull/788), merge `234509734`. [callback](../../src/portfolio/currentPortfolioSizingSnapshotFiles.ts)은 `publication, snapshots, sessions`를 전달하며 `manualSession`/`selectorSession`을 결속 | Shared allocator, allocation slot/budget CAS, mandate·fill/accounting 전체 원자 coordinator |
| 기존 legacy 호환 경로의 제한된 감사·폭 회귀 | **완료**. [PR #810](https://github.com/misosiruda/toss-trading/pull/810), merge `489da13d7`. [당시 검증 기록](../plans/experiment-workspace-redesign/implementation-ledger-20261006.md)의 loopback 합성·panel·GET-only·3 viewport 범위 | 모든 legacy payload의 Next 이관, 실제 사용자 origin 또는 새 브라우저 실행 확인 |
| 명시 비용 실행 계약과 wizard 입력 | **완료**. [PR #812](https://github.com/misosiruda/toss-trading/pull/812)·[813](https://github.com/misosiruda/toss-trading/pull/813). [resolver](../../src/api/paperSimulationConfig.ts)의 `feeBps/taxBps/slippageBps` 입력·기존 비용 model 적용 | 새 비용 model, 고정 숫자 preset, 실제 거래 비용이나 유료 AI 정책 |
| Benchmark 표시 선택·coverage 설명 | **완료**. [PR #814](https://github.com/misosiruda/toss-trading/pull/814)·[817](https://github.com/misosiruda/toss-trading/pull/817), [표시 컴포넌트](../../apps/dashboard/src/app/dashboard/lab/runs/[runId]/RunBenchmarkCoverage.tsx) | 기존 3종 계산 변경, cash-only 실행 모드, universe membership filtering |
| 원래 batch 요청 정본과 새 실행 복제 | **완료**. [PR #815](https://github.com/misosiruda/toss-trading/pull/815)·[816](https://github.com/misosiruda/toss-trading/pull/816), [request store](../../src/storage/paperSimulationRequestStore.ts), [clone parser](../../apps/dashboard/src/lib/simulationClone.ts). 원래 요청 → 현재 validation → 새 ID | 선택 child의 모든 실효 조건 복제, 과거 누락 값 보충, 자동 retry·기존 실행 덮어쓰기 |
| C2-A startup eligibility | **완료: pure preflight 범위**. [PR #827](https://github.com/misosiruda/toss-trading/pull/827), merge `bcd64c839`, [candidate](../../src/domain/replayRuntimeStartupCandidate.ts) | 실제 process 시작·bootstrap·load의 증명 또는 runtime completeness |
| C2-B 고정 module 소비 실험 | **완료: 격리 실험 범위**. [PR #828](https://github.com/misosiruda/toss-trading/pull/828), merge `fdfc8e810`, [관측 시험](../../src/replay/runtimeLoadExperimentObservations.test.ts) | 일반 설치 package·전이 dependency 전체 소비, 운영 HTTP 연결 |
| C2-C1~C5 고정 executable/compiler 실험 | **완료: 각 고정 실험 범위**. [PR #829](https://github.com/misosiruda/toss-trading/pull/829)·[830](https://github.com/misosiruda/toss-trading/pull/830)·[831](https://github.com/misosiruda/toss-trading/pull/831)·[832](https://github.com/misosiruda/toss-trading/pull/832)·[833](https://github.com/misosiruda/toss-trading/pull/833). [C5 시험](../../src/replay/runtimeCompilerOutput.test.ts)은 같은 child의 compiler → 고정 emit → ESM 평가를 연결 | C2-C 전체 build/Node/native/configuration 완전성, C2-D admission |
| 실패 관측 보강·valuation 재현 조사 | **기록 범위 완료**. [PR #834](https://github.com/misosiruda/toss-trading/pull/834)·[835](https://github.com/misosiruda/toss-trading/pull/835), [조사 기록](../runbooks/valuation-lock-timeout-investigation-20261029.md) | Valuation 및 별도 turnover 간헐 실패의 원인은 미확정. 최종 전체 통과를 원인 해결로 표시하지 않음 |

비용·benchmark/universe·clone의 사용자 결정은
[2026-10-06 승인 계약](../plans/experiment-workspace-redesign/approved-options-contract-20261006.md)에
이미 있다. 예전 원장의 “결정 대기”를 근거로 같은 선택을 다시 요구하지 않는다.

## 부분 완료와 남은 연결

| 상위 범위 | 현재 구현된 부분 | 미완료 경계·판정 |
| --- | --- | --- |
| 접수 입력·실제 child 입력 provenance | PR #819의 [접수 snapshot](../../src/storage/paperSimulationInputStore.ts), #820 초기 portfolio, #822 source, #823 부분 설정 A, #824 admission lineage B, #825 process C1이 병합됨 | 각 producer는 제한된 부분 관측. 전체 input/configuration/runtime/dependency/result 완전성과 공개 조회 연결은 완료가 아님 |
| C1 process 관측 | [process store](../../src/storage/replayProcessObservationStore.ts)와 [실제 API 회귀](../../src/api/paperSimulationProcessObservation.test.ts), PR #825 merge `26813e50f` | bounded process scalar와 durable B의 결속이다. 독립 OS child 실행이나 실제 loaded dependency 전체를 증명하지 않음 |
| C2 runtime 지원·소비 증명 | 위 C2-A/B 및 C1~C5 부분 실험 | **C2 전체는 부분 완료**. 일반 source/build·설치/해석/소비 dependency·Node/native/configuration·늦은 load 등의 지원 범위 증명이 남음 |
| 실험 workspace UX01~07 | 목록, wizard, 상세/근거, exact-pair 관측, role index·호환 경로, 비용·원래 batch 복제의 각 제한 범위가 병합됨 | 초기 UX 단위 병합을 전체 workspace 완료로 확대하지 않음. UX06의 완전한 입력/runtime/version 비교와 후보 1~3개 확장은 남음 |
| 비교·provenance 조회 | [비교 모델](../../apps/dashboard/src/lib/runComparison.ts)은 기준 1개·후보 1개. [공개 projection](../../src/api/replayProvenanceProjection.ts)은 부분 stored observation과 `not_persisted`를 유지 | `comparability=unavailable`. 이 v1 projection의 `clone=unavailable`은 별도 canonical whole-batch clone 미구현을 뜻하지 않음 |
| 전략 포트폴리오 | policy/activation, mandate/state, gap/request, candidate scoring, projection CAS, reservation journal/session, paper revision·receipt 기반 존재 | Shared allocator, reservation→mandate→fill/accounting 원자 연결, multi-cadence scheduler·conflict/trigger 처리, integrated replay/UI 수용은 미완료 |
| Trainer | EXP-01~04의 고정 fixture validate/run/inspect/review/retry/compare·근거 링크 기반 | [TR-MVP-01~08](../plans/trainer-mvp-roadmap.md#제안된-mvp-수용-기준) 전체 제품 수용은 미완료. fixture 통과를 실제 전략·source·사용자 수용으로 승격하지 않음 |

관련 source: [initial portfolio store](../../src/storage/replayInitialPortfolioObservationStore.ts),
[source store](../../src/storage/replaySourceObservationStore.ts),
[settings store](../../src/storage/replaySettingsObservationStore.ts),
[admission store](../../src/storage/replayAdmissionLineageStore.ts).

## 아직 완료하지 않은 작업과 순서

1. **C2의 남은 지원·증명 의무:** [launcher 계약](../plans/experiment-workspace-redesign/child-runtime-launcher-contract.md)의
   positive/negative 기준을 충족해야 한다. 고정 실험의 종료로 상위 `completeRuntime`을 올리지 않는다.
2. **C2-D actual child producer:** lifecycle/IPC·admission·durable schema 계약 이후 default HTTP와
   실제 child 실행을 연결한다. 현재 논리 child 경로와 구분한다.
3. **결과 producer:** 완료한 exact child와 입력/runtime, report 내용 hash 및 durable 발행을 결속한다.
4. **Bounded historical reader:** 저장된 결속의 버전·ID·hash·경로·크기·시간 한도와 GET mutation 0을 검증한다.
5. **확장 비교 UI:** 위 producer/read를 소비하는 baseline 1/candidate 1~3, 조건 차이, 검증된 공통
   관측 범위의 metric과 후보별 실패 격리를 구현한다.

3~5의 정본은 [입력·runtime provenance 계약](../plans/experiment-workspace-redesign/input-runtime-provenance-contract.md)이다.
외부 AI의 입력/model/runtime 일치만으로 결정 재현성이나 통제된 metric 비교를 허용하지 않는다.
별도 deterministic provider 또는 captured decision-stream 재생 계약이 필요하다.

전략 포트폴리오의 [SPOM-AC-01~12](../plans/strategy-portfolio/validation-and-acceptance.md#16-최종-수용-기준)는
미완료로 유지한다. 이 문서에서 개별 primitive의 구현 사실을 확인했다고 전체 체크리스트를 체크하지 않는다.
단일 전략 Trainer를 먼저 닫는 제안과 장기 multi-bucket 확장의 선행 관계도 제품 범위 결정과 구분한다.

## 구현 상태와 구분할 미정·미확정 사항

- **제품 결정 미정:** 첫 Trainer 전략, 시장·종목군·기간, 평가 질문, 첫 화면, 자동 실행 범위,
  Jev 등 추가 provider 채택. 이미 승인된 비용·표시·batch clone 선택과 혼동하지 않는다.
- **실제 근거 수용 미완료:** 공식 source coverage·calendar 정합성·통계 표본/독립성/선택 편향 및
  실제 사용자 수용. 이 문서에서는 외부 데이터 취득이나 실제 전략 검증을 실행하지 않았다.
- **실패 원인 미확정:** #835에서 원래 valuation timeout은 재현되지 않아 운영 코드를 수정하지 않았다.
  별도 turnover 실패와 무효 검증 시도도 기록에 남아 있다. 이후 전체 통과는 원인 규명의 대체물이 아니다.

## 과거 기록 보존과 새 검증의 귀속

- 프로젝트 개요(10-01), 포트폴리오 현황(10-02), UX 원장(10-06), provenance checkpoint(10-08/10-12)의
  원래 본문은 보존하고 앞에 날짜가 명시된 정정 안내를 추가한다. 과거의 “현재/다음/미병합”은 당시 기준이다.
- 아래 연결된 과거 문서의 안전 경계·범위·검증·보호 조건은 계속 적용한다. 상태 정정은 계약 완화가 아니다.
- 이 checkpoint의 기준 이후 commit에서 변경이 생기면 main·source·PR·검증을 다시 대조한다.
- 문서 변경 후보는 [기존 검증 절차](../runbooks/test-verification.md)에 따라 전체 검증·현재 HEAD 검수·보호 조건을
  확인한다. 실행 결과는 해당 PR과 검증 기록에 귀속하며, 이전 PR의 pass를 이번 후보 결과로 적지 않는다.
- 전체 `ROADMAP_COMPLETE`, 배포·실운영 수용 또는 투자 성과를 선언하지 않는다.
