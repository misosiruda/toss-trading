# Benchmark 표시 선택·source coverage 범위

기준: 실제 main022059a3(PR813 병합), 승인된 기능별 계획 3단계.

- run summary에서 기존 저장 report의 cashOnly/equalWeightBuyAndHold/initialPortfolioBuyAndHold 3종을 읽어 표시만 선택한다. 선택은 URL UI 상태이며 계산·runner/create 요청·metadata/hash를 바꾸지 않는다. 전체 표시로 복원 가능하다.
- API-selected child와 report/run identity를 엄격하게 결합하고 읽기 status와 누락/invalid/unavailable을 구분한다. unavailable은 0이나 성공 수익률로 대체하지 않는다.
- coverage는 저장 metadata/report의 source/기간/시장·symbol 수 같은 검증 가능한 필드만 투영한다. 전체 시장 coverage·fixture 자료 종류·membership filter를 추론하지 않는다. 근거 부재는 unknown이다.
- 기존 bounded exact-child GET에서 안전한 표시 계약만 투영한다. backend 계산·실행 필터·추가 파일 읽기·clone/canonical 저장은 범위 밖이다.
- 완료: projection/binding/negative/표시 URL unit, 실제 변경 후보 build/lint/type와 합성 production3viewport/axe/keyboard/history/GET-only/3종 값·누락·unknown 표시. report/calculation/runner 입력 source는 main과 동일하다.