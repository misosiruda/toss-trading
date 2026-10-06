# Canonical whole-batch 요청 저장·exact read 범위

기준: 실제 main3fcb0926(PR814 병합), 승인된 기능별 계획 4단계. Clone UI/create 복사 흐름은 다음5단계이다.

- 현재 schema가 파싱한 원래 whole-batch 요청만 versioned 파일로 저장한다. child의 선택 window나 effectiveConfig를 요청 원본으로 쓰지 않는다. HTTP credential/header/unknown JSON은 제외한다.
- 예약된 batch 디렉터리에서 canonical 요청·hash·source runtime identity를 먼저 durable 저장하고 그 hash를 accepted 증거에 결합한 뒤만202/runner를 허용한다. 저장 실패는503/runner0이며 남은 ID barrier는 재사용하거나 삭제하지 않는다.
- source runtime identity는 해당 저장소의 durable UUID namespace와 실제 Node/기존 execution model version이다. 전체 Git/build provenance나 자료 가용성 검증으로 표시하지 않는다. UUID marker는 create에서만 최초 저장하며 read/validation은 파일을 만들지 않는다.
- 기존 masking을 적용한다. redacted 입력은 원본 복사 unavailable이며 기본값을 채우지 않는다. 기존 accepted 기록에 canonical hash가 없으면 legacy unavailable이다.
- GET exact batch ID만 지원한다. version/identity/hash/runtime binding/완전한 typed 요청을 확인한다. 경로 alias·hardlink·손상·부재·size/time budget은 fail-closed이며 child/latest fallback·복구 쓰기는 없다.
- 기존 runner/response/benchmark/filter/provider guard는 보존한다. 기존 v1 acceptance의 optional canonical hash는 구기록 읽기와 현재 반환 observation 형태를 유지한다.
- 완료: durable 실패202/runner0, strict/missing/redacted/cross-runtime/ID/hash/alias/limit negatives, GET side effects0, 원래 random seed/기간/count/cost 보존 및 실제 합성 create/runner contract. Backend 영향 build/quality/tooling/selected tests와 frontend 기존216 확인 후 독립 full 검토 대기.

후속 UX: PR814의 표시 query는 상세 탭 링크에 전달하지 않아 탭 이동 후 기본3종으로 초기화된다. 비차단 관찰이며 canonical 업무 요청과 표시 선택을 섞지 않는다.