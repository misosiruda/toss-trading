"use client";
import { useSearchParams } from "next/navigation";
import { BENCHMARK_NAMES, buildRunReportContext, readBenchmarkSelection, type BenchmarkName, type RunEvidenceView, type RunReportContext } from "@/lib/runEvidence";
import styles from "./RunBenchmarkCoverage.module.css";
const LABEL: Record<BenchmarkName,string> = {cashOnly:"현금 보유",equalWeightBuyAndHold:"동일 비중 매수·보유",initialPortfolioBuyAndHold:"초기 포트폴리오 보유"};
const STATUS = {missing:"저장 값 없음",unavailable:"unavailable · 계산 근거 미확인",invalid:"invalid · 표시 계약 불일치"};
const amount = (value:number) => value.toLocaleString("ko-KR");

export function RunBenchmarkCoverage({context,evidence,selectedChildId}:{context:RunReportContext|undefined;evidence:RunEvidenceView|undefined;selectedChildId:string|null}) {
  const query = useSearchParams();
  const selection = readBenchmarkSelection(query.get("benchmarks"));
  const selected = selection ?? [...BENCHMARK_NAMES];
  const view = context?.runId===selectedChildId ? context : buildRunReportContext(null,selectedChildId);
  const packet = evidence?.source==="bound" && evidence.runId===selectedChildId ? evidence.buckets.find(bucket=>bucket.kind==="packet") : undefined;
  const rows = packet && ["ok","degraded"].includes(packet.status) ? packet.rows : [];
  const markets = new Set<string>(), symbols = new Set<string>();
  for (const row of rows) for (const candidate of row.details.candidates as Array<{market:string;symbol:string}>) {
    markets.add(candidate.market); symbols.add(`${candidate.market}:${candidate.symbol}`);
  }
  function choose(next: BenchmarkName[]) {
    const url = new URL(window.location.href);
    if (next.length===3) url.searchParams.delete("benchmarks");
    else url.searchParams.set("benchmarks",next.length ? BENCHMARK_NAMES.filter(name=>next.includes(name)).join(",") : "none");
    window.history.pushState(null,"",`${url.pathname}${url.search}${url.hash}`);
  }
  return <>
    <section className={styles.panel} aria-labelledby="benchmark-heading">
      <h2 id="benchmark-heading">저장된 benchmark</h2>
      <p>선택 child: {view.runId??"미확인"} · report 읽기: {view.reportStatus} · 결합: {view.source}</p>
      <p>선택은 화면 표시만 바꿉니다. 기존 3종 계산·저장 값과 실행 요청은 유지합니다. 기준선의 비용·sampling이 전략과 같다는 뜻은 아닙니다.</p>
      <fieldset className={styles.choices}><legend>표시할 benchmark</legend>
        {BENCHMARK_NAMES.map(name=><label key={name}><input type="checkbox" checked={selected.includes(name)} onChange={event=>choose(event.target.checked?[...selected,name]:selected.filter(item=>item!==name))}/>{LABEL[name]}</label>)}
      </fieldset>
      <button type="button" onClick={()=>choose([...BENCHMARK_NAMES])}>3종 모두 표시</button>
      {selection===null&&<p role="status">URL 표시 선택이 유효하지 않아 3종을 보여 줍니다. 다른 값으로 계산하지 않습니다.</p>}
      {selected.length===0&&<p>표시 선택 없음 · 저장된 benchmark는 유지됩니다.</p>}
      <dl className={styles.metrics}>{view.benchmarks.filter(row=>selected.includes(row.name)).map(row=><div key={row.name}>
        <dt>{LABEL[row.name]} <small>{row.name}</small></dt>
        <dd>{row.status==="available" ? <><span>초기 가상 자산 {amount(row.metric.initialNetWorthKrw)} KRW</span><span>최종 가상 자산 {amount(row.metric.finalNetWorthKrw)} KRW</span><span>총 수익률 {row.metric.totalReturnRatio===null?"미확인":row.metric.totalReturnRatio.toLocaleString("ko-KR",{style:"percent",maximumFractionDigits:2})}</span></> : STATUS[row.status]}</dd>
      </div>)}</dl>
    </section>
    <section className={styles.panel} aria-labelledby="coverage-heading">
      <h2 id="coverage-heading">Source coverage 근거</h2>
      <p>자료 종류: unknown · source 전체 종목·시장 coverage: unknown. preset 이름이나 fixture provider만으로 완전성을 추론하지 않습니다.</p>
      <p>시장 선택은 allocation 조건이며 membership 필터가 아닙니다. 이 안내는 실행 종목을 제외하지 않습니다.</p>
      <dl className={styles.coverage}>
        <div><dt>저장 report의 평가 기간</dt><dd>{view.range?`${view.range.startAt} → ${view.range.endAt} · ${view.range.tickCount} ticks`:"unknown · 기간 근거 미확인"}</dd></div>
        <div><dt>현재 읽은 Packet 표본</dt><dd>{packet?`${packet.status} · 표시 ${rows.length} / API 반환 ${packet.returned??"unknown"} / 저장 전체 ${packet.total??"unknown"}`:"unknown · Packet 근거 미확인"}</dd></div>
        <div><dt>표본 candidate 시장·종목</dt><dd>{packet && ["ok","degraded"].includes(packet.status)?`${[...markets].sort().join(" / ")||"표본 내 시장 없음"} · 시장 ${markets.size}종 / 시장·symbol 쌍 ${symbols.size}개`:"unknown"}</dd></div>
      </dl>
      <p>Packet candidate 표본은 source 전체 universe나 전체 기간 coverage가 아닙니다. 읽기 상한·손상·잘못된 row·다른 run 제외가 있으면 누락 종목의 부재를 증명하지 않습니다.</p>
    </section>
  </>;
}