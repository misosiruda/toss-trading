import { basename } from "node:path";

import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { maskSensitiveText, maskSensitiveValue } from "../security/masking.js";
import { PAPER_EXPERIMENT_ATTEMPT_ID_PATTERN } from "../storage/artifactPaths.js";
import { requireExperimentStorage } from "../storage/paperExperimentFilesystem.js";
import { paperExperimentExecutionFacts } from "../storage/paperExperimentExecutionReceipt.js";
import type { PaperExperimentStoreLocation } from "../storage/paperExperimentStore.js";
import { comparePaperExperimentEvidence, readPaperExperimentReviewEvidence, REVIEW_ARTIFACT_PATHS,
  type PaperExperimentReviewEvidence, type ReviewArtifactKey } from "./paperExperimentReviewEvidence.js";

const LIMITATIONS = [
  "Synthetic fixture의 engineering 재현 검토이며 실제 시장·전략·수익성 또는 실거래 적합성의 증거가 아니다.",
  "거래일 calendar, FX, lifecycle와 실제 시장 coverage는 검증하지 않았다.",
  "cashOnly는 동일 초기 현금·평가 tick의 no-trade 기준선으로 비용이 0이다.",
  "equalWeightBuyAndHold와 initialPortfolioBuyAndHold는 비용 0 및 packet 표본 기반 보조 진단이다. 전략과 비용·sampling 동등성을 주장하지 않는다.",
  "단일 fixture의 Sharpe·유의성·우월성·일반화는 결론낼 수 없다. 기존 통계의 null/unavailable 상태를 유지한다.",
  "Hash는 보존 payload의 일치 확인 수단이다. source 사실성·전체 이력·외부 공격자에 대한 인증을 증명하지 않는다.",
  "Execution receipt는 기존 runner가 반환한 bounded 운영 events/warnings/sampling을 보존한다. provider 내부 전체 이력은 포함하지 않는다.",
  "진행 중인지 중단됐는지는 저장 상태만으로 판정하지 않는다. cancel/resume은 미지원이며 retry는 새 attempt다."
] as const;

function proof(artifact: ReviewArtifactKey, field: string) {
  return { artifact: basename(REVIEW_ARTIFACT_PATHS[artifact]), field,
    href: `../../${REVIEW_ARTIFACT_PATHS[artifact]}#${field}` };
}
function stateProof(field: string) {
  return { artifact: "experiment-run.json", field, href: `../../experiment-run.json#${field}` };
}
function derivation(algorithm: string, inputs: ReturnType<typeof proof>[]) { return { algorithm, inputs }; }
function claim<T>(value: T, artifact: ReviewArtifactKey, field: string) { return { value, evidence: proof(artifact, field) }; }

/** Only actual producer fields and bounded row indices receive the path-redaction exemption. */
function isCanonicalReviewReference(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Object.keys(value).length !== 3) return false;
  const { artifact, field, href } = value as { artifact?: unknown; field?: unknown; href?: unknown };
  if (typeof field !== "string") return false;
  const paths: Record<string, string> = { ...REVIEW_ARTIFACT_PATHS, state: "experiment-run.json" };
  const rules: Record<string, RegExp> = {
    state: /^(?:\/(?:status|terminationReason|runtimeIdentity|inputHash))?$/,
    input: /^(?:\/(?:question|configuration|costModel|evaluation\/reviewQuestions))?$/,
    source: /^$/, manifest: /^$/, metadata: /^$/, progress: /^$/,
    report: /^(?:\/(?:costSummary|benchmarks))?$/,
    packets: /^(?:\/(?:0|[1-9]\d{0,3})(?:\/generatedAt)?)?$/,
    decisions: /^(?:\/(?:0|[1-9]\d{0,3})\/(?:decisionHash|packetHash|decisions\/(?:0|[1-9]\d{0,3})))?$/,
    riskDecisions: /^(?:\/(?:0|[1-9]\d{0,3}))?$/,
    trades: /^(?:\/(?:0|[1-9]\d{0,3}))?$/,
    timeline: /^(?:\/(?:0|[1-9]\d{0,3})\/portfolio)?$/,
    execution: /^(?:\/(?:auditEvents(?:\/(?:0|[1-9]\d{0,3}))?|samplingDecisions|warnings))?$/
  };
  const entry = Object.entries(paths).find(([, path]) => basename(path) === artifact);
  return entry !== undefined && rules[entry[0]]!.test(field) && href === "../../" + entry[1] + "#" + field;
}

