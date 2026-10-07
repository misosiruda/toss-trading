# 상세 탐색 중 benchmark 표시 선택 보존

기준: PR816 병합 main `21ebc83f0bc0b506e86ffd461be75f9870499f4a`.

## 목적과 범위

요약에서 고른 기존 3종 benchmark 표시 선택을 같은 실행의 요약·리플레이·판단 근거·기록
탭 이동과 근거 필터·사건·명시적 참조 탐색 뒤에도 유지한다. 현재 링크가 URL을 새로 만들며
`benchmarks`를 버리는 문제를 고친다. 선택은 계속 URL의 표시 상태이며 저장 report를 바꾸지 않는다.

- 링크는 현재 `benchmarks`의 읽힌 값을 전달한다. 미지정은 기본 3종, `none`은 선택 없음,
  유효하지 않은 값은 기존 경고와 3종 표시를 유지한다. 링크에서 값을 정상화하지 않는다.
- 기존 탭 전환의 근거 종류·사건 선택 초기화와 필터 전환의 사건 초기화를 유지한다.
  표시 선택 외 query/hash를 새로 보존하는 동작은 추가하지 않는다.
- backend, report 계산, runner/create 입력, metadata/hash, 입력·runtime provenance 계약,
  여러 실험 비교와 실거래·유료 AI 실행은 범위 밖이다.

## 완료 조건과 검증

- URL 생성 unit: 미지정·부분 선택·none·invalid·빈 값과 인코딩, 탭/필터/사건 링크의 기존 선택
  경계 및 같은 requested ID를 확인한다.
- production browser: desktop/tablet/mobile에서 키보드 선택 → 4개 탭 왕복 → 필터·사건·참조
  → 요약 복귀, 뒤로/앞으로, reload 후 체크 상태와 저장 값이 동일해야 한다.
- none/invalid 상태와 3종 복원, 같은 child 결합, 읽기 전용 요청, 콘솔 오류·가로 넘침·axe를 확인한다.
- dashboard unit, build/lint/type와 변경 영향 계획을 확인한다. Browser plugin이 없어 저장소의
  Playwright를 사용하며 screenshot/log는 저장소 밖 작업 증거 폴더에 둔다.
- root 검증 입력(source/schema/script/config/lockfile)의 blob/mode가 PR816 검증 tree와 동일한지
  명시적으로 비교한다. 동일 backend full 결과와 이번 frontend 실행 결과를 구분한다.
  전체 영향 계획을 실행 완료로 보고하거나 이전 실패·중단을 통과로 바꾸지 않는다.

URL 상태 전달만 되돌리면 rollback 가능하며 데이터 변환이나 artifact 삭제는 필요 없다.
