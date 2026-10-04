> Historical preimplementation audit of initial PR807 baseline `764829e8b143c2ae327fc0e52e1ebc01c85d4da3`. Statements below that data/settings routes or the origin parser do not exist describe that earlier source.

# UX07 이전 및 UX02c 확장 범위 audit

2026-10-04 기준. 공개 UI 기준은 PR807 head `764829e8b143c2ae327fc0e52e1ebc01c85d4da3`, tree `51c3fff713f3c9b9ce8db6f6db900c7c6dd69b52`다. 이 문서는 별도 audit 브랜치에서 작성하며 기준 브랜치, 기존 화면, redirect를 바꾸지 않는다. 정본은 `technical-design.md`의 이전표와 `pr-work-plan.md`다.

## UX07 이전표 대조

파일 존재는 직접 URL의 브라우저 성공이나 기능 전체 이전의 증거가 아니다. 아래 상태는 소스 대조 결과다.

| 이전표 행 | 현재 진입·소스 | 남은 완료 조건 |
| --- | --- | --- |
| Next 기존 dashboard 종합 | `/dashboard` 실험 목록, `/dashboard/operations` 기존 종합 | 역할별 index와 전체 이전표 회귀 |
| portfolio | `/dashboard/portfolio` 보존, 목록 운영 메뉴 링크 | 역할별 전략·정책 진입 정리 |
| policies | `/dashboard/lab/policies` 보존 | policy 직접 실행 adapter는 미지원; 적용 주장 금지 |
| strategy tests / bucket new | `/dashboard/lab/strategy-tests`, `/buckets/[bucket]/new` 보존 | queued-only 의미 유지 |
| exact run detail | `/dashboard/lab/runs/[runId]` 보존 | 기존 bookmark·Back·reload 회귀 유지 |
| risk gate | `/dashboard/risk-gate` 보존 | 설정 역할 index 및 증거 진입 매핑 |
| validation | `/dashboard/validation` 보존; comparison/coverage fragment 링크 | 데이터 역할 index |
| audit | `/dashboard/audit` 보존 | 설정 역할 index |
| live readiness | `/dashboard/live-readiness` 보존 | 진단 역할 표시, live disabled 유지 |
| component catalog | `/dashboard/component-catalog` 보존 | 설정 역할 index |
| legacy virtual / simulations | 새 실험·목록·상세 진입 구현 | 검증된 운영자 지정 legacy origin 호환 링크 없음 |
| legacy live-readiness panel | Next 별도 경로 보존 | legacy 호환 링크와 차이 안내 없음 |
| legacy assets / benchmark / cost / trades / decisions | 상세·증거·비교 부분 구현 | 모든 legacy payload 이전 완료 아님; 미이전 호환 진입 필요 |
| legacy market / sector / events / packets | validation coverage 및 실행 증거 부분 구현 | 데이터 역할 index·전체 payload 연결 미완료 |
| legacy target / income / daily / research / batch reports | 정책·실행 기록 부분 구현 | 전체 read-only 진입 대조 및 호환 링크 미완료 |
| runbooks / diagnostics | 기존 문서 보존 | 설정 역할 index와 실제 화면·접근 조건 구분 |

`ExperimentList.tsx`는 기존 운영 종합·portfolio·strategy tests·risk gate·audit·live readiness·catalog 링크를 유지한다. 새 실험 `/dashboard/experiments/new`와 정확한 실행 비교 `/dashboard/experiments/compare`는 toolbar에서 접근한다. 주 navigation의 비교·데이터는 여전히 현재 validation 보고서 fragment이며 실행 비교와 구별해야 한다.

현재 `/dashboard/data`, `/dashboard/settings` 역할 index 및 legacy origin 검증/parser·missing/invalid 안내 구현을 찾지 못했다. 정본대로 운영자가 명시한 검증된 URL만 허용하고, 없으면 추정 URL 없이 runbook 접근 조건을 표시해야 한다. API proxy URL·토큰·임의 사용자 URL·credential URL을 호환 origin으로 쓰지 않는다. 구 화면 삭제·자동 redirect 변경은 별도 설계 대상이다.

