# 연구 계약과 고정 결과

재현 가능한 평가 규칙과 특정 입력·설정에서 관찰한 결과를 분리한다. 연구 확장 구현 계획은 [plans](../plans/README.md)에 있다.

## 평가 protocol과 사전 등록

- [Bucket validation protocol](protocols/strategy-bucket-validation-protocol.md)
- [Calendar/FX contract](protocols/replay-calendar-fx-contract.md)
- [Sharpe validation](protocols/sharpe-statistical-validation-contract.md)
- [CPCV/PBO](protocols/cpcv-pbo-validation-contract.md)
- [Triple barrier](protocols/triple-barrier-label-contract.md)
- Evidence expansion: [source preregistration](protocols/validation-role-regime-evidence-expansion-source-preregistration.md), [target policy](protocols/validation-role-regime-evidence-expansion-target-policy.md)

## 고정된 실험 결과와 진단

- Bucket validation: [smoke](results/strategy-bucket-validation-smoke-results.md), [research](results/strategy-bucket-validation-research-results.md), [candidate scope audit](results/strategy-preset-candidate-scope-audit.md)
- Role/regime: [feasibility](results/validation-split-regime-feasibility-results.md), [replay smoke](results/validation-role-regime-replay-smoke-results.md)
- Cost/liquidity: [cost revalidation](results/short-intraday-cost-revalidation-results.md), [liquidity stress](results/short-term-liquidity-stress-results.md), [scoped stress](results/short-term-scoped-liquidity-stress-results.md), [spread/impact sensitivity](results/short-term-spread-impact-sensitivity-results.md)
- [Historical replay diagnostic](results/historical-replay-diagnostic-brief.md)
- [Quant research review](reviews/quant-research-paper-simulation-review.md): 문제 분석과 개선 후보의 원래 맥락

결과는 문서가 명시한 source, cutoff, policy, fixture와 표본 조건에서만 해석한다.
파일 이동은 수치, 통계 준비도, strategy 판정 또는 source trust를 변경하지 않는다.

CLI/test 입력인 `historical-universe*.json` 4개는 기존 `docs/` root 경로를 유지한다.
[전체 문서 안내](../README.md)에서 제품·운영·연구의 관계를 확인한다.
