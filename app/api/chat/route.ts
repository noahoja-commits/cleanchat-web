import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const HF_API_KEY = process.env.HF_API_KEY || "";
const HF_MODEL =
  process.env.HF_MODEL || "Orenguteng/Llama-3-8B-Lexi-Uncensored";

export async function POST(req: NextRequest) {
  if (!HF_API_KEY) {
    return NextResponse.json(
      { error: "HF_API_KEY not configured." },
      { status: 500 }
    );
  }

  try {
    const { messages } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "Missing messages array" }, { status: 400 });
    }

    // Build a prompt string from the messages (works with all HF models)
    const prompt = messages
      .map((m: any) => {
        if (m.role === "system") return `<|system|>\n${m.content}\n`;
        if (m.role === "user") return `<|user|>\n${m.content}\n`;
        if (m.role === "assistant") return `<|assistant|>\n${m.content}\n`;
        return "";
      })
      .join("") + "<|assistant|>\n";

    const response = await fetch(
      `https://api-inference.huggingface.co/models/${HF_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            max_new_tokens: 2000,
            return_full_text: false,
          },
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      const isModelLoading = response.status === 503;
      return NextResponse.json(
        {
          error: isModelLoading
            ? "Model is loading (cold start). Try again in 20-30 seconds."
            : `HF API error ${response.status}: ${text.slice(0, 200)}`,
        },
        { status: 500 }
      );
    }

    const data = await response.json();
    // HF text-generation returns [{generated_text: "..."}]
    const content = Array.isArray(data)
      ? data[0]?.generated_text || ""
      : data.generated_text || "";

    if (!content) {
      return NextResponse.json({
        reply:
          "(The model returned no content — this may be a content filter or model limitation.)",
      });
    }

    return NextResponse.json({ reply: content });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Request failed: ${err.message}` },
      { status: 500 }
    );
  }
}
