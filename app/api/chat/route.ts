import { NextRequest, NextResponse } from "next/server";
import { HfInference } from "@huggingface/inference";

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

  // Try router endpoint first (api-inference subdomain is blocked on some networks)
  const endpoints = [
    "https://router.huggingface.co",
    "https://api-inference.huggingface.co",
  ];

  let lastError = "";

  for (const endpoint of endpoints) {
    try {
      const hf = new HfInference(hfKey, { endpointUrl: endpoint });
      const response = await hf.chatCompletion({
        model,
        messages,
        max_tokens: 2000,
      });

      const content = response.choices?.[0]?.message?.content;
      if (content) {
        return NextResponse.json({ reply: content });
      }
      return NextResponse.json({ reply: "(Model returned empty response.)" });
    } catch (err: any) {
      lastError = err.message || "Unknown";
      // If the error is not a network failure, don't try other endpoints
      if (!lastError.includes("fetch failed") && !lastError.includes("ENOTFOUND")) {
        break;
      }
    }
  }

  // Friendly error messages
  if (lastError.includes("loading") || lastError.includes("503")) {
    return NextResponse.json(
      { error: "Model is loading. Try again in ~30 seconds." },
      { status: 503 }
    );
  }

  return NextResponse.json({ error: lastError }, { status: 502 });
}
