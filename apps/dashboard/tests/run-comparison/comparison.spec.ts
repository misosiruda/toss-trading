import {test,expect} from '@playwright/test';
import path from 'node:path';
import {createRequire} from 'node:module';
const resolve=createRequire(path.join(__dirname,'package.json'));
const url=(baseline='fixture_base',candidate='fixture_candidate')=>`/dashboard/experiments/compare?baseline=${baseline}&candidate=${candidate}`;

test('blocked, source-invalid, clipped duplicate and selected disagreement suppress only affected evidence',async({page})=>{
  for(const [id,label] of [['fixture_endpoint_blocked','차단'],['fixture_stored_running','응답 확인 필요'],['fixture_no_active_id','실행 ID 불일치'],['fixture_outside_duplicate','전체 기록 확인 불가'],['fixture_selected_mismatch','실행 ID 불일치']] as const){
    await page.goto(url('fixture_base',id));
    await expect(page.getByTestId('comparison-baseline').getByRole('table')).toBeVisible();
    const candidate=page.getByTestId('comparison-candidate');await expect(candidate).toContainText(label);
    await expect(candidate.getByRole('table')).toHaveCount(0);await expect(candidate.getByRole('link')).toHaveCount(0);
    if(id==='fixture_endpoint_blocked')await expect(candidate).not.toContainText('저장 실행 없음');
  }
  await page.goto(url('fixture_running','fixture_base'));
  await expect(page.getByTestId('comparison-baseline')).toContainText('manifest 진행 관측');
  await expect(page.getByTestId('comparison-candidate')).toContainText('저장 종료 기록');
  await page.goto(url('fixture_aggregate_fallback','fixture_base'));
  await expect(page.getByTestId('comparison-baseline')).toContainText('저장 종료 기록');
  await expect(page.getByTestId('comparison-baseline').getByRole('table')).toBeVisible();
  await expect(page.getByTestId('comparison-baseline').getByRole('link',{name:'이 실행 상세 보기'})).toBeVisible();
});

