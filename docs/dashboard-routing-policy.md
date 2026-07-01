# Dashboard Routing And Archive Policy

이 문서는 RH1 `Dashboard Legacy Archive And Routing`의 routing/archive 정책 결정 기록이다. 범위는 문서화이며, dashboard asset 이동, redirect 구현, deployment 설정 변경은 후속 PR에서 다룬다.

## 결정

- 기본 operator UI는 Next.js `apps/dashboard`의 `/dashboard` route다.
- Local Operations API가 제공하는 정적 `/dashboard`는 legacy static compatibility surface로 유지한다.
- 현재 `dashboard/` directory는 archive로 이동하지 않는다. Local Operations API가 해당 directory를 asset source로 사용하므로, archive 이동은 static compatibility route 정리 PR에서 테스트와 함께 다룬다.
- deployment routing에서 외부 operator가 여는 `/dashboard`는 Next.js app으로 연결해야 한다. Local Operations API의 static `/dashboard`는 local/internal compatibility URL로만 취급한다.
- Local Operations API의 dashboard ViewModel endpoint는 Next.js BFF가 읽는 backend contract이며, operator가 직접 조합할 UI route가 아니다.

## Surface 책임

| Surface | 기본 URL | 책임 | 금지 |
| --- | --- | --- | --- |
| Next.js dashboard | `http://127.0.0.1:3000/dashboard` | 기본 operator UI, server-side ViewModel 조회, guarded paper-only action proxy | live order, broker mutation, natural language order, raw `codex exec`, raw `tossctl` |
| Local Operations legacy static dashboard | `http://127.0.0.1:8787/dashboard` | migration 기간의 compatibility view, 기존 정적 asset 확인 | 기본 operator 진입점 역할, live order, broker mutation, raw command 실행 |
| Local Operations dashboard ViewModel API | `http://127.0.0.1:8787/dashboard/view-model/*` | deterministic backend가 계산한 read model 제공 | browser가 domain truth를 직접 재계산하게 하는 raw artifact UI contract |
| Local Operations guarded paper endpoint | `http://127.0.0.1:8787/paper/*` | same-origin, JSON body, explicit operation header를 통과한 paper-only validation/create | live `TradingSignal`, live `OrderIntent`, raw command 실행, unguarded mutation |

## Archive 정책

현재 분류는 archive가 아니라 compatibility 유지다.

- `dashboard/`는 Local Operations API static asset source로 남긴다.
- legacy static response는 `x-toss-trading-dashboard-surface: legacy-static-compat` header로 Next.js 기본 UI와 구분한다.
- legacy static 화면은 compatibility 문구를 유지한다.
- `/dashboard/virtual-replays`, `/dashboard/batch-summary` 같은 legacy static alias는 route compatibility로만 유지한다.
- archive 이동을 시작할 때는 `dashboard/` asset source 변경, `src/api/localOperationsSurface.ts` allowlist 변경, Local Operations API dashboard asset test를 같은 PR 범위에 포함해야 한다.

## Deployment routing 기준

로컬 개발:

```powershell
npm run ops:api -- --data-dir data/paper
npm --prefix apps/dashboard run dev
```

- operator는 `http://127.0.0.1:3000/dashboard`를 연다.
- `http://127.0.0.1:8787/dashboard`는 legacy compatibility 확인이 필요할 때만 연다.

배포:

- public/operator-facing `/dashboard` route는 Next.js dashboard deployment로 연결한다.
- Local Operations API는 Next.js BFF가 호출하는 backend/internal route로 격리한다.
- 같은 host 뒤에 둘 경우 `/dashboard` route precedence는 Next.js가 가져야 한다.
- Local Operations API static `/dashboard`를 외부 기본 route로 노출하지 않는다.

## 안전 경계

이 정책은 routing과 문서 기준만 정리한다. 다음 surface는 추가하지 않는다.

- live order placement
- broker mutation
- `place_order` MCP enabled tool
- natural language order request
- raw `codex exec` execution
- raw `tossctl` execution
- AI decision provider output을 live signal/order로 승격하는 경로

AI는 paper-only decision/evidence provider이며, final sizing과 gate는 deterministic backend와 Risk Engine이 담당한다.

## 후속 PR 범위

- static dashboard compatibility route 정리 또는 archive 이동
- README와 deployment 안내 갱신
- dashboard smoke/E2E와 no-live-order boundary 검증 보강
