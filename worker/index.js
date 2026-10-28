const START = Date.UTC(2026,11,11), RETURN = Date.UTC(2027,0,14);
const date = ms => new Date(ms).toISOString().slice(0,10);
const maxMinutes=2100;
const DEFAULT_STOP='2026-11-27';
export function stopped(env, now=new Date()) {return now.toISOString().slice(0,10) > (env.STOP_AFTER_DATE || DEFAULT_STOP)}
export function limits(env){return {monthly: Math.max(1,Math.min(1000,Number(env.MONTHLY_REQUEST_CAP)||1000)), manual: Math.max(0,Math.min(1000,Number(env.MANUAL_REQUEST_CAP)||100)), perRun:Math.max(1,Math.min(30,Number(env.AUTO_CALLS_PER_RUN)||15))}}
const budgetMonth=()=>new Date().toISOString().slice(0,7);
export async function budgetStatus(env){const month=budgetMonth(); const counters=JSON.parse((await env.FARE_STORE.get('budget:'+month))||'{"auto":0,"manual":0}');const caps=limits(env);return {month,...counters,total:counters.auto+counters.manual,limit:caps.monthly,manualLimit:caps.manual,autoLimit:caps.monthly-caps.manual,remaining:Math.max(0,caps.monthly-counters.auto-counters.manual),stopAfter:env.STOP_AFTER_DATE||DEFAULT_STOP,stopped:stopped(env)} }
// Best-effort counters; Cloudflare KV is eventually consistent and is not suitable for a financially guaranteed hard cap across concurrent requests.
async function charge(env, mode){if(!env.FARE_STORE)throw Error('Missing FARE_STORE');if(stopped(env))throw Error('Monitoring period ended'); const key='budget:'+budgetMonth(); const entry=JSON.parse((await env.FARE_STORE.get(key))||'{"auto":0,"manual":0}');const l=limits(env);if(entry.auto+entry.manual>=l.monthly || (mode==='manual'?entry.manual>=l.manual:entry.auto>=l.monthly-l.manual))throw Error('Search credit budget reached; check paused');entry[mode]++; await env.FARE_STORE.put(key,JSON.stringify(entry),{expirationTtl:86400*45});}

