# UX-00 설계 검증 기록

2026-10-02 · 문서 및 시안 검토 · production 구현 없음

## 통과한 확인

- 현재 `main d954915` 코드와 API/route/state 계약을 읽기 전용으로 대조했다.
- 별도 검토에서 발견한 legacy route 오기, `completed_with_failures` 누락, 전체 storage
  Risk/audit를 개별 run 근거로 혼동할 위험을 수정했다.
- `universe.preset` 미전달과 `universe.market`의 allocation 용도를 명시했다.
- UX-02의 입력 계약, 접수 후 실패 관측, 선택형 조건 확대를 작은 단위로 나눴다.
- Markdown 상대 링크 존재, HTML ID/label/ARIA 참조와 JavaScript 구문을 검사했다.
- `git diff --check`를 실행했다.
- 세 가지 Image Gen desktop concept를 실제 이미지로 확인했다. sidebar 208px, 목록 중심,
  2열 생성 form, summary의 차트 중심 배치를 반응형 HTML 시안으로 구체화했다.
- 생성 이미지의 가상 정책 버전·비용·bucket 값은 사실성 검토 후 채택하지 않았다.

## 자동 review finding 수정

자동 review의 P2 열일곱 건을 반영했다.

- 완료·진행·실패·미관측 모두 실행 ID가 포함된 상세 링크를 제공한다. 선택 ID의 이름·상태·
  관측 기록을 표시하며 완료 예시의 수치를 다른 실행에 재사용하지 않는다. 미확인 ID도 구분한다.
- 모바일에 접이식 주메뉴를 추가해 실험/전략·정책/비교/데이터/설정 구성을 유지한다.
  세부 메뉴는 production 기능이 아니라 기존 기능 이전표로 이어지는 명시적 구성 안내다.
- 부분 실패(`completed_with_failures`)와 건너뜀 예시/필터/상세를 구분한다. 부분 실패는 개별 run의
  `summary.aiDecisionFailureCount`를 사용하고 batch 완료·실패·skip 집계를 run 결과로 표시하지 않는다.
- `historicalBatchReplayWorkflow.ts`의 상태 생성·summary 보존 계약과 provider 실패 테스트를 읽어
  부분 실패 run에도 summary/report가 남는 것을 확인했다. 별도 합성 partial summary/근거/기록을
  연결하고 완전한 실행의 차트·지표·사건·ID를 재사용하지 않는다. 실제 backend 테스트 실행을 뜻하지 않는다.
- 같은 계약 대조에서 기존 run 조회 미확인과 생성 accepted를 분리했다. failed 예시는 저장된
  리플레이 처리 오류로, running 예시는 리플레이 진행 관측으로 고쳐 미지원 phase를 만들지 않는다.
- 상세 tab과 목록 filter를 URL에 보존한다. 직접 링크·새 문서 로드·뒤로/앞으로에서도 같은 tab과 조건을 복원한다.
- 별도 DOM 검토에서 찾은 skip link의 hash 충돌을 수정했다. 본문 이동은 현재 실행·tab·filter를
  바꾸지 않고 main에 focus를 옮긴다. 직접/reload 링크와 filter를 유지하는 뒤로/앞으로를 재검증했다.
- 성공 상태는 실제 backend와 같은 `completed` 값을 사용한다. 화면/run 전환 시 새 section으로
  focus를 옮긴다. Tab-only URL 변경은 표시 중인 control의 focus를 유지하되, 숨겨진 panel에
  남은 focus는 선택 tab으로 복구한다. DOM 회귀로 이를 구분했다.
- 목록 adapter의 activeRun/runId 결합·terminal 우선 dedupe와 서버 count 분리를 문서화했다.
- endpoint status와 fetch wrapper status를 분리하고 running 상태에서도 corruptLineCount 진단을 유지한다.
- persisted child 상태 네 값과 manifest-derived running, bucket queued, 조회 missing/unknown의
  출처·guard를 분리했다. 불가능한 저장 상태를 정상 row로 받아들이지 않는 테스트 계약을 명시했다.
