import { GoogleGenAI, Type } from "@google/genai";
import { robustParseJson } from "../lib/jsonUtils";
import { PrescriptionAnalysis, Pharmacy } from "../types";

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY || "" });

export async function findNearbyPharmacies(lat: number, lng: number): Promise<Pharmacy[]> {
  const model = "gemini-2.5-flash";
  
  // Step 1: Use Google Maps tool to find pharmacies and get grounding metadata
  const response = await ai.models.generateContent({
    model,
    contents: `Find 5 nearby pharmacies near latitude ${lat}, longitude ${lng}. For each, provide their name, full address, rating, phone number (with country code), distance from this location, and official contact email if available.`,
    config: {
      tools: [{ googleSearch: {} }]
    }
  });

  if (response.usageMetadata) {
    console.log(`[TOKEN LOG] Pharmacy Search (Step 1):`, response.usageMetadata);
  }

  // Step 2: Use the grounding metadata to get a structured JSON response with distances
  const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
  const textResponse = response.text;

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

  if (jsonResponse.usageMetadata) {
    console.log(`[TOKEN LOG] Pharmacy Search (Step 2):`, jsonResponse.usageMetadata);
  }

    try {
      const pharmacies = JSON.parse(jsonResponse.text || "[]");
      return pharmacies as Pharmacy[];
    } catch (error) {
    console.error("Failed to parse pharmacy JSON:", error);
    // Fallback to basic parsing if JSON fails
    const pharmacies: Pharmacy[] = [];
    const chunks = groundingMetadata?.groundingChunks;
    if (chunks) {
      for (const chunk of chunks) {
        if (chunk.maps) {
          pharmacies.push({
            name: chunk.maps.title || "Pharmacy",
            address: "Address available in Google Maps",
            mapsUrl: chunk.maps.uri || "",
          });
        }
      }
    }
    return pharmacies;
  }
}

export async function* analyzePrescriptionStream(base64Image: string) {
  const model = "gemini-2.5-flash";
  const prompt = `
    Perform a high-fidelity OCR scan of this medical prescription. 
    1. DECIPHER HANDWRITING: Carefully read every word.
    2. LIST EVERYTHING: Patient details, Doctor details, Clinic info, and every single Medication with its dosage and frequency.
    3. BE PRECISE: If a word is unclear, provide your best clinical guess based on common medical terms.
    
    Output raw text as you read it. Be extremely detailed.
  `;
  
  try {
    const response = await ai.models.generateContentStream({
      model,
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] || base64Image } }
          ]
        }
      ],
      config: {}
    });

    for await (const chunk of response) {
      if (chunk.text) {
        yield chunk.text;
      }
    }
  } catch (error) {
    console.error("Streaming analysis failed:", error);
    yield "Error: Failed to stream OCR data.";
  }
}

export async function deepAuditPrescription(base64Image: string, initialOcrText: string): Promise<PrescriptionAnalysis> {
  const model = "gemini-2.5-flash";
  
  const systemInstruction = `
    You are a Senior Medical Audit Specialist. 
    Your task is to take the initial OCR results of a prescription and perform a deep clinical audit.
    
    1. VERIFY MEDICATIONS: Use Google Search to cross-reference identified brand names (especially from India like Rozad, Ambulax, Petril Plus, Placida, Exojet) with official databases (RxNorm, FDA).
    2. CORRECT ERRORS: If the initial OCR text seems to have misread a drug name (e.g., "Rozad" instead of "Rosuvastatin" or vice versa), correct it using clinical reasoning.
    3. NO MISSING DATA: You MUST identify every single medication mentioned. If a word is partially legible, use the context of other medications and the patient's likely condition to make a strong, well-calculated assumption.
    4. ENRICH DATA: Identify active ingredients, suggest generic alternatives, and list safety warnings/interactions.
    5. STRUCTURE: Output a valid JSON object following the provided schema.
    
    CRITICAL: It is better to make a medically-sound assumption than to leave a medication out. If you see a dosage like "1-0-1" or "OD", there MUST be a corresponding medication.
  `;

  const prompt = `
    Initial OCR Text:
    ${initialOcrText}
    
    Image Context: (Provided as image)
    
    Perform a deep audit of the medications found in the OCR text and the image. 
    Ensure NO medication is missed. If something looks like a medication but is unclear, use your medical knowledge to identify the most likely candidate.
  `;

  try {
    console.log(`[SYSTEM LOG] Starting Deep Clinical Audit...`);
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] || base64Image } }
          ]
        }
      ],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            patientName: { type: Type.STRING },
            doctorName: { type: Type.STRING },
            doctorContact: { type: Type.STRING },
            clinicName: { type: Type.STRING },
            date: { type: Type.STRING },
            medications: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  drugName: { type: Type.STRING },
                  dosage: { type: Type.STRING },
                  frequency: { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                  activeIngredients: { type: Type.ARRAY, items: { type: Type.STRING } },
                  alternatives: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        brandName: { type: Type.STRING },
                        manufacturer: { type: Type.STRING },
                        form: { type: Type.STRING },
                        strength: { type: Type.STRING },
                        isGeneric: { type: Type.BOOLEAN }
                      }
                    }
                  },
                  safetyWarnings: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["drugName", "dosage", "frequency"]
              }
            },
            overallConfidence: { type: Type.NUMBER },
            overallSafetyWarnings: { type: Type.ARRAY, items: { type: Type.STRING } },
            interactionRisks: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["medications"]
        },
        maxOutputTokens: 8192
      }
    });

    const result = robustParseJson(response.text || "{}", {});
    console.log(`[SYSTEM LOG] Deep Audit complete.`);

    return {
      patientName: result.patientName || "Unknown",
      doctorName: result.doctorName || "Unknown",
      doctorContact: result.doctorContact || "Not specified",
      clinicName: result.clinicName || "Unknown",
      date: result.date || "Not specified",
      medications: (result.medications || []).map((med: any) => ({
        drugName: med.drugName || "Unknown",
        dosage: med.dosage || "Not specified",
        frequency: med.frequency || "Not specified",
        confidence: med.confidence || 0.8,
        activeIngredients: med.activeIngredients || [],
        alternatives: med.alternatives || [],
        safetyWarnings: med.safetyWarnings || []
      })),
      overallConfidence: result.overallConfidence || 0.8,
      overallSafetyWarnings: result.overallSafetyWarnings || [],
      interactionRisks: result.interactionRisks || []
    } as PrescriptionAnalysis;
  } catch (error) {
    console.error("Deep Audit failed:", error);
    throw new Error("Failed to perform deep audit of the prescription.");
  }
}
