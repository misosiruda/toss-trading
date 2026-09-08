# Project Structure

## 목적

이 문서는 `toss-trading` 코드베이스에서 기능 위치와 책임 경계를 빠르게 찾기 위한 구조 문서다.

기존 `architecture.md`, `trading-runtime.md`, `risk-policy.md`, `official-toss-open-api-adapter-design.md`, `official-token-auth-design.md`가 시스템 설계와 안전 정책을 설명한다면, 이 문서는 실제 파일과 디렉터리 기준으로 "어디를 수정해야 하는가"를 정리한다.

## 전체 구조

```text
toss-trading/
├── AGENTS.md                  # Codex 작업 경계와 안전 규칙
├── README.md                  # 프로젝트 개요와 실행 예시
├── package.json               # Node.js scripts와 의존성
├── tsconfig.json              # TypeScript strict compiler 설정
├── .github/                   # CODEOWNERS와 PR template
├── .codex/                    # Codex MCP 설정 예시
├── apps/                      # Next.js dashboard app 등 frontend package
├── dashboard/                 # read-only local dashboard ES module 정적 파일
├── data/                      # 로컬 실행 산출물. Git source of truth 아님
├── docs/                      # 아키텍처, 정책, 운영, 리팩토링 문서
├── scripts/                   # dependency-free quality gate와 유지보수 스크립트
├── schemas/                   # 외부로 노출되는 JSON Schema
└── src/                       # TypeScript backend source
```

## Source 디렉터리 책임

| 경로 | 책임 | 주의 |
| --- | --- | --- |
| `src/domain/` | Zod schema, TypeScript contract, 공통 validation | I/O, storage, provider 호출 금지 |
| `src/config/` | `.env` 로딩과 실행 설정 해석, official token auth config parsing | trading mode를 암묵적으로 활성화하지 않음 |
| `src/broker/` | official broker integration helper, token auth client boundary | live order gateway, direct MCP/API 노출 금지 |
| `src/collectors/` | optional read-only source 수집과 정규화 | 주문, 계좌 mutation, raw command runner 금지 |
| `src/market/` | market packet, historical packet, packet hash 생성 | Codex CLI나 broker API 호출 금지 |
| `src/ai/` | Codex CLI decision provider, prompt, failure summary | paper-only `VirtualDecision`만 생성 |
| `src/paper/` | virtual decision validation, risk, order, ledger, allocation policy | live `TradingSignal`/`OrderIntent`로 연결 금지 |
| `src/risk/` | live order intent용 deterministic RiskEngine과 opaque authority handoff | broker gateway, OrderRouter, MCP mutation surface 연결 금지 |
| `src/order/` | row 16의 internal mock-only dry-run state와 shadow idempotency contract | broker/network I/O, live mutation, API/MCP/dashboard 연결 금지 |
| `src/replay/` | simulated clock, replay runner, sampling, lookahead guard | 실시간 trading loop로 사용 금지 |
| `src/workflows/` | CLI/API가 호출하는 유스케이스 orchestration | 순수 정책을 중복 구현하지 않음 |
| `src/storage/` | JSON/JSONL file store, storage path mapping | trading 판단을 하지 않음 |
| `src/reports/` | paper/historical/batch report 생성 | 투자 조언이나 성과 보장 표현 금지 |
| `src/analytics/` | regime 분류와 portfolio analytics | 분석 metadata이며 주문 정책으로 자동 승격하지 않음 |
| `src/portfolio/` | mark-to-market, portfolio 계산 보조 | broker-grade accounting으로 주장하지 않음 |
| `src/scheduler/` | paper run one-shot scheduling gate | OS service나 live loop 설치 금지 |
| `src/security/` | masking 등 보안 보조 | 계좌번호, token, order ID 원문 노출 금지 |
| `src/api/` | read-only local operations HTTP API | replay 실행, Codex 실행, order 실행 endpoint 금지 |
| `src/mcp/` | Codex MCP server와 enabled tool surface | raw `tossctl`, raw `codex exec`, `place_order` 노출 금지 |
| `src/cli/` | command-line entrypoint와 argument parsing | 정책 자체는 workflow/domain module로 위임 |

## 의존성 방향

권장 의존성 방향은 아래와 같다.

```mermaid
flowchart TD
    CLI["src/cli"] --> Workflows["src/workflows"]
    API["src/api"] --> Storage["src/storage"]
    API --> Reports["src/reports"]
    MCP["src/mcp"] --> Storage
    Workflows --> Market["src/market"]
    Workflows --> Replay["src/replay"]
    Workflows --> Paper["src/paper"]
    Workflows --> Risk["src/risk"]
    Workflows --> Order["src/order"]
    Workflows --> AI["src/ai"]
    Workflows --> Reports
    Workflows --> Storage
    Market --> Domain["src/domain"]
    Replay --> Domain
    Paper --> Domain
    Risk --> Domain
    Order --> Domain
    Order -->|"opaque authority verification only"| Risk
    AI --> Domain
    Storage --> Domain
    Reports --> Domain
```

원칙:

- `src/domain`은 가장 안쪽 contract 계층이다. 외부 I/O 계층을 import하지 않는다.
- `src/paper`는 paper-only execution 계층이다. live order path를 만들지 않는다.
- `src/order`는 row 16 전용 internal dry-run 계층이다. `src/workflows`가 먼저
  `LiveRiskEngine`을 통과시킨 typed input만 받고 mock/shadow state에서 종료하며,
  broker transport나 enabled entrypoint를 소유하지 않는다.
- `src/api`와 `src/mcp`는 운영 조회 surface다. batch/replay/AI 실행을 직접 시작하지 않는다.
- `src/workflows`는 orchestration 계층이다. CLI와 low-level module 사이의 연결을 맡는다.

## 주요 Entry Point

| 명령 | 진입 파일 | 주요 역할 |
| --- | --- | --- |
| `npm run start` | `src/index.ts` | read-only MCP server 시작 |
| `npm run ops:api` / `npm run dashboard` | `src/cli/localOperationsApi.ts` | read-only local operations API와 dashboard 제공 |
| `npm run paper:run-once` | `src/cli/paperRunOnce.ts` | mock/static provider 기반 paper run |
| `npm run paper:run-from-market-packet` | `src/cli/paperRunFromMarketPacket.ts` | 저장된 market packet 기반 paper run |
| `npm run paper:scheduler:run` | `src/cli/paperSchedulerRun.ts` | paper run scheduler gate |
| `npm run paper:report` | `src/cli/paperDailyReport.ts` | daily paper report 생성 |
| `npm run tossinvest:collect` | `src/cli/tossInvestCollect.ts` | read-only TossInvest source 수집 |
| `npm run market:ingest` | `src/cli/marketIngest.ts` | 수집 데이터를 market packet으로 정규화 |
| `npm run historical:replay` | `src/cli/historicalReplay.ts` | single historical replay |
| `npm run historical:batch:replay` | `src/cli/historicalBatchReplay.ts` | batch historical replay |
| `npm run historical:batch:report` | `src/cli/historicalBatchReport.ts` | batch aggregate report 생성 |
| `npm run historical:yahoo:ingest` | `src/cli/historicalYahooDailyIngest.ts` | Yahoo daily historical input 생성 |
| `npm run historical:universe:coverage` | `src/cli/historicalUniverseCoverage.ts` | universe coverage 점검 |

## 변경 위치 찾기

### Virtual decision contract 변경

수정 후보:

