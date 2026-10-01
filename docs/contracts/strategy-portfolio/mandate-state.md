# 전략 포트폴리오: mandate와 state 계약

[운용 모델 진입점](../../plans/strategy-portfolio-operating-model-plan.md) · [현재 main 구현과 남은 작업](../../architecture/strategy-portfolio-implementation-status.md) · [기존 PR 1~8 단계](../../plans/strategy-portfolio/implementation-stages.md) · [검증·최종 수용 기준](../../plans/strategy-portfolio/validation-and-acceptance.md)

## 이 문서의 책임과 읽기 기준

이 문서는 해당 책임의 목표 계약과 구현 과정에서 구체화된 안전·저장·복구 제약의 정본이다.
계약의 존재를 전체 구현 완료나 실행 권한으로 해석하지 않는다. 기존 13절의 상세는 살아 있는
lock/lease, fail-closed, rollback 조건을 포함하므로 이력 파일로 숨기지 않고 여기 보존한다.

상세에 남은 “첫 분할”, “후속”, “아직”은 해당 분할의 범위 제한을 기록한 표현이다.
뒤의 분할이 추가한 기능까지 현재 미구현이라고 단정하지 않는다. 최신 연결 여부는 위의
현재 main 상태표와 소스를 확인하고, 원자 실행·권한 한계는 해당 계약 전체를 함께 적용한다.
기존 단계명·식별자·숫자·실패 및 복구 의미를 이 이동으로 변경하지 않는다.

<a id="spom-source-591-1480"></a>
<!-- spom-source:591-1480 sha256:a07adaa770208083ca5d6c881fb4ebcee5b44026fb63492ed285193001feac66 -->

### 6.3 `InvestmentMandate`

```ts
type ManualCapacityReservationLineage = {
  manualCapacityReservationId: string;
  manualCapacityReservationHash: string;
  reservedMaximumNotionalKrw: number;
} &
  (
    | {
        reservationKind: "new_position";
        reservedSlotOrdinal: number;
      }
    | {
        reservationKind: "increase_existing";
        existingPositionRef: string;
      }
  );

type MandateAssignmentLineage =
  | {
      assignmentSource: "manual_policy";
      manualAuthorizationScope: "open_or_increase";
      manualAssignmentEventId: string;
      capacityReservation: ManualCapacityReservationLineage;
    }
  | {
      assignmentSource: "manual_policy";
      manualAuthorizationScope: "classify_existing_reduce_only";
      manualAssignmentEventId: string;
    }
  | {
      assignmentSource: "deterministic_selector";
      selectionRequestId: string;
      candidateAssignmentId: string;
      candidateAssignmentSetId: string;
      candidateAssignmentSetHash: string;
      selectedRank: number;
      openingCapacityReservationId: string;
      openingCapacityReservationHash: string;
      reservedSlotOrdinal: number;
      reservedMaximumNotionalKrw: number;
      scoringModelVersion: string;
      selectionScore: number;
    };

type InvestmentMandateRecord = InvestmentMandateBase & MandateAssignmentLineage;

interface InvestmentMandateEventBase {
  mandateEventId: string;
  mandateEventHash: string;
  mandateId: string;
  mandateHash: string;
  portfolioId: string;
  market: Market;
  symbol: string;
  bucket: StrategyBucket;
  policyHash: string;
  asOf: string;
  reasonCodes: string[];
  createdAt: string;
}

type InvestmentMandateEvent = InvestmentMandateEventBase &
  (
    | {
        eventType: "activated";
        previousMandateEventId?: string;
      }
    | {
        eventType: "review_required";
        previousMandateEventId: string;
      }
    | {
        eventType: "retired";
        previousMandateEventId: string;
        supersededByMandateId?: string;
      }
  );

interface InvestmentMandateBase {
  mandateId: string;
  mandateHash: string;
  portfolioId: string;
  market: Market;
  symbol: string;
  bucket: StrategyBucket;
  policyHash: string;
  asOf: string;
  targetWeightRatio: number;
  minWeightRatio: number;
  maxWeightRatio: number;
  maximumOpeningNotionalKrw: number;
  reasonCodes: string[];
  evidenceRefs: string[];
  evidenceAsOf: string;
  reviewCadence: BucketReviewCadence;
  validFrom: string;
  reviewAfter?: string;
  expiresAt?: string;
  createdAt: string;
}

interface ManualAssignmentEventBase {
  manualAssignmentEventId: string;
  manualAssignmentEventHash: string;
  portfolioId: string;
  policyHash: string;
  market: Market;
  symbol: string;
  bucket: StrategyBucket;
  asOf: string;
  selectionPolicyRecordId: string;
  selectionPolicyHash: string;
  reasonCodes: string[];
  evidenceRefs: string[];
  evidenceAsOf: string;
  evidenceValidationHash: string;
  authorizationRef: string;
  createdAt: string;
}

type ManualAssignmentEvent = ManualAssignmentEventBase &
  (
    | {
        authorizationScope: "open_or_increase";
        evidenceEligibility: "eligible";
        portfolioSnapshotId: string;
        portfolioSnapshotHash: string;
        sizingInputRecordId: string;
        minWeightRatio: number;
        targetWeightRatio: number;
        maxWeightRatio: number;
        maximumNotionalKrw: number;
        sizingInputHash: string;
        sizingOutputHash: string;
      }
    | {
        authorizationScope: "classify_existing_reduce_only";
        evidenceEligibility: "eligible" | "blocked";
        classificationMinWeightRatio: number;
        classificationTargetWeightRatio: number;
        classificationMaxWeightRatio: number;
      }
  );

interface ManualOpeningCapacityReservationRecordBase {
  manualCapacityReservationId: string;
  manualCapacityReservationHash: string;
  manualAssignmentEventId: string;
  manualAssignmentEventHash: string;
  portfolioId: string;
  policyHash: string;
  bucket: StrategyBucket;
  market: Market;
  symbol: string;
  currentPortfolioSnapshotId: string;
  currentPortfolioSnapshotHash: string;
  capacityLedgerVersion: number;
  reservedMaximumNotionalKrw: number;
  resultingReservedNotionalKrw: number;
  authorizationRef: string;
  createdAt: string;
}

type ManualOpeningCapacityReservationRecord =
  ManualOpeningCapacityReservationRecordBase &
    (
      | {
          reservationKind: "new_position";
          reservedSlotOrdinal: number;
        }
      | {
          reservationKind: "increase_existing";
          existingPositionRef: string;
        }
    );

interface BucketOpeningCapacityState {
  capacityStateId: string;
  capacityStateHash: string;
  portfolioId: string;
  policyHash: string;
  bucket: StrategyBucket;
  currentPortfolioSnapshotId: string;
  currentPortfolioSnapshotHash: string;
  capacityLedgerVersion: number;
  activePositionCount: number;
  pendingReservationCount: number;
  mandateBoundUnusedSlotCount: number;
  availableSlots: number;
  reservedOpeningNotionalKrw: number;
  remainingOpeningBudgetKrw: number;
  lastReservationRecordId?: string;
  asOf: string;
}

interface OpeningCapacityReservationEventBase {
  capacityReservationEventId: string;
  capacityReservationEventHash: string;
  reservationId: string;
  reservationHash: string;
  portfolioId: string;
  policyHash: string;
  bucket: StrategyBucket;
  remainingReservedNotionalKrw: number;
  occupiesNewPositionSlot: boolean;
  capacityLedgerVersion: number;
  asOf: string;
  createdAt: string;
}

type OpeningCapacityReservationEvent = OpeningCapacityReservationEventBase &
  (
    | {
        eventType: "reserved";
        previousCapacityReservationEventId?: never;
        reservationSource:
          | {
              sourceKind: "manual";
              manualCapacityReservationId: string;
              manualCapacityReservationHash: string;
            }
          | {
              sourceKind: "selector";
              candidateAssignmentSetId: string;
              candidateAssignmentSetHash: string;
              candidateAssignmentId: string;
              reservedSlotOrdinal: number;
            };
      }
    | {
        eventType: "bound_to_mandate";
        previousCapacityReservationEventId: string;
        mandateId: string;
        mandateHash: string;
      }
    | {
        eventType: "partially_consumed";
        previousCapacityReservationEventId: string;
        mandateId: string;
        mandateHash: string;
        fillId: string;
        paperFillRecordId: string;
        paperFillHash: string;
      }
    | {
        eventType: "consumed_by_position";
        previousCapacityReservationEventId: string;
        mandateId: string;
        mandateHash: string;
        fillId: string;
        paperFillRecordId: string;
        paperFillHash: string;
        resultingPositionRef: string;
      }
    | {
        eventType: "released";
        previousCapacityReservationEventId: string;
        releaseOrigin:
          | { originKind: "request_cancelled"; requestOrManualEventId: string }
          | {
              originKind: "mandate_terminal";
              mandateId: string;
              mandateHash: string;
              mandateEventId: string;
              mandateEventHash: string;
            };
        releaseReasonCode: string;
      }
  );
```

- 같은 `portfolioId + market + symbol`에는 하나의 active mandate만 허용한다.
- 같은 portfolio 안에서 같은 종목을 두 bucket에 중복 계상하지 않는다.
- mandate record와 event ID는 재사용하지 않는다. record 생성 직후 상태는 `proposed`이며
  status는 event chain을 fold해 `active`, `review_required`, `retired`로 파생한다.
