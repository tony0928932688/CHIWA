const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODELS = [
  'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-20250514',
  'claude-3-5-sonnet-20241022'
];

const TIKTOK_COMPLIANCE_RULES = `
TikTok 廣告合規規則：
生成出來的內容必須直接符合規則，不需要使用者手動再審查，生成出來就是合規版本。

以下絕對禁止出現：
1. 絕對性保證語言
禁止：保證、一定有效、必定、100%成效、穩賺。
替換：把結果變目的或加限定詞。
錯誤：「保證帶來客戶」
正確：「幫你持續累積潛在客戶」

2. 具體未經驗證的數字聲稱
禁止：上百位測試、幾倍成效、翻倍、幾分之一成本。
替換：用描述性語言取代。
錯誤：「成本是傳統的幾分之一」
正確：「成本比傳統方式低很多」

3. 財務回報承諾
禁止：保證收入、穩定賺錢、月入、獲利保證、變現保證。
替換：把結果變行為描述。
錯誤：「保證月入十萬」
正確：「讓更多對的客戶找到你」

4. 絕對性最高級
禁止：最強、最好、業界第一、全台唯一、業界唯一。
替換：用具體描述取代。
錯誤：「業界最強系統」
正確：「一套每月幫你穩定產出八支影片的系統」

5. 預測性絕對聲明
禁止：一定會成功、必然有效果、未來趨勢所有人都要用。
替換：加限定詞或改為描述性語言。
錯誤：「是未來的趨勢」
正確：「是越來越多專業人士選擇的方式」

可以保留的語言：
描述性的強烈語言、情緒衝擊性的表達、有限定詞的經驗陳述、因果邏輯描述，全部保留。
目標是踩到 TikTok 政策邊界 97 分，不是保守站在 80 分。
只改真正違規的字，不削弱文案的說服力。`;

const TAIWAN_CASUAL_TONE_RULES = `
台灣腔口播語氣規則：
只有當本次功能或使用者選擇「素人隨聊感」「素人隨聊語氣」或 tone=casual 時套用。
生成出來的文案必須從頭到尾像台灣人在聊天，不像在念稿。

節奏：
每句不超過 8 個字。
一句一行。
每 3 到 4 句空一行。

語助詞：
平均每 3 到 5 句出現一次。
可用：欸、啊、喔、而已、蠻、就是。
不要每句都有，偶爾出現才自然。

啦的用法：
「啦」只出現在帶情緒張力的句子。
否認：「不是啦」
妥協：「好啦好啦」
放棄：「算了啦」
不甘願：「我不去了啦」
輕描淡寫退讓：「不適合就算了啦」
絕對不放在平靜陳述句的句尾。
錯誤：「做了十五年了啦」
正確：「做了快十五年了欸」

真實感停頓：
每篇隨機插入 2 到 4 次，放在情緒轉折點前。
不在開場句和 CTA 句使用。
可用：「欸……」「就是那種……」「怎麼說呢……」「然後……」「對，就是這樣。」「……」

句型：
多用自問自答：「XXX 是什麼？就是……」
多用第三人稱帶入故事：「我有個朋友啊……」
結尾用反問句讓觀眾對號入座。

禁止：
書面語：因此、然而、此外。改成然後、但是。
數字書面化：「將近十年」。改成「快十年」。
任何 emoji 和表情符號。
每句都加語助詞。

語氣控制：
句子短 = 語速自動放慢輕鬆。
句子長 = 語速自動穩定有重量。
「——」= 長停頓。
「，」= 短停頓。
「欸」= 音調上揚。
「啊」= 音調放鬆。
「……」= 自動放慢拉長。`;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

function cleanText(value, max = 12000) {
  return String(value || '').slice(0, max).trim();
}

function normalizeType(type) {
  const value = String(type || '').toLowerCase();
  if (['topics', 'script', 'marketing', 'compliance'].includes(value)) return value;
  return 'script';
}

