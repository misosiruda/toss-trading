# 재현 가능한 paper 실험의 기능 PR 작업 계획

## 게시 순서와 공통 병합 조건

1. 이 기획·설계·작업 문서만 먼저 draft PR로 게시하고 current-head 검수·필수 check·전체 검증 후 병합
2. clean `origin/main`에서 EXP-01을 시작. 각 기능 PR이 병합된 뒤 다음 dependency를 진행
3. 구현 결과가 설계와 다르면 범위 안의 정합성 수정은 해당 PR에 기록. 안전 경계나 기능 범위가
   달라지면 먼저 문서 변경을 검토하고 다음 기능에 무관한 변경을 섞지 않음

`EXP-00`~`EXP-04`는 이 문서의 작업 ID이며 GitHub PR 번호가 아니다. 구현 시 path 이름을
조정할 수 있으나 책임·계약·AC는 유지한다. EXP-00은 PR #791로 병합되었다.
EXP-01의 입력 계약·fixture·unit test만 구현했으며 EXP-02~04는 미구현이다. 예정 CLI 명령을 실행된
증거로 읽지 않는다. 커밋 개수는 게시 조건이 아니다. schema/저장/실행/검토/테스트·문서의
책임이 바뀌기 전에 검토 가능한 단위로 Korean Conventional Commit을 남긴다.

공통 verification/merge gate:

- `git diff --check`와 `npm run check:review`로 build/quality/tooling/변경 영향 테스트 확인
- 집중 테스트 명령은 개발 중 진단용이다. aggregate 검증 뒤 같은 테스트를 의무적으로 반복하지 않음
- exact current head에 독립 검토와 `@codex review`, actionable finding 해결, unresolved thread 0
- 최종 candidate에 `npm run check` 또는 `npm run check:merge` 전체 검증
- GitHub 필수 check/보호 조건·PR author/identity·expected SHA 확인 후 기존 merge 방식 사용
- 검증 도구/보호 정책/approval 조건 완화 없음. 이전 PR의 review 예외를 자동 적용하지 않음
- baseline 변경 시 영향·검증 재평가. [test-verification](../../runbooks/test-verification.md) 및
  [위임 정책](../../runbooks/codex-maintenance-delegation-policy.md)의 절차 유지

## EXP-00. 기획·설계·PR 작업 문서 게시

**목적:** 구현 시작 전에 질문·reuse 경계·안전 조건과 기능별 완료 기준을 리뷰 가능하게 고정한다.

- dependency: baseline `bc1423bd992171cf86b5c5d288e9c1c915cc2333`
- 포함: [기획](product-plan.md), [기술 설계](technical-design.md), 이 작업 계획,
  Trainer roadmap과 문서 index의 탐색 링크
- 비범위: production/test/fixture/schema/config/dependency 변경, simulation 실행, PR #788 변경
- 대상 파일: `docs/plans/reproducible-paper-experiment/*.md`, `docs/plans/trainer-mvp-roadmap.md`,
  `docs/plans/README.md`, `docs/README.md`
- 계약: 현재 source와 제안을 분리, 기존 TR-MVP/SPOM AC 문장·미완료 상태 보존
- AC: 네 구현 PR 각각의 purpose/non-goals/dependency/files/contracts/acceptance/tests/rollback 존재,
  source line 근거 정확, 실제 전략 선택·AI 호출 없이 EXP-01 시작 가능
- 검증: docs-only diff, 상대 링크/anchor·pinned source path/line 확인, 공통 review gate
- rollback: 이 문서와 navigation 추가만 revert. runtime/data 영향 없음

문서 PR이 병합되기 전에는 아래 runtime 구현을 시작하지 않는다. 문서 수용은 기능 완료 증거가 아니다.

## EXP-01. 검증 가능한 고정 입력 계약

**목적:** 실행 없이 fixture 실험 조건 전체를 읽고 정규화·검증·식별할 수 있게 한다.

- dependency: EXP-00 병합
- 포함: strict `PaperExperimentInput`, 기존 schema/resolver composition, bounded input/tick preflight,
  normalized full payload·inputHash, 작은 tracked synthetic fixture와 순수 unit tests
