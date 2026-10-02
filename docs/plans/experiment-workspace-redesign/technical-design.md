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
4. 기존 runner가 비용/benchmark/universe 선택을 지원하면 명시적 전달과 결과 provenance를 검증한다.
   지원하지 않으면 서버에서 그 선택을 거부하고 effective default/미지원 의미를 정확히 보존한다.
   화면만 값을 숨겨 API의 silent ignored input을 정당화하지 않는다.
5. 저장 PortfolioPolicy, 단일 bucket 실제 실행, CLI EXP 입력은 실제 adapter와 tests 전까지 실행 옵션이 아니다.
6. validation-only endpoint가 없으면 새 작은 계약을 먼저 추가한다. GET 페이지 로딩/단계 이동이
   실행을 시작하면 안 된다. preflight는 실행 가능성을 보장하지 않으며 source unavailable을 별도 분류한다.
7. 실행 응답 ID를 그대로 read에 사용한다. 서버가 반환하는 legacy `activeUrl`을 Next route처럼 사용하지 않는다.
8. `accepted` 뒤 아직 manifest가 없으면 ‘접수됨 · 실행 기록 대기’이며 완료·실패·running을 추정하지 않는다.

현재 runner promise rejection은 요청 자체의 응답과 분리된다. 생성 직후 runner가 manifest 전에
실패한 경우 증거를 남기는 작은 API 개선을 UX-02에 포함할지 source tests로 판정한다. UI timeout으로
failed를 만들어내지 않는다. 실제 오류 기록 API가 없다면 ‘상태를 확인할 수 없음’과 마지막 관측을 보인다.

## 상태 모델

| 구분 | 예 | UI 의미 |
| --- | --- | --- |
| 요청 | idle / validating / submitting / accepted / rejected / response_unknown | browser 요청 lifecycle, runner 상태 아님 |
| 실행 `run_state` | queued / running / completed / completed_with_failures / failed / skipped / missing | 원본 artifact 계약에서만 취함 |
| fetch wrapper `status` | ok / offline / invalid | HTTP/네트워크·payload guard 결과, 실행 생존/성공 아님 |
| endpoint `status` | ok / running / missing / blocked / degraded | `/batch/replay/runs` 원본 상태, wrapper와 별도 보존 |
| 자료 판독 조건 | available / missing / blocked / degraded / unavailable | endpoint·corruptLineCount·개별 artifact 결과를 보존 |
| 관측 | fetchedAt / heartbeatAt / artifactUpdatedAt | 각각 자료 조회·실행 heartbeat·원본 갱신 시각 |
| 결과 완전성 | complete / partial / missing / unsupported | 완료된 실행도 결과 일부가 빠질 수 있음 |

`run_state`는 UI adapter상의 개념명이며 기존 서버 field를 근거 없이 rename/migrate하지 않는다.
`completed_with_failures`는 부분 실패이며 성공 완료로 합치지 않는다. 완료/실패/skip 건수를 함께 표시한다.
끝난 실행의 오래된 timestamp는 그대로 표시한다. 갱신 지연은 마지막 관측 이후의 경고일 뿐
생존·중단 증거가 아니다. 알려진 총량이 있을 때만 `processed/total`을 표시하며 total=0과 missing을 구분한다.

## 데이터 읽기·오류·history

목록은 우선 기존 `GET /batch/replay/runs` 범위만 사용한다. 현재 기본 응답은 최신 manifest의
run 목록이며 `totalCount`도 해당 batch 내부 건수다. 따라서 ‘최신 batch의 실행 N개’로 표시하고
‘전체 실험’ 건수나 검색처럼 표현하지 않는다. 여러 batch의 안정적인 목록을 요구하는 경우
명시적 cursor/source contract를 별도 최소 backend PR로 먼저 추가한다. 파일시스템을 browser에서 열지 않는다.

기존 Risk/audit/validation ViewModel은 전체 storage 기준이며 runId로 한정하지 않는다.
Fallback 링크에는 ‘전체 운영 기록’이라고 쓰고 선택 실행의 근거인 것처럼 붙이지 않는다.
UX-05의 run-scoped read-model은 record별 명시적 참조와 source run identity를 모두 검증한다.

### 목록 adapter: activeRun 결합과 source 상태

`runs`는 이미 append된 개별 실행 기록이며 진행 중인 실행은 manifest의 `activeRun`으로 따로
온다(`src/api/localOperationsReaders.ts:263–305`). 다음 규칙을 UX-01의 순수 adapter에서 검증한다.

1. 반환된 batchId와 결속된 activeRun의 runId/필수 필드를 검증한다. 임의 ID를 만들지 않는다.
2. `batchStatus=running`이고 유효한 activeRun이 있으면 runs와 runId 기준으로 결합한다.
3. 같은 runId의 terminal record가 도착하면 그 기록을 우선하고 active 항목을 제거한다.
   한 실행을 running+completed 두 줄로 표시하거나 active 값으로 terminal 결과를 덮지 않는다.
4. terminal batch에 activeRun이 남거나 ID가 모순되면 불일치 경고다. 가짜 running을 추가하지 않는다.
5. count/totalCount/statusCounts는 원래 저장 기록의 값이다. 표시 목록에 active 1개를 추가했다고
   서버 전체 건수처럼 바꾸지 않고 ‘저장된 N개 · 진행 중 1개’ 등 범위를 분리한다.

fetch wrapper와 endpoint 상태는 다음처럼 구분한다. endpoint 값을 wrapper union으로 검증해
정상 running을 invalid로 바꾸지 않는다.

| 입력 | 화면 판독 조건 | 실행 상태 처리 |
| --- | --- | --- |
| wrapper offline | 통신/HTTP 오류, 최근 조회 시각 표시 | 이전 원본 상태가 있으면 마지막 관측으로만 보존 |
| wrapper invalid | payload 계약 불일치 | 확인하지 못한 payload로 상태를 추정하지 않음 |
| wrapper ok + endpoint ok | 판독 가능 | 각 record의 상태만 사용 |
| wrapper ok + endpoint running | batch 진행 관측 | 유효 activeRun을 결합; 모든 row를 running으로 바꾸지 않음 |
| wrapper ok + endpoint missing | source/run index 미관측 | 신규 accepted의 실패나 0건 성공으로 바꾸지 않음 |
| wrapper ok + endpoint blocked | 허용 artifact 경계에서 조회 차단 | 대체 경로 우회 없이 이유를 표시 |
| wrapper ok + endpoint degraded | 일부 기록 손상/불완전 | 검증된 항목만 partial로 표시, 누락을 0으로 바꾸지 않음 |
| 어떤 endpoint 상태든 corruptLineCount > 0 | 판독 경고/degraded를 함께 보존 | top-level running이 손상 진단을 숨기지 않게 함 |
| 알 수 없는 endpoint 상태 | adapter contract 불일치 | 임의 정상/완료로 매핑하지 않음 |

batchStatus, endpoint status, wrapper status, 개별 run_state와 개별 artifact 판독 상태를 하나의
배지로 합치지 않는다. UX-01 검증 fixture는 empty running batch/active-only/terminal 전환 중복,
missing/blocked/degraded/unknown endpoint, offline/invalid wrapper, running+corruptLineCount를 포함한다.

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
