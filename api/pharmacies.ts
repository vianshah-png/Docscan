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

    // 1. Find the pharmacies using Google Search
    const searchResponse = await client.models.generateContent({
      model: modelName,
      contents: `Find 5 nearby pharmacies near latitude ${lat}, longitude ${lng}. For each, provide their name, full address, rating, phone number (with country code), distance from this location, and official contact email if available.`,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    const textResponse = searchResponse.text;
    const candidates = (searchResponse.candidates as any);
    const groundingMetadata = candidates?.[0]?.groundingMetadata;

    // 2. Format as JSON
    const finalResponse = await client.models.generateContent({
      model: modelName,
      contents: [
        { 
          role: "user",
          parts: [{ text: `Based on the following information about nearby pharmacies, provide a JSON list of the top 5 pharmacies. 
        Only output valid JSON.
        
        Include name, address, distance (as a string like "0.5 km"), rating (number), phone (string with country code), email (string, or null if not found).
        
        For mapsUrl, generate a direct Google Maps search link using this format: 
        'https://www.google.com/maps/search/?api=1&query=PHARMACY_NAME+ADDRESS' (replacing spaces with +).
        
        Verify phone numbers from the metadata to ensure accuracy.
        
        Information:
        ${textResponse}
        
        Metadata:
        ${JSON.stringify(groundingMetadata)}` }] }
      ],
      config: {
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
              email: { type: "string" },
              mapsUrl: { type: "string" },
              isOpen: { type: "boolean" }
            },
            required: ["name", "address", "distance", "mapsUrl"]
          }
        }
      }
    });

    return new Response(finalResponse.text, {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("Gemini Pharmacy Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
