const DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_PART_SIZE = 10 * 1024 * 1024;
const MAX_PART_BYTES = 90 * 1024 * 1024;
const CLEANUP_AGE_MS = 2 * 24 * 60 * 60 * 1000;

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGIN || "https://chiwaai.com").split(",").map((x) => x.trim());
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, x-chiwa-upload",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(req, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req, env),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function cleanFileName(name) {
  return String(name || "avatar-file")
    .replace(/[\\/#?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "avatar-file";
}

function fileExt(name, fallback) {
  const match = cleanFileName(name).match(/\.([a-z0-9]+)$/i);
  return (match ? match[1].toLowerCase() : fallback).replace(/[^a-z0-9]/g, "") || fallback;
}

function inferContentType(name, kind, provided) {
  const declared = String(provided || "").trim();
  if (declared && declared !== "application/octet-stream") return declared;
  const ext = fileExt(name, kind === "video" ? "mp4" : "wav");
  const map = {
    mp4: "video/mp4",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    aac: "audio/aac",
    ogg: "audio/ogg"
  };
  return map[ext] || (kind === "video" ? "video/mp4" : "audio/wav");
}

async function verifyUser(req, env) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw Object.assign(new Error("missing_authorization"), { status: 401 });

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "apikey": env.SUPABASE_ANON_KEY
    }
  });
  if (!res.ok) throw Object.assign(new Error("invalid_session"), { status: 401 });
  const user = await res.json();
  if (!user || !user.id) throw Object.assign(new Error("invalid_user"), { status: 401 });
  return user;
}

