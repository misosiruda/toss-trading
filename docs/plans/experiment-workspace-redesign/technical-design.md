# 실험 워크스페이스 기술·화면 설계

기준 `main d954915` · 2026-10-02 · 구현 전

## 재설계 시작 시점에 확인한 코드 (`d954915`)

- `src/api/paperSimulationRuns.ts`: `POST /paper/simulations`는 guarded config를 파싱하고
  비동기 runner를 시작한다. `accepted` 응답과 runner 결과는 다르다. API의 `costModel`과
  `benchmarkPolicy`는 현재 schema에 있으나 `runHistoricalBatchReplay` 옵션에 전달되지 않는다.
  `universe.preset`도 runner에 전달하지 않으며 `universe.market`은 allocation target 용도다.
  종목군 선택/시장 필터가 실제 적용됐다고 표시하면 안 된다. 날짜만 입력하면 +09:00으로 해석한다.
- `apps/dashboard/src/app/dashboard/lab/policies/PolicyBuilderForm.tsx`: PortfolioPolicy 검증 hash를
  seed로 사용하는 고정 balanced/2024/1천만원/fixture-decision config. 정책 artifact 직접 적용 아님.
- `src/api/strategyBucketTestRuns.ts`: 검증 후 queued record와 audit 저장. `runId=null`,
  `replayRunnerStarted=false`. 실제 실행 또는 진행 상태로 승격 금지.
- `apps/dashboard/src/lib/dashboardViewModels.ts`: schema guard·unavailable handling·batch/run 조회 재사용.
- `apps/dashboard/src/app/dashboard/lab/runs/[runId]/page.tsx`: 요청 ID가 batch 또는 run일 수 있으며
  selectedRun/manifest activeRun fallback을 사용한다. run과 batch identity를 UI에서 구별한다.
- `src/api/localOperationsSurface.ts`, `dashboard/index.html`: legacy-only 화면/route 보존 대상.
- EXP-01~04의 fixture CLI와 historical simulation API는 다른 실행 계층이다.

위 내용은 시작 시점의 코드 관찰이며 새 UI 실행 검증 또는 데이터 가용성 확인을 뜻하지 않는다.

### 현재 반영된 UX-02a (`492afe9`, PR #797)

[입력·실효 조건 계약](../../contracts/paper-simulation-config.md)이 병합됐다. validation-only API와
create/runner의 shared effective config가 추가됐으며 `high_cost`/`cash_only`는 미지원 400이다.
preset 문자열과 kr/us allocation은 호환 유지하면서 preset/market filter 미적용을 명시한다.
존재하지 않는 ISO 달력 날짜의 rollover도 차단한다. 이 변경은 UI 연결이나 PortfolioPolicy 적용,
데이터 가용성, accepted 이후 실패 관측을 완료한 것이 아니다.

### 현재 반영된 UX-02b (`9235ab7`, PR #798)

[접수·runner 실패 관측](../../contracts/paper-simulation-observations.md)이 병합됐다.
접수 사실을 runner 시작 전에 저장하고, runner promise rejection은 고정 이유의 batch 범위
관측으로 남긴다. exact simulation ID 조회에는 manifest 없이도 `simulationObservation`이
추가된다. accepted-only는 unknown이며 기존 child run 상태·결과를 변경하지 않는다.
UI 연결·heartbeat·scheduler·자동 복구는 구현하지 않았다. 아래 UX-03/04 mapping이 이 API를 사용한다.

## 기존 기능 이전표

기존 경로는 migration 동안 직접 열 수 있어야 한다. 새 menu가 예전 page를 감싸는 경우
heading/landmark를 중복 만들지 않는다. Next route는 3000, legacy는 8787 기본 origin으로 서로 다르다.
배포 rewrite가 없으므로 `/dashboard/virtual`을 Next 내부 Link로 연결해 404를 만드는 방식은 금지한다.

