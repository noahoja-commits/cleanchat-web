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

  // Use router.huggingface.co (api-inference subdomain blocked from Vercel)
  const url = `https://router.huggingface.co/featherless-ai/v1/chat/completions`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hfKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 2000,
      }),
    });

    const text = await res.text();

    if (!res.ok) {
      return NextResponse.json(
        { error: `HF API ${res.status}: ${text.slice(0, 300)}` },
        { status: 502 }
      );
    }

    let content = "";
    try {
      const data = JSON.parse(text);
      content = data.choices?.[0]?.message?.content || "";
    } catch {
      content = text;
    }

    if (!content) {
      return NextResponse.json({
        reply: "(The model returned an empty response. It may still be loading — try again.)",
      });
    }

    return NextResponse.json({ reply: content });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Network error: ${err.message}` },
      { status: 502 }
    );
  }
}
