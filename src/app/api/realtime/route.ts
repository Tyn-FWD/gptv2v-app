// src/app/api/realtime/route.ts
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const endpoint = process.env.NEXT_PUBLIC_AZURE_OPENAI_ENDPOINT!;
  const apiKey = process.env.NEXT_PUBLIC_AZURE_OPENAI_API_KEY!;

  const body = await req.text(); // raw SDP body

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/sdp",
      "api-key": apiKey,
    },
    body,
  });

  const text = await res.text();
  console.log("Azure Realtime Response:", text); // should start with v=

  return new Response(text, {
    status: res.status,
    headers: {
      "Content-Type": "application/sdp",
    },
  });
}