| 기존 화면/기능 | 신규 위치 | 이전 중 보존 방법 |
| --- | --- | --- |
| Next `/dashboard`의 portfolio·Risk·validation·strategy panel | 실험 기본 화면, 역할별 아래 위치 | 기존 종합 화면을 별도 명시적 ‘기존 운영 요약’ route로 보존 |
| `/dashboard/portfolio` | 전략·정책 → portfolio compliance | 기존 route 유지 |
| `/dashboard/lab/policies` | 전략·정책 → 정책 편집 | 기존 validation/create 유지, policy seed 실행 제한 설명 |
| `/dashboard/lab/strategy-tests` 및 bucket new | 전략·정책 → bucket 테스트 | queued-only 문구/실제 상태 그대로 보존 |
| `/dashboard/lab/runs/[runId]` | 실험 상세 canonical route | 기존 URL 유지 또는 exact ID 보존 redirect |
| `/dashboard/risk-gate` | 실험 근거 + 설정 → 전체 Risk 조회 | 전체 read-only route 유지 |
| `/dashboard/validation` | 데이터 → 검증 결과 | 기존 route 유지 |
| `/dashboard/audit` | 설정 → 전체 운영 기록 | 기존 route 유지 |
| `/dashboard/live-readiness` | 설정 → 진단 | live disabled·read-only 상태 유지 |
| `/dashboard/component-catalog` | 설정 → UI catalog | 개발 검증 route 유지 |
| legacy `/dashboard/virtual` 및 simulations | 실험의 현재/이력·생성 | 검증된 legacy origin의 ‘호환 화면’ 링크, silent same-origin 가정 금지 |
| legacy `/dashboard` 내부 live readiness panel | 설정 → 진단 자료 | Next 차이를 설명하는 호환 경로 |
| legacy 자산곡선·benchmark·비용·보유·거래·판단 | 실행 상세 / portfolio compliance | payload/identity 검증 후 점진 이전, 미이전은 호환 화면 |
| legacy 시장·섹터·event coverage, packet | 데이터 / 판단 근거 | source detail read-only 보존 |
| legacy 목표·소득·daily/research/batch report | 전략·정책 / 실험 기록 | 기존 read-only 자료 접근 경로 유지 |
| 기존 runbook 문서와 diagnostics 자료 | 설정 | 문서 링크와 실제 panel 위치를 구별해 출처·접근 조건 안내 |

호환 링크는 public browser에 내부 API endpoint/비밀 토큰을 노출하는 proxy가 아니다. 서버 환경에서
operator용으로 명시 설정·검증된 URL만 링크로 사용한다. 값이 없으면 URL을 추측하지 않고 기존
runbook의 local URL과 접근 조건을 텍스트로 안내한다. 사용자 입력 임의 URL, credentials 포함 URL,
`javascript:` scheme 등은 허용하지 않는다. 토큰은 query, URL, localStorage에 넣지 않는다.

## 컴포넌트와 route 경계

기존 Next 16/React 19/App Router/Tailwind 4를 유지한다. 새 framework/dependency는 불필요하다.

- `DashboardShell`: desktop nav + mobile navigation + main skip link. canonical menu active state.
- `WorkspacePageHeader`, `StatusLabel`, `SourceObservation`: 제목, 실행 상태, 관측 상태를 별도 렌더링.
- `ExperimentList`: 서버 read 결과를 전달받아 client 필터. 모바일 목록과 desktop table의 동일 자료.
- `ExperimentWizard`: 단계·입력·검증 lifecycle. mutation route handler를 통하지 않은 API 호출 없음.
- `RunWorkspace`: summary/replay/evidence/record subroute 또는 URL tab. tab URL 공유·history 보존.
- 기존 `PolicyBuilderForm`, bucket form/progress, Risk/validation panel은 목적별 route에 유지.
- 파서/format/state selector는 `src/lib/` 순수 함수, 네트워크 read는 기존 ViewModel 계층을 확장.
- mutation token은 기존 same-origin guarded BFF 계약을 유지한다. client가 입력한 credential을
  저장/로그/생성 report에 포함하지 않는다. runtime secret 설정 변경은 이 UI 작업 밖이다.

초기 canonical 목록은 `/dashboard`, 새 생성은 `/dashboard/experiments/new`, 기존 상세는
`/dashboard/lab/runs/[runId]`를 사용한다. 새 menu index는 실제 구현된 목적지로만 연결한다.
추가 경로명은 기능 PR에서 확정하며 old deep link coverage를 테스트로 고정한다.

## 실행 요청의 사실성 계약

초기 wizard의 판단 provider는 `dry_run_fixture`로 한정한다. 이는 입력 가격 데이터가 합성이라는
뜻이 아니다. UI는 `sourceDataKind`와 `decisionProvider.mode`를 다른 필드로 표시한다.
source 종류/coverage를 확인할 수 없으면 ‘자료 종류 미확인’이며 path 문자열만으로 판정하지 않는다.

