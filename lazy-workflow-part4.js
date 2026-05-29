function fileExt(file, fallback){ const m=String(file && file.name || '').match(/\.([a-z0-9]+)$/i); return (m ? m[1] : fallback).toLowerCase(); }
function fileMime(file, kind){ return file && file.type || (kind === 'video' ? 'video/mp4' : 'audio/wav'); }
async function r2Json(path, options){
  const res = await fetch(AVATAR_R2_URL + path, options);
  const data = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(data.error || `upload_${res.status}`);
  return data;
}
function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }
async function uploadVideoToR2(file, onProgress){
  const t = await token();
  const create = await r2Json('/avatar/multipart/create', {
    method:'POST',
    headers:{ 'Authorization':'Bearer ' + t, 'Content-Type':'application/json' },
    body: JSON.stringify({ kind:'video', fileName:file.name || 'avatar-video.mp4', contentType:fileMime(file,'video'), size:file.size })
  });
  const partSize = Math.max(5 * 1024 * 1024, Math.min(Number(create.partSize || 10 * 1024 * 1024), 20 * 1024 * 1024));
  const totalParts = Math.ceil(file.size / partSize);
  const parts = [];
  let uploaded = 0;
  try{
    for(let i=0;i<totalParts;i++){
      const chunk = file.slice(i * partSize, Math.min(file.size, (i + 1) * partSize));
      let lastError = null;
      for(let attempt=0;attempt<4;attempt++){
        try{
          const part = await r2Json(`/avatar/multipart/part?key=${encodeURIComponent(create.key)}&uploadId=${encodeURIComponent(create.uploadId)}&partNumber=${i + 1}`, {
            method:'PUT',
            headers:{ 'Authorization':'Bearer ' + t, 'Content-Type':'application/octet-stream', 'x-chiwa-upload':'workflow-video-part' },
            body: chunk
          });
          parts.push({ partNumber:Number(part.partNumber), etag:part.etag });
          uploaded += chunk.size;
          if(onProgress) onProgress(Math.min(100, uploaded / file.size * 100), uploaded, file.size);
          lastError = null;
          break;
        }catch(err){ lastError = err; await sleep(800 * (attempt + 1)); }
      }
      if(lastError) throw lastError;
    }
    return await r2Json('/avatar/multipart/complete', {
      method:'POST',
      headers:{ 'Authorization':'Bearer ' + t, 'Content-Type':'application/json' },
      body: JSON.stringify({ key:create.key, uploadId:create.uploadId, parts })
    });
  }catch(err){
    await fetch(AVATAR_R2_URL + '/avatar/multipart/abort', {
      method:'DELETE',
      headers:{ 'Authorization':'Bearer ' + t, 'Content-Type':'application/json' },
      body: JSON.stringify({ key:create.key, uploadId:create.uploadId })
    }).catch(()=>{});
    throw err;
  }
}
async function submitAvatar(){
  if(!state.voiceItem || !state.voiceItem.playUrl){ status('avatar-status','請先完成語音並確認。','err'); return; }
  if(!state.avatarVideoFile){ status('avatar-status','請先選擇形象影片。','err'); return; }
  if(!confirm(`確認送出形象克隆？\n語音長度：約 ${state.voiceAudioSeconds} 秒\n成功完成後才會扣影像克隆秒數。`)) return;
  $('btn-avatar').disabled = true;
  try{
    status('avatar-status','形象影片上傳中 0%...','warn');
    const uploaded = await uploadVideoToR2(state.avatarVideoFile, (pct, done, total) => {
      status('avatar-status', `形象影片上傳中 ${pct.toFixed(1)}%（${(done/1024/1024).toFixed(1)}MB / ${(total/1024/1024).toFixed(1)}MB）`, 'warn');
    });
    status('avatar-status','素材已上傳，正在送出形象克隆任務...','warn');
    const data = await authedFetch(AVATAR_API_URL, {
      action:'submit_urls',
      video_url:uploaded.signedUrl,
      audio_url:state.voiceItem.playUrl,
      video_path:uploaded.key,
      audio_path:state.voiceItem.id || 'workflow-tts',
      duration_seconds:state.voiceAudioSeconds
    });
    state.avatarTaskId = data.taskId;
    status('avatar-status','任務已送出，正在查詢結果...','warn');
    pollAvatar();
  }catch(e){
    status('avatar-status', e.message || '形象克隆送出失敗','err');
    $('btn-avatar').disabled = false;
  }
}
async function pollAvatar(){
  try{
    const data = await authedFetch(AVATAR_API_URL, { action:'query', taskId:state.avatarTaskId });
    if(data.student){ state.student = data.student; updateQuota(); }
    if(data.status === 'SUCCESS' && (data.previewUrl || data.downloadUrl)){
      state.avatarResult = data;
      $('avatar-result').innerHTML = `<video class="video-frame" controls src="${esc(data.previewUrl || data.downloadUrl)}"></video><div class="btns" style="margin-top:10px"><a class="btn secondary" href="${esc(data.downloadUrl || data.previewUrl)}" download>下載影片</a></div>`;
      status('avatar-status','形象克隆影片已生成。','ok');
      $('btn-avatar').disabled = false;
      updateRenderPreview();
      goStep(5);
      return;
    }
    if(data.status === 'FAILED'){
      status('avatar-status','形象克隆生成失敗，請稍後再試。','err');
      $('btn-avatar').disabled = false;
      return;
    }
    status('avatar-status',`生成中：${data.status || 'RUNNING'}，8 秒後自動查詢。`,'warn');
    setTimeout(pollAvatar, 8000);
  }catch(e){
    status('avatar-status', e.message || '查詢失敗','err');
    $('btn-avatar').disabled = false;
  }
}
function selectVideo(file){
  state.avatarVideoFile = file || null;
  $('video-status').textContent = file ? `已選擇：${file.name}（${(file.size/1024/1024).toFixed(1)}MB）` : '尚未選擇影片';
  $('btn-avatar').disabled = !(state.voiceItem && state.avatarVideoFile);
}
function srtTime(sec){
  const ms = Math.floor((sec % 1) * 1000);
  const t = Math.floor(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}
function vttTime(sec){ return srtTime(sec).replace(',', '.'); }
function subtitleChunks(text){
  const normalized = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const sentences = normalized.split(/(?<=[。！？?!])/).map(s => s.trim()).filter(Boolean);
  return (sentences.length ? sentences : [normalized]).filter(Boolean).flatMap(s => {
    const chars = Array.from(s);
    if(chars.length <= 24) return [s];
    const parts = [];
    for(let i=0;i<chars.length;i+=22) parts.push(chars.slice(i,i+22).join(''));
    return parts;
  });
}
function generateSubtitles(){
  const currentText = $('final-script').value.trim();
  const text = (state.voiceScriptText || currentText).trim();
  if(!text){
    state.srt = '';
    state.vtt = '';
    status('render-status','請先生成或填入口播文案。','err');
    return;
  }
  const chunks = subtitleChunks(text);
  if(!chunks.length){
    state.srt = '';
    state.vtt = '';
    status('render-status','目前沒有可產生字幕的口播文字。','err');
    return;
  }
  const total = Math.max(1, Number(state.voiceAudioSeconds || chunks.length * 3));
  const dur = total / Math.max(1, chunks.length);
  const srt = [];
  const vtt = ['WEBVTT', ''];
  chunks.forEach((line, i) => {
    const start = i * dur;
    const end = Math.min(total, (i + 1) * dur);
    srt.push(`${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${line}\n`);
    vtt.push(`${vttTime(start)} --> ${vttTime(end)}\n${line}\n`);
  });
  state.srt = srt.join('\n');
  state.vtt = vtt.join('\n');
  updateRenderPreview();
  $('subtitle-output').textContent = `標題：${stripLeadingPunctuation(state.selectedTopic)}\n\n字幕預覽說明：下方時間軸可先檢查文字分段；正式成片時會依照第三步已確認的語音重新校準字幕時間。\n\n` + state.srt;
  $('btn-download-srt').disabled = false;
  $('btn-download-vtt').disabled = false;
  $('btn-render-final').disabled = !(state.avatarResult && (state.avatarResult.previewUrl || state.avatarResult.downloadUrl));
  if(state.voiceScriptText && currentText && state.voiceScriptText !== currentText){