- `src/domain/schemas.ts`
- `schemas/virtual-decision.schema.json`
- `src/paper/virtualDecisionValidation.ts`
- `src/paper/decisionNormalizer.ts`
- `src/ai/decisionPrompt.ts`
- `docs/codex-cli-paper-trading.md`

필수 확인:

- schema field가 camelCase인지 확인
- Zod schema와 JSON Schema가 같은 계약을 표현하는지 확인
- invalid decision이 paper order로 기록되지 않는지 테스트

### Paper risk 또는 order behavior 변경

수정 후보:

- `src/paper/riskEngine.ts`
- `src/paper/riskBranches.ts`
- `src/paper/riskPolicy.ts`
- `src/paper/riskProfile.ts`
- `src/paper/orderEngine.ts`
- `src/paper/executionModel.ts`
- `docs/risk-policy.md`
- `docs/historical-replay.md`

필수 확인:

- `VirtualRiskEngine` 실패는 fail-closed인지 확인
- 새 reject code는 report, audit, docs에서 해석 가능한지 확인
- risk 관련 분기는 테스트를 추가하거나 기존 `*.test.ts`를 보강

### 전략 포트폴리오 Risk 결정 정책 해소

전략 포트폴리오의 저장된 Risk 결정과 활성 정책·규칙 참조를 대조하는 코드는
`src/portfolio/portfolioActionRiskDecisionPolicyResolver.ts`에 있다. 설정된 단일 저장 경로에서
Risk history와 정책·activation·의존성 generation을 직접 읽은 뒤 결정시각의 activation fold와
bucket/legacy rule-set 선택, side별 required rule ID 해소를 담당하며, 개별 규칙 수치 재평가나
최종 실행 승인은 제공하지 않는다. 관련 회귀 테스트는 같은 이름의 `*.test.ts`와 운용 모델
계획 문서를 함께 확인한다.
정책 확인 후 Risk 생성 순서는 `portfolioActionRiskDecisionFiles.ts`의
`createAndAppendWithPolicyOrigin`과 v3 entry receipt가 보장한다. 저장된 activation의 내구성
확인과 generation 조합은 `runtimePortfolioPolicyActivationFiles.ts`에 있으며, 기존 기록을
새 origin으로 자동 승격하지 않는다.

### 전략 포트폴리오 rebalance plan 계약

`src/portfolio/rebalancePlan.ts`는 immutable plan의 ordered action, 단일 side, 실행 target,
mandate/legacy lineage와 full-payload hash를 검증한다. `rebalancePlan.test.ts`는 순서·cap·
표시 notional 재계산 및 변조 거절을 다룬다. 저장소·event fold·원본 snapshot/mandate/price 해소와
최종 실행 연결은 별도 후속이며 contract 생성만으로 주문이나 portfolio를 변경하지 않는다.
`rebalancePlanFiles.ts`는 cycle당 unique plan artifact와 post-fsync origin을 저장·해소한다.
`rebalancePlanFiles.test.ts`에서 concurrent retry, corrupt/torn history, durability와 clock rollback을
검증한다. 이 저장소만으로 cycle claim이나 최초 preview event가 원자적으로 완료되지는 않는다.
`rebalancePlanEvent.ts`는 여섯 상태의 event union, full-payload identity와 plan record scope
binding을 제공한다. `execution_applied`는 기존 전용 contract를 재사용한다. 같은 이름의 테스트가
variant 필드·reason 정렬·ordered execution IDs·원본 preview scope와 변조 거절을 검증한다.
이 content binding에는 event chain fold, durable origin과 Risk replay가 포함되지 않는다.
`rebalancePlanEventReplay.ts`는 supplied event chain의 허용 전이·직전 predecessor·시간 순서,
action/fill 순서·누계·target/cap·최종 applied event를 재생 검증한다. 같은 이름의 테스트가
terminal 재진입, 누계/상태 drift, 부분 체결 및 수량/notional target 차이를 다룬다. 이 순수
replay 결과만으로 저장 이력의 최신성·fill/Risk 출처나 실행 권한을 증명하지 않는다.
`canonicalQuantity.ts`의 exact decimal 단위 계산은 plan replay와 Risk/fill binding에서 공용으로
사용한다. Binary drift를 epsilon으로 덮지 않으며 표현 불가능한 누계는 거절한다.
`rebalancePlanEventFiles.ts`는 plan 저장 원본에 결속한 이벤트 entry/commit 쌍을 append하고,
읽을 때 전체 hash chain과 plan별 replay를 독립 검증한다. 같은 이름의 테스트에서 재시작,
동시 retry/경쟁 predecessor, 손상·시간 역전·fsync 실패와 historical provenance를 검증한다.
과거 read의 generation hash는 최신성 보증이 아니며 cycle claim/preview와 체결 accounting을
함께 commit하는 coordinator는 후속이다.
`portfolioActionRiskDecisionPlanContext.ts`와 `portfolioActionRiskDecisionPlanResolver.ts`는
저장된 plan/event 이력의 다음 action·pre-state·누계·잔여 target과 Risk 결정 입력을 대조한다.
Risk 저장소의 `createAndAppendWithPlanOrigin`은 plan/event fsync 확인 후 결정시각을 채집하고
policy 및 plan/predecessor 원본을 v4 entry에 기록한다. `portfolioActionRiskDecisionPolicyResolver.test.ts`가
실제 정책·계획·부분 체결 파일을 조합해 재시작, retry, 변조·backfill·fsync 실패를 검증한다.
`investmentMandateFiles.ts`의 `withDurableVerifiedHistory`는 mandate record/event 두 파일을
shared lock 안에서 동일 handle로 읽고 검증·fsync한 뒤 관측시각과 전체 배열 hash를 제공한다.
두 파일의 동기화 후이면서 최종 bytes/handle/path identity 재검증 이전에 하나의 관측시각을 고정한다.
빈 파일도 fsync하며 없는 파일은 디렉터리 동기화 뒤 부재를 다시 확인한다. 관측 중 원본 교체·덮어쓰기·
생성 또는 부분 읽기 실패에서는 consumer를 호출하지 않고 확보한 handle을 닫는다. 관측값의 prefix 재검증은
새 durable lease 안에서만 가능하며 복사본·만료 lease와 손상/축소/교체 이력을 거절한다.
`portfolioActionRiskDecisionMandateContext.ts`와 `portfolioActionRiskDecisionMandateResolver.ts`는
실제 mandate 원본의 scope/bucket/상태/유효기간과 Risk 결정을 결속하고 저장된 관측 prefix를 재검증한다.
Risk 저장소의 `createAndAppendWithMandateOrigin`은 mandate → activation → Risk lock 순서로
원본 lease를 commit까지 유지하고 v5 receipt를 기록한다. 기존 v4 이하 원본은 자동 승격하지 않는다.
`portfolioActionRiskDecisionPolicyResolver.test.ts`에서 실제 저장소 연결, 권한·유효기간 실패,
과거 원본 재생, retry, source fsync 실패와 저장 중 잠금을 검증한다. 실제 Risk 계산·reservation 원본과
fill/accounting transaction은 후속이다.