1. 서버가 허용된 선택과 고정값, 미지원 이유를 정의한다. frontend label을 capability 증거로 삼지 않는다.
2. source/기간/step/capital/risk/exit/provider/비용/benchmark의 requested→effective 대응을 명시한다.
3. schema가 값을 허용해도 runner가 적용하지 않는 값은 UI 지원 목록에 포함하지 않는다.
4. 현재 비용 `high_cost`와 benchmark `cash_only`는 서버에서 400으로 거부한다.
   `universe.preset`은 호환 metadata, `universe.market`은 allocation target으로 유지하며
   종목군/시장 필터 적용으로 표시하지 않는다. validation의 effective config/notices를 확인한다.
   미래의 새 실행 선택은 전달·결과 provenance를 검증한 별도 기능 PR 뒤에만 노출한다.
5. 저장 PortfolioPolicy, 단일 bucket 실제 실행, CLI EXP 입력은 실제 adapter와 tests 전까지 실행 옵션이 아니다.
6. 기존 `POST /paper/simulations/validate`를 사용한다. GET 페이지 로딩/단계 이동이
   실행을 시작하면 안 된다. 이 validation은 자료 존재·coverage나 실행 성공을 확인하지 않으며,
   실제 source unavailable은 별도 실행/조회 증거로 분류한다.
7. 실행 응답 ID를 그대로 read에 사용한다. 서버가 반환하는 legacy `activeUrl`을 Next route처럼 사용하지 않는다.
8. `accepted` 뒤 exact simulation ID로 UX-02b의 `simulationObservation`을 읽는다.
   `available/unknown`만 있으면 접수 사실만 표시하고 생존·완료를 추정하지 않는다.
   `available/runner_failed`가 있으면 manifest 유무와 별개로 runner 실패 관측을 표시한다.

### 최종 확인과 생성 제어

실제품의 최종 단계는 검증 응답의 전체 `requestedConfig`, `effectiveConfig`, `notices`를 열람할 수 있게 한다.
기본 화면에는 핵심 6–8개 조건 묶음과 중요한 변경·정규화·미지원 경고를 먼저 보이고, 전체 조건과
원문은 접근 가능한 접힌 검사로 제공한다. 모든 필드를 처음부터 펼쳐 검토 흐름을 압도하지 않는다.
runType·정규화된 runCount·window/timezone·stepSeconds·호출 한도·provider·constraints·riskPolicy·
allocationPolicy·exit·cost·benchmark·tickDelayMs와 `sourceDataKind`/`dataAvailabilityChecked`를
생략하지 않는다. 정상 응답이어도 single replay 횟수나 fixture Codex 한도가 요청과 달라질 수
있으므로 차이를 드러내고 확인해야 한다. source 종류 unknown과 가용성 미검증은 valid와 별개다.

생성 행동은 현재 typed candidate와 동일한 입력 identity/version에 대한 최신 validation 응답이
성공하고 그 실효값·notices가 최종 단계에 표시된 뒤에만 활성화한다. 입력이 바뀌면 이전 응답을
즉시 무효화하고 생성은 다시 막는다. 요청 identity가 다른 늦은 응답을 채택하지 않으며, 원래
확인한 입력과 다른 body를 생성에 보내지 않는다. browser에서 backend의 실효값 정규화를
재구현하지 않는다. validation은 runner 시작이나 source 가용성 보장이 아니다.

### HTML 시안의 명시적 비목표

이 문서의 `wireframes.html`은 validation API와 create API에 연결하지 않는다. 3단계는 다음
두 자료를 서로 다른 이름과 영역으로 보여준다.

- 현재 양식은 모든 요청 필드를 갖춘 **raw 초안**이다. 숫자도 편집 중 문자열로 보존하며 typed
  API 요청·검증된 requestedConfig로 표현하지 않는다. 기본은 핵심 8개 묶음과 미검증·정규화·필터
  경고이며 전체 29조건의 요청→미조회 비교는 접어서 제공한다. 모바일은 한 열 목록으로 보인다.
  effectiveConfig/notices/sourceDataKind는 미조회로 남긴다.
  양식을 바꾸면 초안만 갱신되고 ‘입력 변경됨 · 미검증’을 유지한다.
