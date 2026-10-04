import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function validateMedia(file,mime){
 let info;try{const r=await exec('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height','-of','json',file],{timeout:15000,maxBuffer:256*1024});if(r.stderr.trim())throw Error('Invalid media');info=JSON.parse(r.stdout);}catch{throw new Error('Arquivo de mídia inválido ou não foi possível validá-lo. Envie uma imagem JPG/PNG ou um vídeo MP4 válido.');}
 const streams=info.streams||[],video=streams.find(s=>s.codec_type==='video');
 if(!video||!video.width||!video.height)throw new Error('Arquivo sem imagem ou vídeo válido.');
 if(mime==='video/mp4'){
  if(video.codec_name!=='h264'||streams.some(s=>s.codec_type==='audio'&&s.codec_name!=='aac'))throw new Error('Vídeo incompatível: use MP4 com vídeo H.264 e áudio AAC (ou sem áudio).');
  if(!(Number(info.format?.duration)>0))throw new Error('Vídeo sem duração válida.');
 }else if(!['mjpeg','png'].includes(video.codec_name))throw new Error('Imagem incompatível. Use JPG ou PNG.');
 return {codec:video.codec_name,width:video.width,height:video.height,duration:Number(info.format?.duration)||null};
}
