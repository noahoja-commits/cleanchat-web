import { NextRequest, NextResponse } from "next/server";

// Quick connectivity test
export async function GET() {
  const tests: Record<string, string> = {};
  
  // Test DNS resolution
  try {
    const dns = await fetch("https://cloudflare-dns.com/dns-query?name=api-inference.huggingface.co", {
      headers: { Accept: "application/dns-json" },
    });
    tests.dns = dns.ok ? "OK" : `fail ${dns.status}`;
  } catch (e: any) {
    tests.dns = `error: ${e.message}`;
  }

  // Test HF API reachability
  try {
    const hf = await fetch("https://api-inference.huggingface.co", {
      method: "GET",
    });
    tests.hf_root = hf.ok ? "OK" : `status ${hf.status}`;
  } catch (e: any) {
    tests.hf_root = `error: ${e.message}`;
  }

  // Test huggingface main site
  try {
    const main = await fetch("https://huggingface.co", { method: "GET" });
    tests.hf_main = main.ok ? "OK" : `status ${main.status}`;
  } catch (e: any) {
    tests.hf_main = `error: ${e.message}`;
  }

  return NextResponse.json(tests);
}
