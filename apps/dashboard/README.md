# Toss Trading Dashboard

Next.js App Router dashboard for the paper-only operations surface.

## Scope

- Shows live trading disabled readiness posture.
- Keeps backend behavior unchanged.
- Does not expose live order, broker mutation, raw `codex exec`, or raw `tossctl` surfaces.
- Renders read-only backend ViewModel data from Local Operations API.
- Keeps unavailable ViewModel reads isolated to the affected dashboard panel.

## Data Source

The app reads ViewModels server-side from Local Operations API.

```powershell
$env:DASHBOARD_OPS_API_BASE_URL = "http://127.0.0.1:8787"
```

If `DASHBOARD_OPS_API_BASE_URL` is not set, the app falls back to `OPS_API_BASE_URL`, then `http://127.0.0.1:8787`.

Read-only endpoints consumed by `/dashboard`:

```text
GET /dashboard/view-model/portfolio-compliance
GET /dashboard/view-model/strategy-test-lab
GET /dashboard/view-model/risk-gate-trace?limit=8
GET /dashboard/view-model/validation-lab
```

## Commands

```powershell
npm --prefix apps/dashboard run dev
npm --prefix apps/dashboard run build
npm --prefix apps/dashboard run lint
npm --prefix apps/dashboard run test:e2e
```

`test:e2e` starts the root Local Operations API on `127.0.0.1:8789` and the Next.js dashboard on `127.0.0.1:3002`. The smoke test verifies the read-only ViewModel contract, absence of live mutation controls, and axe-core accessibility checks.
