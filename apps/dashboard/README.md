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
- `/dashboard`의 Validation Lab은 stored batch aggregate의 validation protocol, overfitting warning, calendar/FX availability warning, provider/risk summary와 candidate split metric matrix를 read-only로 표시합니다.
- policy draft 저장은 backend validation을 통과한 현재 draft를 append-only `portfolio-policy-records.jsonl` artifact로 남기는 create-only flow에 한정합니다.
- `/dashboard/lab/policies`의 paper simulation 생성은 backend validation을 통과한 현재 draft hash를 simulation seed에 반영해 guarded `POST /paper/simulations` 요청을 생성하는 범위에 한정합니다.
- Strategy bucket test 생성은 validation을 통과한 요청을 append-only queued record로 저장하는 create-only flow에 한정합니다.
- `/dashboard/component-catalog`는 dashboard UI primitive와 상태 variant를 확인하는 static component catalog입니다. Storybook 대체 검증 표면으로만 사용하며 backend 조회, replay runner 시작, broker mutation을 수행하지 않습니다.

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
npm --prefix apps/dashboard run test:e2e
```

`test:e2e`는 isolated `apps/dashboard/.e2e-data/paper` data dir로 root Local Operations API를 `127.0.0.1:8789`에서 시작하고 Next.js dashboard를 `127.0.0.1:3002`에서 시작합니다. smoke test는 read-only ViewModel contract, live mutation control 미노출, axe-core 접근성 검사를 확인합니다.

### Portfolio hedge fixture 회귀 검증

기본 `test:e2e`의 `virtual_e2e` snapshot은 `2026-06-27T00:00:00.000Z`이며 active policy가 없는 상태를 유지합니다.
실제 API의 `policyStatus=missing`, `policyEnabled=null`, 관측 `ineffective`와 현재 missing-policy 경고를 검증하고 hedge breach가 없음을 확인합니다.

```powershell
# 브라우저 없이 실제 local Operations API와 immutable fixture 계약 검증
npm --prefix apps/dashboard run test:portfolio-fixture
# 별도 missing/enabled/disabled fixture를 desktop/mobile에서 순차 검증
npm --prefix apps/dashboard run test:e2e:portfolio-policy
```

`test:e2e:portfolio-policy`는 root TypeScript build를 한 번 실행한 뒤 fixture API 테스트와 세 scenario를 실행합니다.
각 scenario는 allowlist로 고정한 `.e2e-data/portfolio-policy/{missing,enabled,disabled}`를 사용하고 테스트 전에만 준비합니다.
실제 Operations API는 `127.0.0.1:8790`, Next.js는 `127.0.0.1:3003`에서 시작하며 기존 서버를 재사용하지 않습니다.
한 scenario의 desktop/mobile이 모두 끝나고 서버가 종료된 후 다음 scenario를 시작합니다.
Next.js `.next`는 공유하므로 기본 E2E, 별도 scenario E2E, 개발 서버와 dashboard build를 같은 worktree에서 동시에 실행하지 않습니다.
기본 전체 E2E → portfolio scenario E2E → 후속 list/SSR matrix 순서로 반드시 순차 실행합니다.
전용 Next 서버도 loopback hostname을 명시하고 `DASHBOARD_MUTATION_TOKEN`을 빈값으로 고정합니다.

Enabled/disabled는 production factory로 source policy, immutable dependency, runtime policy, activation을 생성하고 `virtual_e2e`에 결속합니다.
활성화는 snapshot의 as-of와 정확히 같은 시각이며 API가 각각 `active/true`, `active/false`인지 먼저 검증합니다.
Enabled는 기존 `ineffective` breach와 danger class를 확인하고, disabled는 breach 부재와 `ineffective` analytics 유지를 확인합니다.
모든 scenario에서 read-only 경계와 axe 검사를 유지하며 SSR 응답을 `page.route` 등으로 대체하지 않습니다.
Portfolio의 두 가로 스크롤 표는 이름 있는 region으로 제공하며 Tab으로 진입하고 방향키로 스크롤할 수 있습니다.
기본 smoke와 세 scenario는 표의 Tab/Shift+Tab 순서, 보이는 focus outline, overflow 시 실제 키보드 스크롤도 검증합니다.
별도 API 회귀는 유효한 정책의 activation만 as-of보다 1ms 이후인 경우를 생성해 정책이 아직 missing임을 확인합니다.
기본 전체 E2E와 repository 최종 merge 검증은 이 focused command로 대체하지 않습니다.