- `mandateHash`는 mandate ID, hash와 `createdAt`을 제외한 complete record payload에서
  계산하며 reason/evidence ref를 canonical sort하고 duplicate를 거절한다. mandate ID는 이
  hash에서 파생하고 resolver는 사용 전 독립 rehash한다. `reviewAfter`, `expiresAt`, cadence,
  target range, evidence와 assignment lineage 중 하나라도 달라지면 같은 mandate로 인정하지 않는다.
- mandate event도 event ID/hash/createdAt을 제외한 complete payload로 `mandateEventHash`를
  계산하고 ID를 hash에서 파생한다. 모든 event는 exact `mandateId + mandateHash`를 보존한다.
  position strategy state는 mandate ID/hash와 current mandate event ID/hash를 함께 저장하며
  record/event/state 중 하나라도 resolve 또는 rehash되지 않으면 신규 매수를 fail-closed한다.
- 첫 activation event만 `previousMandateEventId`를 생략할 수 있다. 이후 event는 현재 chain
  head를 정확히 가리켜야 하며 unknown predecessor, duplicate ID, branch, retired 이후 전이는
  fail-closed한다.
- bucket 변경은 새 mandate record를 먼저 만들고 기존 mandate의 retirement event에
  `supersededByMandateId`를 기록한 뒤 새 mandate를 activate하는 명시적 migration이다.
- 보유 position의 bucket 변경은 `BucketMandateMigrationTransferRecord` 없이는 완료할 수 없다.
  record는 retiring/activating mandate ID/hash, source mark head, quantity, 동일 price/evidence,
  `transferEquityKrw = quantity * transferPriceKrw`와 transfer group을 full-payload hash로 묶고
  ID를 hash에서 파생한다. from/to bucket은 달라야 하며 exact position과 mandate scope를
  resolve하고 독립 재계산한다.
- migration transaction은 old mark head `bucket_transfer_out`, old bucket
  `strategy_transfer_out(sequence=0)`, new bucket `strategy_transfer_in(sequence=1)`, new mark head
  `bucket_transfer_in`, old mandate retirement, new mandate activation, position strategy-state
  변경과 resulting risk states를 모두 원자 commit한다. transfer out은 음수, in은 같은 절댓값의
  양수여서 portfolio total equity는 변하지 않는다. 각 bucket은 transfer 직전 unit NAV에서 units를
  burn/mint해 NAV와 high-water mark history를 유지한다. old head는 terminal로 닫고 new head는
  동일 quantity/price/evidence로 시작한다. partial/cross-policy/duplicate transfer와 한쪽만 보이는
  상태는 fail-closed한다.
- resolver가 같은 `portfolioId + market + symbol`에 active mandate를 2개 이상 찾으면 해당
  종목의 신규 매수를 중단한다.
- `deterministic_selector` mandate는 request, assignment, scoring model과 score를 모두
  필수로 보존한다.
- `manual_policy` mandate는 selector lineage field를 포함하지 않고
  `manualAssignmentEventId`와 event의 `authorizationScope`를 필수로 보존한다. `open_or_increase`만
  strict `new_position | increase_existing` capacity reservation lineage를 요구하고
  `classify_existing_reduce_only`에는 이를 허용하지 않는다.
  같은 transaction에서 append될 event payload를 먼저 검증하고 portfolio/policy/symbol/bucket/as-of
  scope가 mandate와 일치해야 한다.
- manual assignment event hash는 event ID/hash/createdAt을 제외한 complete variant payload에서
  계산하고 ID는 hash에서 파생한다. mandate 발급 전에 scope, evidence/validation,
  authorization, sizing 또는 classification range를 포함한 payload를 독립 rehash하며 exact
  retry만 기존 event로 수렴한다.
- manual event의 `open_or_increase`는 active bucket selection policy를 resolve해 자동
  selector와 같은 required evidence, freshness와 hard gate를 통과한 `eligible` 결과 및
  validation hash가 있을 때만 허용한다. 또한 immutable portfolio sizing snapshot과
  selector와 동일한 backend sizing algorithm에서 나온 immutable sizing input record,
  input/output hash, min/target/max range와 maximum notional을 필수로 보존한다.
  `authorizationRef`는 이 gate와 sizing을 우회할 수 없다.
- manual open/increase는 event에 저장된 과거 snapshot만 신뢰하지 않는다. event append와
  mandate activation을 묶는 transaction에서 current portfolio와 `BucketOpeningCapacityState`를
  다시 읽어 active position+pending reservation+active mandate의 unused opening reservation 수,
  current gap과 aggregate reserved notional을 재계산한다. 신규 symbol은 available slot과 remaining
  budget이 모두 양수일 때만 다음 unique slot ordinal과 `min(manual maximum, remaining budget)`을
  reserve한다. 기존 position 증가는 새 slot을 차감하지 않지만 remaining budget은 reserve한다.
- `ManualOpeningCapacityReservationRecord`는 ID/hash/createdAt을 제외한 complete payload로 hash와
  hash-derived ID를 만들며 manual event ID/hash, current snapshot, CAS ledger version, slot과
  notional 또는 existing position ref를 보존한다. manual event, reservation, mandate activation과 ledger version increment는
  한 transaction으로 commit하고 실패 시 모두 rollback한다. mandate는 reservation ID/hash와
  동일 reservation kind/slot 또는 position ref/notional을 보존하며 reservation ID는 하나의
  mandate에만 bind할 수 있다.
- `BucketOpeningCapacityState`는 selector와 manual open/increase가 함께 사용하는 bucket별 current
  ledger다. state hash는 자기 hash를 제외한 complete payload로 계산하며 resolver는 current
  portfolio와 `OpeningCapacityReservationEvent` chain을 replay해 active position, pending 및
  mandate-bound unused slot 수, available slot, reserved notional과 remaining budget을 독립
  재계산한다. snapshot/hash mismatch, version
  gap 또는 state mismatch는 신규 mandate를 fail-closed한다.
- 선행 계약 `bucketOpeningCapacityState.ts`는 위 state의 strict constructor/parser와 정책 payload 결속을
  제공한다. Stable `capacityStateId`는 `(portfolioId, bucket)`에서 파생하고 policy/snapshot/version 변경 시
  유지한다. 자기 hash만 제외한 전체 payload에 stable ID, optional reservation origin과 시각까지 포함해
  독립 rehash한다. 명시적인 undefined origin, malformed Unicode, 비정수·unsafe·negative-zero 금액/수,
  unsafe slot/notional 합계와 양수 예약 금액이 뒷받침하지 않는 예약 slot은 거절한다.
  Policy 결속은 같은 portfolio/hash와 생성 시각, 명시적인 maximum position count에 대한 available slot
  재계산만 검증한다. 한도 초과 상태는 available slot 0으로 표현하며 예약을 삭제하지 않는다.
  이 순수 계약은 현재 active policy, snapshot 보유·예약·예산 원본 replay, event version의 최신성,
  `bucket-opening-capacity-state.json` 저장/CAS나 allocation/activation transaction을 증명하지 않는다.
  이들 저장·원자 처리 경계는 후속이다. 기존 저장 형식 변경이나 migration은 없고 코드 rollback이 가능하다.
- `resolveStoredBucketOpeningCapacityStates`는 실제 저장 occupancy/budget 원본에서 5개 bucket의 상태를
  함께 생성하고 정책 payload 결속까지 재검증한다. Occupancy는 cutoff 이전 current policy/bucket의
  마지막 event version과 마지막 `reserved` root의 reservation ID를 별도로 반환한다. Current policy의
  event가 없으면 version은 0이고 last reservation ID는 생략하지만 과거 정책의 미해제 예약은 점유·금액에
  계속 포함한다. Version은 최신 current ledger나 다른 정책 epoch의 version을 합친 값이 아니다.
  상태의 remaining budget은 공용 현금/max band 상한이며 selection request의 min/entry gap 예산이 아니다.
  전체 bucket 상태와 snapshot/policy scope를 하나의 `projectionHash`로 결속해 공용 현금 문맥을 보존한다.
  관측 시각은 별도 assessment에만 포함하므로 같은 snapshot에서 재관측해도 projection payload/hash는 같다.
  Snapshot의 offset-qualified as-of는 같은 instant의 canonical UTC로 상태에 기록하며 원본 snapshot hash는
  변경하지 않는다. 이 읽기 모델은 상태 파일을 쓰지 않으며 current ledger/CAS·실제 결과 회계와 원자 할당은
  여전히 미검증이다. 기존 occupancy 반환 metadata/assessment hash는 추가 필드에 따라 달라지지만 저장
  artifact/API 형식은 바꾸지 않는다. 새 반환 필드 consumer는 함께 rollback하며 데이터 변환·삭제는 없다.
