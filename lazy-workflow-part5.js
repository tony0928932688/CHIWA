    status('render-status','字幕預覽已依照本次語音生成時使用的口播文案產生。若要使用新版文案，請先重新生成語音。','warn');
  }else{
    status('render-status','字幕預覽已產生。正式成片會依照已確認語音重新校準時間軸。','ok');
  }
}
async function submitFinalRender(){
  if(isLocalFileMode()){
    status('render-status','目前本機預覽只能檢查畫面與流程。正式成片請在 chiwaai.com 登入後執行。','err');
    return;
  }
  if(!state.avatarResult || !(state.avatarResult.previewUrl || state.avatarResult.downloadUrl)){
    status('render-status','請先完成形象克隆影片。','err');
    return;
  }
  if(!state.voiceItem || !state.voiceItem.playUrl){
    status('render-status','缺少已確認語音，無法產生精準字幕時間軸。請回到第三步重新生成並確認語音。','err');
    return;
  }
  $('btn-render-final').disabled = true;
  status('render-status','正在用已確認語音產生精準字幕時間軸，並送出成片渲染...','warn');
  try{
    const data = await authedFetch(VIDEO_RENDER_API_URL, {
      action:'submit',
      video_url:state.avatarResult.previewUrl || state.avatarResult.downloadUrl,
      audio_url:state.voiceItem.playUrl,
      srt_text:state.srt,
      use_stt:true,
      render_template:state.renderTemplate || 'gold_authority',
      template_version:'chiwa_formal_v1',
      subtitle_mode:'stt_aligned',
      title_position:state.renderControls.titlePosition,
      title_size:state.renderControls.titleSize,
      subtitle_position:state.renderControls.subtitlePosition,
      subtitle_size:state.renderControls.subtitleSize,
      title:stripLeadingPunctuation(state.selectedTopic || $('final-title').value || 'AI自媒體系統'),
      duration_seconds:state.voiceAudioSeconds || 60
    });
    state.renderId = data.renderId;
    status('render-status',`正式成片輸出中：${data.status || 'QUEUED'}，字幕來源：${data.subtitleSource || '語音重新對齊'}，10 秒後自動查詢。`,'warn');
    setTimeout(pollFinalRender, 10000);
  }catch(e){
    status('render-status', e.message || '正式成片送出失敗，請稍後再試。','err');
    $('btn-render-final').disabled = false;
  }
}
async function pollFinalRender(){
  if(!state.renderId){
    status('render-status','缺少成片輸出任務 ID。','err');
    $('btn-render-final').disabled = false;
    return;
  }
  try{
    const data = await authedFetch(VIDEO_RENDER_API_URL, {
      action:'query',
      render_id:state.renderId
    });
    if(data.status === 'SUCCESS' && (data.previewUrl || data.downloadUrl)){
      state.finalVideo = data;
      $('final-video-result').innerHTML = `<video class="video-frame" controls src="${esc(data.previewUrl || data.downloadUrl)}"></video><div class="btns" style="margin-top:10px"><a class="btn secondary" href="${esc(data.downloadUrl || data.previewUrl)}" download>下載成片</a></div><div class="status ok">成片已完成，檔案會暫存 24 小時，請及時下載保存。</div>`;
      status('render-status','標題與字幕已燒進影片，正式成片可以下載。','ok');
      $('btn-render-final').disabled = false;
      return;
    }
    if(data.status === 'FAILED'){
      status('render-status','正式成片輸出失敗，請稍後再試。','err');
      $('btn-render-final').disabled = false;
      return;
    }
    status('render-status',`正式成片輸出中：${data.status || 'RUNNING'}，10 秒後自動查詢。`,'warn');
    setTimeout(pollFinalRender, 10000);
  }catch(e){
    status('render-status', e.message || '正式成片查詢失敗','err');
    $('btn-render-final').disabled = false;
  }
}
async function runRenderSelfTestIfRequested(){
  const params = new URLSearchParams(location.search);
  if(params.get('render-self-test') !== '1') return;
  if((state.user && state.user.email || '').toLowerCase() !== 'tony0928932688@gmail.com') return;
  status('render-status','內部成片檢查中：送出範例影片與中文字幕...','warn');
  try{
    const sampleSrt = [
      '1\n00:00:00,000 --> 00:00:02,500\n這是一段測試字幕。\n',
      '2\n00:00:02,500 --> 00:00:05,000\n確認中文可以燒進影片。\n'
    ].join('\n');
    const submit = await authedFetch(VIDEO_RENDER_API_URL, {
      action:'submit',
      video_url:'https://shotstack-assets.s3.ap-southeast-2.amazonaws.com/footage/beach-overhead.mp4',
      srt_text:sampleSrt,
      title:'成片輸出內部檢查',
      duration_seconds:5
    });
    state.renderId = submit.renderId;
    status('render-status',`內部成片檢查已送出：${submit.status || 'QUEUED'}，正在查詢結果...`,'warn');
    for(let i=0;i<36;i++){
      await sleep(5000);
      const data = await authedFetch(VIDEO_RENDER_API_URL, { action:'query', render_id:state.renderId });
      if(data.status === 'SUCCESS' && (data.previewUrl || data.downloadUrl)){
        state.finalVideo = data;
        $('final-video-result').innerHTML = `<video class="video-frame" controls src="${esc(data.previewUrl || data.downloadUrl)}"></video><div class="btns" style="margin-top:10px"><a class="btn secondary" href="${esc(data.downloadUrl || data.previewUrl)}" download>下載成片</a></div><div class="status ok">內部檢查完成：標題與字幕已燒進影片。</div>`;
        status('render-status','內部成片檢查成功：成片已完成並匯入暫存庫。','ok');
        goStep(5);
        return;
      }
      if(data.status === 'FAILED') throw new Error('video_render_failed');
      status('render-status',`內部成片檢查查詢中：${data.status || 'RUNNING'} (${i + 1}/36)`,'warn');
    }
    throw new Error('video_render_timeout');
  }catch(e){
    status('render-status', e.message || '內部成片檢查失敗','err');
  }
}
function downloadText(name, text, type){
  const blob = new Blob([text], { type:type || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}

$('btn-topics').onclick = generateTopics;
$('btn-script').onclick = () => generateScript((document.querySelector('input[name="script-tone"]:checked') || {}).value || 'casual');
$('btn-script-pro').onclick = () => generateScript('professional');
$('btn-tiktok-caption').onclick = generateTikTokCaption;
$('btn-copy-tiktok-caption').onclick = copyTikTokCaption;
$('btn-copy-ad-primary').onclick = () => copyMarketingField('ad-primary-copy', 'LINE 私訊推廣文');
$('btn-copy-ad-title').onclick = () => copyMarketingField('ad-hook-title', 'CTA 短語');
$('btn-copy-ad-cta').onclick = () => copyMarketingField('ad-cta-copy', 'Hashtag 組合');
$('btn-copy-marketing-all').onclick = copyMarketingAll;
$('final-script').oninput = updateRenderPreview;
$('btn-to-voice').onclick = () => { state.script = $('final-script').value.trim(); updateRenderPreview(); goStep(3); };
$('btn-voice').onclick = generateVoice;
$('btn-refresh-voices').onclick = loadVoices;
$('record-voice-btn').onclick = toggleVoiceRecording;
$('btn-clone-voice').onclick = cloneVoice;
$('voice-file').onchange = e => {
  const file = e.target.files && e.target.files[0];
  if(file && validateAudioFile(file)){
    state.recordingBlob = null;
    state.recordingSeconds = 0;
    $('record-timer').textContent = '00:00';
    setRecordStatus(`已選擇音檔：${file.name}`,'ok');
  }else if(file){
    setRecordStatus('檔案格式不正確，請選擇音檔。','err');
  }
};
$('btn-to-avatar').onclick = () => { goStep(4); $('btn-avatar').disabled = !(state.voiceItem && state.avatarVideoFile); };
$('btn-avatar').onclick = submitAvatar;
$('btn-subtitles').onclick = generateSubtitles;
$('btn-download-srt').onclick = () => downloadText('chiwa-workflow-subtitles.srt', state.srt, 'text/plain;charset=utf-8');
$('btn-download-vtt').onclick = () => downloadText('chiwa-workflow-subtitles.vtt', state.vtt, 'text/vtt;charset=utf-8');
$('btn-render-final').onclick = submitFinalRender;
$('video-drop').onclick = () => $('avatar-video').click();
$('avatar-video').onchange = e => selectVideo(e.target.files && e.target.files[0]);
['dragenter','dragover'].forEach(evt => $('video-drop').addEventListener(evt, e => { e.preventDefault(); $('video-drop').classList.add('drag'); }));
['dragleave','drop'].forEach(evt => $('video-drop').addEventListener(evt, e => { e.preventDefault(); $('video-drop').classList.remove('drag'); }));
$('video-drop').addEventListener('drop', e => selectVideo(e.dataTransfer.files && e.dataTransfer.files[0]));

init().catch(e => {
  $('login-state').textContent = '初始化失敗';
  $('auth-box').style.display = 'block';
  console.error(e);
});
