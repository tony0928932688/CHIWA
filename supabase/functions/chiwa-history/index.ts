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
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function cleanText(value: unknown, limit: number) {
  const text = String(value || "").replace(/\u0000/g, "").trim();
  return text.length > limit ? text.slice(0, limit) : text;
}

function cleanType(value: unknown) {
  const type = String(value || "other").trim();
  return ["topics", "script", "marketing", "compliance", "other"].includes(type) ? type : "other";
}

function publicStudent(row: any) {
  return {
    id: row.id,
    email: row.email,
    google_email: row.google_email,
    name: row.name,
    ai_usage: row.ai_usage,
    voice_seconds: row.voice_seconds,
    avatar_seconds: row.avatar_seconds,
    status: row.status,
    is_admin: !!row.is_admin,
    profile: row.profile || {},
  };
}

async function getAuthorizedStudent(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw Object.assign(new Error("missing_session"), { status: 401 });

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError) throw Object.assign(new Error("invalid_session"), { status: 401 });

  const email = normalizeEmail(userData.user?.email);
  if (!email) throw Object.assign(new Error("missing_user_email"), { status: 401 });

  const checks = [
    { column: "google_email", value: email },
    { column: "email", value: email },
    { column: "id", value: email },
  ];

  for (const check of checks) {
    const { data, error } = await supabaseAdmin
      .from("students")
      .select("*")
      .eq(check.column, check.value)
      .limit(1);
    if (error) continue;
    if (Array.isArray(data) && data[0]) {
      if (data[0].status && data[0].status !== "正常") throw Object.assign(new Error("student_inactive"), { status: 403 });
      return data[0];
    }
  }

  throw Object.assign(new Error("student_not_found"), { status: 404 });
}

function publicHistory(row: any) {
  return {
    id: row.id,
    type: row.type,
    title: row.title || "",
    inputText: row.input_text || "",
    outputText: row.output_text || "",
    meta: row.meta || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function handleSave(req: Request, body: any) {
  const student = await getAuthorizedStudent(req);
  const type = cleanType(body.type);
  const outputText = cleanText(body.output_text ?? body.outputText, 60000);
  if (!outputText) return jsonResponse({ error: "missing_output_text" }, 400);

  const payload = {
    student_id: student.id,
    type,
    title: cleanText(body.title, 160),
    input_text: cleanText(body.input_text ?? body.inputText, 20000),
    output_text: outputText,
    meta: typeof body.meta === "object" && body.meta ? body.meta : {},
    profile_snapshot: student.profile || {},
  };

  const { data, error } = await supabaseAdmin
    .from("ai_generation_history")
    .insert(payload)
    .select("id,type,title,input_text,output_text,meta,created_at,updated_at")
    .single();
  if (error) throw new Error(error.message);

  return jsonResponse({ item: publicHistory(data), student: publicStudent(student) });
}

async function handleList(req: Request, body: any) {
  const student = await getAuthorizedStudent(req);
  const type = cleanType(body.type || "");
  const limit = Math.max(1, Math.min(80, Number.parseInt(String(body.limit || "40"), 10) || 40));

  let query = supabaseAdmin
    .from("ai_generation_history")
    .select("id,type,title,input_text,output_text,meta,created_at,updated_at")
    .eq("student_id", student.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (body.type && type !== "other") query = query.eq("type", type);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return jsonResponse({ items: (data || []).map(publicHistory), student: publicStudent(student) });
}

async function handleDelete(req: Request, body: any) {
  const student = await getAuthorizedStudent(req);
  const id = cleanText(body.id, 80);
  if (!id) return jsonResponse({ error: "missing_id" }, 400);

  const { error } = await supabaseAdmin
    .from("ai_generation_history")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("student_id", student.id);
  if (error) throw new Error(error.message);

  return jsonResponse({ ok: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").trim();
    if (action === "save") return await handleSave(req, body);
    if (action === "list") return await handleList(req, body);
    if (action === "delete") return await handleDelete(req, body);
    return jsonResponse({ error: "unknown_action" }, 400);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "unexpected_error";
    const status = (error as any)?.status || ([ "missing_session", "invalid_session" ].includes(message) ? 401 : 500);
    return jsonResponse({ error: message }, status);
  }
});
