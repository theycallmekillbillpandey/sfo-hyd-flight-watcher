import test from 'node:test';
import assert from 'node:assert/strict';
import {valid,ALLOWED_AIRLINES,whatsappConfigured,sendWhatsApp} from '../worker/index.js';
const leg=(airline,extra={})=>({total_duration:2000,flights:[{airline,...extra}]});
test('exactly twelve approved airline codes including Swiss and Virgin',()=>{assert.deepEqual(Object.keys(ALLOWED_AIRLINES).sort(),['BA','CX','EK','EY','KL','LH','LX','QR','SQ','TK','UA','VS'].sort());assert.equal(valid(leg('SWISS')),true);assert.equal(valid(leg('Virgin Atlantic')),true)});
test('reject unapproved carrier on any segment including operator',()=>{assert.equal(valid(leg('Delta Air Lines')),false);assert.equal(valid(leg('SWISS',{operated_by:'Air India'})),false);assert.equal(valid(leg('Virgin Atlantic',{flight_number:'AI 101'})),false);assert.equal(valid({total_duration:1600,flights:[{airline:'Qatar Airways'},{airline:'IndiGo'}]}),false)});
test('WhatsApp integration sends template variables using Twilio form request',async()=>{
 const env={TWILIO_ACCOUNT_SID:'AC123',TWILIO_AUTH_TOKEN:'secret',TWILIO_WHATSAPP_FROM:'+15550001111',ALERT_WHATSAPP_TO:'+15550002222',TWILIO_CONTENT_SID:'HXabc'};
 assert.equal(whatsappConfigured(env),true);
 const saved=globalThis.fetch;
 globalThis.fetch=async (url,options)=>{
  assert.match(url,/api.twilio.com\/2010-04-01\/Accounts\/AC123\/Messages.json/);
  assert.equal(options.method,'POST');
  assert.equal(options.body.get('From'),'whatsapp:+15550001111');
  assert.equal(options.body.get('To'),'whatsapp:+15550002222');
  assert.equal(options.body.get('ContentSid'),'HXabc');
  const vars=JSON.parse(options.body.get('ContentVariables'));
  assert.equal(vars['1'],'$1450');assert.equal(vars['2'],'SWISS / Virgin Atlantic');assert.equal(vars['7'],'https://www.google.com/travel/flights');
  return new Response(JSON.stringify({sid:'SM123'}),{status:201});
 };
 try{assert.equal(await sendWhatsApp(env,{price:1450,out:'2026-12-18',back:'2027-01-14',outbound:{airlines:'SWISS',duration:1200},inbound:{airlines:'Virgin Atlantic',duration:1300},url:'https://www.google.com/travel/flights'}),true)}finally{globalThis.fetch=saved}
});
