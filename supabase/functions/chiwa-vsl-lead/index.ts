import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = getSupabaseServiceKey();
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const VSL_MAIL_FROM = Deno.env.get("VSL_MAIL_FROM") || "";
const VSL_MAIL_REPLY_TO = Deno.env.get("VSL_MAIL_REPLY_TO") || "chivashorts@gmail.com";
const VSL_NOTIFY_TO = Deno.env.get("VSL_NOTIFY_TO") || "";
const VSL_PRIVATE_VIDEO_URL = Deno.env.get("VSL_PRIVATE_VIDEO_URL") || "https://chiwaai.com/watch-method.html";

function getSupabaseServiceKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return String(parsed.default || parsed.service_role || "");
  } catch {
    return "";
  }
}

const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

const allowedOrigins = new Set([
  "https://chiwaai.com",
  "https://www.chiwaai.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://chiwaai.com",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function normalizeText(value: unknown, max = 120) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase().slice(0, 160);
}

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function safeJson(value: unknown) {
  try {
    return JSON.parse(JSON.stringify(value || {}));
  } catch {
    return {};
  }
}

async function recordLead(req: Request, lead: Record<string, unknown>) {
  if (!supabaseAdmin) return;
  const { error } = await supabaseAdmin.from("vsl_leads").insert({
    name: lead.name,
    email: lead.email,
    source: lead.source,
    page_url: lead.pageUrl,
    attribution: lead.attribution,
    user_agent: req.headers.get("User-Agent") || "",
    referer: req.headers.get("Referer") || "",
    status: "submitted",
  });
  if (error) console.error("vsl_lead_insert_failed", error.message);
}

function escapeHtml(value: string) {
  return value.replace(/[<>&"]/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;",
  }[char] || char));
}

function emailHtml(name: string) {
  const safeName = escapeHtml(name);
  return `<!doctype html>
<html><body style="margin:0;background:#080912;color:#f6f2e8;font-family:Arial,'Noto Sans TC',sans-serif">
  <div style="max-width:620px;margin:0 auto;padding:28px 20px">
    <div style="background:#121421;border:1px solid rgba(232,197,90,.32);border-radius:16px;padding:26px">
      <div style="font-size:12px;letter-spacing:3px;color:#e8c55a;font-weight:700;text-transform:uppercase">CHIWA AI</div>
      <h1 style="font-size:24px;line-height:1.35;margin:14px 0 10px;color:#fff">完整方法說明觀看連結</h1>
      <p style="font-size:15px;line-height:1.8;color:#c9c4d8;margin:0 0 18px">${safeName} 你好，這是你剛剛索取的影片觀看連結。</p>
      <p style="font-size:14px;line-height:1.8;color:#b9b5c8;margin:0 0 22px">影片內容以方法與流程說明為主，實際成果會因產業、素材品質、執行方式與各平台規則而不同。</p>
      <a href="${VSL_PRIVATE_VIDEO_URL}" style="display:inline-block;background:#e8c55a;color:#080912;text-decoration:none;font-weight:800;border-radius:10px;padding:13px 18px">觀看完整方法說明</a>
      <p style="font-size:12px;line-height:1.7;color:#85819a;margin:22px 0 0">如果按鈕無法開啟，請複製這個連結：<br><span style="word-break:break-all;color:#e8c55a">${VSL_PRIVATE_VIDEO_URL}</span></p>
    </div>
  </div>
</body></html>`;
}

async function sendLeadEmail(name: string, email: string) {
  if (!RESEND_API_KEY || !VSL_MAIL_FROM) {
    throw new Error("mail_not_configured");
  }

  const body: Record<string, unknown> = {
    from: VSL_MAIL_FROM,
    to: [email],
    subject: "吉娃 AI 完整方法說明觀看連結",
    html: emailHtml(name),
    reply_to: VSL_MAIL_REPLY_TO,
  };
  if (VSL_NOTIFY_TO) body.bcc = [VSL_NOTIFY_TO];

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("vsl_lead_email_failed", JSON.stringify(data));
    throw new Error("mail_send_failed");
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { ok: false, error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { ok: false, error: "invalid_json" }, 400);
  }

  if (normalizeText(body.website, 120)) {
    return json(req, { ok: true, skipped: true });
  }

  const name = normalizeText(body.name, 80);
  const email = normalizeEmail(body.email);
  const source = normalizeText(body.source || "homepage_vsl_gate", 80);
  const pageUrl = normalizeText(body.pageUrl, 500);
  const attribution = safeJson(body.attribution);

  if (!name) return json(req, { ok: false, error: "missing_name" }, 400);
  if (!validEmail(email)) return json(req, { ok: false, error: "invalid_email" }, 400);

  await recordLead(req, { name, email, source, pageUrl, attribution });
  await sendLeadEmail(name, email);

  return json(req, { ok: true });
});
