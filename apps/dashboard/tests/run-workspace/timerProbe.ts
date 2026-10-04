import type {Page} from '@playwright/test';
// Observe existing browser timers/listeners; no product readiness API or delay.
export async function observeRunTimer(page:Page){await page.addInitScript(()=>{
  const events:Array<{kind:string;at:number;hidden:boolean}>=[];
  (window as unknown as {runTimerProbe:typeof events}).runTimerProbe=events;
  const mark=(kind:string)=>events.push({kind,at:Date.now(),hidden:document.hidden});
  const timers=new Set<number>(),schedule=window.setTimeout.bind(window),cancel=window.clearTimeout.bind(window),add=document.addEventListener.bind(document);
  add('visibilitychange',()=>mark('visibility-event'));
  document.addEventListener=((type:string,listener:EventListenerOrEventListenerObject,options?:boolean|AddEventListenerOptions)=>{if(type==='visibilitychange'){document.documentElement.setAttribute('data-test-visibility-listener-ready','true');mark('visibility-listener-installed');}add(type,listener,options);}) as typeof document.addEventListener;
  window.setTimeout=((handler:TimerHandler,delay?:number,...args:unknown[])=>{let id=0;const observed=delay===5_000&&typeof handler==='function'?(...values:unknown[])=>{timers.delete(id);document.documentElement.setAttribute('data-test-run-timer-active',String(timers.size));mark('timer-fired');(handler as (...args:unknown[])=>void)(...values);}:handler;id=schedule(observed,delay,...args);if(delay===5_000){timers.add(id);document.documentElement.setAttribute('data-test-run-timer-ready','true');document.documentElement.setAttribute('data-test-run-timer-active',String(timers.size));mark('timer-installed');}return id;}) as typeof window.setTimeout;
  window.clearTimeout=((id?:number)=>{if(id!==undefined&&timers.delete(id)){document.documentElement.setAttribute('data-test-run-timer-active',String(timers.size));mark('timer-cleared');}cancel(id);}) as typeof window.clearTimeout;
});}
