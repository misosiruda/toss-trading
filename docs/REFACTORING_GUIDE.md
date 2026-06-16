# Refactoring Guide

## 목적

이 문서는 `toss-trading`의 대규모 리팩토링을 안전하게 진행하기 위한 작업 기준이다.

현재 프로젝트는 paper-only historical replay와 local operations dashboard까지 기능이 넓어졌다. 따라서 리팩토링은 한 번에 코드를 크게 옮기는 방식이 아니라, 문서화된 책임 경계와 테스트를 기준으로 작은 단위로 진행한다.

## 리팩토링 원칙

1. 문서와 코드 위치를 먼저 고정한다.
2. live trading capability는 추가하지 않는다.
3. `RiskEngine`과 `VirtualRiskEngine` 경계는 약화하지 않는다.
4. behavior-preserving refactor와 behavior change를 같은 PR에 섞지 않는다.
5. storage artifact path, schema, report contract 변경은 dashboard/API 영향까지 같이 본다.
6. risk, replay, order, schema 변경은 테스트를 먼저 확인하거나 추가한다.
7. 투자 조언, 수익률 보장, 실계좌 성과 표현을 추가하지 않는다.

## 시작점

이번 리팩토링의 첫 산출물은 아래 문서다.

- [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md): 코드 위치와 책임 지도
- [CODE_CONVENTION.md](CODE_CONVENTION.md): TypeScript 코드 컨벤션과 레이어 규칙
- [REFACTORING_GUIDE.md](REFACTORING_GUIDE.md): 단계별 리팩토링 운영 기준

이 세 문서를 기준으로 이후 코드를 이동하거나 쪼갠다.

## Phase 0. 문서 기준선

목표:

- 코드 위치를 문서로 고정
- code convention을 source of truth로 추가
- 리팩토링 금지선과 검증 기준 정의

완료 기준:

- `docs/PROJECT_STRUCTURE.md`가 주요 디렉터리와 entrypoint를 설명한다.
- `docs/CODE_CONVENTION.md`가 TypeScript style, import 방향, 안전 규칙을 설명한다.
- `README.md`에서 새 문서로 진입할 수 있다.

검증:

```powershell
npm run build
```

## Phase 1. Contract 기준 정리

범위:

- `src/domain/schemas.ts`
- `schemas/virtual-decision.schema.json`
- `docs/codex-cli-paper-trading.md`
- `docs/risk-policy.md`

목표:

- `VirtualDecision`, `MarketPacket`, `VirtualRiskDecision`, `VirtualTrade` 계약의 source of truth를 명확히 한다.
- Zod schema와 JSON Schema의 drift를 줄인다.
- contract 변경 시 테스트와 문서 갱신 위치를 고정한다.

금지:

- field 제거를 별도 호환성 검토 없이 수행
- Codex CLI output을 live trading contract로 승격

완료 기준:

- contract 변경 영향이 문서에 연결되어 있다.
- schema validation 실패가 no-trade/no-paper-order로 유지된다.
- 관련 `*.test.ts`가 contract edge case를 검증한다.

## Phase 2. Storage와 Artifact 경계 정리

범위:

- `src/storage/`
- `src/api/localOperationsServer.ts`
- `src/reports/`
- replay/batch output path

목표:

- runtime artifact path를 한곳에서 추적 가능하게 유지한다.
- dashboard/API가 읽는 path와 workflow가 쓰는 path를 일치시킨다.
- append-only JSONL 로그와 snapshot JSON의 역할을 구분한다.

금지:

- `data/` 산출물을 source처럼 취급
- audit/replay JSONL 의미를 문서 없이 변경
- corrupt line 하나 때문에 전체 read-only 조회가 실패하도록 변경

완료 기준:

- path 변경 시 `PROJECT_STRUCTURE.md` 또는 관련 runbook이 갱신된다.
- local operations API는 계속 `GET`/`HEAD` read-only다.
- masking이 유지된다.

