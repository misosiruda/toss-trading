> 2026-10-06 사용자 결정: 아래 비용·benchmark·universe 질문은 결정 전 이력이다. 사용자는 네 추천 방향을 승인했다. 현재 정본은 [승인 계약](approved-options-contract-20261006.md), 실행 순서는 [기능별 PR](approved-options-pr-plan-20261006.md)이다. 숫자 preset·실제 membership filter·유료 AI 활성화는 승인되지 않았으며 후속 구현 전 기존 guard를 유지한다.

# UX07 역할별 index와 호환 진입 계약

Initial implementation baseline: PR807 `764829e8b143c2ae327fc0e52e1ebc01c85d4da3` (historical). The frozen review object `69d2b274d7e01d411f5a15cafc9cdfc554b0cac7` has parent `d459137148bf92757e434dc62ee295575cdd3476` and tree `ef9308db4c598cdbe4a1bec532adf340a2dfe65b`. That historical public object remains unchanged. This next candidate is transplanted onto final PR807 `ee691908bece97f552d71158f059973dc4d8a747`, tree `e21a903cc76d38105c775ff89a925f51cd8ad9df`, which includes final PR806 `3099348326e25a7d8899a3341ccfe290c4fc51c6`. Only eleven role-index source/test/document files differ from that UI base; API reader/tests/provenance contract retain the final stack bytes.

## 경로 목적과 보존 계약

| 진입 | 목적 | 보존 조건 |
| --- | --- | --- |
| `/dashboard` | 현재 실험 목록·필터 | 기존 query 정규화, draft, Back/Forward, focus 계약 변경 없음 |
| `/dashboard/strategy` (신규) | 기존 정책·portfolio·bucket 테스트 index | 정책 직접 실행 미지원 안내; 기존 개별 경로 보존 |
| `/dashboard/data` (신규) | 현재 validation·coverage 및 실행별 근거 진입 | coverage fragment는 기존 URL/history/focus 처리 사용 |
| `/dashboard/settings` (신규) | 운영 종합·Risk·audit·진단·catalog index | 읽기 전용 안내, live disabled 유지 |
| `/dashboard/experiments/compare` | 정확한 두 실행 ID 비교 | 기존 ID query 및 비교 관측 계약 보존 |
| 새 실험·exact run detail·bucket new | 기존 생성/상세/테스트 | 경로·query·accepted ID·Back/reload 계약 변경 없음 |
| legacy current·validation·overview | 미이전 자료 호환 화면 | 고정 세 경로만 서버 설정 origin에 결합. 기존 legacy 기능 전체를 새 read-only 화면으로 보증하지 않음 |

신규 index는 native document anchor를 사용하며 이력·query를 복사하거나 rewrite하지 않는다. 뒤로가기는 브라우저 원래 entry로 돌아간다. skip link는 유일한 main으로 이동하고 각 역할에는 유일한 h1이 있다. 기존 목록의 직접 정책/검증 fragment 및 운영 링크는 보존하고 운영 메뉴에 index 진입만 추가한다. 기존 경로 삭제와 자동 redirect는 없다.

## 호환 origin

서버 전용 `DASHBOARD_LEGACY_ORIGIN`에 운영자가 명시한 origin만 허용한다. 설정 변경 자체는 이번 작업에 포함하지 않는다. HTTPS origin 또는 명시적인 HTTP localhost/127.0.0.1/[::1]만 허용한다. credential, path(단일 `/` 제외), query, fragment, 공백, backslash, percent encoding, 잘못된 port를 거절한다. URL parser의 숫자 loopback 자동 변환도 HTTP 허용 근거로 사용하지 않는다.

검증은 URL 형태의 검증이며 소유권·서비스 건강·자료 가용성 검증이 아니다. Next 서버는 호환 origin을 fetch하지 않는다. query, localStorage, API proxy 설정, API 응답에서 origin을 유도하지 않는다. 반환 redirect endpoint나 임의 목적지 입력은 없다. absent/invalid 상태에는 raw 설정값이나 자격증명을 표시하지 않고 링크를 만들지 않는다. runbook 저장소 문서 경로와 실제 실행 panel을 구별해 안내한다.

## 완료 조건

- 합성 configured/missing/invalid origin의 링크·안내 및 부정 parser 회귀
- 1440/1024/390px에서 유일한 main/h1, overflow, keyboard, axe, screenshot, console 및 실제 index→기존 화면→Back/reload 검증
- 기존 operations·validation fragment 회귀와 기존 경로 smoke
- build/lint/type/quality, 관련 unit 통과; PR802 원인 미규명 hold 유지

## UX02c 사용자 판단 질문

1. 비용 선택은 기존 0 bps 기본값 외에 **사용자가 직접 bps 값을 지정하는 방식**과 **수치가 고정된 preset 방식** 중 어느 쪽을 원하시나요? preset이면 수수료·세금·슬리피지 등 각 수치의 근거와 값을 먼저 정해야 합니다. 이는 paper 손익 계산값이며 AI 사용료나 실제 청구 비용과 별개입니다.
2. `cash_only`는 **기존 3종을 계산하되 cash만 화면에 표시**하는 선택인가요, 아니면 **cash benchmark만 계산·기록**하는 실행 정책인가요? 현재 서버는 고정 3종만 지원하며 이 선택을 거절합니다.
3. universe preset은 **현재 source 종목을 유지하며 coverage 요구만 지정**할까요, 아니면 **정해진 membership으로 실제 replay 종목을 제한**할까요? 후자라면 종목 목록·기준 시점·누락 시 실패/제외 정책을 먼저 정해야 합니다. 현재 preset은 요청 metadata입니다.

