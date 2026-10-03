"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { acceptedSimulationId, emptySimulationDraft, readValidation, typedCandidate, type SimulationDraft, type SimulationValidation } from "@/lib/simulationCandidate";
import { WorkspaceNavigation } from "../../ExperimentList";
import shell from "../../ExperimentList.module.css";
import styles from "./ExperimentWizard.module.css";

const DRAFT_KEY = "paper-experiment-draft-v1";
const ADMISSION_KEY = "paper-experiment-admission-v1";
const STEPS = ["전략·범위", "데이터·실행 조건", "검증·확인"];
type Receipt = { version: number; body: string; validation: SimulationValidation };
type Phase = "idle" | "validating" | "submitting" | "unknown" | "accepted";

export function ExperimentWizard() {
  const router = useRouter();
  const search = useSearchParams();
  const step = search.get("step") === "2" ? 2 : search.get("step") === "3" ? 3 : 1;
  const [draft, setDraft] = useState<SimulationDraft>(emptySimulationDraft);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [message, setMessage] = useState("");
  const [token, setToken] = useState("");
  const [acceptedId, setAcceptedId] = useState<string | null>(null);
  const version = useRef(0);
  const validating = useRef(false);
  const submitted = useRef(false);
  const alive = useRef(false);
  const navigationIntent = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const candidate = typedCandidate(draft);
  const body = candidate ? JSON.stringify(candidate) : "";
  const currentReceipt = receipt?.version === version.current && receipt.body === body ? receipt : null;

  useEffect(() => {
    alive.current = true;
    try {
      // Restore the admission barrier before parsing an independently corruptible draft.
      const admission = sessionStorage.getItem(ADMISSION_KEY);
      if (admission) {
        submitted.current = true;
        const knownId = /^paper_sim_\d{17}_[A-Za-z0-9_-]{1,32}(?![\s\S])/.test(admission) ? admission : null;
        setAcceptedId(knownId);
        setPhase(knownId ? "accepted" : "unknown");
        setMessage(knownId ? "이 탭의 이전 요청은 접수됐습니다. 같은 ID의 상세를 조회하세요." : "이전에 보낸 생성 요청의 결과는 미확인입니다. 재전송하지 말고 실험 목록에서 저장된 상태를 확인하세요.");
      }
      const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null");
      if (saved && typeof saved === "object" && Object.keys(emptySimulationDraft).every(key => typeof saved[key] === "string")) {
        // Restore raw input only; validation credentials never survive a mount.
        setDraft(Object.fromEntries(Object.keys(emptySimulationDraft).map(key => [key, saved[key]])) as unknown as SimulationDraft);
      }
    } catch { /* Input remains usable when storage is unavailable. Admission fails closed below. */ }
    setReady(true);
    return () => { alive.current = false; version.current += 1; controller.current?.abort(); };
  }, []);

  useEffect(() => { heading.current?.focus({ preventScroll: false }); }, [step]);

  useEffect(() => {
    const { origin, pathname } = window.location;
    const onPopState = () => {
      if (window.location.origin !== origin || window.location.pathname !== pathname) navigationIntent.current += 1;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function rememberNavigation(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download") || (anchor.target && anchor.target.toLowerCase() !== "_self")) return;
    const destination = new URL(anchor.href);
    const current = new URL(window.location.href);
    if (!["http:", "https:"].includes(destination.protocol)) return;
    if (destination.origin === current.origin && destination.pathname === current.pathname && destination.search === current.search) return;
    navigationIntent.current += 1;
  }

  function edit<K extends keyof SimulationDraft>(key: K, value: SimulationDraft[K]) {
    if (submitted.current) return;
    version.current += 1;
    controller.current?.abort();
    validating.current = false;
    setReceipt(null);
    if (!submitted.current) { setPhase("idle"); setMessage("입력 변경됨 · 다시 검증하세요."); }
    const next = { ...draft, [key]: value };
    setDraft(next);
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next)); } catch { /* No credentials in draft. */ }
  }
  function go(next: number) {
    const url = new URL(window.location.href);
    url.searchParams.set("step", String(next));
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
  }
  async function validate() {
    if (!candidate || validating.current || submitted.current) return;
    const requestVersion = version.current;
    const requestBody = body;
    validating.current = true;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 15_000);
    setPhase("validating"); setReceipt(null); setMessage("입력 조건을 검증하고 있어요.");
    try {
      const response = await fetch("/dashboard/experiments/validate", {
        method: "POST", headers: { "content-type": "application/json", "x-toss-trading-dashboard-intent": "paper-simulation-validate" }, body: requestBody, signal: abort.signal
      });
      const payload: unknown = await response.json();
      if (!alive.current || version.current !== requestVersion) return;
      if (!response.ok) throw new Error(errorMessage(response.status));
      const validation = readValidation(payload, candidate);
      if (!validation) throw new Error("검증 응답이 현재 입력 계약과 맞지 않습니다. 입력을 유지했어요. 다시 검증하세요.");
      setReceipt({ version: requestVersion, body: requestBody, validation });
      setMessage("입력 검증 완료 · 자료 가용성 및 실행 성공은 미확인");
    } catch (error) {
      if (alive.current && version.current === requestVersion) setMessage(error instanceof Error && error.name !== "AbortError" ? error.message : "검증 응답을 받지 못했습니다. 입력을 유지했어요. 다시 검증할 수 있습니다.");
    } finally {
      clearTimeout(timeout);
      if (alive.current && version.current === requestVersion) { validating.current = false; setPhase("idle"); }
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!currentReceipt || currentReceipt.version !== version.current || submitted.current || !token.trim() || phase !== "idle") return;
    // Persist only a no-retry barrier, before sending anything. Never persist the token or receipt.
    try {
      // Recheck at the click boundary as another mounted view can have submitted since hydration.
      if (sessionStorage.getItem(ADMISSION_KEY)) {
        submitted.current = true; setPhase("unknown"); setMessage("이 탭의 이전 생성 요청을 먼저 조회하세요. POST를 재전송하지 않습니다."); return;
      }
      sessionStorage.setItem(ADMISSION_KEY, "response_unknown");
    }
    catch { setMessage("이 탭의 중복 요청 방지 상태를 저장할 수 없어 생성하지 않았습니다."); return; }
    submitted.current = true;
    const requestNavigationIntent = navigationIntent.current;
    setPhase("submitting"); setMessage("한 번의 생성 요청을 보냈습니다. 접수 응답을 기다려 주세요.");
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 20_000);
    try {
      const response = await fetch("/dashboard/lab/policies/simulations/create", {
        method: "POST", headers: { "content-type": "application/json", "x-toss-trading-dashboard-intent": "paper-simulation-create", "x-toss-trading-dashboard-mutation-token": token.trim() },
        body: currentReceipt.body, signal: abort.signal
      });
      const payload: unknown = await response.json();
      if (!alive.current) return;
      if ([400, 401, 403, 409].includes(response.status) || (response.status === 503 && typeof payload === "object" && payload !== null && "error" in payload && payload.error === "paper_simulation_admission_failed")) {
        sessionStorage.removeItem(ADMISSION_KEY); submitted.current = false;
        setPhase("idle"); setReceipt(null); setMessage(`${errorMessage(response.status, true)} 입력을 유지했어요. 다시 검증한 뒤 명시적으로 실행하세요.`); return;
      }
      const id = response.status === 202 ? acceptedSimulationId(payload, currentReceipt.validation) : null;
      if (!id) throw new Error("uncertain");
      setAcceptedId(id); setPhase("accepted"); setToken("");
      try { sessionStorage.setItem(ADMISSION_KEY, id); } catch { /* The earlier no-retry barrier remains; the known ID stays available in this view. */ }
      // Keep a no-retry barrier and the exact accepted ID on Back/reload, without the token.
      setMessage("접수됐습니다. 완료 여부는 같은 ID의 상세에서 조회합니다.");
      // A newer user navigation wins even while its destination is still loading.
      if (navigationIntent.current === requestNavigationIntent) router.push(`/dashboard/lab/runs/${encodeURIComponent(id)}`);
    } catch {
      if (alive.current) { setPhase("unknown"); setToken(""); setMessage("생성 응답이 불확실합니다. 실행 실패로 단정하거나 POST를 재전송하지 않습니다. ID를 받지 못했으므로 추측하지 않고 실험 목록에서 저장된 상태만 확인하세요."); }
    } finally { clearTimeout(timeout); }
  }
  const locked = phase === "submitting" || phase === "accepted" || phase === "unknown";
  const input = (key: keyof SimulationDraft, label: string, type = "text", hint?: string) => <label className={styles.field}>{label}<input type={type} value={draft[key]} onChange={e => edit(key, e.target.value)} disabled={!ready || locked} autoComplete="off" aria-describedby={hint ? `hint-${key}` : undefined} />{hint && <small id={`hint-${key}`}>{hint}</small>}</label>;
  const select = <K extends keyof SimulationDraft>(key: K, label: string, options: Array<[SimulationDraft[K], string]>) => <label className={styles.field}>{label}<select value={draft[key]} onChange={e => edit(key, e.target.value as SimulationDraft[K])} disabled={!ready || locked}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;

  return <div className={shell.workspace} onClickCapture={rememberNavigation}>
    <a className={shell.skipLink} href="#experiments-main">본문으로 건너뛰기</a><WorkspaceNavigation />
    <main className={`${shell.main} ${styles.wizard}`} id="experiments-main" tabIndex={-1}>
      <Link href="/dashboard">← 실험 목록</Link><h1>새 실험</h1><p className={styles.muted}>Historical paper replay · 실제 주문 없음</p>
      <ol className={styles.steps} aria-label="새 실험 단계">{STEPS.map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined}>{index + 1}. {label}</li>)}</ol>
      <div className={step === 3 ? undefined : styles.layout}>
        <section className={styles.panel} aria-labelledby="wizard-heading">
          <h2 id="wizard-heading" ref={heading} tabIndex={-1}>{step}. {STEPS[step - 1]}</h2>
          {step === 1 && <div className={styles.fields}>
            {select("riskProfile", "Built-in 위험 설정", [["conservative", "보수적"], ["balanced", "균형"], ["aggressive_paper", "적극적 paper"]])}
            {select("market", "시장 배분", [["mixed_global", "KR/US 목표 노출 반분"], ["kr", "KR · profile 기본 배분"], ["us", "US · profile 기본 배분"]])}
            {select("runType", "실행 유형", [["single_replay", "단일 replay"], ["batch_replay", "반복 batch replay"]])}
            {input("runCount", "요청 실행 횟수", "number", "1–20 · 단일 replay는 서버에서 1회로 정규화")}
            {input("initialCashKrw", "초기 모의 자본 (KRW)", "number", "100,000–10,000,000,000")}
            {select("paperExitPolicy", "청산 규칙", [["none", "없음"], ["take_profit_stop_loss", "익절 15% · 손절 8%"], ["rebalance_threshold", "단일 비중 40% 상한"]])}
            <p className={`${styles.notice} ${styles.wide}`}>시장 선택은 배분 조건이며 종목 필터가 아닙니다. 종목은 source snapshot에 따릅니다. 저장 PortfolioPolicy와 bucket 직접 실행은 지원하지 않습니다.</p>
          </div>}
          {step === 2 && <div className={styles.fields}>
            {input("sourceDataDir", "Source 자료 경로", "text", "프로젝트 data 아래 상대 경로 · 존재와 coverage 미확인")}
            {select("windowMode", "기간 방식", [["fixed_range", "고정 기간"], ["random_month", "범위 내 월 추출"]])}
            {input("startAt", "시작 날짜", "date")}{input("endAt", "종료 날짜", "date")}
            {input("windowMonths", "추출 월 수", "number", "1–12 · 고정 기간에서는 metadata만 유지")}{input("seed", "추출 seed")}
            {select("decisionFrequency", "판단 빈도", [["every_tick", "매 tick"], ["once_per_day", "하루 한 번"], ["once_per_week", "일주일 한 번"]])}
            {input("stepSeconds", "Replay 간격 (초)", "number", "60–2,592,000")}{input("maxDecisionCalls", "판단 호출 상한", "number", "1–100")}
            <p className={`${styles.notice} ${styles.wide}`}>판단 provider: dry_run_fixture · 외부 AI 호출 0. 자료 종류는 별도이며 미확인입니다. 날짜는 서버에서 +09:00 기준으로 해석합니다.</p>
          </div>}
          {step === 3 && <>
            <p className={styles.notice}>자료 종류 미확인 · 가용성 미검증. 검증은 입력만 확인하며 파일·coverage·실행 슬롯·성공 여부를 확인하지 않습니다.</p>
            {currentReceipt ? <Confirmation validation={currentReceipt.validation} /> : <p>현재 입력의 서버 검증이 필요합니다. 입력 변경 후에는 이전 결과를 사용할 수 없습니다.</p>}
            <div className={styles.actions}><button type="button" onClick={validate} disabled={!ready || !candidate || phase !== "idle"}>{phase === "validating" ? "검증 중…" : "현재 입력 검증"}</button></div>
            {!candidate && <p className={styles.muted}>앞 단계의 자료 경로·기간·seed·자본과 정수 입력을 모두 채워 주세요.</p>}
            <form onSubmit={create}>
              <label className={styles.field}>실행 승인 토큰<input type="password" value={token} autoComplete="off" disabled={!ready || locked} onChange={e => setToken(e.target.value)} aria-describedby="token-help" /></label>
              <p id="token-help" className={styles.muted}>현재 화면에서만 사용하며 URL·저장소·로그에 기록하지 않습니다.</p>
              <div className={styles.actions}><button className={styles.primary} type="submit" disabled={!currentReceipt || phase !== "idle" || !token.trim()}>paper 실행 시작</button></div>
            </form>
          </>}
          <p role="status" aria-live="polite" className={styles.notice}>{message || "현재 입력 · 미검증"}</p>
          {(phase === "unknown" || phase === "accepted") && <Link className={styles.link} href={acceptedId ? `/dashboard/lab/runs/${encodeURIComponent(acceptedId)}` : "/dashboard"}>{acceptedId ? "같은 ID 상태 조회" : "실험 목록에서 상태 조회"}</Link>}
          {phase === "accepted" && <div className={styles.actions}><button type="button" onClick={() => {
            try { sessionStorage.removeItem(ADMISSION_KEY); } catch { return; }
            submitted.current = false; version.current += 1; setReceipt(null); setAcceptedId(null); setToken(""); setPhase("idle"); setMessage("새 요청은 다시 검증해야 합니다."); go(1);
          }}>별도의 새 실험 준비</button></div>}
          <div className={styles.actions}>{step > 1 && <button type="button" onClick={() => go(step - 1)}>이전</button>}{step < 3 && <button className={styles.primary} type="button" disabled={!ready} onClick={() => go(step + 1)}>다음</button>}</div>
        </section>
        {step < 3 && <aside className={styles.panel} aria-label="입력 요약"><h2>입력 요약</h2><p>{draft.riskProfile} · {draft.runType}</p><p>{draft.initialCashKrw || "자본 미입력"} KRW</p><p>{draft.startAt || "시작 미입력"} → {draft.endAt || "종료 미입력"}</p><p className={styles.muted}>Source 자료 종류 미확인<br />판단 provider dry_run_fixture<br />비용 standard · 고정 benchmark 3종<br />서버 검증 후 실제 적용 조건을 확인합니다.</p></aside>}
      </div>
    </main>
  </div>;
}

