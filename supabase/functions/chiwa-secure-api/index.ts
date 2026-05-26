import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const AI_QUOTA = 300;
const VOICE_CREDITS = 10000;
const HEYGEN_MINUTES = 30;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function round1(value: number) {
  return Math.max(0, Math.round(value * 10) / 10);
}

function publicStudent(row: any) {
  const voiceCredits = row.voice_credits ?? VOICE_CREDITS;
  const voiceMinutes = row.voice_minutes ?? round1(Number(voiceCredits) / 150);
  const heygenMinutes = row.heygen_minutes ?? (row.avatar_seconds === null || row.avatar_seconds === undefined ? HEYGEN_MINUTES : round1(Number(row.avatar_seconds) / 60));
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
    avatar_seconds: Math.round(heygenMinutes * 60),
    reset_month: row.reset_month,
    quota_started_at: row.quota_started_at,
    quota_reset_at: row.quota_reset_at,
    status: row.status,
    note: row.note,
    reg_date: row.reg_date,
    is_admin: !!row.is_admin,
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

function nextMonthStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

async function getAuthEmail(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("missing_session");
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error) throw new Error("invalid_session");
  const email = normalizeEmail(data.user?.email);
  if (!email) throw new Error("missing_user_email");
  return email;
}

async function findStudentByEmail(email: string) {
  const checks = [
    { column: "google_email", value: email },
    { column: "email", value: email },
    { column: "id", value: email },
  ];
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
    const aActive = !a.status || a.status === "正常" ? 1 : 0;
    const bActive = !b.status || b.status === "正常" ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    if (!!a.is_admin !== !!b.is_admin) return b.is_admin ? 1 : -1;
    if (!!a.google_enabled !== !!b.google_enabled) return b.google_enabled ? 1 : -1;
    return 0;
  });
  return unique[0] || null;
}

async function getCurrentStudent(req: Request, allowInactive = false) {
  const email = await getAuthEmail(req);
  const student = await findStudentByEmail(email);
  if (!student) throw new Error("student_not_found");
  if (!allowInactive && student.status && student.status !== "正常") throw new Error("student_inactive");
  return student;
}

async function refreshQuotaCycle(student: any) {
  const now = new Date();
  const start = validDate(student.quota_started_at) || validDate(student.created_at) || now;
  const ym = currentYearMonth(now);
  const patch: Record<string, unknown> = {};
  let reset = false;

  if (student.reset_month !== ym) {
    patch.ai_usage = AI_QUOTA;
    patch.voice_credits = VOICE_CREDITS;
    patch.voice_minutes = round1(VOICE_CREDITS / 150);
    patch.heygen_minutes = HEYGEN_MINUTES;
    patch.voice_seconds = Math.round((VOICE_CREDITS / 150) * 60);
    patch.avatar_seconds = HEYGEN_MINUTES * 60;
    patch.reset_month = ym;
    patch.quota_started_at = start.toISOString();
    patch.quota_reset_at = nextMonthStart(now).toISOString();
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
    if (student.heygen_minutes === null || student.heygen_minutes === undefined) {
      patch.heygen_minutes = student.avatar_seconds === null || student.avatar_seconds === undefined ? HEYGEN_MINUTES : round1(Number(student.avatar_seconds) / 60);
      patch.avatar_seconds = Math.round(Number(patch.heygen_minutes) * 60);
    }
    if (!student.quota_started_at) patch.quota_started_at = start.toISOString();
    if (!student.quota_reset_at) patch.quota_reset_at = nextMonthStart(now).toISOString();
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

  if (student.is_admin) return jsonResponse({ student: publicStudent(student), used: 0 });

  const update: Record<string, number> = {};
  if (type === "ai") {
    update.ai_usage = Math.max(0, Number(student.ai_usage || 0) - amount);
  } else if (type === "voice") {
    const next = Math.max(0, Math.round(Number(student.voice_credits ?? VOICE_CREDITS) - amount));
    update.voice_credits = next;
    update.voice_minutes = round1(next / 150);
    update.voice_seconds = Math.round(update.voice_minutes * 60);
  } else if (type === "heygen" || type === "avatar") {
    const next = round1(Number(student.heygen_minutes ?? HEYGEN_MINUTES) - amount);
    update.heygen_minutes = next;
    update.avatar_seconds = Math.round(next * 60);
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
    return jsonResponse({ error: "unknown_action" }, 400);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "unexpected_error";
    const status = ["missing_session", "invalid_session"].includes(message) ? 401 : 400;
    return jsonResponse({ error: message }, status);
  }
});
