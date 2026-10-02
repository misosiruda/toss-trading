# Toss Trading Dashboard

paper-only 운영 화면을 제공하는 Next.js App Router 대시보드입니다.
기존 Local Operations API의 정적 `/dashboard`는 migration 기간 동안 legacy compatibility 화면으로 유지됩니다.

기본 operator URL은 `http://127.0.0.1:3000/dashboard`입니다. Local Operations API의 `http://127.0.0.1:8787/dashboard`는 local/internal legacy compatibility 확인에만 사용합니다.

## 범위

- live trading 비활성화 상태와 준비 상태를 표시합니다.
- backend 동작은 변경하지 않습니다.
- live order, broker mutation, raw `codex exec`, raw `tossctl` 인터페이스를 노출하지 않습니다.
- Local Operations API에서 read-only backend ViewModel 데이터를 읽어 화면에 표시합니다.
- 사용할 수 없는 ViewModel read는 해당 dashboard panel의 상태로만 격리합니다.
- `/dashboard/lab/policies`에서 paper-only `PortfolioPolicy` draft를 구성하고 local/backend validation 결과와 JSON preview를 확인합니다.
- `/dashboard/lab/strategy-tests`에서 strategy bucket별 isolated paper test 준비 상태, active progress summary, progress polling fallback, result matrix, full portfolio baseline comparison을 ViewModel 기준으로 확인합니다.
- `/dashboard/lab/strategy-tests/buckets/[bucket]/new`에서 특정 strategy bucket을 URL 기준으로 고정한 isolated paper test config를 검증하고, backend validation을 통과한 경우에만 해당 bucket의 queued record 생성을 시도합니다.
- `/dashboard/lab/runs/[runId]`에서 저장된 batch replay run summary와 latest run artifact snapshot을 read-only로 확인합니다. path segment는 실제 run id 또는 paper simulation create가 반환한 batch id를 사용할 수 있습니다.
- `/dashboard`는 API가 선택한 batch의 저장된 실행 목록을 read-only로 표시합니다. 이전의 종합 운영 화면은 `/dashboard/operations`에서 계속 제공합니다.
- `/dashboard/operations`와 `/dashboard/validation`의 Validation Lab은 stored batch aggregate의 validation protocol, overfitting warning, calendar/FX availability warning, provider/risk summary와 candidate split metric matrix를 read-only로 표시합니다.
- policy draft 저장은 backend validation을 통과한 현재 draft를 append-only `portfolio-policy-records.jsonl` artifact로 남기는 create-only flow에 한정합니다.
- `/dashboard/lab/policies`의 paper simulation 생성은 backend validation을 통과한 현재 draft hash를 simulation seed에 반영해 guarded `POST /paper/simulations` 요청을 생성하는 범위에 한정합니다.
- Strategy bucket test 생성은 validation을 통과한 요청을 append-only queued record로 저장하는 create-only flow에 한정합니다.
- `/dashboard/component-catalog`는 dashboard UI primitive와 상태 variant를 확인하는 static component catalog입니다. Storybook 대체 검증 표면으로만 사용하며 backend 조회, replay runner 시작, broker mutation을 수행하지 않습니다.

## 실험 목록과 기존 기능 접근

첫 화면의 주메뉴는 실험, 전략·정책, 비교, 데이터입니다. 전략·정책은 기존 Policy Builder,
비교는 Validation Lab의 저장된 candidate comparison, 데이터는 같은 화면의 universe coverage로
연결됩니다. 이는 새 cross-run 비교 도구나 데이터 수집 기능을 의미하지 않습니다.
설정·운영 메뉴에서 기존 운영 요약, portfolio, strategy bucket 테스트, Risk Gate, audit,
live readiness, component catalog에 접근할 수 있습니다. 기존 deep link와 legacy 화면은 유지합니다.