## Phase 3. Workflow Orchestration 분리

범위:

- `src/workflows/`
- `src/cli/`
- `src/replay/`
- `src/paper/`

목표:

- CLI argument parsing과 use case orchestration을 분리한다.
- replay workflow 내부의 policy 계산, storage write, report generation 책임을 더 작게 나눈다.
- 테스트 가능한 순수 함수와 I/O orchestration을 분리한다.

금지:

- CLI에 risk/order policy를 직접 구현
- workflow 내부에 schema와 다른 ad hoc object 생성
- replay 실행과 dashboard read-only 조회를 연결

완료 기준:

- CLI 파일은 argument parsing과 workflow 호출 중심이다.
- workflow는 명시적인 input/output type을 가진다.
- 기존 command behavior가 유지된다.

## Phase 4. Paper Risk와 Order Engine 정리

범위:

- `src/paper/riskEngine.ts`
- `src/paper/riskPolicy.ts`
- `src/paper/riskProfile.ts`
- `src/paper/orderEngine.ts`
- `src/paper/executionModel.ts`

목표:

- risk rule, reject code, order execution model의 책임을 명확히 나눈다.
- paper-only exit policy와 AI/provider decision 처리 순서를 명확히 한다.
- dust/no-op, reduce-only sell, cash reserve, exposure 같은 edge case를 테스트로 고정한다.

금지:

- risk reject 후 trade 기록
- sell sizing을 암묵적으로 live order sizing과 공유
- paper risk profile을 live trading policy처럼 사용

완료 기준:

- 새 risk branch에는 테스트가 있다.
- reject code는 report/audit/docs에서 해석 가능하다.
- `PaperOrderEngine`은 broker adapter를 호출하지 않는다.

## Phase 5. Read-only Operations Surface 정리

범위:

- `src/api/`
- `src/mcp/`
- `dashboard/`
- `docs/mcp-tools.md`
- `docs/llm-boundary.md`

목표:

- local operations API, dashboard, MCP tool surface를 read-only로 유지한다.
- 조회 endpoint와 실행 command를 명확히 분리한다.
- dashboard가 일부 endpoint 실패에도 가능한 데이터를 표시하는 방식을 유지한다.

금지:

- `POST`/mutation endpoint 추가
- dashboard replay 실행 버튼 추가
- raw `codex exec`, raw `tossctl`, live order tool 노출

완료 기준:

- API method guard가 유지된다.
- MCP enabled tool 목록이 docs와 일치한다.
- 민감 정보 masking이 유지된다.

## Phase 6. Tooling과 품질 게이트 보강

범위:

- `package.json`
- `tsconfig.json`
- 테스트 구조
- 향후 lint/format/check script

목표:

- 현재 `npm run build`, `npm test` 기준을 유지한다.
- PR 전 전체 검증을 위한 `npm run check` 기준을 추가한다.
- 필요한 경우 lint/format 도구를 별도 PR로 추가한다.
- code convention을 자동 검사할 수 있는 후보를 검토한다.

금지:

- 대규모 formatting churn과 behavior change를 같은 PR에 포함
- formatter 도입과 리팩토링 이동을 한 번에 처리

완료 기준:

- tooling 변경은 별도 책임 단위로 리뷰 가능하다.
- 실패 메시지가 개발자가 바로 고칠 수 있는 수준으로 명확하다.
- `npm run check`가 build, quality gate, test를 한 번에 실행한다.

## Phase 7. Dashboard Module 분리

범위:

- `dashboard/app.js`
- `dashboard/apiClient.js`
- `dashboard/dom.js`
- `dashboard/formatters.js`
- `dashboard/metadata.js`
- `dashboard/router.js`
- `dashboard/state.js`
- `src/api/localOperationsSurface.ts`
- `src/api/localOperationsServer.ts`
- `scripts/qualityGate.mjs`

목표:

