# Child source 관측 상한의 합성 측정

기준 main: `b2b86a51e0fdab5fc7e467117a4f43195737940f`.
측정 시각: 2026-10-08 02:48:52–02:49:46 UTC.
이 문서는 [source 관측 설계](child-source-observation-scope.md)의 engineering 제안을 검토한
결과다. 제품 입력 제한, producer 구현 완료 또는 실제 자료의 저장 허가를 뜻하지 않는다.

## 방법과 검증 범위

현재 `historicalMarketSnapshotSchema`로 parse 전후 값이 같은 deterministic synthetic 배열을
만들었다. 36개 shape를 fresh process 54회로 순차 측정했고 fixture/hash/탐색 gate 검증 449개가
통과했다. source와 사용한 compiled schema/hash module은 TypeScript 출력과 byte 단위로 일치했다.
외부 데이터·계좌·provider 호출, 새 수집 또는 설치는 수행하지 않았다.

Node v24.19.0 / TypeScript 5.9.3 / Linux x64, visible CPU 9개 환경이다.
worker는 `--max-old-space-size=448 --max-semi-space-size=16 --expose-gc`를 사용했고 실제
V8 heap limit은 496 MiB였다. 이는 RSS cap이 아니다. 주요 경계/dense/rich shape는 각 3회,
나머지 경계는 1회다. 단일 host의 cold-process 관측이며 p99·SLA·모든 입력의 최악 상한이 아니다.

탐색 gate는 count → field → record별 JSON byte 순서로 검사했다. 전체 배열 clone/hash 전에
대괄호와 쉼표까지 포함한 UTF-8 byte를 누적한다. 최종 frozen parser, masking, durable writer,
runner 소비 결속과 공개 reader를 측정한 것은 아니다.

## 크기·문자 경계

- 50,000 records / 정확히 16,777,216 bytes인 배열은 탐색 gate를 통과했다.
  +1 byte는 마지막 record까지 계산한 뒤 `limit`으로 구분하며 전체 clone/hash는 하지 않았다.
- 50,001 records는 record 검사·직렬화 0회로 거절했다. 이미 caller가 만든 배열의 생성·ingest
  비용까지 사라진다는 뜻은 아니다.
- text 119/120/121, time 79/80/81, refs 127/128/129, ref length 511/512/513,
  riskTags 31/32/33을 검사했다. 경계 이하 통과/+1 limit이며 기존 parser의 입력 허용은 바꾸지 않았다.
- 문자열 길이는 JavaScript string length인 **UTF-16 code units**다. 512 units는 BMP 512개나
  supplementary Unicode 256개다. UTF-8 JSON byte 상한과 별도로 검사한다.
- rich control shape는 한 record 397,769 bytes였다. 50,000개의 산술 크기는
  19,888,500,001 bytes지만 그 배열은 생성하지 않았다. 최대 실제 fixture는 17,104,111 bytes다.
  count/field 한도만 확인한 뒤 전체 clone을 먼저 만들면 충분한 bound가 아니다.

## 시간과 메모리

hash는 현재 `createReplayResearchHash(privateCopy)`의 raw 배열 hash다. 미래 versioned
wrapper의 hash가 아니다. hash 중 original/private/callback 배열과 일반 JSON 문자열을 유지했다.
heap 값은 연산 사이 checkpoint 표본이고, RSS는 같은 process의 kernel lifetime high-water다.

| shape | records | raw 배열 bytes | refs 수 | canonical hash 범위(ms) | 관측 최대 RSS(MiB) |
| --- | ---: | ---: | ---: | ---: | ---: |
| minimal 50k | 50,000 | 9,750,001 | 50,000 | 523.15–546.92 | 240.6 |
| exact 16 MiB | 50,000 | 16,777,216 | 50,000 | 562.56–639.54 | 329.2 |
| 128 short refs | 23,865 | 16,777,096 | 3,054,720 | 861.96–913.34 | 350.6 |
| all 20 fields | 43,129 | 16,777,182 | 43,129 | 1095.15–1156.67 | 319.7 |
| 128 refs + 32 tags | 16,194 | 16,776,985 | 2,072,832 | 700.54–800.13 | 344.4 |

최대 RSS process는 baseline 52.2 MiB, input-only 83.4 MiB, lifetime 350.6 MiB였다.
release+GC 후 heapUsed 11.0 MiB / RSS 285.2 MiB로 서로 다르며 이것만으로 leak 여부를 판정하지
않는다. 긴 문자열만으로 객체·참조가 많은 shape의 비용을 대표할 수 없다. true synchronous
heap peak, JSONL read/split, 최종 schema/masking/freeze/write/fsync, runner 및 동시 실행은 미측정이다.

현재 hash만 약 1.1초라는 결과는 기존 bounded reader의 backend 1.5초 / transport 2초 예산을
충족하거나 실패했다는 증거가 아니다. 전체 read/parse/결속·반환 전 검증은 실제 reader로 확인한다.

