const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders }
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGIN || "https://bladesbeats.com").split(",").map((item) => item.trim());
  return allowed.includes(origin) ? origin : "";
}

function corsHeaders(request, env) {
  const origin = allowedOrigin(request, env);
  if (!origin) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "Origin"
  };
}

function cleanLine(value, maxLength = 1200) {
  return String(value || "").replace(/\r/g, "").trim().slice(0, maxLength);
}

function normalizePayload(body) {
  const fields = Array.isArray(body.fields) ? body.fields.map((line) => cleanLine(line)).filter(Boolean) : [];
  return {
    turnstileToken: cleanLine(body.turnstileToken, 4096),
    subject: cleanLine(body.subject, 160) || "BladesBeats contact",
    type: cleanLine(body.type, 120),
    page: cleanLine(body.page, 500),
    fields
  };
}

const SQLI_HIGH_CONFIDENCE_PATTERNS = [
  /(?:^|[\s"'`])or\s+1\s*=\s*1(?:[\s"'`]|$)/i,
  /(?:^|[\s"'`])and\s+1\s*=\s*1(?:[\s"'`]|$)/i,
  /union\s+(?:all\s+)?select/i,
  /(?:drop|alter|truncate)\s+table/i,
  /(?:insert\s+into|delete\s+from|update\s+\w+\s+set)/i,
  /information_schema|pg_sleep|sleep\s*\(|benchmark\s*\(|xp_cmdshell/i,
  /(?:or\s+1\s*=\s*1|and\s+1\s*=\s*1|union\s+(?:all\s+)?select).*(?:--|#|\/\*)/is,
  /;\s*(?:drop|alter|truncate|insert|delete|update|select)\b/i
];

function requestIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "";
}

async function blockKey(ip, env) {
  const salt = env.BLOCKLIST_SALT || env.TURNSTILE_SECRET_KEY || "bladesbeats-contact-blocklist";
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `blocked:${hash}`;
}

async function isBlocked(ip, env) {
  if (!ip || !env.CONTACT_BLOCKLIST) return false;
  return Boolean(await env.CONTACT_BLOCKLIST.get(await blockKey(ip, env)));
}

async function blockIp(ip, env, reason) {
  if (!ip || !env.CONTACT_BLOCKLIST) return;
  await env.CONTACT_BLOCKLIST.put(await blockKey(ip, env), reason || "blocked", { expirationTtl: 3600 });
}

function looksLikeSqlInjection(payload) {
  const haystack = [
    payload.subject,
    payload.type,
    payload.page,
    ...payload.fields
  ].join("\n");
  return SQLI_HIGH_CONFIDENCE_PATTERNS.some((pattern) => pattern.test(haystack));
}

async function verifyTurnstile(token, request, env) {
  if (!env.TURNSTILE_SECRET_KEY) {
    console.warn("Contact form failed: missing_turnstile_secret");
    return false;
  }
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET_KEY);
  form.append("response", token);
  form.append("remoteip", request.headers.get("CF-Connecting-IP") || "");

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form
  });
  const result = await response.json().catch(() => ({}));
  if (!result.success) {
    console.warn("Contact form failed: turnstile_rejected", {
      status: response.status,
      errors: result["error-codes"] || []
    });
  }
  return Boolean(result.success);
}

async function sendEmail(payload, env) {
  const missing = ["RESEND_API_KEY", "CONTACT_TO", "RESEND_FROM"].filter((key) => !env[key]);
  if (missing.length) {
    console.warn("Contact form failed: missing_email_env", { missing });
    return false;
  }
  const text = [
    payload.fields.join("\n"),
    "",
    payload.page ? `Page: ${payload.page}` : ""
  ].filter(Boolean).join("\n");

  const replyToLine = payload.fields.find((line) => /^email:/i.test(line));
  const replyTo = replyToLine ? replyToLine.replace(/^email:\s*/i, "").trim() : "";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: env.RESEND_FROM,
      to: [env.CONTACT_TO],
      reply_to: replyTo || undefined,
      subject: payload.subject,
      text
    })
  });

  const responseText = await response.text().catch(() => "");
  if (!response.ok) {
    console.warn("Contact form failed: email_provider_rejected", {
      status: response.status,
      body: responseText.slice(0, 800)
    });
    return false;
  }

  console.info("Contact form sent", {
    status: response.status,
    type: payload.type || "unknown"
  });
  return true;
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request, env);
    if (!headers) {
      return json({ ok: false, error: "origin_not_allowed" }, 403, { "vary": "Origin" });
    }
    const ip = requestIp(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405, headers);
    }

    if (await isBlocked(ip, env)) {
      return json({ ok: false, error: "temporarily_blocked" }, 429, headers);
    }

    let payload;
    try {
      payload = normalizePayload(await request.json());
    } catch (error) {
      return json({ ok: false, error: "bad_request" }, 400, headers);
    }

    if (!payload.turnstileToken || payload.fields.length < 3) {
      return json({ ok: false, error: "missing_fields" }, 400, headers);
    }

    if (looksLikeSqlInjection(payload)) {
      await blockIp(ip, env, "sql_injection");
      return json({ ok: false, error: "request_blocked" }, 403, headers);
    }

    const verified = await verifyTurnstile(payload.turnstileToken, request, env);
    if (!verified) {
      return json({ ok: false, error: "verification_failed" }, 403, headers);
    }

    const sent = await sendEmail(payload, env);
    if (!sent) {
      return json({ ok: false, error: "send_failed" }, 502, headers);
    }

    return json({ ok: true }, 200, headers);
  }
};
