import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PROVIDER_APP_ID = "1928389791241650178";
const PROVIDER_HOST = ["www.", "running", "hub.ai"].join("");
const PROVIDER_SECRET_NAME = ["RUNNING", "HUB_API_KEY"].join("");
const PROVIDER_RUN_URL = `https://${PROVIDER_HOST}/openapi/v2/run/ai-app/${PROVIDER_APP_ID}`;
const PROVIDER_QUERY_URL = `https://${PROVIDER_HOST}/openapi/v2/query`;
const AVATAR_WORKER_URL = "https://rapid-grass-589dchiwa-avatar-r2.tony0928932688.workers.dev";
const DEFAULT_AVATAR_SECONDS = 1800;
const DEFAULT_HEYGEN_MINUTES = 30;
const OUTPUT_RETENTION_DAYS = 1;
const MAX_ACTIVE_TASKS_PER_STUDENT = 1;
const MAX_ACTIVE_TASKS_GLOBAL = 3;
const ACTIVE_TASK_WINDOW_HOURS = 6;
const ACTIVE_AVATAR_STATUSES = ["RUNNING", "PENDING", "QUEUED", "PROCESSING"];
const PROVIDER_MAX_VIDEO_BYTES = 30 * 1024 * 1024;

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

function neutralError(message = "avatar_service_failed", status = 500) {
  return jsonResponse({ error: message }, status);
}

function inputError(message: string, detail: string, status = 400, extra: Record<string, unknown> = {}) {
  return jsonResponse({ error: message, detail, ...extra }, status);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / 1024 / 1024) * 10) / 10}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function safeProviderText(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 240);
}

function providerFailureDetail(payload: any, status: number) {
  const code = safeProviderText(
    payload?.code ||
      payload?.errorCode ||
      payload?.error_code ||
      payload?.data?.code ||
      payload?.result?.code ||
      "",
  );
  const message = [
    payload?.message,
    payload?.msg,
    payload?.error,
    payload?.errorMessage,
    payload?.error_message,
    payload?.detail,
    payload?.promptTips,
    payload?.failedReason,
    payload?.data?.message,
    payload?.data?.msg,
    payload?.data?.error,
    payload?.result?.message,
    payload?.result?.msg,
  ]
    .map((item) => {
      if (item && typeof item === "object") return safeProviderText(JSON.stringify(item));
      return safeProviderText(item);
    })
    .find(Boolean);

  if (code && message) return `供應商回覆 ${code}: ${message}`;
  if (message) return `供應商回覆：${message}`;
  if (code) return `供應商回覆代碼：${code}`;
  return `供應商未建立任務（HTTP ${status || 500}）。`;
}

function providerSubmitError(payload: any, status: number) {
  return jsonResponse({
    error: "avatar_submit_failed",
    detail: providerFailureDetail(payload, status),
    providerStatus: status || 500,
  }, status || 500);
}

function publicStudent(row: any) {
  const voiceCredits = row.voice_credits ?? 10000;
  const voiceMinutes = row.voice_minutes ?? (row.voice_seconds === null || row.voice_seconds === undefined ? 60 : Math.round((Number(row.voice_seconds) / 60) * 10) / 10);
  const avatarSeconds = row.avatar_seconds === null || row.avatar_seconds === undefined ? Math.round(Number(row.heygen_minutes ?? DEFAULT_HEYGEN_MINUTES) * 60) : Math.max(0, Math.round(Number(row.avatar_seconds)));
  const heygenMinutes = Math.round((avatarSeconds / 60) * 10) / 10;
  return {
    id: row.id,
    email: row.email,
    google_email: row.google_email,
    google_enabled: row.google_enabled,
    name: row.name,
    ai_usage: row.ai_usage,
    voice_credits: Math.max(0, Math.round(Number(voiceCredits))),
    voice_seconds: row.voice_seconds,
    avatar_seconds: avatarSeconds,
    voice_minutes: voiceMinutes,
    heygen_minutes: heygenMinutes,
    quota_started_at: row.quota_started_at,
    quota_reset_at: row.quota_reset_at,
    status: row.status,
    is_admin: !!row.is_admin,
    created_at: row.created_at,
  };
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
    if (error) continue;
    if (Array.isArray(data) && data[0]) {
      if (isInactiveStatus(data[0].status)) throw Object.assign(new Error("student_inactive"), { status: 403 });
      return data[0];
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

function providerHeaders(apiKey: string) {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function internalWorkerHeaders(apiKey: string) {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function assertUrl(value: unknown, field: string) {
  const raw = String(value || "").trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error(`${field}_invalid_url`), { status: 400 });
  }
  if (!/^https?:$/.test(url.protocol)) throw Object.assign(new Error(`${field}_invalid_protocol`), { status: 400 });
  return raw;
}

async function probeProviderInputUrl(url: string, field: string, maxBytes = 0) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "ChiwaAvatarPreflight/1.0" },
    });
  } catch {
    return {
      error: inputError(
        `${field}_unreachable`,
        "素材連結暫時無法讀取，請刷新素材或重新上傳後再送出。",
        400,
      ),
    };
  }

  if (!res.ok) {
    return {
      error: inputError(
        `${field}_unreachable`,
        `素材連結暫時無法讀取（HTTP ${res.status}），請刷新素材或重新上傳後再送出。`,
        400,
      ),
    };
  }

  const contentLength = Number(res.headers.get("content-length") || 0);
  if (maxBytes && Number.isFinite(contentLength) && contentLength > maxBytes) {
    return {
      error: inputError(
        "avatar_video_too_large",
        `這支形象素材 ${formatBytes(contentLength)}，超過供應商約 ${formatBytes(maxBytes)} 的限制。請改上傳壓縮版，或選用小於 ${formatBytes(maxBytes)} 的形象素材。`,
        413,
        { contentLength, maxBytes },
      ),
    };
  }

  return { contentLength, contentType: res.headers.get("content-type") || "" };
}

