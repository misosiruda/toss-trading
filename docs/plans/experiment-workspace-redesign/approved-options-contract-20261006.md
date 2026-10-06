# 승인된 비용·표시 기준·coverage·실험 전체 복제 계약

기준일: 2026-10-06. 설계 기준 main `66f7b3ca6a536f60a67459772d6939b2ca9f0e17`.

사용자는 다음 네 추천 방향에 “좋아”라고 답해 승인했다. 이 문서는 그 결정을 정본으로 기록하며 실제 구현 완료를 선언하지 않는다. PR810의 legacy CSS/E2E 수정과 별도 책임이다. 숫자 preset, 실제 종목 필터, 실거래, 유료 AI 활성화는 승인되지 않았다.

## 승인된 기능 범위

| 기능 | 승인 방향 | 현재 기능과 변경 경계 |
| --- | --- | --- |
| 비용 | 수수료·세금·슬리피지를 직접 입력 | 기존 paper execution model의 feeBps/taxBps/slippageBps를 전달한다. 근거 없는 high_cost preset을 만들지 않는다. |
| benchmark | 기존 3종 계산 유지, 표시만 선택 | cashOnly/equalWeightBuyAndHold/initialPortfolioBuyAndHold 계산·기록은 유지한다. cash_only를 실행 정책으로 허용하지 않는다. |
| universe | 현재 source의 coverage 안내 | presetApplied=false/marketFilterApplied=false를 유지한다. 현재 market allocation 의미를 종목 membership 필터처럼 표시하지 않는다. |
| clone | 원래 실험 전체의 요청 정본→재검증→새 실험 | batch 요청을 복제하며 child의 선택된 random window나 일부 실효 값을 원본 요청으로 추정하지 않는다. 불완전한 과거 기록은 unavailable이다. |

이는 방향의 승인이다. 존재하지 않는 비용 수치·membership 명단·시장 정책·자료 가용성을 확정하지 않는다.

## 비용 요청과 실제 적용

- UI는 paper 체결 비용의 bps 단위와 기존 engine의 적용 의미를 설명한다. 실제 청구 비용·AI 사용료·현실 수익률을 의미하지 않는다.
- 신규 요청 필드 설계는 `executionCosts?: { feeBps, taxBps, slippageBps }`다. 객체가 있으면 세 필드 모두 명시해야 하며 누락 값을 임의로 채우지 않는다. 객체가 없는 기존 요청은 기존 standard execution defaults와 호환한다.
- 숫자는 기존 execution policy의 유효 범위를 재사용한다. NaN/Infinity/음수·잘못된 타입을 거절하며 새 임의 상한/프리셋 수치를 만들지 않는다. 구현 시 기존 validator와 정확한 타입·경계를 대조한다.
- resolver가 만든 cost model을 validation/create/runner/저장 provenance가 동일하게 사용한다. spread/impact/liquidity/fill defaults는 기존 계약을 유지한다.
- high_cost 및 실행 cash_only guard, provider enable guard, same-origin/token, create1회, accepted와 completed 구분을 유지한다.

## benchmark 표시와 coverage

- 표시 선택은 계산·runner 요청·보고서 hash를 바꾸지 않는 UI 상태다. unavailable benchmark는 숨겨서 존재하는 것처럼 바꾸지 않는다. 기존 3종 모두의 관측값을 다시 선택할 수 있다.
- coverage는 관측한 source/시점/누락 또는 unknown을 설명한다. preset의 이름만으로 실제 구성 종목·전체 시장 coverage를 보장하지 않는다.
- 기존 universe.market의 allocation 의미는 유지한다. 실제 filtering/membership/version 정책은 이번 승인과 비범위다.

## 생성 요청 정본과 복제

- 정본은 schema로 파싱한 원래 전체 생성 요청이다. unknown JSON, credential, HTTP token/header, 모델 호출 결과를 저장하지 않는다. 별도 version과 source runtime/입력 binding을 기록한다. effectiveConfig는 요청과 구분한다.
- 접수 단계에서 새 batch ID와 정본을 결속해 저장하고 기존 durable acceptance와 같은 실패 경계를 유지한다. 저장 실패를 성공202로 반환하거나 runner를 먼저 시작하지 않는다.
- exact batch ID로만 조회하며 child ID를 첫/최신 batch로 바꾸지 않는다. path traversal/symlink/크기·시간 제한/identity mismatch는 fail-closed다.
- 저장 또는 반환 시 기존 account/token/JWT masking을 유지한다. redaction이나 missing field 때문에 완전 복원이 안 되는 입력은 clone unavailable로 판정한다. 부분 값에 현재 기본값을 채워 복제를 활성화하지 않는다.
- 새 요청은 현재 schema/guard로 다시 validation한다. 새 validation의 성공은 데이터 가용성·슬롯 확보 증거가 아니다. 사용자 확인 후 기존 create 경로에1회 제출해 새로운 batch ID를 생성한다. 기존 실행/산출물을 덮어쓰거나 자동 retry하지 않는다.
- 원래 random seed·기간·runCount 등 요청 조건을 복사한다. child의 실효 fixed window로 바꾸거나 seed를 자동 변경하지 않는다. 현재 계약과 호환되지 않는 버전/필드는 이유를 표시하고 생성 전에 사용자가 수정·재검증한다.
- 입력 JSON/민감 값은 URL·로그에 넣지 않는다. 기존 기록은 migration으로 정본을 발명하지 않으며 완전한 안전 입력/버전 binding이 확인된 기록만 복제를 허용한다.

## 완료 판정

비용의 validation/create/runner 동일성·실제 합성 체결 비용·provenance, 표시 선택 전후 3종 계산 동일성, coverage의 무필터 의미, 정본 durable 저장·exact ID 조회·불완전 unavailable·새 validation·create1회·새 ID·원본 불변을 각각 검증한다. paper fixture만 사용하고 실자료/실거래/외부 유료 모델을 실행하지 않는다. 원래 soft-navigation 간헐 원인은 미확정이며 PR810 overflow 해결과 별개다.
