# Child가 실제 사용하는 plain-data 설정의 부분 관측

기준 main: `8191da85378deaeee335ea3601291d129fb9870c` (PR822).
이 문서는 기존 [입력·runtime 계약](input-runtime-provenance-contract.md) 2단계 안에서 다음 기능 A의
범위와 검증 기준을 정한다. 설정 producer는 아직 구현되지 않았다. 접수 lineage 연결 B는 별도 기능이다.

## 목적과 경계

runner의 첫 await 전에 지원하는 scalar·plain-data 설정을 private copy로 고정하고, 실제 모든 해당
소비 경로와 반환 summary가 그 copy를 사용하도록 한다. 그 부분 설정과 실제 초기/source 관측을
immutable artifact로 결속한다. 설정 metadata나 research configHash를 소비 증거로 이름만 바꾸지 않는다.

clock, sampler, provider와 함수 callback의 상태·구현은 A에서 고정하거나 재생성하지 않는다.
원래 객체·메서드 호출 순서·사용된 state를 유지하고 해당 증거는 unavailable이다. 이 제외 때문에
부분 설정 hash가 같아도 전체 configuration/input 동일성 또는 통제된 비교를 판정할 수 없다.
completeConfiguration=false, completeInput=false 및 comparability=unavailable을 유지한다.

## 현재 코드에서 확인한 차이

- [workflow plan](../../../src/workflows/historicalReplayWorkflowPlan.ts)은 execution policy를 normalize하지만
  constraints/Risk/allocation/universe 등의 참조는 그대로 전달한다. runner는 초기/source 저장 await 뒤와
  provider await 뒤에도 caller-owned options를 읽는다.
- clock metadata에는 session이 없고 sampler metadata에는 accumulated calls/period/fingerprint state가 없다.
  metadata로 새 clock/sampler를 만들면 기존 실행 동작을 바꿀 수 있다.
- Risk metadata에는 실제 사용되는 cooldownEntries가 없다. 반면 caller의 now는 tick 시각으로 덮어쓰며,
  injected dynamicCashReserveMarketRegime은 dynamic policy가 있으면 다시 계산되고 없으면 쓰이지 않는다.
- universe research summary는 lifecycleStatusSource를 빠뜨린다. actual packet eligibility는 explicit/defaulted
  lifecycle 상태를 다르게 처리하고 중복 member에서는 마지막 entry를 선택하므로 순서·presence도 필요하다.
- admission 저장은 canonicalRequestHash/inputProvenanceHash를 accepted event에 쓰지만 accept는 void를
  반환한다. 실제 receipt가 API→batch→child로 전달되는 인터페이스와 별도 acceptance-event hash는 없다.

## A의 실제 소비 필드

다음 묶음만 부분 recorded 대상이다. frozen v1은 현재 필드/enum을 고정하며 unknown field를 버리지 않는다.
기존 타입을 자동 재사용해 미래 field/default가 조용히 추가되지 않도록 한다.

| 묶음 | 관측·격리할 값 | 소비와 보존할 의미 |
| --- | --- | --- |
| packet/가격/scope/pacing | packetIdPrefix, packetExpiresInSeconds, maxCandidates, maxSnapshotAgeSeconds, optional candidateStrategyBucket/tickDelayMs | index 가격 평가와 packet 생성의 age, 후보 scope, pacing 인자 및 반환 summary 모두 같은 값 사용. tickDelay 함수 자체는 제외 |
| constraints | maxNewPositions, maxBudgetPerSymbolKrw, allowedActions의 순서 | packet의 실제 constraint. 다른 profile 이름으로 재-resolve하지 않음 |
| execution | fillPriceRule, slippageBps, feeBps, taxBps, halfSpreadBps, fillRatio, allowFractionalShares, maxVolumeParticipationRate, minLiquidityFillRatio, rejectStaleLiquidity, marketImpactBpsPerParticipationRate | 기존 createPaperExecutionPolicy의 normalization/default/rounding 의미 유지. runner 경계의 supplied presence를 보존하고 기존 소비 시점에 normalize |
| Risk base | budget/exposure/weight/reserve scalar, bucket exposure/turnover maps, sector/country/currency/unknown-metadata limits, cooldownEntries, dynamicCashReservePolicy, hedgePolicy | nested maps/arrays도 분리. packet-dependent budget fallback과 tick 시각·scheduled exposure override·dynamic regime 계산은 같은 순서로 계속 수행 |
| allocation | policyName, exposure/reserve/budget/symbol 비율, deploymentRampDays/rampDayIndex/maxInitialDeploymentRatio, daily gross budget, initial/new/concurrent slots, positionSlotRampDays, KR/US targets | deploymentRampDays가 있을 때만 rampDayIndex omission을 tick.stepIndex+1로 계산. portfolio/tick에 따른 계산 결과를 미리 확정하지 않음 |
| regime allocation | lookbackDays, policyNameSuffix, classifier threshold/count, regimeWeights | base allocation 없으면 종전처럼 사용하지 않음. 실제 source 관측 상태와 tick 시각으로 계산; source unavailable이면 고정 source라고 주장하지 않음 |
| exit | takeProfitRatio, stopLossRatio, rebalanceMaxPositionWeightRatio, takeProfitMode, takeProfitSellRatio, trailingStopFromPeakRatio | runner 경계 supplied 객체를 보존하고 기존 normalizePaperExitPolicy 결과를 소비. absent/empty/secondary-only가 normalized null이 되는 기존 의미 유지 |
| universe lifecycle | manifest 제공 여부, 실제 member의 market/symbol/lifecycleStatus/lifecycleStatusSource, 순서·중복·presence | lifecycle consumer용 copy와 관측을 결속. description/name 등 비소비 label은 전체 universe 증거로 승격하지 않음. 새 membership filtering 없음 |

