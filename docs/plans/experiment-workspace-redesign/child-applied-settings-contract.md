# Child 부분 설정 snapshot v1 계약

[기능 A 범위](child-applied-settings-scope.md)의 frozen v1 구현 계약이다. 기준 runtime은 PR822의
main `8191da85378deaeee335ea3601291d129fb9870c`다. 이 변경은 해당 부분 producer를 구현한다.
관측 명칭은 **runner-boundary supplied settings**이며 normalized output·실행 성공·전체 configuration
증명이 아니다. 아래 지원 shape를 첫 await 전에 고정하고 실제 소비에 연결한 경우에만 recorded다.

## 표현과 presence

snapshot은 아래 top-level 필드만 가진 strict object다. 필수는 `packetIdPrefix`,
`packetExpiresInSeconds`, `maxCandidates`, `maxSnapshotAgeSeconds`, `constraints`다. 나머지는 optional이다.
모든 숫자는 finite이며 `-0`는 지원하지 않는다. 기존 consumer의 validation·clamp·rounding을 여기서
미리 실행하지 않으므로 finite 음수·0도 숫자 shape로 보존한다. boolean은 true/false만 지원한다.
문자열은 well-formed Unicode이며 빈 문자열도 보존한다. time 문자열도 trim/Date.parse normalization을
하지 않는다. 유효하지 않은 cooldown 시각을 inactive로 처리하는 기존 의미를 바꾸지 않는다.

optional omission, `{}`, `[]`, 0, false와 제공된 값을 구분한다. own-property undefined, null,
nonfinite, malformed Unicode, accessor, proxy, cycle, sparse/추가 property 배열, symbol key,
non-enumerable 또는 plain object가 아닌 선택 입력은 unsupported_shape다. 지원 밖 입력은 settings
내용/hash 없이 unavailable이며 기존 replay 실행 경로를 보존한다. null/undefined를 omission으로 바꿔
recorded하지 않는다. 속성 이름, 배열 순서와 중복을 보존하며 sort/dedup/default/coercion을 하지 않는다.
JSON object key order만 canonical hash의 기존 정렬 규칙을 따른다.

## 고정 enum

- Market: `KR`, `US`
- VirtualAction: `VIRTUAL_BUY`, `VIRTUAL_SELL`, `VIRTUAL_HOLD`
- StrategyBucket: `long_term`, `swing`, `short_term`, `intraday`, `hedge`
- Risk bucket map key: 위 5개와 `unknown`; 각 map 최대 6개
- MarketRegimeLabel: `bull`, `bear`, `sideways`, `mixed`, `insufficient_data`; 각 map 최대 5개
- InstrumentLifecycleStatus: `active`, `suspended`, `delisted`, `unknown`
- lifecycleStatusSource: `explicit`, `defaulted`
- fillPriceRule: `current_candidate_last_price`
- TakeProfitMode: `full_exit`, `partial_then_trail`

기존 Risk map 타입은 Record<string, number>다. 다른 key는 observer unsupported이며 실행 거절이
아니다. `{}`도 missing metadata guard 활성화에 쓰이므로 absent로 합치지 않는다.

## 정확한 필드

다음 표에서 `?`는 optional이다. number/string/boolean은 앞 절의 표현 규칙을 따른다.
각 strict object는 아래 열거한 field 외에는 unsupported다.

