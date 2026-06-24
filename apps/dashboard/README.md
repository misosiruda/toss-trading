# Toss Trading Dashboard

paper-only 운영 화면을 제공하는 Next.js App Router 대시보드입니다.

## 범위

- live trading 비활성화 상태와 준비 상태를 표시합니다.
- backend 동작은 변경하지 않습니다.
- live order, broker mutation, raw `codex exec`, raw `tossctl` 인터페이스를 노출하지 않습니다.
- Local Operations API에서 read-only backend ViewModel 데이터를 읽어 화면에 표시합니다.
- 사용할 수 없는 ViewModel read는 해당 dashboard panel의 상태로만 격리합니다.
- `/dashboard/lab/policies`에서 paper-only `PortfolioPolicy` draft를 구성하고 local/backend validation 결과와 JSON preview를 확인합니다.
- `/dashboard/lab/strategy-tests`에서 strategy bucket별 isolated paper test 준비 상태, active progress placeholder, result matrix placeholder를 read-only ViewModel 기준으로 확인합니다.
- policy draft는 아직 저장하지 않으며 replay 생성 또는 strategy bucket isolated test 생성에 연결하지 않습니다.

## 데이터 소스

앱은 Local Operations API에서 ViewModel을 server-side로 읽습니다.

```powershell
$env:DASHBOARD_OPS_API_BASE_URL = "http://127.0.0.1:8787"
```

`DASHBOARD_OPS_API_BASE_URL`이 비어 있거나 설정되지 않으면 `OPS_API_BASE_URL`, `http://127.0.0.1:8787` 순서로 대체 값을 사용합니다.

`/dashboard`가 사용하는 read-only endpoint는 다음과 같습니다.

```text
GET /dashboard/view-model/portfolio-compliance
GET /dashboard/view-model/strategy-test-lab
GET /dashboard/view-model/risk-gate-trace?limit=8
GET /dashboard/view-model/validation-lab
POST /paper/policies/validate
POST /paper/simulations/strategy-bucket-tests/validate
```

`POST /paper/policies/validate`는 validation-only endpoint입니다. explicit operation header와 same-origin local dashboard guard를 요구하지만, 저장소 mutation, replay runner 시작, live order surface를 만들지 않습니다.

`POST /paper/simulations/strategy-bucket-tests/validate`는 strategy bucket isolated test config의 validation-only endpoint입니다. 선택 bucket, policy draft, data directory, split role, date window, sampling/provider config를 backend에서 검증하지만, strategy bucket test record 생성, artifact 저장, replay runner 시작, live order surface를 수행하지 않습니다.

## 명령

```powershell
npm --prefix apps/dashboard run dev
npm --prefix apps/dashboard run build
npm --prefix apps/dashboard run lint
npm --prefix apps/dashboard run test:e2e
```

`test:e2e`는 root Local Operations API를 `127.0.0.1:8789`에서 시작하고 Next.js dashboard를 `127.0.0.1:3002`에서 시작합니다. smoke test는 read-only ViewModel contract, live mutation control 미노출, axe-core 접근성 검사를 확인합니다.