정확한 중첩 필드, enum, presence와 observer 지원 한도는 [frozen v1 계약](child-applied-settings-contract.md)에
열거한다. [Risk defaults](../../../src/paper/riskPolicy.ts), [tick 파생](../../../src/replay/replayRiskPolicy.ts),
[execution](../../../src/paper/executionModel.ts), [allocation](../../../src/paper/allocationPolicy.ts),
[regime](../../../src/paper/marketRegimeAllocationPolicy.ts), [exit](../../../src/paper/exitPolicy.ts),
[universe consumer](../../../src/market/historicalPacketBuilder.ts)를 함께 검토한다.

Risk 기본 budget 두 개는 Risk 평가 시 해당 packet의 constraints.maxBudgetPerSymbolKrw로 fallback한다.
allocation budget/headroom cap은 별도 packet allocation·sizing 경로에 적용되며 Risk base에 미리 대입하지
않는다. targetExposureRatio의 scheduled ceiling override 순서를 유지한다. caller now와
소비되지 않는 injected regime 값을 applied base라고 저장하지 않는다. 이 제외·override를 계약에 명시하고
지원 밖 unknown field가 있으면 부분 snapshot을 조용히 만들지 않는다.

## Ownership과 제외 항목의 호환성

1. 첫 await 전 shape/한도/마스킹 검사 후 plain-data copy를 만들고 callback에는 별도 copy만 준다.
   options 전체를 spread/structuredClone해 opaque 객체를 새로 만들거나 getter를 일찍 읽지 않는다.
2. 선택된 plain field의 모든 runner read를 같은 copy에 연결한다. packet/가격/Risk/exit/allocation/pacing뿐
   아니라 warning과 반환 summary도 확인한다. 원본 reference가 남아 있으면 recorded로 발행하지 않는다.
3. clock/sampler/provider/performanceClock/tickDelay 및 progress callback은 원래 경로를 유지한다.
   관측을 위해 ticks를 미리 계산하거나 sampler를 reset하지 않는다. 초기 관측 실패 시 직접 runner의
   ticks0/provider0를 유지한다. workflow plan의 기존 metadata용 clock 읽기와 runner 진입을 구분한다.
4. sampler가 이미 사용됐거나 외부에서 evaluate됐어도 기존 state를 유지한다. provider metadata를 actual
   implementation 증명으로 받아들이지 않는다. 이 필드들 때문에 전체 configuration은 unavailable이다.
5. callback 없는 direct/standalone 경로는 기존 동작을 보존한다. source/initial 관측의 기존 v1 기록을
   재작성하지 않으며 canonical 요청 clone·legacy admission 없는 실행도 차단하지 않는다.

## 크기·표현·민감 정보

새 관측은 snapshot 4MiB/file 4MiB+64KiB, universe 20,000개, cooldown 2,048개, allowedActions
128개와 고정 map key 한도를 적용한다. 문자열/표현/한도 근거는 frozen v1 계약에 명시한다. 이는 기존
replay 입력 제한이 아니다. 합성 측정은 관측 지원 예산을 정하는 근거이며 제품 전체 메모리 보장이 아니다. 전체 clone/JSON/hash 후에야 한도를 확인하는 구현은 허용하지 않는다.

default/coercion/trim/임의 sort/dedup으로 raw presence를 바꾸지 않는다. execution/exit snapshot은
runner가 받은 supplied 객체이며 normalized output이 아니다. private copy를 기존 normalizer의 원래
호출 지점에 전달하고, workflow 전에 소실된 요청 presence는 복원하지 않는다.
undefined/-0/nonfinite/잘못된 Unicode, accessor/proxy/cycle 또는 지원 밖 객체는 억지로 JSON화하지 않는다.

unsupported/limit은 내용·개별 hash 없는 unavailable이며 원래 실행 지원을 자동 축소하지 않는다.
반면 관측 경계에서 credential-bearing 설정을 검출했다면 PR822의 redacted 안전 정지 원칙을 따른다.
초기/source/configuration·legacy 출력과 오류에 값이 흐르지 않도록 실제 연결을 시험하고, 정상 ID/URL과
단어 token 등 정상 문맥을 보존한다. cap 때문에 검사하지 않은 입력 전체를 secret-free라고 주장하지 않는다.