목록은 `GET /batch/replay/runs?limit=100`을 server-side로 한 번 읽습니다. 응답은 전체 실험
색인이 아니라 **API가 선택한 batch / 최신 여부 미확인** 자료입니다. Backend가 읽지 못한
manifest를 선택 과정에서 제외할 수 있으므로 정상 응답만으로 최신 batch임을 보장하지 않습니다.
반환된 최대 100개 저장 기록과 별도로 관측된 active run에만 ID·상태 필터를 적용합니다.
필터는 URL에 보존되며 필터 조작 자체가 API 재조회나 실행 요청을 발생시키지 않습니다.

- 저장된 child 상태는 `completed`, `completed_with_failures`, `failed`, `skipped`만 인정합니다.
- `running`은 유효한 batch 문맥과 실제 active child가 있을 때만 표시합니다. 같은 ID의 terminal
  저장 기록이 있으면 그 기록이 우선합니다. 접수 사실이나 오래된 active 필드만으로 실행 중이라고 추정하지 않습니다.
- API 조회 상태, batch 상태, child 상태, UI 조회 시각과 저장 자료 관측 시각을 구분합니다.
  JSONL 손상, 제외된 기록, batch 문맥 미확인은 유효한 기록과 함께 안내합니다.
- 원본 API 건수와 표시·필터·제외 건수는 별도입니다. 기록이 없거나 값이 미관측이면 0으로 대체하지 않습니다.
- 목록 링크는 실제 child `runId`를 상세 경로에 전달합니다. 경로 문자열로 데이터 종류나 정책 적용을 추정하지 않습니다.
- 같은 child의 terminal 기록이 중복되면 응답 원본 순서의 마지막 유효 행을 선택하고 중복을 알립니다.
  목록에서 연 exact child 상세도 같은 선택을 사용합니다. timestamp 기준 최신 판정이나 전체 이력 조회를 뜻하지 않습니다.
- 목록의 안전한 child ID projection은 ASCII 영숫자·`_`·`-` 1–255자로 제한하며, ID를 잘라 새 ID로 만들지 않습니다.
  이는 backend의 raw ID 제한이 아닙니다. 안전한 child가 있는 legacy batch 이름은 표시 가능한 batch 문맥이
  없더라도 원문을 노출하지 않고 연결 미확인 행으로 보존합니다. 제외된 child는 별도 건수로 알립니다.
- 손상된 선택적 manifest 집계·요청 수는 해당 값만 미확인으로 처리하며 정상 저장 행은 유지합니다.
  원본 source 건수·상태 집계나 paper-only envelope가 맞지 않는 응답은 전체 invalid로 구분합니다.
- 기존 실행 설정 링크는 현재 Policy Builder로 이동합니다. 새 3단계 wizard가 아니며,
  현 builder의 고정 balanced 설정과 `policyHash` seed 사용은 PortfolioPolicy 실행 적용을 뜻하지 않습니다.

자동 polling, 실행 재시도, 취소, 재개, 새로운 mutation은 추가하지 않습니다. 목록의 API 응답에
발견되지 않는 accepted-only simulation은 이 목록에서 실행 중 행으로 만들어내지 않습니다.

## 데이터 소스

앱은 Local Operations API에서 ViewModel을 server-side로 읽습니다.

```powershell
$env:DASHBOARD_OPS_API_BASE_URL = "http://127.0.0.1:8787"
$env:DASHBOARD_MUTATION_TOKEN = "<runtime-dashboard-mutation-token>"
```

`DASHBOARD_OPS_API_BASE_URL`이 비어 있거나 설정되지 않으면 `OPS_API_BASE_URL`, `http://127.0.0.1:8787` 순서로 대체 값을 사용합니다.
`DASHBOARD_MUTATION_TOKEN`은 `/dashboard/lab/policies/create`, `/dashboard/lab/policies/simulations/create`, `/dashboard/lab/strategy-tests/create`에서 사용하는 server-side runtime secret이며 repository에 저장하지 않습니다.

## 배포 라우팅