- `BucketOpeningCapacityStateFileRepository`는 `bucket-opening-capacity-state.json`에 portfolio별 전체
  5개 bucket projection을 저장한다. Document는 `bucket_opening_capacity_state_document.v1`,
  portfolio ID 정렬 projection 배열과 자기 hash를 제외한 전체 payload의 `documentHash`를 갖는다.
  `refresh({ portfolioSnapshotId, expectedDocumentHash })`는 실제 저장 원본에서 상태를 재계산하고
  문서 전체 CAS로 교체한다. 다른 portfolio의 상태도 보존하며 caller-supplied state/resolver는 받지 않는다.
  같은 상태의 exact retry는 bytes/hash를 바꾸지 않는다. 다른 상태의 stale expected hash, 이전 시각으로의
  복귀와 같은 시각의 다른 snapshot으로 교체는 거절한다. Ordinary read는 자동 refresh하지 않는다.
  모든 저장 projection을 원본에서 다시 계산해 전체 payload와 대조하므로 독립적으로 rehash한 위조 상태,
  누락·손상 원본, 중복 portfolio, 비정렬 문서, invalid UTF-8와 torn/비정규 JSON을 fail-closed한다.
  Outer state lock은 문서 reader/writer를 직렬화하고 temporary file write/fsync/rename으로 전체 bucket을
  함께 교체한다. `.bucket-opening-capacity-state.json.lock/<generation>/owner`에 UUID 소유권을 쓰고
  `<UUID>.released` 표식이 정확히 일치하고 sync된 경우에만 다음 연속 generation을 exclusive mkdir로
  획득한다. 해제 시 owner/generation 경로를 삭제·rename하지 않으므로 최종 소유권 확인 직후 교체된
  다른 token을 해제하지 않는다. 획득 EEXIST/Windows EPERM만 monotonic timeout 안에서 재시도한다.
  다음 generation mkdir 직후와 owner 초기화 후의 작업 진입·쓰기 전·해제 경계에서도 캡처한 이전
  owner/release token을 재검증한다. 그 사이 교체되면 consumer를 실행하지 않거나 갱신을 거절하며
  이미 확보한 generation은 미해제 barrier로 보존한다. 이전 세대 검증 결과만으로 새 작업을 승인하지 않는다.
  초기화 실패, 불완전한 release, generation 누락 및 abandoned/replaced lock은 자동 복구하지 않는다.
  세대별 디렉터리와 표식은 read/refresh마다 누적되며 online GC는 제공하지 않는다. 보존량 모니터링과
  실행 writer가 없는 상태에서의 명시적 보관/복구가 필요하다. 기존 file 형태 barrier도 덮어쓰지 않는다.
  직렬화 보장은 이 프로토콜을 사용하는 repository 프로세스 사이의 동시성에 한정된다. 실행 중인
  reader/writer가 있는 동안 외부 도구로 owner/release/state 경로를 교체하는 online takeover는 지원하지
  않는다. 복구 전 모든 reader/writer를 중지해야 한다. 소유권 재검증은 관측한 손상을 거절하는 방어이며
  외부 파일 교체와 state rename을 원자적으로 묶는 OS fencing이 아니다. 실제 rename 직전 정지한
  writer에 대해 별도 프로세스의 획득 timeout, 기존 owner/state 보존, 완료 후 stale CAS 거절을 검증한다.
  중첩 projection/state의 객체 key 순서도 실제 재계산 문서의 직렬화 bytes와 대조한다.
  Rename 후 directory sync 실패는 성공으로 보고하지 않으며
  동일 입력 재시도로 저장된 결과의 durability를 다시 확인한다. Windows directory fsync EPERM은 기존 저장소와
  같은 제한으로 처리한다. 프로세스 재시도/CAS 경합, 실제 manual/selector 부분 fill 원본 및 I/O fault를 검증한다.
  이 저장소는 역사적 snapshot projection 저장/CAS이며 **현재 portfolio 원장의 최신성이나 신규 할당 권한이
  아니다**. Source lease는 저장 commit 전체를 묶지 않으며 snapshot 회계, 예약/mandate activation/fill의
  원자 transaction과 현재 selection budget/sizing gate는 후속이다. Source lock 안에서 이 저장소를 재진입하면
  안 된다. 새 저장 형식만 추가하므로 코드 rollback에 기존 파일 변환·삭제가 필요 없고 이전 코드는 새 파일을
  사용하지 않는다. 손상 파일과 실패 lock은 진행 중인 writer 및 원본 일관성을 확인하는 명시적 복구가 필요하다.
- 선행 읽기 모델 `resolveStoredSnapshotOpeningCapacity`는 실제 저장된 active policy, sizing snapshot,
  pending plan/fill/reservation 원본과 capacity event history를 결합해 snapshot cutoff의 점유량을 계산한다.
  모든 bucket에 명시적인 `openingCapacityPolicy`가 필요하고 snapshot policy hash와 active policy가
  일치해야 한다. Policy와 event의 관측 generation이 도중에 바뀌면 혼합하지 않고 거절한다.
  마지막 event 관측의 앞뒤에서 policy generation을 대조해 그 사이의 policy record/activation 추가도
  거절한다. 뒤쪽 policy 재조회는 event lease를 해제한 후 수행하여 역순 중첩 lock을 만들지 않는다.
  해제되지 않은 과거 policy의 예약도 현재 snapshot의 bucket 점유량과 금액에 합산한다.
- 이 읽기 모델에서 `pendingReservationCount`는 아직 bound되지 않은 신규 종목 예약 및 pending BUY가
  있는 bound 신규 종목 예약의 수다. Pending BUY 없는 bound 신규 종목 예약은
  `mandateBoundUnusedSlotCount`에만 포함한다. 첫 fill로 slot flag가 false가 된 예약은 별도 slot을
  차감하지 않고 snapshot의 양수 보유 수를 사용한다. Pending BUY의 gross 금액은 이미 remaining
  reservation에 포함되므로 `reservedOpeningNotionalKrw`에 다시 더하지 않는다.
  `unsubmittedReservedNotionalKrw`는 전체 잔여 예약 금액에서 해당 pending 금액을 뺀 값이다.
- 종목 중복 보유 bucket, 미분류 양수 보유분, 신규 slot의 보유/예약 종목 중복, 같은 policy/bucket의
  점유 slot ordinal 중복과 unsafe aggregate는 이 읽기 모델에서 거절한다. Commit이 cutoff와 같은
  millisecond이면 전후 관계를 추정하지 않는다. 아직 source 검증이 없는 request cancellation 등은
  cutoff 이전에 있으면 거절하며 임의 해제나 원본 기본값을 만들지 않는다.
- 이 결과는 `stored_snapshot_opening_occupancy_only` 관측이며 실제 `BucketOpeningCapacityState`
  저장·current ledger·CAS·accounting/resulting-state authority 또는 신규 할당 승인이 아니다. Snapshot의
  실제 보유 수량이 fill/이체/매도까지 포함한 원장 결과와 같은지, source가 과거 시점 디스크에 있었는지와
  여러 파일의 원자적 최신성은 별도 검증 대상이다. 이 결과로 current allocation/activation gate를
  대체하지 않는다. 저장 artifact나 기존 API 변경은 없고 읽기 모듈 코드 rollback에 데이터 삭제가 필요 없다.
- 후속 `resolveStoredSnapshotOpeningBudget`는 위 실제 저장 occupancy 결과를 받아 snapshot의 공용 현금과
  bucket max band의 미예약 상한을 계산한다. 현금 reserve는 기존 gap 계산과 같은
  `max(minimumCashReserveKrw, round(NAV * targetCashRatio))`이며 전체 bucket/과거 정책의 잔여 예약을
  한 번 차감한다. Pending BUY는 해당 예약에 이미 포함되므로 다시 빼지 않고, 아직 제출되지 않은
  예약도 차감한다. Pending SELL의 예상 대금이나 caller의 예약 면제 ID로 현금을 늘리지 않는다.
  Bucket별 max band는 `candidatePositionExposureBounds`와 같은 정규 십진수 BigInt 곱셈 후 내림으로
  계산한다. 상한을 반올림으로 높이거나 부동소수점 곱셈 오차로 줄이지 않는다. 해당 band에서 양수 보유
  노출과 해당 bucket의 잔여 gross 예약을 차감하고, 공용 현금 상한과
  작은 값을 반환한다. 모든 bucket의 상한은 같은 공용 현금을 공유하므로 합산 가능한 독립 예산이 아니다.
  초과 점유는 예약을 삭제하지 않고 상한 0 및 overcommitted로 표시하며 safe integer 경계를 검사한다.
  이는 비용을 포함한 추가 현금 debit과 max band의 보수적인 역사적 상한이지 selection trigger/min/entry
  gap, 최종 수량/비용, 기존 position 증가 자격이나 current CAS 승인 자체가 아니다. Available slot은
  별도로 반환하므로 0 slot에서 양수 금액 상한이 있어도 신규 종목을 허용하지 않는다. 실제 결과 회계,
  원자 할당 및 Risk Engine gate는 여전히 후속이다. 기존 candidate cash input 계약, API, 저장 artifact는
  바꾸지 않으며 새 읽기 모듈 rollback에 데이터 삭제나 migration은 없다.
- capacity reservation event hash는 event ID/hash/createdAt을 제외한 complete strict variant
  payload에서 계산하고 ID는 hash에서 파생한다. resolver는 source assignment/manual reservation,
  mandate/event와 paper fill origin을 exact ID/hash로 resolve한 뒤 독립 rehash한다. 첫 `reserved`
  event만 predecessor를 생략하며 이후 event는 current chain head와 다음 ledger version을 정확히
  가리켜야 한다. unknown/optional origin, transition branch, version gap, terminal 이후 event,
  증가한 remaining notional과 event type에 맞지 않는 slot flag는 모두 거절한다.
- selector assignment reservation과 manual reservation은 모두 expected `capacityLedgerVersion`을
  조건으로 같은 state를 compare-and-swap한다. `(portfolioId, policyHash, bucket,
  reservedSlotOrdinal)`은 active/unconsumed 동안 unique하고 총 reserved notional은 current gap과
  maximum additional exposure budget을 넘을 수 없다. mandate activation은 reservation을
  `bound_to_mandate`로 한 번만 전환할 뿐 slot/notional을 해제하지 않는다. 신규 position의 첫
  BUY fill이 생길 때 slot reservation을 `consumed_by_position`으로 바꾸고 active position count를
  같은 transaction에서 늘려 합계 점유량을 유지한다. partial fill은 filled notional만 차감하고
  잔여 reservation은 mandate에 계속 묶는다. target 충족 또는 mandate 취소·retire 시에만 잔여를
  consume/release하며 ledger를 같은 transaction에서 갱신한다.
  충돌한 요청은 stale snapshot으로 재계산해야 하며 이전 snapshot의 별도 reservation을 만들 수 없다.
