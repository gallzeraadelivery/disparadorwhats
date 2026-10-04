import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateMedia} from '../media.js';
test('media probe verifies real files and rejects fake headers',async()=>{
 assert.equal((await validateMedia(fileURLToPath(new URL('./fixtures/valid.png',import.meta.url)),'image/png')).codec,'png');
 assert.equal((await validateMedia(fileURLToPath(new URL('./fixtures/valid.mp4',import.meta.url)),'video/mp4')).codec,'h264');
 const dir=mkdtempSync(path.join(tmpdir(),'dz-bad-media-'));try{for(const bytes of [[137,80,78,71,13,10,26,10,1],[0,0,0,24,102,116,121,112,109,112,52,50]]){const f=path.join(dir,'fake');writeFileSync(f,Buffer.from(bytes));await assert.rejects(validateMedia(f,bytes[0]===137?'image/png':'video/mp4'),/inválido|validá-lo/);}}finally{rmSync(dir,{recursive:true,force:true});}
});