현재 저장소에는 Next.js dashboard와 Local Operations API를 하나의 public host 뒤에 배치하는 repo-managed deployment routing 설정 파일이 없습니다. `apps/dashboard/next.config.ts`는 존재하지만 현재 `allowedDevOrigins`와 turbopack root만 설정하며 deployment rewrite/redirect를 정의하지 않습니다. 배포 환경에서 `/dashboard`를 외부 operator-facing route로 노출한다면 Next.js dashboard deployment로 연결해야 합니다.

Local Operations API는 Next.js BFF가 호출하는 backend/internal route로 격리합니다. 같은 host 뒤에 둘 경우 `/dashboard` route precedence는 Next.js가 가져야 하며, Local Operations API static `/dashboard`는 외부 기본 route로 노출하지 않습니다.

`/dashboard`가 사용하는 read-only endpoint는 다음과 같습니다.

```text
GET /dashboard/view-model/portfolio-compliance
GET /dashboard/view-model/strategy-test-lab
GET /dashboard/view-model/strategy-test-lab/tests/{testId}/progress
GET /dashboard/view-model/risk-gate-trace?limit=8
GET /dashboard/view-model/validation-lab
GET /batch/replay/runs?limit=100&includeLatestRunArtifacts=1&runId=<route-segment>
POST /paper/policies/validate
POST /paper/policies
POST /paper/simulations
POST /paper/simulations/strategy-bucket-tests/validate
POST /paper/simulations/strategy-bucket-tests
```

`POST /paper/policies/validate`는 validation-only endpoint입니다. explicit operation header와 same-origin local dashboard guard를 요구하지만, 저장소 mutation, replay runner 시작, live order surface를 만들지 않습니다.

`/dashboard/lab/policies/create`는 browser가 Local Operations API를 직접 cross-origin 호출하지 않도록 하는 Next.js route handler입니다. 이 route는 `x-toss-trading-dashboard-intent: paper-policy-create`, UI에서 입력한 dashboard mutation token, positive same-origin request metadata, `application/json` content type을 요구한 뒤 `POST /paper/policies`로 server-side 전달합니다.

`POST /paper/policies`는 backend guarded policy artifact create endpoint입니다. backend validation을 통과한 `PortfolioPolicy` candidate만 append-only `portfolio-policy-records.jsonl` record와 audit event로 저장합니다. replay runner 시작, live order surface, raw command execution은 수행하지 않습니다.

`POST /paper/simulations/strategy-bucket-tests/validate`는 strategy bucket isolated test config의 validation-only endpoint입니다. 선택 bucket, policy draft, data directory, split role, date window, sampling/provider config를 backend에서 검증하지만, strategy bucket test record 생성, artifact 저장, replay runner 시작, live order surface를 수행하지 않습니다.

`/dashboard/lab/strategy-tests/validate`는 browser가 Local Operations API를 직접 cross-origin 호출하지 않도록 하는 Next.js route handler입니다. 이 route는 validation request를 server-side로 전달할 뿐이며, strategy bucket test record 생성, artifact 저장, replay runner 시작을 수행하지 않습니다.

`/dashboard/lab/strategy-tests/create`는 browser가 Local Operations API를 직접 cross-origin 호출하지 않도록 하는 Next.js route handler입니다. 이 route는 `x-toss-trading-dashboard-intent`, UI에서 입력한 dashboard mutation token, positive same-origin `origin`/`referer`/`sec-fetch-site` metadata를 요구한 뒤 validation을 통과한 strategy bucket test 설정을 server-side로 전달해 append-only queued record와 audit event를 저장합니다.

`/dashboard/lab/strategy-tests/tests/{testId}/progress`는 browser가 Local Operations API를 직접 cross-origin 호출하지 않도록 하는 Next.js read-only route handler입니다. 이 route는 `GET /dashboard/view-model/strategy-test-lab/tests/{testId}/progress`를 server-side로 조회해 queued/running test의 phase, heartbeat, decision/risk/trade count를 polling fallback으로 갱신합니다.

