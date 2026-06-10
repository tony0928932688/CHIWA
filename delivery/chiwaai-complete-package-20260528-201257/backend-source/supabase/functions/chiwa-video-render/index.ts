import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SHOTSTACK_RENDER_URL = Deno.env.get("SHOTSTACK_RENDER_URL") || "https://api.shotstack.io/edit/stage/render";
const AVATAR_WORKER_URL = "https://rapid-grass-589dchiwa-avatar-r2.tony0928932688.workers.dev";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://chiwaai.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
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

function neutralError(message = "video_render_failed", status = 500) {
  return jsonResponse({ error: message }, status);
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function cleanText(value: unknown, max = 3000) {
  return String(value || "").trim().slice(0, max);
}

function safePathSegment(value: unknown, fallback = "item") {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 96) || fallback;
}

function assertUrl(value: unknown, field: string) {
  const raw = String(value || "").trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error(`${field}_invalid_url`), { status: 400 });
  }
  if (url.protocol !== "https:") throw Object.assign(new Error(`${field}_must_be_https`), { status: 400 });
  return raw;
}

function normalizeSeconds(value: unknown) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 60;
  return Math.max(1, Math.min(600, Math.round(n)));
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
      const status = String(data[0].status || "").trim().toLowerCase();
      if (["disabled", "inactive", "blocked"].includes(status)) {
        throw Object.assign(new Error("student_inactive"), { status: 403 });
      }
      return { student: data[0], token };
    }
  }

  throw Object.assign(new Error("student_not_found"), { status: 404 });
}

async function readJsonOrText(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { message: text || `${res.status} ${res.statusText}` };
  }
}

function shotstackHeaders(apiKey: string) {
  return {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };
}

function internalWorkerSecret() {
  return (
    Deno.env.get("AVATAR_WORKER_INTERNAL_SECRET") ||
    Deno.env.get("RUNNINGHUB_API_KEY") ||
    ""
  );
}