- selector mandate와 최초 `reserved` event는 ledger가 부여한 전역 `reservedSlotOrdinal`, reservation
  ID/hash와 reserved maximum notional을 직접 보존한다. resolver는 assignment set의 request-local
  `selectedRank`를 slot으로 간주하지 않고 capacity event chain에서 같은 ordinal과 reservation
  ID/hash를 독립 검증한다.
- `classify_existing_reduce_only`는 evidence가 blocked여도 기존 position 분류를 위해
  classification range를 기록할 수 있지만 신규 매수와 수량 증가는 금지한다.
- AI 문자열은 `reasonCodes`나 `evidenceRefs`를 대체할 수 없다.
- target weight는 AI 출력이 아니라 backend sizing 결과다.

### 6.4 `PositionStrategyState`

```ts
type PositionStrategyState =
  | AssignedPositionStrategyState
  | UnassignedLegacyPositionStrategyState;

interface AssignedPositionStrategyState {
  stateKind: "assigned";
  positionStrategyStateHash: string;
  portfolioId: string;
  market: Market;
  symbol: string;
  mandateId: string;
  mandateHash: string;
  lastMandateEventId: string;
  lastMandateEventHash: string;
  policyHash: string;
  openedAt: string;
  lastIncreasedAt?: string;
  lastReducedAt?: string;
  lastReviewedAt: string;
  nextReviewAt?: string;
  lastReviewedTriggerRef: string;
  peakPriceKrw: number;
  partialTakeProfitExecuted: boolean;
  thesisStatus: "intact" | "watch" | "invalidated" | "unknown";
}

interface UnassignedLegacyPositionStrategyState {
  stateKind: "unassigned_legacy";
  positionStrategyStateHash: string;
  portfolioId: string;
  market: Market;
  symbol: string;
  observedPositionRef: string;
  reasonCodes: Array<
    "missing_mandate" | "missing_policy_lineage" | "missing_opened_at"
  >;
  detectedAt: string;
  status: "review_required";
}
```

기존 replay-local trailing state를 durable strategy state로 승격한다. portfolio snapshot과
strategy state의 policy/mandate lineage가 일치하지 않으면 신규 매수를 중단한다.
- `positionStrategyStateHash`는 hash 자체를 제외한 complete variant payload에서 계산한다.
  resolver는 매 read/restart마다 strict variant를 canonicalize해 독립 rehash하고 assigned
  state의 mandate/event ID/hash를 exact resolve한다. peak, partial take-profit, holding/review
  timestamp, thesis status 또는 legacy reason 중 하나라도 digest와 다르면 해당 symbol의 신규
  action을 fail-closed하고 read-only corruption 상태로 보고한다.
legacy position에 mandate, policy hash 또는 신뢰할 수 있는 `openedAt`이 없으면 값을
추정하지 않고 `unassigned_legacy` variant로 저장한다. 이 variant에는 가상의 lineage나
holding state를 채우지 않으며, 하나라도 존재하면 해당 portfolio의 신규 매수를
fail-closed하고 read-only inspection과 Risk Engine을 통과한 reduce-only 처리만 허용한다.
scheduled cadence mandate/state는 `reviewAfter`/`nextReviewAt`을 필수로 검증한다.
`every_tick`은 두 timestamp를 생략하고 `lastReviewedTriggerRef`에 마지막 처리 market
packet hash를 저장해 다음 packet의 due 여부를 결정한다.

### 6.5 `BucketRiskState`

```ts
interface BucketRiskState {
  riskStateEpochId: string;
  portfolioId: string;
  bucket: StrategyBucket;
  policyHash: string;
  drawdownSemanticsHash: string;
  units: number;
  unitNavKrw: number;
  highWaterMarkUnitNavKrw: number;
  equityKrw: number;
  drawdownRatio: number;
  lastBucketEquityEventId: string;
  riskStateHash: string;
  asOf: string;
}

interface BucketTurnoverState {
  turnoverStateId: string;
  turnoverStateHash: string;
  portfolioId: string;
  bucket: StrategyBucket;
  lastAppliedPolicyHash: string;
  windowStartedAt: string;
  windowEndsAt: string;
  windowOpenPortfolioNetWorthKrw: number;
  cumulativeAbsoluteFilledNotionalKrw: number;
  turnoverRatio: number;
  lastTurnoverEventId?: string;
  asOf: string;
}

interface BucketTurnoverEvent {
  turnoverEventId: string;
  turnoverEventHash: string;
  previousTurnoverEventId?: string;
  turnoverStateId: string;
  portfolioId: string;
  bucket: StrategyBucket;
  policyHash: string;
  rebalancePlanId: string;
  rebalanceActionId: string;
  fillId: string;
  absoluteFilledNotionalKrw: number;
  resultingCumulativeAbsoluteFilledNotionalKrw: number;
  asOf: string;
  createdAt: string;
}

interface BucketValuationMarkRecord {
  bucketValuationMarkRecordId: string;
  valuationMarkHash: string;
  portfolioId: string;
  bucket: StrategyBucket;
  policyHash: string;
  positionInputs: Array<{
    market: Market;
    symbol: string;
    quantity: number;
    previousPositionMarkHeadId: string;
    previousPositionMarkHeadHash: string;
    previousPriceKrw: number;
    currentPriceKrw: number;
    previousPriceEvidenceRef: string;
    currentPriceEvidenceRef: string;
  }>;
  equityDeltaKrw: number;
  asOf: string;
  createdAt: string;
}

interface BucketPositionMarkHeadState {
  positionMarkHeadId: string;
  positionMarkHeadHash: string;
  portfolioId: string;
  bucket: StrategyBucket;
  market: Market;
  symbol: string;
  quantity: number;
  currentPriceKrw: number;
  currentPriceEvidenceRef: string;
  lastPositionMarkHeadEventId: string;
  lastPositionMarkHeadEventHash: string;
  lastValuationMarkRecordId?: string;
  lastValuationMarkHash?: string;
  lastPositionMutationRef?: string;
  asOf: string;
}

interface BucketMandateMigrationTransferRecord {
  migrationRecordId: string;
  migrationRecordHash: string;
  portfolioId: string;
  market: Market;
  symbol: string;
  quantity: number;
  fromBucket: StrategyBucket;
  toBucket: StrategyBucket;
  retiringMandateId: string;
  retiringMandateHash: string;
  activatingMandateId: string;
  activatingMandateHash: string;
  sourcePositionMarkHeadId: string;
  sourcePositionMarkHeadHash: string;
  transferPriceKrw: number;
  transferPriceEvidenceRef: string;
  transferEquityKrw: number;
  transferGroupId: string;
  asOf: string;
  createdAt: string;
}

interface BucketPositionMarkHeadEventBase {
  positionMarkHeadEventId: string;
  positionMarkHeadEventHash: string;
  portfolioId: string;
  bucket: StrategyBucket;
  market: Market;
  symbol: string;
  resultingQuantity: number;
  resultingPriceKrw: number;
  resultingPriceEvidenceRef: string;
  asOf: string;
  createdAt: string;
}

type BucketPositionMarkHeadEvent = BucketPositionMarkHeadEventBase &
  (
    | {
        eventType: "initialized";
        previousPositionMarkHeadEventId?: never;
        initializationOrigin:
          | {
              originKind: "position_opening_fill";
              fillId: string;
              paperFillRecordId: string;
              paperFillHash: string;
            }
          | {
              originKind: "legacy_verified_mark";
              observedPositionRef: string;
              markEvidenceRef: string;
            };
      }
    | {
        eventType: "valuation_applied";
        previousPositionMarkHeadEventId: string;
        previousPositionMarkHeadEventHash: string;
        bucketValuationMarkRecordId: string;
        valuationMarkHash: string;
        bucketEquityEventId: string;
        bucketEquityEventHash: string;
      }
    | {
        eventType: "position_mutation_applied";
        previousPositionMarkHeadEventId: string;
        previousPositionMarkHeadEventHash: string;
        mutationOrigin:
          | {
              originKind: "paper_fill";
              fillId: string;
              paperFillRecordId: string;
              paperFillHash: string;
            }
          | {
              originKind: "verified_migration";
              migrationRecordId: string;
              migrationRecordHash: string;
            };
      }
    | {
        eventType: "bucket_transfer_out";
        previousPositionMarkHeadEventId: string;
        previousPositionMarkHeadEventHash: string;
        migrationRecordId: string;
        migrationRecordHash: string;
        transferGroupId: string;
      }
    | {
        eventType: "bucket_transfer_in";
        previousPositionMarkHeadEventId?: never;
        previousPositionMarkHeadEventHash?: never;
        migrationRecordId: string;
        migrationRecordHash: string;
        transferGroupId: string;
      }
  );

type BucketEquityEvent =
  | {
      eventType: "epoch_initialized";
      bucketEquityEventId: string;
      bucketEquityEventHash: string;
      riskStateEpochId: string;
      activationId: string;
      previousRiskStateEpochId?: string;
      portfolioId: string;
      bucket: StrategyBucket;
      policyHash: string;
      drawdownSemanticsHash: string;
      initializationMode: "initial_or_empty" | "carried_forward";
      initialEquityKrw: number;
      initialUnits: number;
      initialUnitNavKrw: number;
      initialHighWaterMarkUnitNavKrw: number;
      asOf: string;
    }
  | {
      eventType: "capital_flow";
      bucketEquityEventId: string;
      bucketEquityEventHash: string;
      previousBucketEquityEventId: string;
      riskStateEpochId: string;
      portfolioId: string;
      bucket: StrategyBucket;
      policyHash: string;
      amountKrw: number;
      rebalancePlanId: string;
      rebalanceActionId: string;
      fillId: string;
      paperFillRecordId: string;
      paperFillHash: string;
      fillAccountingGroupId: string;
      fillAccountingSequence: 0 | 1;
      asOf: string;
    }
  | {
      eventType: "valuation";
      bucketEquityEventId: string;
      bucketEquityEventHash: string;
      previousBucketEquityEventId: string;
      riskStateEpochId: string;
      portfolioId: string;
      bucket: StrategyBucket;
      policyHash: string;
      equityDeltaKrw: number;
      bucketValuationMarkRecordId: string;
      valuationMarkHash: string;
      evidenceRefs: string[];
      asOf: string;
    }
  | {
      eventType: "execution_cost";
      bucketEquityEventId: string;
      bucketEquityEventHash: string;
      previousBucketEquityEventId: string;
      riskStateEpochId: string;
      portfolioId: string;
      bucket: StrategyBucket;
      policyHash: string;
      equityDeltaKrw: number;
      rebalancePlanId: string;
      rebalanceActionId: string;
      fillId: string;
      paperFillRecordId: string;
      paperFillHash: string;
      fillAccountingGroupId: string;
      fillAccountingSequence: 0 | 1;
      evidenceRefs: string[];
      asOf: string;
    }
  | {
      eventType: "strategy_transfer_out" | "strategy_transfer_in";
      bucketEquityEventId: string;
      bucketEquityEventHash: string;
      previousBucketEquityEventId: string;
      riskStateEpochId: string;
      portfolioId: string;
      bucket: StrategyBucket;
      policyHash: string;
      migrationRecordId: string;
      migrationRecordHash: string;
      transferGroupId: string;
      transferSequence: 0 | 1;
      amountKrw: number;
      asOf: string;
    };
```