`portfolioActionRiskDecisionSnapshotContext.ts`와 `portfolioActionRiskDecisionSnapshotResolver.ts`는
Risk/plan의 expected version/hash에 해당하는 실제 sizing snapshot을 재생하고 관측된 원본 prefix를
대조한다. `createAndAppendWithSnapshotOrigin`은 snapshot → mandate(assigned일 때) → activation →
Risk 순서로 source lease를 유지하며 v6 entry에 snapshot ID/hash, exposure hash와 관측 receipt를 저장한다.
미분류 보유분이 있으면 approved BUY를 거절하고 legacy reduce-only SELL에는 mandate를 합성하지 않는다.
이 경로는 과거 평가 입력의 원본 결속이며 전체 Risk 수치 규칙·가격/turnover 근거·실행 transaction은 후속이다.

`portfolioActionRiskDecisionCashCapacity.ts`는 Snapshot-bound BUY의 필요조건인 현금 상한을 실제
평가 원본과 활성 정책에서 재계산한다. 준비금은 absolute minimum과 반올림한 NAV × target ratio 중
큰 값이며 pending BUY gross exposure도 차감한다. Worst-case net debit과 approved net cap 모두
이 상한 이하여야 한다. 생성·retry·과거 resolver에 연결하며 rejected BUY 설명과 SELL은 차단하지 않는다.
Pending SELL의 예상 대금을 더하거나 caller ID로 pending BUY를 해제하지 않는다. Pending 비용과
reservation origin을 포함한 최종 spendable cash·실행 승인 검증을 대체하지 않는다.

`portfolioActionRiskDecisionSnapshotContext.ts`는 approved SELL 수량을 실제 snapshot의
동일 market/symbol/bucket lot에 대조한다. Legacy SELL은 bucket이 없는 lot만 사용하고 assigned SELL은
다른 bucket이나 legacy 수량을 합산하지 않는다. Canonical decimal quantity로 정확히 비교하고
부분 체결 후 resulting snapshot에서 prior fill을 다시 차감하지 않는다. Pending SELL 예약 해소 및
position-state/Mandate 소유권 원본을 증명하는 최종 execution gate는 별도 후속이다.

`sourcePriceEvidenceFiles.ts`의 `withDurableVerifiedHistory`는 같은 descriptor로 읽기·전체 검증·fsync를
수행한 뒤 bytes와 pathname 세대를 재확인하고 callback 동안 source lock과 관측 lease를 유지한다.
Receipt의 `entriesHash`는 record뿐 아니라 commit 시각과 tail hash를 포함한 complete parsed entry
prefix에 결속된다. 정상 append 뒤 원래 prefix를 해소할 수 있지만 축소·교체·commit provenance 변조는
거절한다. Legacy의 durable append origin 부재는 그대로 보존하며 lease로 과거 시각을 승격하지 않는다.
`portfolioActionRiskDecisionPriceContext.ts`와 `portfolioActionRiskDecisionPriceResolver.ts`는
실제 typed quote의 market/symbol, evidence ref/hash와 판단 이전의 관측·생성·durable commit을 검증한다.
Risk 저장소의 `createAndAppendWithPriceOrigin`은 price → snapshot → mandate(assigned만) → activation →
Risk 순서로 source lock을 유지하고 v7 entry에 가격 identity와 complete source prefix 관측을 기록한다.
재시도·과거 재생은 최초 prefix를 다시 검증하며 기존 v6 이하 Risk에 가격 origin을 사후 추가하지 않는다.
`portfolioActionRiskDecisionPolicyResolver.test.ts`에서 실제 저장·재생, legacy, 변조, retry, fsync 실패 및
Risk commit 동안 경쟁 price writer 차단을 검사한다. 가격 freshness·완전한 비용 bound·최종 실행 승인은 후속이다.

`paperFillExecutionFiles.ts`의 Risk-bound factory와 `rebalancePlanExecutionFillRiskBinding.ts`는 v7 Risk의
선택 가격 `evidenceRef/evidenceHash`를 체결의 source price에 대조한다. 다른 quote가 Risk evidence list에
같이 들어 있어도 대체할 수 없다. 생성·retry 이전과 실제 저장 source를 해소한 event binding 양쪽에서
검사하며 기존 v6 이하의 null price origin을 새 권한으로 승격하지 않는다. 별도 실행 권한이나 source prefix
재생을 대신하지 않으며 전체 Risk 원본 resolver와 최종 transaction gate는 여전히 필요하다.

`portfolioActionExecutionPreview.ts`는 Risk 이전에 fill ID와 저장 없이 실행 수량·gross/net·비용을 계산한다.
기존 `paperFillExecutionPolicySchema`와 `buildPaperFill`을 재사용하며 complete policy, typed 가격,
post-fillRatio requested notional, nullable quantity override 및 명시적 liquidity input을 strict하게 받는다.
성공·부분 체결·거절 결과를 input/output hash와 함께 보존하고 parser는 전체 모델을 재실행한다.
`portfolioActionExecutionPreview.test.ts`에서 BUY/SELL의 전체 비용, fill record parity, 부분/거절,
missing/stale liquidity와 integer/identity/hash 경계를 검사한다. 이는 순수 계산 결과이며 source availability,
정책 선택, Risk 승인·worst-case bound, persistence와 최종 execution coordinator 연결은 후속이다.

`portfolioPolicyExecutionPreview.ts`는 단일 storage root의 활성 bucket/legacy rule set에서
`paper_execution v1`의 market별 complete policy, 가격 source allowlist와 최대 나이를 해소한다.
Price durable lease와 activation lock 아래 실제 가격을 선택하고 backend 시각으로 비용 preview를 만든다.
반환 context는 exact policy/parameter/price 관측을 설명하며 persistence나 실행 승인이 아니다.
`portfolioActionRiskDecisionPolicyResolver.test.ts`의 실제 저장소 fixture로 정책·가격·재시작·오류 경계를
검증한다. Liquidity 원본, plan/mandate 인증과 Risk·최종 execution transaction은 아직 연결하지 않는다.

`portfolioPacketExecutionPreview.ts`는 실제 `market-packets.jsonl`의 canonical packet hash와
portfolio/market/symbol을 해소해 candidate volume/averageVolume을 정책 기반 preview에 공급한다.
Caller의 유동성 override, 누락/손상/중복 원본과 만료된 packet/candidate를 거절하고 I/O 후 cutoff도
재검증한다. 반환 context의 로컬 packet projection은 durable availability 또는 execution authority가
아니며, 정책별 liquidity source/기간 및 최종 Risk 연결은 후속이다. 실제 저장소 조합 테스트는
`portfolioActionRiskDecisionPolicyResolver.test.ts`에 있다.

`src/paper/versionedExecutionModel.ts`는 저장된 실행 modelVersion으로 기존 v4와 opt-in v5를 분기한다.
V5의 `buildWholeSharePaperFill`은 수량 override에도 whole-share 내림을 적용하고 유동성 모델의 실제
내림 후 최소 체결 비율을 재검사한다. 기존 runner/cost-model 기본값과 v4 재생은 변경하지 않는다.
Portfolio preview와 fill parser가 해당 dispatch를 공유하며 v5 reader-first 배포가 필요하다.
`versionedExecutionModel.test.ts`, `portfolioActionExecutionPreview.test.ts`, `paperFillExecution.test.ts`가
버전 호환성·비용·최소 수량 경계를 검증한다.

`portfolioPlanExecutionPreview.ts`는 저장 plan의 다음 미완료 action에서 요청 수량·금액을 도출하고
실제 mandate의 bucket 또는 legacy root scope로 packet 실행 미리보기를 호출한다. Canonical 수량 차감,
남은 gross cap, share mode와 전후 plan/mandate 변경을 검증한다. 반환값은 읽기 관측이며 Risk 승인,
최신 portfolio CAS, 다중 파일 lease나 실행 권한이 아니다. 실제 저장소 조합 테스트는
`portfolioActionRiskDecisionPolicyResolver.test.ts`, 수량 차감 경계는 `canonicalQuantity.test.ts`에 있다.

