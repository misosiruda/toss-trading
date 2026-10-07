import { expect, test } from '@playwright/test';
import axe from 'axe-core';

test('benchmark selection survives detail tabs, filters, events, history and reload',async({page,request},info)=>{
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/dashboard/lab/runs/fixture_benchmark_normal');
  await expect(page).toHaveTitle('Toss Trading Dashboard');
  const panel=page.getByRole('region',{name:'저장된 benchmark'});
  const cash=panel.getByRole('checkbox',{name:'현금 보유',exact:true});
  await cash.focus();await cash.press('Space');
  const selection='equalWeightBuyAndHold,initialPortfolioBuyAndHold';
  const tabs=page.getByRole('navigation',{name:'실행 상세 보기'});
  for(const [label,tab] of [['기록','record'],['리플레이','replay'],['판단 근거','evidence']] as const){
    const link=tabs.getByRole('link',{name:label,exact:true});
    await link.focus();await link.press('Enter');
    await expect(link).toHaveAttribute('aria-current','page');
    expect(new URL(page.url()).searchParams.get('tab')).toBe(tab);
    expect(new URL(page.url()).searchParams.get('benchmarks')).toBe(selection);
  }
  const filters=page.getByRole('navigation',{name:'근거 자료 종류'});
  await filters.getByRole('link',{name:'Packet',exact:true}).click();
  const packet=page.getByRole('region',{name:'근거 사건 목록'}).getByRole('link',{name:/fixture_packet_kr/});
  await packet.click();
  await expect(page.getByRole('article',{name:'선택 근거 상세'})).toContainText('Packet · fixture_packet_kr');
  expect(new URL(page.url()).searchParams.get('benchmarks')).toBe(selection);
  await page.reload();
  await expect(page.getByRole('article',{name:'선택 근거 상세'})).toContainText('Packet · fixture_packet_kr');
  await filters.getByRole('link',{name:'모두',exact:true}).click();
  await expect(page.getByRole('article',{name:'선택 근거 상세'})).toContainText('사건을 선택하면');
  expect(new URL(page.url()).searchParams.get('benchmarks')).toBe(selection);
  await tabs.getByRole('link',{name:'요약',exact:true}).click();
  await expect(cash).not.toBeChecked();
  expect(new URL(page.url()).searchParams.has('kind')).toBe(false);
  expect(new URL(page.url()).searchParams.has('event')).toBe(false);
  await page.goBack();await expect(filters).toBeVisible();
  await page.goForward();await expect(cash).not.toBeChecked();
  await page.reload();await expect(cash).not.toBeChecked();
  await expect(panel.getByText('총 수익률 2%',{exact:true})).toBeVisible();
  await expect(panel.getByText('총 수익률 -2%',{exact:true})).toBeVisible();
  await expect(panel.getByText('cashOnly',{exact:true})).toHaveCount(0);
  await expect(panel).toContainText('결합: bound');
  await page.addScriptTag({content:axe.source});
  expect((await page.evaluate(async()=> (window as unknown as {axe:typeof axe}).axe.run())).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('benchmark-selection-after-navigation.png')});
  const response=await request.get('http://127.0.0.1:8793/__requests',{headers:{'x-ux04-test-runner':'ux04-fixture-v1'}});
  const {requests}=await response.json();
  expect(requests.filter((r:{method:string;path:string})=>r.method!=='GET'||!['/batch/replay/runs','/batch/replay/runs/provenance'].includes(r.path))).toEqual([]);
  expect(errors).toEqual([]);
});

test('none and invalid benchmark selections retain their meaning through tab navigation',async({page})=>{
  for(const value of ['none','unknown','']){
    await page.goto(`/dashboard/lab/runs/fixture_benchmark_normal?benchmarks=${value}`);
    const tabs=page.getByRole('navigation',{name:'실행 상세 보기'});
    const record=tabs.getByRole('link',{name:'기록',exact:true});
    const summary=tabs.getByRole('link',{name:'요약',exact:true});
    await record.click();await expect(record).toHaveAttribute('aria-current','page');
    await summary.click();await expect(summary).toHaveAttribute('aria-current','page');
    await page.reload();
    expect(new URL(page.url()).searchParams.get('benchmarks')).toBe(value);
    const panel=page.getByRole('region',{name:'저장된 benchmark'});
    await expect(panel).toContainText(value==='none'?'표시 선택 없음':'URL 표시 선택이 유효하지 않아 3종을 보여 줍니다');
    await expect(panel.locator('input:checked')).toHaveCount(value==='none'?0:3);
    await panel.getByRole('button',{name:'3종 모두 표시'}).click();
    await expect(panel.locator('input:checked')).toHaveCount(3);
    const replay=tabs.getByRole('link',{name:'리플레이',exact:true});
    await replay.click();await expect(replay).toHaveAttribute('aria-current','page');
    await summary.click();await expect(summary).toHaveAttribute('aria-current','page');
    await expect(panel.locator('input:checked')).toHaveCount(3);
    expect(new URL(page.url()).searchParams.has('benchmarks')).toBe(false);
  }
});

