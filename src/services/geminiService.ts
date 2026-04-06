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

    return await response.json() as Pharmacy[];
  } catch (error) {
    console.error("Pharmacy search failed:", error);
    return [];
  }
}

export async function analyzePrescriptionStream(base64Image: string): Promise<string> {
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
      const errorText = await response.text();
      throw new Error(`OCR failed: ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    return result.text || "";
  } catch (error) {
    console.error("Analysis failed:", error);
    return "Error: Failed to fetch OCR data.";
  }
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

    const result = await response.json();
    
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
