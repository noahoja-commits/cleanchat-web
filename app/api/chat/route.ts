import { NextRequest, NextResponse } from "next/server";
import { HfInference } from "@huggingface/inference";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const hfKey = process.env.HF_API_KEY || "";
  if (!hfKey) {
    return NextResponse.json(
      { error: "HF_API_KEY not configured." },
      { status: 500 }
    );
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

  const hf = new HfInference(hfKey);
  const model = process.env.HF_MODEL || "Orenguteng/Llama-3-8B-Lexi-Uncensored";

  try {
    const response = await hf.chatCompletion({
      model,
      messages,
      max_tokens: 2000,
    });

    const content = response.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json({
        reply:
          "(The model returned no content.)",
      });
    }

    return NextResponse.json({ reply: content });
  } catch (err: any) {
    // HF Inference client throws with specific messages
    const msg = err.message || "Unknown error";
    return NextResponse.json(
      { error: msg.includes("loading") ? "Model is loading — try again in ~30 seconds." : msg },
      { status: 502 }
    );
  }
}