`/dashboard/lab/policies/simulations/create`는 browser가 Local Operations API를 직접 cross-origin 호출하지 않도록 하는 Next.js route handler입니다. 이 route는 `x-toss-trading-dashboard-intent: paper-simulation-create`, UI에서 입력한 dashboard mutation token, positive same-origin request metadata, `application/json` content type을 요구한 뒤 `POST /paper/simulations`로 server-side 전달합니다. 현재 backend `PaperSimulationRunConfig`는 `PortfolioPolicy` artifact를 직접 받지 않으므로, Next.js policy builder는 backend validation을 통과한 `policyHash`를 simulation seed에 반영하고 runner policy artifact 적용은 수행하지 않습니다.

`POST /paper/simulations`는 backend guarded paper simulation create endpoint입니다. paper-only config validation, operation header, dashboard guard를 통과한 요청만 replay runner에 전달합니다. live order surface, broker mutation, raw command execution은 수행하지 않습니다.

`POST /paper/simulations/strategy-bucket-tests`는 backend guarded mutation endpoint입니다. validation을 통과한 strategy bucket test 설정만 append-only queued record와 audit event로 저장합니다. replay runner 시작, live order surface, raw command execution은 수행하지 않습니다.

`/dashboard/lab/runs/[runId]`는 `GET /batch/replay/runs?limit=100&includeLatestRunArtifacts=1&runId=<route-segment>`을 server-side로 조회해 run index, progress snapshot, report title, decision/risk/execution artifact count를 렌더링합니다. Local Operations API는 `runId` query를 사용해 최신 batch뿐 아니라 요청한 run 또는 batch를 소유한 batch manifest를 선택합니다. 요청한 run이 반환된 `runs` page 밖에 있으면 `selectedRun` summary를 별도로 반환합니다. route segment가 실제 `runId`와 일치하지 않으면 같은 `batchId`의 최신 run record를 detail 대상으로 사용합니다. terminal run record가 아직 없는 running batch에서는 manifest `activeRun`과 latest artifact snapshot을 detail 대상으로 사용합니다. 이 화면은 저장된 artifact만 표시하며, replay runner 시작, order placement, raw command execution은 수행하지 않습니다.

## 명령

```powershell
npm --prefix apps/dashboard run dev
npm --prefix apps/dashboard run build
npm --prefix apps/dashboard run lint
npm --prefix apps/dashboard run test:unit
npm --prefix apps/dashboard run test:e2e
```

`test:e2e`는 isolated `apps/dashboard/.e2e-data/paper` data dir로 root Local Operations API를 `127.0.0.1:8789`에서 시작하고 Next.js dashboard를 `127.0.0.1:3002`에서 시작합니다. smoke test는 read-only ViewModel contract, live mutation control 미노출, axe-core 접근성 검사를 확인합니다.

실험 목록의 missing/partial/active/invalid/offline 상태는 별도 SSR fixture matrix로 확인합니다.
브라우저의 요청 가로채기로는 Next 서버의 API fetch를 바꿀 수 없으므로, 이 matrix만
고정 synthetic 응답을 주는 loopback 메모리 서버(`127.0.0.1:8791`)와 별도 Next 주소
(`127.0.0.1:3003`)를 사용합니다. 이 결과는 실제 backend 연결 검증을 대체하지 않습니다.
실제 연결은 위 기본 suite의 기존 격리 API와 실험 목록 smoke에서 확인합니다.

```powershell
npm --prefix apps/dashboard run test:e2e -- --config=playwright.experiment-list.config.ts
```

두 suite의 Next가 같은 `.next`를 사용하므로 기본 suite 종료 후 matrix를 **순차 실행**합니다.
전용 matrix는 기존 서버를 재사용하지 않고, 점유된 포트에서 실패합니다. Scenario 제어는
test runner의 고정 whitelist 요청에 한정하며 UI에서 호출하지 않습니다. 이 fixture는
실제 자료·provider·외부 API·broker·credential을 사용하지 않습니다.
