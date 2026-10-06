import {expect,test,type Page,type APIRequestContext} from '@playwright/test';

// Compare is a server document, not a client polling component. Commit each
// browser navigation separately; hold the actual backend reads independently.
export async function heldComparisonNavigation(page:Page,request:APIRequestContext,options:{api:string;project:string;baseline:string;candidate:string;provenance:boolean}){
  const generation=`selection_${options.project}`,heldId=`fixture_held_${generation}`;
  const observations:Array<{stage:string;value:unknown}>=[];
  const route=(a:string,b:string)=>`/dashboard/experiments/compare?baseline=${a}&candidate=${b}`;
  const endpoints=options.provenance?['/batch/replay/runs','/batch/replay/runs/provenance']:['/batch/replay/runs'];
  const control=async(endpoint:string,op:string)=>{const response=await request.get(`${options.api}/__gate?${new URLSearchParams({generation,id:heldId,endpoint,op})}`,{headers:{'x-fixture-gate':'synthetic-read-v1'}});expect(response.status()).toBe(200);return response.json() as Promise<{generation:string;endpoint:string;id:string;started:boolean;pending:boolean;released:boolean;closed:boolean;finished:boolean;ageMs:number}>;};
  await page.goto(route(options.baseline,options.candidate));
  await expect(page.getByTestId('comparison-baseline')).toContainText(options.baseline);
  await expect(page.getByTestId('comparison-candidate')).toContainText(options.candidate);
  for(const endpoint of endpoints)await control(endpoint,'arm');
  try{
    await page.goto(route(heldId,options.candidate),{waitUntil:'commit'});
    observations.push({stage:'old-document-committed',value:page.url()});
    for(const endpoint of endpoints){
      await expect.poll(async()=>(await control(endpoint,'state')).started).toBe(true);
      const state=await control(endpoint,'state');observations.push({stage:'before-overlap',value:state});expect(state.generation).toBe(generation);expect(state.endpoint).toBe(endpoint);expect(state.id).toBe(heldId);expect(state.pending).toBe(true);expect(state.closed).toBe(false);expect(state.ageMs).toBeLessThan(2_000);
    }
    // No outstanding Page.navigate RPC: the old document committed, while the
    // exact application GET(s) above remain held, before the new navigation.
    await page.goto(route(options.baseline,options.candidate),{waitUntil:'commit'});
    observations.push({stage:'new-document-committed',value:page.url()});
    for(const endpoint of endpoints){const state=await control(endpoint,'state');observations.push({stage:'before-release',value:state});expect(state.started).toBe(true);expect(state.released).toBe(false);expect(state.ageMs).toBeLessThan(2_000);await control(endpoint,'release');await expect.poll(async()=>{const result=await control(endpoint,'state');return result.finished||result.closed;}).toBe(true);observations.push({stage:'old-response-finished-or-canceled',value:await control(endpoint,'state')});}
    await expect(page.getByTestId('comparison-baseline')).toContainText(options.baseline);
    await expect(page.getByTestId('comparison-candidate')).toContainText(options.candidate);
    await expect(page).toHaveURL(new RegExp(`baseline=${options.baseline}&candidate=${options.candidate}$`));
    await expect(page.getByRole('main')).not.toContainText(heldId);
    if(options.provenance){for(const[key,id]of [['comparison-baseline',options.baseline],['comparison-candidate',options.candidate]]){const panel=page.getByTestId(key).getByTestId('run-provenance');await expect(panel).toContainText(`요청 exact ID: ${id}`);await expect(panel).toContainText('일부 저장 관측');await panel.getByText('실행 설정',{exact:true}).click();const cash=panel.locator('dl > div').filter({has:page.locator('dt').filter({hasText:/^configuration\.initialCashKrw$/})}).locator('dd > span');await expect(cash).toHaveText('0');await panel.getByText('저장 hash',{exact:true}).click();await expect(panel).toContainText('sha256:'+'1'.repeat(64));await expect(panel).not.toContainText('sha256:'+'2'.repeat(64));}}
    observations.push({stage:'new-pair-assertions-passed',value:page.url()});
  }finally{for(const endpoint of endpoints)await control(endpoint,'release');await test.info().attach('held-request-generation-order',{body:JSON.stringify(observations,null,2),contentType:'application/json'});}
}
