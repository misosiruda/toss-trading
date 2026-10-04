import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const root='/dashboard/lab/runs/',normal=root+'fixture_evidence_normal';
const selected=(id:string,kind:string,event:string,tab='evidence')=>root+id+'?tab='+tab+'&event='+encodeURIComponent(kind+':'+event);
const inspector=(page:import('@playwright/test').Page)=>page.getByRole('article',{name:'선택 근거 상세'});
test.afterEach(async({request})=>{const response=await request.get('http://127.0.0.1:8794/__requests',{headers:{'x-ux04-test-runner':'ux05-fixture-v1'}});expect(response.status()).toBe(200);const {requests}=await response.json();expect(requests.every((r:{method:string})=>r.method==='GET')).toBe(true);});

test('bound packet and trade reference the exact Risk while provider causality remains unavailable',async({page})=>{
  await page.goto(normal+'?tab=evidence');await expect(page.getByRole('heading',{name:'판단 근거',exact:true})).toBeVisible();
  await page.locator('a[href$="event=trade%3Atrade_1"]').click();await expect(page).toHaveURL(selected('fixture_evidence_normal','trade','trade_1'));
  await expect(inspector(page).getByRole('heading',{name:'모의 체결 · trade_1'})).toBeVisible();
  await expect(inspector(page).getByRole('link',{name:'risk_1',exact:true})).toHaveAttribute('href',selected('fixture_evidence_normal','risk','risk_1'));
  await expect(inspector(page).getByText('이 자료의 decisionId는 Risk의 riskDecisionId 참조입니다.',{exact:false})).toBeVisible();
  await expect(inspector(page).getByText('Provider 판단 항목 ↔ Risk 직접 인과 연결: unavailable.',{exact:false})).toBeVisible();
  await inspector(page).getByRole('link',{name:'risk_1',exact:true}).click();await expect(inspector(page).getByRole('heading',{name:'Deterministic Risk · risk_1'})).toBeVisible();
  await inspector(page).getByRole('link',{name:'packet_1',exact:true}).click();await expect(inspector(page).getByRole('heading',{name:'Packet · packet_1'})).toBeVisible();
});

test('keyboard selection focus and exact event URL survive fresh reads, Back, Forward and reload',async({page})=>{
  await page.goto(normal+'?tab=evidence');const stamp=page.getByText('GET 관측 시각:',{exact:false});const before=await stamp.textContent();
  await page.getByRole('button',{name:'같은 ID 새로 조회 (GET)'}).click();await expect(stamp).not.toHaveText(before!);
  const trade=page.locator('a[href$="event=trade%3Atrade_1"]');await trade.focus();await expect(trade).toBeFocused();await page.keyboard.press('Enter');
  await expect(page).toHaveURL(selected('fixture_evidence_normal','trade','trade_1'));await expect(trade).toBeFocused();
  await page.goBack();await expect(page).toHaveURL(normal+'?tab=evidence');await expect(trade).toBeFocused();
  await page.goForward();await expect(page).toHaveURL(selected('fixture_evidence_normal','trade','trade_1'));await expect(trade).toBeFocused();
  await page.reload();await expect(inspector(page).getByRole('heading',{name:'모의 체결 · trade_1'})).toBeVisible();
  await page.getByRole('navigation',{name:'근거 자료 종류'}).getByRole('link',{name:'Deterministic Risk',exact:true}).click();
  await expect(page).toHaveURL(normal+'?tab=evidence&kind=risk');await expect(page.getByRole('region',{name:'근거 사건 목록'}).getByRole('heading',{name:'Deterministic Risk'})).toBeVisible();
  await expect(page.getByRole('region',{name:'근거 사건 목록'}).getByRole('heading',{name:'Packet',exact:true})).toHaveCount(0);
});

test('wrong child, per-record wrong run and invalid schemas do not become execution failure',async({page})=>{
  for(const [scenario,message]of [['mismatch','다른 child 자료 · 연결 차단'],['blocked','자료 경로 제한 · 연결 차단'],['wrong_run','다른 run 제외 1'],['bad','스키마 제외 1']]){
    await page.goto(root+'fixture_evidence_'+scenario+'?tab=evidence');await expect(page.getByText(message,{exact:false}).first()).toBeVisible();
    await expect(page.getByText('선택 child: completed',{exact:false})).toBeVisible();
    await expect(page.getByRole('region',{name:'근거 사건 목록'}).getByRole('link')).toHaveCount(0);
  }
});

