import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const AI_QUOTA = 300;
const VOICE_CREDITS = 10000;
const HEYGEN_MINUTES = 30;
const AVATAR_SECONDS = 1800;
const RUNNINGHUB_ACCOUNT_STATUS_URL = "https://www.runninghub.ai/uc/openapi/accountStatus";
const RUNNINGHUB_DASHBOARD_URL = "https://www.runninghub.ai/";
const RUNNINGHUB_DOCS_URL = "https://www.runninghub.ai/runninghub-api-doc-en/api-425761030";
const AVATAR_WORKER_URL = "https://rapid-grass-589dchiwa-avatar-r2.tony0928932688.workers.dev";
const RUNNINGHUB_WARN_COINS = 200;
const RUNNINGHUB_ERROR_COINS = 20;

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://chiwaai.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  { auth: { persistSession: false } },
);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function cleanIdentity(value: unknown) {
  return String(value || "").trim();
}

function getAuthIdentity(user: any) {
  const email = normalizeEmail(user?.email);
  const authUid = cleanIdentity(user?.id);
  let provider = cleanIdentity(user?.app_metadata?.provider);
  let lineUserId = "";
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  for (const identity of identities) {
    const identityProvider = cleanIdentity(identity?.provider);
    if (!provider && identityProvider) provider = identityProvider;
    if (/line/i.test(identityProvider)) {
      const data = identity?.identity_data || {};
      lineUserId = cleanIdentity(identity?.provider_id || data.sub || data.user_id || data.userId || data.id);
      break;
    }
  }
  const metadata = user?.user_metadata || {};
  if (!lineUserId && /line/i.test(provider)) {
    lineUserId = cleanIdentity(metadata.sub || metadata.user_id || metadata.userId || metadata.provider_id || metadata.id);
  }
  return { email, authUid, provider, lineUserId };
}

function isInactiveStatus(value: unknown) {
  const status = String(value || "").trim().toLowerCase();
  return ["disabled", "inactive", "blocked"].includes(status);
}

function round1(value: number) {
  return Math.max(0, Math.round(value * 10) / 10);
}

function publicStudent(row: any) {
  const voiceCredits = row.voice_credits ?? VOICE_CREDITS;
  const voiceMinutes = row.voice_minutes ?? round1(Number(voiceCredits) / 150);
  const avatarSeconds = row.avatar_seconds === null || row.avatar_seconds === undefined ? Math.round(Number(row.heygen_minutes ?? HEYGEN_MINUTES) * 60) : Math.max(0, Math.round(Number(row.avatar_seconds)));
  const heygenMinutes = round1(avatarSeconds / 60);
  return {
    id: row.id,
    email: row.email,
    google_email: row.google_email,
    google_enabled: row.google_enabled,
    name: row.name,
    ai_usage: row.ai_usage,
    voice_credits: Math.max(0, Math.round(Number(voiceCredits))),
    voice_minutes: voiceMinutes,
    heygen_minutes: heygenMinutes,
    voice_seconds: Math.round(voiceMinutes * 60),
    avatar_seconds: avatarSeconds,
    reset_month: row.reset_month,
    quota_started_at: row.quota_started_at,
    quota_reset_at: row.quota_reset_at,
    status: row.status,
    note: row.note,
    reg_date: row.reg_date,
    is_admin: !!row.is_admin,
    profile: row.profile || {},
    created_at: row.created_at,
  };
}

function validDate(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date : null;
}

