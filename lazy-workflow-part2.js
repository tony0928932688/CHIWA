function compliancePrompt(){
  return `合規規則：使用台灣繁體中文。內容必須先有實質內容，不得只有語氣詞。避開絕對化成效、財務暗示、未經驗證數字、最高級與唯一性宣稱。具體成效必須避免未經驗證的聲稱。可以有說服力，但要符合 TikTok 廣告政策與台灣常見法規風險。不得使用 emoji 或表情符號。`;
}
function updateQuota(){
  const s = state.student || {};
  $('q-ai').textContent = fmt(s.ai_usage);
  $('q-voice').textContent = fmt(s.voice_credits);
  $('q-avatar').textContent = fmt(s.avatar_seconds);
}
function goStep(n){
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('on'));
  const panel = $('step-' + n);
  if(panel) panel.classList.add('on');
  document.querySelectorAll('.stepnav button').forEach(b => b.classList.toggle('on', b.dataset.step === String(n)));
}
function initRenderTemplates(){
  document.querySelectorAll('[data-template]').forEach(card => {
    card.onclick = () => {
      state.renderTemplate = card.getAttribute('data-template') || 'gold_authority';
      document.querySelectorAll('[data-template]').forEach(el => el.classList.toggle('on', el === card));
      updateRenderPreview();
      status('render-status',`已選擇模板：${card.querySelector('b')?.textContent || state.renderTemplate}`,'ok');
    };
  });
}
function initScriptLengthControls(){
  document.querySelectorAll('[data-minutes]').forEach(btn => {
    btn.onclick = () => {
      state.scriptMinutes = Number(btn.getAttribute('data-minutes') || 1);
      if($('script-custom-minutes')) $('script-custom-minutes').value = '';
      document.querySelectorAll('[data-minutes]').forEach(el => el.classList.toggle('on', el === btn));
      updateScriptLengthEstimate();
    };
  });
  if($('script-custom-minutes')){
    $('script-custom-minutes').oninput = () => {
      document.querySelectorAll('[data-minutes]').forEach(el => el.classList.remove('on'));
      updateScriptLengthEstimate();
    };
  }
  updateScriptLengthEstimate();
}
function renderTemplatePreviewStyle(){
  const title = $('preview-title');
  const subtitle = $('preview-subtitle');
  if(!title || !subtitle) return;
  const template = state.renderTemplate || 'gold_authority';
  const titlePos = state.renderControls.titlePosition || 'top';
  const subtitlePos = state.renderControls.subtitlePosition || 'standard';
  const titleSize = state.renderControls.titleSize || 'medium';
  const subtitleSize = state.renderControls.subtitleSize || 'medium';
  const topMap = { top:'9%', upper:'24%', lower:'52%' };
  const bottomMap = { standard:'16%', higher:'24%' };
  const titleSizeMap = { small:'14px', medium:'18px', large:'22px' };
  const subtitleSizeMap = { small:'12px', medium:'14px', large:'16px' };
  title.style.top = topMap[titlePos] || topMap.top;
  title.style.fontSize = titleSizeMap[titleSize] || titleSizeMap.medium;
  subtitle.style.bottom = bottomMap[subtitlePos] || bottomMap.standard;
  subtitle.style.fontSize = subtitleSizeMap[subtitleSize] || subtitleSizeMap.medium;
  title.style.background = 'rgba(0,0,0,.62)';
  title.style.color = '#fff';
  title.style.border = '1px solid rgba(255,255,255,.22)';
  title.style.textShadow = '0 3px 12px rgba(0,0,0,.9)';
  if(template === 'gold_authority'){
    title.style.background = 'linear-gradient(135deg,#f7dc72,#b88923)';
    title.style.color = '#08080c';
    title.style.border = '1px solid rgba(255,238,174,.85)';
  }else if(template === 'tiktok_hook'){
    title.style.background = 'rgba(255,46,99,.92)';
    title.style.color = '#fff';
    title.style.border = '1px solid rgba(255,255,255,.92)';
    title.style.textShadow = '3px 3px 0 #000';
  }else if(template === 'quiet_caption'){
    title.style.background = 'rgba(0,0,0,.58)';
    title.style.color = '#f6d66d';
    title.style.border = '1px solid rgba(246,214,109,.34)';
  }
}
function updateRenderPreview(){
  if($('preview-title')) $('preview-title').textContent = stripLeadingPunctuation($('final-title')?.value || state.selectedTopic || '影片標題').slice(0, 34) || '影片標題';
  const text = ($('final-script')?.value || state.voiceScriptText || '').trim();
  if($('preview-subtitle')) $('preview-subtitle').textContent = subtitleChunks(text)[0] || '字幕會出現在這裡';
  renderTemplatePreviewStyle();
}
function initRenderControls(){
  const bindings = [
    ['title-position', 'titlePosition'],
    ['title-size', 'titleSize'],
    ['subtitle-position', 'subtitlePosition'],
    ['subtitle-size', 'subtitleSize']
  ];
  bindings.forEach(([id, key]) => {
    const el = $(id);
    if(!el) return;
    el.onchange = () => {
      state.renderControls[key] = el.value;
      updateRenderPreview();
    };
  });
  updateRenderPreview();
}
async function refreshProfile(){
  const data = await authedFetch(SECURE_API_URL, { action:'profile' });
  state.student = data.student;
  updateQuota();
}
async function init(){
  document.querySelectorAll('.stepnav button').forEach(btn => btn.onclick = () => goStep(btn.dataset.step));
  initRenderTemplates();
  initScriptLengthControls();
  initRenderControls();
  const client = getSupabaseClient();
  $('login-btn').onclick = () => client.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: authRedirectUrl() } });
  const { data } = await client.auth.getSession();
  state.user = data && data.session && data.session.user;
  if(!state.user){
    $('login-state').textContent = '尚未登入';
    $('auth-box').style.display = 'block';
    return;
  }
  $('login-state').textContent = `已登入：${state.user.email || ''}`;
  $('app').style.display = 'grid';
  $('auth-box').style.display = 'none';
  await refreshProfile();
  await loadVoices();
  runRenderSelfTestIfRequested();
}
function parseTopics(text){
  let blocks = String(text || '').split(/【選題\d+】/).map(s => s.trim()).filter(Boolean);
  if(!blocks.length){
    blocks = String(text || '')
      .split(/\n(?=(?:#{1,3}\s*)?(?:📌\s*)?(?:選題標題|選題|標題)|(?:\d+[.、]\s*))/)
      .map(s => s.trim())
      .filter(Boolean);
  }
  return blocks.slice(0,8).map((b, i) => {
    const lines = b.trim().split('\n');
    const pick = label => pickLabeledValue(lines, label);
    const selectedType = $('topic-type') ? $('topic-type').value : '';
    const title = stripLeadingPunctuation(cleanTopicText(pick('標題') || pick('選題標題') || inferTopicTitle(b) || firstUnlabeledLine(lines).replace(/^\d+[.、]\s*/,'').slice(0,40)));
    const subtitle = stripLeadingPunctuation(cleanTopicText(pick('副標題') || pick('核心痛點') || pick('痛點') || fallbackSubtitle(lines)));
    return {
      index: i + 1,
      type: normalizeTopicType(pick('類型'), selectedType) || '短影音選題',
      potential: normalizePotential(pick('潛力') || (b.includes('高潛力') ? '高' : '')),
      title,
      subtitle,
      raw: b
    };
  });
}
function renderTopics(){
  $('topic-list').innerHTML = state.topics.map(t => `
    <div class="card ${state.selectedTopic === t.title ? 'selected' : ''}">
      <span class="badge">${esc(t.type)}</span>${t.potential ? ` <span class="badge">潛力 ${esc(t.potential)}</span>` : ''}
      <div class="card-title">${esc(t.title)}</div>
      <div class="card-text">${esc(t.subtitle)}</div>
      <button class="btn secondary" style="margin-top:10px" data-topic="${esc(t.title)}">選這個題目</button>
    </div>`).join('');
  document.querySelectorAll('[data-topic]').forEach(btn => btn.onclick = () => {
    state.selectedTopic = btn.getAttribute('data-topic') || '';
    $('selected-topic').value = state.selectedTopic;
    $('final-title').value = state.selectedTopic;
    renderTopics();
    updateRenderPreview();
    goStep(2);
  });
}
async function generateTopics(){
  status('topic-status','生成中...','warn');
  $('btn-topics').disabled = true;
  try{
    const type = $('topic-type').value;
    const extra = $('topic-extra').value.trim();
    const typeInstruction = type === '隨機分配'
      ? '選題類型：隨機分配。請從「痛點鏡子、知識降維、迷思破解、客戶故事、選擇指南、行動催化」這 6 種方向中，替 8 個選題隨機分配類型；每一種至少出現 1 次，另外 2 個可隨機重複。'
      : '選題類型：' + type + '。8 個選題都要符合這個類型方向。';
    const system = `${buildProfilePrompt()}\n\n你是專業短影音選題策略師。\n${compliancePrompt()}`;
    const user = `補充方向：${extra || '無'}。\n${typeInstruction}\n\n請根據學員帳號定位、行業與選題方向，生成 8 個短影音文案選題。每個選題都要能直接展開成 1-2 分鐘口播文案。\n\n格式必須固定如下：\n【選題1】\n類型：（痛點鏡子/知識降維/迷思破解/客戶故事/選擇指南/行動催化）\n標題：（20字內）\n副標題：（30字內）\n潛力：高/中/低\n\n【選題2】...\n\n重要：欄位名稱只出現在冒號前，冒號後只放內容，不要輸出「類型類型」、「類型：類型」或把欄位名稱重複放進內容。\n\n請輸出到【選題8】。`;
    const text = await aiCall('topics', system, user, 'professional');
    state.topics = parseTopics(text);
    renderTopics();
    status('topic-status',`已生成 ${state.topics.length} 個選題。`,'ok');
    await refreshProfile().catch(()=>{});
  }catch(e){ status('topic-status', e.message || '生成失敗','err'); }
  $('btn-topics').disabled = false;
}
async function generateScript(tone){
  if(!state.selectedTopic){ status('script-status','請先選擇選題。','err'); return; }
  const cfg = getScriptLengthConfig();
  status('script-status',`文案生成中，目標約 ${fmt(cfg.words)} 字、${cfg.minutes} 分鐘...`,'warn');
  $('btn-script').disabled = true;
  $('btn-script-pro').disabled = true;
  try{
    const casual = tone !== 'professional';
    const system = `${buildProfilePrompt()}\n\n你是專業台灣口播文案撰寫師。\n${compliancePrompt()}\n內容規則：文案必須包含開場鉤子、痛點、解法、具體場景、CTA。語氣詞只佔全文 10% 以下。格式適合直接貼進語音合成工具朗讀，每句結尾必須有標點。\n${casual ? '語氣：素人隨聊感，像台灣人在自然聊天，但不能空洞。' : '語氣：博主專業感，有觀點、有邏輯、有乾貨。'}`;
    const extra = $('script-extra').value.trim() || '無';
    const chunkTarget = 1200;
    const chunks = Math.max(1, Math.ceil(cfg.words / chunkTarget));
    let combined = '';
    for(let i = 0; i < chunks; i++){
      const done = Array.from(combined.replace(/\s+/g,'')).length;
      const remaining = Math.max(220, cfg.words - done);
      const thisTarget = chunks === 1 ? cfg.words : Math.min(chunkTarget, remaining);
      const user = combined
        ? `選題：${state.selectedTopic}\n補充：${extra}\n\n以下是前面已完成的口播文案，請直接順著語意續寫，不要重複開場，不要重複前文。\n\n已完成內容：\n${combined}\n\n本次續寫目標：約 ${thisTarget} 字。${i === chunks - 1 ? '這是最後一段，請自然收尾並加入 CTA。' : '這不是最後一段，請先不要收尾，不要加入最終 CTA。'}\n\n只輸出口播正文，不要 Markdown，不要標題，不要分隔線。`
        : `選題：${state.selectedTopic}\n補充：${extra}\n\n請生成約 ${cfg.words} 字、約 ${cfg.minutes} 分鐘的完整口播文案。內容要比短版更豐富，加入具體場景、細節、例子與轉折，但不要灌水。\n\n結構：開場鉤子、痛點、原因拆解、具體場景、解法、例子、總結、CTA。\n\n只輸出口播正文，不要 Markdown，不要標題，不要分隔線。`;
      const next = await aiCall('script', system, user, casual ? 'casual' : 'professional');
      combined = cleanScript(combined + (combined ? '\n\n' : '') + next);
      $('final-script').value = combined;
      updateRenderPreview();