/** Presentation redaction only: raw values remain in semantic comparison and source artifacts. */
export function safePaperExperimentReviewValue<T>(value: T): T {
  // The labeled-key grammar accepts ASCII letters/digits plus dot, underscore,
  // hyphen and horizontal whitespace. Use the same normalization for every route.
  function normalizeLabel(key: string): string {
    return key.replace(/\\+u([0-9A-Fa-f]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\+t/g, "\t").replace(/[._ \t-]/g, "");
  }
  function privateLabel(key: string): boolean {
    const normalized = normalizeLabel(key);
    return /(?:password|apikey|account|order(?:id|number|no)|execution(?:id|number|no))/i.test(normalized)
      || maskSensitiveValue(normalized, null) !== null;
  }
  function visit(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(visit);
    if (isCanonicalReviewReference(item)) return item;
    if (item !== null && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, nested]) =>
      [redact(key), privateLabel(key) ? "[비공개]" : visit(nested)]));
    return typeof item === "string" ? redact(item) : item;
  }
  function redact(text: string) {
    const cleaned = maskSensitiveText(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
    // Scan labels separately: a non-sensitive URL/label must not swallow a later credential.
    // Decode only key escapes for classification; do not decode or mutate safe source text.
    const labels = /(?:\\*["'])?((?:[A-Za-z]|\\+u[0-9A-Fa-f]{4})(?:[A-Za-z0-9_. \t-]|\\+u[0-9A-Fa-f]{4}|\\+t)*)(?:\\*["'])?\s*[:=]\s*/g;
    const quotedOrClause = /^(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|(?:\\(?:\r\n|[\s\S])|[^,;\r\n])+)/;
    // Headers include schemes and multiple cookies, including quoted/continued lines.
    const headerValue = /^(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\\(?:\r\n|[\s\S])|[^\r\n])*/;
    let masked = "", cursor = 0;
    for (let match = labels.exec(cleaned); match !== null; match = labels.exec(cleaned)) {
      if (!privateLabel(match[1]!)) continue;
      const remainder = cleaned.slice(labels.lastIndex);
      // Encoded quoted values may contain delimiters and multiple escaping levels.
      // Conservatively redact the logical line instead of guessing a closing quote.
      const span = /(?:authorization|cookie)/i.test(normalizeLabel(match[1]!)) || /^\\+["']/.test(remainder)
        ? headerValue : quotedOrClause;
      const end = labels.lastIndex + (span.exec(remainder)?.[0].length ?? 0);
      masked += cleaned.slice(cursor, match.index) + "[비공개]";
      cursor = end; labels.lastIndex = end;
    }
    return (masked + cleaned.slice(cursor))
      .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,})\b/g, "[비공개]")
      .replace(/"(?:[A-Za-z]:[\\/]|\\\\|\/(?!\/)|(?:https?|file):\/\/)(?:\\[\s\S]|[^"\\])*"|'(?:[A-Za-z]:[\\/]|\\\\|\/(?!\/)|(?:https?|file):\/\/)(?:\\[\s\S]|[^'\\])*'/gi, "[경로·주소 비공개]")
      .replace(/(?:https?|file):\/\/[^\s<>"']+/gi, "[외부 주소 비공개]")
      .replace(/(?:[A-Za-z]:[\\/]|\\\\)(?:\\(?:\r\n|[\s\S])|[^,;\r\n<>"'])+|(?<![A-Za-z0-9_.-])\/(?!\/)(?:\\(?:\r\n|[\s\S])|[^,;\r\n<>"'])+/g, "[로컬 경로 비공개]");
  }
  return visit(value) as T;
}

function projectEvidence(evidence: PaperExperimentReviewEvidence) {
  const { inspection, verified } = evidence;
  const input = inspection.input?.normalizedInput;
  const report = verified ? evidence.report : null;
  const receipt = verified ? evidence.execution : null;
  const facts = receipt ? paperExperimentExecutionFacts(receipt) : null;
  const quality = !verified ? "unavailable" : facts!.providerFailureCount > 0 ? "provider_failure"
    : inspection.input?.preflight.status === "insufficient_data" ? "insufficient_data" : "usable_fixture";
  const decisions = verified ? evidence.decisions!.flatMap((decision, decisionIndex) => decision.decisions.map((item, itemIndex) => {
    const packetIndex = evidence.packets!.findIndex((packet) => packet.packetId === decision.packetId);
    const riskRows = evidence.risks!.flatMap((risk, index) => risk.packetId === decision.packetId
      && (risk.symbol === undefined || risk.symbol === item.symbol) ? [{ ...risk, evidence: proof("riskDecisions", `/${index}`) }] : []);
    const trades = evidence.trades!.flatMap((trade, index) => riskRows.some((risk) => risk.riskDecisionId === trade.decisionId)
      ? [{ ...trade, evidence: proof("trades", `/${index}`) }] : []);
    const packet = evidence.packets![packetIndex]!;
    return { decisionHash: decision.decisionHash ?? null, packetHash: decision.packetHash ?? null,
      packetId: decision.packetId, simulatedAt: packet.generatedAt, item,
      evidence: proof("decisions", `/${decisionIndex}/decisions/${itemIndex}`),
      decisionHashEvidence: proof("decisions", `/${decisionIndex}/decisionHash`),
      packetHashEvidence: decision.packetHash === undefined ? null : proof("decisions", `/${decisionIndex}/packetHash`),
      packet: proof("packets", `/${packetIndex}`),
      simulatedAtEvidence: proof("packets", `/${packetIndex}/generatedAt`), risk: riskRows, trades,
      portfolio: evidence.timeline!.flatMap((row, index) => row.simulatedAt === packet.generatedAt
        ? [proof("timeline", `/${index}/portfolio`)] : []) };
  })) : null;
  return {
    schemaVersion: "paper_experiment_review.v1" as const, language: "ko" as const,
    title: "고정 fixture paper 실험 근거 검토",
    attemptId: inspection.state?.attemptId ?? null,
    execution: { status: verified ? "completed" : inspection.status === "failed" ? "failed" : "incomplete",
      storedStatus: inspection.storedStatus, integrity: verified ? "verified" : "unverified",
      errorCode: inspection.errorCode ?? (!inspection.state?.executionReceiptRequired ? "EXECUTION_RECEIPT_REQUIRED"
        : evidence.artifacts.find((artifact) => artifact.errorCode)?.errorCode ?? (!verified ? "INCOMPLETE_EVIDENCE" : null)),
      terminationReason: inspection.state?.terminationReason ?? null,
      notice: "completed는 실행 기록의 완료이며 연구 품질·투자 성공을 뜻하지 않는다.",
      storedStatusEvidence: stateProof("/status"), terminationReasonEvidence: stateProof("/terminationReason"),
      derivation: derivation("readPaperExperimentReviewEvidence/inspectPaperExperimentAttempt",
        [stateProof(""), ...Object.keys(REVIEW_ARTIFACT_PATHS).map((key) => proof(key as ReviewArtifactKey, ""))]) },
    inputEligibility: { status: inspection.input?.preflight.status ?? "unavailable",
      integrity: inspection.input ? "verified" : "unavailable", inputHash: inspection.input?.inputHash ?? null,
      runtimeIdentity: inspection.state?.runtimeIdentity ?? null,
      runtimeIdentityEvidence: stateProof("/runtimeIdentity"), inputHashEvidence: stateProof("/inputHash"),
      derivation: derivation("verifyExperimentInput/parsePaperExperimentInput", [proof("input", ""), proof("source", ""), stateProof("")]) },
    researchQuality: { status: quality, providerFailureCount: facts?.providerFailureCount ?? null,
      noCandidateTickCount: facts?.noCandidateTickCount ?? null, decisionRejectedEventCount: facts?.decisionRejectedEventCount ?? null,
      eventCountsEvidence: facts ? proof("execution", "/auditEvents") : null,
      eventCountsDerivation: derivation("paperExperimentExecutionFacts", [proof("execution", "/auditEvents")]),
      derivation: derivation("projectEvidence/paperExperimentExecutionFacts/parsePaperExperimentInput",
        [stateProof(""), ...Object.keys(REVIEW_ARTIFACT_PATHS).map((key) => proof(key as ReviewArtifactKey, ""))]),
      statisticalConclusion: "판단 불가", investmentConclusion: "판단 불가" },
    question: input ? claim(input.question, "input", "/question") : null,
    scope: input ? claim({ mode: input.mode, fixture: input.fixture, provider: input.provider,
      clock: input.configuration.clock, evaluation: input.evaluation, universe: input.universe,
      coverageDescription: input.source.coverageDescription, sourceKind: input.source.kind,
      sourceRefs: ["fixture:paper-experiment.v1"] }, "input", "") : null,
    coverage: inspection.input ? { ...claim(inspection.input.preflight, "input", ""),
      derivation: derivation("parsePaperExperimentInput", [proof("input", "")]) } : null,
    policy: input ? claim(input.configuration, "input", "/configuration") : null,
    costModel: input ? claim(input.costModel, "input", "/costModel") : null,
    manifest: verified ? claim(evidence.manifest, "manifest", "") : null,
    actions: decisions,
    outcomes: report ? claim({ replay: report.replaySummary, decision: report.decisionOutcome, risk: report.riskSummary,
      sampling: report.samplingSummary, sourceWarnings: report.sourceWarningSummary }, "report", "") : null,
    operationalEvidence: receipt ? { facts: { ...claim(facts, "execution", "/auditEvents"),
      derivation: derivation("paperExperimentExecutionFacts", [proof("execution", "/auditEvents")]) },
      events: receipt.auditEvents.map((event, index) => claim(event, "execution", `/auditEvents/${index}`)),
      sampling: claim(receipt.samplingDecisions, "execution", "/samplingDecisions"),
      warnings: claim(receipt.warnings, "execution", "/warnings") } : null,
    costs: report ? claim(report.costSummary, "report", "/costSummary") : null,
    benchmarks: report ? claim(report.benchmarks, "report", "/benchmarks") : null,
    statistics: report ? claim({ advancedPerformance: report.advancedPerformance, sharpeValidation: report.sharpeValidation }, "report", "") : null,
    partialEvidence: { notice: "partial은 schema로 읽힌 일부 보존 파일이다. 완료된 결과·전체 건수의 증거로 사용하지 않는다.",
      artifacts: evidence.artifacts,
      progress: !verified && evidence.progress ? claim({ storedStatus: evidence.progress.status,
        tickIndex: evidence.progress.tickIndex, completedTickCount: evidence.progress.completedTickCount,
        simulatedAt: evidence.progress.simulatedAt }, "progress", "") : null },
    observations: verified ? ["고정 입력과 terminal inventory·execution receipt의 결속을 확인했다.",
      quality === "provider_failure" ? "보존된 provider 실패 event가 있다. 실행 완료를 유효한 연구 결과로 읽지 않는다."
        : quality === "insufficient_data" ? "입력 coverage gap이 있다. source의 충분성을 주장하지 않는다."
          : "이 fixture 범위의 결과 근거를 읽을 수 있다. 실제 시장 또는 통계 검증은 남아 있다."]
      : ["완료 무결성을 확인하지 못했다. 결과·비용·기준선을 0으로 대체하지 않고 사용할 수 없음으로 남긴다."],
    limitations: LIMITATIONS,
    nextQuestions: input ? claim(input.evaluation.reviewQuestions, "input", "/evaluation/reviewQuestions") : null,
    semanticProjectionVersion: "paper_experiment_semantic.v1",
    evidenceDigest: verified ? createReplayResearchHash(inspection.state!.artifactInventory) : null
  };
}

export async function createPaperExperimentReview(location: PaperExperimentStoreLocation, attemptId: string,
  compare?: { location: PaperExperimentStoreLocation; attemptId: string }) {
  requireExperimentStorage(PAPER_EXPERIMENT_ATTEMPT_ID_PATTERN.test(attemptId)
    && (compare === undefined || PAPER_EXPERIMENT_ATTEMPT_ID_PATTERN.test(compare.attemptId)), "INVALID_REQUEST");
  const evidence = await readPaperExperimentReviewEvidence(location, attemptId);
  const comparison = compare ? { attemptId: compare.attemptId,
    ...comparePaperExperimentEvidence(evidence, await readPaperExperimentReviewEvidence(compare.location, compare.attemptId)),
    notice: "같은 입력·runtime의 engineering 재현 비교다. 다른 조건의 성과 순위는 제공하지 않는다." } : null;
  // Do not redact canonical references that we generated, but redact every source-supplied value.
  const projected = projectEvidence(evidence);
  return safePaperExperimentReviewValue({ ...projected, comparison });
}
export type PaperExperimentReview = Awaited<ReturnType<typeof createPaperExperimentReview>>;

function markdownText(value: unknown): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#+.!|~-]/g, "\\$&").replace(/\r?\n/g, "<br>");
}
/** Korean labels with escaped data. Only code-generated fixed artifact references become links. */
export function renderPaperExperimentReviewMarkdown(input: PaperExperimentReview): string {
  const review = safePaperExperimentReviewValue(input);
  const lines = [`# ${review.title}`, "", "## 핵심 확인", "",
    `- 질문: ${markdownText(review.question?.value ?? "사용할 수 없음")}`,
    `- attempt: ${markdownText(review.attemptId ?? "사용할 수 없음")}`,
    `- 실행: ${markdownText(review.execution.status)} / 저장 상태: ${markdownText(review.execution.storedStatus)} / 무결성: ${review.execution.integrity}`,
    `- 입력 적격성: ${review.inputEligibility.status} / 연구 품질: ${review.researchQuality.status}`,
    `- inputHash: ${markdownText(review.inputEligibility.inputHash)}`];
  const outcomes = review.outcomes?.value;
  if (outcomes && review.costs && review.benchmarks) lines.push(
    `- 기존 보고서: packet ${outcomes.replay.packetCount}, decision ${outcomes.replay.decisionRecordCount}, paper fill ${outcomes.replay.tradeCount}, Risk 거절 ${outcomes.risk.rejectedCount}, sampling skip ${outcomes.sampling.decisionsSkipped}`,
    `- 기존 비용 합계: ${review.costs.value.totalCostKrw} KRW / cashOnly 최종 가상 자산: ${review.benchmarks.value.cashOnly.finalNetWorthKrw} KRW`,
    `- 보존 event: provider 실패 ${review.researchQuality.providerFailureCount}, no candidate ${review.researchQuality.noCandidateTickCount}`);
  else lines.push("- 결과·비용·기준선: 사용할 수 없음 (null). 누락 근거를 0으로 바꾸지 않는다.");
  lines.push("", review.execution.notice, "상세 구조와 모든 값은 함께 생성된 [review.json](review.json)에 보존한다.", "");
  function ref(evidence: { artifact: string; field: string }): string {
    const path = [...Object.values(REVIEW_ARTIFACT_PATHS), "experiment-run.json"].find((path) => basename(path) === evidence.artifact);
    return isCanonicalReviewReference(evidence)
      ? `[${evidence.artifact} ${evidence.field}](../../${path}#${evidence.field})` : "근거 주소 없음";
  }
  const data = (value: unknown) => markdownText(JSON.stringify(value));
  function section(title: string) { lines.push(`## ${title}`, ""); }
  function field(label: string, value: unknown, evidence?: { artifact: string; field: string }) {
    lines.push(`- ${label}: ${data(value)}${evidence ? ` · 근거: ${ref(evidence)}` : ""}`);
  }
  field("inputHash 근거", review.inputEligibility.inputHash, review.inputEligibility.inputHashEvidence);
  field("저장 상태 근거", review.execution.storedStatus, review.execution.storedStatusEvidence);
  field("입력 적격성 검증", review.inputEligibility.derivation);
  field("실행 무결성 검증", review.execution.derivation);
  field("연구 품질 분류", review.researchQuality.derivation);
  if (outcomes) lines.push(`요약 근거: ${ref(review.outcomes!.evidence)}, ${ref(review.costs!.evidence)}, ${ref(review.benchmarks!.evidence)}`, "");
  section("범위·source·coverage");
  field("범위", review.scope?.value ?? null, review.scope?.evidence);
  field("입력 적격성·tick별 coverage", review.coverage?.value ?? null, review.coverage?.evidence);
  field("coverage 산출 출처", review.coverage?.derivation ?? null);
  field("runtime 기준", review.inputEligibility.runtimeIdentity, review.inputEligibility.runtimeIdentityEvidence);
  lines.push(""); section("고정 정책과 비용 모델");
  lines.push("정책의 null은 해당 설정의 미사용 상태일 수 있다. 결과의 null과 구분하며 기본값을 추정하지 않는다.");
  for (const [key, value] of Object.entries(review.policy?.value ?? {})) field(key, value, review.policy!.evidence);
  field("비용 모델", review.costModel?.value ?? null, review.costModel?.evidence);
  field("manifest", review.manifest?.value ?? null, review.manifest?.evidence);
  lines.push(""); section("행동·거절·HOLD와 결과 근거");
  if (review.actions === null) lines.push("사용할 수 없음 (null)");
  else if (!review.actions.length) lines.push("검증된 decision 항목이 없다. 실패·skip event는 다음 절에서 확인한다.");
  for (const [index, action] of (review.actions ?? []).entries()) {
    lines.push(`### 행동 ${index + 1}: ${markdownText(action.item.action)} ${markdownText(action.item.symbol)}`, "");
    field("시뮬레이션 시각", action.simulatedAt, action.simulatedAtEvidence);
    field("decisionHash", action.decisionHash, action.decisionHashEvidence);
    field("packetHash", action.packetHash, action.packetHashEvidence ?? undefined);
    field("판단·dataRefs", action.item, action.evidence);
    for (const risk of action.risk) { const { evidence, ...value } = risk; field("Risk 판정", value, evidence); }
    for (const trade of action.trades) { const { evidence, ...value } = trade; field("paper fill·비용", value, evidence); }
    if (!action.trades.length) lines.push("- 연결된 paper fill 없음. HOLD·Risk·운영 event의 근거를 함께 읽는다.");
    lines.push(`- portfolio 근거: ${action.portfolio.map(ref).join(", ")}`, "");
  }
  section("skip·no candidate·provider 실패 근거");
  field("기존 결과 요약", outcomes ?? null, review.outcomes?.evidence);
  field("운영 event 분류", review.operationalEvidence?.facts.value ?? null, review.operationalEvidence?.facts.evidence);
  field("event 건수 산출 출처", review.operationalEvidence?.facts.derivation ?? null);
  for (const event of review.operationalEvidence?.events ?? []) field("보존 event", event.value, event.evidence);
  field("sampling", review.operationalEvidence?.sampling.value ?? null, review.operationalEvidence?.sampling.evidence);
  field("warnings", review.operationalEvidence?.warnings.value ?? null, review.operationalEvidence?.warnings.evidence);
  lines.push(""); section("기존 비용·기준선·통계");
  field("비용 breakdown", review.costs?.value ?? null, review.costs?.evidence);
  for (const [key, value] of Object.entries(review.benchmarks?.value ?? {})) field(key, value, review.benchmarks!.evidence);
  field("기존 통계", review.statistics?.value ?? null, review.statistics?.evidence);
  lines.push(""); section("반복 비교"); field("동일 조건 확인", review.comparison);
  lines.push(""); section("부분 근거와 오류");
  field("오류", review.execution.errorCode); lines.push(review.partialEvidence.notice);
  for (const artifact of review.partialEvidence.artifacts) field(artifact.artifact, { status: artifact.status, recordCount: artifact.recordCount, errorCode: artifact.errorCode });
  field("부분 progress", review.partialEvidence.progress?.value ?? null, review.partialEvidence.progress?.evidence);
  lines.push(""); section("관찰과 한계");
  for (const observation of review.observations) lines.push(`- ${markdownText(observation)}`);
  for (const limitation of review.limitations) lines.push(`- ${markdownText(limitation)}`);
  lines.push(""); section("다음 검증 질문");
  field("입력에 보존한 질문", review.nextQuestions?.value ?? null, review.nextQuestions?.evidence);
  return lines.join("\n") + "\n";
}