| 경로 | 필드 |
| --- | --- |
| snapshot scalar | packetIdPrefix:string, packetExpiresInSeconds:number, maxCandidates:number, maxSnapshotAgeSeconds:number, candidateStrategyBucket?:StrategyBucket, tickDelayMs?:number |
| constraints | maxNewPositions:number, maxBudgetPerSymbolKrw:number, allowedActions:VirtualAction[] |
| executionPolicy? | fillPriceRule?:literal, slippageBps?:number, feeBps?:number, taxBps?:number, halfSpreadBps?:number, fillRatio?:number, allowFractionalShares?:boolean, maxVolumeParticipationRate?:number, minLiquidityFillRatio?:number, rejectStaleLiquidity?:boolean, marketImpactBpsPerParticipationRate?:number |
| riskPolicy? scalar | maxBudgetPerDecisionKrw?, maxSymbolExposureKrw?, targetExposureRatio?, maxPositionWeightRatio?, maxSectorExposureKrw?, maxSectorExposureRatio?, maxCountryExposureKrw?, maxCountryExposureRatio?, maxCurrencyExposureKrw?, maxCurrencyExposureRatio?, maxUnknownMetadataExposureKrw?, maxUnknownMetadataExposureRatio?, minCashReserveRatio?, minCashReserveKrw?: 모두 number |
| riskPolicy? maps | maxStrategyBucketExposureKrw?, maxStrategyBucketExposureRatio?, maxBucketTurnoverKrw?, maxBucketTurnoverRatio?: Risk bucket key의 partial number map |
| riskPolicy.cooldownEntries?[] | market?:Market, symbol:string, action?:VirtualAction, activeUntil:string, reason?:string |
| riskPolicy.dynamicCashReservePolicy? | lookbackDays:number, minSymbols?:number, minSnapshotsPerSymbol?:number, bullReturnThreshold?:number, bearReturnThreshold?:number, sidewaysAbsReturnThreshold?:number, breadthThreshold?:number, minimumCashReserveRatioFloor?:number, regimeCashReserveRatios?:partial regime number map, highVolatilityReturnThreshold?:number, highVolatilityCashReserveRatio?:number |
| riskPolicy.hedgePolicy? | maxGrossExposureKrw?:number, maxGrossExposureRatio?:number, requireHedgeBucket?:boolean |
| allocationPolicy? | policyName:string, targetExposureRatio:number, minCashReserveRatio:number, maxBudgetPerDecisionRatio:number, maxSymbolExposureRatio:number, deploymentRampDays?:number, rampDayIndex?:number, maxInitialDeploymentRatio?:number, maxDailyGrossBuyRatio?:number, maxInitialOpenPositions?:number, maxNewPositionsPerDay?:number, maxConcurrentPositions?:number, positionSlotRampDays?:number, marketTargetExposureRatios?:partial KR/US number map |
| marketRegimeAllocationPolicy? | lookbackDays:number, policyNameSuffix?:string, minSymbols?:number, minSnapshotsPerSymbol?:number, bullReturnThreshold?:number, bearReturnThreshold?:number, sidewaysAbsReturnThreshold?:number, breadthThreshold?:number, regimeWeights?:partial regime number map |
| paperExitPolicy? | takeProfitRatio?:number, stopLossRatio?:number, rebalanceMaxPositionWeightRatio?:number, takeProfitMode?:TakeProfitMode, takeProfitSellRatio?:number, trailingStopFromPeakRatio?:number |
| universeManifest? | symbols: lifecycle member[] |
| universeManifest.symbols[] | market:Market, symbol:string, lifecycleStatus?:InstrumentLifecycleStatus, lifecycleStatusSource?:literal |

### 명시적으로 제외한 필드

runner options 전체를 clone하지 않는다. clock, samplingPolicy, decisionProvider, performanceClock,
tickDelay와 observer/progress callback은 원래 객체·state·호출 시점을 유지한다. 선택 field만 descriptor로
검사하며 opaque getter를 미리 읽지 않는다. 선택 field getter/proxy가 있으면 실행하지 않고 unavailable로
분기하며 기존 consumer의 나중 읽기/오류 시점을 유지한다.

Risk의 `now`와 `dynamicCashReserveMarketRegime`은 알려진 제외 field다. 전자는 tick now로 덮어쓰고
후자는 dynamic policy가 있을 때 다시 계산하며 없을 때 쓰지 않는다. 해당 field가 plain data property면
값을 순회/clone/hash하지 않고 생략한다. accessor면 기존 spread 시점의 getter 효과를 바꾸지 않도록 전체
settings 관측을 unsupported로 처리한다. 알려지지 않은 Risk field를 같은 방식으로 버리지 않는다.

universe는 lifecycle consumer용 projection만 만든다. 알려진 비소비 manifest field `mode`, `universeId`,
`snapshotDate`, `description`, `disclaimer`와 member field `sourceSymbol`, `name`, `assetType`,
`assetClass`, `region`, `riskTags`, `strategyBucket`, `sector`, `segment`, `required`, `tags`는 data
property일 때 순회/clone/hash하지 않는다. accessor는 unsupported다. labels의 전체 크기·안전성·자료
정체성 증거가 아니며 미래 unknown field는 unsupported다. projection의 `{symbols:[]}`는 지원한다.

### 소비 의미와 normalization

- execution은 runner가 받은 supplied object를 기록한다. workflow는 upstream에서 이미 normalize할 수
  있으므로 API 원래 field presence는 복원하지 않는다. private copy를 두 execution 경로에 전달하며
  createPaperExecutionPolicy의 기존 fill 시점 defaults와 spread/impact clamp를 유지한다.
- exit도 raw supplied object를 기록한다. direct runner는 관측 callbacks와 clock.ticks 뒤의 원래 위치에서
  normalizePaperExitPolicy를 호출한다. workflow plan의 앞선 metadata validation도 그대로 둔다.
  absent/empty/secondary-only가 normalized null이 되는 의미, finite invalid ratio의 throw 시점을 유지한다.
  반환 paperExitPolicy는 기존처럼 normalized object/null이다.
