import test from 'node:test';import assert from 'node:assert/strict';import {phone,importContacts,personalize,campaignInput} from '../core.js';
test('normalizes Brazilian and international phone numbers',()=>{assert.equal(phone('(65) 99999-1234'),'5565999991234');assert.equal(phone('+1 415 555 1234'),'14155551234');assert.throws(()=>phone('123'));});
test('CSV handles quoted names, duplicates and invalid phones',()=>{const r=importContacts(Buffer.from('nome;telefone\n"Maria; Silva";65999991234\nMaria;+5565999991234\nRuim;abc'),'agenda.csv');assert.equal(r.contacts.length,1);assert.equal(r.duplicates,1);assert.equal(r.invalid,1);});
test('vCard accepts multiple phones and folded lines',()=>{const r=importContacts(Buffer.from('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Maria\r\n Silva\r\nTEL;TYPE=CELL:+5565999991234\r\nTEL;TYPE=HOME:+5565999994321\r\nEND:VCARD'),'agenda.vcf');assert.equal(r.contacts.length,2);assert.equal(r.contacts[0].name,'MariaSilva');});
test('campaign validates intervals, limits and scheduling',()=>{const b={name:'Oferta',instance:'dz-vendas',text:'Olá',minDelay:60,maxDelay:120,dailyLimit:50};assert.equal(campaignInput(b).min,60);assert.throws(()=>campaignInput({...b,maxDelay:30}));assert.throws(()=>campaignInput({...b,minDelay:0}));assert.throws(()=>campaignInput({...b,dailyLimit:5000}));assert.throws(()=>campaignInput({...b,schedule:'invalid'}));});
test('personalization treats names as literal text',()=>{assert.equal(personalize('Olá, {{nome}}!',{name:'$& Maria'}),'Olá, $& Maria!');});

test('SAIR only accepts incoming direct messages and phone JIDs', async()=>{
 const {optOutPhones}=await import('../core.js');
 const payload={event:'messages.upsert',data:{key:{fromMe:false,remoteJid:'5565999991234@s.whatsapp.net'},message:{conversation:'  sair! '}}};
 assert.deepEqual(optOutPhones(payload),['5565999991234']);
 assert.deepEqual(optOutPhones({...payload,data:{...payload.data,key:{...payload.data.key,fromMe:true}}}),[]);
 assert.deepEqual(optOutPhones({...payload,data:{...payload.data,key:{...payload.data.key,remoteJid:'1234567890@g.us'}}}),[]);
 assert.deepEqual(optOutPhones({...payload,event:'messages.update'}),[]);
 assert.deepEqual(optOutPhones({...payload,data:{...payload.data,message:{conversation:'Não quero sair hoje'}}}),[]);
 assert.deepEqual(optOutPhones({...payload,data:{...payload.data,key:{fromMe:false,remoteJid:'1234567890@lid',remoteJidAlt:'5565999991234@s.whatsapp.net'}}}),['5565999991234']);
});

test('reports preserve reasons, filter uncertain sends, and export safe CSV',async()=>{
 const {reportReason,reportFilter,reportCsv,evolutionErrorDetail}=await import('../core.js');
 const campaign={name:'Campanha "teste"',instance:'dz-test',status:'draft'};
 const rows=[{name:'=HYPERLINK("malicioso")',phone:'5565999991234',status:'uncertain',error:'HTTP 500; erro\ncom detalhe',updated_at:'2026-10-03 20:00:00'},{name:'Maria',phone:'5565999994321',status:'sent'}].map(r=>({...r,reason:reportReason(r,campaign)}));
 assert.equal(reportFilter(rows,'issues').length,1);assert.throws(()=>reportFilter(rows,'invalid'));assert.equal(reportReason({status:'pending'},campaign),'Rascunho: envio não iniciado.');
 const csv=reportCsv(campaign,rows),parsed=importContacts(Buffer.from(csv),'relatorio.csv');assert.equal(parsed.contacts.length,2);assert.equal(parsed.invalid,0);assert.match(csv,/'=HYPERLINK/);assert.match(csv,/HTTP 500; erro\ncom detalhe/);assert.match(csv,/Campanha ""teste""/);
 assert.equal(evolutionErrorDetail({response:{message:[['Número inválido']]},error:'Bad Request'}),'Número inválido; Bad Request');
});

test('late delivery failures accept only ERROR message updates',async()=>{
 const {failedMessageIds}=await import('../core.js');const payload={event:'messages.update',data:{key:{id:'ABC123',fromMe:true},status:'ERROR'}};
 assert.deepEqual(failedMessageIds(payload),['ABC123']);assert.deepEqual(failedMessageIds({...payload,event:'messages.upsert'}),[]);assert.deepEqual(failedMessageIds({...payload,data:{...payload.data,status:'DELIVERY_ACK'}}),[]);assert.deepEqual(failedMessageIds({...payload,data:{...payload.data,key:{id:'ABC123',fromMe:false}}}),[]);
});

test('failed receipts retain only validated WhatsApp error codes',async()=>{
 const {failedMessageReasons}=await import('../core.js');
 const event={event:'messages.update',data:{keyId:'ABC123',fromMe:true,status:'ERROR',messageStubParameters:['463','Your account is restricted','secret-value']}};
 assert.deepEqual(failedMessageReasons(event),[{id:'ABC123',error:'Evolution informou ERROR após aceitar o envio; código WhatsApp: 463.'}]);
 assert.deepEqual(failedMessageReasons({...event,data:{...event.data,fromMe:false}}),[]);
});

test('imports reject excessive records before building the contact map',()=>{assert.throws(()=>importContacts(Buffer.from('nome,telefone\n'+'Teste,65999991234\n'.repeat(10001)),'agenda.csv'),/10.000 registros/);});