- [고정 서버 응답 원문](validation-response.example.json)은 문서 작성 시 별도 합성 입력으로
  `validatePaperSimulationCandidate(config, {})`를 실제 호출한 결과다. 입력과 생성 모듈·source
  commit/hash·빈 env는 시안에서도 확인할 수 있다. single_replay의 runCount 3→1,
  fixture maxCodexCallsPerRun 31→0을 포함한 전체 실효값과 notices를 보존한다. 고정 예시는 별도
  닫힌 구획에 두고, 펼치면 해당 예시의 경고와 requested→effective 전체 비교를 열람한다.
  constraints/riskPolicy/allocationPolicy 전체와 각 JSON 원문은 마지막의 접힌 검사에 둔다.
  현재 양식값의 검증 결과가 아니며 양식 변경에
  따라 다시 계산하지 않는다.

고정 예시의 sourceDataKind는 unknown, dataAvailabilityChecked와 replayRunnerStarted는 false다.
문서 작성 시 pure resolver만 실행했으며 source 자료 조회·runner·외부 AI 호출을 하지 않았다.
시안 browser는 이미 포함된 JSON을 표시할 뿐 새 검증 요청을 보내지 않는다. ‘결과 시안 보기’는
기존 합성 결과 화면으로 이동하는 preview이며 실행 CTA가 아니다. 실제 생성 제어와 validation
오류·변경 입력 identity 검증은 후속 production UI PR에서 구현·검증한다.
고정 예시 구획은 문서 검토 전용이며 생산 화면에 복사하지 않는다. 실제 UI는 현재 입력에 대한
검증 대기·오류 또는 요청/실효 비교 상태 하나를 표시하고, 전체 원문 검사는 마지막에 둔다.
시안의 3단계는 중복 입력 요약 aside를 숨기고 이전 단계로 돌아가면 복구한다. 390×844의 기본
확인 범위를 1–3화면 안에 두는 것을 시각 검증 목표로 삼되, 중요한 경고를 숨겨 높이만 줄이지 않는다.

UX-02a의 [입력 계약](../../contracts/paper-simulation-config.md)과 UX-02b의
[접수·실패 관측](../../contracts/paper-simulation-observations.md)은 main에 구현·병합됐다.
Runner promise rejection은 접수 응답과 분리된 batch 범위 관측이다. UI timeout이나 누락만으로
failed를 만들어내지 않으며 아래 관측 mapping과 기존 artifact 상태를 함께 보인다.

## 상태 모델

| 구분 | 예 | UI 의미 |
| --- | --- | --- |
| 요청 | idle / validating / submitting / accepted / rejected / response_unknown | browser 요청 lifecycle, runner 상태 아님 |
| 저장된 child run `runs[].status` | completed / completed_with_failures / failed / skipped | `BatchReplayRunStatus`의 네 값만 허용 |
| batch manifest 상태 | running / completed / completed_with_failures | child 상태가 아닌 `BatchReplayManifestStatus`; endpoint 판독 상태와도 구분 |
| active 표시 | running | `batchStatus=running`과 같은 batch의 유효한 `activeRun`에서만 파생 |
| 별도 bucket 테스트 | queued | strategy-bucket 저장 계약이며 replay run 목록의 상태가 아님 |
| 조회 부재·불확실성 | missing / unknown | endpoint/artifact 부재나 마지막 관측의 불확실성; 저장 run status가 아님 |
| fetch wrapper `status` | ok / offline / invalid | HTTP/네트워크·payload guard 결과, 실행 생존/성공 아님 |
| endpoint `status` | ok / running / missing / blocked / degraded | `/batch/replay/runs` 원본 상태, wrapper와 별도 보존 |
| 접수·runner 관측 | simulationObservation.status + outcome | exact simulation/batch ID의 관측이며 child run_state 아님 |
| JSON artifact 원본 판독 | ok / missing / corrupt | report/progress 등 JSON 읽기 결과를 해당 field에 보존 |
| JSONL artifact 원본 판독 | ok / missing / degraded | decisions/risk/trades 등의 줄 손상·개수를 함께 보존 |
| artifact 경로/guard 결과 | blocked / invalid | blocked는 경로 차단, invalid는 frontend payload guard의 계약 오류로 구별 |
| 파생 판독 표시 | available / unavailable 등 | 원본 판독 값의 UI 설명이며 서버 enum으로 검증하지 않음 |
| 관측 | fetchedAt / heartbeatAt / artifactUpdatedAt | 각각 자료 조회·실행 heartbeat·원본 갱신 시각 |
| 결과 완전성 | complete / partial / missing / unsupported | 완료된 실행도 결과 일부가 빠질 수 있음 |

