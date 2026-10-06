# 목록 exact ID의 native document 이동 후보

기존 final UX07 후보 `f9e90e74`의 390px 목록 클릭 정체는 정확 href 클릭 이후 navigation RSC가 abort되고 목록 URL이 유지된 관측이다. 취소 주체와 원인은 미확정이며 PR802의 원래 문제와 같은 원인이라고 판정하지 않는다. 이 변경은 transport 대안이다.

목록 row만 실제 `row.detailHref`의 native anchor로 이동한다. 목록의 로드된 snapshot, q/status 정규화, 추가 query/hash, draft, History API, Back/Forward, focus/scroll, retained destinations는 유지한다. GET identity와 modifier/middle-click/new-tab/download 정책을 유지한다. 기존 목록 필터는 API를 재조회하지 않는다.

SSR markup의 row가 hydration 전에 actionable하므로 server page의 self-contained bootstrap이 document 경계를 먼저 설치한다. Client entry도 같은 installer를 호출하며 기존 SSR 경계를 덮지 않는다. 이미 시작된 native document는 최신 filter input/change/submit/clear, fragment, 다른 목적지, browser history에 앞서 취소한다. 최신 cross-page 목적지는 native로 활성화한다. Modifier/new-tab/download는 현재 tab의 pending intent를 취소하지 않는다. Pagehide와 BFCache 복원은 이전 pending 상태를 버린다.

초기 chunk를 보류한 별도 검증에서 load 전에 document를 시작하고 `window.stop()`으로 취소하면 초기 chunk도 abort되어 filter hydration이 회복되지 않는 회귀를 재현했다. 따라서 초기 document load 전의 unmodified row click은 최신 destination만 보관한다. 새 fragment/history/filter/link intent는 이를 자원 중단 없이 버린다. Load 완료 후에도 보관된 최신 intent만 exact native GET으로 이동한다. React hydration 완료를 기다리는 조건이나 timeout은 추가하지 않는다. JS 로딩 실패도 browser load 완료 후 native 이동할 수 있다.

실제 fixture-backed HTML의 응답을 보류하고 사용자 input 및 browser history command로 최신 intent를 전달한다. Playwright Frame.evaluate는 pending document 뒤에서 대기하므로 pending 이후 입력은 keyboard/mouse protocol, Back/Forward는 browser history command를 사용한다. 응답 해제 후 old request abort와 최종 URL/snapshot/focus 및 filter list-read 횟수를 확인한다. SSR bootstrap은 초기 JS chunk 보류·해제로 자원 회복과 uninterrupted native 이동을 검증한다.

원래 soft-navigation 실패 trace와 bootstrap chunk 손실의 최초 실패 trace는 진단 기록에 보존한다. Timeout/retry/assertion 완화나 원래 원인 확정은 없다. 공개 PR 게시와 최종 독립 gate는 별도 단계다.

## 독립 검토의 event 경계 보완

두 document 응답을 모두 보류한 실제 mobile 검사에서 capture의 stopPropagation 때문에 React 메뉴 닫힘 handler가 실행되지 않는 회귀를 재현했다. 이를 제거해 defaultPrevented만으로 Next Link의 중복 이동을 막고 메뉴 handler는 전달한다. 닫힌 메뉴 안에 포커스가 남는 경계도 재현했으므로 정상 same-tab 선택은 현재 main에 포커스를 옮긴다. 새 document는 commit 뒤 자기 포커스를 가진다. Modifier, 별도 target, download는 메뉴·포커스를 바꾸지 않는다.

외부 same-tab 링크는 pending document를 취소한 뒤 원래 anchor의 native activation을 유지한다. location.assign으로 대체하지 않아 referrerPolicy/rel을 보존한다. 이미 보류된 controlled document의 대체일 때만 pending 수명을 이어 관측한다. 이 화면에 실제 외부 링크를 추가하지는 않는다. 별도 합성 localhost origin의 no-referrer anchor로 기본 정책과 보류 요청 대체를 검증한다.

실제 Chrome BFCache 검사에서는 MainResourceHasCacheControlNoStore, JsNetworkRequestReceivedCacheControlNoStoreResource, BrowsingInstanceNotSwapped가 보고되어 persisted 복원이 일어나지 않았다. 실제 BFCache 통과로 간주하지 않는다. Pagehide/persisted pageshow의 상태 초기화와 반복 탐색은 실제 installer를 실행한 event contract 검사로 별도 확인하며 browser eligibility와 구분한다. 운영 응답의 no-store 정책을 바꾸지 않는다.

## 현재 main 통합 검증 범위 (2026-10-06)

PR807 merged main dc137b451e346fa33136469da5392714a4c5eeec을 기준으로 원본 후보를 보존한 별도 브랜치에서 통합했다. UX07은 역할별 index·고정 legacy 목적지·origin parser 및 안내의 11파일 범위, native는 그 부모 위 목록 exact document navigation·SSR bootstrap·최신 intent 취소 경계의 8파일 범위다. API/provenance 마스킹·행 상한·portfolio 코드는 현재 main을 유지한다.

두 후보의 현재-main root build 및 dashboard 표준 unit209/209를 새로 확인했다. 이는 새 production/browser나 독립 Linux full 통과를 뜻하지 않는다. 이전 후보 증거와 새 검증은 구분한다. 모든 legacy payload 이관, high_cost/cash_only/universe preset 의미 확장 및 기존 PR802 create 간헐 정체 원인 해결을 완료했다고 주장하지 않는다. 후속 PR 게시 전 해당 production history/focus/keyboard 및 navigation 경계를 확인한다.

### 현재 후보 production 및 self-review 증거

현재 소스에 대해 원래 Next16.2.9 Turbopack production build·lint·type을 새로 통과했다. 설치된 Chrome과 정식 Playwright runner, workers1/retries0/30초 test 및5초 expect를 사용했다. 외부 작업 기록 폴더에 config·결과·스크린샷을 보존하며 합성 loopback fixture만 사용한다. native/provenance production72개 중70pass·2기존 desktop/tablet mobile-overlay 조건skip·fail0을 확인했다. 초기 chunk 보존·SSR 전 navigation·최신 filter/history/link intent·modifier 별도 탭·mobile menu focus·external no-referrer·기존 provenance/비교를 검증했다. 실제 브라우저 BFCache 복원은 이 suite에서 증명하지 않았으며 pageshow persisted 경계 코드 존재와 구분한다.

self-review에서 origin의 raw dot/control/userinfo/scheme/port 경계와 고정 href 구성, main API/provenance 코드 동일성, native capture/defaultPrevented·초기 document load·menu focus·외부 anchor 정책 상호작용을 확인했다. 잘못된 node --test의 Playwright runner 오류는 원본 로그로 보존하고 제품 실패나 유효 browser 결과로 계산하지 않는다. 원래 soft-navigation 간헐 정체 원인은 미확정이다. 후속 PR는 기능별 Draft이며 독립 exact-tree 검증 전 완료/merge를 주장하지 않는다.
