# C2-C5 검증 기록

## 설계와 독립 검토

기준 main은 eda4e16456e5aaf795bdc0db86b69fe41093f4b5다. Producer 이전 독립 설계 검토에서
P1/P2 지적 없음. 유한 case39개+hostile env1회, LF 포함 최대 wire1276bytes,
rejected457bytes와 input/emit digest를 독립 계산해 일치 확인했다.

구현 commit 1ed3c6eb168848470806be351524b074bf5d6c29에 대한 읽기 전용 독립 구현 검토에서도
P1/P2 지적 없음. 같은 child의 compiler→Program→emit→직접 공급→실제 import 연결,
고정 반례, canonical protocol, 종료·보존·할당 차단을 검토했다. 검토자가 별도 시험을
중복 실행하지 않았으며 전체 merge gate와 GitHub 보호조건은 이 판정에 포함하지 않는다.

## 실제 Linux 영향 검증

2026-10-14, 기존 허용 WSL Toss-C2C3-Lab-20261014의 /var/tmp/toss-c2c5/repo에서
Node v24.19.0 Linux x64, TypeScript 5.9.3으로 npm run check:review를 실행했다.
mock/off/paper_only 및 AI 비활성 환경을 고정했다. source, lock, Node hash와 환경,
stdout/stderr, 시작·종료 시각, source-before/after를 실행별 evidence에 보존했다.

| 실행 | 결과 | 보존 및 조치 |
| --- | --- | --- |
| review-01 | build TS2322 실패, child 미실행 | 실제 객체 동일성 guard 뒤 boolean literal 타입을 명시; 원본 소스와 실패 로그 유지 |
| review-02 | 83 pass / 0 fail / 0 skip | build·quality·tooling·영향 시험 통과; 입력 소스 불변 |
| review-03 | 83 pass / 0 fail / 0 skip | wire 밖 PID/root/terminal 증거를 추가한 현재 구현 재검증; 입력 소스 불변 |

review-03은 08:07:47–08:08:10 UTC에 실행했다. source inventory SHA-256은
9b048930a8721c2adc3020fe7d16f2681bc9b55657fbde95946eee801f5b8504다.
실제 child40개는 observed4/counterexample5/collected rejected30/예정된 restore_failure1이며
40개 모두 spawn과 close를 관측했다. 마지막 restore_failure는 첫 COMPILER_DIAGNOSTIC과
outputRestoration=unconfirmed를 함께 유지하고 harness를 중단한다. 이를 collected 성공으로
승격하지 않는다. 40개 root의 280개 파일을 로그와 재해시 비교했다.

일반/cache/cap callback은 실제5/2/8로 동결 기대값과 일치했다. bootstrap은30,202bytes,
SHA-256 07c1d54868b8f67294ada3445001875ef1bc17c06d1bade52a4c08df1cc01b2d다.
root는 자동 삭제하지 않으며 실행별 준비/reader/디렉터리 교체 시험 root도 별도 manifest에 남긴다.
시험 실패·assertion·timeout·기존 skip은 완화하지 않았다. runtime/dependencies/result/comparability는
unavailable이며 completeRuntime/Configuration/Input은 false다.

## 최종 후보 검증과 보존

공개 후보의 정확한 HEAD/tree에서 실행한 check:merge 결과와 최초 Ready 자동 Code/Security,
현재 보호조건 및 실제 병합 결과는 PR 검증란과 소스 외부 완료 기록에 연결한다. 영향 검증이나
읽기 전용 독립 검토를 전체 gate 통과로 대체하지 않는다. 같은 후보의 full 통과는 중복 실행하지 않는다.
소스·Git bundle·환경·실행 로그·root manifest는 보존하고 별도 소비 경로에서 실제 checkout을 복원한다.

기존 C2-C2/C2-C3 보관6개는 원본 hash/멤버와 새 로컬 checkout3개 복원만 완료했다.
공식 Library helper의 prepare_uploads unavailable로 upload 및 Library 왕복0이며 원본·refs를 보존한다.
이 차단과 C2-C5 로컬 복원은 별도 상태다. 지원 흐름에 변화가 없으면 실패한 경로를 재시도하거나
다른 전송 API로 우회하지 않는다. Library 보관 완료를 주장하지 않는다.
