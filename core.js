import { parse } from 'csv-parse/sync';
export function phone(value) {
  const original = String(value ?? '').trim();
  const international = original.startsWith('+') || original.startsWith('00');
  let n = original.replace(/\D/g, '');
  if (n.startsWith('00')) n = n.slice(2);
  if (!international && (n.length === 10 || n.length === 11)) n = '55' + n;
  if (!/^[1-9]\d{9,14}$/.test(n)) throw new Error('Número inválido. Use DDI + DDD + telefone.');
  return n;
}
export function personalize(text, contact) { return text.replace(/\{\{nome\}\}/gi, () => contact.name); }
export function importContacts(buffer, filename) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  let rows;
  if (/\.vcf$/i.test(filename)) {
    rows = [];
    for (const block of text.replace(/\r?\n[ \t]/g, '').split(/BEGIN:VCARD/i).slice(1)) {
      const name = block.match(/^FN(?:;[^:]*)?:(.*)$/im)?.[1]?.trim() || 'Contato';
      for (const tel of block.matchAll(/^TEL(?:;[^:]*)?:(.*)$/gim)) rows.push({ name, phone: tel[1].replace(/^tel:/i, '').trim() });
    }
  } else if (/\.csv$/i.test(filename)) {
    const header = text.split(/\r?\n/)[0];
    rows = parse(text, { columns: h => h.map(x => x.trim().toLowerCase()), skip_empty_lines: true, delimiter: header.includes(';') ? ';' : ',', trim: true })
      .map(r => ({ name: r.nome || r.name || 'Contato', phone: r.telefone || r.phone || r.numero || r['número'] }));
  } else throw new Error('Importe um arquivo CSV ou vCard (.vcf).');
  let invalid = 0;
  const contacts = new Map();
  for (const row of rows) {
    try { const number = phone(row.phone); contacts.set(number, { name: String(row.name).slice(0,120), phone: number }); } catch { invalid++; }
  }
  if (contacts.size > 10000) throw new Error('Limite de 10.000 contatos por importação.');
  return { contacts: [...contacts.values()], invalid, duplicates: rows.length - invalid - contacts.size };
}
export function campaignInput(b) {
  const min = Number(b.minDelay ?? 60), max = Number(b.maxDelay ?? 120), daily = Number(b.dailyLimit ?? 50);
  if (![min,max,daily].every(Number.isInteger) || min < 30 || max < min || max > 3600 || daily < 1 || daily > 1000) throw new Error('Intervalos: 30 a 3.600 segundos. Limite diário: 1 a 1.000.');
  if (!b.name?.trim() || b.name.length > 120 || !b.instance || !b.text?.trim() || b.text.length > 4000) throw new Error('Informe nome, conexão e mensagem (até 4.000 caracteres).');
  if (b.schedule && (!Number.isFinite(Date.parse(b.schedule)) || Date.parse(b.schedule) < Date.now() - 60000)) throw new Error('Escolha uma data futura para agendar.');
  return { min, max, daily };
}

export const replyOptOutFooter = 'Para parar de receber mensagens, responda SAIR.';
export function optOutPhones(payload) {
  if (String(payload?.event).toLowerCase().replace(/[._-]/g,'') !== 'messagesupsert') return [];
  const items=Array.isArray(payload.data)?payload.data:[payload.data],numbers=new Set();
  for(const item of items){
    const key=item?.key;if(key?.fromMe!==false)continue;
    const message=item.message?.ephemeralMessage?.message||item.message;
    const text=message?.conversation||message?.extendedTextMessage?.text||message?.imageMessage?.caption||message?.videoMessage?.caption;
    if(typeof text!=='string'||!/^sair[.!]?$/i.test(text.trim()))continue;
    let jid=key.remoteJid;
    if(typeof jid==='string'&&jid.endsWith('@lid'))jid=key.remoteJidAlt;
    if(typeof jid!=='string'||!/^\d{10,15}@s\.whatsapp\.net$/.test(jid))continue;
    numbers.add(jid.split('@')[0]);
  }
  return [...numbers];
}

export const reportStatusLabels = {pending:'Na fila',sending:'Enviando',sent:'Aceito pela API',failed:'Falha',uncertain:'Envio não confirmado',skipped:'Ignorado',cancelled:'Cancelado'};
export function reportReason(job,campaign) {
  if(job.error)return job.error;
  if(job.status==='sent')return 'API aceitou o envio; entrega e leitura não confirmadas.';
  if(job.status==='pending')return campaign.status==='draft'?'Rascunho: envio não iniciado.':campaign.status==='paused'?'Campanha pausada; contato ainda não enviado.':campaign.schedule&&Date.parse(campaign.schedule)>Date.now()?'Aguardando o agendamento.':'Aguardando processamento, intervalo ou limite de envios.';
  if(job.status==='sending')return 'Envio em andamento; aguardando resposta da API.';
  if(job.status==='cancelled')return 'Envio cancelado antes de ser iniciado.';
  if(job.status==='skipped')return 'Envio ignorado; motivo específico não registrado.';
  return 'Motivo específico não registrado.';
}
export function reportFilter(rows,status='all') {
  if(!['all','issues',...Object.keys(reportStatusLabels)].includes(status))throw new Error('Filtro de relatório inválido.');
  return rows.filter(r=>status==='all'||status==='issues'&&['failed','uncertain'].includes(r.status)||r.status===status);
}
export function reportCsv(campaign,rows) {
  const cell=value=>{let s=String(value??'');if(/^[\s]*[=+@-]|^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const data=[['campanha','aparelho','nome','telefone','status','motivo','ultima_atualizacao_utc','id_mensagem','resultado_por_mensagem'],...rows.map(r=>[campaign.name,campaign.instance,r.name,r.phone,reportStatusLabels[r.status]||r.status,r.reason,r.updated_at,r.message_id,(r.messages||[]).map(m=>`${m.position+1}. ${m.name||'Texto'}: ${reportStatusLabels[m.status]||m.status}${m.message_id?' · ID '+m.message_id:''}${m.error?' · '+m.error:''}`).join(' | ')])];
  return '\uFEFF'+data.map(row=>row.map(cell).join(';')).join('\r\n')+'\r\n';
}
export function evolutionErrorDetail(payload){
 const collect=(v,depth=0)=>{if(depth>4)return [];if(typeof v==='string')return [v];if(Array.isArray(v))return v.flatMap(x=>collect(x,depth+1));if(v&&typeof v==='object')return ['message','error','reason'].flatMap(k=>collect(v[k],depth+1));return [];};
 return [...new Set([...collect(payload?.response),...collect(payload)])].join('; ').replace(/[\r\n\t]/g,' ').slice(0,500);
}

export function failedMessageIds(payload){
 if(String(payload?.event).toLowerCase().replace(/[._-]/g,'')!=='messagesupdate')return [];
 const data=Array.isArray(payload.data)?payload.data:[payload.data];
 return [...new Set(data.filter(x=>x&&x.key?.fromMe!==false&&x.fromMe!==false&&x.status==='ERROR').map(x=>x.keyId||x.key?.id||x.id).filter(id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id)))];
}

export function recipientNotOnWhatsApp(payload){
 const inspect=(v,depth=0)=>{if(depth>5||!v||typeof v!=='object')return false;if(Array.isArray(v))return v.some(x=>inspect(x,depth+1));if(v.exists===false&&typeof (v.number||v.jid)==='string')return true;return ['response','message','error'].some(k=>inspect(v[k],depth+1));};
 return inspect(payload);
}
