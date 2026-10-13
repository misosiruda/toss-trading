# C2-B — 복구·검토·검증 기록

[범위](child-runtime-load-experiment-scope.md), [상세 계약](child-runtime-load-experiment-contract.md)을 따른다.
이 문서는 2026-10-13 신규 기록이며 미복구 과거 로그/문서 또는 PR827의 시험을 C2-B 성공으로 재사용하지 않는다.

## 복구 provenance

- baseline PR827 HEAD `114a1afc8c06fd443da870805b25826f4af5083b`, tree `328c08ad659314aecca1cbb76929e485bf9c0595`.
- 공개 GitHub clone의 Git bundle을 별도 checkout으로 실제 복원해 위 HEAD/tree 일치를 확인했다.
- Library `libfile_1810bfc0ed0c8191a19ee039d15a99cc` v0의
  `toss-c2b-exact-source-recovery-20261013.zip`, 35,390 bytes.
- ZIP SHA256 `8f9f7db800ffa518039cea6125e2f8ad76aa4ae899c652437c6a13c4182ed95b`.
- 소비 노트북에서 공식 다운로드 후 ZIP 및 manifest10개 항목, 전체11멤버를 확인했다.
  source7개 모두 복구 패키지의 과거 digest와 일치했다. 원본 복구 archive는 수정하지 않는다.
- 소스의 원문 일치는 build/실제 child/test 성공 증거가 아니다. 문서3개는 새 작성 및 독립검토 대상이다.

## 노트북 복구 단계 환경

