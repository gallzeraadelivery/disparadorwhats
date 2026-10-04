// Add diagnostics to webhook payloads; do not change database writes or send behavior.
const fs=require('node:fs');
const file='/evolution/dist/main.js';let source=fs.readFileSync(file,'utf8');
const pattern=/([a-zA-Z_$][\w$]*)=\{keyId:([a-zA-Z_$][\w$]*)\.id,remoteJid:\2\?\.remoteJid,fromMe:\2\.fromMe,participant:\2\?\.participant,status:([a-zA-Z_$][\w$]*)\[([a-zA-Z_$][\w$]*)\.status\]\?\?"SERVER_ACK",pollUpdates:([a-zA-Z_$][\w$]*),instanceId:this\.instanceId\}/g;
const matches=[...source.matchAll(pattern)];
if(matches.length!==1)throw Error('Expected exactly one verified message-update payload; candidate patch refused');
// Find the webhook dispatch for that payload before adding diagnostic fields, so Prisma does not receive new columns.
const variable=matches[0][1],update=matches[0][4],start=matches[0].index;
const needle=`this.sendDataWebhook("messages.update",${variable})`;
const offset=source.indexOf(needle,start);
if(offset<0||offset-start>15000)throw Error('Verified message-update webhook not found; candidate patch refused');
source=source.slice(0,offset)+`this.sendDataWebhook("messages.update",{...${variable},messageStubType:${update}.messageStubType,messageStubParameters:${update}.messageStubParameters})`+source.slice(offset+needle.length);
fs.writeFileSync(file,source);console.log('Forwarded diagnostic parameters for message updates');