원본 status와 화면 표시 상태를 하나의 허용 enum으로 합치지 않는다. 목록 adapter는 저장된
run과 manifest active 항목의 출처를 먼저 구별한 뒤 각각의 guard를 적용한다. 저장 record의
`running`/`queued`/`missing`/`unknown` 또는 기타 비허용 status는 계약 불일치로 표시하며,
값을 정상화해 유효한 실행 row로 받아들이지 않는다. endpoint가 해당 문자열을 전달하거나
statusCounts에 포함해도 저장 계약의 새 상태가 생기는 것은 아니다.

`batchStatus=null`은 batch 상태 미관측이고, 정상 세 값 이외의 문자열은 계약 경고다. Reader는
string/null을 그대로 전달할 수 있으므로 어느 쪽도 running/terminal로 추정하지 않는다.
이 경고 때문에 별도로 유효한 child terminal 기록을 지우지 않는다. activeRun 자체에는 batchId나
status가 없으므로 같은 응답의 검증된 manifest 문맥과 실제 child ID로 결속한다. batchStatus가
null/미인식이거나 batch identity가 확인되지 않으면 active running row를 만들지 않는다.

active 항목은 가짜 terminal record를 만들지 않고 manifest 관측으로 표시한다. child ID가
없으면 임의 ID로 row를 만들지 않는다. bucket queued는 전략·정책 화면에 남기며 실험 목록으로
섞지 않는다. missing은 해당 source/선택 실행이 없는 판독 상태다. unknown 예시는 이전에
확인한 ID의 현재 조회를 확인하지 못하는 화면 상태이며, API runs에 unknown record가 존재한다는
뜻이 아니다. 이전 row를 보존할 때에도 출처와 마지막 관측 시각을 함께 유지한다.

문서의 `run_state` 표현은 설명용 UI 용어이며 위 provenance 구분을 생략하는 서버 field나
통합 schema 이름으로 구현하지 않는다. 실제 서버 계약은 rename/migrate하지 않는다.
`completed_with_failures`는 부분 실패이며 성공 완료로 합치지 않는다. 개별 run은
`summary.aiDecisionFailureCount`와 남아 있는 summary/report, 근거의 누락·연결 상태를 표시한다.
완료/실패/skip 건수는 여러 실행을 집계하는 batch 문맥에서만 표시하며 개별 run의 결과로 쓰지 않는다.
끝난 실행의 오래된 timestamp는 그대로 표시한다. 갱신 지연은 마지막 관측 이후의 경고일 뿐
생존·중단 증거가 아니다. 제공되지 않은 heartbeat는 미관측이며 fetchedAt이나 artifact 갱신
시각을 heartbeat로 복사하지 않는다. 알려진 총량이 있을 때만 `processed/total`을 표시하며 total=0과 missing을 구분한다.

## 데이터 읽기·오류·history

목록은 우선 기존 `GET /batch/replay/runs` 범위만 사용한다. 최신 manifest와 반환 기록의 batch
결속이 확인된 경우에만 ‘최신 batch의 실행 N개’로 표시한다. manifest가 없거나 runsPath가 없으면
aggregate의 sourceRunsPath로 fallback할 수 있다. batch 문맥이 확인되지 않은 응답은
‘조회된 저장 기록 · batch 문맥 미확인’이며 전체 목록의 최신 batch를 추정하지 않는다.
`totalCount`도 선택한 source JSONL의 기록 건수이지 전체 실험 수가 아니다. 여러 batch의 안정적인
목록/검색이 필요하면 명시적 cursor/source contract를 별도 최소 backend PR로 먼저 추가한다.
파일시스템을 browser에서 열지 않는다.

기존 Risk/audit/validation ViewModel은 전체 storage 기준이며 runId로 한정하지 않는다.
Fallback 링크에는 ‘전체 운영 기록’이라고 쓰고 선택 실행의 근거인 것처럼 붙이지 않는다.
UX-05의 run-scoped read-model은 record별 명시적 참조와 source run identity를 모두 검증한다.

### 목록 adapter: activeRun 결합과 source 상태

