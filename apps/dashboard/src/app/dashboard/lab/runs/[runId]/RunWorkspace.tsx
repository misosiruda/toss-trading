"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RunDetailPageData } from "@/lib/dashboardViewModels";
import { createRunRefresh, isRunSnapshot, readRunWorkspaceTab, runWorkspaceState, type RunRefreshState } from "@/lib/runWorkspace";
import { WorkspaceNavigation } from "../../../ExperimentList";
import { ArtifactStatusGrid, EvidencePanel, ProgressPanel, RunSummary, SimulationObservationPanel, SourcePanel, UnavailablePanel } from "./RunDetailPanels";
import shell from "../../../ExperimentList.module.css";
import styles from "./RunWorkspace.module.css";

export function RunWorkspace({ requestedId, initial }: { requestedId: string; initial: RunDetailPageData }) {
  const tab = readRunWorkspaceTab(useSearchParams().get("tab"));
  const [snapshot, setSnapshot] = useState(initial);
  const [lastGood, setLastGood] = useState(initial.runDetail.status === "ok" ? initial : null);
  const [transportError, setTransportError] = useState(false);
  const [refreshState, setRefreshState] = useState<RunRefreshState>({ busy: false, automaticCount: 0, limited: false });
  const [now, setNow] = useState(() => Date.now());
  const [source, setSource] = useState(initial);
  // Reset observation state for a fresh server read without replacing focused DOM.
  if (source !== initial) {
    setSource(initial); setSnapshot(initial);
    setLastGood(initial.runDetail.status === "ok" ? initial : null);
    setTransportError(false);
    setRefreshState({ busy: false, automaticCount: 0, limited: false });
    setNow(Date.parse(initial.fetchedAt));
  }
  const lifecycle = useRef<ReturnType<typeof createRunRefresh> | null>(null);
  useEffect(() => {
    const refresh = createRunRefresh({
      initial,
      read: async signal => {
        const response = await fetch(`/dashboard/lab/runs/${encodeURIComponent(requestedId)}/snapshot`, { method: "GET", cache: "no-store", signal, headers: { accept: "application/json" } });
        if (!response.ok) throw new Error("GET refresh unavailable");
        const value: unknown = await response.json();
        if (!isRunSnapshot(value, requestedId)) throw new Error("Invalid GET snapshot");
        return value;
      },
      apply: next => { setSnapshot(next); setTransportError(false); if (next.runDetail.status === "ok") setLastGood(next); setNow(Date.now()); },
      state: setRefreshState,
      error: () => { setTransportError(true); setNow(Date.now()); }
    });
    lifecycle.current = refresh;
    const visibility = () => { refresh.setVisible(!document.hidden); setNow(Date.now()); };
    visibility(); document.addEventListener("visibilitychange", visibility);
    return () => { refresh.dispose(); lifecycle.current = null; document.removeEventListener("visibilitychange", visibility); };
  }, [initial, requestedId]);

  const unavailable = transportError || snapshot.runDetail.status !== "ok";
  const display = unavailable && lastGood ? lastGood : snapshot;
  const result = display.runDetail;
  const data = result.status === "ok" ? result.data : null;
  const state = runWorkspaceState(result);
  const stale = (unavailable || state.poll) && lastGood !== null && now - Date.parse(lastGood.fetchedAt) >= 15_000;
  const href = `/dashboard/lab/runs/${encodeURIComponent(requestedId)}`;
  useEffect(() => {
    if ((!unavailable && !state.poll) || !lastGood) return;
    const clock = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(clock);
  }, [unavailable, state.poll, lastGood]);
  return <div className={`${shell.workspace} ${styles.workspace}`}>
    <a className={shell.skipLink} href="#run-workspace-main">실행 상세로 건너뛰기</a>
    <WorkspaceNavigation />
    <main id="run-workspace-main" className={styles.main} tabIndex={-1}>
      <header className={styles.header}>
        <Link href="/dashboard" className={styles.back}>실험 목록</Link>
        <h1>Run Detail</h1>
        <p>Paper-only run detail · 저장된 paper 실행과 산출물을 읽기 전용으로 확인합니다.</p>
        <dl className={styles.identity}>
          <div><dt>요청 ID</dt><dd>{requestedId}</dd></div>
          <div><dt>선택 child run ID</dt><dd>{data?.run?.runId ?? "미관측"}</dd></div>
          <div><dt>Batch ID</dt><dd>{data?.batchId ?? "미관측"}</dd></div>
        </dl>
      </header>
      <nav aria-label="실행 상세 보기" className={styles.tabs}>
        <Link href={`${href}?tab=summary`} aria-current={tab === "summary" ? "page" : undefined}>요약</Link>
        <Link href={`${href}?tab=record`} aria-current={tab === "record" ? "page" : undefined}>기록</Link>
        <button type="button" disabled aria-describedby="run-unsupported">리플레이</button>
        <button type="button" disabled aria-describedby="run-unsupported">판단 근거</button>
      </nav>
      <p id="run-unsupported" className={styles.note}>이 조회에는 검증된 시계열·실행별 event 참조가 없어 리플레이와 판단 근거를 제공하지 않습니다.</p>
      <section aria-label="조회 상태" className={styles.observation}>
        <div><h2>조회와 실행 상태</h2>
          <p>조회: {transportError ? "offline" : snapshot.runDetail.status} · endpoint: {data?.endpointStatus ?? "미관측"} · batch: {data?.batchStatus ?? "미관측"}</p>
          <p>선택 child: {state.execution} · 산출물 판독: {state.completeness} · heartbeat: 미관측</p>
          <p>GET 관측 시각: {display.fetchedAt}</p>
        </div>
        <button type="button" className={styles.refresh} disabled={refreshState.busy} onClick={() => void lifecycle.current?.refresh()}>{refreshState.busy ? "조회 중…" : "같은 ID 새로 조회 (GET)"}</button>
      </section>
      {(unavailable || stale) && <p role="status" className={styles.warning}>{stale ? "조회 갱신 지연 · " : ""}{lastGood ? "마지막 정상 조회 자료를 표시합니다. 현재 실행 생존·실패는 단정할 수 없습니다." : "현재 자료를 확인할 수 없습니다. GET으로 다시 조회할 수 있습니다."}</p>}
      {refreshState.limited && <p role="status" className={styles.warning}>자동 조회 한도 도달 · 실행 상태 단정 불가. 필요하면 GET으로 다시 조회하세요.</p>}
      <p className={styles.note}>{state.poll && !unavailable ? `5초 간격 GET 관측 · 최대 12회 (${refreshState.automaticCount}/12)` : "자동 조회 중단 · 실행 상태와 조회 상태는 별개입니다."}</p>
      {snapshot.runDetail.status !== "ok" && <UnavailablePanel result={snapshot.runDetail} />}
      {data && !["not_requested", "unsupported"].includes(data.simulationObservation.status) && <SimulationObservationPanel data={data} />}
      {data && (data.run ? <>
        {tab === "summary" ? <>
          <RunSummary run={data.run} />
          <ArtifactStatusGrid artifacts={data.artifacts} run={data.run} />
          <ProgressPanel artifacts={data.artifacts} />
          <EvidencePanel artifacts={data.artifacts} />
          <SourcePanel data={data} />
        </> : <>
          <section className={styles.record} aria-label="선택 실행 기록">
            <h2>선택 실행 기록</h2><p>저장된 시각입니다. 실시간 event timeline이나 heartbeat가 아닙니다.</p>
            <dl>{([['Started',data.run.startedAt],['Completed',data.run.completedAt],['Failed',data.run.failedAt],['Skipped',data.run.skippedAt]] as const).map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "미관측"}</dd></div>)}</dl>
          </section>
          <SourcePanel data={data} />
        </>}
      </> : <section className={styles.record}><h2>Run artifact unavailable</h2><p>요청 ID에 해당하는 child 실행 기록은 미관측입니다. 조회 부재를 실패나 성공으로 해석하지 않습니다.</p></section>)}
      {tab === "record" && data?.run === null && <SourcePanel data={data} />}
      {tab === "record" && <section className={styles.record} aria-label="전체 운영 기록">
        <h2>전체 운영 기록</h2><p>전체 storage 자료이며 선택한 실행에 한정된 근거가 아닙니다.</p>
        <Link href="/dashboard/risk-gate">전체 운영 기록 · Risk</Link><Link href="/dashboard/audit">전체 운영 기록 · Audit</Link>
      </section>}
      {tab === "record" && data && ["not_requested", "unsupported"].includes(data.simulationObservation.status) && <SimulationObservationPanel data={data} />}
      <section aria-label="Run detail safety boundary" className={styles.safety}>
        <span>Source <strong>/batch/replay/runs</strong></span>
        <span>Mode <strong>read-only</strong></span>
        <span>Live order <strong>not exposed</strong></span>
      </section>
      <footer className={styles.note}>paper_only · read-only · no live orders · {snapshot.apiBaseLabel}</footer>
    </main>
  </div>;
}
