# 현재 구현 원장 및 다음 검증 범위

확인일2026-10-06. 기준 main `66f7b3ca6a536f60a67459772d6939b2ca9f0e17`, tree `3cbe1bd679c1cdb3323c0537d48d681fe5e0ec62`. GitHub의 실제 merged/head/main을 확인했으며 과거 문서의 hold·로컬 후보 표시는 이력으로 구분한다. 원본과 refs는 보존한다.

## 실제 완료와 남은 범위

| 설계 카드 | 현재 반영 | 남은 완료 조건 |
| --- | --- | --- |
| UX01 | PR801 목록·source 분리·기존 경로 보존 | 최신 batch/전체 검색을 새로 보장하지 않음 |
| UX02a/b | PR797/798 입력 실효 계약·accepted/runner 실패 관측 | 현재 허용값만 지원 |
| UX03 | PR802 wizard·validation BFF·create1회·동일 ID 및 native 생성 | 원래 soft-navigation 간헐 원인은 미확정; 역사적 native/BFCache 검증과 현재 후보 증거를 구분 |
| UX04/05 | PR803/804 summary/record·bounded explicit evidence | 없는 시계열/참조/full payload를 만들지 않음 |
| UX06 | PR805/806/807 exact pair 및 부분 field별 provenance | candidate1–3, 완전한 입력·runtime/version 정본, 비교 가능성, clone 새 ID는 미완료 |
| UX07 | PR808 역할 index·고정 검증 origin 안내, PR809 목록 native | 모든 이전표 경로의 현재 production 대조 및 미이전 legacy payload의 접근 보존 |
| UX02c | high_cost/cash_only 거절, preset metadata/market allocation 제한 | 비용 수치/단위, benchmark 의미, membership·시점·누락 정책 결정 전 확장 금지 |

전체 프론트 또는 ROADMAP_COMPLETE를 선언하지 않는다. Next 정책 저장/queued bucket과 실제 simulation runner를 구분한다. legacy 내용 전체를 Next로 복제해야만 접근 보존되는 것은 아니며 기술설계는 미이전 자료의 명시적 호환 경로를 허용한다.

## 검증 증거의 귀속

808 공개692cc/tree7a6c, 809 공개7d60/tree3cbe의 독립 검토는 finding0. 808 root 새 full4499pass0fail33기존Windows skip, 809 root는1115검증 입력과 quality 참조문서 동일성으로 재사용했다(809별도 full 실행 아님). 각각 독립 UI209/build/lint/type은 신규 실행이다. Cloud browser는 socket EPERM으로 본문 실행0·미완료다.

Home 실제 production은808 origin missing/configured/invalid 총27pass, 809 native/provenance70pass·2desktop/tablet mobile-overlay 조건skip·fail0이다. 원래 Next16.2.9 Turbopack build/lint/type·unit209를 각각 새로 실행했다. 809 최종f83c 이력 통합 및 merged main66f7의 tree는 동일3cbe이며 소스 변경은 없다.

808/809 최초 Ready 자동 Security는각각692cc/7d60에서Completed/finding0. 자동 CodeReview는 사용량 한도로 미실행이며 통과가 아니다. 필수 서버 check와 보호를 확인하고 독립 current-tree 리뷰 및 최초 자동 요청1회 정책에 따라 정상 expected-head merge했다. 보호 변경/override/수동 중복요청/Actions 재실행은 없다.

## 다음 기능: 기존 경로 보존 production 감사

목적: 기존 기술설계 이전표의 Next·legacy 진입이 현재 main에서도 실제로 열리는지 확인한다. 새 정책·비교 engine·payload 이전을 추가하지 않는다.

포함: 기존 dashboard-smoke의12종 Next 경계/자료/정책·queued-only·금지 endpoint/a11y를 production에서 재검증하고, role index의 검증된 합성 loopback origin을 통해 기존 legacy current/validation/overview에 실제 이동한다. legacy 여섯 고정 경로의 HTML/script/의미 있는 panel과 GET-only를 확인한다.1440/1024/390px에서 history/Back·오류/overflow를 확인한다.

완료:404/Next 오류 화면이 없고 정확한 기존 route·heading/panel을 확인한다. 외부/실자료/운영계정 접근·live/유료 AI 호출이 없으며 새 legacy 감사는 GET/HEAD만 허용한다. 기존 Next smoke의 합성 validation/queued 테스트는 그 기존 경계를 유지한다. 원래 timeout/worker/retry/assertion은 유지한다. 실패는 원인에 따라 product와 harness로 구분하고 기존 의미를 약화하지 않는다.

비범위: 모든 legacy payload를 Next로 이식, 실제 사용자 origin 접근, 계정 설정, 데이터를 생성/수집하는 신규 기능, preset·clone 의미 결정. 이전표의 자료 영역은 실제 route/기존 panel로 매핑하며 단순 파일 존재를 브라우저 통과로 쓰지 않는다.

## 필요한 최소 결정과 추천