`runs`는 이미 append된 개별 실행 기록이며 진행 중인 실행은 manifest의 `activeRun`으로 따로
온다(`src/api/localOperationsReaders.ts:263–305`). 다음 규칙을 UX-01의 순수 adapter에서 검증한다.

1. 반환된 manifest 문맥의 batchId와 activeRun의 실제 runId/필수 필드를 검증한다. activeRun에
   없는 batchId/status 필드를 요구하거나 임의 ID를 만들지 않는다. batchId 또는 batchStatus가
   null/미확인이면 active를 만들지 않는다. known batch에 record.batchId가 누락·불일치하면
   그 record를 해당 batch의 정상 row로 편입하지 않고 별도 불일치 진단을 보인다. 유효한
   원본 ID와 기존 exact detail 접근 경로는 보존하되, ID 자체가 불명확한 경우 링크를 만들지 않는다.
2. `batchStatus=running`이고 유효한 activeRun이 있으면 runs와 runId 기준으로 결합한다.
3. 같은 runId의 terminal record가 도착하면 그 기록을 우선하고 active 항목을 제거한다.
   한 실행을 running+completed 두 줄로 표시하거나 active 값으로 terminal 결과를 덮지 않는다.
4. terminal batch에 activeRun이 남거나 ID가 모순되면 불일치 경고다. 가짜 running을 추가하지 않는다.
5. count/totalCount/statusCounts는 서버가 반환한 source 기록 범위의 값 그대로 보존한다.
   UI guard 이후 표시 건수·제외 건수·active 건수는 별도다. active를 추가하거나 불일치 row를
   제외했다고 원본 집계값을 바꾸지 않는다. record의 검증된 batchId는 보존하되, fallback의
   개별 ID만으로 전체 목록이 최신 batch에 속한다고 결론내리지 않는다.

fetch wrapper와 endpoint 상태는 다음처럼 구분한다. endpoint 값을 wrapper union으로 검증해
정상 running을 invalid로 바꾸지 않는다.

| 입력 | 화면 판독 조건 | 실행 상태 처리 |
| --- | --- | --- |
| wrapper offline | 통신/HTTP 오류, 최근 조회 시각 표시 | 이전 원본 상태가 있으면 마지막 관측으로만 보존 |
| wrapper invalid | payload 계약 불일치 | 확인하지 못한 payload로 상태를 추정하지 않음 |
| wrapper ok + endpoint ok | 판독 가능 | 각 record의 상태만 사용 |
| wrapper ok + endpoint running | batch 진행 관측 | 유효 activeRun을 결합; 모든 row를 running으로 바꾸지 않음 |
| wrapper ok + endpoint missing | source/run index 미관측 | 이 값만으로 실패/0건 성공을 추론하지 않음; 별도 simulationObservation의 runner 실패는 아래 규칙대로 표시 |
| wrapper ok + endpoint blocked | 허용 artifact 경계에서 조회 차단 | 대체 경로 우회 없이 이유를 표시 |
| wrapper ok + endpoint degraded | 일부 기록 손상/불완전 | 검증된 항목만 partial로 표시, 누락을 0으로 바꾸지 않음 |
| 어떤 endpoint 상태든 corruptLineCount > 0 | 판독 경고/degraded를 함께 보존 | top-level running이 손상 진단을 숨기지 않게 함 |
| 알 수 없는 endpoint 상태 | adapter contract 불일치 | 임의 정상/완료로 매핑하지 않음 |

batchStatus, endpoint status, wrapper status, 개별 run_state와 개별 artifact 판독 상태를 하나의
배지로 합치지 않는다. UX-01 검증 fixture는 empty running batch/active-only/terminal 전환 중복,
missing/blocked/degraded/unknown endpoint, offline/invalid wrapper, running+corruptLineCount를 포함한다.
JSON/JSONL의 원본 판독 값과 UI available/unavailable 설명도 분리한다.
`latestRunArtifacts.status=ok`는 개별 report/progress/decision/risk/trade가 모두 온전하다는
뜻이 아니다. 각 field의 missing/corrupt/degraded와 손상 건수, blocked/guard invalid를 그대로
표시하고 이를 child 실행의 실패·성공으로 바꾸지 않는다.
검증에는 상위 artifact ok + 하위 JSON corrupt/missing, JSONL degraded, 경로 blocked,
미인식 하위 판독값의 guard invalid, batchStatus null/미인식 + 유효 child 결과를 포함한다.
또한 persisted-status 네 값의 양성 사례와 runs의 running/queued/missing/unknown 거부, 유효한
manifest active에서만 running 생성, child ID 없는 active 거부, bucket queued 미혼입, 조회 부재·
이전 관측 warning이 persisted 상태를 덮지 않는 사례를 source별로 검사한다. manifest 없음+
aggregate 저장 기록, manifest runsPath 없음+다른 batch fallback, known batch/record 불일치,
limit으로 잘린 count와 전체 source totalCount/statusCounts의 차이도 검사한다.