Ubuntu24.04 WSL2, Linux x64, official Node v24.19.0, Linux ext4 전용 checkout이다.
archive SHA256 `14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647`를
[공식 SHASUMS](https://nodejs.org/download/release/v24.19.0/SHASUMS256.txt)와 대조했다.
downloaded executable path의 SHA256은 `bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12`다.
이 값과 ldd/runtime label 기록은 실행 image/native linkage 완전성 증명이 아니다.
시스템 Node/WSL/보안 설정은 변경하지 않았으며 Windows Node 결과로 actual Linux 시험을 대체하지 않는다.

처음 WSL `/tmp`의 작업 사본이 후속 호출에서 사라졌음을 확인했다. 원인은 확정하지 않는다.
기존 Windows bundle/archive를 보존하고 `/var/tmp` 전용 root에 재준비했다.
공식 Library 다운로드 재시도와 Windows workspace 복사를 같은 실행에서 완료했고,
별도 호출에서 ZIP 존재/읽기/hash 및 원문7파일을 다시 확인했다.

## 2026-10-13 집컴 1차 검증 시점의 상태

| 단계 | 실행과 요구 결과 | 현재 상태 |
| --- | --- | --- |
| 신규 독립 설계검토 | 상한/canonical wire/소유 child/정리 실패 및 coverage 한계 검토 | 신규 검토 P1/P2 없음 |
| 복구 소스 build | `npm run build`, exit0 | 노트북 최초 exit2 후 수정; 집컴 Linux 동일 소스 exit0 |
| 실제 및 fault suite | `node --test dist/replay/runtimeLoadExperimentHarness.test.js dist/replay/runtimeLoadExperimentPreparation.test.js dist/replay/runtimeLoadExperimentObservations.test.js` | 집컴 Linux 실제94개 pass, fail0, skip0, exit0 |
| review gate | `npm run check:review`, build/quality/tooling/영향 시험 | 집컴 exit0; 영향 시험128개 pass, fail0, skip0 |
| 독립 구현검토 | 새 source tree와 실제 시험 근거 | 미실행 |
| 최종 전체 gate | `npm run check:merge`, 종료/실패/skip 개수 보존 | 미실행 |
| 원격 검수와 보호 | 게시 exact HEAD 자동 Code/Security, CodeOwner, unresolved thread | 새 C2-B PR 미생성 |

모든 실패 로그와 후속 수정 검증을 별도 보존한다. actual suite의 Linux 아닌 skip은 통과가 아니다.
schema-valid 최대21,335 bytes와 stdout32,768 bytes를 각각 시험하며 최대+1도 거절해야 한다.
실제 child transport 실패와 unit fake lifecycle fault의 범위를 구분한다.
최종 HEAD/base/환경/검증 입력이 바뀌면 해당 결과를 새 후보에 재사용하지 않는다.

첫 Linux build는 `Harness.test.ts`의 비동기 resolver 제어 흐름 추론(TS2349),
`Observations.test.ts`의 assertion 뒤 이미 제외된 union 분기(TS2367) 때문에 exit2였다.
전자는 resolver 배열과0→1개 assertion으로 정리 시작/완료 순서를 유지하고,
후자는 rejected guard를 equality assertion 앞에 놓았다. assertion/timeout/skip은 완화하지 않았다.

새 독립 설계검토는 현재 문서와 복구 소스의 경계를 읽고 actionable P1/P2 없음을 보고했다.
준비 I/O와 전체 elapsed/RSS 비보장은 현재 test-only 범위의 명시적 한계로 인정했으며,
이를 production launcher 보장으로 승격하면 추가 설계가 필요하다. 실제 child 시험 또는 독립 구현검토를
대체한 결과는 아니다. 검토자는 파일을 변경하지 않았고 실제 child를 실행하지 않았다.

사용자의 노트북→집 컴퓨터 안전 인계 지시에 따라 새 장시간 시험을 시작하지 않았다.
노트북 작업은 baseline HEAD에 untracked 소스7개와 새 문서3개이며 commit/push를 하지 않았다.
Library 인계물은 Git bundle, working overlay, 복구 원본 ZIP, 두 build 로그/exit 결과,
환경/파일 manifest와 실제 복원 검증을 함께 보존한다. 노트북 원본 파일도 유지한다.

현재 main 보호는 CodeOwner review와 conversation resolution을 요구한다.
PR826/827은 미병합이며 공식 approving review0이다. 새 C2-B 역시 dependency branch로 병합하지 않는다.
수동 Codex review 또는 Actions 재실행을 요청하지 않는다.

## 집컴 실제 검증과 보존

2026-10-13 06:37–06:54 UTC에 별도 Docker Linux 작업 사본에서 확인했다.
사용자가 직접 설치한 정상 Docker 엔진을 사용했으며 기존 checkout과34개 worktree를 보존했다.
검증 사본은 Windows bind mount가 아닌 ext4 named volume의 `/var/tmp` 아래에 있다.
컨테이너는 비관리자 UID1000으로 실행하며 호스트 자격증명이나 사용자 환경을 마운트하지 않았다.

- 공식 Ubuntu24.04 image digest: `sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55`.
- 실제 runtime: Node v24.19.0, Linux x64. archive와 실행 파일 SHA256은 위 노트북 검증 값과 같다.
- baseline HEAD/tree, tracked 파일1497개 Git blob hash, overlay10개 SHA256과 `git fsck --full`을 확인했다.
- `npm ci --ignore-scripts` exit0. lockfile SHA256은
  `ee2173e37c118c2b18351cf428da6f9c53aadf9cb80d143cad2d6d09f1d7b75d`다.
- `npm run build`: 06:44:22–06:44:35 UTC, exit0.
- 실제 C2-B suite: 06:44:56–06:45:08 UTC,94개 pass, fail0, cancelled0, skip0, todo0, exit0.
- `npm run check:review`: 06:46:19–06:46:46 UTC, exit0.
  build/quality/tooling/영향 시험이 통과했고 영향 시험128개는 모두 pass, fail/skip0이다.
- 각 단계 전후 전체 소스 snapshot SHA256은
  `8237d995ce11dab231ec88fa3e93e0f8c37758c2ffa1d972f47cefef1f862640`으로 같다.
  이 값은 이 검증 기록을 집컴 결과로 갱신하기 전의10개 overlay를 포함한다.
- 실제 transport timeout은 원래10000ms 제한에서 거절·소유 child 종료·root 정리를 확인했다.
  시험 종료 후 실험 child 잔존은0이며 컨테이너 유지용 init/sleep만 남았다.
- 설치 시 기존 lockfile의 npm audit 경고8개(low1, moderate3, high3, critical1)가 출력됐다.
  이 test-only 범위에서 dependency 변경이나 audit fix는 수행하지 않았다.

1차 검증 보존본은 Library `libfile_74e5cd2041248191bfa7aafe99ef57fe` v0,
`toss-c2b-home-validation-stage1-20261013.zip`,8,656,107 bytes다.
ZIP SHA256은 `f10b92e360a82ca640ed1e8871397527bf8de9cf21a298c63c959e3d02cb97d1`이다.
원본 소형 인계 ZIP, 실행 명령·시각·exit·소스 전후 hash, stdout/stderr와 환경 근거를 포함한다.

별도 Linux 소비 volume에서 공식 Library 다운로드 절차로 이 ZIP을 다시 받아
외부36멤버/manifest35항목과 내부 인계37멤버/manifest36항목의 길이·hash·CRC를 확인했다.
기존 checkout을 덮어쓰지 않고 `restore.mjs`로 새 checkout을 만들었으며,
HEAD/tree, tracked1497개, overlay10개와 `git fsck --full`을 다시 확인했다.
Library identity/version metadata도 실제 파일에서 확인했다.
Windows helper의 `os.setxattr` 미지원 실패는 보존했고, Linux 공식 helper 실행은 성공했다.
이 소비 복원에서는 시험을 중복 실행하지 않았다.

이1차 기록은 독립 구현검토나 최종 전체 gate 성공을 미리 주장하지 않는다.
이후 최종 commit의 `check:merge`, 최초 Ready 자동 Code/Security 결과와 보호조건은
해당 PR 및 후속 보존 증거에서 exact HEAD/base와 함께 확인한다.
runtime/dependencies/result/comparability는 계속 unavailable이며
completeRuntime/completeConfiguration/completeInput은 모두 false다.
실거래/provider/production HTTP/receipt 및 기존 A/B/C1/C2-A 구현은 변경하지 않는다.

## 집컴 전체 인계물과 전체 gate 후속 확인

07:00 UTC에 최초 요청한 전체 인계물 Library `libfile_d3964c8991948191a5ff03e27766093c` v0도
공식 다운로드 절차로 집컴의 별도 Linux 소비 경로에 materialize했다.
실제39,609,635 bytes 및 SHA256
`37f34234f1a28af6f6ba4b58fb9cc73cc76a9771e41f00461cf8b6b43185156a`가 지정 값과 일치했다.
ZIP35멤버, manifest34항목의 길이/hash/CRC와 Library metadata를 확인하고,
원본 전체 bundle과 overlay로 또 다른 새 checkout을 복원했다.
정본 HEAD/tree, tracked1497개, overlay10개와 `git fsck --full`이 모두 맞았다.

첫 집컴 전체 gate는 candidate `3b0998aabeb6c7c5e85f25612dd645688b518f4e`,
tree `43d2ce18f4670efa914326962bc47d2da89b400a`,
dependency base `114a1afc8c06fd443da870805b25826f4af5083b`,
main base `26813e50f6c887f56aa4157e91f21d82658543cb`에서 실행했다.
`npm run check:merge`가06:58:48–07:04:20 UTC,331.99초, exit0으로 완료됐다.
build/quality/tooling과 전체5371개 중5338 pass, fail0, cancelled0, skip33, todo0이다.
기존33개 skip은 실제 통과가 아니며 C2-B94개는 모두 실행돼 통과했다.
전후 소스 snapshot SHA256은
`121ada0be8e774fd29936e43671be827553c5ec496d0e23a05f02f049b19ccc1`으로 같다.
이 기록 추가와 문서 실행 권한 제거 뒤 게시할 최종 commit의 전체 gate는 별도 증거로 남긴다.
실험 소스7개와 assertion/timeout/skip/runner 설정은 수정하지 않았다.
