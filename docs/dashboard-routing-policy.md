# Dashboard Routing And Archive Policy

이 문서는 RH1 `Dashboard Legacy Archive And Routing`의 routing/archive 정책 결정 기록이다. 현재 결정은 Next.js `apps/dashboard`를 기본 operator UI로 두고, Local Operations API의 정적 `/dashboard`는 legacy static compatibility surface로 유지하는 것이다.

## 결정

- 기본 operator UI는 Next.js `apps/dashboard`의 `/dashboard` route다.
- Local Operations API가 제공하는 정적 `/dashboard`는 legacy static compatibility surface로 유지한다.
- 현재 `dashboard/` directory는 archive로 이동하지 않는다. Local Operations API가 해당 directory를 legacy compatibility asset source로 사용하며, legacy alias redirect와 response header는 코드와 테스트에 반영되어 있다.
- deployment routing에서 외부 operator가 여는 `/dashboard`는 Next.js app으로 연결해야 한다. Local Operations API의 static `/dashboard`는 local/internal compatibility URL로만 취급한다.
- repository-managed deployment routing 설정 파일은 현재 없다. 배포 환경에서 하나의 host 뒤에 둘 경우 `/dashboard` route precedence는 Next.js가 가져야 한다.
- Local Operations API의 dashboard ViewModel endpoint는 Next.js BFF가 읽는 backend contract이며, operator가 직접 조합할 UI route가 아니다.

## Surface 책임

| Surface | 기본 URL 또는 route | 책임 | 금지 |
| --- | --- | --- | --- |
| Next.js dashboard | `http://127.0.0.1:3000/dashboard` | 기본 operator UI, server-side ViewModel 조회, guarded paper-only action proxy | live order, broker mutation, natural language order, raw `codex exec`, raw `tossctl` |
| Local Operations legacy static dashboard | `http://127.0.0.1:8787/dashboard` | migration 기간의 compatibility view, 기존 정적 asset 확인 | 기본 operator 진입점 역할, live order, broker mutation, raw command 실행 |
| Local Operations dashboard ViewModel API | `http://127.0.0.1:8787/dashboard/view-model/*` | deterministic backend가 계산한 read model 제공 | browser가 domain truth를 직접 재계산하게 하는 raw artifact UI contract |
| Local Operations paper report API | `GET http://127.0.0.1:8787/paper/report` | 저장된 paper report를 읽는 read-only JSON route | mutation, replay runner 시작, live order, raw command 실행 |
| Local Operations guarded paper POST endpoints | `POST /paper/policies/validate`, `POST /paper/policies`, `POST /paper/simulations`, `POST /paper/simulations/strategy-bucket-tests/validate`, `POST /paper/simulations/strategy-bucket-tests`, `POST /paper/simulations/strategy-bucket-tests/matrix` | same-origin, JSON body, explicit operation header를 통과한 paper-only validation/create | live `TradingSignal`, live `OrderIntent`, raw command 실행, unguarded mutation |

## Archive 정책

현재 분류는 archive가 아니라 compatibility 유지다.

- `dashboard/`는 Local Operations API static asset source로 남긴다.
- legacy static response는 `x-toss-trading-dashboard-surface: legacy-static-compat` header로 Next.js 기본 UI와 구분한다.
- legacy static 화면은 compatibility 문구를 유지한다.
- `/dashboard/virtual-replays`, `/dashboard/batch-summary` 같은 legacy static alias는 canonical legacy static route로 redirect하는 compatibility route로만 유지한다.
- archive 이동은 현재 결정이 아니다. archive 이동을 시작할 때는 `dashboard/` asset source 변경, `src/api/localOperationsSurface.ts` allowlist 변경, Local Operations API dashboard asset test를 같은 PR 범위에 포함해야 한다.

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

## 구현 및 검증 상태

- 완료: `src/api/localOperationsDashboardAssets.ts`는 legacy static response에 `x-toss-trading-dashboard-surface: legacy-static-compat` header를 쓴다.
- 완료: `src/api/localOperationsSurface.ts`는 `/dashboard/virtual-replays`, `/dashboard/batch-summary` alias를 canonical legacy static route로 redirect하도록 정의한다.
- 완료: `src/api/localOperationsServer.test.ts`는 legacy dashboard asset, alias redirect, HEAD redirect, POST rejection, compatibility 문구를 검증한다.
- 완료: `apps/dashboard/tests/e2e/dashboard-smoke.spec.ts`는 Next.js dashboard smoke와 axe-core 접근성 검사를 포함한다.
- 확인: `README.md`와 `apps/dashboard/README.md`는 repository-managed deployment routing 설정 파일이 없고, public/operator-facing `/dashboard`가 Next.js dashboard deployment로 연결되어야 한다고 명시한다.
- 보류: static `dashboard/` archive 이동과 repository-managed deployment routing 설정 추가는 현재 정책 결정이 아니며, 별도 구현 범위가 확정될 때 다시 검토한다.
