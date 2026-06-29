import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const hfKey = process.env.HF_API_KEY || "";
  if (!hfKey) {
    return NextResponse.json({ error: "HF_API_KEY not configured." }, { status: 500 });
  }

  let messages: any[];
  try {
    const body = await req.json();
    messages = body.messages;
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "Missing messages array" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const model = process.env.HF_MODEL || "Orenguteng/Llama-3-8B-Lexi-Uncensored";

  // Build prompt from messages
  let prompt = "";
  for (const m of messages) {
    if (m.role === "system") prompt += "<|system|>\n" + m.content + "\n";
    else if (m.role === "user") prompt += "<|user|>\n" + m.content + "\n";
    else if (m.role === "assistant") prompt += "<|assistant|>\n" + m.content + "\n";
  }
  prompt += "<|assistant|>\n";

  // Try multiple endpoint strategies
  const attempts = [
    // 1. Direct text generation (most compatible)
    async () => {
      const res = await fetch(
        `https://api-inference.huggingface.co/models/${model}`,
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
        throw new Error(`HF ${res.status}: ${err}`);
      }

      const data = JSON.parse(text);
      const content = Array.isArray(data) ? data[0]?.generated_text : data.generated_text;
      if (!content) throw new Error("Empty response from model");
      return content.trim();
    },

    // 2. Chat completions via router
    async () => {
      const res = await fetch(
        `https://router.huggingface.co/featherless-ai/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${hfKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model, messages, max_tokens: 2000 }),
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Router ${res.status}: ${text.slice(0, 100)}`);
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty response from router");
      return content;
    },
  ];

  for (const attempt of attempts) {
    try {
      const reply = await attempt();
      return NextResponse.json({ reply });
    } catch (err: any) {
      // Only continue to next attempt if this was a network/loading error
      const msg = err.message || "";
      if (!msg.includes("HF") && !msg.includes("loading") && !msg.includes("Router") && !msg.includes("Empty")) {
        continue;
      }
      // Return the error if it's the last attempt
      if (attempt === attempts[attempts.length - 1]) {
        return NextResponse.json({ error: msg }, { status: 502 });
      }
    }
  }

  return NextResponse.json({ error: "All endpoints failed" }, { status: 502 });
}
