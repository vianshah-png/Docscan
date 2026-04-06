import { GoogleGenAI } from "@google/genai";

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405 });
  }

  try {
    const { lat, lng } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API Key Not Found" }), { status: 500 });
    }

    const client = new GoogleGenAI({ apiKey });
    const modelName = "gemini-2.5-flash";

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 🚀 MAKESHIFT 504 BYPASS: Send heartbeat immediately
          controller.enqueue(encoder.encode("[System] Connection Established. Accessing GPS & Pharmacy Databases. (504 Bypass)\n"));

          const response = await client.models.generateContent({
            model: modelName,
            contents: `Find the 4 nearest chemists/pharmacies around latitude ${lat}, longitude ${lng} using Google Search. Return JSON.`,
            config: {
              tools: [{ googleSearch: {} }],
              responseMimeType: "application/json",
              responseSchema: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    address: { type: "string" },
                    distance: { type: "string" },
                    rating: { type: "number" },
                    phone: { type: "string" },
                    mapsUrl: { type: "string" },
                    isOpen: { type: "boolean" }
                  },
                  required: ["name", "address", "distance", "mapsUrl"]
                }
              }
            }
          });

          controller.enqueue(encoder.encode(response.text));
          controller.close();
        } catch (err: any) {
          controller.enqueue(encoder.encode(`\n[Error] ${err.message}`));
          controller.close();
        }
      }
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Transfer-Encoding": "chunked",
            "X-Vercel-Bypass": "504-Heartbeat"
        }
    });

  } catch (error: any) {
    console.error("Gemini Pharmacy Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
