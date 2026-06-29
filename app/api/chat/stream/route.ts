import { NextRequest, NextResponse } from "next/server";

// Rate limiting - simple in-memory counter
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 20;

function getRateLimitKey(req: NextRequest): string {
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

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

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

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const rateLimitKey = getRateLimitKey(req);
  const { allowed, remaining } = checkRateLimit(rateLimitKey);

  if (!allowed) {
    return new NextResponse(
      JSON.stringify({ error: "Too many requests. Please wait before trying again." }),
      { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "60" } }
    );
  }

  const hfKey = process.env.HF_API_KEY || "";
  if (!hfKey) {
    return new NextResponse(
      JSON.stringify({ error: "HF_API_KEY not configured." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let rawMessages: unknown;
  try {
    const body = await req.json();
    rawMessages = body.messages;
  } catch {
    return new NextResponse(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const validation = validateMessages(rawMessages);
  if (!validation.valid) {
    return new NextResponse(
      JSON.stringify({ error: validation.error }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const messages: Message[] = (rawMessages as Message[]).map(m => ({
    role: m.role,
    content: sanitizeString(m.content)
  }));

  const model = process.env.HF_MODEL || "meta-llama/Llama-3.1-8B-Instruct";

  // Stream via the HF Router (OpenAI-compatible). The legacy
  // api-inference.huggingface.co host is unreachable from Vercel, so we use the
  // same router endpoint the non-streaming /api/chat route relies on.
  try {
    const response = await fetch(
      "https://router.huggingface.co/featherless-ai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hfKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          stream: true,
          max_tokens: 2000,
        }),
      }
    );

    if (response.status === 503) {
      const est = response.headers.get("x-estimated-time");
      return new NextResponse(
        JSON.stringify({ error: `Model loading — ETA ${est || "~30"}s. Try again.` }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!response.ok) {
      const text = await response.text();
      let err = text.slice(0, 200);
      try { err = JSON.parse(text).error || err; } catch {}
      return new NextResponse(
        JSON.stringify({ error: `HF ${response.status}: ${err}` }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    // Handle streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        try {
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data: ")) continue;

              const data = trimmed.slice(6);
              if (data === "[DONE]") {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                continue;
              }

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content || 
                               parsed.choices?.[0]?.text || "";
                if (content) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-RateLimit-Remaining": String(remaining),
      },
    });
  } catch (err: any) {
    console.error("Streaming error:", err.message);
    
    // Fallback to non-streaming
    return new NextResponse(
      JSON.stringify({ error: `Connection failed. Please try again.`, fallback: true }),
      { status: 200, headers: { "Content-Type": "application/json", "X-Fallback": "true" } }
    );
  }
}