function currentYearMonth(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

type HealthStatus = "ok" | "warn" | "error" | "manual";

function healthItem(
  name: string,
  category: string,
  status: HealthStatus,
  detail: string,
  evidence = "",
  links: Array<{ label: string; url: string; kind?: string }> = [],
) {
  return { name, category, status, detail, evidence, links };
}

function summarizeHealth(items: Array<{ status: HealthStatus }>) {
  return items.reduce(
    (summary, item) => {
      summary[item.status] += 1;
      return summary;
    },
    { ok: 0, warn: 0, error: 0, manual: 0 },
  );
}

function safeText(value: unknown, max = 240) {
  return String(value || "")
    .trim()
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    .slice(0, max);
}

async function readJsonOrText(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { message: text || `${res.status} ${res.statusText}` };
  }
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function firstValue(payload: any, keys: string[]) {
  const roots = [payload, payload?.data, payload?.result, payload?.account, payload?.response];
  for (const root of roots) {
    if (!root || typeof root !== "object") continue;
    for (const key of keys) {
      if (root[key] !== null && root[key] !== undefined && root[key] !== "") return root[key];
    }
  }
  return null;
}

function firstNumber(payload: any, keys: string[]) {
  const value = firstValue(payload, keys);
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function providerMessage(payload: any) {
  const message = firstValue(payload, [
    "message",
    "msg",
    "error",
    "errorMessage",
    "error_message",
    "detail",
    "promptTips",
  ]);
  if (message && typeof message === "object") return safeText(JSON.stringify(message));
  return safeText(message);
}

async function checkRunningHubAccount() {
  const apiKey = Deno.env.get("RUNNINGHUB_API_KEY") || "";
  const links = [
    { label: "RunningHub 後台", url: RUNNINGHUB_DASHBOARD_URL, kind: "external" },
    { label: "帳戶狀態 API 文件", url: RUNNINGHUB_DOCS_URL, kind: "external" },
  ];
  if (!apiKey) {
    return healthItem(
      "RunningHub 形象克隆帳務",
      "供應商 API",
      "error",
      "RUNNINGHUB_API_KEY 尚未設定，形象克隆不能送出。",
      "Supabase Edge Function secrets 未找到 RUNNINGHUB_API_KEY。",
      links,
    );
  }

  try {
    const res = await fetchWithTimeout(RUNNINGHUB_ACCOUNT_STATUS_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const payload = await readJsonOrText(res);
    if (!res.ok) {
      return healthItem(
        "RunningHub 形象克隆帳務",
        "供應商 API",
        "error",
        "RunningHub 帳戶狀態查詢失敗，形象克隆可能無法送出。",
        `HTTP ${res.status} ${safeText(providerMessage(payload) || res.statusText)}`,
        links,
      );
    }

    const code = firstValue(payload, ["code", "statusCode", "errorCode"]);
    const numericCode = code === null ? null : Number(code);
    if (numericCode !== null && Number.isFinite(numericCode) && numericCode >= 400) {
      return healthItem(
        "RunningHub 形象克隆帳務",
        "供應商 API",
        "error",
        "RunningHub 回傳錯誤代碼，請先到供應商後台確認會員、密鑰或餘額。",
        `code=${safeText(code)} message=${providerMessage(payload) || "無訊息"}`,
        links,
      );
    }

    const remainCoins = firstNumber(payload, ["remainCoins", "remain_coins", "coins", "balance"]);
    const remainMoney = firstNumber(payload, ["remainMoney", "remain_money", "money"]);
    const currentTaskCounts = firstNumber(payload, ["currentTaskCounts", "current_task_counts", "runningTaskCount"]);
    const currency = safeText(firstValue(payload, ["currency", "coinName", "unit"]) || "R幣");
    const apiType = safeText(firstValue(payload, ["apiType", "type", "plan"]) || "");

    if (remainCoins === null) {
      return healthItem(
        "RunningHub 形象克隆帳務",
        "供應商 API",
        "warn",
        "RunningHub 可連線，但回傳格式沒有可判讀的剩餘點數欄位，請人工確認餘額。",
        `response=${safeText(JSON.stringify(payload), 320)}`,
        links,
      );
    }

    let status: HealthStatus = "ok";
    let detail = "RunningHub 帳務正常，形象克隆線路可用。";
    if (remainCoins <= RUNNINGHUB_ERROR_COINS) {
      status = "error";
      detail = "RunningHub RH 幣幾乎不足，請先充值，否則形象克隆很可能失敗。";
    } else if (remainCoins < RUNNINGHUB_WARN_COINS) {
      status = "warn";
      detail = "RunningHub RH 幣偏低，建議先充值，避免上課或學員使用時突然失敗。";
    }

    return healthItem(
      "RunningHub 形象克隆帳務",
      "供應商 API",
      status,
      detail,
      [
        `remainCoins=${remainCoins}`,
        remainMoney !== null ? `remainMoney=${remainMoney}` : "",
        currentTaskCounts !== null ? `currentTaskCounts=${currentTaskCounts}` : "",
        currency ? `currency=${currency}` : "",
        apiType ? `apiType=${apiType}` : "",
      ].filter(Boolean).join(" | "),
      links,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return healthItem(
      "RunningHub 形象克隆帳務",
      "供應商 API",
      "error",
      "RunningHub 帳戶狀態無法連線，可能是供應商、網路或 API 密鑰問題。",
      safeText(message),
      links,
    );
  }
}

async function checkStudentsTable() {
  const { count, error } = await supabaseAdmin.from("students").select("id", { count: "exact", head: true });
  if (error) {
    return healthItem(
      "Supabase 學員資料庫",
      "資料庫",
      "error",
      "students 表無法讀取，登入、扣點、管理員後台都可能受影響。",
      safeText(error.message),
    );
  }
  return healthItem(
    "Supabase 學員資料庫",
    "資料庫",
    "ok",
    "students 表可讀取，學員權限與扣點資料庫目前可用。",
    `studentRows=${count ?? 0}`,
  );
}

async function checkAvatarTaskHistory() {
  const { data, error } = await supabaseAdmin
    .from("avatar_generation_tasks")
    .select("status, created_at, raw_response")
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) {
    return healthItem(
      "最近形象克隆任務",
      "任務紀錄",
      "warn",
      "無法讀取最近形象克隆任務紀錄；不影響立即使用，但會降低排查效率。",
      safeText(error.message),
    );
  }
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) {
    return healthItem(
      "最近形象克隆任務",
      "任務紀錄",
      "manual",
      "目前沒有最近任務紀錄可判斷，若剛充值後仍失敗，請送一筆測試任務再巡檢。",
      "avatar_generation_tasks 最近 5 筆為空。",
    );
  }
  const statuses = rows.map((row) => safeText(row?.status || "UNKNOWN", 40));
  const failed = rows.find((row) => /fail|error|cancel|reject|timeout/i.test(String(row?.status || "")));
  const latest = rows[0];
  const evidence = `latest=${safeText(latest?.status || "UNKNOWN", 40)} at ${safeText(latest?.created_at, 40)} | last5=${statuses.join(", ")}`;
  if (failed) {
    return healthItem(
      "最近形象克隆任務",
      "任務紀錄",
      "warn",
      "最近任務中有失敗紀錄；若 RunningHub 餘額正常，再看素材連結或供應商錯誤訊息。",
      evidence,
    );
  }
  return healthItem(
    "最近形象克隆任務",
    "任務紀錄",
    "ok",
    "最近形象克隆任務紀錄沒有明顯失敗狀態。",
    evidence,
  );
}

async function checkAvatarR2Worker() {
  try {
    const res = await fetchWithTimeout(`${AVATAR_WORKER_URL}/avatar/multipart/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "video", size: 1, fileName: "health-check.mp4" }),
    });
    const payload = await readJsonOrText(res);
    if (res.status === 401 || res.status === 403) {
      return healthItem(
        "Cloudflare R2 形象素材上傳",
        "檔案路由",
        "ok",
        "R2 上傳 Worker 有正常回應，未登入請求被拒絕是預期結果。",
        `HTTP ${res.status} ${providerMessage(payload) || "authorization required"}`,
      );
    }
    if (res.ok) {
      return healthItem(
        "Cloudflare R2 形象素材上傳",
        "檔案路由",
        "warn",
        "R2 上傳 Worker 回應成功，但健康檢查不應建立實際上傳；請確認 Worker 權限規則。",
        `HTTP ${res.status}`,
      );
    }
    return healthItem(
      "Cloudflare R2 形象素材上傳",
      "檔案路由",
      "warn",
      "R2 上傳 Worker 有回應但不是預期的未授權狀態，若素材上傳失敗再查 Worker 設定。",
      `HTTP ${res.status} ${providerMessage(payload) || res.statusText}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return healthItem(
      "Cloudflare R2 形象素材上傳",
      "檔案路由",
      "error",
      "R2 上傳 Worker 無法連線，形象素材上傳與大檔案流程可能受影響。",
      safeText(message),
    );
  }
}

function checkConfiguredService(name: string, category: string, envNames: string[], detailOk: string, detailMissing: string) {
  const configured = envNames.some((envName) => !!Deno.env.get(envName));
  return healthItem(
    name,
    category,
    configured ? "manual" : "warn",
    configured ? detailOk : detailMissing,
    configured ? `configured=${envNames.filter((envName) => !!Deno.env.get(envName)).join(", ")}` : `missing=${envNames.join(" or ")}`,
  );
}

async function handleSystemHealth(req: Request, _body: any) {
  const student = await getCurrentStudent(req);
  if (!student.is_admin) {
    throw Object.assign(new Error("admin_required"), { status: 403 });
  }

  const items = [
    healthItem(
      "Supabase 管理員授權",
      "後台權限",
      "ok",
      "目前登入者是管理員，可以查看系統健康中心。",
      `admin=${safeText(student.email || student.id, 80)}`,
    ),
    await checkStudentsTable(),
    await checkRunningHubAccount(),
    await checkAvatarR2Worker(),
    await checkAvatarTaskHistory(),
    checkConfiguredService(
      "Cartesia / Sonic 語音服務",
      "供應商 API",
      ["CARTESIA_API_KEY", "VOICE_API_KEY"],
      "語音服務密鑰已設定；巡檢不會送出付費 TTS，只標示設定狀態。",
      "語音服務密鑰未設定，語音克隆可能無法生成。",
    ),
    checkConfiguredService(
      "Shotstack 成片輸出",
      "供應商 API",
      ["SHOTSTACK_API_KEY", "SHOTSTACK_SANDBOX_API_KEY"],
      "Shotstack 密鑰已設定；巡檢不送出渲染任務，避免產生成本。",
      "Shotstack 密鑰未設定，第五步成片輸出可能無法送出。",
    ),
  ];

  const notes = [
    "巡檢不會建立形象克隆、語音、Shotstack 渲染等付費任務。",
    `RunningHub RH 幣低於 ${RUNNINGHUB_WARN_COINS} 會提醒充值，低於 ${RUNNINGHUB_ERROR_COINS} 會標為錯誤。`,
    "供應商若沒有安全的餘額查詢 API，系統會先以密鑰設定與路由可達性判斷，並標示為需人工確認。",
  ];

  return jsonResponse({
    checkedAt: new Date().toISOString(),
    summary: summarizeHealth(items),
    items,
    notes,
  });
}

async function getAuthIdentityFromRequest(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("missing_session");
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error) throw new Error("invalid_session");
  const identity = getAuthIdentity(data.user);
  if (!identity.email && !identity.lineUserId && !identity.authUid) throw new Error("missing_user_identity");
  return identity;
}

async function findStudentByAuthIdentity(identity: { email?: string; lineUserId?: string; authUid?: string }) {
  const checks: Array<{ column: string; value: string }> = [];
  if (identity.email) {
    checks.push(
      { column: "google_email", value: identity.email },
      { column: "email", value: identity.email },
      { column: "id", value: identity.email },
    );
  }
  if (identity.lineUserId) checks.push({ column: "line_user_id", value: identity.lineUserId });
  if (identity.authUid) {
    checks.push(
      { column: "line_auth_uid", value: identity.authUid },
      { column: "id", value: identity.authUid },
    );
  }
  const matches: any[] = [];
  for (const check of checks) {
    const { data, error } = await supabaseAdmin.from("students").select("*").eq(check.column, check.value);
    if (!error && Array.isArray(data)) matches.push(...data);
  }
  const seen = new Set<string>();
  const unique = matches.filter((row) => {
    const key = String(row?.id || "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => {
    const aActive = isInactiveStatus(a.status) ? 0 : 1;
    const bActive = isInactiveStatus(b.status) ? 0 : 1;
    if (aActive !== bActive) return bActive - aActive;
    if (!!a.is_admin !== !!b.is_admin) return b.is_admin ? 1 : -1;
    if (!!a.google_enabled !== !!b.google_enabled) return b.google_enabled ? 1 : -1;
    return 0;
  });
  return unique[0] || null;
}

async function getCurrentStudent(req: Request, allowInactive = false) {
  const identity = await getAuthIdentityFromRequest(req);
  const student = await findStudentByAuthIdentity(identity);
  if (!student) throw new Error("student_not_found");
  if (!allowInactive && isInactiveStatus(student.status)) throw new Error("student_inactive");
  return student;
}

async function refreshQuotaCycle(student: any) {
  const now = new Date();
  const start = validDate(student.quota_started_at) || validDate(student.created_at) || now;
  const resetAt = validDate(student.quota_reset_at);
  const ym = currentYearMonth(now);
  const patch: Record<string, unknown> = {};
  let reset = false;

  if (resetAt && now >= resetAt) {
    patch.ai_usage = AI_QUOTA;
    patch.voice_credits = VOICE_CREDITS;
    patch.voice_minutes = round1(VOICE_CREDITS / 150);
    patch.heygen_minutes = HEYGEN_MINUTES;
    patch.voice_seconds = Math.round((VOICE_CREDITS / 150) * 60);
    patch.avatar_seconds = AVATAR_SECONDS;
    patch.reset_month = ym;
    patch.quota_started_at = now.toISOString();
    patch.quota_reset_at = addDays(now, 30).toISOString();
    reset = true;
  } else {
    if (student.voice_credits === null || student.voice_credits === undefined) {
      patch.voice_credits = VOICE_CREDITS;
    }
    if (student.voice_minutes === null || student.voice_minutes === undefined || student.voice_seconds === null || student.voice_seconds === undefined) {
      const credits = Number(patch.voice_credits ?? student.voice_credits ?? VOICE_CREDITS);
      patch.voice_minutes = round1(credits / 150);
      patch.voice_seconds = Math.round(Number(patch.voice_minutes) * 60);
    }
    if (student.avatar_seconds === null || student.avatar_seconds === undefined) {
      patch.avatar_seconds = student.heygen_minutes === null || student.heygen_minutes === undefined ? AVATAR_SECONDS : Math.round(Number(student.heygen_minutes) * 60);
      patch.heygen_minutes = round1(Number(patch.avatar_seconds) / 60);
    } else if (student.heygen_minutes === null || student.heygen_minutes === undefined) {
      patch.heygen_minutes = round1(Number(student.avatar_seconds) / 60);
    }
    if (!student.quota_started_at) patch.quota_started_at = start.toISOString();
    if (!student.quota_reset_at) {
      const firstReset = addDays(start, 30);
      patch.quota_reset_at = (firstReset > now ? firstReset : addDays(now, 30)).toISOString();
    }
    if (!student.reset_month) patch.reset_month = ym;
  }

  if (Object.keys(patch).length === 0) return { student, reset: false };
  const { data, error } = await supabaseAdmin.from("students").update(patch).eq("id", student.id).select("*").single();
  if (error) throw new Error(error.message);
  return { student: data, reset };
}

async function handleProfile(req: Request) {
  const student = await getCurrentStudent(req);
  const refreshed = await refreshQuotaCycle(student);
  return jsonResponse({ student: publicStudent(refreshed.student), reset: refreshed.reset });
}

async function handleUsage(req: Request, body: any) {
  const student = await getCurrentStudent(req);
  const type = String(body.type || "").trim();
  const rawAmount = Number(body.amount || 1);
  const amount = Math.max(1, Math.round(rawAmount || 1));

  const update: Record<string, number> = {};
  if (type === "ai") {
    update.ai_usage = Math.max(0, Number(student.ai_usage || 0) - amount);
  } else if (type === "voice") {
    const next = Math.max(0, Math.round(Number(student.voice_credits ?? VOICE_CREDITS) - amount));
    update.voice_credits = next;
    update.voice_minutes = round1(next / 150);
    update.voice_seconds = Math.round(update.voice_minutes * 60);
  } else if (type === "heygen" || type === "avatar") {
    const currentSeconds = Math.max(0, Math.round(Number(student.avatar_seconds ?? AVATAR_SECONDS)));
    const nextSeconds = Math.max(0, currentSeconds - amount);
    update.avatar_seconds = nextSeconds;
    update.heygen_minutes = round1(nextSeconds / 60);
  } else {
    return jsonResponse({ error: "invalid_usage_type" }, 400);
  }

  const { data, error } = await supabaseAdmin.from("students").update(update).eq("id", student.id).select("*").single();
  if (error) throw new Error(error.message);
  console.log("quota_saved", JSON.stringify({ studentId: student.id, type, amount, update }));
  return jsonResponse({ student: publicStudent(data), used: amount });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").trim();
    if (action === "profile") return await handleProfile(req);
    if (action === "usage") return await handleUsage(req, body);
    if (action === "system_health") return await handleSystemHealth(req, body);
    return jsonResponse({ error: "unknown_action" }, 400);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "unexpected_error";
    const status = (error as any)?.status || (["missing_session", "invalid_session"].includes(message) ? 401 : 400);
    return jsonResponse({ error: message }, status);
  }
});