- policy activation은 bucket별 새 `riskStateEpochId`를 만들고 activation ID를 직접 참조하는
  `epoch_initialized` event로 시작한다. 초기화에는 존재하지 않는 rebalance plan을 참조하지
  않는다.
- 모든 bucket equity event는 event ID와 `bucketEquityEventHash`를 제외한 complete variant
  payload에서 hash를 계산하고 ID를 hash에서 파생한다. predecessor fold 전에 event type,
  epoch/activation, amount/delta, execution/mark origin과 초기 NAV/HWM/units를 포함한 payload를
  독립 rehash하며 mismatch는 전체 epoch를 corrupt로 처리해 신규 매수를 fail-closed한다.
- 기존 bucket risk state가 있고 `drawdownSemanticsHash`가 같으면 `carried_forward`로 이전
  epoch ID, unit NAV와 high-water mark를 그대로 이어받는다. 정책의 다른 field가 바뀌어도
  drawdown history는 초기화되지 않는다.
- 최초 epoch이거나 bucket units/equity가 모두 0인 경우에만 `initial_or_empty`를 허용하고
  unit NAV/high-water mark를 1로 시작한다. exposure가 남은 상태에서 drawdown semantics
  hash가 바뀌면 activation을 거절하며 암묵적인 baseline reset은 허용하지 않는다.
- 모든 initialization에서 `initialEquityKrw >= 0`,
  `initialUnits = initialEquityKrw / initialUnitNavKrw`, high-water mark가 unit NAV 이상인지
  검증한다. 이전 epoch와 high-water mark event는 삭제하지 않는다.
- shared cash와 bucket 사이의 allocation/deallocation은 `capital_flow` event로 기록하고
  flow 직전 unit NAV에서 unit을 mint/burn한다. 따라서 자금 이동 자체는 unit NAV와
  drawdown을 바꾸지 않는다. 양수 amount는 mint, 음수 amount는 burn이며 0 amount와
  보유 unit을 초과하는 burn은 거절한다.
- `strategy_transfer_out/in`은 shared cash flow나 fill이 아니라 위 verified mandate migration
  record만 origin으로 사용한다. 같은 transfer group의 out/in 금액 합은 0이고 sequence는
  old=0, new=1이어야 하며 두 bucket event, mark-head transfer와 mandate state를 한 transaction에서
  처리한다. transfer는 각 bucket의 unit 수만 조정하고 unit NAV/HWM 또는 portfolio total equity를
  바꾸지 않는다.
- capital flow는 exact plan/action/fill origin을 resolve하고 amount가 해당 fill에서 파생된
  cash 이동과 일치해야 한다. `fillId`는 모든 bucket capital-flow event에서 unique하며
  acknowledgement-loss retry는 기존 event를 반환한다. 새 event ID로
  같은 origin을 다시 append하거나 다른 amount에 재사용하면 거절한다.
- fill accounting group ID는 portfolio/plan/action/fill에서 결정론적으로 파생한다. BUY는
  `capital_flow(sequence=0) -> execution_cost(sequence=1)`, SELL은
  `execution_cost(sequence=0) -> capital_flow(sequence=1)` 순서로 고정한다. SELL deallocation
  amount는 비용 반영 후의 net proceeds이며 post-cost unit NAV에서 units를 burn한다.
  두 event는 한 durable transaction에서 연속 append하거나 둘 다 보이지 않게 처리하고,
  순서 역전·중간 event 삽입·불완전 group·같은 origin의 다른 sequence를 거절한다.
- bucket 내부 BUY/SELL은 asset/cash 교환이므로 체결 notional 자체는 손익이 아니다.
  mark-to-market PnL과 fee/slippage만 equity와 unit NAV를 변경한다.
- `valuation.equityDeltaKrw`는 mark-to-market 결과에 따라 양수 또는 음수일 수 있다.
  valuation은 exact immutable `BucketValuationMarkRecord` ID/hash를 참조한다. mark record는
  position input을 market/symbol 순으로 canonicalize하고 duplicate를 거절하며 ID/hash/createdAt을
  제외한 payload로 hash와 hash-derived ID를 만든다. resolver는 저장된 quantity와 이전/현재
  mark evidence로 delta를 독립 재계산한다. 각 input의 previous head ID/hash, quantity, price와
  evidence는 해당 symbol의 current `BucketPositionMarkHeadState`와 정확히 같아야 하고
  `previousPriceKrw`는 그 head의 `currentPriceKrw`여야 한다. current `asOf`는 head보다 뒤여야 하며
  같은 symbol의 overlapping/discontinuous interval은 거절한다. valuation event와 모든 resulting
  position mark head CAS update는 한 transaction으로 처리한다. 같은 epoch/bucket/mark record origin의 exact retry는
  기존 event를 반환하고 새 event ID, predecessor 또는 delta로 중복 append할 수 없다.
- fill 또는 position migration으로 quantity가 바뀌면 다음 valuation 전에 exact fill/migration
  origin을 가진 position mark head update로 quantity와 price basis를 조정한다. resolver는 이전
  head와 mutation origin을 replay해 새 head를 검증하며, 임의의 이전 가격을 제시하거나 fill 이후
  오래된 head에서 valuation을 분기할 수 없다. initial/legacy position의 첫 head는 verified current
  mark evidence로 열고 그 자체로 valuation PnL을 만들지 않는다.
- paper fill mutation은 quantity를 바꾸기 전에 기존 quantity 전체를 fill record의 authenticated
  `sourcePriceKrw`/price evidence로 valuation하고 그 valuation event/head update를 먼저 원자 적용한다.
  이어지는 mutation head의 `resultingPriceKrw`와 evidence는 같은 source price/evidence여야 하며
  BUY/SELL 모두 `fillPriceKrw`로 rebase할 수 없다. spread/slippage/impact 차이는 이미
  `execution_cost`로 계상하므로 이를 mark baseline에 다시 포함하지 않는다. 신규 position은 source
  price로 initialize하고, verified migration은 previous head의 price/evidence를 그대로 보존하는
  quantity reconciliation만 허용한다. migration이 가격을 바꾸려면 별도 authenticated valuation을
  먼저 적용해야 한다. resolver는 origin fill/migration과 이 규칙으로 resulting head를 독립 재계산한다.
- position mark head event hash는 event ID/hash/createdAt을 제외한 complete strict variant
  payload에서 계산하고 ID는 hash에서 파생한다. `initialized`와 새 bucket head의
  `bucket_transfer_in`만 predecessor를 생략하며 valuation, mutation과 `bucket_transfer_out`은
  previous event ID/hash와 exact authenticated origin을 필수로 가진다. transfer-out 이후 old
  head event는 terminal이다. head
  snapshot hash는 자기 hash를 제외한 complete payload에서 계산하고 stable ID는
  portfolio/bucket/market/symbol에서 파생한다. 사용 전 event chain을 독립 rehash·replay해 resulting
  quantity/price/evidence, last origin과 snapshot hash가 모두 일치해야 하며 mismatch는 valuation과
  신규 매수를 fail-closed한다.
  `execution_cost.equityDeltaKrw`는 0 이하만 허용하고 exact `PaperFillExecutionRecord`
  ID/hash를 참조한다. resolver는 source/fill price, quantity, participation/liquidity input,
  complete execution policy와 fee/tax/spread/slippage/impact breakdown을 독립 재계산하고
  `equityDeltaKrw = -totalCostKrw`인지 검증한다. exact plan/action/fill scope가 다르거나 양수
  cost, unresolved/corrupt fill 또는 중복 origin cost event는 거절한다.
