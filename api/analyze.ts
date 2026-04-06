import { GoogleGenAI } from "@google/genai";

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405 });
  }

  const { image, ocrText, type } = await req.json();
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "API Key Not Found" }), { status: 500 });
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-2.5-flash";

  try {
    let prompt = "";
    let systemInstruction = "";
    let responseMimeType = "text/plain";
    let responseSchema: any = undefined;

    if (type === "stream") {
      prompt = `
        Perform a high-fidelity OCR scan of this medical prescription. 
        1. DECIPHER HANDWRITING: Carefully read every word.
        2. LIST EVERYTHING: Patient details, Doctor details, Clinic info, and every single Medication with its dosage and frequency.
        3. BE PRECISE: If a word is unclear, provide your best clinical guess based on common medical terms.
        
        Output raw text as you read it. Be extremely detailed.
      `;
    } else if (type === "audit") {
      systemInstruction = `
        You are a Senior Medical Audit Specialist. 
        Your task is to take the initial OCR results of a prescription and perform a deep clinical audit.
        
        1. VERIFY MEDICATIONS: Use Google Search to cross-reference identified brand names (especially from India like Rozad, Ambulax, Petril Plus, Placida, Exojet) with official databases (RxNorm, FDA).
        2. CORRECT ERRORS: If the initial OCR text seems to have misread a drug name, correct it using clinical reasoning.
        3. NO MISSING DATA: You MUST identify every single medication mentioned. If a word is partially legible, use the context of other medications and the patient's likely condition to make a strong, well-calculated assumption.
        4. ENRICH DATA: Identify active ingredients, suggest generic alternatives, and list safety warnings/interactions.
        5. STRUCTURE: Output a valid JSON object.
        
        CRITICAL: It is better to make a medically-sound assumption than to leave a medication out. If you see a dosage like "1-0-1" or "OD", there MUST be a corresponding medication.
      `;

      prompt = `
        Initial OCR Text:
        ${ocrText}
        
        Image Context: (Provided as image)
        
        Perform a deep audit of the medications found in the OCR text and the image. 
        Ensure NO medication is missed. If something looks like a medication but is unclear, use your medical knowledge to identify the most likely candidate.
      `;

      responseMimeType = "application/json";
      responseSchema = {
        type: "OBJECT",
        properties: {
          patientName: { type: "STRING" },
          doctorName: { type: "STRING" },
          doctorContact: { type: "STRING" },
          clinicName: { type: "STRING" },
          date: { type: "STRING" },
          medications: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                drugName: { type: "STRING" },
                dosage: { type: "STRING" },
                frequency: { type: "STRING" },
                confidence: { type: "NUMBER" },
                activeIngredients: { type: "ARRAY", items: { type: "STRING" } },
                alternatives: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      brandName: { type: "STRING" },
                      manufacturer: { type: "STRING" },
                      form: { type: "STRING" },
                      strength: { type: "STRING" },
                      isGeneric: { type: "BOOLEAN" }
                    }
                  }
                },
                safetyWarnings: { type: "ARRAY", items: { type: "STRING" } }
              },
              required: ["drugName", "dosage", "frequency"]
            }
          },
          overallConfidence: { type: "NUMBER" },
          overallSafetyWarnings: { type: "ARRAY", items: { type: "STRING" } },
          interactionRisks: { type: "ARRAY", items: { type: "STRING" } }
        },
        required: ["medications"]
      };
    } else {
      return new Response(JSON.stringify({ error: "Invalid Type" }), { status: 400 });
    }

    const responseStream = await ai.models.generateContentStream({
      model,
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { mimeType: "image/jpeg", data: image } }
          ]
        }
      ],
      config: {
        systemInstruction,
        responseMimeType,
        responseSchema,
        maxOutputTokens: 8192
      }
    });

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of responseStream) {
            if (chunk.text) {
              controller.enqueue(new TextEncoder().encode(chunk.text));
            }
          }
          controller.close();
        } catch (error: any) {
          console.error("Stream reader error:", error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "application/octet-stream", // Use octet-stream for generic streaming data
            "Transfer-Encoding": "chunked",
            "Cache-Control": "no-cache"
        }
    });
  } catch (error: any) {
    console.error("Gemini Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