- 병합된 UX-02b 관측 mapping을 추가했다. index missing과 runner_failed의 동시 존재는 runner 실패
  관측으로 알리며, accepted-only unknown·관측 판독 오류·batch/child 상태를 서로 덮지 않는다.
- filter 변경의 replaceState 직후에도 모든 목록 navigation 링크를 동기화하여 stale query 초기화를 막는다.
- 같은 문서 내 목록→상세→뒤로/목록 복귀 시 필터별 scroll 위치와 출발 링크 focus를 복원한다.
  새 화면은 위에서 시작하고 tab-only 이동에는 scroll을 바꾸지 않는다. 저장은 문서 메모리뿐이다.
- ID 없는 기본 상세 진입은 실제 표시한 resolved run ID로 route identity를 비교한다.
  첫 tab 선택을 실행 전환으로 오인해 focus를 section에 빼앗지 않으며 명시적 unknown ID는 유지한다.
- 단계 버튼을 실제로 focus한 뒤 활성화하는 회귀를 추가했다. 단계 이동은 새 heading으로 focus를
  옮긴 뒤 마지막 단계의 기존 다음 버튼을 숨겨 hidden control에 focus가 남지 않게 한다.
- 마지막 단계의 요청/실효값 확인 주장을 수정했다. 현재 raw 초안은 전체 요청 필드를 표시하되
  effective/notices는 미조회로 유지하고, 별도 고정 pure validation 응답 예시는 원문 전체와 생성
  근거를 표시한다. 두 입력을 혼동하지 않으며 새 검증·source 조회·runner를 실행하지 않는다.
- HTML을 읽을 수 있게 포맷하고 임시 JSDOM 검증으로 desktop/mobile ID별 링크, 상태별 상세,
  미확인 ID, mobile menu의 이동/닫힘, 검색/필터/empty, 3단계 이동/입력 보존/요약 갱신,
  키보드 tab 이동, ID/ARIA 참조와 JavaScript error 부재를 확인했다.

JSDOM 검증은 DOM 동작 검사이며 실제 viewport·pixel·layout·browser 접근성 검사와 다르다.
이 검증 도구는 repo dependency에 추가하지 않았고 production 코드도 변경하지 않았다.

## 통합 DOM 동선 행렬

다음 push 전에 동선 행렬 70개와 focus 회귀 52개, 부분 실패 계약 회귀 41개, 기본 상세 alias 회귀 84개를 점검하고,
발견한 결함도 함께 수정했다.
현재 route의 모바일 메뉴 재선택 닫기, 직접 query의 추가 `?` 보존, 선택 카드의 고정 위험 설정
문구·개별 run 부분 실패 표시·landmark/focus 수정을 포함해 재검사한 HTML SHA256은
`d9cdd32c2f2543279a7323dd33f7589a1a9eee9069ed313d1453345d34fbd6e1`다.

70/70 통과 범위: desktop/mobile 및 viewport 전환 후 출발 run focus, 목록 scroll/filter/history,
직접주소·새 문서의 tab/filter 복원, 6개 예시 상태·missing/empty, 단계 입력/요약, 키보드 tab,
skip link, 같은 menu 재선택, raw/encoded query 보존과 인코딩된 입력의 DOM 비실행.
추가 52/52 통과 범위: focus 후 next/previous·최종 단계 전환, tab/summary CTA·history,
목록 복귀, skip link와 모바일 메뉴 활성화. 같은 실행의 summary 버튼에서 Back으로 evidence에
복귀할 때 focus가 숨겨진 panel에 남는 독립 검토 결함도 선택 tab으로 복구하도록 수정했다.
추가 41/41 통과 범위: 완료→부분 실패→완료 전환, 부분 실패의 각 tab 직접주소/reload/back/forward,
개별 run의 판단 실패·호출·모의 체결 수, 별도 incomplete 근거/기록, 완료 예시 chart·ID·사건의
비노출, 부분 실패 CTA와 숨겨진 panel focus 복구, 필터별 목록 복귀 및 비완료·미확인 ID 회귀다.
추가 84/84 통과 범위: header·생성 마지막 단계·직접 기본 상세 진입, 빈 ID와 query/reload/history,
첫 tab click·방향키·Home/End·CTA의 focus 보존, 명시적 unknown ID의 fallback 금지다.
기본 DOM 검사도 통과했다. 전체 247개 행렬은 임시 검사 도구로 수행했으며 전체 Node gate와는
별도 검사다. 전체 gate 결과는 해당 PR의 검증 tree를 기준으로 기록한다.
Scroll/focus는 stub 기반 DOM 검사다. 새 문서 로드에서는 문서 메모리의 scroll/focus 기록이 초기화된다.
실제 browser pixel/layout/접근성이나 생산 API 통합이 완료됐다는 뜻은 아니다.

