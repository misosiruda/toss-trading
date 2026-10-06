# Whole-batch clone UI 검증

기준 main: 4db02564c6bc3ade531446b2fae8906cfeba6835 (PR815 merge), tree 38b97858757f53998f3b498075cfdbb7cebe6321. 제품 변경 전 별도 scope commit을 만들었다.

## 구현

- detail의 요청 exact ID만 cloneFrom으로 전달한다. child/선택 window/data.batchId/latest를 원본으로 사용하지 않는다.
- GET BFF는 bounded 32KiB·UTF-8·strict canonical DTO·UUID·exact ID·SHA-256·typed whole-request roundtrip을 확인한다. legacy/masked/corrupt/missing/unsupported 원본은 입력 기본값으로 복원하지 않는다. GET/HEAD는 validation/create를 호출하지 않는다.
- 원래 requestedConfig의 seed/random 범위, 선택 runCount/executionCosts 생략, preset/provider/model/schema/maxCodexCalls를 유지한다. 현재 wizard 소유 필드만 편집하며 validation·권한·disabled provider guard는 서버에서 다시 적용한다.
- raw draft는 fresh source ID/hash에 묶고 receipt/token을 복원하지 않는다. 항상 새 검증과 명시적 create를 거쳐 다른 새 ID를 접수하며 원본을 덮지 않는다.
- source/validation 취소와 이미 보낸 create의 응답 관측을 분리한다. source 변경이 create 관측을 끊는 경합을 실제202·응답 gate로 결정적으로 재현했고 수정 후 latest source와 accepted exact ID를 함께 보존한다. unmount와 create deadline 중단·unknown no-retry barrier는 유지한다.

## Home PC 검증 (2026-10-06)

기존 Node24.19.0/npm11.17/Chrome154와 이미 설치된 의존성을 사용했다. 설치·다운로드·관리자권한·기존 서비스 종료 없이 새 작업 전용 loopback 서버와 합성 fixture만 사용했다. Codex provider는 테스트 동안 활성화하거나 호출하지 않았다.

| 검사 | 결과 |
| --- | --- |
| 프론트 unit 전체 | 222 pass / 0 fail / 0 skip |
| production wizard 전체 | 96 pass / 0 fail / retry0 |
| 이 중 clone 전용 | 8개 시나리오 ×1440/1024/390 = 24 pass |
| Next production build + TypeScript | 통과 |
| ESLint | error0 / warning0 |
| root build + quality:gate | 통과 |
| 변경 검증 도구 계약 | 23 pass |
| git diff --check | 통과 |

Clone 실제 API create는 typed 원본과 같은 POST body·POST1·202·다른 새ID·exact 상세URL·Back/reload barrier·명시적 별도 새 준비를 확인했다. 원본 batch 디렉터리의 모든 파일 bytes/size/mtime/ctime은 생성 전후 동일했다. 선택값 생략은 explicit0/default 값으로 바뀌지 않았다. Keyboard 진입·axe 위반0·horizontal overflow0, 비활성 상속 provider의400·create0, malformed/unavailable 사례, raw draft 재진입·token/receipt 미복원·unknown barrier 유지, stale source/validation/late202를 확인했다.

첫 실행의 신규 테스트 라벨 불일치와 다음 실행의 source/create 취소 경합 실패 로그·trace는 별도 보존했다. 최종96개는 최신 production build로 새로 실행한 결과이며 timeout/expect5000/retry0을 바꾸지 않았다.

Backend 제품 src는 PR815 tree와 동일하다. PR815의 독립 Linux full4530 pass/33 Windows skip은 기준선 증거이며 이번 clone head의 fresh full 실행으로 주장하지 않는다. Home clone의 변경 검사는 위 표의 결과다.

UX06 전체 비교/benchmark tab query 초기화와 원래 soft-navigation 간헐 정체의 원인은 이 범위 밖이다. source/create 취소 경합을 원래 간헐 정체의 원인으로 주장하지 않는다. ROADMAP_COMPLETE·최신 head Code/Security 통과·merge 완료를 선언하지 않는다.
