# Whole-batch clone UI 범위 고정

기준: 실제 병합 main4db02564(PR815), 승인된 기능 계획5단계. Backend canonical 저장·exact read 계약과 계산/runner는 수정하지 않는다.

- detail의 요청 exact batch ID만 cloneFrom으로 새 wizard에 전달한다. child의 선택 window/data.batchId/latest를 source ID로 대신하지 않는다. URL에는 ID만 넣고 입력 JSON·token·receipt는 넣지 않는다.
- same-origin GET BFF에서 bounded canonical DTO를 읽고 ID/version/runtime UUID/hash/완전한 typed 원요청을 확인한다. unavailable/legacy/masked/corrupt/size/transport 오류는 복제 불가이며 초기 기본값으로 대체하지 않는다. GET은 쓰기와 create를 하지 않는다.
- 원래 whole-batch requestedConfig를 보존한 채 기존 wizard의 소유 입력만 사용자가 수정할 수 있게 한다. 원래 seed·random 범위·runCount/costs의 생략 여부와 universe.preset/provider/model/schema/maxCodexCalls 등 원요청 조건을 조용히 바꾸지 않는다. 상속 조건은 표시하며 provider 권한·현재 서버 guard는 유지한다. agent 검증은 dry_run 합성 fixture만 사용한다.
- clone 입력은 항상 미검증으로 시작하고 입력 수정·source 변경·Back/reload 후 현재 validation을 다시 받아야 한다. 원래 source와 편집 raw draft는 분리하며 receipt·credential·response 상태를 입력처럼 복원하지 않는다. fresh exact read와 맞는 source binding의 raw draft만 재진입에 재사용한다.
- 기존 create 경로에 사용자 확인과 현재 token으로1회만 제출한다. 정상202의 exact ID를 보존하며 원래 source ID와 다른 새 ID만 새 실험으로 인정한다. 원래 실행/파일을 덮지 않고 seed를 자동 변경하지 않는다. 같은 시각 ID 충돌은 기존409 처리다.
- per-tab admission barrier와 unknown 재전송 금지를 유지한다. 이미 알려진 accepted 요청 뒤 별도 새 실험 준비는 명시적 사용자 행동으로만 허용한다. unknown barrier를 clone 진입으로 지우지 않는다. late response는 최신 사용자 navigation/source를 덮지 않는다.
- 완료: 원래 요청/optional/숨은 metadata의 무손실 복원, 현재 validation/create1/새ID/source 불변, incomplete/unavailable 및 malformed DTO negatives, unknown/no-retry/accepted Backreload, stale load·validation·navigation, keyboard/axe/overflow·3viewport 실제 production 합성 검증. UI unit/lint/type/build와 공식 진입점을 유지하고 timeout/assertion을 완화하지 않는다.

PR814 benchmark 탭 query 초기화 UX와 UX06 완전 비교 가능성 및 원래 soft-navigation 미확정 원인은 별도 잔여 범위다. 전체 ROADMAP_COMPLETE를 선언하지 않는다.