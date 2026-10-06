# 현재 publication의 selector 예약 session 보완

PR788은 현재 opening budget publication의 consumer에 실제 source lock 안의
Manual/Selector append session을 전달한다. 새 snapshot을 사용하는 selector 예약이
기존 snapshot→sizing input→assignment 관측 순서와 충돌하는 P1을 보완한다.
실제 주문, allocation 승인, 공용 capacity ledger CAS 및 mandate/event 원자 commit은 범위 밖이다.

기존 snapshot prefix 관측은 그대로 보존한다. consumer에 전달한 post-publication
snapshot lease의 관측을 `publishedSnapshotObservation`으로 별도 저장하고, 두 prefix를
실제 durable history로 재검증한다. publication 관측은 assignment 이후이며 append 이전이어야 한다.
snapshot의 ID·hash·scope·asOf와 예약의 실제 assignment/input 연결 검사도 유지한다.

receipt v1 source에 이 선택 필드를 추가한다. 기존 receipt는 계속 읽을 수 있다.
새 필드를 모르는 이전 strict reader는 새 receipt를 거절하므로, reader/writer를 함께
갱신해야 하며 이전 reader로의 운영 rollback 호환성을 보장하지 않는다. 자동 변환은 하지 않는다.

consumer가 시작한 쓰기를 await하지 않아도 publication snapshot lease가 살아 있는 동안
selector session의 `finish()`로 신규 쓰기 접수를 닫고 기존 쓰기를 drain한다. 바깥 session의
종료 처리도 유지하며 overlap, 만료·복제 lease 및 source 손상은 fail-closed로 처리한다.

완료조건은 시간차가 있는 실제 publication 경로의 await/unawaited append, 재시작·exact retry,
재해시한 receipt의 시간 역전·prefix 손상·publication 관측 누락 거절, 복제 lease 거절 및
기존 current opening/manual/selector 회귀 통과다. 최신 main 정상 통합 후 다시 검사한다.
전체 merge gate와 exact 공개 head의 독립 코드·보안 검토 및 보호조건은 별도 확인한다.

## 독립 검토 후속 보완

publication snapshot lease가 만료되기 전에 manual과 selector session 모두 신규 쓰기 접수를 닫고 기존 쓰기를 끝까지 처리한다. 다른 쓰기 종료 처리가 실패하더라도 모든 종료 처리가 완료될 때까지 기다린다. consumer 오류는 주된 원인으로 유지하며, 모든 쓰기 종료 오류는 AggregateError.errors에서 확인할 수 있다. consumer 오류만 발생한 경우에는 그 오류의 동일성을 유지한다.

독립적인 100 ms pending-file gate는 tree 7392a1f2에서 await하지 않은 manual 쓰기의 lease 실패와 잔여 barrier를 재현한다. await한 대조군은 통과한다. 수정 후에는 동일한 검증 조건이 통과한다. 잡아서 처리한 selector 검증 오류와 consumer sentinel의 조합도 해당 tree에서 오류 유실을 재현하며, 수정 후에는 두 오류를 모두 보존한다. 회귀 검증은 consumer/manual/selector 오류의 여덟 조합과 기존 await/unawaited selector 재시작 및 재시도 사례도 포함한다.

Windows의 전체 merge gate는 기록된 실패로 여전히 막혀 있다. 제한된 검증의 통과만으로 게시나 병합을 승인하지 않는다.