## Envelope와 다음 구현 결정

raw 배열 budget과 파일 전체 budget을 분리한다. 동일한 **예시** envelope에서 배열 `[]`의
2 bytes를 제외한 overhead는 짧은 identity 919 bytes, 기존 identity 길이 경계를 적용한 ASCII
5,243 bytes, JSON-escape-heavy 25,723 bytes였다. compact JSON에 newline을 쓰면 1 byte가 더해진다.
최종 schema가 아니므로 어느 값도 보편적인 envelope reserve로 쓰지 않는다.

다음 구현은 다음 조건으로 한정한다.

1. 50,000 records / raw 배열 16 MiB와 필드 상한은 잠정 유지한다. 상향 근거는 없다.
   최종 schema의 전체 파일 상한과 copy lifetime은 구현에서 별도 산출·검증한다.
2. 기존 계약이 허용한 stored-market workflow의 실제 child 배열을 관측한다.
   origin/retention metadata 부재만으로 새 권한 체계를 요구하거나 해당 입력을 일괄 차단하지 않는다.
   source 취득·신뢰·원본 파일 완전성은 관측된 소비 배열과 구분해 unavailable로 유지한다.
3. 공식 calendar non-exporting 자료를 새 관측에 연결하지 않는다. 특정 source의 실제 보존 제한이나
   기존 허용 범위가 미해결이면 그 입력에 한해 내용 없는 `retention_unavailable`을 사용한다.
4. 첫 await 전 private copy, 모든 소비 경로, callback 격리, exact child/초기 상태 결속과
   durable write 후 provider 진입을 실제 합성 workflow에서 검증한다.
5. unsupported/redacted/limit/unavailable 입력에 부분 snapshot/hash를 쓰지 않는다. 관측 불가가
   기존 replay 입력 크기의 자동 거절로 바뀌지 않으며 completeInput/comparability를 승격하지 않는다.
6. 최종 구현의 경계·mutation·failure·호환 회귀, 독립 검토, exact-candidate 공식 Linux full과
   자동 코드·보안 검토 및 GitHub 보호 조건을 충족한 뒤 병합한다.

합성 size 통과는 실제 source 권한 판정이 아니다. 이번 실험은 그 권한을 측정하지 않았으며,
특정 실제 dataset의 permission blocker도 확인하지 않았다. 공개 reader/전체 provenance는 후속이다.


## 실제 bound-child producer의 추가 측정

구현 후보 `b58b548f68e0249a8a8bc582273751acbfec7743`에서 같은 합성 입력 3종을 각 fresh process
1회로 순차 측정했다. 실제 workflow의 JSONL read/parse, research manifest, bounded source capture,
masking·versioned hash, 초기/source 파일 write·fsync, 기존 artifact 초기화 및 source index를 포함한다.
clock은 zero-tick 합성 fixture로 provider 호출 0회이며 시장 tick 처리량·reader SLA 시험이 아니다.
새 provider/외부 데이터를 호출하지 않았다.

| shape | records | raw 배열 bytes | 실제 source 파일 bytes | workflow(ms) | 관측 lifetime RSS(MiB) |
| --- | ---: | ---: | ---: | ---: | ---: |
| bytes_16777216 | 50,000 | 16,777,216 | 16,778,386 | 4072.57 | 500.1 |
| dense_short_refs | 23,865 | 16,777,096 | 16,778,266 | 8238.02 | 504.7 |
| dense_all_fields | 43,129 | 16,777,182 | 16,778,352 | 6062.60 | 482.8 |

Node v24.19.0, `--max-old-space-size=1536 --expose-gc` 환경이다. 입력 준비 후 GC를 호출했으며
표의 RSS high-water는 해당 process의 import·합성 JSONL 준비 비용도 포함한다. source artifact의
사후 parse/hash 검증은 표의 workflow 시간과 RSS 관측 뒤 수행했다. 원본 배열/초기 record hash
결속, 파일 상한, recorded 상태와 completeInput=false를 확인했다. 측정 완료 뒤 보존한 세 원본
fixture와 발행 snapshot의 모든 값·순서·presence를 deep equality로 직접 대조하고, 원본의
versioned canonical hash와 발행 contentHash도 일치함을 별도로 확인했다. 이 후속 대조는
위 측정 시간/RSS에 포함하지 않는다.

약 4.1–8.2초의 producer 초기화 시간과 최대 504.7 MiB 관측은 앞의 raw-array hash microbenchmark와
측정 범위가 다르다. 유한한 fixture 3개·1회 관측으로 전체 입력/동시 실행의 메모리 상한이나 SLA를
보장하지 않는다. 공개 reader와 동시 처리 예산은 여전히 후속 검증이며 새 endpoint는 없다.