### UX-03/04: 접수 ID의 관측 mapping과 우선순위

`simulationObservation`은 endpoint 판독 상태와 독립적으로 검증한다. 생성 응답의
`simulationRunId=batchId`를 exact query ID로 사용하며, 개별 child runId와 합치지 않는다.
`available` 자료의 schemaVersion·identity·acceptedAt·outcome·runnerFailure는
[관측 계약](../../contracts/paper-simulation-observations.md)의 shape와 일치해야 한다.
관측의 두 ID는 조회한 simulation ID와 같아야 하며, endpoint의 batchId가 null이어도 이
일치는 검증할 수 있다. 다른 batch/child의 evidence를 현재 요청에 붙이지 않는다.
기존 child/legacy run ID는 이 관측의 대상이 아니다. 그 ID로 같은 endpoint를 읽어 반환된
관측 `invalid`를 유효한 child artifact 전체의 오류로 승격하지 않는다. batch 관측이 필요하면
검증된 simulation batchId로 별도 조회하며 child ID를 변형해 접수 ID를 만들지 않는다.

| 유효한 wrapper 응답의 관측 값 | 표시 | 금지되는 추론 |
| --- | --- | --- |
| null / 필드 없음 | 관측 요청 없음 또는 미지원으로 구별 | accepted/실패가 없다고 확정하지 않음 |
| available + unknown | acceptedAt의 접수 관측, 이후 실행 상태 미확인 | running/heartbeat/completed로 승격하지 않음 |
| available + runner_failed | runnerFailure.observedAt의 runner 실패 관측과 고정 reasonCode | child run을 모두 failed로 덮거나 batch 결과를 소급 삭제하지 않음 |
| missing | 접수 관측 원본 없음 | route ID나 missing만으로 접수/실패를 만들어내지 않음 |
| invalid / unavailable | 관측 자료 불일치 또는 판독 불가 | accepted prefix를 정상 근거처럼 복원하지 않음 |

우선순위는 하나의 통합 status가 아니라 근거별 표시 규칙이다.

1. wrapper offline/invalid이면 새 payload의 관측을 사용하지 않는다. 기존 확인 자료가 있으면
   마지막 관측임을 명시하고 fetchedAt과 원본 acceptedAt/observedAt을 구분한다.
2. wrapper ok에서 `available/runner_failed`를 확인하면 endpoint가 missing/blocked/degraded여도
   일반 ‘실행 기록 대기’ 문구보다 runner 실패 관측을 먼저 알린다. 예: index missing + failure
   관측이면 ‘runner 실패 관측 · 실행 index 없음’이며 가짜 running·빈 성공 결과가 아니다.
3. 같은 batch의 manifest/child run이 있으면 각 artifact의 원래 상태와 결과를 그대로 보존한다.
   완료·부분 결과와 runner rejection이 함께 있으면 batch 범위의 실패 관측과 child 결과를 병기한다.
   관측의 outcome을 child run_state나 결과 완전성 값으로 복사하지 않는다.
4. `available/unknown`은 더 구체적인 같은-ID manifest/child artifact 상태를 덮지 않는다.
   원본이 없을 때만 접수 이후 상태 미확인으로 설명한다. local 202의 접수 사실과 서버의
   missing/invalid/unavailable 관측도 별도다. 재조회 실패나 timeout은 runner 실패 증거가 아니다.
5. 최신 batch 목록에서 관측 조회 ID가 없으면 null이 정상이다. accepted batch를 가짜 child row로
   추가하지 않으며, UX-03/04의 exact-ID 상세에서 이 mapping을 적용한다. POST 자동 retry는 없다.

UX-03/04 테스트는 index missing + runner_failed, accepted-only unknown, manifest/child partial·terminal
결과와 batch failure 동시 존재, null/필드 없음, missing/invalid/unavailable, wrong-ID/잘못된
outcome shape, offline/invalid wrapper, 재조회 시 원본 관측 시각 보존을 포함한다. 기준 source는
`paperSimulationObservations.test.ts`의 before-manifest failure와 `paperSimulationObservation.ts`다.

