# 공용 CLI 프로세스 실행 한도

이 계약은 #840의 `NodeProcessRunner`, Codex paper provider와 TossInvest read-only
collector에 적용한다. 임의 명령 MCP surface를 추가하지 않는다.

## 기본 한도와 결과

| 항목 | 기본값 | 허용 설정 범위 |
| --- | --- | --- |
| stdout | 8 MiB | 1 byte 이상 64 MiB 이하의 정수 |
| stderr | 256 KiB | 1 byte 이상 64 MiB 이하의 정수 |
| 실행 시간 | 기존 호출자의 `timeoutMs` | 1~2,147,483,647 ms 정수 |
| SIGTERM 이후 대기 | 1,000 ms | 1~60,000 ms 정수 |
| SIGKILL 이후 close 대기 | 1,000 ms | 1~60,000 ms 정수 |

출력 상한은 정상 외부 응답을 실측한 보장이 아니라 새로 정한 보수적 운영 상한이다.
기존 decision JSON과 collector JSON fixture를 그대로 수용하면서 무제한 누적을 없앤다.
기본 stdout은 stderr보다 크게 허용하되 실제 긴 chart/CLI 출력은 별도 운영 검증 대상이다.
초과 시 자동 증액·재시도하지 않는다.

byte 수는 raw Buffer의 누적으로 센다. 정확히 상한인 출력은 허용하고 다음 byte부터
실패한다. chunk 경계에서 잘린 UTF-8은 모든 허용 Buffer를 합친 뒤 한 번 decode한다.
실패 후에는 stdout/stderr를 모두 폐기하고 추가 출력을 보관하지 않는다.
따라서 유효한 JSON prefix 뒤의 초과 출력을 성공으로 해석하지 않는다.

`failureReason`은 `timeout`, `stdout_limit`, `stderr_limit`,
`spawn_failed`, `process_error` 중 최초 실행 실패다.
`termination`은 다음처럼 실행 원인과 별도로 기록한다.

- `closed`: 직접 생성한 child의 close 이벤트 관측
- `not_started`: spawn 실패
- `unconfirmed`: 최종 기한까지 close를 확인하지 못함

`terminationRequestFailed`는 signal 요청의 false/예외/error를 기록한다.
`timedOut`은 최초 실패가 timeout일 때 true로 유지한다. 호출 반환을 process 정리
완료로 해석하지 않는다. 기존 주입 runner와의 호환을 위해 신규 필드는 optional이지만
실제 Node runner는 termination을 항상 반환한다.

## 종료 순서와 보장 범위

실행 timeout 또는 출력/pipe 실패 → SIGTERM 요청 → 유예 → SIGKILL 요청 →
최종 close 기한 순서로 처리한다. 정상 close는 모든 timer를 해제한다.
최종 기한에는 pipe를 닫고 child handle을 unref하여 호출을 `unconfirmed`로 반환한다.
늦은 error는 무시하고 완료 결과를 뒤집지 않는다.

이미 exit를 관측했거나 exitCode/signalCode가 설정된 child에는 signal을 보내지 않는다.
close가 지연되어도 이전 PID를 다시 조회하거나 무관한 process를 종료하지 않는다.
직접 child만 대상으로 하며 자손 process tree 전체의 종료·sandbox 격리를 보증하지 않는다.
`shell=false`와 `windowsHide=true`를 유지한다.

[Node v24.19.0 공식 문서](https://nodejs.org/download/release/v24.19.0/docs/api/child_process.html)에
따라 signal 전송 성공을 종료 확인으로 취급하지 않는다. Windows의 SIGTERM/SIGKILL은
POSIX와 같은 graceful signal 의미를 제공하지 않는다. 시간 상한은 timer가 실행 가능한
event loop를 전제로 하며, 부모의 event-loop 정지나 OS 정지까지 보장하는 hard realtime 기한은 아니다.

## 소비자와 호환성

Codex provider와 collector는 JSON parsing 이전에 신규 실패와 종료 미확인·요청 실패를
검사한다. Provider는 `AI_DECISION_FAILED`, collector는 timeout의 경우
`COMMAND_TIMEOUT`, 나머지는 `COMMAND_FAILED`를 반환한다.
이 신규 실패에는 원시 stdout/stderr·command·경로·OS error를 포함하지 않는다.
기존 정상 종료 및 nonzero exit 진단 계약은 유지한다.

실제 API, provider 활성화, live order, Risk 계산, 저장 schema를 변경하지 않는다.
rollback에는 데이터 변환이 없지만 출력/종료 한도가 다시 사라지는 점을 검토해야 한다.

## 검증

외부 CLI 대신 실제 Node synthetic child로 출력 경계·UTF-8·timeout·SIGTERM handler를 검증한다.
종료 미확인, signal 실패, exit 이후 pipe 지연, 늦은 error/close 경합은 소유 fake child로
검증한다. 두 소비자는 유효한 JSON이 함께 있어도 실패 상태를 먼저 거절해야 한다.
Windows와 Linux 실행 결과는 PR에 별도로 기록한다. 실계정·실시장·실제 Codex/Toss 호출은
검증 범위에 포함하지 않는다.