## 최종 확인 필드·응답 provenance 회귀

현재 HTML `d9cdd32c2f2543279a7323dd33f7589a1a9eee9069ed313d1453345d34fbd6e1`에서
기존 247/247과 새 확인 단계 45/45, 총 292개 행렬 및 기본 DOM 검사를 통과했다.
추가 검사 범위는 전체 raw 요청 필드, 변경 입력의 미검증 유지, 고정 응답 불변,
runCount 3→1/Codex limit 31→0와 모든 notices, 실효 risk/exit/비용/benchmark/tick/source-kind,
현재/고정 입력별 29개 조건 비교 행, 변경 초안과 고정 실효값의 분리, 전체 raw JSON을 마지막의
접힌 검사에 두는 순서, 접기/펼치기 focus, 안전한 텍스트 렌더링, preview CTA 및 네트워크 부작용
부재다. 한 열의 모바일 비교 행 CSS는 준비했지만 새 영역의 실제 overflow는 Chrome에서 재검증한다.

[응답 원문](validation-response.example.json)의 SHA256은
`096accd82104372e21739c66a9f670a3ad9f05fe4bda2590805a6ff80c4d71a6`다.
commit `06c862b0d84a4c50c0fca69ed8a26daf7deea897`의 현재 source와 실행한 dist 모듈을
in-memory transpile 결과로 대조했다. `validatePaperSimulationCandidate`를 고정 requestedConfig와
빈 env로 호출해 원문과 deep equality를 확인했다. 해당 함수 호출 중 filesystem read/write,
network, subprocess entry point를 감시해 호출 0을 확인했다. source data path는 존재를 조회하지
않았고 fixture의 valid를 데이터 가용성/실행 성공으로 해석하지 않았다. 이 변경에서 production
코드는 수정하지 않았다. repository 전체 gate 결과는 해당 PR의 최종 검증 tree를 기준으로 기록한다.

이 전체 조건 표시 버전은 이후 f481eb5의 실제 Chrome에서 기능·접근성 426개 검사를
통과했지만 모바일 확인 화면의 지나친 세로 길이가 사용성 실패로 확인됐다. 아래 기록처럼
통과 범위와 이 실패를 분리하며, 간결한 새 후보의 Chrome 검증은 별도로 기다린다.

### 간결한 확인 단계 후보의 DOM 회귀

현재 후보 HTML SHA256은
`79fd5b4691660436743905e428f5aab59f02e1e49be048bdf733b46d063172af`다.
기존 292/292와 간결한 확인 단계 18/18, 총 310개 행렬 및 기본 DOM 검사를 통과했다.

- 기본 화면은 현재 요청의 8개 핵심 묶음, 미검증·source 미조회, 고정 예시의 3→1/31→0
  정규화 차이와 preset/시장 필터 미적용 경고만 표시한다.
- 현재 전체 29조건, 현재 입력과 무관한 고정 응답 예시, 원문/생성 근거를 닫힌 details로 분리했다.
  고정 예시 안의 전체 29조건도 별도로 펼친다. 자료·원문 hash·계약·서버 실효값 계산은 바꾸지 않았다.