function basePromptFor(type) {
  if (type === 'topics') {
    return '你是台灣短影音選題策略師，擅長為 B2B 服務業與專業人士產出有鉤子、可拍攝、可轉成腳本的繁體中文選題。只用繁體中文，不使用 emoji。';
  }
  if (type === 'marketing') {
    return '你是台灣數位行銷文案師，專門為各行各業的 TikTok 短影音創作各類優質行銷文案。必須百分之百根據使用者提供的行業與內容進行發想。風格口語或說服有力。只用繁體中文，不使用 emoji。';
  }
  if (type === 'compliance') {
    return '你是台灣廣告法規審查專家，審查 TikTok 短影音腳本是否符合 TikTok 廣告政策與台灣公平交易法。只用繁體中文回答。';
  }
  return '你是台灣短影音腳本顧問，擅長把選題展開成自然、好拍、有說服力的繁體中文口播腳本。只用繁體中文，不使用 emoji。';
}

function shouldApplyCompliance(type) {
  return type === 'topics' || type === 'script' || type === 'marketing';
}

function buildSystemPrompt({ type, fmt, tone, systemPrompt }) {
  const normalized = normalizeType(type);
  const providedSystem = cleanText(systemPrompt);
  const parts = [
    providedSystem || basePromptFor(normalized)
  ].filter(Boolean);

  if (shouldApplyCompliance(normalized)) {
    parts.push('以下規則是附加安全與語氣規則，不可以覆蓋前面指定的功能邏輯、輸出格式、欄位名稱或使用者要求。');
    parts.push(TIKTOK_COMPLIANCE_RULES);
    parts.push(TAIWAN_CASUAL_TONE_RULES);
  }

  if (normalized === 'script') {
    parts.push(`本次腳本格式：${fmt === 'simple' ? '純口播格式' : '分鏡腳本格式'}。本次語氣：${tone || 'casual'}。`);
    parts.push('如果是分鏡腳本，必須保留【開場鉤子】【段落一】【段落二】【段落三】【行動呼籲】以及「秒數、口說、畫面、剪輯提示」等原本結構。所有口說文案加總約 300-500 個中文字，適合 1-2 分鐘口播。台灣口語規則只套用在「口說」文案，不要讓畫面與剪輯欄位變得鬆散。');
  }
  if (normalized === 'marketing') {
    parts.push('行銷文案要保留說服力與平台感；若輸出 hashtag，數量最多 5 個，且不可套用與腳本行業無關的品牌或分類標籤。');
  }
  if (normalized === 'topics') {
    parts.push('選題生成必須根據學員背景與目標受眾痛點輸出 8 條；如果使用者要求隨機分配，需在 8 條中混合痛點鏡子、知識降維、迷思破解、客戶故事、選擇指南、行動催化等方向，且保留「類型」欄位。');
  }
  return parts.join('\n\n');
}

function modelCandidates(env) {
  const preferred = cleanText(env.ANTHROPIC_MODEL, 128);
  return [...new Set([preferred, ...DEFAULT_MODELS].filter(Boolean))];
}

async function callAnthropic(env, body) {
  let lastError = null;
  for (const model of modelCandidates(env)) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        'x-api-key': env.ANTHROPIC_API_KEY
      },
      body: JSON.stringify({ ...body, model })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    lastError = data;
    const message = String(data?.error?.message || data?.message || '');
    if (!/model|not_found|does not exist/i.test(message)) break;
  }
  const err = new Error('AI_SERVICE_ERROR');
  err.detail = lastError;
  throw err;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
    if (!env.ANTHROPIC_API_KEY) return jsonResponse({ error: 'service_not_configured' }, 500);

    let payload;
    try {
      payload = await request.json();
    } catch(e) {
      return jsonResponse({ error: 'invalid_json' }, 400);
    }

    const userPrompt = cleanText(payload.userPrompt);
    if (!userPrompt) return jsonResponse({ error: 'missing_user_prompt' }, 400);

    const type = normalizeType(payload.type);
    const system = buildSystemPrompt({
      type,
      fmt: payload.fmt || 'storyboard',
      tone: payload.tone || 'casual',
      systemPrompt: payload.systemPrompt
    });

    try {
      const data = await callAnthropic(env, {
        max_tokens: type === 'topics' ? 2400 : (type === 'script' ? 3200 : 2400),
        temperature: type === 'compliance' ? 0.2 : 0.75,
        system,
        messages: [{ role: 'user', content: userPrompt }]
      });
      return jsonResponse(data);
    } catch(e) {
      console.error('ai backend error', JSON.stringify(e.detail || e.message || e));
      return jsonResponse({ error: 'ai_service_error' }, 502);
    }
  }
};
