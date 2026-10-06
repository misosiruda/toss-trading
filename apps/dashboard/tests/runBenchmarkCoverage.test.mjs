import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
const source=await readFile(new URL('../src/lib/runEvidence.ts',import.meta.url),'utf8');
const {BENCHMARK_NAMES,buildRunReportContext,isRunReportContext,readBenchmarkSelection}=await import('data:text/javascript,'+encodeURIComponent(stripTypeScriptTypes(source)));
const clone=value=>JSON.parse(JSON.stringify(value));
const metric={initialNetWorthKrw:500000,finalNetWorthKrw:510000,totalReturnRatio:0.02};
const fixture=()=>({runId:'child-cost',status:'ok',reportStatus:'ok',report:{mode:'paper_only',simulatedRange:{startAt:'2026-01-01T00:00:00+09:00',endAt:'2026-01-02T00:00:00+09:00',tickCount:2},benchmarks:{cashOnly:{...metric,finalNetWorthKrw:500000,totalReturnRatio:0},equalWeightBuyAndHold:clone(metric),initialPortfolioBuyAndHold:{...metric,totalReturnRatio:null}}}});

test('stored benchmarks preserve genuine zero and null; no mutation or recalculation',()=>{
  const raw=fixture(),before=clone(raw),view=buildRunReportContext(raw,'child-cost');
  assert.equal(view.source,'bound');assert.equal(view.reportStatus,'ok');
  assert.deepEqual(view.benchmarks.map(row=>row.name),BENCHMARK_NAMES);
  assert.equal(view.benchmarks[0].metric.totalReturnRatio,0);
  assert.equal(view.benchmarks[1].metric.finalNetWorthKrw,510000);
  assert.equal(view.benchmarks[2].metric.totalReturnRatio,null);
  assert.equal(view.range.tickCount,2);
  assert.equal(isRunReportContext(view,'child-cost'),true);
  assert.deepEqual(raw,before);
  assert.equal(isRunReportContext(view,'other-child'),false);
});
test('wrong child, unsafe wrappers, damaged read and nonpaper report expose no benchmark value',()=>{
  for(const mutate of [raw=>raw.runId='other-child',raw=>raw.status='blocked',raw=>raw.status='invalid',raw=>raw.status='invented',raw=>raw.reportStatus='corrupt',raw=>raw.reportStatus='missing',raw=>raw.reportStatus='degraded',raw=>raw.reportStatus='blocked',raw=>raw.reportStatus='invented',raw=>raw.report.mode='live',raw=>raw.report.runId='other-child',raw=>raw.status='missing']){
    const raw=fixture();mutate(raw);const view=buildRunReportContext(raw,'child-cost');
    assert.ok(view.benchmarks.every(row=>row.status!=='available'&&row.metric===null));
    assert.equal(view.range,null);assert.equal(isRunReportContext(view,'child-cost'),true);
  }
  for(const raw of [null,undefined,[],{},'report']){
    const view=buildRunReportContext(raw,'child-cost');assert.ok(view.benchmarks.every(row=>row.metric===null));assert.equal(isRunReportContext(view,'child-cost'),true);
  }
});
test('missing, explicit unavailable and invalid values remain distinct; range never inferred',()=>{
  const raw=fixture();delete raw.report.benchmarks.cashOnly;raw.report.benchmarks.equalWeightBuyAndHold=null;raw.report.benchmarks.initialPortfolioBuyAndHold.finalNetWorthKrw='510000';
  const view=buildRunReportContext(raw,'child-cost');assert.deepEqual(view.benchmarks.map(row=>row.status),['missing','unavailable','invalid']);
  for(const value of [undefined,null,{startAt:'2026-01-02T00:00:00Z',endAt:'2026-01-01T00:00:00Z',tickCount:2},{startAt:'bad',endAt:'bad',tickCount:2}]){
    const damaged=fixture();damaged.report.simulatedRange=value;assert.equal(buildRunReportContext(damaged,'child-cost').range,null);
  }
  for(const field of ['initialNetWorthKrw','finalNetWorthKrw','totalReturnRatio'])for(const invalid of [undefined,'0',NaN,Infinity,-Infinity]){
    const damaged=fixture();damaged.report.benchmarks.cashOnly[field]=invalid;assert.equal(buildRunReportContext(damaged,'child-cost').benchmarks[0].status,'invalid');
  }
});
test('transport projection rejects mismatched, injected, malformed and fabricated available context',()=>{
  for(const mutate of [v=>v.runId='other',v=>v.source='invented',v=>v.reportStatus='invented',v=>v.benchmarks.reverse(),v=>v.benchmarks.pop(),v=>v.benchmarks[0].metric.initialNetWorthKrw='500000',v=>v.benchmarks[0].metric.token='secret',v=>v.source='missing',v=>v.reportStatus='missing',v=>v.range.tickCount=-1]){
    const view=buildRunReportContext(fixture(),'child-cost');mutate(view);assert.equal(isRunReportContext(view,'child-cost'),false);
  }
});
test('selection is bounded URL presentation state with all/none restoration',()=>{
  assert.deepEqual(readBenchmarkSelection(null),BENCHMARK_NAMES);assert.deepEqual(readBenchmarkSelection('none'),[]);
  assert.deepEqual(readBenchmarkSelection('initialPortfolioBuyAndHold,cashOnly'),['cashOnly','initialPortfolioBuyAndHold']);
  for(const invalid of ['', 'cash_only','cashOnly,cashOnly','cashOnly,unknown','cashOnly,','unknown','cashOnly,equalWeightBuyAndHold,initialPortfolioBuyAndHold,cashOnly'])assert.equal(readBenchmarkSelection(invalid),null);
});
test('report period projection has a bounded string contract',()=>{
  const raw=fixture();raw.report.simulatedRange.startAt='2026-01-01T00:00:00Z'+' '.repeat(100);
  assert.equal(buildRunReportContext(raw,'child-cost').range,null);
  const view=buildRunReportContext(fixture(),'child-cost');view.range.startAt='2026-01-01T00:00:00Z'+' '.repeat(100);
  assert.equal(isRunReportContext(view,'child-cost'),false);
});