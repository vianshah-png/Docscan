export interface PrescriptionAnalysis {
  patientName?: string;
  doctorName?: string;
  doctorContact?: string;
  clinicName?: string;
  date?: string;
  medications: Medication[];
  overallConfidence: number;
  overallSafetyWarnings: string[];
  interactionRisks?: string[];
}

export interface Medication {
  drugName: string;
  dosage: string;
  frequency: string;
  confidence: number;
  activeIngredients: string[];
  alternatives: DrugAlternative[];
  safetyWarnings: string[];
}

export interface DrugAlternative {
  brandName: string;
  manufacturer: string;
  form: string;
  strength: string;
  isGeneric: boolean;
}

export interface Pharmacy {
  name: string;
  address: string;
  distance?: string;
  rating?: number;
  phone?: string;
  email?: string;
  mapsUrl: string;
  isOpen?: boolean;
}

export type ProcessingStep = 
  | 'idle'
  | 'uploading'
  | 'normalizing'
  | 'reading'
  | 'extracting'
  | 'verifying'
  | 'searching'
  | 'completed'
  | 'error'
  | 'history';

export interface SavedScan {
  id: string;
  timestamp: number;
  image: string;
  analysis: PrescriptionAnalysis;
}
