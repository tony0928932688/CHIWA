import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

const VOICE_CREDITS = 10000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function cleanText(value: unknown, max = 1200) {
  return String(value || "").slice(0, max).trim();
}

function languageCode(value: unknown) {
  const v = String(value || "zh").toLowerCase();
  if (["zh", "en", "ja", "ko"].includes(v)) return v;
  return "zh";
}

function round1(value: number) {
  return Math.max(0, Math.round(value * 10) / 10);
}

function estimateVoiceCredits(text: string) {
  const len = Array.from(String(text || "").replace(/\s+/g, "")).length;
  return Math.max(1, len);
}

function estimateSeconds(text: string) {
  const len = Array.from(text || "").length;
  return Math.max(1, Math.min(180, Math.ceil(len / 4.2)));
}

function wavDurationSeconds(buffer: ArrayBuffer) {
  try {
    const view = new DataView(buffer);
    let sampleRate = 0;
    let channels = 0;
    let bitsPerSample = 0;
    let dataSize = 0;
    for (let offset = 12; offset + 8 <= view.byteLength;) {
      const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
      const size = view.getUint32(offset + 4, true);
      if (id === "fmt ") {
        channels = view.getUint16(offset + 10, true);
        sampleRate = view.getUint32(offset + 12, true);
        bitsPerSample = view.getUint16(offset + 22, true);
      }
      if (id === "data") dataSize = size;
      offset += 8 + size + (size % 2);
    }
    if (sampleRate && channels && bitsPerSample && dataSize) {
      return Math.max(1, Math.ceil(dataSize / (sampleRate * channels * (bitsPerSample / 8))));
    }
  } catch (_) {}
  return 0;
}

function safeError(value: unknown) {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("quota") || raw.includes("credits") || raw.includes("seconds") || raw.includes("minutes") || raw.includes("insufficient")) return "insufficient_voice_credits";
  if (raw.includes("voice")) return "voice_unavailable";
  return "voice_service_error";
}

function authToken(req: Request) {
  const header = req.headers.get("authorization") || "";
  return header.replace(/^Bearer\s+/i, "").trim();
}

function publicStudent(row: any) {
  const voiceCredits = row.voice_credits ?? VOICE_CREDITS;
  const voiceMinutes = row.voice_minutes ?? round1(Number(voiceCredits) / 150);
  const avatarSeconds = row.avatar_seconds === null || row.avatar_seconds === undefined ? Math.round(Number(row.heygen_minutes ?? 30) * 60) : Math.max(0, Math.round(Number(row.avatar_seconds)));
  const heygenMinutes = round1(avatarSeconds / 60);
  return {
    id: row.id,
    email: row.email,
    google_email: row.google_email,
    name: row.name,
    ai_usage: row.ai_usage,
    voice_credits: Math.max(0, Math.round(Number(voiceCredits))),
    voice_minutes: voiceMinutes,
    heygen_minutes: heygenMinutes,
    voice_seconds: Math.round(voiceMinutes * 60),
    avatar_seconds: avatarSeconds,
    quota_started_at: row.quota_started_at,
    quota_reset_at: row.quota_reset_at,
    status: row.status,
    is_admin: !!row.is_admin,
  };
}

async function getStudent(supabase: ReturnType<typeof createClient>, token: string) {
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData?.user) throw new Error("unauthorized");
  const email = String(userData.user.email || "").trim().toLowerCase();
  let query = supabase.from("students").select("*").limit(1);
  if (email) query = query.or(`google_email.eq.${email},email.eq.${email},id.eq.${email}`);
  else query = query.eq("id", userData.user.id);
  const { data, error: rowError } = await query.maybeSingle();
  if (rowError || !data) throw new Error("student_not_found");
  return data;
}

