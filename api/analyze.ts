import { GoogleGenAI } from "@google/genai";

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405 });
  }

  try {
    const { image, ocrText, type } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "API Key Not Found" }), { status: 500 });
    }

    const client = new GoogleGenAI({ apiKey });
    const model = "gemini-2.5-flash";

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 🚀 MAKESHIFT 504 BYPASS: Send an immediate heartbeat to keep Vercel gateway alive
          controller.enqueue(encoder.encode("[System] Connection Established. Starting Analysis... (504 Bypass)\n"));

          let prompt = "";
          let systemInstruction = "";
          let responseMimeType = "text/plain";
          let responseSchema: any = undefined;

          if (type === "stream") {
            prompt = `Perform high-fidelity OCR scan. Decipher every word. List medications and patient info.`;
          } else if (type === "audit") {
            systemInstruction = `Senior Medical Audit Specialist. Audit Indian brands. Output JSON.`;
            prompt = `Initial OCR Text: ${ocrText}. Analyze medications in the image. Return JSON.`;
            responseMimeType = "application/json";
            responseSchema = {
              type: "object",
              properties: {
                patientName: { type: "string" },
                medications: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      drugName: { type: "string" },
                      dosage: { type: "string" },
                      frequency: { type: "string" }
                    },
                    required: ["drugName", "dosage"]
                  }
                }
              },
              required: ["medications"]
            };
          }

          const response = await client.models.generateContent({
            model,
            contents: [
              { parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: image } }] }
            ],
            config: {
              systemInstruction: systemInstruction || undefined,
              responseMimeType: responseMimeType as any,
              responseSchema: responseSchema || undefined,
              maxOutputTokens: 2048
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
    console.error("Gemini Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
