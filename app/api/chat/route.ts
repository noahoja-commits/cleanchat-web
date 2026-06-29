import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const hfKey = process.env.HF_API_KEY || "";
  if (!hfKey) {
    return NextResponse.json({ error: "HF_API_KEY not configured." }, { status: 500 });
  }

  const model = process.env.HF_MODEL || "Orenguteng/Llama-3-8B-Lexi-Uncensored";

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

  // Build prompt for raw text generation
  const prompt = messages
    .map((m: any) => {
      if (m.role === "system") return `<|system|>\n${m.content}</s>\n`;
      if (m.role === "user") return `<|user|>\n${m.content}</s>\n`;
      if (m.role === "assistant") return `<|assistant|>\n${m.content}</s>\n`;
      return "";
    })
    .join("") + "<|assistant|>\n";

  try {
    // Try raw text generation endpoint with options
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
          parameters: {
            max_new_tokens: 2000,
            return_full_text: false,
            temperature: 0.7,
          },
          options: {
            wait_for_model: true,
            use_cache: true,
          },
        }),
      }
    );

    if (res.status === 503) {
      const waitTime = res.headers.get("x-estimated-time") || "30";
      return NextResponse.json(
        { error: `Model is loading. Estimated wait: ${waitTime} seconds. Try again.` },
        { status: 503 }
      );
    }

    const text = await res.text();

    if (!res.ok) {
      return NextResponse.json(
        { error: `HF API ${res.status}: ${text.slice(0, 300)}` },
        { status: 502 }
      );
    }

    // Parse the response — could be array or object
    let content = "";
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        content = data[0]?.generated_text || "";
      } else if (data.generated_text) {
        content = data.generated_text;
      } else if (data.error) {
        return NextResponse.json({ error: data.error }, { status: 502 });
      }
    } catch {
      content = text;
    }

    if (!content || !content.trim()) {
      return NextResponse.json({
        reply: "(The model returned an empty response. It may still be loading — try again.)",
      });
    }

    return NextResponse.json({ reply: content.trim() });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Network error: ${err.message}` },
      { status: 502 }
    );
  }
}
