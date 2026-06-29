import { NextRequest, NextResponse } from "next/server";

// Rate limiting - simple in-memory counter (use Redis in production)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 20; // requests per window

function getRateLimitKey(req: NextRequest): string {
  // Use IP address, fallback to a fingerprint
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
  return ip;
}

function checkRateLimit(key: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const record = rateLimitMap.get(key);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 };
  }

  record.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - record.count };
}

export const maxDuration = 60;

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

// Input validation constants
const MAX_MESSAGE_LENGTH = 8000;
const MAX_MESSAGES = 50;
const MAX_TOTAL_CHARS = 50000;
const SANITIZE_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function sanitizeString(str: string): string {
  return str.replace(SANITIZE_REGEX, "").slice(0, MAX_MESSAGE_LENGTH);
}

function validateMessages(messages: unknown): { valid: boolean; error?: string } {
  if (!Array.isArray(messages)) {
    return { valid: false, error: "Messages must be an array" };
  }

  if (messages.length === 0) {
    return { valid: false, error: "Messages array cannot be empty" };
  }

  if (messages.length > MAX_MESSAGES) {
    return { valid: false, error: `Too many messages (max ${MAX_MESSAGES})` };
  }

  let totalChars = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] as Record<string, unknown>;
    if (!m || typeof m !== "object") {
      return { valid: false, error: `Invalid message at index ${i}` };
    }

    if (!["system", "user", "assistant"].includes(m.role as string)) {
      return { valid: false, error: `Invalid role at index ${i}` };
    }

    if (typeof m.content !== "string") {
      return { valid: false, error: `Invalid content at index ${i}` };
    }

    totalChars += m.content.length;
    if (totalChars > MAX_TOTAL_CHARS) {
      return { valid: false, error: `Total content too long (max ${MAX_TOTAL_CHARS} chars)` };
    }
  }

  return { valid: true };
}

export async function POST(req: NextRequest) {
  // Rate limiting
  const rateLimitKey = getRateLimitKey(req);
  const { allowed, remaining } = checkRateLimit(rateLimitKey);
  
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please wait before trying again." },
      { status: 429, 
        headers: { 
          "Retry-After": "60",
          "X-RateLimit-Remaining": "0"
        }
      }
    );
  }

  const hfKey = process.env.HF_API_KEY || "";
  if (!hfKey) {
    return NextResponse.json(
      { error: "HF_API_KEY not configured." },
      { status: 500 }
    );
  }

  let rawMessages: unknown;
  try {
    const body = await req.json();
    rawMessages = body.messages;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // Validate message structure
  const validation = validateMessages(rawMessages);
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.error },
      { status: 400 }
    );
  }

  // Sanitize and type messages
  const messages: Message[] = (rawMessages as Message[]).map(m => ({
    role: m.role,
    content: sanitizeString(m.content)
  }));

  const model = process.env.HF_MODEL || "meta-llama/Llama-3.1-8B-Instruct";

  // Build prompt from messages
  let prompt = "";
  for (const m of messages) {
    if (m.role === "system") prompt += "<|system|>\n" + m.content + "\n";
    else if (m.role === "user") prompt += "<|user|>\n" + m.content + "\n";
    else if (m.role === "assistant") prompt += "<|assistant|>\n" + m.content + "\n";
  }
  prompt += "<|assistant|>\n";

  // Try multiple endpoint strategies
  const endpoints = [
    // 1. Direct text generation (Inference API)
    async () => {
      const res = await fetch(
        `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${hfKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            inputs: prompt,
            parameters: { max_new_tokens: 2000, return_full_text: false },
            options: { wait_for_model: true, use_cache: true },
          }),
        }
      );
      const text = await res.text();

      if (res.status === 503) {
        const est = res.headers.get("x-estimated-time");
        throw new Error(`Model loading — ETA ${est || "~30"}s. Try again.`);
      }

      if (!res.ok) {
        let err = text.slice(0, 200);
        try { err = JSON.parse(text).error || err; } catch {}
        throw new Error(`HF Inference ${res.status}: ${err}`);
      }

      const data = JSON.parse(text);
      const content = Array.isArray(data) ? data[0]?.generated_text : data.generated_text;
      if (!content) throw new Error("Empty response from model");
      return content.trim();
    },

    // 2. Chat completions via HF Router
    async () => {
      const chatMessages = messages.map(m => ({
        role: m.role,
        content: m.content,
      }));
      
      const res = await fetch(
        "https://router.huggingface.co/featherless-ai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${hfKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ 
            model: model,
            messages: chatMessages, 
            max_tokens: 2000 
          }),
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HF Router ${res.status}: ${text.slice(0, 100)}`);
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty response from router");
      return content;
    },
  ];

  let lastError: Error | null = null;
  
  for (let i = 0; i < endpoints.length; i++) {
    try {
      const reply = await endpoints[i]();
      return NextResponse.json(
        { reply },
        { headers: { "X-RateLimit-Remaining": String(remaining) } }
      );
    } catch (err: any) {
      lastError = err;
      const msg = err.message || "";
      const isRecoverable = 
        msg.includes("Model loading") || 
        msg.includes("loading") ||
        msg.includes("503") ||
        msg.includes("rate limit") ||
        msg.includes("timeout") ||
        msg.includes("network") ||
        msg.includes("ECONNREFUSED") ||
        msg.includes("Empty response");
      
      if (!isRecoverable || i === endpoints.length - 1) {
        console.error(`API endpoint ${i + 1} failed:`, err.message);
        break;
      }
    }
  }

  const errorMsg = lastError?.message || "All endpoints failed";
  return NextResponse.json(
    { error: errorMsg },
    { status: 502, headers: { "X-RateLimit-Remaining": String(remaining) } }
  );
}
