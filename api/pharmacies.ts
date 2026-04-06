import { GoogleGenAI, Type } from "@google/genai";

export const config = {
  runtime: "edge",
};

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405 });
  }

  const { lat, lng } = await req.json();
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "API Key Not Found" }), { status: 500 });
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-2.5-flash";

  try {
    const response = await ai.models.generateContent({
      model,
      contents: `Find 5 nearby pharmacies near latitude ${lat}, longitude ${lng}. For each, provide their name, full address, rating, phone number (with country code), distance from this location, and official contact email if available.`,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    const textResponse = response.text;
    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;

    const jsonResponse = await ai.models.generateContent({
      model,
      contents: [
        { text: `Based on the following information about nearby pharmacies, provide a JSON list of the top 5 pharmacies. 
        Include name, address, distance (as a string like "0.5 km"), rating (number), phone (string with country code), email (string, or null if not found).
        
        For mapsUrl, generate a direct Google Maps search link using this format: 
        'https://www.google.com/maps/search/?api=1&query=PHARMACY_NAME+ADDRESS' (replacing spaces with +).
        
        Verify phone numbers from the metadata to ensure accuracy.
        
        Information:
        ${textResponse}
        
        Metadata:
        ${JSON.stringify(groundingMetadata)}` }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              address: { type: Type.STRING },
              distance: { type: Type.STRING },
              rating: { type: Type.NUMBER },
              phone: { type: Type.STRING },
              email: { type: Type.STRING },
              mapsUrl: { type: Type.STRING },
              isOpen: { type: Type.BOOLEAN }
            },
            required: ["name", "address", "distance", "mapsUrl"]
          }
        }
      }
    });

    return new Response(jsonResponse.text, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Gemini Pharmacy Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