- `capital_flow`, `valuation`, `execution_cost`를 append할 때마다 resulting equity/units에서
  unit NAV를 계산한다. capital flow는 NAV/HWM을 유지하고 valuation/execution cost 후에는
  `highWaterMarkUnitNavKrw = max(previous, unitNavKrw)`,
  `drawdownRatio = 1 - unitNavKrw / highWaterMarkUnitNavKrw`로 계산한다.
- resulting risk state를 같은 transaction/event fold에서 먼저 확정한 뒤 risk breach를
  평가한다. 특히 fee/slippage만으로 drawdown limit을 넘으면 이전 snapshot 값이 아니라 새
  drawdown으로 즉시 buy 차단과 reduce-only cycle을 만든다.
- units가 0이면 마지막 unit NAV/high-water mark를 유지하며, 같은 epoch의 재진입은 그
  NAV에서 mint한다. 새 policy activation도 위 `initial_or_empty` 조건이 아니면 baseline을
  재설정할 수 없다.
- epoch의 첫 event는 반드시 predecessor가 없는 `epoch_initialized`여야 한다. 이후 event는
  `previousBucketEquityEventId`를 필수로 가지며 event ID와 predecessor를 선형 append-only로
  검증한다. current snapshot은 event replay로 재구성 가능해야 하며 event/snapshot mismatch나
  누락은 신규 매수를 fail-closed한다.
- `riskStateHash`는 hash 자체를 제외한 current state payload의 canonical digest이며 event
  replay 결과와 독립 rehash가 모두 일치해야 한다.

<!-- /spom-source -->

## 기존 PR 3의 세부 계약 · 원문 3324–3603행

<a id="spom-source-3324-3603"></a>
<!-- spom-source:3324-3603 sha256:e6ab8ecf81ff034e12ce8e3dfd6a8de99a909ea601e6b009549b9cfedf6ae5c9 -->

첫 분할은 `InvestmentMandateRecord`, lifecycle event와 manual assignment event의
strict variant schema, canonical ordered set, full-payload hash, hash-derived ID와 timezone-safe
chronology 검증을 구현한다. `createdAt`은 semantic hash에서 제외하며 parser가 저장 payload를
독립 rehash한다. `every_tick` mandate는 `intraday` bucket에만 허용하고 manual
`open_or_increase` assignment의 `maximumNotionalKrw`는 양수로 제한한다. opening-capable
mandate와 assignment는 양수 `targetWeightRatio`와 `maxWeightRatio`를 요구한다.
retired lifecycle event의 `supersededByMandateId`는 자기 `mandateId`와 같을 수 없다.

두 번째 분할은 `instrument-mandate-records.jsonl`과
`instrument-mandate-events.jsonl`을 하나의 exclusive lock 아래 read-validate-append하는 strict
repository를 구현한다. exact retry는 저장된 동일 record/event로 수렴하고 ID collision, torn/blank
JSONL, abandoned lock과 전체 history rehash/fold 실패는 쓰기 전에 fail-closed한다. lifecycle은
`portfolioId + market + symbol`별 단일 predecessor chain으로 fold한다. 최초 activation만
predecessor를 생략하고, 후속 activation은 기존 retirement가 미리 선언한 proposed successor와
정확히 일치해야 한다. 따라서 `proposed`, `active`, `review_required`, `retired` 상태는 저장하지
않고 event replay로 파생하며 한 종목에 두 current mandate가 생기는 branch를 거절한다. manual
assignment repository/dependency resolver, durable `PositionStrategyState` repository, bucket equity state와 runner
연결은 후속 분할 전까지 구현 완료로 간주하지 않는다.

세 번째 분할은 assigned/unassigned legacy `PositionStrategyState`의 strict variant와 complete
payload hash를 구현한다. parser는 read/restart마다 저장 payload를 canonical form으로 독립 rehash하고
legacy reason duplicate/order, peak price와 holding/review timestamp를 검증한다. assigned state
resolver는 exact mandate ID/hash, current mandate event ID/hash와 portfolio/market/symbol/policy scope를
다시 해소한다. scheduled state의 `nextReviewAt`은 mandate `reviewAfter`와 같아야 하며 every-tick
state는 `nextReviewAt`을 생략하고 `lastReviewedTriggerRef`에 SHA-256 market packet hash를 보존한다.
legacy variant에는 mandate/policy/holding lineage를 합성하지 않는다. durable position state
repository, manual assignment repository/dependency resolver, legacy migration coordinator, bucket equity
state와 runner 연결은 후속 분할 전까지 구현 완료로 간주하지 않는다.

네 번째 분할은 canonical instrument scope 순서로 저장하는
`position-strategy-state.json` snapshot repository를 구현한다. 각 read/restart는 모든 state의 complete
payload hash와 assigned mandate/event dependency를 다시 검증하며, mandate repository의 consistent
snapshot lock을 position-state CAS commit까지 유지해 review/retirement transition과 stale state 쓰기의
경합을 막는다. `(portfolioId, market, symbol)`별 expected state hash compare-and-swap, concurrent exact
retry 수렴, 임시 파일 durable sync 후 atomic replace, duplicate scope/non-canonical order/torn write/
abandoned lock fail-closed를 적용한다. assigned state update는 `openedAt`을 바꿀 수 없고 holding/review
timestamp, peak price와 partial take-profit 실행 여부를 과거 상태로 되돌릴 수 없다. manual assignment
repository/dependency resolver, legacy migration coordinator, mandate transition과 position state를 함께
commit하는 다중 파일 coordinator, bucket equity state와 runner 연결은 후속 분할 전까지 구현 완료로
간주하지 않는다.

다섯 번째 분할은 `manual-assignment-events.jsonl` strict append-only repository를 구현한다. event
ID/hash를 매 read마다 독립 검증하고 concurrent exact retry는 기존 event로 수렴시키며 ID collision,
torn/blank/corrupt/duplicate line과 abandoned lock은 append 전에 fail-closed한다. activation-aware
caller가 제공한 active runtime policy와 selection policy record는 event의 portfolio/policy/bucket/market,
selection record ID/hash/version/lineage와 정확히 일치해야 한다. 저장된 event를 manual mandate에
bind할 때 assignment ID, authorization scope, portfolio/policy/market/symbol/bucket/as-of, evidence refs와
classification 또는 opening range를 모두 비교한다. open/increase mandate의 reserved notional은 양수이고
mandate opening cap과 같으며 event의 authorized maximum을 넘을 수 없다. evidence observation replay,
portfolio sizing snapshot/input/output, capacity reservation record와 active policy activation을 한 lock에서
다시 해소하는 coordinator는 PR4/5 계약과 함께 후속 분할 전까지 구현 완료로 간주하지 않는다.

여섯 번째 분할은 `BucketEquityEvent`의 epoch initialization, capital flow, valuation,
execution cost, strategy transfer strict variant와 `BucketRiskState` snapshot contract를 구현한다.
event는 ID/hash를 제외한 complete payload를 digest하고 ID를 hash에서 파생하며, initialization
mode별 predecessor, units/NAV/high-water mark 관계, event별 금액 부호와 accounting sequence,
valuation/cost evidence의 canonical order를 검증한다. risk snapshot은 equity, NAV/high-water mark와
drawdown을 독립 재계산하고 complete payload hash를 검증한다. JSON digest에서 `-0`이 `0`으로
축약되는 identity ambiguity를 막기 위해 0을 허용하는 금액과 비율에도 negative zero를 거절한다.
equity, units와 unit NAV 사이의 교차 산술 검증은 IEEE-754 역연산 오차만 수용하는 규모 기반의
결정론적 허용오차를 적용하고 그 범위를 넘는 drift는 거절한다.
append-only repository의 선형 predecessor fold, exact origin resolver와 fill group/transfer의 다중 파일
durable transaction은 후속 분할 전까지 구현 완료로 간주하지 않는다.

일곱 번째 분할은 `bucket-equity-events.jsonl` strict append-only repository와 deterministic
replay fold를 구현한다. repository는 하나의 exclusive lock 아래 매 read/restart마다 모든 event의
complete payload hash와 hash-derived ID를 다시 검증하고, `(portfolioId, bucket)`별 current epoch와
event head를 재구성한다. epoch 첫 event, exact predecessor, policy scope, non-regressing `asOf`,
initial-or-empty 조건과 동일 drawdown semantics의 exact carried state를 검증한다. capital flow와
strategy transfer는 flow 직전 unit NAV에서 unit을 mint/burn해 NAV/HWM을 유지하고, valuation과
execution cost는 resulting equity에서 unit NAV/HWM/drawdown을 갱신한다. 초과 burn, 음수·비유한
equity/unit, branch/stale epoch와 corrupt/torn/blank/duplicate JSONL은 append 전에 fail-closed한다.
보유 unit이 남은 100% drawdown은 terminal zero-NAV와 drawdown 1로 기록하되, unit이 0인 empty
epoch는 마지막 positive NAV/HWM을 보존하고 zero-NAV에서의 unit flow는 거절한다.
concurrent exact retry는 기존 event로 수렴하고 새 event는 file/directory durable sync 후 공개한다.
별도 `bucket-risk-state.json` snapshot persistence와 event/snapshot atomic commit, activation/policy 및
fill/valuation/migration exact origin resolver, fill accounting group/transfer 다중 파일 transaction,
risk breach 평가와 runner 연결은 후속 분할 전까지 구현 완료로 간주하지 않는다.

