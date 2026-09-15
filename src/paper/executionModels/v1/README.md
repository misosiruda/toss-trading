# Paper 실행 모델 v1 보존본

`paper_order_engine.v1` 기록은 이 디렉터리의 고정된 구현으로 생성·재생한다. 현재
`src/paper`의 주문 엔진, Risk/비용/유동성 정책, confidence 또는 decision validation이
달라져도 과거 v1 기록의 계산 의미를 바꾸지 않는다.

## 원본과 검증

- 원본 커밋: `947e77e3fe32ac07a1a8ec7ba0f4f22fc7e1e544`
- `manifest.json`: 해당 시점 `paper/preparedApplication.ts`와 전체 상대 import/export
  의존성 22개 파일. 줄바꿈을 LF로 정규화하고 보존본 주석 한 줄만 추가한 파일별 SHA-256.
- 파일 내부의 상대 경로 구조를 그대로 유지해 runtime/type 의존성 모두 이 경계 안에 둔다.
- 외부 의존성은 기존 `zod`, `node:crypto`, `node:util`뿐이다. 새 dependency나 네트워크/파일 I/O는 없다.
- `golden.json`: dispatcher 변경 전 구현으로 만든 BUY/SELL/무주문 HOLD/Risk rejection의 전체 기록.
- `executionModels.test.ts`: golden 재생, 현재 engine/Risk 변경 주입, 전체 파일 hash/inventory 및
  상대 import 경계와 dynamic import 부재를 검증한다.

## 변경 규칙

새 정책이나 계산 변경은 별도 모델 버전 디렉터리와 public dispatcher branch로 추가한다.
기존 v1 파일이나 golden/manifest를 새 계산에 맞게 갱신하지 않는다. 버그 수정으로 기존 기록을
그대로 재생할 수 없는 경우 과거 원본을 변환하거나 검증을 완화하지 말고 별도 버전과 명시적
호환성 처리를 설계해야 한다. 공용 schema 또는 `zod`/Node 의존성을 바꿀 때도 v1 golden 검증이
필수이며 runtime artifact 자체는 기존 형식을 유지한다.

이 보존본은 새로운 Risk 우회 경로가 아니라 기존 v1 의미를 명시적으로 보존하는 내부 모델이다.
기록은 여전히 paper-only intent이며, 실제 적용 완료나 자동 복구 권한을 증명하지 않는다.
