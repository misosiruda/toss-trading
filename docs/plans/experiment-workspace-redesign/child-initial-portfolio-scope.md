# Child 초기 portfolio 관측 producer

기준 main: `24cfe161562f8deb6e1af75ffdd299974c854ad2` (PR819).
[입력·runtime 계약](input-runtime-provenance-contract.md) 2단계의 첫 기능 단위다.

## 범위와 선행

PR819는 접수 requested/effective/notices만 보존했다. 이번 범위는 historical workflow의 batch child에서
실제 `runCodexHistoricalReplay`가 초기 상태로 복제한 portfolio의 첫 평가/변경 전 관측이다.
저장 portfolio가 있으면 요청 initialCash보다 우선하는 현재 동작을 그대로 기록한다.
실제 소비 객체의 현금·보유·원가·평가·가격 시점/staleness·Risk 분류를 v1 snapshot으로 보존한다.

`replay_initial_portfolio_observation.v1`는 부분 관측 단위이며 전체 `replay_input_runtime_provenance.v1`가 아니다.
recorded는 runner 초기화 시점의 값이며 child 실행 완료·전체 입력·runtime 검증을 뜻하지 않는다.
접수 기록, source, 설정 전체, runtime, dependency, result 및 comparability는 unavailable이다.
실제 source/초기 portfolio/runtime/result의 전체 연결은 후속 단계다. 공개 endpoint/DTO/UI는 추가하지 않는다.

- 대상은 명시적 runId/batchId/runIndex가 있는 historical workflow child다. standalone/legacy 및 별도 동기 runner는 비대상이다.
- initial state는 runner 진입 시 deep copy하고 관측 callback에는 별도 복사본을 전달한다. 호출자·callback 변경이 실제 초기 상태를 바꾸지 않는다.
- child workflow의 기존 산출물을 쓰기 전에 전용 immutable 예약 파일을 생성한다. 동일 child 저장 위치 재사용/덮어쓰기는 거절한다.
  상위 batch manifest의 legacy 재실행 동작까지 불변으로 바꾸는 범위는 아니다. API의 새 ID 접수 경계는 유지한다.
- 실제 runner 초기화 callback에서 snapshot exclusive write/file sync/directory sync를 완료한 뒤 첫 tick/provider로 이동한다.
- IO 실패는 실행을 실패시킨다. 생성된 예약/부분 자료는 삭제·재사용하지 않는다. 오류에는 raw path/입력을 포함하지 않는다.
- versioned strict snapshot에는 default/coercion을 넣지 않는다. omission과 명시0/false/빈 배열을 보존한다.
- masking이 필요한 값, 미지원 shape 또는 상한 초과는 snapshot/hash를 남기지 않고 typed unavailable만 기록한다.
- 최대512개 position, 문자열/배열 상한과 snapshot256KiB 한도를 적용한다. reservation hash는 child identity/시작 시각/출처와 결속한다.
- source 파일 자체의 신뢰·읽기 history, complete 초기 상태의 공개 판독, 완료 결과 발행은 이 관측으로 승격하지 않는다.

## 완료 기준

1. 실제 합성 child replay에서 저장 snapshot이 runner result의 원래 initialPortfolio와 일치한다.
2. 요청 cash와 저장 cash의 차이, cash0/빈 보유, quantity/원가/평가/시각/stale/Risk 필드 차이를 보존한다.
3. caller 및 callback mutation 격리, 첫 provider 이전 durable 순서, write/sync 실패 provider0,
   기존 evidence 보존과 같은 위치 재사용 거부를 시험한다.
4. strict version/shape/unknown/누락 및 masking/limit은 recorded·complete로 승격하지 않는다.
5. 정적·국소 시험 후 영향 계획을 기록하고 독립 검토에 exact tree와 증거를 넘긴다.
   새 backend 후보의 필수 전체 검증은 별도 증거가 필요하다. 기존 full을 재사용하거나 알려진 WSL 시계 실패를 반복하지 않는다.

실거래·유료 AI·시간 서비스 중지 또는 설정 변경은 범위 밖이다. 첫 PR의 완료로 상위 producer 카드 전체를 완료 처리하지 않는다.