독립 회귀 범위는 기존 10개 고정 경로와 두 동적 경로 보존, operations document navigation, validation fragment의 reload/Back·focus, 새 생성/상세/증거/비교 진입, 1440/1024/390px keyboard 접근이다. 기존 `operationsRoutes.test.mjs`, `validationFragmentNavigation.test.mjs`, production smoke·workspace·comparison suite를 활용한다. 없는 origin UI의 부정 테스트를 이미 통과했다고 표현하지 않는다. 다음 구현 PR에서는 origin absent/invalid/credential/scheme/port 경계와 설정 index 진입을 합성 값으로 검증해야 한다.

## UX02c 서버 지원 및 분리 범위

`paperSimulationConfig.ts`와 `docs/contracts/paper-simulation-config.md`에서 standard 비용과 고정 3종 benchmark만 실행 지원한다. `high_cost`, `cash_only`는 field-specific 400으로 거절한다. wizard는 standard 및 고정 3종만 정직하게 표시한다. universe preset은 요청 metadata이며 종목 필터가 아니다. market은 배정 정책만 바꾸며 market symbol filter는 없다.

| 별도 기능 범위 | 이미 있는 backend 연결점 | 구현 전 필요한 계약·완료 조건 |
| --- | --- | --- |
| 비용 선택 확장 | batch workflow `executionPolicy` → replay → paper engine | high_cost의 수치·단위·수수료/세금/슬리피지/유동성 범위 정의; validation/create/runner 값 일치; cost hash 및 결과·비교 provenance; 합성 손익 변화와 잘못된 값 거절 |
| benchmark 선택 확장 | 현재 고정 cash/equal-weight/initial-hold 보고서 | cash_only가 표시 선택인지 계산 정책인지 결정; workflow 인자·결과·비교 provenance; unavailable 의미 및 기존 3종 호환 회귀 |
| universe preset 실적용 | batch `requiredSymbols`, `universeManifest` 및 research 정규화 | coverage 요구와 실제 replay 종목 필터를 구별; preset membership·시점·누락 처리 계약; 실제 workflow 전달·실효 종목 증거·hash; 합성 KR/US 및 누락·미지원 preset 부정 회귀 |

존재하는 universe manifest 파일이나 workflow 인자만으로 preset filtering 지원을 주장하지 않는다. 비용 preset 수치, benchmark 선택 의미, universe membership 정책은 현재 canonical 계약에 정의되지 않아 임의로 만들지 않는다. 이 세 항목은 별도 feature PR과 완료 조건으로 진행해야 하며 미지원 값을 성공 접수하도록 guard를 풀지 않는다. paid AI·live·실자료·운영 계정은 범위 밖이다.

독립 audit 검증: `node --test tests/operationsRoutes.test.mjs tests/validationFragmentNavigation.test.mjs` 39/39 통과(실패·skip 0). 이는 소스·VM 기반 경로/이력/focus 계약 검증이며 새 browser 검증은 아니다. 기준 UI의 기존 production 검증 결과를 새 audit 브랜치에서 재실행한 결과로 표현하지 않는다.

PR802의 원래 create202 이후 상세 URL 미commit 간헐 정체 원인은 미확정이다. native same-ID document navigation 전환을 검증한 뒤 main a9a40ae7b0b665a87d6e109ec9f27ebe6f17f9a9로 정상 병합했다. 별도 late202 최신 navigation 덮기 수정과 원래 원인 확정을 혼동하지 않는다. 하위 PR803–807은 소스 동기화만 했고 병합하지 않았다.

## 현재 구현 경계

역할 index는 strategy/data/settings 경로, server-only origin 검증과 고정 legacy 목적지, missing/invalid 안내 및 기존 direct route/query/history/focus 보존을 포함한다. raw-origin 후속은 정규화 전 dot-path·C0/DEL·userinfo를 거절한다. 전체 legacy payload 이전 완료는 아니다. cost preset 수치, cash_only 표시와 실행 의미, universe coverage와 filtering은 사용자 결정이 필요하며 guard는 유지한다. 동결 object와 현재 로컬 검증 증거를 분리한다. 현재 결합은 새 main/API/UI를 포함하되 Linux full·독립 리뷰는 별도 검증이다.
