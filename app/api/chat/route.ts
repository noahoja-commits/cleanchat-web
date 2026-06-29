import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const HF_API_KEY = process.env.HF_API_KEY || "";
const HF_MODEL =
  process.env.HF_MODEL || "Orenguteng/Llama-3-8B-Lexi-Uncensored";

export async function POST(req: NextRequest) {
  if (!HF_API_KEY) {
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

  const prompt = messages
    .map((m: any) => {
      if (m.role === "system") return `<|system|>\n${m.content}\n`;
      if (m.role === "user") return `<|user|>\n${m.content}\n`;
      if (m.role === "assistant") return `<|assistant|>\n${m.content}\n`;
      return "";
    })
    .join("") + "<|assistant|>\n";

  const url = `https://api-inference.huggingface.co/models/${HF_MODEL}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": "CleanChat/1.0",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: { max_new_tokens: 2000, return_full_text: false },
      }),
      cache: "no-store",
    });

    if (response.status === 503) {
      return NextResponse.json(
        { error: "Model is loading. Try again in ~30 seconds." },
        { status: 503 }
      );
    }

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `HF API ${response.status}: ${text.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    const content = Array.isArray(data)
      ? data[0]?.generated_text || ""
      : data.generated_text || "";

    if (!content) {
      return NextResponse.json({
        reply: "(Model returned empty response.)",
      });
    }

    return NextResponse.json({ reply: content });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Cannot reach HuggingFace: ${err.message || "unknown error"}` },
      { status: 502 }
    );
  }
}