test('three stored benchmarks select by keyboard/history with GET input and values unchanged',async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/dashboard/lab/runs/fixture_benchmark_normal?custom=keep');
  const panel=page.getByRole('region',{name:'저장된 benchmark'});
  await expect(panel.getByText('cashOnly',{exact:true})).toBeVisible();
  await expect(panel.getByText('equalWeightBuyAndHold',{exact:true})).toBeVisible();
  await expect(panel.getByText('initialPortfolioBuyAndHold',{exact:true})).toBeVisible();
  await expect(panel.getByText('총 수익률 0%',{exact:true})).toBeVisible();
  await expect(panel.getByText('총 수익률 2%',{exact:true})).toBeVisible();
  await expect(panel.getByText('총 수익률 -2%',{exact:true})).toBeVisible();
  const requests=async()=> (await (await request.get('http://127.0.0.1:8793/__requests',{headers:{'x-ux04-test-runner':'ux04-fixture-v1'}})).json()).requests;
  const before=await requests();
  const checkbox=panel.getByRole('checkbox',{name:'현금 보유',exact:true});
  await checkbox.focus();await checkbox.press('Space');
  await expect(checkbox).toBeFocused();await expect(checkbox).not.toBeChecked();
  await expect(panel.getByText('cashOnly',{exact:true})).toHaveCount(0);
  await expect(page).toHaveURL(/custom=keep&benchmarks=equalWeightBuyAndHold%2CinitialPortfolioBuyAndHold$/);
  await page.goBack();await expect(checkbox).toBeChecked();await expect(panel.getByText('cashOnly',{exact:true})).toBeVisible();
  await page.goForward();await expect(checkbox).not.toBeChecked();
  await panel.getByRole('button',{name:'3종 모두 표시'}).click();
  await expect(page).toHaveURL(/fixture_benchmark_normal\?custom=keep$/);
  await expect(panel.getByText('총 수익률 2%',{exact:true})).toBeVisible();
  expect(await requests()).toEqual(before);
  const coverage=page.getByRole('region',{name:'Source coverage 근거'});
  await expect(coverage).toContainText('자료 종류: unknown');
  await expect(coverage).toContainText('KR / US · 시장 2종 / 시장·symbol 쌍 2개');
  await expect(coverage).toContainText('전체 기간 coverage가 아닙니다');
  await page.addScriptTag({content:axe.source});
  expect((await page.evaluate(async()=> (window as unknown as {axe:typeof axe}).axe.run())).violations).toEqual([]);
  const width=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
  expect(width.client).toBe(page.viewportSize()!.width);expect(width.scroll).toBeLessThanOrEqual(width.client);
  expect(errors).toEqual([]);
});

test('missing/unavailable/invalid benchmark and unknown coverage remain explicit',async({page})=>{
  for(const [scenario,text] of [['unavailable','unavailable · 계산 근거 미확인'],['missing','저장 값 없음'],['invalid','invalid · 표시 계약 불일치'],['mismatch','결합: mismatch']] as const){
    await page.goto(`/dashboard/lab/runs/fixture_benchmark_${scenario}`);
    const panel=page.getByRole('region',{name:'저장된 benchmark'});
    await expect(panel).toContainText(text);
    await expect(page.getByRole('region',{name:'Source coverage 근거'})).toContainText('source 전체 종목·시장 coverage: unknown');
    if(scenario==='missing')await expect(page.getByRole('region',{name:'Source coverage 근거'})).toContainText('unknown · 기간 근거 미확인');
    if(scenario==='mismatch')await expect(panel.getByText('총 수익률 2%',{exact:true})).toHaveCount(0);
  }
  await page.goto('/dashboard/lab/runs/fixture_benchmark_degraded?benchmarks=none');
  const panel=page.getByRole('region',{name:'저장된 benchmark'});
  await expect(panel).toContainText('표시 선택 없음');
  await expect(page.getByRole('region',{name:'Source coverage 근거'})).toContainText('degraded · 표시 2 / API 반환 2 / 저장 전체 5');
  await panel.getByRole('button',{name:'3종 모두 표시'}).click();
  await expect(panel.getByText('cashOnly',{exact:true})).toBeVisible();
  await page.goto('/dashboard/lab/runs/fixture_benchmark_normal?benchmarks=unknown');
  await expect(panel).toContainText('URL 표시 선택이 유효하지 않아 3종을 보여 줍니다');
});

test('tampered refresh context cannot replace last verified child benchmark',async({page})=>{
  await page.goto('/dashboard/lab/runs/fixture_benchmark_normal');
  const panel=page.getByRole('region',{name:'저장된 benchmark'});
  await expect(panel.getByText('총 수익률 2%',{exact:true})).toBeVisible();
  await page.route('**/fixture_benchmark_normal/snapshot',async route=>{
    const response=await route.fetch();const json=await response.json();
    json.reportContext.runId='other-child';json.reportContext.benchmarks[1].metric.totalReturnRatio=0.9;
    await route.fulfill({response,json});
  });
  await page.getByRole('button',{name:/GET/}).click();
  await expect(page.getByRole('status')).toContainText('마지막 정상 조회 자료');
  await expect(panel.getByText('총 수익률 2%',{exact:true})).toBeVisible();
  await expect(panel.getByText('총 수익률 90%',{exact:true})).toHaveCount(0);
});
