import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

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

    const url = `https://api-inference.huggingface.co/models/${HF_MODEL}/v1/chat/completions`;
    console.log("Calling HF API:", url);

    const response = await fetch(url, {
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
    });

    console.log("HF response status:", response.status);

    if (!response.ok) {
      const text = await response.text();
      console.log("HF error body:", text.slice(0, 300));
      return NextResponse.json(
        { error: `HF API error ${response.status}: ${text.slice(0, 200)}` },
        { status: 500 }
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
    console.error("Fetch error:", err.message, err.cause);
    return NextResponse.json(
      { error: `Request failed: ${err.message}${err.cause ? " — " + err.cause : ""}` },
      { status: 500 }
    );
  }
}