여덟 번째 분할은 replay 결과를 canonical `(portfolioId, bucket)` 순서로 저장하는
`bucket-risk-state.json` durable projection과 event/snapshot commit journal을 구현한다. 모든 정상
read/restart는 snapshot state별 complete payload hash, duplicate scope/order와 전체 event replay의
exact equality를 검증하며 journal이 없을 때 missing/corrupt/torn/mismatch snapshot을 자동 보정하지
않고 fail-closed한다. append는 이전 event-log byte length와 raw SHA-256, candidate event와 resulting
states 전체를 hash한 pending journal을 먼저 atomic replace/sync하고 event append와 snapshot replace를
같은 lock에서 수행한다. restart recovery는 journal의 이전 raw prefix와 candidate line을 독립 검증해
완전한 event는 snapshot projection을 완료하고, candidate line의 검증된 partial prefix만 남은 경우
이전 byte boundary로 truncate하고 이전 replay state를 복원한다. 예상하지 않은 later bytes, prefix/hash,
candidate/resulting-state 불일치는 복구하지 않는다. external activation/policy 및 fill/valuation/migration
origin resolver, fill accounting group/transfer와 다른 저장소를 포괄하는 transaction, risk breach 평가와
runner 연결은 후속 분할 전까지 구현 완료로 간주하지 않는다.

아홉 번째 분할은 `epoch_initialized` event를 activation-aware caller가 제공한 exact active runtime
policy pair와 immutable drawdown dependency에 결속하는 순수 origin resolver를 구현한다. resolver는
activation event와 runtime policy record를 독립 rehash하고 activation의 portfolio/policy
record/ID/version/hash/lineage tuple, event의 activation ID·portfolio·policy hash와 activation
`effectiveFrom` 시각을 모두 exact-match한다. 해당 bucket의 drawdown semantics ref도 immutable
dependency repository에서 다시 해소해 event hash와 비교한다. active pair의 추가 field, retired
event, dependency corruption 또는 어느 lineage mismatch도 거절한다. activation history를 같은
lock에서 현재 시각 기준으로 해소하고 epoch event/projection을 commit하는 coordinator, 기존 epoch의
carry-forward 판단과 runner 연결은 후속 분할 전까지 구현 완료로 간주하지 않는다.

열 번째 분할은 valuation event의 immutable origin인 `BucketValuationMarkRecord` strict contract를
구현한다. record constructor는 position input을 UTF-8 기준 market/symbol 순으로 canonicalize하고
instrument duplicate를 거절한다. parser는 ID/hash/`createdAt`을 제외한 complete payload를 독립
rehash하고 ID를 hash에서 다시 파생하며, 각 quantity와 current/previous KRW price 차이의 합으로
`equityDeltaKrw`를 결정론적으로 재계산한다. signed zero, 비유한 산술, nonzero contribution의
zero underflow, `asOf`보다 이른 `createdAt`,
non-canonical stored order와 identity drift는 fail-closed한다. exact previous mark-head/evidence 해소,
append-only record repository, position mark-head CAS update와 valuation event를 묶는 transaction은
후속 분할 전까지 구현 완료로 간주하지 않는다.

열한 번째 분할은 `bucket-valuation-mark-records.jsonl` strict append-only repository를 구현한다.
read/append마다 모든 record를 독립 rehash하고 record ID와 `(portfolioId, bucket, asOf)` origin
중복을 거절한다. exact record retry는 같은 stored record로 수렴하며 같은 origin의 다른 mark는
collision으로 fail-closed한다. read-validate-append 전체를 cross-process exclusive lock으로
직렬화하고 append file/directory sync 이후에만 성공을 반환한다. torn/blank/corrupt line,
duplicate ID/origin과 abandoned lock은 자동 복구하지 않는다. exact mark-head/evidence resolver와
position mark-head CAS 및 bucket equity event를 포괄하는 transaction은 후속 분할 전까지 구현
완료로 간주하지 않는다.

열두 번째 분할은 종목별 valuation predecessor를 보존하는 `BucketPositionMarkHeadEvent`와
`BucketPositionMarkHeadState` strict contract를 구현한다. event는 `initialized`,
`valuation_applied`, `position_mutation_applied`, `bucket_transfer_out`, `bucket_transfer_in` variant를
분리하고 event ID/hash/`createdAt`을 제외한 complete payload를 독립 rehash해 hash-derived ID를
검증한다. initialization과 mutation origin은 strict discriminated union으로 제한하고 predecessor가
필요한 variant는 ID/hash pair를 모두 요구한다. snapshot stable ID는
`portfolioId + bucket + market + symbol` scope에서 파생하고 자기 hash를 제외한 complete payload를
검증하며 valuation ID/hash는 함께 존재하거나 함께 생략해야 한다. signed zero, 비양수 price,
`asOf` 이전 `createdAt`, legacy verified mark의 evidence 변경, source transfer-out의 nonzero quantity는
fail-closed한다. append-only event repository, chain replay와 snapshot CAS persistence, fill/valuation/
migration exact origin resolver 및 bucket equity transaction 연결은 후속 분할 전까지 구현 완료로
간주하지 않는다.

열세 번째 분할은 append-only event를 current snapshot으로 재구성하는 순수
`foldBucketPositionMarkHeadHistory` replay를 구현한다. fold는 모든 event를 독립 rehash하고 global
event ID duplicate, scope별 predecessor ID/hash branch, 초기화 전 chained event, active head의 두 번째
root, closed head의 predecessor chaining과 `asOf`/`createdAt` 시각 역행을 거절한다. valuation은
mark interval을 반드시 전진시키고 quantity를 보존하며, position mutation과 transfer-out은 직전 accepted price/evidence를
바꿀 수 없다. mutation은 quantity를 실제로 변경해야 하고 transfer-out은 source quantity를 0으로
종료한다. fill과 migration origin은 event variant가 달라도 동일 scope에서 한 번만 소비할 수 있으며,
동일 scope의 authenticated origin 재사용을 거절하고 replay snapshot은
`portfolioId + bucket + market + symbol` UTF-8 순서로 canonicalize한다. quantity 0으로 닫힌 head는
후속 `initialized` 또는 `bucket_transfer_in` root로만 다시 열 수 있다. external origin resolver,
append-only repository와 durable snapshot CAS transaction은 후속 분할 전까지 구현 완료로 간주하지
않는다.

열네 번째 분할은 `bucket-position-mark-head-events.jsonl` strict append-only repository를 구현한다.
read/append마다 전체 event log를 다시 parse·rehash하고
`foldBucketPositionMarkHeadHistory`로 재생해 duplicate event ID/origin, predecessor branch, scope별
시간 역행과 잘못된 closed/reopen 전이를 저장소 경계에서도 fail-closed한다. exact event retry는
`createdAt`까지 동일한 stored event로 수렴하며 같은 hash-derived ID의 다른 stored payload는
collision으로 거절한다. read-validate-append 전체를 cross-process exclusive lock으로 직렬화하고
append file/directory sync 이후에만 성공을 반환한다. torn/blank/corrupt line, replay 불일치와
abandoned lock은 자동 복구하지 않는다. `bucket-position-mark-head-state.json` durable snapshot CAS와
event/snapshot commit journal, fill/valuation/migration 및 bucket equity exact origin resolver를 묶는
coordinator는 후속 분할 전까지 구현 완료로 간주하지 않는다.

열다섯 번째 분할은 replay 결과를 canonical
`(portfolioId, bucket, market, symbol)` 순서로 저장하는
`bucket-position-mark-head-state.json` durable projection과 event/snapshot commit journal을 구현한다.
모든 정상 read/restart는 snapshot state별 complete payload hash, duplicate scope/order와 전체 event
replay의 exact equality를 검증하며 journal이 없을 때 missing/corrupt/torn/mismatch snapshot을 자동
보정하지 않고 fail-closed한다. append는 이전 event-log byte length와 raw SHA-256, candidate event와
resulting states 전체를 hash한 pending journal을 먼저 atomic replace/sync하고 event append와 snapshot
replace를 같은 lock에서 수행한다. restart recovery는 journal의 이전 raw prefix와 candidate line을
독립 검증해 완전한 event는 snapshot projection을 완료하고, candidate line의 검증된 partial prefix만
남은 경우 이전 byte boundary로 truncate하고 이전 replay state를 복원한다. 예상하지 않은 later bytes,
prefix/hash, candidate/resulting-state 불일치는 복구하지 않는다. Windows lock file delete-pending의
일시적 `EPERM`은 같은 bounded timeout 안에서만 contention으로 재시도하며 abandoned lock은 제거하지
않는다. fill/valuation/migration 및 bucket equity exact origin resolver를 묶는 coordinator와 runner
연결은 후속 분할 전까지 구현 완료로 간주하지 않는다.

열여섯 번째 분할은 immutable valuation mark를 current position mark-head snapshot에 결속하는 순수
`resolveBucketValuationMarkPreviousHeads` resolver를 구현한다. resolver는 mark record와 제공된 모든
state를 독립 rehash하고 duplicate state scope를 거절한다. mark의 `(portfolioId, bucket)`에 속한
quantity 양수 active head 집합과 `positionInputs`가 정확히 같은 instrument 집합인지 확인하고, 각
input의 stable head ID/hash, quantity, `previousPriceKrw`/`previousPriceEvidenceRef`가 current head와
exact-match하며 mark `asOf`가 모든 head interval을 strict하게 전진시키는지 검증한다. closed head와
다른 portfolio/bucket scope는 valuation 대상에서 제외한다. typed current-price evidence contract가
아직 없으므로 generic ref에서 current price를 추정하거나 evidence hash를 합성하지 않는다. current
price evidence resolver, immutable mark repository/current snapshot을 같은 lock에서 해소하는
coordinator와 valuation bucket-equity event 및 모든 mark-head CAS update의 원자 commit은 후속 분할
전까지 구현 완료로 간주하지 않는다.