- 3단계에서는 중복 입력 요약 aside를 숨기고 이전 편집 단계로 돌아가면 복구한다.
- 추가 회귀는 닫힌 상세의 실제 DOM 가시성, 순차 펼치기/닫기와 focus, 전체 필드·notices·원문
  접근, 변경 입력 요약, preview/history 이후 문맥, network·runtime 오류 부재를 확인했다.
- 390×844의 기본 확인 화면을 1–3화면 안에서 검토하는 것을 목표로 한다. DOM 검사는 pixel
  높이를 측정하지 못하므로 목표 달성·세로 길이·가로 overflow·실제 키보드는 새 Chrome에서 확인한다.

**현재 간결한 후보의 실제 Chrome QA는 대기 중이다. f481eb5의 426개 통과를 새 후보의
통과나 세로 길이 문제 해결로 재사용하지 않는다.**

## 실제 Windows Chrome 1차 검증 (9134619)

사용자 노트북에서 정식 실행 권한 승인 후 격리한 headless Chrome으로 확인했다.
보안 설정 변경이나 클라우드 접근 제한 우회는 없었다. 검증 대상은 commit `9134619`,
HTML SHA256 `7999b80f7531bbdeffd40c1811145b766efc7dbad074f699309680cfeaee7315`다.
환경은 Windows Chrome `154.0.8037.93`, Playwright `1.61.1`, axe `4.12.1`이다.

- 1440×1000 / 1024×900 / 390×844: 목록, 생성 3단계, 001/005의 summary/evidence/record
- pointer·keyboard focus, 입력/요약, 방향키·Home/End tab, skip link, Back/Forward, filter,
  목록 scroll 복원(47/228/400px), 모바일 메뉴·touch 동선 통과
- 가로 overflow 없음, console/page error 0, 외부 API 요청 0
- 계산한 아이콘 contrast 4.97–7.11 통과
- 전체 252 checks 중 212 pass / 40 fail. 반복된 실패는 아래 두 종류이며 완료로 보고하지 않는다.
  1. axe region: `.demo > span`, 모바일 `.mobile-brand > div`가 landmark 밖에 있음
     (37개 상태에서 moderate best-practice 실패)
  2. detail tab focus outline의 위·아래가 clip됨 (3개 해상도). partial005 summary의 요약 tab에서
     Left로 기록 tab에 이동할 때 재현. focus 이동 자체는 정상이다.
- `.steps[aria-label]`은 Chrome 접근성 트리에서 name이 확인됐지만 screen reader 동작은
  미검증이다. 이를 보편적인 접근성 통과로 해석하지 않는다.

이 두 결함은 `d60fc57`에서 시안 안내·모바일 branding을 하나의 banner landmark 안에 묶고,
가로 스크롤이 필요한 tab의 focus outline을 control 안쪽으로 표시하여 수정했다.

다른 browser/device, screen reader, production API 통합은 실행하지 않았다. 실제 제품에서는
예시 데이터 대신 격리 fixture API로 검증해야 한다.

### 실제 Windows Chrome 2차 검증 (d60fc57)

대상 commit `d60fc57`, HTML SHA256
`03d74eabb941e398eab081d85f3d7b4ba5c8ec85eb3ac15c920a990a8f176502`를 사용자 노트북에서 확인했다.

- 기존 matrix 252/252 통과. axe 37상태 violation 0, landmark/outline 결함은 3해상도에서 해소됨
- console error와 가로 overflow 없음
- 새 기본 상세 회귀는 18/18 실패로 재현됐다. 직접 `#detail`, header 링크, 생성 마지막 단계 진입
  × 3해상도에서 첫 tab click/arrow의 URL과 선택 tab은 정상이나 focus가 `#screen-detail`로 이동했다.
- 즉 기존 matrix 통과가 모든 동선 통과는 아니다. 이 추가 결함도 수정 대상으로 유지했다.

