# Toss Trading Dashboard

Next.js App Router skeleton for the paper-only operations dashboard.

## Scope

- Shows live trading disabled readiness posture.
- Keeps backend behavior unchanged.
- Does not expose live order, broker mutation, raw `codex exec`, or raw `tossctl` surfaces.
- Keeps N1 data static until dashboard ViewModel API contracts are implemented.

## Commands

```powershell
npm --prefix apps/dashboard run dev
npm --prefix apps/dashboard run build
npm --prefix apps/dashboard run lint
npm --prefix apps/dashboard run test:e2e
```