function extractTaskId(payload: any) {
  const candidates = [
    payload?.taskId,
    payload?.task_id,
    payload?.id,
    payload?.runId,
    payload?.run_id,
    payload?.data?.taskId,
    payload?.data?.task_id,
    payload?.data?.id,
    payload?.result?.taskId,
    payload?.result?.task_id,
    payload?.result?.id,
    payload?.task?.taskId,
    payload?.task?.task_id,
    payload?.task?.id,
  ];
  for (const value of candidates) {
    const taskId = String(value || "").trim();
    if (taskId) return taskId;
  }
  return "";
}

function normalizeSeconds(value: unknown) {
  return Math.max(1, Number.parseInt(String(value || "0"), 10) || 0);
}

function isInactiveStatus(value: unknown) {
  const status = String(value || "").trim().toLowerCase();
  return ["disabled", "inactive", "blocked"].includes(status);
}

function assertQuota(student: any, seconds: number) {
  const remainingSeconds = Math.max(0, Math.round(Number(student.avatar_seconds ?? DEFAULT_AVATAR_SECONDS)));
  if (remainingSeconds < seconds) {
    throw Object.assign(new Error("avatar_quota_not_enough"), {
      status: 402,
      extra: { remainingSeconds, requestedSeconds: seconds },
    });
  }
}