`portfolioActionRiskDecisionExecutionContext.ts`는 계획에서 도출한 가격·수량·유동성·실행 정책과
비용 미리보기를 Risk entry v8의 `executionOrigin`으로 고정하고 독립 재생한다.
`createAndAppendWithExecutionOrigin`은 실제 policy/plan/mandate/snapshot/price와 packet prefix를
해소하며 모델 gross/net의 Risk 경계와 전체 selected rule ID를 검증한다.
`portfolioActionRiskDecisionExecutionResolver.ts`는 과거 원본 정책·가격·남은 목표·packet prefix를
다시 확인한다. Fill writer와 execution event binding은 같은 가격 숫자와 모델 입력·출력 및 freshness를
강제한다. 다른 Risk 규칙의 수치 평가, 현재 capacity 및 원자 실행은 별도이며 packet의 일반 read를
durable market-source provenance로 승격하지 않는다. 기존 entry는 `executionOrigin = null`이고
retry로 v8 승격하지 않는다. V8 reader-first 배포와 rollback 시 호환 reader 유지가 필요하다.

`bucketTurnover.ts`는 정책과 독립적인 고정 UTC window ID, positive integer KRW 분모,
append-only turnover event/state 계약과 전체 window 재생을 제공한다. `resolveBucketTurnoverState`는
저장 snapshot의 누계·ratio·마지막 event/policy/hash를 전체 event fold와 비교한다. 분모의 snapshot 원본,
실제 fill/policy 출처와 file persistence, Risk cap 및 원자 실행은 이 순수 모듈의 증명 범위가 아니다.
`bucketTurnover.test.ts`는 UTC 경계, 정책 변경 누계, 재시작 및 독립 재해시 실패 경계를 검사한다.

`bucketTurnoverSnapshotOrigin.ts`는 sizing snapshot 저장소의 live durable lease에서 구간 시작 직전의
최신 snapshot을 유일하게 선택해 회전율 분모와 origin receipt를 결속한다. 기존 origin은 원래 prefix로
재생하므로 후속 append로 분모를 재설정하지 않는다. 정책 activation, 최초 window root 저장·유일성과
Risk 권한은 후속 경계이며 `bucketTurnoverSnapshotOrigin.test.ts`가 실제 임시 파일 저장소로 검증한다.

`bucketTurnoverWindowFiles.ts`는 `bucket-turnover-windows.jsonl`에 최초 window origin을 entry/commit
쌍으로 저장한다. Snapshot → activation → window 잠금 순서에서 현재 활성 정책의 duration과 실제
분모를 결속하고, 같은 window의 retry는 정책 변경·후속 snapshot에도 최초 origin으로 수렴한다.
Reader는 전체 snapshot/policy 원본, 관측 prefix, 선형 commit chain과 window 유일성을 검증한다.
신규 append 전 `.bucket-turnover-window-pending.json`을 durable하게 기록하고 marker fsync 완료가
구간 안에 있음을 확인한 뒤에만 제거한다. Pending이 남으면 완성된 pair도 재시작 시 거절한다.
Turnover event 저장 및 Risk/fill/accounting 원자 반영은 아직 연결하지 않는다.

`bucketTurnoverFillOrigin.ts`는 저장된 paper fill ID에서 Risk의 정책·계획·mandate·snapshot·가격·
유동성/실행 모델 원본을 재생하고 실제 filled gross notional과 bucket을 최초 window에 결속한다.
Risk receipt, action scope, 고정 분모, window 생성 → Risk → fill commit 순서를 검사하고 legacy
reduce-only fill은 bucket 회전율에서 제외하기 위해 거절한다. 역사적 source resolver이며 누계·
현재 Risk cap·event 저장·회계 transaction은 별도다. 기존 Risk 통합 fixture에서 검증한다.
`PaperFillExecutionFileRepository.createAndAppendWithRiskCompletion`은 opt-in v3 entry/commit/
completion 세 줄을 기록한다. Completion 시각은 entry와 marker의 fsync 및 directory sync 이후
채집하고 completion hash를 다음 entry predecessor로 사용한다. 회전율 원본은 이 시각이 window
끝 이전이어야 한다. 기존 v1/v2 reader 경로는 보존하되 completion 증거로 승격하지 않는다.
v3 기록 후 rollback에는 v3 호환 reader가 필요하며 completion line을 삭제해 변환하지 않는다.

`bucketTurnoverEventFiles.ts`는 검증된 fill origin으로 `bucket-turnover-events.jsonl` entry/commit
쌍을 생성한다. Caller의 expected state hash와 full prior replay 및 Risk assessment의 state hash/
prior notional이 일치해야 한다. Portfolio fill ID는 전체 window에서 유일하며 retry는 원래 prior
hash와 source로만 수렴한다. Reader는 매 entry의 실제 source·hash·global commit chain·window별
event replay를 검증한다. `.bucket-turnover-event-pending.json`이 남으면 read/retry를 차단한다.
실제 fill completion 원본을 먼저 해소하므로 같은 밀리초의 event 생성은 허용하고 이전 시각은 거절한다.
`readWindowState`는 실제 최초 root와 전체 event에서 state를 계산하며 projection 파일은 아직
쓰지 않는다. 현재 Risk cap 또는 fill/accounting 원자 transaction을 대신하지 않는다.

`bucketTurnoverStateFiles.ts`는 명시적 `refresh({ expectedProjectionHash })`에서 전체 실제 window와
event 재생 결과를 `bucket-turnover-state.json`에 atomic rename으로 저장한다. Source별 prefix count와
generation hash, 정렬된 전체 state 및 projection hash를 결속한다. 일반 조회는 원본이 전진한 stale
projection을 거절하며 refresh만 정상 historical prefix를 CAS로 전진시킨다. Corrupt projection이나
누락·손상·pending 원본은 자동 복구하지 않는다. `withDurableSnapshot`은 event → snapshot → window
lock을 callback 동안 유지하고 파일 sync 후 관측 시각을 발급한다. 관측 권한은 clone·callback 종료·예외
이후 사용할 수 없다. 현재 정책·Risk·reservation lock이나 fill/accounting transaction은 포함하지 않는다.

`portfolioExposureSnapshot.ts`의 optional `unassignedExposureKrw`는 bucket 미분류 보유분의 양수 노출을
별도로 보존한다. `portfolioSizingSnapshotResolver.ts`는 이를 실제 미분류 lot의 mark/quantity로 재생하고
root dimension/NAV에는 포함하되 bucket·mandate를 합성하지 않는다. 기존 fully assigned snapshot의
hash/ID는 유지하며 신규 필드를 기록한 뒤 rollback할 때는 호환 reader가 필요하다.
`bucketSelectionRequestResolver.ts`는 이 미분류 노출이 있으면 신규 selection replay를 거절한다.
`portfolioSizingSnapshotFiles.ts`의 `withDurableVerifiedHistory`는 전체 snapshot의 valuation replay와
fsync 이후 원본 count/hash/time을 제공하고 consumer 종료까지 저장소 lock을 유지한다.
읽기·검증·fsync는 같은 file handle에 결속하고 bytes 및 handle/path metadata 재검증으로 관측 도중
경로 교체·덮어쓰기를 거절한다.
파일이 없으면 디렉터리 sync 뒤 경로 부재를 재확인하고 관측 도중 생성된 파일을 거절한다.
관측시각은 sync 이후 최종 원본 재확인 이전에 고정하며 descriptor close 이후에 늦춰 채집하지 않는다.
`resolveObservedPortfolioSizingSnapshotHistory`는 새 durable lease 안에서 과거 prefix를 재검증한다.
복사/만료 lease, fsync 실패, source 축소·교체 및 손상은 같은 이름의 저장소 테스트에서 검증한다.
이는 최신 portfolio 상태나 외부 가격·pending action 진위가 아니다. Risk pre-state receipt는 위 v6/v7 경로에
연결되어 있으며 현재 실행의 capacity reservation과 원자적 fill/accounting 검증은 후속이다.

