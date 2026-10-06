# UX06 관측 출처와 근거 결합 수정

기존 후보 `bb0b2d577706ae8f02273601b3b9db432f3116f2`는 유지하고 별도 수정 후보에서 처리한다. provenance GET 구현과는 별도 범위다.

`GET /batch/replay/runs` reader는 전체 records에서 `selectedRun`과 artifact 대상 record를 선택한 후 반환 목록을 마지막 `limit`개로 자른다. 기존 응답의 `totalCount`는 전체 파싱된 records 수이고 `corruptLineCount`는 파싱 불가능한 줄 수다. 반환 목록만 검사하여 전체 child ID 유일성을 주장할 수 없다.

- endpoint `blocked`는 빈 목록 해석보다 먼저 보존한다. 차단을 저장 실행 없음으로 표시하지 않는다.
- 저장 `runs[]`는 종료 상태만 허용한다. 진행 관측은 자신의 정확한 `activeRun.runId`와 running batch가 있어야 한다. artifact ID로 누락된 identity를 보충하지 않는다. 화면은 `stored_terminal`과 `manifest_active` 출처를 구분한다.
- terminal 기록은 manifest가 없는 정상 aggregate fallback(`batchId/batchStatus:null`)에서도 exact row와 selectedRun이 일치하면 관측한다. manifest가 있을 때 matching raw batch label을 허용하고 다른 batch의 row는 거절한다. active 관측에는 manifest 결속이 계속 필수다.
- `totalCount`와 반환 길이가 다르거나 전체 count가 누락·잘못됐거나 corrupt 줄이 있으면 `incomplete`로 처리한다. 전체 중복 여부를 증명할 수 없어 상태·시각·근거를 연결하지 않는다. 같은 ID의 terminal/active 충돌은 `ambiguous`다.
- `selectedRun`은 선택한 source의 ID·batch·index·상태·lifecycle 시각·storage/report binding과 같아야 한다. 불일치하면 근거를 섞지 않는다. 경로 값은 내부 일치 비교에만 쓰고 화면/진단 응답에 반환하지 않는다.

새 전체 원본 duplicate 판정 GET 필드를 추가하면 잘린 목록에서도 일부 정확한 실행을 안전하게 읽을 수 있다. 이번 수정은 그 계약을 추가하지 않고 기존 legacy API 동작을 보존하며 보수적으로 unavailable 처리한다. 전체 requested/effective input, hash provenance, 비교 가능성 및 clone 가능성은 여전히 확정하지 않는다.

합성 회귀는 실제 blocked-shaped 응답, 저장 running, active identity 누락, 101개 원본의 첫번째/마지막 동일 ID와 selectedRun 불일치, source 필드별 불일치, corrupt/count 오류를 포함한다. 별도 browser fixture에서도 후보 열의 근거·상세 링크를 차단하고 정상 기준 열은 유지한다.
