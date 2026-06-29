import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60; // Vercel Pro: 60s timeout for cold HF model starts

const HF_API_KEY = process.env.HF_API_KEY || "";
const HF_MODEL =
  process.env.HF_MODEL || "Orenguteng/Llama-3-8B-Lexi-Uncensored";

export async function POST(req: NextRequest) {
  if (!HF_API_KEY) {
    return NextResponse.json(
      { error: "HF_API_KEY not configured. Set it in Vercel environment variables." },
      { status: 500 }
    );
  }

  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "Missing messages array" }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000); // 55s fetch timeout

    const response = await fetch(
      `https://api-inference.huggingface.co/models/${HF_MODEL}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: HF_MODEL,
          messages,
          max_tokens: 2000,
          stream: false,
        }),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      const hint =
        response.status === 503
          ? " (Model is loading — try again in 20-30 seconds)"
          : "";
      return NextResponse.json(
        { error: `HF API error ${response.status}: ${text.slice(0, 200)}${hint}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json({
        reply:
          "(The model returned no content — this may be a content filter or model limitation.)",
      });
    }

    return NextResponse.json({ reply: content });
  } catch (err: any) {
    const msg =
      err.name === "AbortError"
        ? "Request timed out — the model may be cold-starting. Try again."
        : `Request failed: ${err.message}`;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