### Live RiskEngine 변경

수정 후보:

- `src/risk/liveRiskEngine.ts`
- `src/risk/liveRiskPolicy.ts`
- `src/risk/liveRiskEngine.test.ts`
- `docs/risk-policy.md`
- `docs/trading-runtime.md`
- `docs/official-toss-open-api-adapter-design.md`

필수 확인:

- 기본 policy는 fail-closed인지 확인
- root payload, order intent, preview, risk snapshot, risk policy의 숫자/enum/boolean/collection/timestamp/audit identity 값이 malformed 입력에서 fail-closed 되는지 확인
- risk snapshot freshness와 duplicate position row 기반 aggregate exposure/sellable quantity가 테스트되는지 확인
- kill switch, max order amount, max daily loss, exposure, allowlist, market hours, duplicate, cooldown, open order count, market order policy, stale signal, preview requirement가 테스트되는지 확인
- `RiskDecision`은 `orderIntentId`, `signalId`, `rejectCodes`, `checkedRules`, `riskSnapshotRef`, `createdAt`을 남기는지 확인
- `src/risk`에 broker gateway 또는 `OrderRouter`를 추가하거나 import하지 않음
- row 16 dry-run은 별도 `src/order` 경계에만 두고 Local Operations API/MCP/dashboard
  mutation surface와 연결하지 않음
- Codex CLI `virtual_decision`을 live order intent로 승격하지 않음

### Live OrderRouter dry-run 경계 변경

수정 후보:

- `src/risk/liveRiskAuthority.ts` (구현됨: frozen intent와 opaque authority)
- `src/risk/liveRiskAuthority.test.ts` (구현됨: 위조·변조·재구성 차단 회귀 테스트)
- `src/order/dryRunShadowState.ts` (구현됨: isolated reservation, permanent tombstone와 audit)
- `src/order/dryRunShadowState.test.ts` (구현됨: duplicate/timeout/reconciliation 상태 전이 테스트)
- `src/order/dryRunOrderRouter.ts` (구현됨: exact safe config, opaque synthetic approval와 shadow reservation 연결)
- `src/order/dryRunOrderRouter.test.ts` (구현됨: gate/authority/approval/duplicate/masking 회귀 테스트)
- `docs/live-trading-threat-model.md`
- `docs/official-toss-open-api-adapter-design.md`
- `docs/PROJECT_STRUCTURE.md`
- `docs/CODE_CONVENTION.md`

필수 확인:

