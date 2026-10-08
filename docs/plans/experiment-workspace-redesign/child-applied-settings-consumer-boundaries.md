# Runner supplied settings의 실제 소비와 보안 검사 경계

이 표는 supplied settings snapshot에 기록하는 field 목록과 별도로, 기존 workflow/runner가 원본 객체를
어떻게 읽고 반환하거나 저장하는지 정리한다. 알 수 없는 field를 새 snapshot field로 추가하거나
configuration 완전성을 선언하는 근거가 아니다. 정상 unknown plain data는 기존 unsupported 분기를 유지한다.

## 소비 유형별 표

`hash`는 research manifest가 원문 대신 내용 hash를 기록한다는 뜻이다. 준비 중 canonicalization도
Object.entries와 property access를 수행하므로 hash-only 경로의 accessor/proxy가 실행되지 않는다는 뜻은 아니다.
오류 메시지 또한 반환되거나 legacy failure artifact에 기록될 수 있는 출력이다.

| 입력 경로 | 실제 준비·실행 consumer | 정상 원문 저장/반환 | unknown/비정상 값의 실제 출력 경로 | 필요한 검사 |
| --- | --- | --- | --- | --- |
| constraints | plan metadata에 원본 전달; recursive canonicalization; packetBuilder의 known field reads | schema-valid constraints가 run metadata와 packet에 저장 | unknown key는 metadata validation 오류에 노출; unknown getter/하위 proxy는 canonicalization에서 실행 | 원본 enumerable graph의 구조 검사와 진단에 나타나는 key 검사. 정상 unknown data는 unsupported 유지 |
| executionPolicy | createPaperExecutionPolicy의 field-by-field projection; fill-time normalization | normalized known fields만 metadata/실행 결과에 반영 | unknown root getter는 실제 실행하지 않고 버림 | selected field/실제 executable hook 검사. unknown root field 전체를 확대 검사할 근거 없음 |
| riskPolicy root | metadata에서는 serializeRiskPolicy projection; tick에서는 원본 object spread | known policy projection만 metadata에 저장; unknown root data는 실제 Risk defaults 생성에서 버림 | own enumerable string/symbol accessor는 spread가 실행. 오류가 progress/run-metadata에 기록될 수 있음 | 전체 enumerable descriptor의 accessor 검사. 버려지는 unknown/excluded data 값은 불필요하게 재귀 검사하지 않음 |
| riskPolicy.now / dynamicCashReserveMarketRegime | tick Risk spread 뒤 overwrite/재계산 또는 미사용 | excluded data 원문은 설정 snapshot/metadata에 저장하지 않음 | enumerable accessor는 overwrite 전에 실행되어 오류를 누출 | data 값 제외 유지; 실제 spread가 실행할 enumerable accessor는 거절 |
| Risk의 maxStrategyBucketExposureKrw/Ratio, maxBucketTurnoverKrw/Ratio | serializeRiskPolicy가 원본 map 전달; canonicalization; runtime bucket lookup | metadata의 z.record가 unknown 문자열 key와 정상 numeric value도 저장 | credential-bearing unknown key가 workflow 성공 상태의 run-metadata에 원문 저장됨. invalid value는 key를 오류 path에 노출 가능 | 네 map의 enumerable key/value 연관 관계를 bounded 검사; 정상 public unknown key/number는 unsupported 유지 |
| riskPolicy.dynamicCashReservePolicy | 원본을 metadata/hash에 전달; runtime known reads | strict schema를 통과한 known values 저장 | unknown key는 validation 오류에 포함; unknown accessor/하위 opaque 값은 canonicalization에서 실행 | recursive 구조와 실제 diagnostic key 검사 |
| dynamicCashReservePolicy.regimeCashReserveRatios | metadata partialRecord; runtime Object.entries 및 default spread | known regime key/number 저장 | unknown key가 validation 오류 path에 노출 | enumerable 구조와 key 검사; public invalid input의 기존 진단 의미 유지 |
| riskPolicy.hedgePolicy | 원본 metadata/hash; runtime known reads | strict known fields 저장 | unknown key 진단/unknown getter의 canonicalization 실행 | recursive 구조와 diagnostic key 검사 |
| riskPolicy.cooldownEntries/member | metadata에서는 제외; runtime array.some와 known member reads | 부분 settings snapshot의 지원 field만 저장; raw 전체 policy 반환 없음 | unknown member getter/data의 wholesale 소비 근거 없음 | selected member accessors, array indices/collection hooks 검사. unknown member 전체 확대 불필요 |
| allocationPolicy | 원본 metadata/hash; ramp/regime object spreads; runner summary가 unsupported 원본 policy 반환; report가 그 summary 사용 | strict known fields는 metadata에 저장. direct observed runner는 unknown data도 summary에 반환 가능 | plain unknown credential value 또는 key/value association이 direct summary에 노출. workflow의 unknown field는 대개 metadata validation에서 거절되지만 getter/잘못된 값은 앞선 준비 오류를 일으킴 | 반환되는 enumerable graph의 bounded key/value/association 검사 + recursive opaque guard. snapshot schema에는 unknown field를 추가하지 않음 |
| allocationPolicy.marketTargetExposureRatios | canonicalization; normalizeMarketTargetExposureRatios:Object.entries; allocation 계산 Object.values/entries | known KR/US targets 저장·반환 | unknown key가 metadata validation 오류 path에 노출 | actual enumerable map 구조/key 검사 |
| marketRegimeAllocationPolicy | 원본 metadata/hash; known scalar reads | strict known projection 저장 | unknown root key 진단/unknown accessor 실행 | recursive 구조와 diagnostic key 검사 |
| marketRegimeAllocationPolicy.regimeWeights | metadata partialRecord; runtime default weight object spread | known regime key/number 저장 | unknown key 진단 및 enumerable getter 실행 | actual map 구조/key 검사 |
| paperExitPolicy | normalizePaperExitPolicy의 field projection | normalized known policy만 metadata/summary에 반환 | unknown root getter는 실제 실행하지 않고 버림 | selected field 검사; unknown root field wholesale 소비로 오해하지 않음 |
| universe manifest의 mode/universeId/description/disclaimer 및 member labels | normalizeUniverseManifestForResearch가 명시 field만 읽어 새 객체 생성, 그 결과 canonicalization | 대체로 원문은 hash-only; snapshotDate는 별도 manifest field로 전달·검증 | 실제로 읽는 excluded label accessor/proxy는 준비 오류를 일으킬 수 있음. 알 수 없는 manifest/member key는 projection이 읽지 않음 | workflow-only guard로 정확한 명시 label descriptor/value 구조를 확인. label 내용은 supplied-settings snapshot/credential scan으로 승격하지 않음 |
| universe lifecycle market/symbol/status/source | runner lifecycle projection; workflow의 해당 명시 metadata fields | supported snapshot 및 packet lifecycle evidence | selected accessor/inherited value는 실제 읽히므로 실행 없이 거절 | known selected field 검사 |
| root clock/sampler/provider/performanceClock/tickDelay/observer·progress callbacks | 명시적 opaque 호출 및 상태 사용 | 해당 독립 기존 consumer의 결과 | 임의 callback 또는 callback lookup의 오류는 selected data 검사가 대신 통제할 수 없음 | 기존 runtime identity/state/호출 의미 유지. data 검사 전체를 임의 callback sandbox 보장으로 확대하지 않음 |

