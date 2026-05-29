
const SUPABASE_URL = 'https://nsauscojruqjcprvsfsn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5zYXVzY29qcnVxamNwcnZzZnNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMjAzMTksImV4cCI6MjA5NDU5NjMxOX0.gXX7cBcqohoHqvPkZM-FFrnZVDS59g5OBJPBqH73H_w';
const SECURE_API_URL = `${SUPABASE_URL}/functions/v1/chiwa-secure-api`;
const VOICE_API_URL = `${SUPABASE_URL}/functions/v1/chiwa-voice`;
const AVATAR_API_URL = `${SUPABASE_URL}/functions/v1/chiwa-avatar`;
const VIDEO_RENDER_API_URL = `${SUPABASE_URL}/functions/v1/chiwa-video-render`;
const AVATAR_R2_URL = 'https://rapid-grass-589dchiwa-avatar-r2.tony0928932688.workers.dev';
const AI_BACKEND_URL = 'https://delicate-unit-52chiwa-ai-backend.tony0928932688.workers.dev/';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const state = {
  user: null,
  student: null,
  topics: [],
  selectedTopic: '',
  script: '',
  tiktokCaption: '',
  marketingCopies: {},
  voiceItem: null,
  voiceAudioSeconds: 0,
  voiceScriptText: '',
  avatarVideoFile: null,
  avatarTaskId: '',
  avatarResult: null,
  renderId: '',
  finalVideo: null,
  srt: '',
  vtt: '',
  renderTemplate: 'gold_authority',
  scriptMinutes: 1,
  renderControls: {
    titlePosition: 'top',
    titleSize: 'medium',
    subtitlePosition: 'standard',
    subtitleSize: 'medium'
  },
  systemVoices: [],
  customVoices: [],
  recordingBlob: null,
  recordingSeconds: 0,
  recorder: null,
  recordStream: null,
  recordTimer: null,
  recordChunks: [],
};