function internalWorkerHeaders(secret: string) {
  return {
    "Authorization": `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
}

async function r2Json(path: string, options: RequestInit) {
  const res = await fetch(`${AVATAR_WORKER_URL}${path}`, options);
  const data = await readJsonOrText(res);
  if (!res.ok) throw Object.assign(new Error(data?.error || `r2_${res.status}`), { status: res.status });
  return data;
}

async function uploadSubtitleToR2(token: string, srtText: string) {
  const bytes = new TextEncoder().encode(srtText);
  const fileName = `chiwa-subtitles-${new Date().toISOString().slice(0, 10)}.srt`;
  const create = await r2Json("/avatar/multipart/create", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      kind: "audio",
      fileName,
      contentType: "application/x-subrip; charset=utf-8",
      size: bytes.byteLength,
    }),
  });

  const part = await r2Json(`/avatar/multipart/part?key=${encodeURIComponent(create.key)}&uploadId=${encodeURIComponent(create.uploadId)}&partNumber=1`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/x-subrip; charset=utf-8",
      "x-chiwa-upload": "workflow-subtitles",
    },
    body: bytes,
  });

  return await r2Json("/avatar/multipart/complete", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key: create.key,
      uploadId: create.uploadId,
      parts: [{ partNumber: Number(part.partNumber), etag: part.etag }],
    }),
  });
}

function buildShotstackEdit(videoUrl: string, subtitleUrl: string, title: string, duration: number) {
  const safeTitle = cleanText(title, 80) || "AI自媒體系統";
  const length = normalizeSeconds(duration);
  return {
    timeline: {
      background: "#000000",
      tracks: [
        {
          clips: [
            {
              asset: {
                type: "title",
                text: safeTitle,
                style: "minimal",
                color: "#ffffff",
                size: "medium",
              },
              start: 0,
              length,
              position: "top",
              offset: { y: -0.34 },
            },
          ],
        },
        {
          clips: [
            {
              asset: {
                type: "caption",
                src: subtitleUrl,
                font: {
                  family: "Noto Sans",
                  color: "#ffffff",
                  size: 32,
                  lineHeight: 0.92,
                  stroke: "#000000",
                  strokeWidth: 1.6,
                },
                background: {
                  color: "#000000",
                  opacity: 0.18,
                  padding: 14,
                  borderRadius: 10,
                },
              },
              start: 0,
              length,
              position: "bottom",
              offset: { y: 0.15 },
            },
          ],
        },
        {
          clips: [
            {
              asset: {
                type: "video",
                src: videoUrl,
                volume: 1,
              },
              start: 0,
              length,
              fit: "contain",
            },
          ],
        },
      ],
    },
    output: {
      format: "mp4",
      resolution: "hd",
      aspectRatio: "9:16",
      fps: 30,
    },
  };
}

function normalizeShotstackStatus(data: any) {
  const response = data?.response || data || {};
  const status = String(response.status || data?.status || "").toUpperCase();
  const id = response.id || data?.id || "";
  const url = response.url || response.render || data?.url || "";
  const error = response.error || data?.error || data?.message || "";
  return { response, status, id, url, error };
}

async function handleSubmit(req: Request, body: any) {
  const apiKey = Deno.env.get("SHOTSTACK_API_KEY") || Deno.env.get("SHOTSTACK_SANDBOX_API_KEY") || "";
  if (!apiKey) return neutralError("video_render_not_configured", 500);

  const { student, token } = await getAuthorizedStudent(req);
  const videoUrl = assertUrl(body.video_url, "video_url");
  const srtText = cleanText(body.srt_text, 50000);
  if (!srtText) return neutralError("missing_subtitles", 400);

  const subtitle = await uploadSubtitleToR2(token, srtText);
  const edit = buildShotstackEdit(
    videoUrl,
    subtitle.signedUrl,
    body.title,
    body.duration_seconds,
  );

  const res = await fetch(SHOTSTACK_RENDER_URL, {
    method: "POST",
    headers: shotstackHeaders(apiKey),
    body: JSON.stringify(edit),
  });
  const data = await readJsonOrText(res);
  if (!res.ok) {
    console.error("video_render_submit_failed", JSON.stringify(data));
    return neutralError("video_render_submit_failed", res.status || 500);
  }

  const normalized = normalizeShotstackStatus(data);
  return jsonResponse({
    renderId: normalized.id,
    status: normalized.status || "QUEUED",
    studentId: student.id,
  });
}

async function importRenderedOutput(student: any, renderId: string, sourceUrl: string) {
  const secret = internalWorkerSecret();
  if (!secret) throw new Error("output_import_not_configured");
  const res = await fetch(`${AVATAR_WORKER_URL}/avatar/output/import`, {
    method: "POST",
    headers: internalWorkerHeaders(secret),
    body: JSON.stringify({
      studentId: student.id,
      taskId: `final-${safePathSegment(renderId, crypto.randomUUID())}`,
      sourceUrl,
      outputType: "mp4",
      fileName: `chiwa-final-${new Date().toISOString().slice(0, 10)}.mp4`,
    }),
  });
  const data = await readJsonOrText(res);
  if (!res.ok) {
    console.error("video_render_import_failed", JSON.stringify(data));
    throw new Error("video_render_import_failed");
  }
  return data;
}

async function handleQuery(req: Request, body: any) {
  const apiKey = Deno.env.get("SHOTSTACK_API_KEY") || Deno.env.get("SHOTSTACK_SANDBOX_API_KEY") || "";
  if (!apiKey) return neutralError("video_render_not_configured", 500);

  const { student } = await getAuthorizedStudent(req);
  const renderId = safePathSegment(body.render_id || body.renderId, "");
  if (!renderId) return neutralError("missing_render_id", 400);

  const queryUrl = `${SHOTSTACK_RENDER_URL.replace(/\/+$/, "")}/${encodeURIComponent(renderId)}`;
  const res = await fetch(queryUrl, {
    method: "GET",
    headers: { "x-api-key": apiKey },
  });
  const data = await readJsonOrText(res);
  if (!res.ok) {
    console.error("video_render_query_failed", JSON.stringify(data));
    return neutralError("video_render_query_failed", res.status || 500);
  }

  const normalized = normalizeShotstackStatus(data);
  const status = normalized.status;
  if (["DONE", "SUCCESS", "COMPLETED", "READY"].includes(status) && normalized.url) {
    const imported = await importRenderedOutput(student, renderId, assertUrl(normalized.url, "render_url"));
    return jsonResponse({
      status: "SUCCESS",
      renderId,
      previewUrl: imported.previewUrl,
      downloadUrl: imported.downloadUrl,
      outputExpiresAt: imported.expiresAt,
    });
  }

  if (["FAILED", "ERROR"].includes(status)) {
    console.error("video_render_failed", JSON.stringify(normalized.response || data));
    return jsonResponse({ status: "FAILED", renderId, error: "video_render_failed" });
  }

  return jsonResponse({
    status: status || "RUNNING",
    renderId,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return neutralError("method_not_allowed", 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").trim();
    if (action === "submit") return await handleSubmit(req, body);
    if (action === "query") return await handleQuery(req, body);
    return neutralError("unknown_action", 400);
  } catch (error) {
    console.error(error);
    const status = Number((error as any)?.status || 500);
    const message = error instanceof Error ? error.message : "unexpected_error";
    return neutralError(message, status);
  }
});
