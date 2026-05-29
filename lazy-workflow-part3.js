    }
    state.script = combined;
    $('final-script').value = state.script;
    updateRenderPreview();
    status('script-status',`文案已生成，目標 ${cfg.minutes} 分鐘，可手動修改後送語音。`,'ok');
    await refreshProfile().catch(()=>{});
  }catch(e){ status('script-status', e.message || '文案生成失敗','err'); }
  $('btn-script').disabled = false;
  $('btn-script-pro').disabled = false;
}
async function generateTikTokCaption(){
  const text = $('final-script').value.trim();
  if(!text){
    status('caption-status','請先生成或填入口播文案。','err');
    return;
  }
  status('caption-status','行銷文案生成中...','warn');
  $('btn-tiktok-caption').disabled = true;
  try{
    const selectedDesc = [
      'TikTok 影片說明文字（150字以內，結尾附帶最多5個黃金配置標籤）',
      'LINE 私訊推廣文（100字以內）',
      '5個行動呼籲 CTA 短語（每個10字以內）',
      '精準 Hashtag 組合（3-5個黃金配置標籤）'
    ].join('\n');
    const system = `${buildProfilePrompt()}\n\n你是專業台灣數位行銷文案師，專門根據短影音腳本生成各類優質行銷文案。\n${compliancePrompt()}\n\n行銷文案規則：\n- 必須百分之百根據使用者提供的短影音腳本內容與學員背景生成。\n- 風格要口語、有服務力，只用繁體中文。\n- 每段都必須有實質商品、服務或專業內容，不能只寫語氣詞或空泛情緒。\n- 絕對不能使用任何 emoji 或表情符號。\n- 不論在 TikTok 說明文字還是 Hashtag 組合中，Hashtag 數量都要嚴格限制最多 5 個，通常為 3 到 5 個。\n- Hashtag 要貼合影片腳本行業主題與精準領域，不要過度泛用。\n- 每種類型前加上清楚的標題標示，格式固定為：【類型名稱】。\n- 只輸出要求的四種行銷文案，不要輸出分析、說明、表格、Markdown 或分隔線。`;
    const user = `以下是一支短影音的腳本：\n\n${text}\n\n請根據這支影片內容，生成以下行銷文案：\n\n${selectedDesc}\n\n每種類型前加上清楚的標題標示，格式：【類型名稱】\n內容...\n\n重要：每段都必須有實質商品/服務內容，不能只寫語氣詞或空泛情緒。`;
    const raw = await aiCall('marketing', system, user, 'professional');
    state.marketingCopies = parseMarketingCopies(raw);
    state.tiktokCaption = state.marketingCopies.caption || raw;
    $('tiktok-caption').value = state.marketingCopies.caption || raw;
    $('ad-primary-copy').value = state.marketingCopies.line || '';
    $('ad-hook-title').value = state.marketingCopies.cta || '';
    $('ad-cta-copy').value = state.marketingCopies.hashtags || '';
    status('caption-status','行銷文案已生成。','ok');
    await refreshProfile().catch(()=>{});
  }catch(e){
    status('caption-status', e.message || '行銷文案生成失敗','err');
  }
  $('btn-tiktok-caption').disabled = false;
}
function parseMarketingCopies(text){
  const raw = String(text || '').trim();
  const pick = (label) => {
    const labels = ['TikTok 影片說明文字','TikTok影片說明文字','LINE 私訊推廣文','LINE私訊推廣文','5個行動呼籲 CTA 短語','5 個行動呼籲 CTA 短語','精準 Hashtag 組合'];
    const next = labels.filter(x => x !== label).map(x => `【${x}】`).join('|');
    const pattern = new RegExp(`【${label}】\\s*([\\s\\S]*?)(?=${next ? next + '|' : ''}$)`);
    const match = raw.match(pattern);
    return match ? match[1].trim() : '';
  };
  return {
    caption: pick('TikTok 影片說明文字') || pick('TikTok影片說明文字'),
    line: pick('LINE 私訊推廣文') || pick('LINE私訊推廣文'),
    cta: pick('5個行動呼籲 CTA 短語') || pick('5 個行動呼籲 CTA 短語'),
    hashtags: pick('精準 Hashtag 組合')
  };
}
async function copyTikTokCaption(){
  return copyMarketingField('tiktok-caption', 'TikTok 影片說明文字');
}
async function copyMarketingField(id, label){
  const text = $(id).value.trim();
  if(!text){
    status('caption-status',`目前沒有可複製的${label}。`,'err');
    return;
  }
  try{
    await navigator.clipboard.writeText(text);
    status('caption-status',`已複製${label}。`,'ok');
  }catch(e){
    status('caption-status','複製失敗，請手動選取文字。','err');
  }
}
async function copyMarketingAll(){
  const blocks = [
    ['TikTok影片說明文字', $('tiktok-caption').value.trim()],
    ['LINE私訊推廣文', $('ad-primary-copy').value.trim()],
    ['5個行動呼籲 CTA 短語', $('ad-hook-title').value.trim()],
    ['精準 Hashtag 組合', $('ad-cta-copy').value.trim()]
  ].filter(([, value]) => value);
  if(!blocks.length){
    status('caption-status','目前沒有可複製的行銷文案。','err');
    return;
  }
  try{
    await navigator.clipboard.writeText(blocks.map(([label, value]) => `【${label}】\n${value}`).join('\n\n'));
    status('caption-status','已複製全部行銷文案。','ok');
  }catch(e){
    status('caption-status','複製失敗，請手動選取文字。','err');
  }
}
async function loadVoices(){
  try{
    const data = await authedFetch(VOICE_API_URL, { action:'list' });
    state.systemVoices = data.systemVoices || [];
    state.customVoices = data.voices || [];
    fillVoiceSelect();
    renderVoiceList();
    if(data.student){ state.student = data.student; updateQuota(); }
  }catch(e){
    state.systemVoices = [{ id:'def-female', name:'吉娃 AI 官方台灣女聲', duration:'系統預置聲音' }];
    state.customVoices = [];
    fillVoiceSelect();
    renderVoiceList();
  }
}
function fillVoiceSelect(){
  const select = $('voice-select');
  if(!select) return;
  const previous = select.value;
  const voices = [].concat(state.systemVoices || [], state.customVoices || []);
  select.innerHTML = voices.map(v => {
    const mine = (state.customVoices || []).some(x => x.id === v.id);
    return `<option value="${esc(v.id)}">${esc(v.name || '未命名聲音')}${mine ? '（我的克隆）' : '（系統預置）'}</option>`;
  }).join('') || '<option value="def-female">吉娃 AI 官方台灣女聲</option>';
  if(previous && Array.from(select.options).some(o => o.value === previous)) select.value = previous;
}
function renderVoiceList(){
  const box = $('voice-list');
  if(!box) return;
  const voices = (state.customVoices || []).filter(v => v && v.id);
  if(!voices.length){
    box.innerHTML = '<div class="status">目前還沒有克隆聲音。你可以在右側錄音或上傳音檔建立。</div>';
    return;
  }
  box.innerHTML = voices.map(v => `
    <div class="voice-card">
      <div><b>${esc(v.name || '我的克隆聲音')}</b><small>${esc(v.duration || '')}${v.date ? '｜' + esc(v.date) : ''}</small></div>
      <div class="btns">
        <button class="btn secondary" type="button" data-use-voice="${esc(v.id)}">選用</button>
        <button class="btn secondary danger" type="button" data-delete-voice="${esc(v.id)}">刪除</button>
      </div>
    </div>`).join('');
  box.querySelectorAll('[data-use-voice]').forEach(btn => btn.onclick = () => {
    $('voice-select').value = btn.getAttribute('data-use-voice') || '';
    status('voice-status','已選擇克隆聲音。','ok');
  });
  box.querySelectorAll('[data-delete-voice]').forEach(btn => btn.onclick = () => deleteVoice(btn.getAttribute('data-delete-voice') || ''));
}
async function deleteVoice(id){
  if(!id) return;
  if(!confirm('確定要刪除這個克隆聲音嗎？刪除後不能復原。')) return;
  try{
    await authedFetch(VOICE_API_URL, { action:'delete', voice_id:id });
    state.customVoices = (state.customVoices || []).filter(v => v.id !== id);
    fillVoiceSelect();
    renderVoiceList();
    status('clone-status','克隆聲音已刪除。','ok');
  }catch(e){
    status('clone-status', e.message || '刪除聲音失敗','err');
  }
}
function selectedVoiceAudioFile(){
  const fileInput = $('voice-file');
  return fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
}
function validateAudioFile(file){
  if(!file) return false;
  const okExt = /\.(mp3|wav|m4a|aac|webm|ogg|flac)$/i.test(file.name || '');
  return (file.type && file.type.startsWith('audio/')) || okExt;
}
function setRecordStatus(text, cls){ status('record-status', text, cls); }
function resetRecordingUi(){
  const btn = $('record-voice-btn');
  if(btn) btn.classList.remove('recording');
  if(btn) btn.textContent = '錄';
}
async function toggleVoiceRecording(){
  if(state.recorder && state.recorder.state === 'recording'){
    state.recorder.stop();
    return;
  }
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder){
    setRecordStatus('這個瀏覽器不支援即時錄音，請改用上傳音檔。','err');
    return;
  }
  try{
    state.recordingBlob = null;
    state.recordingSeconds = 0;
    state.recordChunks = [];
    state.recordStream = await navigator.mediaDevices.getUserMedia({ audio:true });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
    state.recorder = new MediaRecorder(state.recordStream, mime ? { mimeType:mime } : undefined);
    state.recorder.ondataavailable = e => { if(e.data && e.data.size) state.recordChunks.push(e.data); };
    state.recorder.onstop = () => {
      if(state.recordTimer) clearInterval(state.recordTimer);
      state.recordTimer = null;
      state.recordingBlob = new Blob(state.recordChunks, { type:state.recorder.mimeType || 'audio/webm' });
      if(state.recordStream) state.recordStream.getTracks().forEach(track => track.stop());
      state.recordStream = null;
      resetRecordingUi();
      setRecordStatus(`錄音完成：${state.recordingSeconds} 秒。可以命名後建立克隆聲音。`,'ok');
    };
    state.recorder.start();
    $('record-voice-btn').classList.add('recording');
    $('record-voice-btn').textContent = '停';
    setRecordStatus('錄音中，再按一次停止。','warn');
    state.recordTimer = setInterval(() => {
      state.recordingSeconds += 1;
      const m = String(Math.floor(state.recordingSeconds / 60)).padStart(2,'0');
      const s = String(state.recordingSeconds % 60).padStart(2,'0');
      $('record-timer').textContent = `${m}:${s}`;
      if(state.recordingSeconds >= 120 && state.recorder && state.recorder.state === 'recording') state.recorder.stop();
    }, 1000);
  }catch(e){
    resetRecordingUi();
    setRecordStatus('無法啟用麥克風，請確認瀏覽器授權或改用上傳音檔。','err');
  }
}
async function cloneVoice(){
  const name = $('voice-name').value.trim();
  const uploaded = selectedVoiceAudioFile();
  const audio = uploaded || state.recordingBlob;
  if(!name){ status('clone-status','請先幫聲音命名。','err'); return; }
  if(!audio){ status('clone-status','請先錄音或上傳音檔。','err'); return; }
  if(uploaded && !validateAudioFile(uploaded)){ status('clone-status','請上傳音檔格式，例如 mp3、wav、m4a。','err'); return; }
  $('btn-clone-voice').disabled = true;
  status('clone-status','正在建立克隆聲音...','warn');
  try{
    const t = await token();
    if(!t) throw new Error('請先登入學員帳號。');
    const form = new FormData();
    form.append('name', name);
    form.append('recording_seconds', String(state.recordingSeconds || 30));
    form.append('audio', audio, uploaded ? uploaded.name : `chiwa-voice-${Date.now()}.webm`);
    const res = await fetch(VOICE_API_URL, { method:'POST', headers:{ Authorization:'Bearer ' + t }, body:form });
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(data.error || data.detail || '聲音克隆失敗，請稍後再試。');
    await loadVoices();
    const createdId = data.voice && data.voice.id || data.model && data.model.id || '';
    if(createdId && $('voice-select')) $('voice-select').value = createdId;
    $('voice-name').value = '';
    if($('voice-file')) $('voice-file').value = '';
    state.recordingBlob = null;
    state.recordingSeconds = 0;
    $('record-timer').textContent = '00:00';
    status('clone-status','克隆聲音已建立，已放回發音人選單。','ok');
  }catch(e){
    status('clone-status', e.message || '聲音克隆失敗','err');
  }
  $('btn-clone-voice').disabled = false;
}
function estimateChars(text){ return Array.from(String(text || '').replace(/\s+/g,'')).length; }
async function generateVoice(){
  const text = $('final-script').value.trim();
  if(!text){ status('voice-status','請先確認文案。','err'); return; }
  const chars = estimateChars(text);
  if(!confirm(`即將生成語音\n文案長度：約 ${chars} 字\n即使只是試聽也會消耗語音額度。\n\n確認生成？`)) return;
  status('voice-status','語音生成中...','warn');
  $('btn-voice').disabled = true;
  try{
    const data = await authedFetch(VOICE_API_URL, {
      action:'tts',
      voice_id:$('voice-select').value || 'def-female',
      text,
      language:$('voice-lang').value || 'zh'
    });
    state.voiceScriptText = text;
    state.script = text;
    state.voiceItem = data.item;
