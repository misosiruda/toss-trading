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

The complete raw value must be an HTTP(S) origin with an optional single trailing slash before URL parsing. Dot-segment suffixes such as `/.`, `/path/..` and `/../` are invalid even when URL normalization would erase them. Existing credential, whitespace, backslash, percent, query, fragment and HTTP literal-loopback checks remain. Invalid origins render notices without compatibility links; no legacy endpoint is fetched.
## Local follow-on verification (2026-10-04)

Node24.19 and installed Chrome154 on Windows: unit198/198, production build, lint and type pass. Configured/missing/invalid production role-index coverage passes27/27 across1440/1024/390px, and a separate HTTPS `/path/..` invalid-origin production matrix passes9/9. These are current-local results, separate from the frozen object's unit197 and production27 history. These results precede the final-parent transplant; its verification is recorded separately. Linux full gate, independent review and complete legacy payload migration are not claimed.
## Final-parent transplant verification

This candidate has the exact final PR807 tree as its parent and adds eleven role-index source/test/document files only. The prior local dot-path candidate is preserved. After transplant: root and dashboard production builds, frontend unit198/198, lint and type pass; configured/missing/invalid role-index production27/27, HTTPS dot-path invalid-origin9/9 and existing dashboard smoke24/24 pass with synthetic fixtures and installed Chrome. API reader/tests/provenance-contract bytes match final PR806/807. No Linux full gate, independent review, Ready, merge, or complete legacy payload migration is claimed.
