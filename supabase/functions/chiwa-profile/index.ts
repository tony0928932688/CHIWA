import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
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

function cleanText(value: unknown, max = 160) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, max);
}

function cleanArray(value: unknown, maxItems = 3, maxText = 80) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, maxText)).filter(Boolean).slice(0, maxItems);
}

function sanitizeProfile(raw: any) {
  const profile = raw && typeof raw === "object" ? raw : {};
  return {
    name: cleanText(profile.name, 80),
    industry: cleanText(profile.industry, 120),
    service: cleanText(profile.service, 180),
    target_gender: cleanText(profile.target_gender, 80),
    target_age: cleanArray(profile.target_age),
    target_identity: cleanArray(profile.target_identity),
    style: cleanText(profile.style, 80),
    personality: cleanArray(profile.personality),
    audience_feeling: cleanArray(profile.audience_feeling),
    differentiation: cleanArray(profile.differentiation),
    extra_note: cleanText(profile.extra_note, 600),
  };
}

function publicStudent(row: any) {
  return {
    id: row.id,
    email: row.email,
    google_email: row.google_email,
    name: row.name,
    ai_usage: row.ai_usage,
    voice_credits: row.voice_credits,
    avatar_seconds: row.avatar_seconds,
    status: row.status,
    is_admin: !!row.is_admin,
    profile: row.profile || {},
  };
}

function isInactiveStatus(value: unknown) {
  const status = String(value || "").trim().toLowerCase();
  return ["disabled", "inactive", "blocked"].includes(status);
}

async function getAuthorizedStudent(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw Object.assign(new Error("missing_session"), { status: 401 });

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError) throw Object.assign(new Error("invalid_session"), { status: 401 });

  const identity = getAuthIdentity(userData.user);
  if (!identity.email && !identity.lineUserId && !identity.authUid) {
    throw Object.assign(new Error("missing_user_identity"), { status: 401 });
  }

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

  for (const check of checks) {
    const { data, error } = await supabaseAdmin
      .from("students")
      .select("*")
      .eq(check.column, check.value)
      .limit(1);
    if (!error && Array.isArray(data) && data[0]) {
      if (isInactiveStatus(data[0].status)) {
        throw Object.assign(new Error("student_inactive"), { status: 403 });
      }
      return data[0];
    }
  }

  throw Object.assign(new Error("student_not_found"), { status: 404 });
}

async function handleGet(req: Request) {
  const student = await getAuthorizedStudent(req);
  return jsonResponse({ profile: student.profile || {}, student: publicStudent(student) });
}

async function handleSave(req: Request, body: any) {
  const student = await getAuthorizedStudent(req);
  const profile = sanitizeProfile(body.profile);
  const { data, error } = await supabaseAdmin
    .from("students")
    .update({ profile })
    .eq("id", student.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return jsonResponse({ profile, student: publicStudent(data) });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").trim();
    if (action === "get") return await handleGet(req);
    if (action === "save") return await handleSave(req, body);
    return jsonResponse({ error: "unknown_action" }, 400);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "unexpected_error";
    const status = (error as any)?.status || (["missing_session", "invalid_session"].includes(message) ? 401 : 500);
    return jsonResponse({ error: message }, status);
  }
});
