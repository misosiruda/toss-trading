# 접수 입력 보존 구현 PR

기준 main: `14d8bc42b4d159faaaa75f22a875af332ffd1672` (PR818).
[입력·runtime 계약](input-runtime-provenance-contract.md)의 첫 구현 단계다.

## 목적과 소유 범위

create가 실제 runner에 전달한 requested/effective 입력과 같은 resolve에서 나온 notices를
`paper_simulation_input_provenance.v1`로 저장하고 durable accepted 이벤트에 hash를 결속한다.
저장 reader는 exact batch의 snapshot을 bounded read하며 현재 resolver/default/env로 재구성하지 않는다.

- `src/domain/paperSimulationInputSnapshot.ts`: default/coercion 없는 고정 v1 입력 shape.
- `src/storage/paperSimulationInputStore.ts`: exclusive 저장, masking, hash 및 exact-ID 내부 판독.
- `paperSimulationObservation.ts` / `paperSimulationObservationStore.ts`: optional input hash와 legacy 호환, durable 순서.
- `paperSimulationRuns.ts`: 같은 runnerInput을 저장 경로에 전달.
- `paperSimulationRequestStore.ts`: 기존 v1 기록 schema 공유만 허용. clone의 현재 runtime gate는 유지.
- 관련 domain/storage/API 계약 테스트와 이 문서가 검증·완료 범위를 소유한다.

새 HTTP endpoint/UI, child의 실제 source/initialPortfolio/runtime/dependency/result producer,
complete provenance 및 비교 가능 판정은 포함하지 않는다. 내부 reader가 available이어도 접수 snapshot의
무결성만 뜻한다. child 입력·runtime·result 및 comparability는 unavailable로 유지한다.
live 주문, 유료 AI 실행, EXP CLI 연결, 시간 서비스 중지/설정 변경은 하지 않는다.

## 완료 기준

1. 실제 합성 HTTP create에서 저장 snapshot=requested/effective/notices=실제 runnerInput이며
   omission·명시 비용·환경 유래 값이 보존된다. validation은 저장하지 않는다.
2. ID 예약 → canonical/input write·fsync·directory sync → 두 hash를 결속한 accepted → 202/runner.
   저장/동기화/accepted 실패는 503·runner0, ID barrier 유지. 재시도·복구·덮어쓰기는 없다.
3. legacy accepted의 input hash 부재는 새 입력만 unavailable이다. 기존 canonical clone은 유지한다.
4. reader는 version/shape/presence/masking, canonical·accepted·namespace·ID/hash 결속, 파일 alias/
   변경/lock/UTF-8/bytes/monotonic budget을 검증한다. read mutation0, 현재 runtime 차이를 clone과 구분한다.
5. 실제 red/green, 공식 영향 profile 및 자체 검토 후 한국어 Draft와 독립 검토 자료를 게시한다.
   backend가 바뀌므로 PR816 full을 재사용하지 않는다. 최종 독립 Linux full 및 독립 검토 전 Ready는 하지 않는다.

롤백은 새 producer/reader를 제거하는 코드 변경이다. 이미 생성된 evidence/ID는 삭제하지 않는다.
변경 전 strict accepted reader가 추가 hash를 해석한다고 가정하지 않는다.