기본 상세의 실제 표시 ID를 lookup/route identity에 공통 사용하고 빈 ID의 첫 tab URL도
canonical ID로 기록하도록 수정했다. 독립 DOM alias 84개와 기존 163개가 모두 통과했다.

### 실제 Windows Chrome 3차 검증 (06c862b)

사용자 노트북의 검증 결과에서 commit `06c862b`, HTML SHA256
`ee24a4a70414ce11fff697e57b8207077db4875bf5ad81a2c472be2eaf7095b8`의 exact 일치를 확인했다.

- 기본 상세 alias 18개와 기존 matrix 252개를 합친 270/270 통과
- 1440×1000 / 1024×900 / 390×844의 landmark·outline·focus 통과
- axe 37상태 violation 0, console/page error 0, 가로 overflow 없음
- screen reader, 다른 browser/device, production API 통합은 미검증

이 결과는 위 exact HTML에 한정한다. 이후 추가한 최종 확인 필드/고정 응답 예시의 실제
Chrome 검증은 새 후보에서 기존 matrix와 함께 다시 수행해야 한다.

### 실제 Windows Chrome 4차 검증 (f481eb5)

대상 HTML SHA256은
`d9cdd32c2f2543279a7323dd33f7589a1a9eee9069ed313d1453345d34fbd6e1`이다.

- 기존 270개와 새 확인 단계 156개, 합계 426/426 기능·접근성 검사 통과
- axe 43상태 violation 0, console/page error 0, 가로 overflow 없음
- **별도 사용성 실패:** 390×844 기본 확인 화면이 11,542px, 모두 펼치면 22,075px였다.
  가로 overflow·기능 테스트 통과가 확인 화면의 세로 길이와 검토 편의성을 보장하지 않았다.
- 이 결과를 근거로 기본 요약과 점진적 펼치기로 재구성한다. 새 후보는 기존 전체 검증과 함께
  기본 높이, 핵심 조건·경고 노출, 전체 조건/고정 예시 열람, 모바일 keyboard/focus를 재검증해야 한다.
- screen reader, 다른 browser/device, production API 통합은 여전히 미검증이다.

### 최초 클라우드 검증 제한 기록

초기에는 아래 제한으로 실제 HTML browser 검증을 실행하지 못했다. 이후 연결된 사용자
노트북에서 위 1차 검증을 수행했으며 아래 제한을 우회한 것은 아니다.

1. Cloud browser의 local preview: `net::ERR_BLOCKED_BY_CLIENT`
2. Cloud browser의 local file 문서: 지원 protocol이 http/https로 제한되어 거절됨
3. 설치된 Chromium의 Playwright launch: `socket() failed: Operation not permitted`
4. 지원된 실행 권한 요청 후 재시도에서도 같은 Chromium socket 오류

새 배포/외부 hosting 또는 계정 변경은 없었다. 시안 검증과 production UI 완료·병합을 구별하며
browser 검증 조건을 생략하지 않는다.

## 재개 시 검증 동선

- 목록: 이름/상태 필터 → empty → 초기화 → 완료 예시 상세
- 생성: 위험 설정 → 데이터 단계 → 값 수정 → 확인 → 이전 → 값 보존
- 상세: 요약 → 판단 근거 → 방향키로 기록 tab → browser 뒤로
- 1440×1000, 1024×900, 390×844에서 heading, overflow, 표/모바일 목록, 2열/1열 form,
  chart/inspector, primary action, error text, focus를 검사
- 실제 구현에서는 예시 dataset 대신 격리 fixture API와 같은 동선을 수행하고 create가 한 번만
  발생했는지, 같은 batch/run ID로 조회하는지 검증

HTML 시안의 browser 동작은 layout/prototype 예시이며 validation 또는 runner를 호출하지 않는다.
고정 validation 응답은 문서 작성 시 pure validator만 호출해 얻은 별도 자료다. 기능 명세의
정본은 product-plan/technical-design이고 구현 PR의 완료 증거는 해당 PR에 따로 기록한다.