## 저장 단위·결속·내구성

제안 artifact는 `historical-replay-settings-observation.json`, envelope `replay_settings_observation.v1`,
snapshot `replay_settings_snapshot.v1`이다. 이는 기존 input/runtime 계약의 부분 구현용 이름이며
새 권한·외부 source 허용 체계를 뜻하지 않는다.

- envelope는 exact child identity/startedAt/reservationHash와 실제 durable initial/source 관측의
  version/전체 record hash/typed 상태를 참조하고 supported settings snapshot/hash를 결속한다.
- snapshot hash domain은 `{ schemaVersion: "replay_settings_snapshot.v1", snapshot }`다. source·initial의
  기존 configuration=unavailable은 그대로 유지하고 별도 immutable 기록으로 연결한다.
- source writer는 실제 저장한 record에서 작은 immutable reference를 만들어 같은 예약 writer에 전달한다.
  전체 source 배열을 config 저장용으로 계속 붙잡거나 사후 파일을 다시 읽어 hash를 보충하지 않는다.
- 정상/unsupported/limit settings 경로는 capture → reservation → initial durable → source durable →
  settings durable → 기존 research/progress/audit 초기화 → runner ticks/provider 순서다.
- source redacted는 기존처럼 source durable 직후 중단하므로 settings 파일은 없다. settings redacted이며
  source가 안전하면 내용 없는 settings 관측까지 durable하게 쓰고 legacy artifacts 이전에 중단한다.
  같은 민감 문자열이 initial/source에도 있으면 해당 관측의 기존 redacted 상태로 내용/hash를 빼는지 시험한다.
- 새 파일/orphan을 예약 preflight의 output 부재 검사에 포함한다. exclusive write/file sync/close와
  directory open/sync/close가 끝나야 발행 완료다. 실패는 provider0, 원본/예약/부분 파일 보존이며 자동 복구 없다.
- unavailable 상태의 파일 쓰기 실패도 성공으로 삼키지 않는다. source/initial unavailable이면 정확한 상태와
  binding을 참조하되 completeInput/configuration 또는 비교 가능성을 올리지 않는다.

## A의 완료·검증 기준

- 실제 합성 child에서 initial/source/config/progress callback 및 provider await 도중 원본의 scalar와
  nested 설정을 바꾸고 관측 hash와 실제 packet limits/가격 age/scope/lifecycle/Risk/fill/exit/pacing을 대조한다.
- 모든 v1 field와 omission/0/false/null/빈 배열·map, cooldown, 비용/spread/impact, lifecycle explicit/defaulted,
  allocation ramp/regime 및 raw exit의 hash 민감도·정규화 후 동작 호환성을 검증한다.
  hash는 관측 raw 값/presence에 반응하며 동일 normalized 결과가 같은 raw hash라는 주장은 하지 않는다.
- fresh/reused/injected sampler, clock/session/provider의 원래 상태·호출 순서를 유지하고 그 관측은 unavailable이다.
  metadata가 같은 다른 provider 또는 session은 동일한 전체 input으로 판정하지 않는다.
- initial/source/config/reservation 혼합·교체·hash mismatch·unknown version, alias/기존/orphan/경합/재시도 및
  모든 내구성 실패에서 provider0·barrier 보존을 검증한다. 초과/unsupported는 기존 실행, redacted는 안전 정지다.
- credential 합성 negative에서 새 모든 관측·legacy artifacts·error/log의 비노출과 정상 URL/ID 허용을 함께 검사한다.
- API 실제 fixture create, canonical clone, 기존 source/initial/research 의미와 completeInput=false 회귀를 유지한다.
- 최종 구현은 자체 diff/안전/문서 검토, 필요한 공식 profile과 독립 검토, 최종 후보 Linux full 및 자동 review/
  현재 GitHub 보호 조건을 통과한 뒤 게시·병합한다. 이전 PR822 full은 새 backend 변경의 full로 재사용하지 않는다.

## 후속 B: admission lineage

A에는 접수 receipt 전달을 넣지 않는다. B는 durable accepted 이후 canonicalRequestHash/inputProvenanceHash와
ID/acceptedAt를 server-owned receipt로 반환하고 API→batch→실제 child로 전달하는 별도 기능이다.
기존 accepted event에 없는 별도 hash가 이미 있다고 가정하지 않는다. HTTP가 제출한 hash/verified 주장으로
lineage를 만들거나 과거 기록을 재작성하지 않는다.

random/fixed window, child index/seed, single runCount override, API/batch default 차이와 stored initial cash를
명시적으로 매핑한다. receipt 존재는 설정 동일성의 대체 증거가 아니며 A의 공유 field와 알려진 변환을
검증해야 한다. legacy receipt omission은 admission unavailable이고 기존 실행/clone을 보존한다.
clock/sampler/provider/runtime/dependencies/result 및 public reader/비교 UI는 각각 후속 경계다.
