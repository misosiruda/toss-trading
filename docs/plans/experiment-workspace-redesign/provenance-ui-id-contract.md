# UI exact child lookup 계약

API와 UI provenance/comparison은 같은 안전 lookup 문법을 사용한다. 첫 문자는 영문·숫자·hyphen, 이후 영문·숫자·underscore·dot·hyphen이며 최대256자다. 현재 YYYY-MM과 legacy YYYYMM은 개별 형식 예외 없이 허용한다. invalid UI ID는 fetch하지 않고 exact ID를 GET query에 한 번 encode한다. 실제 저장 구조 유효성은 API manifest/index/path 검증에 맡긴다.

comparison parser와 HTML form은 childLookupId helper를 공유한다. 상세 runWorkspace는 기존 raw legacy batch alias transport의 더 넓은 계약과 공백 alias 허용을 보존하며 provenance에는 exact child를 전달한다. 목록의255자 filesystem-component 표시 제한도 유지한다. 모든 producer/alias의 전체 UI 호환을 주장하지 않는다.

UI writer integration은 실제 현재 writer16개/child32개와 역사적 순수 ID 함수3개로 구성한 legacy record96개를 실제 local HTTP와 readRunProvenance fetch/projection으로 읽는다. 옛 workflow 전체 실행은 아니다. redaction·partial·clone/comparability unavailable·GET-only·runner/provider 호출0을 유지한다.

production browser의 별도 합성 HTTP fixture는 현재/legacy leading-hyphen ID3개의 목록→상세→reload→Back 및 comparison form validity→exact query→양쪽 provenance→상세→Back을 검증한다. 이 시험과 실제 writer integration은 서로 다른 증거이며 완료 결과는 로컬 handoff에 기록한다.

root build 후 node --test apps/dashboard/tests/provenance-contract/writer-ui.test.mjs를 실행한다. integration은 dashboard unit glob과 분리한다. 합성 자료만 사용하며 유료 AI·실거래·운영 계정은 사용하지 않는다. 공개 bb90fdd/118ba60/faf9560은 보존한다. Linux full·Security·독립 리뷰·게시 승인은 별도다.

## 별도 기존 PR 소유 변경

header 비교 링크의 comparisonAction은 filter reset의 secondaryAction과 분리한다. 좁은 화면에서는 기존 새 실험 button의 row1/column2를 보존하고 비교 링크를 row3 전체 폭, 안내를 row4에 둔다. keyboard Tab/Enter·Back·overflow와 computed spacing을 production에서 검증한다. 이는 비교 PR805 소유 변경이며 ID/UI 또는 UX07 PR에 합쳐 넣지 않는다. syntax-corrupt 참조 후속은 UX05/PR804, structured requestedRunId 마스킹 후속은 API/PR806 소유다.