## 원문 저장과 오류 노출의 검증 구분

- 정상 unknown allocation string은 workflow에서 metadata unknown-key validation으로 거절되어 원문 value가 파일에
  저장되지 않는 negative case다. 같은 값이 direct observed runner summary로 반환되는 것은 별도로 확인된 positive case다.
- Risk 네 bucket map의 unknown credential-bearing key/numeric value는 schema를 통과해 workflow 완료 후 metadata에
  저장되는 positive case다. 단순히 validation error가 발생했다는 추정이 아니다.
- constraints/regime/dynamic/hedge 및 enum map들의 unknown credential-bearing key는 strict validation 오류 text에
  실제 포함되는 positive case다. 원문 value persistence와 error-path key 노출을 구분한다.
- unknown allocation key의 value가 undefined/NaN/function/bigint/symbol이면 research canonicalization이 runner 이전에
  그 key path를 포함한 오류를 던진다. numeric value는 runner 이후 metadata validation 단계까지 진행한다.
- unused execution/exit/universe unknown getter, discarded unknown Risk data, excluded now data proxy는 실행0회 및
  반환/파일 marker 부재가 확인된 negative controls다.

## 준비 실패와 durable 중단

선택 또는 실제 metadata 소비 구조가 opaque이면 workflow 첫 단계와 입력 read await 뒤에 고정 오류로 거절한다.
초기/source 관측 전에 실패했으므로 존재하지 않는 reservation/binding을 생성하지 않는다.

준비 전에 확보한 bounded credential 판정이 redacted 또는 inspection_unavailable인데 plan/research 작성이 실패하면
대응하는 고정 오류로 치환한다. 안전한 입력의 기존 진단은 그대로 유지한다. 준비가 성공한 credential-bearing 입력은
기존 runner의 실제 reservation → initial → source → settings durable barrier에서 중단한다.

## 구현 참조

- `src/workflows/historicalReplayWorkflowPlan.ts`: metadata configuration와 serializeRiskPolicy
- `src/workflows/historicalReplayWorkflow.ts`: createWorkflowResearchManifest, normalizeUniverseManifestForResearch
- `src/replay/replayRunManifest.ts`: canonicalPlainObject, canonicalArrayValue
- `src/replay/replayRiskPolicy.ts`: 원본 policy spread
- `src/replay/codexHistoricalReplayRunner.ts`: allocation ramp와 반환 summary
- `src/paper/allocationPolicy.ts`, `marketRegimeAllocationPolicy.ts`, `dynamicCashReservePolicy.ts`
- `src/replay/historicalReplayAuditLog.ts`: strict policy schemas, four bucket-map z.record, fail(error)
- `src/replay/historicalReplayProgress.ts`: fail(error)
- `src/reports/historicalReplayReport.ts`: allocationPolicy 원본 summary 전달·formatting

이 경계는 paper-only 자료/설정 검사다. live 실행, 새 권한, 기존 initial/source 관측 버전 변경과 관계없다.