- **비용:** 직접bps 입력과 고정high_cost preset 중 선택. 직접 입력을 추천하며 사용자가 명시한 수치·단위만 적용한다. 고정preset이면 수수료/세금/슬리피지/유동성 각각의 근거와 값이 필요하다.
- **benchmark/universe:** cash_only를 기존3종 계산 중 표시만 선택할지 계산 정책으로 바꿀지, universe를 coverage metadata로 둘지 실제 membership 필터로 바꿀지 결정. 기존 계산 유지·표시 선택 및 coverage metadata 유지가 현재계약과 가장 작은 변화다. 실제 필터 선택 시 목록/시점/누락 처리가 필요하다.
- **clone:** 원래 생성 요청(batch)과 선택 child의 실효 조건 중 복제 단위 결정. 원래 요청 정본 저장 후 batch 단위 새 validation·새 ID를 추천한다. complete input/version이 없거나 민감 redaction으로 복원할 수 없는 기존 기록은 clone unavailable을 유지하며 부분 값으로 기본값을 채우지 않는다.

기존 canonical 문서와 현재 source에서는 위 확장의 사용자 확정 값을 찾지 못했다. 이는 추천일 뿐 새 계약이 아니며 결정 전 구현하지 않는다. 이 결정 대기와 무관한 기존 경로 보존 검증은 계속할 수 있다.

## 현재 main 경로 보존 검증 결과

현재 main과 동일한 production runtime에서 기존 Next smoke36/36을 새로 통과했다. 새 역할3개 compatibility 이동/Back 및 legacy6개 route를3viewport에서 초기27/27(overflow assertion 추가 전) 확인했다. 수정 전 overflow assertion을 포함한 실행은23pass/4fail였으며1024px의 current/virtual/history 영역 가로 넘침을 발견했다. 아래 최소 CSS 수정 후 최종 실행은 같은 assertion으로27/27pass다. 계정/외부origin 실제 연결이나 full legacy payload 이관을 검증한 것이 아니며 loopback 합성 fixture의 HTML·기존 panel·GET-only·가로 overflow 보존 범위다. Browser 설정/결과/log/screenshot은 C:/Project/toss-trading-worklogs/main788-stack-20261006에 보존한다. build/quality/tooling23과 새 시험lint는 통과했고 backend runtime/scripts/quality 참조계약은 main과 동일하다. 이 단락의 최초 실행 당시에는 추가 root full을 실행하지 않았다. 후속 Draft 검증의 신규 root full 결과는 PR 본문과 별도 로그에 귀속하며 과거 Linux full을 신규 통과로 쓰지 않는다.

### 발견한 기존 legacy 폭 회귀와 검증된 최소 수정

1024px current 화면 document scrollWidth1048/viewport1024를 관측했다. 긴 합성 fixture 출처는 기존 .subtle의 white-space: nowrap으로 줄바꿈이 막혀 batch-run-panel의 암시적 auto grid 열을 확장했다. source의 min-width/overflow-wrap만으로는23pass/4fail가 유지됐다. grid 열을 minmax(0,1fr)로 제한한 뒤에는 요소 경계 넘침이 없어도 nowrap 텍스트가 scrollWidth1089를 만들었다. source에만 white-space: normal을 적용하고 grid 열을 제한한 최종 production 검증은27/27pass(27.4초)다. body overflow를 숨기거나 데이터/문자열/identity를 자르지 않았으며 동일한 assertion을 유지했다. 결과는 main809-legacy-wrap-final.log 및 main809-legacy-results.json에 남겼다. CSS는 legacy 정적 자산 변경이며 Next/API 로직 변경은 없다. root full의 과거 동일 입력 재사용을 이 CSS 변경에 대한 신규 통과로 주장하지 않는다.

### 독립 검토 후 정식 E2E 경로 보완

최초 공개 head a56151의 기본 configured origin은 기존 role-index의 missing/예제 origin 기대와 충돌했고 token selector의 first()는 실제 panel 대신 html을 선택할 수 있었다. 최초27pass는 이 두 결함 및 source 준비 대기 부재 때문에 실제 panel·완료된 데이터의 보존 증거로 쓰지 않는다.

기본 config의 origin 주입을 제거하고 기존 missing/3-origin 의미를 보존했다. legacy 시험은 tests/legacy-compatibility와 전용 production config로 격리하고 test:e2e에서 기본 suite 다음 순차 실행한다. 전용 script도 제공하며1440/1024/390px, worker1/retry0, 기존30s/5s를 유지한다. 실제 section.panel과 결속 heading을 검증하고 숨김·제거 negative control을 추가했다. batch 응답200·body 완료와 source의 실제 batch-replay-runs.jsonl 표시 후 overflow를 측정한다.

Home에서는 설치된 Chrome을 지정하고 log/output/cwd만 보정하는 외부 wrapper로 정식 config를 읽었다. backend는 현재 후보, Next는 제품 소스가 동일한 기존 materialized-dependency checkout에서 원래 dev 또는 production command로 실행했다. 브라우저 cache가 없어 npm script 자체를 그대로 실행했다고 주장하지 않는다. 기본 전체 suite38/38 및 role-index6/6, 전용 강화 production30/30을 통과했다. 기본 전체 검사에서 기존 comparison-header가 loading 화면 도중 boundingBox를 측정하는 경합을 발견해 loading 해제·두 실제 link의 visible assertion을 먼저 추가했으며 timeout/기존44px·keyboard/Back/overflow assertion을 유지했다. source/config lint/type은 별도로 확인한다.

사용자 승인 방향의 새 정본·기능별 실행 계획은 PR811이 소유한다. 이 PR은 숫자·benchmark 계산·membership·clone 의미를 구현하지 않는다. 부모의 a56151 Linux full4499pass/0fail/33skip는 그 이전 head 증거이며 새 head full 통과로 부르지 않는다.