async function countActiveAvatarTasks(studentId?: string) {
  const activeSince = new Date(Date.now() - ACTIVE_TASK_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  let query = supabaseAdmin
    .from("avatar_generation_tasks")
    .select("id", { count: "exact", head: true })
    .in("status", ACTIVE_AVATAR_STATUSES)
    .gte("created_at", activeSince);
  if (studentId) query = query.eq("student_id", studentId);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count || 0;
}

async function assertConcurrency(student: any) {
  const studentActive = await countActiveAvatarTasks(student.id);
  if (studentActive >= MAX_ACTIVE_TASKS_PER_STUDENT) {
    throw Object.assign(new Error("avatar_student_task_already_running"), {
      status: 429,
      extra: { activeTasks: studentActive, maxActiveTasks: MAX_ACTIVE_TASKS_PER_STUDENT },
    });
  }

  const globalActive = await countActiveAvatarTasks();
  if (globalActive >= MAX_ACTIVE_TASKS_GLOBAL) {
    throw Object.assign(new Error("avatar_system_busy"), {
      status: 429,
      extra: { activeTasks: globalActive, maxActiveTasks: MAX_ACTIVE_TASKS_GLOBAL },
    });
  }
}

async function startProviderTask(apiKey: string, videoValue: string, audioValue: string) {
  const runRes = await fetch(PROVIDER_RUN_URL, {
    method: "POST",
    headers: providerHeaders(apiKey),
    body: JSON.stringify({
      nodeInfoList: [
        {
          nodeId: "1",
          fieldName: "file",
          fieldValue: videoValue,
          description: "Upload video (face fully facing the camera)",
        },
        {
          nodeId: "4",
          fieldName: "audio",
          fieldValue: audioValue,
          description: "Upload voice (pure human voice)",
        },
      ],
      instanceType: "default",
      usePersonalQueue: "false",
    }),
  });
  const runData = await readJsonOrText(runRes);
  const taskId = extractTaskId(runData);
  if (!runRes.ok || !taskId) {
    const failureStatus = runRes.ok ? 502 : (runRes.status || 500);
    console.error("avatar_submit_failed", JSON.stringify(runData));
    return { error: providerSubmitError(runData, failureStatus) };
  }
  return { data: { ...runData, taskId } };
}

async function insertTask(student: any, runData: any, requestedSeconds: number, videoFile: string, audioFile: string) {
  const { error } = await supabaseAdmin.from("avatar_generation_tasks").insert({
    student_id: student.id,
    task_id: runData.taskId,
    status: runData.status || "RUNNING",
    requested_seconds: requestedSeconds,
    charged: false,
    video_file: videoFile,
    audio_file: audioFile,
    raw_response: runData,
  });
  if (error) throw new Error(error.message);
}

async function handleSubmitUrls(req: Request, body: any) {
  const apiKey = Deno.env.get(PROVIDER_SECRET_NAME) || "";
  if (!apiKey) return neutralError("avatar_service_not_configured", 500);

  const student = await getAuthorizedStudent(req);
  const requestedSeconds = normalizeSeconds(body.duration_seconds);
  assertQuota(student, requestedSeconds);
  await assertConcurrency(student);

  const videoUrl = assertUrl(body.video_url, "video_url");
  const audioUrl = assertUrl(body.audio_url, "audio_url");
  const videoProbe = await probeProviderInputUrl(videoUrl, "video_url", PROVIDER_MAX_VIDEO_BYTES);
  if (videoProbe.error) return videoProbe.error;
  const audioProbe = await probeProviderInputUrl(audioUrl, "audio_url");
  if (audioProbe.error) return audioProbe.error;

  const started = await startProviderTask(apiKey, videoUrl, audioUrl);
  if (started.error) return started.error;

  await insertTask(
    student,
    started.data,
    requestedSeconds,
    String(body.video_path || videoUrl),
    String(body.audio_path || audioUrl),
  );

  return jsonResponse({
    taskId: started.data.taskId,
    status: started.data.status || "RUNNING",
    student: publicStudent(student),
    requestedSeconds,
    requestedMinutes: Math.ceil(requestedSeconds / 6) / 10,
  });
}

async function chargeAvatarSeconds(student: any, task: any) {
  if (task.charged) return student;
  const usedSeconds = Math.max(1, Math.round(Number(task.requested_seconds || 0)));
  const currentSeconds = Math.max(0, Math.round(Number(student.avatar_seconds ?? DEFAULT_AVATAR_SECONDS)));
  const nextSeconds = Math.max(0, currentSeconds - usedSeconds);
  const nextMinutes = Math.round((nextSeconds / 60) * 10) / 10;
  const { data, error } = await supabaseAdmin
    .from("students")
    .update({ heygen_minutes: nextMinutes, avatar_seconds: nextSeconds })
    .eq("id", student.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await supabaseAdmin
    .from("avatar_generation_tasks")
    .update({ charged: true })
    .eq("task_id", task.task_id)
    .eq("student_id", student.id);

  return data;
}

async function importAvatarOutput(apiKey: string, student: any, taskId: string, result: any) {
  const sourceUrl = assertUrl(result?.url, "result_url");
  const outputType = String(result?.outputType || "mp4").replace(/[^a-z0-9]/gi, "").toLowerCase() || "mp4";
  const fileName = `chiwa-avatar-${new Date().toISOString().slice(0, 10)}.${outputType}`;
  const res = await fetch(`${AVATAR_WORKER_URL}/avatar/output/import`, {
    method: "POST",
    headers: internalWorkerHeaders(apiKey),
    body: JSON.stringify({
      sourceUrl,
      studentId: student.id,
      taskId,
      outputType,
      fileName,
      retentionDays: OUTPUT_RETENTION_DAYS,
    }),
  });
  const data = await readJsonOrText(res);
  if (!res.ok || !data?.key) {
    console.error("avatar_output_import_failed", JSON.stringify(data));
    throw new Error("avatar_output_import_failed");
  }
  return data;
}

async function signAvatarOutput(apiKey: string, task: any) {
  if (!task.result_file) return null;
  const ext = String(task.output_type || "mp4").replace(/[^a-z0-9]/gi, "").toLowerCase() || "mp4";
  const fileName = `chiwa-avatar-${new Date().toISOString().slice(0, 10)}.${ext}`;
  const res = await fetch(`${AVATAR_WORKER_URL}/avatar/output/sign`, {
    method: "POST",
    headers: internalWorkerHeaders(apiKey),
    body: JSON.stringify({ key: task.result_file, taskId: task.task_id, fileName }),
  });
  const data = await readJsonOrText(res);
  if (!res.ok || !data?.downloadUrl) {
    console.error("avatar_output_sign_failed", JSON.stringify(data));
    return null;
  }
  return data;
}

async function deleteAvatarOutput(apiKey: string, key: string) {
  if (!key) return;
  const secrets = [
    Deno.env.get("AVATAR_WORKER_INTERNAL_SECRET") || "",
    apiKey,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const uniqueSecrets = [...new Set(secrets)];
  let lastError: unknown = null;

  for (const secret of uniqueSecrets) {
    const res = await fetch(`${AVATAR_WORKER_URL}/avatar/output/delete`, {
      method: "POST",
      headers: internalWorkerHeaders(secret),
      body: JSON.stringify({ key }),
    });
    const data = await readJsonOrText(res);
    if (res.ok) return;
    lastError = data;
  }
  console.error("avatar_output_delete_failed", JSON.stringify(lastError || {}));
  throw new Error("avatar_output_delete_failed");
}

function taskTitle(task: any, index = 0) {
  const created = task.created_at ? new Date(task.created_at) : new Date();
  const stamp = Number.isFinite(created.getTime()) ? created.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  return `形象克隆影片 ${stamp}-${String(index + 1).padStart(2, "0")}`;
}

async function handleList(req: Request) {
  const apiKey = Deno.env.get(PROVIDER_SECRET_NAME) || "";
  if (!apiKey) return neutralError("avatar_service_not_configured", 500);

  const student = await getAuthorizedStudent(req);
  const { data: rows, error } = await supabaseAdmin
    .from("avatar_generation_tasks")
    .select("task_id,status,requested_seconds,charged,result_file,result_expires_at,output_type,created_at,updated_at")
    .eq("student_id", student.id)
    .neq("status", "DELETED")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);

  const now = Date.now();
  const items = [];
  for (const task of rows || []) {
    const expiresAt = task.result_expires_at || "";
    const isReady = task.status === "SUCCESS" && task.result_file && (!expiresAt || Date.parse(expiresAt) > now);
    const isExpired = task.status === "SUCCESS" && task.result_file && expiresAt && Date.parse(expiresAt) <= now;
    if (!isReady) continue;
    const links = isReady ? await signAvatarOutput(apiKey, task) : null;
    if (!links?.previewUrl && !links?.downloadUrl) continue;
    items.push({
      taskId: task.task_id,
      title: taskTitle(task, items.length),
      status: isExpired ? "EXPIRED" : task.status,
      requestedSeconds: task.requested_seconds,
      charged: task.charged,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      outputExpiresAt: expiresAt,
      requestedMinutes: Math.ceil(Number(task.requested_seconds || 0) / 6) / 10,
      previewUrl: links?.previewUrl || "",
      downloadUrl: links?.downloadUrl || "",
    });
  }

  return jsonResponse({ items, retentionDays: OUTPUT_RETENTION_DAYS, student: publicStudent(student) });
}

async function handleDelete(req: Request, body: any) {
  const apiKey = Deno.env.get(PROVIDER_SECRET_NAME) || "";
  if (!apiKey) return neutralError("avatar_service_not_configured", 500);

  const student = await getAuthorizedStudent(req);
  const taskId = String(body.taskId || body.task_id || "").trim();
  if (!taskId) return neutralError("missing_task_id", 400);

  const { data: task, error: taskError } = await supabaseAdmin
    .from("avatar_generation_tasks")
    .select("task_id,status,result_file")
    .eq("task_id", taskId)
    .eq("student_id", student.id)
    .maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task) return neutralError("task_not_found", 404);

  const status = String(task.status || "").toUpperCase();
  if (ACTIVE_AVATAR_STATUSES.includes(status)) {
    return neutralError("avatar_task_still_running", 409);
  }

  if (task.result_file) {
    try {
      await deleteAvatarOutput(apiKey, task.result_file);
    } catch (error) {
      console.warn("avatar_output_delete_deferred", error instanceof Error ? error.message : String(error));
    }
  }

  const { error: updateError } = await supabaseAdmin
    .from("avatar_generation_tasks")
    .update({
      status: "DELETED",
      result_file: null,
      result_url: null,
      result_expires_at: null,
      error_message: "",
    })
    .eq("task_id", taskId)
    .eq("student_id", student.id);
  if (updateError) throw new Error(updateError.message);

  return jsonResponse({ ok: true, taskId, student: publicStudent(student) });
}

async function handleQuery(req: Request, body: any) {
  const apiKey = Deno.env.get(PROVIDER_SECRET_NAME) || "";
  if (!apiKey) return neutralError("avatar_service_not_configured", 500);

  let student = await getAuthorizedStudent(req);
  const taskId = String(body.taskId || body.task_id || "").trim();
  if (!taskId) return neutralError("missing_task_id", 400);

  const { data: task, error: taskError } = await supabaseAdmin
    .from("avatar_generation_tasks")
    .select("*")
    .eq("task_id", taskId)
    .eq("student_id", student.id)
    .maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task) return neutralError("task_not_found", 404);

  const queryRes = await fetch(PROVIDER_QUERY_URL, {
    method: "POST",
    headers: providerHeaders(apiKey),
    body: JSON.stringify({ taskId }),
  });
  const queryData = await readJsonOrText(queryRes);
  if (!queryRes.ok) {
    console.error("avatar_query_failed", JSON.stringify(queryData));
    return neutralError("avatar_query_failed", queryRes.status || 500);
  }

  const firstResult = Array.isArray(queryData?.results) ? queryData.results[0] : null;
  const patch: Record<string, unknown> = {
    status: queryData?.status || task.status,
    raw_response: queryData || {},
    error_code: queryData?.errorCode || "",
    error_message: queryData?.errorMessage || "",
    usage: queryData?.usage || {},
  };

  let outputLinks: any = null;
  if (task.result_file && task.result_expires_at && Date.parse(task.result_expires_at) > Date.now()) {
    outputLinks = await signAvatarOutput(apiKey, task);
  }

  if (queryData?.status === "SUCCESS" && firstResult?.url && !outputLinks) {
    try {
      const imported = await importAvatarOutput(apiKey, student, taskId, firstResult);
      patch.result_url = firstResult.url;
      patch.result_file = imported.key;
      patch.result_expires_at = imported.expiresAt;
      patch.output_type = firstResult.outputType || "mp4";
      outputLinks = imported;
    } catch (error) {
      patch.status = "RUNNING";
      patch.error_message = error instanceof Error ? error.message : "avatar_output_import_failed";
    }
  } else if (firstResult?.url) {
    patch.result_url = firstResult.url;
    patch.output_type = firstResult.outputType || "";
  }

  const { data: updatedTask, error: updateError } = await supabaseAdmin
    .from("avatar_generation_tasks")
    .update(patch)
    .eq("task_id", taskId)
    .eq("student_id", student.id)
    .select("*")
    .single();
  if (updateError) throw new Error(updateError.message);

  if (updatedTask.status === "SUCCESS" && outputLinks && !updatedTask.charged) {
    student = await chargeAvatarSeconds(student, updatedTask);
  }

  return jsonResponse({
    taskId,
    status: outputLinks && updatedTask.status === "SUCCESS" ? "SUCCESS" : updatedTask.status,
    errorCode: updatedTask.status === "FAILED" ? "avatar_generation_failed" : "",
    errorMessage: updatedTask.status === "FAILED" ? "形象克隆生成失敗，請稍後再試。" : "",
    previewUrl: outputLinks?.previewUrl || "",
    downloadUrl: outputLinks?.downloadUrl || "",
    outputExpiresAt: outputLinks?.expiresAt || updatedTask.result_expires_at || "",
    requestedSeconds: updatedTask.requested_seconds,
    requestedMinutes: Math.ceil(Number(updatedTask.requested_seconds || 0) / 6) / 10,
    charged: updatedTask.charged || (updatedTask.status === "SUCCESS" && !!outputLinks),
    student: publicStudent(student),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return neutralError("method_not_allowed", 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").trim();
    if (action === "submit_urls") return await handleSubmitUrls(req, body);
    if (action === "query") return await handleQuery(req, body);
    if (action === "list") return await handleList(req);
    if (action === "delete") return await handleDelete(req, body);
    return neutralError("unknown_action", 400);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "unexpected_error";
    const status = (error as any)?.status || ([ "missing_session", "invalid_session" ].includes(message) ? 401 : 500);
    return jsonResponse({ error: message, ...((error as any)?.extra || {}) }, status);
  }
});