- 3천 라인 이상으로 커진 dashboard entrypoint에서 fetch, routing, state, formatting, DOM helper, symbol metadata helper를 분리한다.
- browser가 직접 로드하는 ES module 구조를 유지하고 bundler나 새 dependency를 추가하지 않는다.
- Local Operations API의 static asset allowlist와 dashboard import graph가 drift되지 않게 quality gate에서 검증한다.
- dashboard renderer는 후속 PR에서 더 작게 분리할 수 있도록 `app.js`에 남겨 behavior change를 줄인다.

금지:

- dashboard에서 replay 실행, Codex CLI 실행, TossInvest CLI 실행, live order 실행 버튼 추가
- Local Operations API `GET`/`HEAD` read-only guard 약화
- bundler, framework, formatter 도입을 같은 PR에 포함

완료 기준:

- `dashboard/app.js`가 support module을 import한다.
- 새 dashboard module이 Local Operations API asset allowlist로 서빙된다.
- `scripts/qualityGate.mjs`가 dashboard endpoint와 module asset drift를 검증한다.
- `npm run check`가 통과한다.

## Phase 8. Local Operations API Handler 분리

범위:

- `src/api/localOperationsServer.ts`
- `src/api/localOperationsRouting.ts`
- `src/api/localOperationsReaders.ts`
- `src/api/localOperationsDashboardAssets.ts`
- `src/api/localOperationsResponse.ts`
- `src/api/localOperationsTypes.ts`
- `src/api/localOperationsServer.test.ts`
- `scripts/qualityGate.mjs`

목표:

- `localOperationsServer.ts`에서 HTTP server bootstrap, route dispatch, storage reader, dashboard asset writer, JSON response writer가 섞인 구조를 분리한다.
- server entrypoint는 method guard와 dispatch만 담당하게 줄인다.
- route table/query parsing과 storage/report artifact read-only payload 생성을 별도 module로 이동한다.
- dashboard static asset serving과 masked JSON response writer를 별도 module로 분리한다.

금지:

- Local Operations API route path 추가/삭제
- `GET`/`HEAD` read-only guard 약화
- storage reader에서 replay 실행, Codex CLI 실행, TossInvest CLI 실행, live order 실행을 시작
- masking 없는 raw response 추가

완료 기준:

- `localOperationsServer.ts`가 `reports`, `scheduler`, `security`, `storage` module을 직접 import하지 않는다.
- 기존 Local Operations API 테스트가 통과한다.
- `scripts/qualityGate.mjs`가 server bootstrap 책임 drift를 검증한다.
- `npm run check`가 통과한다.

## Phase 9. Dashboard Report Renderer 분리

범위:

- `dashboard/app.js`
- `dashboard/reportRenderers.js`
- `dashboard/reportViewHelpers.js`
- `src/api/localOperationsSurface.ts`
- `src/api/localOperationsServer.test.ts`
- `scripts/qualityGate.mjs`
- `docs/CODE_CONVENTION.md`
- `docs/PROJECT_STRUCTURE.md`

목표:

- `dashboard/app.js`에 남아 있는 daily report, historical replay report, batch replay aggregate report DOM renderer를 별도 module로 이동한다.
- 여러 dashboard renderer가 공유하는 report label/summary helper를 `reportViewHelpers.js`로 분리한다.
- browser가 직접 로드하는 nested ES module이 Local Operations API asset allowlist와 quality gate에서 같이 검증되게 한다.
- `app.js`는 dashboard bootstrap, refresh orchestration, page별 renderer composition 중심으로 줄인다.

금지:

- Local Operations API route path 추가/삭제
- dashboard에서 replay 실행, Codex CLI 실행, TossInvest CLI 실행, live order 실행 버튼 추가
- report 문구를 투자 조언이나 수익률 보장처럼 변경
- bundler, framework, formatter 도입

완료 기준:

- `dashboard/app.js`가 report renderer module을 import하고 daily/replay/batch report renderer 구현을 직접 보유하지 않는다.
- `src/api/localOperationsSurface.ts`가 새 dashboard module을 dashboard/root asset path로 모두 허용한다.
- `scripts/qualityGate.mjs`가 dashboard import graph를 따라 nested module allowlist drift를 검증한다.
- `npm run check`와 browser dashboard smoke 확인이 통과한다.

## Phase 10. Dashboard Decision Renderer 분리

범위:

- `dashboard/app.js`
- `dashboard/decisionRenderers.js`
- `src/api/localOperationsSurface.ts`
- `src/api/localOperationsServer.test.ts`
- `docs/CODE_CONVENTION.md`
- `docs/PROJECT_STRUCTURE.md`

목표:

- `dashboard/app.js`에 남아 있는 AI decision timeline, action filter, decision performance, risk summary renderer를 별도 module로 이동한다.
- decision 화면에서 공유하는 action label, tag list, freshness helper를 renderer module 안에 모아 중복을 줄인다.
- `app.js`는 dashboard bootstrap, refresh orchestration, page별 renderer composition 중심으로 줄인다.
- 새 dashboard ES module이 Local Operations API asset allowlist와 quality gate에서 같이 검증되게 한다.

금지:

- Local Operations API route path 추가/삭제
- dashboard에서 AI decision 실행, replay 실행, Codex CLI 실행, TossInvest CLI 실행, live order 실행 버튼 추가
- decision/risk 문구를 투자 조언이나 수익률 보장처럼 변경
- risk engine, order engine, decision schema 동작 변경
- bundler, framework, formatter 도입

완료 기준:

- `dashboard/app.js`가 decision renderer module을 import하고 decision timeline/performance renderer 구현을 직접 보유하지 않는다.
- `src/api/localOperationsSurface.ts`가 새 dashboard module을 dashboard/root asset path로 모두 허용한다.
- 기존 Local Operations API dashboard asset test가 새 module serving과 app import를 검증한다.
- `npm run check`, browser dashboard smoke, 성능 지표 측정, 접근성 자동 검사가 통과한다.

## Phase 11. Dashboard Batch Run Renderer 분리

범위:

- `dashboard/app.js`
- `dashboard/batchRunRenderers.js`
- `src/api/localOperationsSurface.ts`
- `src/api/localOperationsServer.test.ts`
- `docs/CODE_CONVENTION.md`
- `docs/PROJECT_STRUCTURE.md`

목표:

- `dashboard/app.js`에 남아 있는 batch replay 개별 run 목록, 탭, 상세, polling renderer를 별도 module로 이동한다.
- `app.js`는 dashboard bootstrap, refresh orchestration, page별 renderer composition 중심으로 줄인다.
- 새 dashboard ES module이 Local Operations API asset allowlist와 quality gate에서 같이 검증되게 한다.
- virtual replays page의 batch run 표시와 polling 동작을 behavior-preserving 방식으로 유지한다.

금지:

- Local Operations API route path 추가/삭제
- dashboard에서 replay 실행, Codex CLI 실행, TossInvest CLI 실행, live order 실행 버튼 추가
- batch replay 문구를 투자 조언이나 수익률 보장처럼 변경
- batch replay artifact schema, risk engine, order engine 동작 변경
- bundler, framework, formatter 도입

완료 기준:

- `dashboard/app.js`가 batch run renderer module을 import하고 batch run tab/page renderer 구현을 직접 보유하지 않는다.
- `src/api/localOperationsSurface.ts`가 새 dashboard module을 dashboard/root asset path로 모두 허용한다.
- 기존 Local Operations API dashboard asset test가 새 module serving과 app import를 검증한다.
- `npm run check`, browser dashboard smoke, 성능 지표 측정, 접근성 자동 검사가 통과한다.

## Phase 12. Dashboard Portfolio Model Helper 분리

범위:

- `dashboard/app.js`
- `dashboard/portfolioModel.js`
- `src/api/localOperationsSurface.ts`
- `src/api/localOperationsServer.test.ts`
- `docs/CODE_CONVENTION.md`
- `docs/PROJECT_STRUCTURE.md`

목표:

- `dashboard/app.js`에 남아 있는 portfolio timeline, trade PnL, position valuation, benchmark data helper를 별도 module로 이동한다.
- 성과/벤치마크/노출/이벤트/수입 목표/리스크 renderer가 공유하는 data helper 경계를 먼저 고정한다.
- 이후 portfolio analytics renderer를 더 작은 PR로 분리할 수 있도록 renderer와 model helper 책임을 나눈다.
- 새 dashboard ES module이 Local Operations API asset allowlist와 quality gate에서 같이 검증되게 한다.

금지:

- Local Operations API route path 추가/삭제
- portfolio value, PnL, drawdown, volatility 계산식을 behavior change로 변경
- dashboard에서 replay 실행, Codex CLI 실행, TossInvest CLI 실행, live order 실행 버튼 추가
- portfolio/benchmark 문구를 투자 조언이나 수익률 보장처럼 변경
- risk engine, order engine, batch replay artifact schema 동작 변경
- bundler, framework, formatter 도입

완료 기준:

- `dashboard/app.js`가 portfolio model helper module을 import하고 portfolio timeline/current summary/position value helper 구현을 직접 보유하지 않는다.
- `src/api/localOperationsSurface.ts`가 새 dashboard module을 dashboard/root asset path로 모두 허용한다.
- 기존 Local Operations API dashboard asset test가 새 module serving과 app import를 검증한다.
- `npm run check`, browser dashboard smoke, 성능 지표 측정, 접근성 자동 검사가 통과한다.

## 작업 전 체크리스트

- [ ] `AGENTS.md` 확인
- [ ] 관련 `docs/` 문서 확인
- [ ] `docs/PROJECT_STRUCTURE.md`에서 변경 위치 확인
- [ ] `docs/CODE_CONVENTION.md`에서 레이어와 import 방향 확인
- [ ] `git status --short`로 기존 변경 확인
- [ ] behavior-preserving refactor인지 behavior change인지 분리

## 작업 후 체크리스트

- [ ] 관련 docs 갱신
- [ ] risk/schema/replay/storage 변경이면 테스트 추가 또는 보강
- [ ] `npm run build` 실행
- [ ] 가능하면 `npm test` 실행
- [ ] tooling 변경이면 `npm run check` 실행
- [ ] `TRADING_ENABLED=false`, `AI_DECISION_MODE=paper_only`, `AI_DECISION_ENABLED=false` 기본값 유지 확인
- [ ] live order, raw `tossctl`, raw `codex exec` enabled surface가 추가되지 않았는지 확인
- [ ] 실계좌 정보, token, order ID, execution data가 노출되지 않았는지 확인

## PR 분리 기준

리팩토링은 아래 책임 단위로 쪼갠다.

- docs baseline
- contract/schema cleanup
- storage artifact cleanup
- workflow extraction
- paper risk/order cleanup
- replay/report cleanup
- dashboard/API read-only cleanup
- tooling/lint/format setup

하나의 PR에 여러 책임이 들어가면 리뷰가 어려워지고 안전 경계가 흐려진다. 기능 동작이 바뀌는 변경은 문서/구조 이동 PR과 분리한다.

## 중단 조건

다음 상황이면 리팩토링을 멈추고 별도 설계가 필요하다.

- live trading capability가 필요해지는 경우
- Risk Engine 우회가 필요해지는 경우
- MCP에 side-effect tool을 enabled해야 하는 경우
- schema field 제거로 기존 artifact 호환성이 깨지는 경우
- historical replay 결과가 투자 조언이나 성과 보장처럼 읽히는 경우
- 실제 계좌, API key, 주문/체결 데이터가 필요한 경우