- 첫 구현은 `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, mutation disabled를 exact
  typed input으로 검증하고 하나라도 다르면 fail-closed함
- caller가 만든 자연어, Codex paper evidence 또는 raw broker payload를 intent로 변환하지
  않음
- 구현된 risk authority 경계는 risk 평가 전에 strict-validated `LiveOrderIntent`를
  deep-copy/deep-freeze하고 그 exact snapshot을 `LiveRiskEngine`에 전달함. 후속 workflow와
  router도 평가 결과가 소유한 동일 snapshot만 handoff해야 함
- Risk module은 descriptive plain object를 handoff authority로 받지 않고, module-private
  mint path와 runtime-owned `WeakSet` brand를 통과한 deep-frozen opaque
  `LiveRiskAuthority`만 생성해야 함. Public constructor/factory 또는 caller-supplied approval
  flag를 허용하지 않으며 rejected authority는 approved authority로 바뀔 수 없음
- Opaque authority 내부의 readonly decision에는 domain-separated canonical
  `evaluatedIntentHash`를 추가해야 함.
  Hash input은 schema version, optional-field presence와 exact raw string/number/boolean 값을
  보존한 frozen snapshot 전체를 length-prefix해 포함하며, raw `symbol`과 RiskEngine이 실제
  사용하는 normalized symbol projection을 서로 다른 field로 모두 bind함
- `src/order`는 risk module의 narrow `verifyLiveRiskAuthority()`만 runtime import해 module-owned
  brand, frozen state, approved result와 recomputed intent hash를 함께 검증함. 하나라도 다르면
  fail-closed하며 plain `LiveRiskDecision`, caller-constructed object 또는 새로 재구성·정규화한
  intent는 router handoff authority가 아님
- `LiveRiskEngine` reject 뒤에는 router가 호출되지 않으며 router 자체가 risk engine,
  sizing 또는 allocation 책임을 복제하지 않음
- 구현된 shadow state는 synthetic scenario/hash tuple만 받고 isolated permanent tombstone을 최초
  reservation과 함께 생성하며 simulated terminal 뒤에도 같은 identity 재예약을 거부함. Scenario
  input은 opaque ref로 저장하고 immutable state handle은 single-use로 소비해 stale branch reservation을
  차단함
- 구현된 router는 네 safe config field를 exact data value로 검증하고, 승인된 exact risk authority,
  동일 frozen intent와 opaque scenario binding에 묶인 module-owned synthetic owner approval fixture를
  한 번만 소비함. Counterfeit, stale, mismatched approval은 shadow reservation 전에 fail-closed함
- 결과는 `dry_run_validated` 또는 `shadow_reconciled_no_external_effect` 같은 paper-only
  상태로 끝나며 broker order/execution identity를 만들지 않음
- `src/order`는 `src/broker`, `src/api`, `src/mcp`, `src/cli`, `src/ai`, `src/paper`,
  `src/storage`를 import하지 않고 network, filesystem, process 또는 environment I/O를 하지 않음
- Local Operations API, MCP, dashboard, CLI와 package entrypoint에 mutation route/tool/command를
  추가하지 않음
- 이 internal dry-run 구현은 official order POST, broker gateway, runtime owner approval channel 또는
  live enablement를 승인하지 않음

### Market packet 또는 candidate 생성 변경

수정 후보:

- `src/market/packetBuilder.ts`
- `src/market/historicalPacketBuilder.ts`
- `src/market/packetHash.ts`
- `src/replay/historicalDataAvailability.ts`
- `src/domain/schemas.ts`
- `docs/historical-replay.md`

필수 확인:

- lookahead data가 packet에 포함되지 않는지 확인
- `sourceRefs`, `collectedAt`, `staleAfter`가 유지되는지 확인
- packet hash와 decision binding이 깨지지 않는지 확인

### Historical replay 변경

수정 후보:

- `src/replay/`
- `src/workflows/historicalReplayWorkflow.ts`
- `src/workflows/historicalReplayWorkflowPlan.ts`
- `src/workflows/historicalReplayWorkflowArtifacts.ts`
- `src/workflows/historicalBatchReplayWorkflow.ts`
- `src/reports/historicalReplayReport.ts`
- `src/reports/batchReplayReport.ts`
- `docs/historical-replay.md`

필수 확인:

- simulated time 이후 데이터가 사용되지 않는지 확인
- batch run artifact path가 dashboard/API와 일치하는지 확인
- replay 결과가 투자 조언이나 성과 보장으로 표현되지 않는지 확인

### Read-only dashboard/API 변경

현재 구현은 `dashboard/`의 정적 HTML/CSS/ES module과 `src/api`의 Local Operations API가 담당한다. `apps/dashboard`는 Next.js 전환을 위한 별도 app skeleton이며, 전략 버킷, dynamic cash reserve, hedge, validation lab을 policy 중심으로 포용하는 future Next.js 전환 계획은 [nextjs-dashboard-architecture-plan.md](nextjs-dashboard-architecture-plan.md)를 기준으로 한다.

수정 후보:

- `src/api/localOperationsSurface.ts`
- `src/api/localOperationsServer.ts`
- `src/api/localOperationsRouting.ts`
- `src/api/dashboardViewModels.ts`
- `src/api/localOperationsReaders.ts`
- `src/api/localOperationsDashboardAssets.ts`
- `src/api/localOperationsResponse.ts`
- `src/api/localOperationsTypes.ts`
- `dashboard/index.html`
- `dashboard/app.js`
- `dashboard/apiClient.js`
- `dashboard/batchRunRenderers.js`
- `dashboard/dashboardStatusRenderers.js`
- `dashboard/decisionRenderers.js`
- `dashboard/dom.js`
- `dashboard/formatters.js`
- `dashboard/metadata.js`
- `dashboard/portfolioModel.js`
- `dashboard/portfolioRenderers.js`
- `dashboard/reportRenderers.js`
- `dashboard/replayProgressCoordinator.js`
- `dashboard/replayProgressRenderers.js`
- `dashboard/reportViewHelpers.js`
- `dashboard/router.js`
- `dashboard/sourceRenderers.js`
- `dashboard/state.js`
- `dashboard/tableRenderers.js`
- `dashboard/styles.css`
- `docs/historical-replay.md`

필수 확인:

- HTTP method는 `GET`/`HEAD`만 허용
- endpoint가 replay 실행, Codex 실행, 주문 실행을 시작하지 않음
- 응답은 `maskObject`를 통과

### MCP tool 변경

수정 후보:

- `src/mcp/server.ts`
- `src/mcp/virtualPortfolioTools.ts`
- `src/mcp/toolSurfacePolicy.ts`
- `docs/mcp-tools.md`
- `docs/llm-boundary.md`

필수 확인:

- enabled tool은 read-only인지 확인
- raw `tossctl`, raw `codex exec`, live order tool을 추가하지 않음
- tool contract와 docs 예시가 일치
- disabled-by-default tool 이름이 `toolSurfacePolicy.ts`와 docs에서 일치

### Official Toss Open API token auth config 변경

수정 후보:

- `src/config/tossOpenApiAuthConfig.ts`
- `src/config/tossOpenApiAuthConfig.test.ts`
- `.env.example`
- `scripts/qualityGate.mjs`
- `docs/official-token-auth-design.md`

필수 확인:

- `readTossOpenApiAuthConfig({})`가 `enabled=false`, `status=disabled`를 유지하는지 확인
- `TOSS_OPEN_API_AUTH_ENABLED=true`에서 `client_id` 또는 `client_secret` 누락 시 `invalid`로 fail-closed 되는지 확인
- safe summary가 credential value를 반환하지 않는지 확인
- token 발급 HTTP call, token cache, broker adapter, account/order adapter를 추가하지 않음

### Official Toss Open API token auth client 변경

수정 후보:

- `src/broker/tossOpenApiAuthClient.ts`
- `src/broker/tossOpenApiAuthClient.test.ts`
- `docs/official-token-auth-design.md`

필수 확인:

- token issue request가 `application/x-www-form-urlencoded`와 `grant_type=client_credentials`를 사용
- `TossOpenApiAuthClient`가 disabled/invalid config에서 issuer를 호출하지 않고 fail-closed 처리
- token response의 `token_type`이 `Bearer`가 아니면 cache하지 않음
- `expires_in`과 safety margin 기준으로 memory cache를 재사용 또는 재발급
- concurrent token request가 single-flight로 합쳐짐
- 실제 HTTP transport, persistent token store, account/order adapter, live order gateway를 추가하지 않음

### Official Toss Open API token issuer network transport 변경

수정 후보:

- `src/broker/tossOpenApiTokenIssuerNetworkTransport.ts`
- `src/broker/tossOpenApiTokenIssuerNetworkTransport.test.ts`
- `docs/official-token-auth-design.md`
- `docs/official-toss-open-api-adapter-design.md`

필수 확인:

- production factory가 canonical `https://openapi.tossinvest.com/oauth2/token` 외 URL, dial target, custom CA 또는 test connector override를 받지 않음
- disabled/invalid config와 noncanonical request는 DNS/socket 전송 전에 fail-closed
- token POST가 exact form body, `Accept-Encoding: identity`, no `Range`/`If-Range`와 no caller credential header를 유지
- response가 exact `200`, no `Content-Range`/`Content-Encoding`, single JSON content type, 256KiB cap, complete UTF-8 JSON과 10초 이하 absolute deadline을 통과한 뒤에만 AuthClient parser로 전달됨
- test-only connector가 loopback IP와 synthetic CA에 한정되고 logical URL, Host, SNI와 hostname verification을 production identity로 유지
- external credential call, Calendar GET, persistent token/raw response, account/order request와 automatic retry를 추가하지 않음

### Official Toss Open API Calendar GET network transport 변경

수정 후보:

- `src/broker/tossOpenApiCalendarNetworkTransport.ts`
- `src/broker/tossOpenApiCalendarNetworkTransport.test.ts`
- `src/replay/officialMarketCalendarNetworkResponseFreshness.ts`
- `docs/official-token-auth-design.md`
- `docs/official-toss-open-api-adapter-design.md`
- `docs/replay-calendar-fx-contract.md`

필수 확인:

- production factory가 canonical `https://openapi.tossinvest.com/api/v1/market-calendar/{KR|US}?date=YYYY-MM-DD` 외 URL, query, dial target, custom CA, clock 또는 deadline override를 받지 않음
- disabled/invalid config, malformed market/date와 invalid token lease는 DNS/socket 전송 전에 fail-closed
- initial/retry GET이 Bearer 외 credential/account header를 보내지 않고 exact no-cache, `Accept-Encoding: identity`, no Range/conditional header를 유지
- refreshable `401`만 사용한 generation을 compare-and-clear한 뒤 한 번 재시도하고 retry `401`은 retry generation만 정리하며 세 번째 attempt를 만들지 않음
- final response가 exact `200`, complete JSON identity bytes, response trailer 없음, 1MiB cap과 10초 이하 final-attempt monotonic deadline을 통과함
- raw `Date`/`Age`/`Expires`와 Cache-Control을 기존 network corrected-age verifier로 검증하고 response delay, hash, byte length와 exact bytes를 process-local observation에 결합함
- test-only connector가 loopback IP, synthetic CA와 deterministic clock에 한정되고 logical URL, Host, SNI와 hostname verification을 production identity로 유지
- external credential call, durable raw-byte persistence, replay consumer migration, acquisition coordinator, account/order request와 broker mutation을 추가하지 않음