test('duplicate and unknown selection is unavailable without first or last winner',async({page})=>{
  await page.goto(selected('fixture_evidence_duplicate','trade','trade_1'));await expect(inspector(page).getByText('중복 ID · 연결 모호',{exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'근거 사건 목록'}).getByRole('link')).toHaveCount(0);
  await page.goto(normal+'?tab=evidence&event=unknown%3Apacket_1');await expect(inspector(page).getByText('알 수 없는 선택',{exact:false})).toBeVisible();
  await expect(inspector(page).getByRole('heading',{name:'Packet · packet_1'})).toHaveCount(0);
});

test('missing, clipped, cross-packet and out-of-order references remain different',async({page})=>{
  for(const [scenario,message]of [['missing','연결 대상 없음'],['truncated','표시 범위 밖일 수 있음'],['cross_packet','Packet 참조 불일치']]){
    await page.goto(selected('fixture_evidence_'+scenario,'trade','trade_1'));await expect(inspector(page).getByText(message,{exact:false}).first()).toBeVisible();
  }
  await page.goto(root+'fixture_evidence_out_of_order?tab=evidence');await expect(page.getByText('원본 시각 순서 역전',{exact:false})).toBeVisible();
  await page.goto(root+'fixture_evidence_same_time?tab=evidence');await expect(page.getByText('동일 시각 있음',{exact:false})).toBeVisible();
  for(const [scenario,message]of [['empty','정상 판독 · 0건'],['corrupt','판독: corrupt'],['degraded','판독: degraded']]){await page.goto(root+'fixture_evidence_'+scenario+'?tab=evidence');await expect(page.getByText(message,{exact:false}).first()).toBeVisible();}
});

test('replay exposes stored packets but does not fabricate a chart or unsupported selection',async({page})=>{
  await page.goto(normal+'?tab=replay');await expect(page.getByRole('heading',{name:'저장된 Packet 사건',exact:true})).toBeVisible();
  await expect(page.getByText('자산 시계열과 재생 계약이 없어',{exact:false})).toBeVisible();
  await page.locator('a[href$="event=packet%3Apacket_1"]').click();await expect(inspector(page).getByRole('heading',{name:'Packet · packet_1'})).toBeVisible();
  await page.goto(selected('fixture_evidence_normal','risk','risk_1','replay'));await expect(inspector(page).getByText('이 탭의 사건 범위 밖',{exact:false})).toBeVisible();
});

test('evidence layout, landmarks, focus, axe and console are clean at every viewport',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.name));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(selected('fixture_evidence_normal','trade','trade_1'));await expect(page).toHaveTitle('Toss Trading Dashboard');
  await expect(page.locator('main')).toHaveCount(1);await expect(page.getByRole('heading',{level:1})).toHaveCount(1);
  await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'실행 상세로 건너뛰기'})).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('main')).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(await page.evaluate(()=>document.documentElement.clientWidth));
  await page.screenshot({path:info.outputPath('evidence.png'),fullPage:true});
  await inspector(page).getByText('검증된 표시 필드 (JSON)',{exact:true}).click();await expect(inspector(page).locator('pre')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(await page.evaluate(()=>document.documentElement.clientWidth));
  await page.addScriptTag({content:await readFile('node_modules/axe-core/axe.min.js','utf8')});
  const violations=await page.evaluate(async()=>{const axe=(window as unknown as {axe:{run:(context:Document,options:unknown)=>Promise<{violations:{id:string}[]}>}}).axe;return (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>v.id);});
  expect(violations).toEqual([]);expect(errors).toEqual([]);
});


test('automatic evidence update restores the active tab when a focused record becomes ambiguous',async({page},testInfo)=>{
  await page.clock.install();await page.goto(selected(`fixture_evidence_focus_loss_${testInfo.project.name}`,'trade','trade_1'));
  await expect(page.getByText('선택 child: running',{exact:false})).toBeVisible();
  const trade=page.locator('a[href$="event=trade%3Atrade_1"]');await trade.focus();await expect(trade).toBeFocused();
  await page.clock.fastForward(5_001);await expect(inspector(page).getByText('중복 ID · 연결 모호',{exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'판단 근거',exact:true})).toBeFocused();
  await expect(page.getByText('선택 child: completed',{exact:false})).toBeVisible();
});