위 선택지는 현재 기능을 설명하는 계약과 workflow 연결점에서 도출한 확장안이며, 정본에 정의된 신규 preset 수치나 filtering 정책이 아니다. 결정 전 미지원 guard를 풀거나 수치를 만들어 넣지 않는다.

## Raw-origin follow-on

The latest raw-origin guard also rejects every C0 control and DEL before URL parsing, and rejects any raw `@`, including empty userinfo such as `https://@a.test`. Its preserved predecessor candidate `7d454dbffeb2e05c2ae762e1844f1ee933020b5d` (tree `95d4204d64b8f24ba60b1f2982e40035ee872c74`) passed unit199, raw-control position99 and userinfo7 cases, plus production control9/userinfo9, build/lint/type. These are predecessor scope results, not a new integrated full gate. The updated stack retains the current API masking and safe-ID contracts, corrupt-reference uncertainty, and UX04 source/timer/lastGood behavior while merging the eleven role-index files. Full legacy payload migration and unresolved UX02c choices remain outside this implementation.

The complete raw value must be an HTTP(S) origin with an optional single trailing slash before URL parsing. Dot-segment suffixes such as `/.`, `/path/..` and `/../` are invalid even when URL normalization would erase them. Existing credential, whitespace, backslash, percent, query, fragment and HTTP literal-loopback checks remain. Invalid origins render notices without compatibility links; no legacy endpoint is fetched.
## Local follow-on verification (2026-10-04)

Node24.19 and installed Chrome154 on Windows: unit198/198, production build, lint and type pass. Configured/missing/invalid production role-index coverage passes27/27 across1440/1024/390px, and a separate HTTPS `/path/..` invalid-origin production matrix passes9/9. These are current-local results, separate from the frozen object's unit197 and production27 history. These results precede the final-parent transplant; its verification is recorded separately. Linux full gate, independent review and complete legacy payload migration are not claimed.
## Final-parent transplant verification

This candidate has the exact final PR807 tree as its parent and adds eleven role-index source/test/document files only. The prior local dot-path candidate is preserved. After transplant: root and dashboard production builds, frontend unit198/198, lint and type pass; configured/missing/invalid role-index production27/27, HTTPS dot-path invalid-origin9/9 and existing dashboard smoke24/24 pass with synthetic fixtures and installed Chrome. API reader/tests/provenance-contract bytes match final PR806/807. No Linux full gate, independent review, Ready, merge, or complete legacy payload migration is claimed.

## 현재 main 통합 검증 범위 (2026-10-06)

PR807 merged main dc137b451e346fa33136469da5392714a4c5eeec을 기준으로 원본 후보를 보존한 별도 브랜치에서 통합했다. UX07은 역할별 index·고정 legacy 목적지·origin parser 및 안내의 11파일 범위, native는 그 부모 위 목록 exact document navigation·SSR bootstrap·최신 intent 취소 경계의 8파일 범위다. API/provenance 마스킹·행 상한·portfolio 코드는 현재 main을 유지한다.

두 후보의 현재-main root build 및 dashboard 표준 unit209/209를 새로 확인했다. 이는 새 production/browser나 독립 Linux full 통과를 뜻하지 않는다. 이전 후보 증거와 새 검증은 구분한다. 모든 legacy payload 이관, high_cost/cash_only/universe preset 의미 확장 및 기존 PR802 create 간헐 정체 원인 해결을 완료했다고 주장하지 않는다. 후속 PR 게시 전 해당 production history/focus/keyboard 및 navigation 경계를 확인한다.

### 현재 후보 production 및 self-review 증거

현재 소스에 대해 원래 Next16.2.9 Turbopack production build·lint·type을 새로 통과했다. 설치된 Chrome과 정식 Playwright runner, workers1/retries0/30초 test 및5초 expect를 사용했다. 외부 작업 기록 폴더에 config·결과·스크린샷을 보존하며 합성 loopback fixture만 사용한다. missing/configured/invalid origin 각각 역할3개×viewport3개를 검증한다. 실제 history·Back/reload·fragment focus·keyboard·axe·overflow·민감 raw origin 비노출을 확인한다.

self-review에서 origin의 raw dot/control/userinfo/scheme/port 경계와 고정 href 구성, main API/provenance 코드 동일성, native capture/defaultPrevented·초기 document load·menu focus·외부 anchor 정책 상호작용을 확인했다. 잘못된 node --test의 Playwright runner 오류는 원본 로그로 보존하고 제품 실패나 유효 browser 결과로 계산하지 않는다. 원래 soft-navigation 간헐 정체 원인은 미확정이다. 후속 PR는 기능별 Draft이며 독립 exact-tree 검증 전 완료/merge를 주장하지 않는다.
