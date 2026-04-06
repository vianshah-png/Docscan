import { PrescriptionAnalysis, Pharmacy } from "../types";
import { robustParseJson } from "../lib/jsonUtils";

export async function findNearbyPharmacies(lat: number, lng: number): Promise<Pharmacy[]> {
  try {
    const response = await fetch("/api/pharmacies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch pharmacies: ${response.statusText}`);
    }

    const fullText = await readStreamToString(response);
    return JSON.parse(fullText || "[]") as Pharmacy[];
  } catch (error) {
    console.error("Pharmacy search failed:", error);
    return [];
  }
}

export async function* analyzePrescriptionStream(base64Image: string) {
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        type: "stream", 
        image: base64Image.split(',')[1] || base64Image 
      }),
    });

    if (!response.ok) {
      throw new Error(`Streaming failed: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No reader available");

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
  } catch (error) {
    console.error("Streaming analysis failed:", error);
    yield "Error: Failed to stream OCR data.";
  }
}

async function readStreamToString(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No reader available");

  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value, { stream: true });
    // Filter out system messages (heartbeats) that start with [
    const cleanLines = chunk.split('\n').filter(line => !line.trim().startsWith('[')).join('\n');
    result += cleanLines;
  }
  return result;
}

export async function deepAuditPrescription(base64Image: string, initialOcrText: string): Promise<PrescriptionAnalysis> {
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        type: "audit", 
        image: base64Image.split(',')[1] || base64Image,
        ocrText: initialOcrText
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Audit failed: ${response.statusText} - ${errorText}`);
    }

    const fullText = await readStreamToString(response);
    const result = robustParseJson(fullText, {});
    
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
