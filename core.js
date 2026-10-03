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
