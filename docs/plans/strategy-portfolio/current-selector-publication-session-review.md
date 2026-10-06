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

## Independent review follow-up

Both manual and selector session admissions close and their writes drain before the publication snapshot lease expires. All drains settle even when another drain fails. A consumer failure remains the primary cause and every drain failure remains accessible through AggregateError.errors; a lone consumer error retains its identity.

The independent 100 ms pending-file gate reproduces the unawaited manual lease failure and leftover barrier on tree 7392a1f2. Its awaited control passes. The same assertions pass after the repair. The caught selector validation error plus consumer sentinel reproduces error loss on that tree and preserves both errors after repair. Regression coverage also exercises all eight consumer/manual/selector error combinations, plus existing awaited/unawaited selector restart and retry cases.

Windows full merge gate remains blocked by recorded failures; focused checks do not authorize publication or merge.
