// Receives one chunk of a large onboarding packet (base64 slice) and parks it
// in Netlify Blobs so onboarding-submit can reassemble and email it. Chunks
// contain PII, so they are transient: onboarding-submit deletes them after the
// email is sent (or on failure).

import { getStore } from "@netlify/blobs";

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const MAX_CHUNK = 3_800_000; // base64 chars; client sends ~3MB slices
const MAX_SEQ = 15;

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid json" });
  }
  if (body.website) return json(200, { ok: true }); // honeypot

  const id = String(body.id || "");
  const seq = Number(body.seq);
  const data = String(body.data || "");

  if (!/^[a-z0-9-]{10,64}$/.test(id)) return json(400, { error: "bad id" });
  if (!Number.isInteger(seq) || seq < 0 || seq > MAX_SEQ) return json(400, { error: "bad seq" });
  if (!data || data.length > MAX_CHUNK || !/^[A-Za-z0-9+/=]+$/.test(data)) {
    return json(400, { error: "bad chunk" });
  }

  try {
    const store = getStore("onboarding-uploads");
    await store.set(`${id}/${seq}`, data);
  } catch (err) {
    console.error("onboarding-upload:", err);
    return json(502, { error: "storage failed" });
  }

  return json(200, { ok: true });
};