열일곱 번째 분할은 valuation과 paper fill이 공용으로 참조할 immutable
`SourcePriceEvidenceRecord` strict contract를 구현한다. record payload는 `sourceContractId`, exact
market/symbol, `priceField = last_price`, 양수 KRW price, offset-qualified `observedAt`과 canonical
unique raw `sourceRefs`를 포함한다. `evidenceHash`는 `evidenceRef`/hash/`createdAt`을 제외한 complete
payload에서 계산하고 `evidenceRef`는 hash-derived ID로 만든다. parser는 stored payload를 독립
rehash하고 non-canonical source ref order, duplicate provenance, unsupported price field, identity drift와
observation 이전 `createdAt`을 거절한다. 기존 `HistoricalMarketSnapshot.snapshotId`나 generic
`sourceRefs`는 payload hash와 결속되지 않았으므로 immutable price origin으로 승격하지 않는다.
append-only evidence repository, valuation mark의 current price/evidence resolver와 fill execution
contract 연결은 후속 분할 전까지 구현 완료로 간주하지 않는다.

열여덟 번째 분할은 `source-price-evidence-records.jsonl` strict append-only repository를 구현한다.
read/append마다 모든 record를 독립 rehash하고 evidence ref duplicate와
`(sourceContractId, market, symbol, priceField, observed instant)` semantic origin duplicate를 거절한다.
exact retry는 `createdAt`까지 같은 stored record로 수렴하고 같은 hash-derived ref의 다른 record 또는
같은 origin의 다른 price/provenance는 collision으로 fail-closed한다. read-validate-append 전체를
cross-process exclusive lock으로 직렬화하고 append file/directory sync 이후에만 성공을 반환한다.
Windows lock delete-pending `EPERM`은 bounded timeout 안에서만 contention으로 재시도하며
torn/blank/corrupt line, duplicate ref/origin과 abandoned lock은 자동 복구하지 않는다. valuation mark
current evidence resolver, verified source adapter와 fill execution contract 연결은 후속 분할 전까지
구현 완료로 간주하지 않는다.

열아홉 번째 분할은 valuation mark의 각 `currentPriceEvidenceRef`를 immutable
`SourcePriceEvidenceRecord`에 결속하는 resolver를 구현한다. resolver는 supplied evidence를 독립
rehash하고 duplicate/unresolved ref를 거절하며 market/symbol, `priceField = last_price`, exact
`currentPriceKrw`와 observed instant가 valuation input 및 mark `asOf`와 일치하는지 검증한다. offset
표현이 달라도 같은 instant는 허용한다. `createdAt`은 두 record의 authenticated identity material이
아니므로 resolver는 생성 순서를 추정하지 않는다. previous position head 검증과 active position
complete-set 규칙은 기존 resolver를 그대로 통과하며 결과는 canonical position input 순서의 immutable
typed origin으로 반환한다. 신뢰 가능한 append ordering과 valuation event, position mark-head CAS,
bucket equity event를 동일 repository lock 아래 원자 적용하는 coordinator, verified source adapter와 fill
execution 연결은 후속 분할 전까지 구현 완료로 간주하지 않는다.

스무 번째 분할은 verified mark origin과 current `BucketRiskState`에서 complete valuation application
event set을 결정론적으로 projection한다. risk state는 payload hash를 독립 검증하고 mark와
portfolio/bucket/policy가 exact-match하며 mark `asOf`보다 늦지 않고 모든 current position head
`asOf`보다 이르지 않은지 확인한다. projection은 current
bucket equity head를 predecessor로 하는 `valuation` event를 먼저 만들고 mark의 current typed price
evidence ref 전체를 canonical evidence set으로 결속한다. valuation event의 evidence 상한은 valuation
mark의 position 상한과 같은 10,000개이며 execution-cost event의 128개 상한은 유지한다. 이어서 모든
canonical position input에 대해 current position event complete set을 독립 rehash하고 state의 event
ID/hash, scope, quantity, price, evidence, `asOf`와 exact-match한 head를 predecessor로 한다. 동일 mark
ID/hash와 생성된 bucket equity event ID/hash를 참조하는 `valuation_applied` event를 만들며, `createdAt`은
mark와 supplied current head event 중 늦은 instant의 원문 값을 선택해 replay chronology를 보존한다.
결과 event는 기존 strict constructor의 hash-derived identity를 사용한다. 생성한 equity event를 current
risk state에 즉시 순수 적용해 predecessor/epoch/policy/as-of와
risk state가 zero-unit empty epoch이면 delta가 0 또는 net-zero여도 active valuation을 fail-closed한다.
그 밖의 negative balance, numeric precision 규칙은 기존 replay 계산을 재사용하고
`resultingRiskState`까지 검증한다.
전체 application graph는 immutable하다. `createdAt`은 event identity material이 아니므로 이 projection
자체가 독립적인 생성 시각 진위를 보장하지는 않는다. 후속 repository coordinator는 동일 lock 아래 저장된
current head event를 공급해야 한다. mark append와 bucket equity event, 모든 position mark-head event/state를
단일 durable transaction으로 commit하는 repository coordinator와 runner 연결은 후속 분할 전까지 구현
완료로 간주하지 않는다.

스물한 번째 분할은 `BucketValuationApplicationFileRepository`가 verified valuation mark,
bucket equity event/risk state와 모든 position mark-head event/state를 하나의 durable aggregate
transaction으로 commit하도록 구현한다. coordinator는 mark, equity, position repository의 기존
cross-process lock과 immutable source-price evidence read lock 네 개를 경로 순서대로 모두 획득한 뒤
저장된 event log와 snapshot을 다시 replay하고,
caller가 전달한 risk/head snapshot이 아니라 lock 안에서 해소한 current state를 projection 입력으로
사용한다. aggregate journal은 세 append-only log의 이전 byte length/raw SHA-256, 두 state document의
이전 hash, complete application graph와 resulting states를 결속하며 durable journal 저장이 commit
decision이다. restart recovery는 각 log가 이전 prefix와 journal suffix의 검증된 prefix인지, state
document가 이전 또는 resulting bytes인지, 전체 graph와 replay 결과가 일치하는지 확인한 뒤 모든 target을
roll-forward하고 journal을 제거한다. 예상하지 않은 later bytes, prefix/hash drift, 불완전 graph,
component repository의 pending journal과 abandoned lock은 자동 보정하지 않고 fail-closed한다.

aggregate journal이 남은 동안 기존 mark/equity/position 단일 repository reader와 writer도 동일 lock 획득
후 `requires aggregate recovery`로 중단하므로 cross-repository partial state를 노출하지 않는다. crash로
남은 lock은 운영자가 process 종료와 소유권을 확인한 뒤 별도 절차로 정리해야 하며 coordinator가 stale
lock을 추정해 삭제하지 않는다. `SourcePriceEvidenceRecord`는 이미 별도 immutable dependency로 검증되며
이번 transaction의 mutation 대상에는 포함하지 않는다. 대신 coordinator는 initial apply, recovery,
exact retry와 snapshot read에서 mark의 모든 current evidence ref를 durable evidence log에서 exact-resolve하고
record의 scope/value/observed instant를 다시 검증해 dangling provenance를 fail-closed한다. exact retry는
저장된 complete application graph와 durable evidence를 검증한 뒤 같은 결과로 수렴한다. standalone mark
repository가 exact mark를 먼저 저장했지만 application event graph가 아직 전혀 없다면 aggregate journal의
`recordWriteMode = already_stored`로 기존 mark를 prefix에 결속하고 equity/position graph만 원자 완료한다.
graph 일부만 존재하거나 stored mark가 다르면 fail-closed한다. runner가 verified mark 생성과 이 coordinator
호출을 orchestration하는 연결은 후속 분할 전까지 구현 완료로 간주하지 않는다.

스물두 번째 분할은 `runBucketValuationOnce` workflow가 durable current position/evidence에서 verified
mark를 만들고 aggregate coordinator에 적용하도록 연결한다. run input은 portfolio/bucket/policy,
canonical unique current evidence ref complete set, offset-qualified `asOf`/`createdAt`만 허용하며 live order,
broker 또는 자연어 decision field를 받지 않는다. workflow는 먼저 aggregate snapshot을 읽어 pending
journal recovery와 기존 mark/equity/position/evidence 검증을 끝낸다. 동일 portfolio/bucket/as-of mark가
이미 있으면 supplied policy와 evidence ref set이 exact-match할 때만 저장 mark로 retry하고, 적용 후
current head에서 같은 origin의 새 mark를 재계산하지 않는다. 신규 origin은 active position complete set과
durable evidence를 instrument scope로 일대일 해소하고 previous head ID/hash, quantity, previous/current
price/evidence에서 delta를 계산해 strict mark constructor를 통과시킨다. proposal read 이후 position이나 risk
state가 바뀌는 race는 aggregate coordinator의 lock 내부 재해소에서 stale로 fail-closed한다. 이 workflow는
기존 legacy `paperRunOnce` virtual-decision/order pipeline이나 scheduler에 연결하지 않으며 paper order,
fill 또는 broker mutation을 만들지 않는다. cadence orchestrator가 due bucket별 workflow input을 만드는
연결은 PR6 범위 전까지 구현 완료로 간주하지 않는다.

<!-- /spom-source -->