function $(id){ return document.getElementById(id); }
function esc(value){ return String(value || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function status(id, text, cls){ const el=$(id); if(el){ el.className='status ' + (cls || ''); el.textContent=text || ''; } }
function fmt(n){ return Math.max(0, Math.round(Number(n || 0))).toLocaleString('zh-TW'); }
async function token(){ const { data } = await sb.auth.getSession(); return data && data.session ? data.session.access_token : ''; }
function isLocalFileMode(){ return location.protocol === 'file:'; }
function liveWorkflowUrl(){ return 'https://chiwaai.com/lazy-workflow.html'; }
function authRedirectUrl(){
  if(isLocalFileMode() || location.hostname !== 'chiwaai.com') return liveWorkflowUrl();
  return location.href.split('#')[0];
}
async function authedFetch(url, body){
  const t = await token();
  if(!t) throw new Error('請先登入學員帳號。');
  const res = await fetch(url, {
    method:'POST',
    headers:{ 'Authorization':'Bearer ' + t, 'Content-Type':'application/json' },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(data.error || data.detail || `HTTP ${res.status}`);
  return data;
}
async function aiCall(type, systemPrompt, userPrompt, tone){
  const t = await token();
  const res = await fetch(AI_BACKEND_URL, {
    method:'POST',
    headers:{ 'Authorization':'Bearer ' + t, 'Content-Type':'application/json' },
    body: JSON.stringify({ type, systemPrompt, userPrompt, fmt:'simple', tone: tone || 'professional' })
  });
  const data = await res.json().catch(() => ({}));
  if(!res.ok || data.error) throw new Error('AI 服務暫時無法使用。');
  return cleanScript(data.content && data.content[0] && data.content[0].text || '');
}
function cleanScript(text){
  return String(text || '')
    .replace(/#{1,6}\s/g,'')
    .replace(/\*\*/g,'')
    .replace(/---/g,'')
    .replace(/[“”"]/g,'')
    .replace(/；/g,'，')
    .replace(/：/g,'，')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
}
function stripLeadingPunctuation(value){
  return String(value || '')
    .replace(/^[\s，,、。．.：:；;！!？?]+/g, '')
    .replace(/^[\s，,、。．.：:；;！!？?]+/g, '')
    .trim();
}
function normalizePotential(value){
  const text = stripLeadingPunctuation(value).replace(/潛力[：:\s]*/g, '').trim();
  if(/高/.test(text)) return '高';
  if(/中/.test(text)) return '中';
  if(/低/.test(text)) return '低';
  return text.slice(0, 8);
}
function targetWordsFromMinutes(minutes){
  const m = Math.max(0.5, Math.min(10, Number(minutes || 1)));
  return Math.round(m * 220);
}
function aiCostForWords(words){
  return Math.max(1, Math.ceil(Number(words || 0) / 500));
}
function getScriptLengthConfig(){
  const custom = Number(($('script-custom-minutes') && $('script-custom-minutes').value) || 0);
  const minutes = custom > 0 ? custom : state.scriptMinutes;
  const normalized = Math.max(0.5, Math.min(10, Number(minutes || 1)));
  const words = targetWordsFromMinutes(normalized);
  return { minutes: normalized, words, cost: aiCostForWords(words) };
}
function updateScriptLengthEstimate(){
  const cfg = getScriptLengthConfig();
  if($('script-target-words')) $('script-target-words').value = `約 ${fmt(cfg.words)} 字`;
  if($('script-ai-cost')) $('script-ai-cost').value = `約 ${fmt(cfg.cost)} 次`;
}
function cleanAIFieldValue(line, key) {
  return String(line || '')
    .replace(new RegExp('^.*' + key + '[：:，,]\\*{0,2}\\s*'), '')
    .replace(new RegExp('^(' + key + '[：:，,\\s]*)+', 'g'), '')
    .replace(/^[，,、。．.：:；;！!？?\-*#>\s]+|[*\s）)]+$/g, '')
    .trim();
}
function pickLabeledValue(lines, key) {
  const idx = lines.findIndex(l => new RegExp('^\\s*(?:[-*#>]+\\s*)?' + key + '[：:，,]').test(String(l || '').trim()) || String(l || '').includes(key + '：') || String(l || '').includes(key + ':'));
  if (idx === -1) return '';
  const line = String(lines[idx] || '');
  let value = /[：:，,]/.test(line) ? cleanAIFieldValue(line, key) : '';
  if ((!value || value === '**') && lines[idx + 1]) {
    value = String(lines[idx + 1]).replace(/^[，,、。．.：:；;！!？?\-*#>\s]+|[*\s]+$/g, '').trim();
  }
  return value === '**' ? '' : value;
}
function inferTopicTitle(block) {
  const quoted = String(block || '').match(/[「『](.+?)[」』]/);
  if (quoted) return quoted[1].trim();
  const bold = String(block || '').match(/\*\*([^*]{6,80})\*\*/);
  return bold ? bold[1].replace(/[「」『』]/g,'').trim() : '';
}
function firstUnlabeledLine(lines) {
  return (lines || [])
    .map(line => String(line || '').trim())
    .filter(Boolean)
    .find(line => !/^(類型|選題類型|方向|標題|選題標題|副標題|核心痛點|痛點|潛力)[：:，,]/.test(line) && !/^【選題\d+】/.test(line)) || '';
}
function fallbackSubtitle(lines) {
  return (lines || [])
    .map(line => String(line || '').trim())
    .filter(Boolean)
    .filter(line => !/^(類型|選題類型|方向|標題|選題標題|副標題|核心痛點|痛點|潛力)[：:，,]/.test(line))
    .join(' ')
    .slice(0, 80);
}
function normalizeTopicType(value, fallback) {
  const allowed = ['痛點鏡子','知識降維','迷思破解','客戶故事','選擇指南','行動催化'];
  let text = String(value || '')
    .replace(/^(類型|選題類型|方向)[：:，,\s]*/g, '')
    .replace(/^(類型\s*)+/g, '')
    .replace(/[（）()]/g, '')
    .replace(/^(類型|選題類型|方向)[：:，,\s]*/g, '')
    .trim();
  const found = allowed.find(type => text.includes(type));
  if (found) return found;
  return allowed.includes(fallback) ? fallback : '';
}
function cleanTopicText(value) {
  let text = String(value || '')
    .replace(/^(類型|選題類型|方向|標題|選題標題|副標題|核心痛點|痛點|潛力)[：:，,\s]*(類型|選題類型|方向|標題|選題標題|副標題|核心痛點|痛點|潛力)[：:，,\s]*/g, '')
    .replace(/^(類型|選題類型|方向|標題|選題標題|副標題|核心痛點|痛點|潛力)[：:，,\s]*/g, '')
    .replace(/^(類型\s*)+/g, '')
    .replace(/類型[：:，,\s]*(?=痛點鏡子|知識降維|迷思破解|客戶故事|選擇指南|行動催化)/g, '')
    .replace(/^(標題\s*)+/g, '')
    .replace(/^(副標題\s*)+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}
function buildProfilePrompt(){
  const p = state.student && state.student.profile || {};
  const lines = [];
  if(p.name || state.student?.name) lines.push(`身份：${p.name || state.student.name}`);
  if(p.industry) lines.push(`行業：${p.industry}`);
  if(p.service) lines.push(`主要服務：${p.service}`);
  if(p.target_gender || p.target_age || p.target_identity) lines.push(`目標受眾：${[p.target_gender, [].concat(p.target_age || []).join('、'), [].concat(p.target_identity || []).join('、')].filter(Boolean).join('，')}`);
  if(p.style) lines.push(`說話風格：${p.style}`);
  if(p.personality) lines.push(`個性特質：${[].concat(p.personality || []).join('、')}`);
  if(p.audience_feeling) lines.push(`希望觀眾感受：${[].concat(p.audience_feeling || []).join('、')}`);
  if(p.differentiation) lines.push(`與同行差異：${[].concat(p.differentiation || []).join('、')}`);
  if(p.extra_note) lines.push(`補充說明：${p.extra_note}`);
  return lines.length ? `學員背景：\n- ${lines.join('\n- ')}\n\n生成原則：語氣和選題必須符合以上背景，不要生成與定位相反的內容。` : '';
}
function compliancePrompt(){
  return `合規規則：使用台灣繁體中文。內容必須先有實質內容，不得只有語氣詞。避開絕對化成效、財務暗示、未經驗證數字、最高級與唯一性宣稱。具體成效必須避免未經驗證的聲稱。可以有說服力，但要符合 TikTok 廣告政策與台灣常見法規風險。不得使用 emoji 或表情符號。`;
}
function updateQuota(){
  const s = state.student || {};
  $('q-ai').textContent = fmt(s.ai_usage);
  $('q-voice').textContent = fmt(s.voice_credits);
  $('q-avatar').textContent = fmt(s.avatar_seconds);
}