function errorMessage(status: number, creating = false): string {
  if (status === 400) return "입력 조건이 거절됐습니다. 경로·날짜·숫자 범위를 확인하세요.";
  if (status === 401 || status === 403) return creating ? "요청 권한을 확인하세요. 실행 승인 토큰과 동일 출처 요청이 필요합니다." : "검증 요청의 권한과 동일 출처를 확인하세요. 입력 검증에는 실행 승인 토큰을 사용하지 않습니다.";
  if (status === 409) return "동시 실행 또는 ID 충돌로 접수되지 않았습니다. 저장된 상태를 먼저 확인하세요.";
  if (status === 503) return creating ? "접수를 저장하지 못해 runner를 시작하지 않았습니다." : "입력 검증 서비스를 사용할 수 없습니다. 입력을 유지했어요.";
  return `응답을 확인할 수 없습니다 (HTTP ${status}).`;
}

function Confirmation({ validation: v }: { validation: SimulationValidation }) {
  const e = v.effectiveConfig, r = v.requestedConfig;
  const cost = e.costModel.executionPolicy as Record<string, unknown>;
  const groups = [
    ["전략·자본", `${e.riskProfile} · ${e.capital.initialCashKrw.toLocaleString("ko-KR")} KRW · PortfolioPolicy 미적용`],
    ["실행·범위", `${e.runType} · 요청 ${r.runCount} → 실제 ${e.runCount}회 · ${r.universe.market}: ${e.universe.allocationMode} · 종목 필터 없음`],
    ["자료·기간", `${e.sourceDataDir} · ${e.window.rangeStartAt} → ${e.window.rangeEndAt} · UTC+${e.window.timezoneOffsetMinutes / 60} · ${e.window.mode} · seed ${e.window.seed}`],
    ["샘플링·속도", `${e.samplingPolicy.decisionFrequency} · ${e.samplingPolicy.stepSeconds}초 · 판단 상한 ${e.samplingPolicy.maxDecisionCalls} · tick 지연 ${e.tickDelayMs}ms`],
    ["판단 provider", `${e.decisionProvider.mode} · Codex 요청 ${r.samplingPolicy.maxCodexCallsPerRun} → 실제 ${e.samplingPolicy.maxCodexCallsPerRun} · model/schema 요청값은 미사용(null)`],
    ["Risk·청산", `신규 상한 ${e.constraints.maxNewPositions}종목 · 종목 예산 ${e.constraints.maxBudgetPerSymbolKrw} KRW · 목표 노출 ${e.allocationPolicy.targetExposureRatio} · 청산 ${r.paperExitPolicy} · constraints/riskPolicy/allocationPolicy 전체 값 아래`],
    ["비용·benchmark", `standard: 수수료 ${cost.feeBps} / 슬리피지 ${cost.slippageBps} / 세금 ${cost.taxBps} bps (현실 비용 보장 아님) · ${e.benchmarkPolicy.names.join(" / ")} · equal-weight는 가격 packet 필요`]
  ];
  return <>
    <dl className={styles.summary}>{groups.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <p className={styles.notice}>중요: preset은 metadata이며 미적용 · market은 배분만 적용 · fixed 기간의 월 수는 metadata · fixture는 자료 종류를 뜻하지 않습니다. 아래 서버 notices와 전체 실효값을 확인하세요.</p>
    {v.notices.filter(n => !["preset_not_applied", "allocation_only", "workflow_execution_defaults", "fixed_report_benchmarks", "fixture_provider", "single_run_count", "fixed_range_metadata_only"].includes(n.code)).map((notice, index) => <p className={styles.notice} key={`${notice.code}-${index}`}>{notice.field}: {notice.message}</p>)}
    <details className={styles.details}><summary>전체 요청값·실효값·서버 notices ({v.notices.length})</summary>
      <h3>서버 notices</h3><ul>{v.notices.map((n, i) => <li key={`${n.code}-${i}`}><strong>{n.field} · {n.code}</strong><p>{n.message}</p></li>)}</ul>
      <h3>requestedConfig</h3><pre>{JSON.stringify(v.requestedConfig, null, 2)}</pre><h3>effectiveConfig</h3><pre>{JSON.stringify(v.effectiveConfig, null, 2)}</pre>
      <h3>자료 관측</h3><pre>{JSON.stringify({ sourceDataKind: v.sourceDataKind, dataAvailabilityChecked: v.dataAvailabilityChecked }, null, 2)}</pre>
    </details>
  </>;
}