공유 query에 filter와 selection을 보존한다. 새 query가 도착하면 이전 read 결과가 덮어쓰지 못하도록
request identity/AbortController를 사용한다. retry는 GET에만 제한적으로 제공하며 POST 자동 반복 금지.
화면/탭 이탈 시 polling 정리, 동일 run/tab 재진입 시 올바른 source 재조회, terminal 상태에서는
불필요한 polling 중단. offline·invalid panel은 해당 region에만 격리한다.

## 시각 시스템

시안은 [wireframes.html](wireframes.html)의 3화면과 responsive CSS로 검토한다. 모든 수치는
명확히 ‘설계 예시’이며 실제 연구 결과가 아니다. 실제 화면은 사용 가능한 API 결과로 대체한다.

- 배경 `#f7f8fa`, surface `#ffffff`, text `#191f28`, secondary `#4e5968`, border `#e5e8eb`
- accent `#3182f6`, text/button용 진한 blue `#1765d1`, focus `#005fcc`
- status: positive `#087f5b`, warning `#936400`, danger `#c92a2a`, 항상 텍스트 병기
- font: 기존 Geist + system Korean fallback, 제목 28/36px, section 18/28px, body 14–16/22–24px
- desktop sidebar 208px, main gutter 40px(1024에서는 24px), content max 1280px
- spacing 4/8/12/16/24/32/40, controls 44px 이상, radius 8–12px, shadow 최소화
- 아이콘은 보조이며 모든 주요 행동에는 텍스트. 외부 icon package 없이 단순 inline SVG 가능
- 모바일 breakpoint 768px 미만: 단일 column, nav는 접이식 menu, 표→목록, 차트/상세 순차 배치
- reduced-motion, visible focus, skip link, label/error association, aria-live의 과다 알림 방지

디자인 탐색은 Image Gen의 3개 데스크톱 concept에서 sidebar·표·2열 form·차트 중심 구조를
확인한 뒤 code-native 반응형 시안으로 구체화했다. 생성 concept의 미지원 정책 버전/비용/
bucket 예시는 채택하지 않았다. 구현 명세의 정본은 검증한 `wireframes.html`과 이 계약이며
이미지에 생성된 수치·문구가 backend capability를 추가하지 않는다.

### 시안의 검증 범위와 비목표

HTML 시안은 layout과 메뉴·목록 선택·단계 이동·tab·filter/history의 상호작용을 설명한다.
편집 가능한 필드는 요약 갱신을 보여주는 예시이며 production schema validation, 실제 생성,
runner/데이터 조회, 비교 계산, 시계열 replay를 구현한 것이 아니다. 화면의 확인 단계나 예시
결과를 유효한 실행 설정 또는 실제 결과로 해석하지 않는다. 생산 UI의 완료 기준은 각 기능 PR에서
API 통합·브라우저·접근성·시각 검증으로 충족해야 한다. 시안이 실제로 시연하는 navigation과
맥락 보존의 결함은 이 비목표 설명으로 숨기지 않고 회귀 검증과 함께 수정한다.

새 흰색/파란색 shell은 token으로 일관되게 적용하되 semantic danger/success를 덮어쓰지 않는다.
기존 페이지 안의 중복 header/nav는 점진적으로 정리하고 같은 기능 PR에서 접근성 회귀를 확인한다.

## 검증과 rollback

- 순수 unit: ID·query·state mapping, 0 vs missing, source/provider 분리, effective config.
- API/통합: 동일 run ID, 실제 runner 호출, 미지원 값, fail-closed guard, duplicate/unknown response.
- browser: 1440/1024/390px, desktop/mobile 목록, 단계 보존, back/forward, 반복 click,
  오류와 복구, 선택 inspector, URL deep link, keyboard, axe, console, horizontal overflow.
- fixture는 격리된 test data dir과 local mock/API를 사용한다. 실제시장 성과나 유료 AI를 검증했다고 보고하지 않는다.
- 개별 PR은 old route 유지로 rollback 가능. artifact 삭제·migration·branch protection 변경 없음.
- shared layout 변경이 모든 page에 영향을 주므로 기존 전체 dashboard E2E/a11y를 포함한다.
