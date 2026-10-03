# UX-03 구현 범위와 검증 경계

기준 main `8a33ef4` (PR #801). 최종 검증 head·결과는 PR의 검증 기록에서 확인한다.

## 구현

- 목록의 새 실험은 `/dashboard/experiments/new`로 연결한다. 기존 builder·policy·bucket·상세 경로를 유지한다.
- 세 단계는 built-in riskProfile, 시장 **배분**과 historical replay 조건을 입력받는다. 기간·source·자본은 사용자가 입력하며 기존 PolicyBuilder 고정 config를 재사용하지 않는다.
- 판단 provider는 `dry_run_fixture`다. source 종류는 `unknown`, 가용성은 미검증이며 provider로 추론하지 않는다. 비용·benchmark는 backend가 허용한 기본값만 요청한다.
- `/dashboard/experiments/validate` BFF는 별도 `paper-simulation-validate` intent, 명시적 동일 Origin, JSON object와 32,768-byte streamed body 제한을 적용한다. 읽기 전용 검증에는 mutation token을 전달하지 않는다.
- raw 입력에서 숫자·enum의 typed candidate를 만들 뿐, 날짜·횟수·risk·비용 등 backend 실효값은 계산하지 않는다. 현재 입력 identity와 편집 version에 일치하는 성공 응답만 표시한다.
- 편집 즉시 기존 결과를 무효화하고 요청을 abort한다. version 검사로 취소를 무시한 늦은 응답도 채택하지 않는다. 검증 중 중복 click과 생성 중 click/Enter는 ref guard로 차단한다.
- 확인 화면은 7개 묶음, 중요 차이·제약, 전체 requested/effective/notices의 native details로 구성한다. 새 notice code는 기본 화면에도 표시한다.
- 생성에는 기존 guarded create BFF와 검증한 원본 typed body를 그대로 한 번 사용한다. token은 React 메모리에서 header에만 전달한다.
- sessionStorage에는 raw 입력과 재전송 방지 표식/정확한 접수 ID만 보존한다. token과 검증 성공 자격은 보존하지 않는다. reload는 재검증이 필요하다. 생성 응답 불확실·이탈 후에는 POST를 자동 재전송하지 않는다. ID가 없으면 추측하지 않고 목록으로 안내한다.
- 확실한 400/401/403/409 및 admission-failed 503은 값을 보존하고 재검증을 요구한다. timeout·네트워크·malformed/기타 응답은 불확실 상태다.
- 접수된 `simulationRunId=batchId`는 기존 상세 URL과 GET query에 그대로 사용한다. 상세 projection은 accepted-only unknown, runner failure, missing/invalid/unavailable과 wrapper 실패를 구분하며 child 결과와 batch 관측을 독립 표시한다. 새 조회는 GET만 수행한다.

## 검증

새 브라우저 suite는 `npm --prefix apps/dashboard run test:e2e:experiment-wizard`로 실행한다.
root backend를 build한 뒤 고립된 합성 KR/US snapshot·fixture 판단·실제 기존 runner를 사용한다.
1440×1000 / 1024×900 / 390×844에서 validation 무변경, 요청·실효·manifest 일치, 단일 POST,
정확한 ID 상세, 오류·경합·history/reload, keyboard/axe/overflow를 확인한다.
추적·screenshot은 test 결과 폴더이며 실제 credentials나 시장 데이터는 사용하지 않는다.
기존 dashboard 전체 UI suite와 app lint/unit/type/default build, root 표준 전체 gate도 별도 완료 조건이다.

2026-10-03 노트북 Windows Node 22.15에서는 같은 observation file의 `lstat.dev=0`과
열린 descriptor의 `fstat.dev=3163395652` 불일치가 관측되어 기존 backend reader가
`unavailable`을 반환했다. 이 UI PR은 그 filesystem 보호 검사를 완화하지 않는다.
실제 관측 계약의 integration은 승인된 WSL UID1000·Linux Node24·native `/tmp` filesystem에서
실행하고 노트북의 sandboxed headless Chrome으로 검증한다. Windows에서도 UI가 이 판독 불가를
runner 실패·접수 완료로 바꾸지 않는 점은 유지한다. Linux 결과를 Windows 관측 통과로 보고하지 않는다.

범위 밖: live/외부 유료 AI/provider credential, 새 runner·정규화·관측 저장 계약,
PortfolioPolicy 직접 실행, 선택 비용·benchmark·universe 확장, 취소·재개·자동 retry와 상세 전면 개편.
