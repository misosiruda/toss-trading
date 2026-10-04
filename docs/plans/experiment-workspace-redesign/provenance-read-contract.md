# 저장 provenance 부분 조회

`GET /batch/replay/runs/provenance?runId=<exact-child>`는 historical batch replay 저장 관측만 조회한다. 정확한 ASCII child ID 1개가 필요하다. 중복 파라미터, 경로 문자, 추가 query는 400이며 파일을 읽지 않는다. GET 외 method(HEAD 포함)는 405다. 모든 응답은 `Cache-Control: no-store`다. 새로운 create, provider 호출, broker 호출, 입력 저장 및 clone 동작은 없다.

## 결합과 읽기 경계

server storage의 sibling `batch-replay` root 아래 batch manifest와 고정 이름 runs index만 읽는다. aggregate/latest/batch alias를 선택 근거로 사용하지 않는다. 전체 index를 한도 안에서 검사해 같은 child가 여러 줄/여러 batch에 있으면 ambiguous, 손상 JSONL은 invalid다. 저장 record의 batch/index와 metadata의 identity가 같아야 한다. metadata가 다른 child이면 그 관측을 반환하지 않는다. 외부 research manifest와 metadata의 embedded manifest가 모두 있으면 identity와 canonical 저장 내용이 일치해야 한다. 불일치한 research 관측은 unavailable이며 독립된 정상 configuration 값은 유지한다.

저장 record가 가리키는 child storage는 해당 batch `runs` 내부의 절대경로여야 한다. 사용자 query나 source/log/report/manifest path 필드로 파일을 찾지 않는다. 부모부터 lstat으로 symlink/junction을 거절하고, 파일은 regular file/nlink 1, O_RDONLY/O_NOFOLLOW open 뒤 dev/ino/nlink를 확인한다. UTF-8 및 읽기 전후 크기/mtime도 검사한다. 실제 경로의 root containment를 추가 검사한다. 이 검사는 기존 신뢰된 server storage를 위한 경계이며 악의적 동시 parent-directory 교체를 막는 OS sandbox를 주장하지 않는다.

한도는 root entries 256개, batch manifest 256KiB, index 각 4MiB 및 10,000줄, metadata 512KiB, research manifest 64KiB, 총 파일 bytes 8MiB, 전체 2초다. deadline 이후 추가 읽기를 멈추며 진행 중인 bounded file handle은 finally에서 닫는다. 한도를 넘으면 일부 index를 유일하다고 해석하지 않고 `limit`로 응답한다.

## 응답 의미

`contractVersion: replay_provenance_read.v1`은 현재 조회 DTO 버전이다. 과거 실행 runtime 버전이 아니다. 정상 응답도 `partial`이며 전체 requested/effective 입력을 복원했다고 주장하지 않는다. 각 field는 `recorded/source/verification: stored_observation/value` 또는 `unavailable/reason/value:null`이다. 원본에서 field 존재 여부를 먼저 확인하므로 schema default를 새 저장 값으로 만들지 않는다. 저장된 0은 0으로 반환한다.

window의 고정 enum·시각·timezone, capital/clock/sampling/constraints의 일부 값, risk/allocation/exit의 whitelist scalar, executionPolicy scalar, 저장된 SHA256 hash 및 알려진 execution model version만 projection한다. hash는 당시 저장 관측이며 현재 자료·정책·코드의 hash를 재계산하거나 검증하지 않는다. 자유 문자열 seed/preset/packet prefix는 값이 저장됐어도 `redacted_text`로 숨긴다. 임의 map key, policyName, provider/prompt 출력, warnings/errors, 경로, token 및 환경 설정은 응답에 포함하지 않는다. 새 계산 seed hash도 만들지 않는다.

projection 문자열은 최대 128자, enum collection은 최대 16개로 제한한다. 초과 field는 invalid/unavailable이며 큰 배열이나 자유 문자열을 그대로 전달하지 않는다.

raw 문자열 길이와 배열 길이는 Zod safeParse 전에 제한한다. 날짜 6필드는 reader 전용 엄격한 ISO timestamp 문법과 calendar 범위를 먼저 검사한다. Date.parse가 허용하는 자유 문자열·괄호 설명·경로는 unavailable/invalid로 거절하고 과거 정본처럼 정규화하지 않는다. nullable range의 저장 null만 그대로 허용한다.

원래 requestedConfig/effectiveConfig/notices와 runtime Git revision/dependency lock hash/Node version은 historical API 실행에 저장되지 않았으므로 `not_persisted`다. 다른 CLI paper-experiment 증거 계열의 runtime/input 정보를 가져와 보충하지 않는다. comparison/clone은 계속 unavailable이다. future create 정본 저장과 clone 단위 선택은 이 범위 밖이며 사용자 결정 전 구현하지 않는다.

## 검증

합성 fixture에서 exact child/다른 child/partial/missing/malformed, metadata identity 불일치, research identity·embedded hash 불일치, 전체 index의 100개 밖 중복 및 다른 batch 중복, 경로 밖 접근, hardlink 및 junction/symlink, 파일 byte/line 제한, read 전후 bytes/mtime/entries 보존, HTTP GET-only/no-store/400/405 및 runner 호출 0을 확인한다. 독립 리뷰와 Linux 최종 gate 전 Ready/merge하지 않는다.