function allowedDate(d, start, days){return Array.from({length:days},(_,i)=>date(start+i*86400000)).includes(d)}
// User-approved carriers. Every marketing and operating carrier explicitly returned by
// the provider must be one of these; codeshare flights operated by Air India are rejected.
export const ALLOWED_AIRLINES = Object.freeze({
 QR:'Qatar Airways', EK:'Emirates', SQ:'Singapore Airlines', CX:'Cathay Pacific',
 LH:'Lufthansa', BA:'British Airways', KL:'KLM', EY:'Etihad Airways',
 TK:'Turkish Airlines', UA:'United Airlines', VS:'Virgin Atlantic',
 LX:'Swiss International Air Lines'
});
const normalize = value => String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const allowedCodes = Object.keys(ALLOWED_AIRLINES);
function airlineAllowed(value){
 const n=normalize(value);
 return allowedCodes.some(c=>normalize(c)===n || normalize(ALLOWED_AIRLINES[c])===n) ||
  ({swiss:'LX',swissairlines:'LX',swissinternational:'LX',qatar:'QR',emiratesairline:'EK',singapore:'SQ',cathay:'CX',etihad:'EY',turkish:'TK',united:'UA',virgin:'VS'}[n] !== undefined);
}
function valid(o){
 return !!o && Number.isFinite(o.total_duration) && o.total_duration>=0 && o.total_duration<=maxMinutes &&
 Array.isArray(o.flights) && o.flights.length>0 && o.flights.every(f=>{
  if(!airlineAllowed(f.airline))return false;
  // Some providers do not disclose operator. Never treat unknown as proof.
  if(f.operated_by && !airlineAllowed(f.operated_by))return false;
  if(f.plane_and_crew_by && !airlineAllowed(f.plane_and_crew_by))return false;
  const flightNumber=String(f.flight_number||'').trim().toUpperCase();
  const prefix=flightNumber.match(/^([A-Z0-9]{2})\s*\d/);
  return !prefix || allowedCodes.includes(prefix[1]);
 });
}
const options = data => [...(data.best_flights||[]),...(data.other_flights||[])];
function summary(o){return {duration:o.total_duration,airlines:[...new Set(o.flights.map(f=>f.airline||'?'))].join(', '),stops:Math.max(0,o.flights.length-1)}}
export function allPairs(){return Array.from({length:15},(_,i)=>date(START+i*86400000)).flatMap(out=>Array.from({length:4},(_,j)=>({out,back:date(RETURN+j*86400000)})))}
function cors(origin,env){const allowed=(env.ALLOWED_ORIGIN||'').replace(/\/$/,'');return origin===allowed?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{}}
function response(body,status,origin,env){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors(origin,env)}})}
async function google(params,key,env,mode){await charge(env,mode);const url=new URL('https://serpapi.com/search.json');for(const [k,v] of Object.entries({...params,engine:'google_flights',api_key:key,departure_id:'SFO',arrival_id:'HYD',type:'1',currency:'USD',adults:'1',travel_class:'1',include_airlines:allowedCodes.join(','),max_duration:String(maxMinutes)}))url.searchParams.set(k,v);const res=await fetch(url,{signal:AbortSignal.timeout(25000)});if(!res.ok)throw new Error(`Flight provider HTTP ${res.status}`);const data=await res.json();if(data.error)throw new Error(String(data.error));return data}
// Only airline-issued, single-ticket booking options qualify for price alerts.
// SerpApi's booking-options endpoint marks genuine airline sellers with airline:true.
export function verifiedAirlineOffers(data){
 const arr=Array.isArray(data?.booking_options)?data.booking_options:[];
 return arr.filter(o=>!o.separate_tickets && o.together?.airline===true &&
   airlineAllowed(o.together.book_with) && Number.isFinite(o.together.price) && o.together.price>0)
  .map(o=>({seller:o.together.book_with,price:o.together.price}))
  .sort((a,b)=>a.price-b.price);
}
async function scanPair(out,back,key,env,mode="manual",maxCalls=5){
 let calls=0;const errors=[];const results=[];let considered=0,checked=0;
 const first=await google({outbound_date:out,return_date:back},key,env,mode);calls++;
 const outbounds=options(first).filter(o=>valid(o)&&o.departure_token);
 considered=outbounds.length;
 // Every confirmed result takes an initial search, a return search, and a booking lookup.
 for(const outbound of outbounds){
  if(calls+2>maxCalls)break;
  try{
   const second=await google({outbound_date:out,return_date:back,departure_token:outbound.departure_token},key,env,mode);calls++;checked++;
   for(const inbound of options(second)){
    if(calls>=maxCalls)break;
    if(!valid(inbound)||!inbound.booking_token)continue;
    const booking=await google({booking_token:inbound.booking_token},key,env,mode);calls++;
    const offers=verifiedAirlineOffers(booking);
    if(!offers.length)continue;
    const selected=offers[0];
    results.push({out,back,price:selected.price,source:'airline-direct via Google Flights booking options',
     seller:selected.seller,airlineDirectVerified:true,outbound:summary(outbound),inbound:summary(inbound),
     url:`https://www.google.com/travel/flights?${new URLSearchParams({q:`SFO to HYD ${out} return ${back}`})}`});
   }
  }catch(e){errors.push(e.message);if(/quota|limit|key|credits|budget|period ended/i.test(e.message))throw e}
 }
 return {results:results.sort((a,b)=>a.price-b.price).slice(0,12),calls,errors,considered,checked};
}
// A scheduled Worker doesn't need a persistent process. KV stores the rolling cursor,
// latest monitored fares and notification deduplication across invocations.
export function shouldAlert(price, previous, threshold=1500){return Number.isFinite(price) && (price<threshold && (previous==null || price<previous) || previous!=null && previous-price>=100)}
// Resend transactional email via HTTPS. For the onboarding@resend.dev sender,
// Resend restricts recipients to the account owner's verified email address.
// Use a sender from your own verified domain for production sending.
export function emailConfigured(env){return !!(env.RESEND_API_KEY && env.ALERT_EMAIL_TO && env.ALERT_EMAIL_FROM)}
export async function sendEmail(env,offer,previous){
 if(!emailConfigured(env))return false;
 const duration = d => `${Math.floor(d/60)}h ${d%60}m`;
 const line = [
  `Round trip: $${offer.price} USD (airline-sold booking option)`,
  `Airline seller: ${offer.seller}`,
  `Flight carriers: ${offer.outbound.airlines} / ${offer.inbound.airlines}`,
  `Depart SFO: ${offer.out}`,
  `Depart HYD: ${offer.back}`,
  `Outbound / return durations: ${duration(offer.outbound.duration)} / ${duration(offer.inbound.duration)}`,
  previous==null?'First observed price':`Previous lowest observed: $${previous} USD`,
  `View itinerary: ${offer.url}`,
  'Price is from Google Flights airline booking options; check final airline checkout before paying.'
 ].join('\n');
 const resp=await fetch('https://api.resend.com/emails',{
  method:'POST',
  headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},
  body:JSON.stringify({from:env.ALERT_EMAIL_FROM,to:[env.ALERT_EMAIL_TO],
   subject:`Flight fare alert: $${offer.price} SFO–HYD (${offer.out} / ${offer.back})`,text:line})
 });
 if(!resp.ok){const body=(await resp.text()).slice(0,400);throw Error(`Email API error ${resp.status}: ${body}`)}
 return true;
}
export async function runMonitor(env){
 if(!env.FARE_STORE)throw Error('FARE_STORE KV binding is not configured');
 if(!env.SERPAPI_KEY)throw Error('SERPAPI_KEY secret missing');
 const pairs=allPairs();
 const batch=Math.max(1,Math.min(60,Number(env.PAIRS_PER_RUN)||8));
 const perRun=limits(env).perRun; if(stopped(env)){const state={stopped:true,stopAfter:env.STOP_AFTER_DATE||DEFAULT_STOP,checked:0,totalPairs:60,startedAt:new Date().toISOString(),budget:await budgetStatus(env)};await env.FARE_STORE.put('status',JSON.stringify(state));return state}
 let cursor=Number(await env.FARE_STORE.get('cursor'))||0;
 const startedAt=new Date().toISOString();let checked=0, providerCalls=0, alerts=0, errors=[], cheapest=null;
 for(let i=0;i<batch && providerCalls<perRun;i++){
  const pair=pairs[(cursor+i)%pairs.length];
  try{
   const r=await scanPair(pair.out,pair.back,env.SERPAPI_KEY,env,"auto",Math.min(5,perRun-providerCalls));
   providerCalls+=r.calls;
   if(r.errors.length)errors.push(`${pair.out}/${pair.back}: ${r.errors[0]}`);
   for(const offer of r.results){
    if(!offer.airlineDirectVerified)continue;
    if(!cheapest || offer.price<cheapest.price)cheapest=offer;
    const key=`fare:${offer.out}:${offer.back}:${offer.outbound.airlines}:${offer.inbound.airlines}:${offer.outbound.duration}:${offer.inbound.duration}`;
    const previousRaw=await env.FARE_STORE.get(key);
    const previous=previousRaw===null?null:Number(previousRaw);
    const threshold=Number(env.ALERT_PRICE_USD)||1500;
    if(shouldAlert(offer.price,previous,threshold) && emailConfigured(env)){
     try{if(await sendEmail(env,offer,previous))alerts++}catch(e){errors.push(e.message)}
    }
    // Keep the lowest observed fare, so an increase never resets the alert baseline.
    if(previous===null || offer.price<previous)await env.FARE_STORE.put(key,String(offer.price),{expirationTtl:60*60*24*90});
   }
  }catch(e){errors.push(`${pair.out}/${pair.back}: ${e.message}`);
    if(/quota|credits|invalid api key|limit|budget|period ended/i.test(e.message)) {checked++;break;}
  }
  checked++;
 }
 cursor=(cursor+checked)%pairs.length;
 await env.FARE_STORE.put('cursor',String(cursor));
 const state={startedAt,checked,totalPairs:60,providerCalls,alerts,errors:errors.slice(0,8),nextPair:cursor,cheapest,alertPrice:Number(env.ALERT_PRICE_USD)||1500,notificationConfigured:emailConfigured(env),notificationChannel:'Email (Resend)',allowedAirlines:allowedCodes,mode:'credit-limited rotation',pairsPerRun:batch,budget:await budgetStatus(env),stopAfter:env.STOP_AFTER_DATE||DEFAULT_STOP};
 await env.FARE_STORE.put('status',JSON.stringify(state));
 return state;
}
export default {
 async scheduled(_event,env,ctx){ctx.waitUntil(runMonitor(env))},
 async fetch(request,env){
  const origin=request.headers.get('Origin')||'';
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors(origin,env),'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}});
  if(origin!==(env.ALLOWED_ORIGIN||'').replace(/\/$/,''))return response({error:'Origin not permitted'},403,origin,env);
  const url=new URL(request.url);
  if(request.method!=='GET')return response({error:'Not found'},404,origin,env);
  if(url.pathname==='/api/status'){
   if(!env.FARE_STORE)return response({error:'KV binding is missing'},503,origin,env);
   const saved=await env.FARE_STORE.get('status');return response({... (saved?JSON.parse(saved):{status:'No scheduled check completed yet',alertPrice:1500}),budget:await budgetStatus(env)},200,origin,env);
  }
  if(url.pathname!=='/api/check')return response({error:'Not found'},404,origin,env);
  const out=url.searchParams.get('out'),back=url.searchParams.get('back');
  if(!allowedDate(out,START,15)||!allowedDate(back,RETURN,4))return response({error:'Dates outside configured ranges'},400,origin,env);
  if(!env.SERPAPI_KEY)return response({error:'Server missing SERPAPI_KEY'},503,origin,env);
  if(!env.FARE_STORE)return response({error:'KV binding is missing'},503,origin,env);
  if(stopped(env))return response({error:'Monitoring period ended'},410,origin,env);
  try{return response({out,back,...await scanPair(out,back,env.SERPAPI_KEY,env,"manual",5)},200,origin,env)}catch(e){return response({error:e.message},502,origin,env)}
 }
};
export {valid,scanPair,allowedDate};