- Risk budget 두 개의 fallback은 각 packet.constraints.maxBudgetPerSymbolKrw다. allocation budget과
  headroom은 별도 packet allocation/sizing 소비다. raw base를 미리 채우거나 이를 섞지 않는다.
- Risk cooldown reason은 raw entry에 보존하되 실제 cooldown gate가 읽는 판단 근거라고 주장하지 않는다.
  invalid activeUntil은 기존 Date.parse 결과대로 inactive이며 reduceOnly sell의 기존 예외도 유지한다.
- allocation rampDayIndex는 deploymentRampDays가 있고 rampDayIndex가 없을 때만 tick.stepIndex+1로
  파생한다. positionSlotRampDays만 있을 때 새 기본값을 만들지 않는다. regime policy는 base allocation이
  없으면 종전처럼 무시하며 warning을 유지한다. source unavailable이면 source 파생까지 고정됐다고 하지 않는다.
- universe의 absent/empty/member missing/status source omission을 구분한다. 동일 market:symbol의 마지막
  member가 이기는 기존 순서를 유지한다. explicit source만 lifecycle gate로 사용하고 membership filtering,
  symbol trim 또는 status default를 추가하지 않는다.
- tickDelayMs는 고정 scalar를 사용하며 <=0/absent이면 tickDelay getter를 읽지 않는다. 양수인 기존 분기에서만
  원래 callback을 읽어 호출한다. opaque callback을 미리 캡처하지 않는다.
- warning, 두 Risk 경로, allocationPolicy 반환 summary와 progressSummary.maxCandidatesPerStep도 같은
  private settings에 연결한다. callback에는 별도 copy만 전달하고 returned summary로 내부 copy를 노출하지 않는다.

## 관측 지원 한도

| 항목 | v1 한도 |
| --- | --- |
| raw selected snapshot JSON UTF-8 | 4,194,304 bytes |
| 전체 envelope JSON + newline | 4,194,304 + 65,536 bytes |
| universe members | 20,000 |
| cooldown entries | 2,048 |
| allowedActions | 128; 순서/중복 유지 |
| Risk/regime/market maps | 각 6/5/2개의 위 고정 key |
| 일반 string | 120 UTF-16 code units |
| cooldown.activeUntil / cooldown.reason | 80 / 512 UTF-16 code units |

관측 지원 한도이며 기존 replay 입력 제한이 아니다. allowedActions는 runtime에서 unique/max3을
요구하지 않으므로 새 128개 observer cap을 입력 거절로 확대하지 않는다. selected shape의 container
최대 depth는 root 포함 4다. frozen schema 자체가 더 깊은 shape를 unsupported로 거절한다. 임의 padding을
허용하는 generic depth8 계약을 새로 만들지 않는다.

2026-10-08 Node v24.19.0/Linux 합성 실험에서 raw exact 4MiB를 원본/private/callback copy로
유지하고 기존 canonical hash를 계산한 process lifetime RSS는 171,810,816 bytes(163.85MiB)였다.
baseline 55.44MiB, sampled heap 최대 75.74MiB, private/callback clone 14.60/16.92ms, hash
129.42ms였다. 20,000 members와 2,048 ordinary cooldown은 2,387,639 bytes/RSS150.39MiB였다.
raw +1byte 및 allowedActions129는 clone/hash 전에 검출했다. 별도 초기 wrapper 모델의 exact4MiB
CJK/control RSS143.90/114.79MiB는 raw 모델과 구분한다.
200,000개의 중복 allowedActions는 2.94MB 안에서도 큰 allocation을 만들 수 있어 별도 count cap을 둔다.
측정은 탐색용 prototype이고 전체 프로세스 또는 병렬 child memory 보장이 아니다. 실제 parser/writer 구현
완료 후 같은 입력의 bounded preflight, hash/envelope overhead 및 겹치는 copy lifetime을 다시 검증한다.
위 측정은 parser clone, credential/proxy 검사, source/initial 자료와 index, file text/fsync 및 병렬 child를
포함하지 않는다. 동일 bytes라도 객체 수·문자 escape에 따라 RAM이 달라지며 hard ceiling이 아니다.

전체 입력을 먼저 clone/hash/JSON화하지 않는다. descriptor·key count·array length를 먼저 검사하고 bounded
leaf/subobject 단위로 정확한 escaped UTF-8 bytes를 누적한다. 문자열 code units와 escaped bytes는 각각
적용한다. source 배열 전체를 settings closure에 추가 보관하지 않는다.

### 실제 구현의 bounded 측정

같은 Node/Linux에서 actual runner capture, callback copy, strict parser, canonical hashes, exclusive file
write/sync/close와 directory sync/close를 실행한 fresh process 3개를 순차 측정했다. 각 case의 settings는
raw exact4MiB이며 escaped maximal child identity를 사용했다. source 원본·private copy와 index의 실제
생성도 포함한다. tick은 빈 배열이고 provider0이다. 저장 파일을 읽어 schema/contentHash와 실제 source
관측 record hash 결속을 대조했다.

