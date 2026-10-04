# UX05 구현 계약

## 후보와 의존성
별도 branch feat/experiment-workspace-evidence-ux05, local base379fae20106f28c0a2b3d1426e048efe204ca626/tree407afa5a19b32cdc5ab47228419cb030abcc32bc. PR803 remote는 아직3dc33125639a873ad89bd78c12337167ef5fc145이고 그 base는 PR80252888e59b949b7f6adbabaff216d49643bef1eae다. UX05를 PR803에 섞지 않는다. 상위 hold 해소 전 merge하지 않는다.

## 읽기와 식별
기존 no-store GET /batch/replay/runs reader의 단일 응답을 재사용한다. 선택 child와 latestRunArtifacts.runId의 정확한 일치가 선행조건이다. 다른 child 또는 판독 blocked/invalid면 해당 record 연결을 차단한다. 개별 record에 runId가 있다면 같은 child인지 다시 검사한다. 브라우저 filesystem, 전체 운영 Risk/audit의 run 근거 전용, 실행/mutation/provider 호출은 없다.

## record와 참조
packet은packetId,provider bundle은packetId,Risk는riskDecisionId,trade는tradeId로 식별한다. 각 종류에서 중복 ID는 모호하며 first/last-wins로 연결하지 않는다. packetId의 명시적 참조와 trade.decisionId→riskDecisionId만 검증한다. provider item→Risk의 독립 durable 참조가 없으므로 직접 인과 연결은 unavailable로 표시한다. timestamp·symbol·배열 위치로 인과 관계를 만들지 않는다. source event 순서를 유지하며 시간 역전/같은 시각을 진단한다.

## 상태와 자료 범위
자료 판독ok/missing/corrupt/degraded/blocked/invalid,raw schema invalid,wrong run,중복/모호한 참조,누락/잘림 가능성을 구분한다. 각 배열은 현재 마지막100개이며 전체 건수/손상 건수를 표시한다. 잘린 화면 범위에서 못 찾은 참조를 영구 artifact 누락으로 단정하지 않는다. 0건은 정상 빈 배열만 의미한다. 실행 status와 evidence 상태를 합치지 않는다.

## UI와 URL
기존 workspace palette/navigation/type/44px/focus 시스템과 정본 detail의 목록+inspector 구성을 따른다. replay는 저장된 packet 사건 목록, evidence는 packet/provider/Risk/trade 목록과 inspector다. 검증된 자산 시계열이 없으므로 금융 차트/재생은 지원하지 않는다. tab=replay|evidence 및 event=kind:id가 공유/reload/Back/Forward 가능한 선택이다. 유효 선택은 URL에서만 파생한다. 알려지지 않은/중복 선택은 명시적 unavailable이며 다른 record를 대신 보여주지 않는다. 선택 링크 포커스를 보존하고 mobile은 inspector를 한 열로 노출한다.

## 완료 검사
정상 explicit reference,source child mismatch,per-record wrong run,invalid schema,missing/duplicate/ambiguous/orphan/out-of-order/truncated/empty fixtures의 pure unit. production1440/1024/390px GET-only,URL/reload/history,keyboard/touch/focus,axe/console/overflow/screenshots. 기존 unit/type/lint/build와 영향을 받는 UX04/기본/Wizard 회귀를 검증한다. root full은 현재 Windows 제약을 통과로 바꾸지 않는다. 합성 fixture만 사용하며 설치/보안/소유권/credentials/paid AI/live trading/운영계정 변경은 없다.

## 판독과 화면 경계
기존 API envelope의 selected child를 사용하며 filesystem 내용의 run identity를 새로 증명하는 기능은 아니다. record에 runId가 있으면 재검사한다. raw provider/path/credential 필드는 전달하지 않고 bounded whitelist만 표시한다. provider 항목별 Risk 인과 참조는 저장되지 않아 unavailable로 남긴다. replay는 저장된 Packet 탐색만 지원한다.

## 화면 확인
accepted detail의 rail/header·기존 palette/type·네 탭·list/inspector·mobile 단일 열을 대조했다. 실제 1440/390px 캡처에서 5개 항목을 확인했다. 기존 인과 표와 금융 chart는 현재 source contract로 증명할 수 없어 명시적 참조 inspector와 저장 Packet 목록으로 구현했다. 긴 raw 필드는 접힌 JSON에 한정한다. overflow/axe/console/focus는 production 테스트로 확인한다.

## 로컬 검증 결과
최종 frontend source: unit144/144, type/lint/build 통과. UX05 production24/24와 상세 workspace33/33 (1440/1024/390px), 기본 production30/30, Wizard66/66 통과. 마지막 두 suite는 동일 reader/정상 projection 소스로 통과했으며 이후 child 라벨·중복 ID fail-closed·탭 순서 보완은 unit 및 UX05/상세 회귀로 재확인했다. retry/skip/flaky0. 합성 fixture만 사용했다.
root review는 frontend 파일 영향이 unresolved로 전체 suite fallback: 4462 중4442pass/18fail/2skip. build/quality/tooling 통과. 기존379fae와 실패 이름·위치 동일18개, symlink EPERM14개. Node 실행 중 frontend 라벨/중복/탭 순서가 바뀌어 이 결과는 final exact-HEAD merge 증거가 아니다. root source/lock 변경 없음. Linux full gate·최신 독립 review·원래 PR802 간헐 URL commit 문제 해결은 미완료다. 원격 push/PR 생성/Ready/merge는 하지 않았다.

## syntax-corrupt JSONL 참조의 불완전 관측

API가 문법 파손 행을 drop하고 corrupt count를 반환한 collection에서는 로드된 대상이 없더라도 missing/outside_loaded_range로 단정하지 않는다. corrupt count가 양수면 unavailable이다. 정상 로드된 exact 대상은 linked를 유지하며 중복은 ambiguous다. UI 소유 integration은 실제 JSONL 파손→API GET→UI projection을 1행 및100건 초과 반환 조건에서 검증한다.