- 비범위: filesystem attempt 저장, runner 호출, queue 소비, CLI/API 실행 surface, AI/외부 source
- 예상 파일:
  - `src/replay/paperExperimentInput.ts`, `src/replay/paperExperimentInput.test.ts` (신규)
  - `src/replay/fixtures/paper-experiment.v1.json` (신규, 테스트가 명시적으로 읽는 고정 fixture)
  - 필요한 기존 schema export만 `src/replay/historicalReplayAuditLog.ts` 등에서 재사용
  - 후속 `docs/runbooks/paper-experiment.md`의 입력 형식 절 또는 이 설계의 대응 갱신
- 계약: [설계 1~2절](technical-design.md#1-입력-계약과-정규화); 기존 research hash 알고리즘 유지,
  effective policy/clock/source를 plain JSON으로 보존, unsupported session/provider/path reject

수용 기준:

- [x] `EXP-01-AC1`: 같은 의미의 field 순서·UTC 정규화·동일 snapshot 집합에서 같은 normalized input/hash
- [x] `EXP-01-AC2`: fixture/source/cutoff/cost/Risk/strategy version 변경은 입력 식별 변경 또는 validation 실패
- [x] `EXP-01-AC3`: missing/empty/corrupt/duplicate/future-cutoff/unknown field·version·symbol reject
- [x] `EXP-01-AC4`: 2 MiB/100 snapshots/10 symbols/100 ticks/100 calls 상한과 경계값 검증;
  ticks 배열 생성 전 상한 거절, session/random/AI mode·dynamic path 불허
- [x] `EXP-01-AC5`: module import/validation이 filesystem mutation·process spawn·network/AI/broker 호출 0
- [x] `EXP-01-AC6`: 실제 source·시장·전략 선택이나 credential 없이 golden fixture를 검증 가능

예정 집중 검증: `npm run build && node --test dist/replay/paperExperimentInput.test.js`

로컬 구현 증거 (2026-10-02):

- `paperExperimentInput.test.ts` 79개와 기존 `replayRunManifest` 13개,
  `historicalReplayWorkflowPlan` 1개: build 후 93개 통과, 실패·skip 0
- 독립 검토에서 확인한 positive freshness, 파생 timestamp 범위, 유한 bps/volume 상한,
  명시적 riskTags 충돌 검증을 입력 계층에 보완하고 회귀 테스트를 추가
- exact 2 MiB/100 snapshots/10 symbols/100 ticks/100 calls와 초과 입력, tick 할당 전 거절 검증
- snapshot/object 순서·UTC 등가·정규화 JSON 재입력·freeze, cutoff/source/정책/version/identity 검증
- fresh process의 UTC/Asia-Seoul/America-New-York 및 hostile AI/live 환경에서 동일 hash;
  filesystem mutation·process spawn·network·wall clock·random 금지 spy와 함께 import/검증 통과
- fixture는 3 tick의 합성 데이터이며 코드 identity context도 unit-test 고정 값이다.
  실제 provider/runner/외부 source/AI/live 호출은 하지 않았다.

위 AC 체크는 입력 계약의 unit 수용 증거다. aggregate/full profile과 독립/current-head 검수,
원격 필수 check·보호 조건을 충족한 병합 결과는 실제 PR의 exact SHA 검증 기록을 따른다.
EXP-02~04 및 Trainer/SPOM 최종 AC를 완료로 바꾸지 않는다.

회귀: 기존 `replayRunManifest`, `historicalReplayWorkflowPlan` tests의 hash/config 의미 유지.
rollback: 새 contract/fixture와 export만 revert. 기존 저장소 migration 없음, 미완료 입력은 실행되지 않음.

## EXP-02. 입력 보존과 attempt 격리 저장

**목적:** 검증한 입력을 잃지 않고 한 attempt의 artifacts만 소유하며, 재시작 후 상태를 안전하게 읽는다.

- dependency: EXP-01 병합
- 포함: immutable input/source materialization, exclusive attempt directory, 얇은 lifecycle record,
  artifact path confinement/integrity reader, fresh-process reconstruction과 명시적 retry lineage
- 비범위: runner/CLI/API 호출, 일반 job queue/scheduler, 자동 resume/retry, shared portfolio·multi-bucket lease
- 예상 파일:
  - `src/storage/paperExperimentStore.ts`, `src/storage/paperExperimentStore.test.ts` (신규)
  - `src/storage/artifactPaths.ts` 및 해당 tests의 제한된 catalog/path 등록
  - `src/replay/paperExperimentInput.ts` (serialize/read 재검증에 필요한 공개 함수만)
- 계약: [설계 3~5절](technical-design.md#3-입력실행-식별과-artifact-계약); 동일 inputHash와 다른
  attempt identity, 입력·source 최초 기록 뒤 갱신 금지, existing dir는 상태 무관 reject

수용 기준:

- [ ] `EXP-02-AC1`: 새 process가 원래 source/env 없이 보존된 full input으로 같은 normalized config 복원
- [ ] `EXP-02-AC2`: 동일 attempt 동시 생성은 하나만 성공. 기존 파일·비어 있는 기존 dir도 변경 없이 충돌
- [ ] `EXP-02-AC3`: source/shared root/기존 attempt의 bytes 불변; traversal·symlink·ancestor overlap 거절
- [ ] `EXP-02-AC4`: materialized source와 inputHash 일치; 변조·부분 JSONL·누락은 incomplete/error;
  completed inventory 검증에서 complete-row 경계 truncation과 schema-valid report 변조도 탐지
- [ ] `EXP-02-AC5`: crash/write fault에서 completed 오판 없음. read/inspect는 어떤 상태도 자동 보정하지 않음
- [ ] `EXP-02-AC6`: retry는 새 attempt와 parentAttemptId만 생성, 원래 attempt append/resume/삭제 없음

예정 집중 검증: `npm run build && node --test dist/storage/paperExperimentStore.test.js`

테스트는 `mkdtemp` root와 child process를 사용하여 프로세스 메모리에만 의존한 보장을 배제한다.
fs error injection은 directory 생성/input write/state replace/read 시점에 각각 적용한다.
rollback: 신규 writer를 되돌리고 기존 attempt는 보존. reader 지원이 없어도 old runtime이 새 directory를
자동 소비하지 않는다. 저장 데이터를 지우거나 이전 공유 저장소로 합치는 migration은 하지 않는다.

## EXP-03. 격리된 fixture runner와 CLI

**목적:** EXP-02의 attempt에서 기존 single historical workflow를 한 번 실행하고 검증 가능한 결과를 남긴다.

- dependency: EXP-01, EXP-02 병합
- 포함: normalized input→workflow options adapter, 기존 deterministic provider, bounded preflight,
  outer lifecycle/failure boundary, `validate/run/inspect/retry` CLI와 integration tests
- 비범위: batch wrapper·bucket queued record 실행, API/dashboard route, cooperative cancel/resume,
  AI/Codex CLI/provider 추가, 기존 simulation API의 cost/benchmark wiring 수리
- 예상 파일:
  - `src/workflows/paperExperimentWorkflow.ts`, `src/workflows/paperExperimentWorkflow.test.ts` (신규)
  - `src/cli/paperExperiment.ts`, `src/cli/paperExperiment.test.ts` (신규)
  - 필요한 기존 manifest payload helper의 최소 추출 및 대응 tests
  - `package.json`에 `paper:experiment` script와 그 entry point의 build identity 결속 helper,
    `docs/runbooks/paper-experiment.md` (신규)
- 계약: [설계 4~5절](technical-design.md#4-저장-격리와-실행-adapter); fresh replay dir만 사용,
  Risk/engine 계산 재사용, 외부 AI 호출 0, completed와 evidence quality를 분리

수용 기준:

- [ ] `EXP-03-AC1`: 고정 fixture가 기존 packet→decision→Risk→fill→report 경로로 완료됨
- [ ] `EXP-03-AC2`: test-only static provider/fixture 변형으로 HOLD·Risk denial·no-candidate·provider failure
  각각 구분. static 결정에도 기존 schema/semantic/candidate scope/Risk가 적용되고 잘못된 fill 없음
- [ ] `EXP-03-AC3`: 요청 cost/policy와 runner options·manifest hash·실제 비용 결과가 대응;
  defaults를 실행 시 재선택하지 않음; backend-observed HEAD/lock hash/Node version을 보존하고
  요청·실행 identity 불일치 및 stale/unbound compiled dist 거절
- [ ] `EXP-03-AC4`: runner/manifest/progress/audit 시작·완료·검증 fault가 failed/incomplete로 남음;
  부분 report만으로 completed를 만들지 않음; terminal inventory digest/count와
  report/log 간 counts 검증 후에만 completed 기록
- [ ] `EXP-03-AC5`: 기존 portfolio sentinel이 있는 dir는 runner 0회, source·기존 attempt 불변;
  다른 output에 동일 입력을 재실행해 semantic 결과 및 기존 manifest hash가 동일
- [ ] `EXP-03-AC6`: hostile env의 AI/live enable 값으로 provider가 바뀌지 않음;
  provider subprocess/외부 network/broker 호출 0 (검증된 code identity의 fixed-argv Git 조회 및
  CLI를 실행하는 테스트 child process와 구분)
- [ ] `EXP-03-AC7`: unsupported cancel 명령은 mutation 없이 실패. SIGINT/강제 종료 후 partial artifacts
  보존, fresh-process inspect가 성공으로 오판하지 않고 retry는 새 attempt만 사용

예정 집중 검증:

```sh
npm run build
node --test dist/workflows/paperExperimentWorkflow.test.js dist/cli/paperExperiment.test.js
```

기존 `historicalReplayWorkflow`, `historicalReplayWorkflowPlan`, `codexHistoricalReplayRunner`,
Risk/execution/manifest 관련 tests는 `check:review` 영향 분석 및 최종 full profile로 검증한다.
negative provider는 테스트 주입만 허용하며 production config가 임의 executable을 고르는 surface는 없다.

예정 사용자 명령 계약 (현재 존재하지 않음):

```sh
npm run paper:experiment -- validate --input src/replay/fixtures/paper-experiment.v1.json
npm run paper:experiment -- run --input src/replay/fixtures/paper-experiment.v1.json
npm run paper:experiment -- inspect --attempt <returned-attempt-id>
npm run paper:experiment -- retry --attempt <returned-attempt-id>
```

`run`은 backend-allocated ID와 artifact root를 반환한다. CLI 입력에서 output dir/provider/model/raw
command를 받지 않는다. cancel/resume 미지원·Ctrl+C 중단 한계는 실행 전 help/runbook에 표시한다.
rollback: 새 entry point/adapter만 revert, 기존 engine/version과 artifacts 유지. retry로 원래 artifact를
덮어쓰지 않으며 새 형식을 모르는 old CLI는 fail-closed 한다.

## EXP-04. 근거 검토 보고서와 반복 비교

**목적:** 실행 결과를 입력·정책·Risk·비용·한계에 연결하여 사용자가 다음 질문을 정할 수 있게 한다.

- dependency: EXP-03 병합
- 포함: read-only review projection, 한국어 JSON/Markdown 보고서, CLI `review`와 선택적 동일 조건
  attempt 비교, 완성된 CLI end-to-end acceptance tests/runbook 예시
- 비범위: AI 요약·자유형 채팅·전략 추천, 새 benchmark/cost/통계 계산, UI/API·multi-bucket 확장
- 예상 파일:
  - `src/reports/paperExperimentReview.ts`, `src/reports/paperExperimentReview.test.ts` (신규)
  - `src/cli/paperExperiment.ts`, `src/cli/paperExperiment.test.ts`
  - 기존 report/audit/manifest reader 재사용, `docs/runbooks/paper-experiment.md`, Trainer evidence map
- 계약: [설계 6절](technical-design.md#6-결과-검토-계약); source claim→artifact field 연결,
  unavailable/incomplete/null 유지, inputHash와 manifest hash의 역할 구분

수용 기준:

- [ ] `EXP-04-AC1`: 질문·범위·입력→각 행동/거절/HOLD/skip→정책/비용/결과 근거가 추적됨
- [ ] `EXP-04-AC2`: 기존 cashOnly 기준선과 cost breakdown을 정확히 읽음;
  equal-weight/initial-hold의 무비용·packet 표본 차이, synthetic/calendar/FX/통계 한계 표시
- [ ] `EXP-04-AC3`: missing/corrupt/hash mismatch·provider failure를 0 또는 성공으로 표시하지 않음;
  진행 중/중단 실행도 partial evidence와 stored state를 구분해 검토 가능
- [ ] `EXP-04-AC4`: 같은 inputHash/코드 기준의 두 attempt는 허용된 identity/path/timing만 제외해 비교;
  비용·Risk·dataRefs/coverage 차이는 불일치, backend runtime identity/lock hash/Node 불일치와
  다른 입력 조건은 성과 순위 대신 incomparable; caller의 revision 자기 선언만으로 비교 허용하지 않음
- [ ] `EXP-04-AC5`: report가 attempt 밖 경로를 열거나 source/replay artifacts를 바꾸지 않음;
  재생성도 review 산출물만 별도 안전하게 작성하고 원본 evidence 불변
- [ ] `EXP-04-AC6`: CLI validate→run→inspect→review→retry→compare를 빈 root에서 수행;
  별도 root의 동일 실험 semantic 결과 일치와 실패 시나리오를 full gate에서 확인
- [ ] `EXP-04-AC7`: TR-MVP 증거는 공급한 범위만 갱신. AI·실제 전략·cooperative cancel·사용자 학습
  수용 미검증을 숨기거나 기존 TR-MVP/SPOM 최종 체크박스를 일괄 완료하지 않음

예정 집중 검증:

```sh
npm run build
node --test dist/reports/paperExperimentReview.test.js dist/cli/paperExperiment.test.js
```

예정 명령: `npm run paper:experiment -- review --attempt <id> --compare-attempt <other-id>`.
두 번째 ID는 선택이다. Markdown의 투자 권유·수익 보장·실거래 적합 표현 부재와 evidence 링크를
snapshot/구조 assertion으로 검사한다. 보고서가 기존 outcome의 숫자를 다시 계산하지 않는지 검토한다.
rollback: review entry point/projection만 revert. 실행/input/legacy report는 그대로 읽을 수 있고 삭제하지 않음.

## 단계 간 완료 증거

각 PR 본문에 purpose/non-goals, 실제 changed paths, 해당 AC 결과, exact SHA의 validation logs,
독립 검토 finding 처리, 남은 제약과 다음 dependency를 기재한다. 최종 runbook에는 구현 후 실제로
실행한 command, Node/코드 기준, 입력·output 식별자, 결과 비교·negative test 증거를 기록한다.
실제 source fetch·Codex CLI·AI·live 거래 미실행 사실도 명시한다.

EXP-04까지의 완료는 fixture engineering slice의 완료다. cooperative cancel, 실제 전략·시장·source
선택, 실제 AI provider 비교, dashboard/API는 자동으로 시작하지 않고 필요성·권한·안전 의존성을
다시 검토한 다음 기능 계획으로 분리한다. 실제 시장 선택이 없다는 이유로 EXP-01을 막지 않는다.

## 문서 PR 검증 기록

기획·설계·source 대조와 문서 검증 결과는 이 절에 기록한다. 게시·병합 상태는 원격 PR의
실제 current head/check/review 결과를 따른다. 이 절은 구현 네 PR의 통과 증거가 아니다.

2026-10-02 문서 검증:

- `origin/main`을 fetch하여 baseline `bc1423bd992171cf86b5c5d288e9c1c915cc2333` 확인
- 변경 6개 모두 `docs/` Markdown. production, test/fixture, schema, dependency, 설정 diff 없음
- 변경 문서의 상대 링크/anchor 142개와 baseline 고정 source path/line range 23개 검사 통과
- 기존 `TR-MVP` 8개 및 `SPOM-AC` 12개 문장·순서·미완료 상태 보존 검사 통과
- `git diff --check` 통과
- 초안 `6905e63`의 `npm run check:review` 통과 (Node v24.19.0, Linux x64)
  - build/quality 통과, tooling tests 23 통과, `changed=6 mode=none tests=0` (docs-only)
  - 애플리케이션 전체 suite 통과 증거가 아님
- source 독립 검토에서 실제 runtime identity와 완료 artifact 무결성 경계를 보완
  - caller revision 자기 선언과 stale compiled dist를 실제 코드 증거로 사용하지 않음
  - complete-row JSONL truncation과 schema-valid report 변조를 terminal inventory로 검사하도록 설계
- 의존성은 동일 `package-lock.json`을 확인한 기존 checkout에서 새 isolated checkout으로 복사;
  원래 checkout/lockfile을 수정하지 않음

simulation, Codex CLI, 외부 AI/source 호출, 실제 거래는 실행하지 않았다. 문서 외 구현도 없다.
최종 후보의 full check·current-head review·원격 필수 check·게시/병합 결과는 해당 PR의 검증
기록으로 확인한다. 이 문서의 계획과 초기 review-profile 통과를 최종 merge 완료로 읽지 않는다.