| source fixture | source bytes / records | process lifetime max RSS bytes | settings file / envelope bytes |
| --- | ---: | ---: | ---: |
| empty | 2 / 0 | 279,879,680 | 4,220,689 / 26,385 |
| escaped byte maximum | 16,777,216 / 44 | 373,784,576 | 4,220,689 / 26,385 |
| ordinary record maximum | 8,450,001 / 50,000 | 564,510,720 | 4,220,689 / 26,385 |

세 경우 모두 exit0이며 file <=4MiB+64KiB였다. source 전체 payload는 settings 파일·writer reference에
추가되지 않는다. 이 수치는 실제 저장·검증까지 포함한 단일 process high-water mark이며 병렬 child,
긴 replay tick/portfolio growth, 임의 callback의 자료 보유와 운영 RSS 상한을 보장하지 않는다. 원본 입력의
객체 수가 bytes와 별도로 비용을 만들므로 더 큰 관측 한도를 허용할 근거로 쓰지 않는다.

## 저장 상태와 failure 순서

snapshot version은 `replay_settings_snapshot.v1`, hash domain은 `{schemaVersion,snapshot}`다.
관측은 `recorded`이면 snapshotVersion/snapshot/contentHash를 포함하고 `unavailable`이면
reason `unsupported_shape`, `redacted`, `limit`만 포함한다. 개별 입력 hash는 unavailable에 없다.

file `historical-replay-settings-observation.json`의 strict envelope는
schemaVersion `replay_settings_observation.v1`, mode `paper_only`, phase `runner_supplied_settings`,
identity/startedAt/reservationHash, 실제 durable initial/source 관측의 작은 typed reference, settings를
포함한다. 각 reference는 version/전체 observationHash와 recorded version/contentHash 또는 unavailable
reason을 가진다. completeConfiguration=false, completeInput=false, comparability=unavailable이며
admission/clock/sampler/provider/acquisition/sourceTrust/sourceFileIdentity/sourceReadCompleteness/runtime/
dependencies/result는 unavailable이다. source reference 자체는 source 관측의 정확한 상태를 보존한다.

| 분기 | durable 출력과 후속 동작 |
| --- | --- |
| settings recorded / unsupported / limit | reservation → initial → source → settings → legacy artifacts → ticks/provider; unsupported/limit은 원래 settings 실행 참조 유지 |
| source redacted | reservation → initial → 내용 없는 source 후 stop; settings 파일 없음, legacy/ticks/provider 없음 |
| settings redacted + source 정상 | reservation → initial → source → 내용 없는 settings 후 stop; legacy/ticks/provider 없음 |
| initial/source/settings write·file sync·close·directory open/sync/close 실패 | 해당 지점에서 stop, 이후 writer/legacy/ticks/provider 없음; 예약·부분 출력 보존 |

내용 없는 typed redacted **record 전체 hash**는 참조할 수 있지만 민감 snapshot/문자열 hash는 만들지 않는다.
같은 credential이 먼저 저장되는 initial/source에도 포함되면 기존 각 redaction guard로 내용/hash가 빠지는지
합성 검증한다. source redacted의 기존 정지를 늦추지 않는다. source/settings callback mutation으로 stop
조건을 무효화할 수 없도록 runner가 보유한 관측 상태도 확인한다.

source writer는 실제 record를 durable하게 쓴 뒤 작은 immutable reference만 반환한다. settings writer는
같은 예약 내부에서 전달된 reference를 사용하며 파일을 재조회/교체하지 않는다. source record payload를
settings에 복제하지 않는다. initial/source/settings 각 writer는 attempt 시작과 durability 완료를 구분한다.
중복·재진입, source 이전 settings, 실패한 source 뒤 settings와 identity/reservation/version/hash 혼합은
거절한다. 새 settings orphan도 기존 예약 preflight 검사에 포함한다. retry/overwrite/repair는 하지 않는다.

## 필수 회귀

모든 field/presence와 arrays/maps의 순서·중복, representation unsupported와 cap -1/at/+1, 실제 consumer
mutation 격리, normalizer 의미, opaque getter/state, source reference·reservation mismatch, 내구성 failure를
시험한다. 합성 credential을 정상 public URL/ID/token 단어와 함께 검사하고 관측·legacy·error/log를 스캔한다.
Risk fallback/explicit Risk budget/allocation cap을 서로 다른 값으로 두어 혼동 없는 실제 결과를 검증한다.
기존 initial/source/research/API clone의 unavailable/completeInput=false 의미를 유지한다. 검증·리뷰·병합
gate는 범위 문서와 기존 test-verification runbook을 따른다.
