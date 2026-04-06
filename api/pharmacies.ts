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
    const modelName = "gemini-2.5-flash"; // Still using the user's preferred model

    // 1. Single efficient call to find and format pharmacies in one go
    const response = await client.models.generateContent({
      model: modelName,
      contents: `Find the 4 nearest chemists/pharmacies around latitude ${lat}, longitude ${lng} using Google Search.
      IMPORTANT: Immediately return the data as a JSON array of objects. 
      Do NOT provide any text before or after the JSON.
      
      Fields per pharmacy:
      - name: The pharmacy name
      - address: The full address
      - distance: Estimated distance (e.g. "0.5 km")
      - rating: Number
      - phone: Phone number with country code (e.g. +91...)
      - mapsUrl: Direct Google Maps search link: 'https://www.google.com/maps/search/?api=1&query=PHARMACY_NAME+ADDRESS' (with + for spaces)
      - isOpen: Boolean
      `,
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

    return new Response(response.text, {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("Gemini Pharmacy Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