### Official Toss Open API Calendar ephemeral lifecycle 변경

수정 후보:

- `src/replay/officialBrokerObservedCalendarEphemeralObservation.ts`
- `src/replay/officialBrokerObservedCalendarEphemeralObservation.test.ts`
- `src/replay/officialBrokerObservedCalendarEvidenceV2.ts`
- `src/replay/officialBrokerObservedCalendarReplayAdapter.ts`
- `src/replay/officialBrokerObservedCalendarCoverageProbe.ts`
- `docs/official-token-auth-design.md`
- `docs/official-toss-open-api-adapter-design.md`
- `docs/replay-calendar-fx-contract.md`

필수 확인:

- actual network-derived v2 evidence와 exact bytes의 ownership을 verified process-local opaque handle에 함께 이전함
- factory가 bytes를 내부 copy로 격리하고 transferred caller view를 즉시 zeroize하며 handle에서 evidence/raw bytes를 노출하지 않음
- factory가 v2 schema, response hash/byte length, normalized response와 acquisition freshness를 검증하고 invalid input도 bytes를 zeroize함
- handle을 한 번만 소비하고 module-owned replay/coverage operation이 current `asOf`와 internal exact bytes로 evidence를 다시 검증함
- fixed operation이 replay input/report를 내부에서만 만들고 caller callback이나 return value로 derived object를 제공하지 않음
- success, verifier/consumer failure, stale, explicit disposal과 JSON export 시도 뒤 internal bytes를 zeroize함
- handle 재사용과 직렬화를 거부하고 public consumer registration 또는 derived output export surface를 만들지 않음
- durable raw-byte store, workflow artifact writer, CLI/MCP/API export, replay 실행과 acquisition coordinator를 추가하지 않음

### Official Toss Open API Calendar acquisition coordinator 변경

수정 후보:

- `src/broker/tossOpenApiCalendarAcquisitionCoordinator.ts`
- `src/broker/tossOpenApiCalendarAcquisitionCoordinator.test.ts`
- `src/broker/tossOpenApiTokenIssuerNetworkTransport.ts`
- `src/broker/tossOpenApiAuthClient.ts`
- `src/broker/tossOpenApiCalendarNetworkTransport.ts`
- `src/replay/officialBrokerObservedCalendarOpenApiCompatibility.ts`
- `src/replay/officialBrokerObservedCalendarEvidenceV2.ts`
- `src/replay/officialBrokerObservedCalendarEphemeralObservation.ts`
- `docs/official-token-auth-design.md`
- `docs/official-toss-open-api-adapter-design.md`
- `docs/replay-calendar-fx-contract.md`

필수 확인:

- production factory가 token issuer, generation-aware auth client와 calendar transport를 내부에서 고정 조립하고 connector/client/clock override를 받지 않음
- test-only factory도 arbitrary calendar client를 받지 않고 loopback connector와 injected token issuer만 사용함
- public input은 exact `market`/`date`만 받고 retrieval/evaluation timestamp, cache metadata, URL, contract version, evidence 또는 raw bytes를 받지 않음
- disabled/invalid config와 malformed input이 token issue, DNS 또는 socket 전에 fail-closed 처리됨
- network observation의 request URL, market/date, parsed body, response hash/byte length, completedAt/delay와 corrected freshness를 evidence 생성 전에 다시 검증함
- pinned example로 trusted parser registry contract를 선택하고 actual network bytes를 v2 strict parser와 ephemeral observation factory에 통과시킨 opaque handle만 반환함
- success, compatibility/schema/freshness/lifecycle failure 모두 transport raw-byte view를 zeroize함
- persistent token/raw-byte store, stored report, replay 실행, completeness claim, CLI/MCP/API output, account/order path와 broker mutation을 추가하지 않음

### Official Toss Open API credential readiness preflight 변경

수정 후보:

- `src/broker/tossOpenApiCredentialReadinessPreflight.ts`
- `src/broker/tossOpenApiCredentialReadinessPreflight.test.ts`
- `src/cli/tossOpenApiCredentialReadinessPreflight.ts`
- `src/config/tossOpenApiAuthConfig.ts`
- `.env.example`
- `docs/official-token-auth-design.md`
- `docs/official-toss-open-api-adapter-design.md`

필수 확인:

- raw env 기준 exact canonical host/base URL, safe auth summary, DNS family/count와 fixed token/calendar endpoint identity만 출력하고 미설정 외 noncanonical URL은 path까지 fixed placeholder로 치환함
- client id/secret, resolved IP address, token, provider response와 raw bytes를 출력하거나 저장하지 않음
- exact `BROKER_PROVIDER=mock`, `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only` 경계를 벗어나면 fail-closed blocker를 기록하고 명시된 값의 오타, 빈 값 또는 공백 변형도 허용하지 않음
- outbound IP registration은 raw env의 exact `TOSS_OPEN_API_OUTBOUND_IP_REGISTERED=true|false`만 허용하고 owner attestation과 실제 egress 검증을 구분함
- DNS lookup 외 HTTP request, token issue, calendar acquisition, account/order request 또는 provider response 검증을 수행하지 않음
- `ready_for_external_verification`을 successful acquisition/evidence/completeness로 해석하지 않음
- production DNS resolver는 exact `openapi.tossinvest.com`만 조회하고 resolver override는 test-only factory에만 노출함

### Official Toss Open API read-only HTTP client 변경

수정 후보:

- `src/broker/tossOpenApiReadOnlyHttpClient.ts`
- `src/broker/tossOpenApiReadOnlyHttpClient.test.ts`
- `docs/official-token-auth-design.md`
- `docs/official-toss-open-api-adapter-design.md`

필수 확인:

- read-only HTTP client가 `GET`만 허용하고 mutation method를 token 발급 전 차단
- disabled/invalid auth config에서 token provider와 transport를 호출하지 않음
- Bearer token은 injected token provider에서 받아 request header에만 주입
- actual network transport는 injected interface 밖에 두고 직접 `fetch`/`http.request`/`https.request`를 추가하지 않음
- 401/403/429/4xx/5xx response를 분류하고 429 `Retry-After`를 해석
- official error envelope의 nested `error.code`를 해석
- 401 `invalid-token`/`expired-token` 계열에서 request가 실제 사용한 lease generation을 `invalidateTokenLease(generation)`으로 compare-and-clear한 뒤 `GET`을 최대 1회만 재시도하고, retry 401은 retry generation만 정리하며 stale generation은 current newer lease를 변경하지 않음
- absolute URL, protocol-relative URL, non-https base URL, backslash path를 reject
- market endpoint mapping, account snapshot reader, Local Operations API/MCP/dashboard surface, live order gateway를 추가하지 않음

### Official Toss Open API market data adapter 변경

수정 후보:

- `src/broker/tossOpenApiMarketDataAdapter.ts`
- `src/broker/tossOpenApiMarketDataAdapter.test.ts`
- `docs/official-toss-open-api-adapter-design.md`

필수 확인:

- adapter가 injected read-only JSON client만 호출
- `/api/v1/prices`, `/api/v1/orderbook`, `/api/v1/trades`, `/api/v1/candles`, `/api/v1/stocks/{symbol}/warnings`, `/api/v1/market-calendar/{KR|US}`만 mapping
- `prices.symbols`는 official limit에 맞춰 1-200개만 허용
- symbol은 official pattern에 맞춰 letters, numbers, dot, dash만 허용하고 path segment는 encoded path로 구성
- `trades.count`는 1-50, `candles.count`는 1-200, `candles.interval`은 `1m` 또는 `1d`만 허용
- account snapshot reader, order endpoint, Local Operations API/MCP/dashboard surface, live `TradingSignal`/`OrderIntent`/`OrderRouter`를 추가하지 않음