function assertUserKey(key, userId) {
  if (!key || !key.startsWith(`avatar-inputs/${userId}/`)) {
    throw Object.assign(new Error("invalid_upload_key"), { status: 403 });
  }
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signedObjectUrl(env, key) {
  const ttl = Math.max(60, Number(env.DOWNLOAD_TTL_SECONDS || 86400));
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const secret = env.URL_SIGNING_SECRET;
  if (!secret) throw Object.assign(new Error("url_signing_secret_missing"), { status: 500 });
  const sig = await hmacHex(secret, `${key}:${exp}`);
  const base = String(env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return `${base}/avatar/object/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;
}

async function verifyObjectSignature(env, key, exp, sig) {
  const now = Math.floor(Date.now() / 1000);
  const expires = Number(exp || 0);
  if (!expires || expires < now) return false;
  const expected = await hmacHex(env.URL_SIGNING_SECRET || "", `${key}:${expires}`);
  return expected === String(sig || "");
}

async function handleCreate(req, env) {
  const user = await verifyUser(req, env);
  const body = await req.json().catch(() => ({}));
  const kind = body.kind === "audio" ? "audio" : "video";
  const size = Number(body.size || 0);
  const maxBytes = Number(env.MAX_UPLOAD_BYTES || DEFAULT_MAX_UPLOAD_BYTES);
  if (!Number.isFinite(size) || size <= 0) throw Object.assign(new Error("invalid_file_size"), { status: 400 });
  if (size > maxBytes) throw Object.assign(new Error("file_exceeds_system_limit"), { status: 413 });

  const ext = fileExt(body.fileName, kind === "video" ? "mp4" : "wav");
  const key = `avatar-inputs/${user.id}/${Date.now()}-${kind}-${crypto.randomUUID()}.${ext}`;
  const contentType = inferContentType(body.fileName, kind, body.contentType);
  const upload = await env.AVATAR_INPUTS.createMultipartUpload(key, {
    httpMetadata: { contentType },
    customMetadata: {
      userId: user.id,
      email: String(user.email || ""),
      kind,
      originalName: cleanFileName(body.fileName),
      size: String(size)
    }
  });

  return json(req, env, {
    key,
    uploadId: upload.uploadId,
    partSize: DEFAULT_PART_SIZE,
    maxPartBytes: MAX_PART_BYTES,
    maxUploadBytes: maxBytes
  });
}

async function handleUploadPart(req, env, url) {
  const user = await verifyUser(req, env);
  const key = url.searchParams.get("key") || "";
  const uploadId = url.searchParams.get("uploadId") || "";
  const partNumber = Number(url.searchParams.get("partNumber") || 0);
  assertUserKey(key, user.id);
  if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1) {
    throw Object.assign(new Error("invalid_part_request"), { status: 400 });
  }
  const contentLength = Number(req.headers.get("Content-Length") || 0);
  if (contentLength > MAX_PART_BYTES) throw Object.assign(new Error("part_too_large"), { status: 413 });
  if (!req.body) throw Object.assign(new Error("missing_part_body"), { status: 400 });

  const upload = env.AVATAR_INPUTS.resumeMultipartUpload(key, uploadId);
  const part = await upload.uploadPart(partNumber, req.body);
  return json(req, env, part);
}

async function handleComplete(req, env) {
  const user = await verifyUser(req, env);
  const body = await req.json().catch(() => ({}));
  const key = String(body.key || "");
  const uploadId = String(body.uploadId || "");
  assertUserKey(key, user.id);
  if (!uploadId || !Array.isArray(body.parts) || body.parts.length === 0) {
    throw Object.assign(new Error("invalid_complete_request"), { status: 400 });
  }
  const parts = body.parts
    .map((part) => ({ partNumber: Number(part.partNumber), etag: String(part.etag || "") }))
    .filter((part) => Number.isInteger(part.partNumber) && part.partNumber > 0 && part.etag)
    .sort((a, b) => a.partNumber - b.partNumber);
  if (parts.length !== body.parts.length) throw Object.assign(new Error("invalid_parts"), { status: 400 });

  const upload = env.AVATAR_INPUTS.resumeMultipartUpload(key, uploadId);
  const object = await upload.complete(parts);
  const signedUrl = await signedObjectUrl(env, key);
  return json(req, env, {
    key,
    signedUrl,
    size: object.size,
    etag: object.etag,
    uploaded: object.uploaded
  });
}

async function handleAbort(req, env) {
  const user = await verifyUser(req, env);
  const body = await req.json().catch(() => ({}));
  const key = String(body.key || "");
  const uploadId = String(body.uploadId || "");
  assertUserKey(key, user.id);
  if (!uploadId) throw Object.assign(new Error("missing_upload_id"), { status: 400 });
  await env.AVATAR_INPUTS.resumeMultipartUpload(key, uploadId).abort();
  return json(req, env, { ok: true });
}

async function handleObject(req, env, url) {
  const prefix = "/avatar/object/";
  const key = decodeURIComponent(url.pathname.slice(prefix.length));
  const ok = await verifyObjectSignature(env, key, url.searchParams.get("exp"), url.searchParams.get("sig"));
  if (!ok) return new Response("Forbidden", { status: 403, headers: corsHeaders(req, env) });
  const object = await env.AVATAR_INPUTS.get(key);
  if (!object) return new Response("Not Found", { status: 404, headers: corsHeaders(req, env) });
  const headers = new Headers(corsHeaders(req, env));
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=300");
  if (req.method === "HEAD") return new Response(null, { headers });
  return new Response(object.body, { headers });
}

async function cleanupOldInputs(env) {
  const cutoff = Date.now() - CLEANUP_AGE_MS;
  let cursor;
  do {
    const listed = await env.AVATAR_INPUTS.list({
      prefix: "avatar-inputs/",
      cursor,
      limit: 1000
    });
    const expired = listed.objects
      .filter((object) => object.uploaded && object.uploaded.getTime() < cutoff)
      .map((object) => object.key);
    if (expired.length) await env.AVATAR_INPUTS.delete(expired);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    const url = new URL(req.url);
    try {
      if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/avatar/object/")) {
        return await handleObject(req, env, url);
      }
      if (req.method === "POST" && url.pathname === "/avatar/multipart/create") return await handleCreate(req, env);
      if (req.method === "PUT" && url.pathname === "/avatar/multipart/part") return await handleUploadPart(req, env, url);
      if (req.method === "POST" && url.pathname === "/avatar/multipart/complete") return await handleComplete(req, env);
      if (req.method === "DELETE" && url.pathname === "/avatar/multipart/abort") return await handleAbort(req, env);
      return json(req, env, { error: "not_found" }, 404);
    } catch (error) {
      const status = error && error.status ? error.status : 500;
      console.error(JSON.stringify({ status, error: String(error && error.message || error) }));
      return json(req, env, { error: String(error && error.message || error || "unexpected_error") }, status);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupOldInputs(env));
  }
};