async function proxyLegacy(req: Request, token: string, body?: BodyInit) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/cartesia-voice`;
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  if (req.headers.get("content-type")?.includes("application/json")) headers.set("Content-Type", "application/json");
  const res = await fetch(url, { method: "POST", headers, body });
  const contentType = res.headers.get("content-type") || "application/json";
  return new Response(await res.arrayBuffer(), {
    status: res.status,
    headers: { ...corsHeaders, "Content-Type": contentType },
  });
}

async function resolveVoiceId(supabase: ReturnType<typeof createClient>, studentId: string, publicVoiceId: string) {
  const id = cleanText(publicVoiceId, 120) || "def-female";
  const { data: preset } = await supabase
    .from("system_voice_presets")
    .select("id,name,cartesia_voice_id,enabled")
    .eq("id", id)
    .eq("enabled", true)
    .maybeSingle();
  if (preset?.cartesia_voice_id) return { providerVoiceId: preset.cartesia_voice_id, voiceName: preset.name || "系統預置聲音", modelUuid: null };

  const { data: model } = await supabase
    .from("voice_models")
    .select("id,name,cartesia_voice_id")
    .eq("id", id)
    .eq("student_id", studentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (model?.cartesia_voice_id) return { providerVoiceId: model.cartesia_voice_id, voiceName: model.name || "我的克隆聲音", modelUuid: model.id };

  const { data: modelByProvider } = await supabase
    .from("voice_models")
    .select("id,name,cartesia_voice_id")
    .eq("cartesia_voice_id", id)
    .eq("student_id", studentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (modelByProvider?.cartesia_voice_id) return { providerVoiceId: modelByProvider.cartesia_voice_id, voiceName: modelByProvider.name || "我的克隆聲音", modelUuid: modelByProvider.id };
  throw new Error("voice_unavailable");
}

function formatItem(row: any, playUrl = "") {
  const text = row.transcript || "";
  return {
    id: row.id,
    text,
    voiceName: row.voice_name || "發音人",
    language: row.language || "zh",
    audioSeconds: row.audio_seconds || 0,
    voiceCredits: estimateVoiceCredits(text),
    createdAt: row.created_at,
    downloadedAt: row.downloaded_at,
    playUrl,
  };
}

async function signItem(supabase: ReturnType<typeof createClient>, row: any) {
  let playUrl = "";
  if (row.storage_path) {
    const { data } = await supabase.storage.from("voice-outputs").createSignedUrl(row.storage_path, 3600);
    playUrl = data?.signedUrl || "";
  }
  return formatItem(row, playUrl);
}

async function debitVoiceCredits(supabase: ReturnType<typeof createClient>, student: any, credits: number) {
  const current = Math.max(0, Math.round(Number(student.voice_credits ?? VOICE_CREDITS)));
  if (current < credits) {
    throw Object.assign(new Error("insufficient_voice_credits"), { status: 402 });
  }
  const next = Math.max(0, current - credits);
  const { data, error } = await supabase
    .from("students")
    .update({
      voice_credits: next,
      voice_minutes: round1(next / 150),
      voice_seconds: Math.round((next / 150) * 60),
    })
    .eq("id", student.id)
    .select("*")
    .single();
  if (error) throw new Error("quota_update_error");
  return data;
}

async function handleTts(supabase: ReturnType<typeof createClient>, student: any, payload: any) {
  const text = cleanText(payload.text, 10000);
  if (!text) return json({ error: "missing_text" }, 400);
  const credits = estimateVoiceCredits(text);
  const remaining = Math.max(0, Math.round(Number(student.voice_credits ?? VOICE_CREDITS)));
  if (remaining < credits) return json({ error: "insufficient_voice_credits" }, 402);

  const lang = languageCode(payload.language);
  const { providerVoiceId, voiceName, modelUuid } = await resolveVoiceId(supabase, student.id, payload.voice_id);
  const apiKey = Deno.env.get("CARTESIA_API_KEY") || Deno.env.get("VOICE_API_KEY") || "";
  if (!apiKey) return json({ error: "voice_service_unconfigured" }, 500);

  const upstream = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "X-API-Key": apiKey,
      "Cartesia-Version": "2026-03-01",
    },
    body: JSON.stringify({
      model_id: "sonic-3.5",
      transcript: text,
      language: lang,
      voice: { mode: "id", id: providerVoiceId },
      output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 },
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    console.error("voice upstream error", upstream.status, detail.slice(0, 600));
    return json({ error: safeError(detail) }, 502);
  }

  const audio = await upstream.arrayBuffer();
  const seconds = wavDurationSeconds(audio) || estimateSeconds(text);
  const id = crypto.randomUUID();
  const storagePath = `${student.id}/${id}.wav`;
  const { error: uploadError } = await supabase.storage.from("voice-outputs").upload(storagePath, audio, { contentType: "audio/wav", upsert: false });
  if (uploadError) {
    console.error("voice upload error", uploadError.message);
    return json({ error: "voice_storage_error" }, 500);
  }

  let studentNext = student;
  try {
    studentNext = await debitVoiceCredits(supabase, student, credits);
  } catch (error) {
    await supabase.storage.from("voice-outputs").remove([storagePath]);
    throw error;
  }

  const { data: row, error: insertError } = await supabase
    .from("voice_generations")
    .insert({
      id,
      student_id: student.id,
      voice_model_id: modelUuid,
      voice_id: cleanText(payload.voice_id, 120),
      voice_name: voiceName,
      transcript: text,
      transcript_length: Array.from(text).length,
      audio_seconds: seconds,
      language: lang,
      storage_path: storagePath,
      status: "ready",
    })
    .select("*")
    .single();
  if (insertError) {
    console.error("voice insert error", insertError.message);
    return json({ error: "voice_record_error" }, 500);
  }

  console.log("voice_credits_saved", JSON.stringify({ studentId: student.id, credits, admin: !!student.is_admin }));
  return json({ item: await signItem(supabase, row), deductedCredits: credits, student: publicStudent(studentNext) });
}

async function listTts(supabase: ReturnType<typeof createClient>, student: any) {
  const { data, error } = await supabase
    .from("voice_generations")
    .select("*")
    .eq("student_id", student.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return json({ error: "voice_list_error" }, 500);
  const items = [];
  for (const row of data || []) items.push(await signItem(supabase, row));
  return json({ items, student: publicStudent(student) });
}

async function deleteTts(supabase: ReturnType<typeof createClient>, student: any, payload: any) {
  const id = cleanText(payload.generation_id, 80);
  if (!id) return json({ error: "missing_generation" }, 400);
  const { data: row } = await supabase
    .from("voice_generations")
    .select("storage_path")
    .eq("id", id)
    .eq("student_id", student.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) return json({ ok: true });
  await supabase.from("voice_generations").update({ deleted_at: new Date().toISOString() }).eq("id", id).eq("student_id", student.id);
  if (row.storage_path) await supabase.storage.from("voice-outputs").remove([row.storage_path]);
  return json({ ok: true });
}

async function downloadTts(supabase: ReturnType<typeof createClient>, student: any, payload: any) {
  const id = cleanText(payload.generation_id, 80);
  if (!id) return json({ error: "missing_generation" }, 400);
  const { data: row, error } = await supabase
    .from("voice_generations")
    .select("*")
    .eq("id", id)
    .eq("student_id", student.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !row?.storage_path) return json({ error: "voice_file_not_found" }, 404);
  if (!row.downloaded_at) {
    await supabase.from("voice_generations").update({ downloaded_at: new Date().toISOString() }).eq("id", id).eq("student_id", student.id);
  }
  const { data } = await supabase.storage.from("voice-outputs").createSignedUrl(row.storage_path, 300);
  return json({
    downloadUrl: data?.signedUrl || "",
    fileName: `chiwa-voice-${new Date().toISOString().slice(0, 10)}.wav`,
    deductedCredits: 0,
    student: publicStudent(student),
    item: await signItem(supabase, { ...row, downloaded_at: row.downloaded_at || new Date().toISOString() }),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const token = authToken(req);
  if (!token) return json({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json({ error: "service_unconfigured" }, 500);
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) return proxyLegacy(req, token, await req.formData());

    const payload = await req.json().catch(() => ({}));
    const action = cleanText(payload.action, 40);
    if (["list", "delete"].includes(action)) return proxyLegacy(req, token, JSON.stringify(payload));

    const student = await getStudent(supabase, token);
    if (action === "tts") return handleTts(supabase, student, payload);
    if (action === "list_tts") return listTts(supabase, student);
    if (action === "delete_tts") return deleteTts(supabase, student, payload);
    if (action === "download_tts") return downloadTts(supabase, student, payload);
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    const message = (e as any)?.message || e;
    console.error("chiwa voice error", message);
    return json({ error: safeError(message) }, /unauthorized/.test(String(message)) ? 401 : ((e as any)?.status || 500));
  }
});