### Official Toss Open API account snapshot reader 변경

수정 후보:

- `src/broker/tossOpenApiAccountSnapshotReader.ts`
- `src/broker/tossOpenApiAccountSnapshotReader.test.ts`
- `docs/official-toss-open-api-adapter-design.md`

필수 확인:

- reader가 injected account read-only JSON client만 호출
- `/api/v1/accounts`, `/api/v1/holdings`만 mapping
- holdings 조회는 explicit `accountSeq`가 있을 때만 수행하고 없으면 degraded source status로 남김
- output에서 account number와 accountSeq를 masking
- symbol filter는 letters, numbers, dot, dash만 허용
- order endpoint, portfolio mutation, Local Operations API/MCP/dashboard surface, live `TradingSignal`/`OrderIntent`/`OrderRouter`를 추가하지 않음

### Storage artifact 변경

수정 후보:

- `src/storage/artifactPaths.ts`
- `src/storage/repositories.ts`
- `src/storage/fileStore.ts`
- `src/storage/jsonlStore.ts`
- `src/api/localOperationsServer.ts`
- 관련 report/replay workflow

필수 확인:

- path mapping 변경이 dashboard/API와 batch report를 깨지 않는지 확인
- append-only audit/replay JSONL 의미가 유지되는지 확인
- corrupt line handling이 read path를 전체 실패로 만들지 않는지 확인

주요 source of truth:

| 위치 | 역할 |
| --- | --- |
| `src/api/localOperationsSurface.ts` | read-only HTTP method, Local Operations API route, dashboard ES module/static path 기준 |
| `src/api/localOperationsServer.ts` | HTTP server bootstrap, method guard, dashboard asset/API dispatch |
| `src/api/localOperationsRouting.ts` | Local Operations API route handler table과 query parameter parsing |
| `src/api/dashboardViewModels.ts` | Next.js dashboard 전환용 read-only ViewModel 계산 |
| `src/api/localOperationsReaders.ts` | storage/report artifact read-only payload 생성 |
| `src/api/localOperationsDashboardAssets.ts` | dashboard document/module/static asset 매핑과 응답 |
| `src/api/localOperationsResponse.ts` | masked JSON response writer |
| `dashboard/app.js` | dashboard bootstrap, refresh orchestration, renderer composition |
| `dashboard/batchRunRenderers.js` | batch replay 개별 run 목록, 탭, 상세, polling renderer |
| `dashboard/dashboardStatusRenderers.js` | API 연결 상태, file-mode notice, dashboard 상단 metric renderer |
| `dashboard/decisionRenderers.js` | AI decision timeline, filter event binding, performance, risk summary DOM renderer |
| `dashboard/portfolioModel.js` | portfolio timeline, trade PnL, position valuation, benchmark data helper |
| `dashboard/portfolioRenderers.js` | portfolio 성과, 벤치마크, 노출, 이벤트, 목표, 리스크 metric DOM renderer |
| `dashboard/reportRenderers.js` | daily/replay/batch report DOM renderer |
| `dashboard/replayProgressCoordinator.js` | replay progress polling과 live replay section composition |
| `dashboard/replayProgressRenderers.js` | replay progress panel, performance metric, event table renderer와 view helper |
| `dashboard/reportViewHelpers.js` | report/replay/batch renderer가 공유하는 label/summary helper |
| `dashboard/sourceRenderers.js` | source summary renderer와 dashboard symbol metadata registration |
| `dashboard/tableRenderers.js` | positions/trades/market packet table renderer와 symbol cell helper |
| `src/mcp/toolSurfacePolicy.ts` | MCP에 기본 enabled하면 안 되는 disabled-by-default tool 이름 기준 |
| `src/mcp/virtualPortfolioTools.ts` | 현재 enabled MCP read-only tool name, input schema, handler 기준 |
| `src/storage/artifactPaths.ts` | batch replay artifact root, manifest/runs file name, runs JSONL allowlist path policy |
| `src/storage/repositories.ts#createStoragePaths` | 단일 storage base dir 안의 paper/replay/report artifact path mapping |
| `src/storage/jsonlStore.ts` | append-only JSONL read/write와 corrupt line count 처리 |
| `src/storage/fileStore.ts` | snapshot JSON read/write |

Artifact 역할:

- `*.jsonl`: append-only log입니다. audit event, virtual decision/trade, market packet, historical replay packet/decision/risk/trade/timeline, batch run record처럼 시간 순서 기록을 보존합니다.
- `*.json`: latest snapshot 또는 generated report입니다. virtual portfolio, replay report/progress/metadata, batch manifest, aggregate report처럼 현재 상태 또는 산출 report를 담습니다.
- `data/` 아래 파일은 runtime artifact이며 Git source of truth가 아닙니다.
- Local Operations API는 storage helper가 정의한 path만 read-only로 조회하고, replay/batch/Codex 실행을 시작하지 않습니다.

## 테스트와 검증

기본 검증:

```powershell
npm run check:review
npm run check
```

반복 개발·review 수정에서는 `npm run check:review`(호환 alias `check:changed`)가 `origin/main` 대비 변경 module의 transitive reverse
dependency, compiled CLI를 실행하는 subprocess/worker test, source text를 직접 검사하는 안전성
test만 실행한다. 영향 범위를 안전하게 계산할 수 없으면 전체 suite로 자동 fallback한다.
이 명령은 최종 gate를 대체하지 않으며 검수 완료한 최종 병합 후보에는 `npm run check` 또는
동등한 `npm run check:merge`를 실행한다. 동일 변경에 두 profile을 연속 필수 실행하지 않는다.

`scripts/verificationRunner.mjs`가 build → quality → tooling test → 영향/전체 test를 실행하고
각 단계 timing과 실패 상태를 출력한다. 실패하면 이후 단계는 실행하지 않는다. `quality:gate`의
Local Operations API route, dashboard endpoint, MCP enabled/disabled tool name, Codex decision
provider safe default와 문서 drift 검사는 유지된다. 상세 절차는 [test-verification.md](test-verification.md)를 따른다.

리팩토링 범위가 좁더라도 `npm test`는 `npm run build`를 포함한다. risk, paper order, replay, storage contract를 바꾸면 해당 영역 테스트를 추가하거나 보강한다.

## 관련 문서

- [CODE_CONVENTION.md](CODE_CONVENTION.md)
- [REFACTORING_GUIDE.md](REFACTORING_GUIDE.md)
- [ai-investment-process-refactoring-plan.md](ai-investment-process-refactoring-plan.md)
- [architecture.md](architecture.md)
- [official-toss-open-api-adapter-design.md](official-toss-open-api-adapter-design.md)
- [official-token-auth-design.md](official-token-auth-design.md)
- [trading-runtime.md](trading-runtime.md)
- [risk-policy.md](risk-policy.md)
- [historical-replay.md](historical-replay.md)
- [quant-research-paper-simulation-review.md](quant-research-paper-simulation-review.md)
- [quant-research-paper-simulation-plan.md](quant-research-paper-simulation-plan.md)
- [nextjs-dashboard-architecture-plan.md](nextjs-dashboard-architecture-plan.md)
- [mcp-tools.md](mcp-tools.md)