test('list entry reaches an empty selector and long exact IDs stay within the viewport',async({page})=>{
  await page.goto('/dashboard');await page.getByRole('link',{name:'실행 비교',exact:true}).click();await expect(page).toHaveURL(/\/dashboard\/experiments\/compare$/);await expect(page.getByTestId('comparison-baseline')).toHaveCount(0);
  const id='fixture_'+ 'x'.repeat(240);await page.getByRole('textbox',{name:'기준 실행 ID'}).fill(id);await page.getByRole('textbox',{name:'후보 실행 ID'}).fill('fixture_candidate');await page.getByRole('button',{name:'두 실행 조회'}).click();await expect(page.getByTestId('comparison-baseline')).toContainText(id);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('two stored runs expose independent status and scope while comparison and clone stay unavailable',async({page,request},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(url());const baseline=page.getByTestId('comparison-baseline'),candidate=page.getByTestId('comparison-candidate');
  await expect(baseline).toContainText('fixture_base');await expect(candidate).toContainText('fixture_candidate');await expect(baseline).toContainText('완료');
  await expect(page.getByRole('heading',{name:'비교 제한'})).toBeVisible();await expect(page.getByRole('button',{name:'입력 복제 사용 불가'})).toBeDisabled();
  await expect(baseline.getByRole('table')).toContainText('1 / 1');await expect(candidate.getByRole('table')).toContainText('유효 1 · 제외 0');
  await expect(page.getByRole('main')).not.toContainText(/수익률|순위 1|승률|복제 완료/);
  await page.addScriptTag({path:resolve.resolve('axe-core/axe.min.js')});
  const violations=await page.evaluate(async()=>{const axe=(window as unknown as {axe:{run:(scope:Element,opts:unknown)=>Promise<{violations:unknown[]}>}}).axe;return (await axe.run(document.querySelector('main')!,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations;});expect(violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);expect(errors).toEqual([]);
  const calls=await (await request.get('http://127.0.0.1:8795/__calls')).json();expect(calls.every((c:{method:string})=>c.method==='GET')).toBe(true);
  if(process.env.UX06_ARTIFACTS)await page.screenshot({path:path.join(process.env.UX06_ARTIFACTS,`ux06-${testInfo.project.name}.png`),fullPage:true});
});

test('keyboard GET selection and Back Forward reload retain exact chosen pair',async({page})=>{
  await page.goto(url());await page.getByRole('textbox',{name:'기준 실행 ID'}).fill('fixture_running');await page.getByRole('textbox',{name:'후보 실행 ID'}).fill('fixture_partial');
  await page.getByRole('textbox',{name:'후보 실행 ID'}).press('Tab');await expect(page.getByRole('button',{name:'두 실행 조회'})).toBeFocused();await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/baseline=fixture_running&candidate=fixture_partial$/);await expect(page.getByTestId('comparison-baseline')).toContainText('진행 중');await expect(page.getByTestId('comparison-candidate')).toContainText('부분 실패');
  await page.goBack();await expect(page).toHaveURL(/baseline=fixture_base&candidate=fixture_candidate$/);await expect(page.getByTestId('comparison-candidate')).toContainText('fixture_candidate');
  await page.goForward();await expect(page.getByTestId('comparison-baseline')).toContainText('fixture_running');await page.reload();await expect(page.getByRole('textbox',{name:'후보 실행 ID'})).toHaveValue('fixture_partial');
  await page.getByTestId('comparison-baseline').getByRole('link',{name:'이 실행 상세 보기'}).click();await expect(page).toHaveURL(/\/dashboard\/lab\/runs\/fixture_running$/);
});

test('offline missing mismatched duplicate and malformed evidence isolate one column',async({page})=>{
  for(const [id,label] of [['fixture_offline','조회 연결 불가'],['fixture_missing','저장 실행 없음'],['fixture_alias','실행 ID 불일치'],['fixture_duplicate','중복 실행 ID']] as const){
    await page.goto(url('fixture_base',id));await expect(page.getByTestId('comparison-baseline')).toContainText('fixture_base');await expect(page.getByTestId('comparison-baseline').getByRole('table')).toBeVisible();const candidate=page.getByTestId('comparison-candidate');await expect(candidate).toContainText(label);await expect(candidate.getByRole('table')).toHaveCount(0);await expect(candidate.getByRole('link',{name:'이 실행 상세 보기'})).toHaveCount(0);
  }
  await page.goto(url('fixture_base','fixture_bad'));const candidate=page.getByTestId('comparison-candidate');await expect(candidate.getByRole('table')).toContainText('유효 0 · 제외 1');await expect(candidate).toContainText('조회됨');
});

test('true empty clipped and other-child artifacts remain distinct',async({page})=>{
  await page.goto(url('fixture_empty','fixture_clipped'));await expect(page.getByTestId('comparison-baseline').getByRole('table')).toContainText('0 / 0');await expect(page.getByTestId('comparison-baseline')).toContainText('잘림 없음');await expect(page.getByTestId('comparison-candidate').getByRole('table')).toContainText('1 / 120');await expect(page.getByTestId('comparison-candidate')).toContainText('일부 반환');
  await page.goto(url('fixture_base','fixture_mismatch'));const candidate=page.getByTestId('comparison-candidate');await expect(candidate).toContainText('다른 실행의 자료나 0건으로 대체하지 않아요.');await expect(candidate.getByRole('table')).toHaveCount(0);
});

test('invalid selections do not query runs or silently select a default',async({page,request})=>{
  for(const query of ['baseline=fixture_base&candidate=fixture_base','baseline=fixture_base&candidate=fixture_candidate&candidate=fixture_third','baseline=..%2Ffixture_base&candidate=fixture_candidate']){
    const before=(await (await request.get('http://127.0.0.1:8795/__calls')).json()).length;await page.goto('/dashboard/experiments/compare?'+query);await expect(page.getByRole('main').getByRole('alert')).toBeVisible();await expect(page.getByTestId('comparison-baseline')).toHaveCount(0);const after=(await (await request.get('http://127.0.0.1:8795/__calls')).json()).length;expect(after).toBe(before);
  }
});

test('a newer document selection wins over an unfinished prior GET',async({page,request})=>{
  await page.goto(url());const before=(await (await request.get('http://127.0.0.1:8795/__calls')).json()).filter((c:{id:string})=>c.id==='fixture_slow').length;
  let settled=false;const old=page.goto(url('fixture_slow','fixture_candidate')).catch(()=>null).finally(()=>{settled=true;});
  await expect.poll(async()=>(await (await request.get('http://127.0.0.1:8795/__calls')).json()).filter((c:{id:string})=>c.id==='fixture_slow').length).toBeGreaterThan(before);expect(settled).toBe(false);
  await page.goto(url('fixture_base','fixture_partial'));await old;await expect(page.getByTestId('comparison-baseline')).toContainText('fixture_base');await expect(page.getByTestId('comparison-candidate')).toContainText('fixture_partial');await expect(page).toHaveURL(/baseline=fixture_base&candidate=fixture_partial$/);
});
