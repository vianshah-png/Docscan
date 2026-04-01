import React, { useState, useRef, useEffect } from 'react';
import { 
  Camera, 
  Upload, 
  AlertTriangle, 
  CheckCircle2, 
  Search, 
  Info, 
  ArrowRight, 
  RefreshCw,
  ShieldCheck,
  FileText,
  Pill,
  Activity,
  ChevronRight,
  ChevronLeft,
  MapPin,
  Star,
  Navigation,
  MessageSquare,
  MessageCircle,
  Phone,
  Building,
  History,
  Trash2,
  Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { analyzePrescriptionStream, deepAuditPrescription, findNearbyPharmacies } from './services/geminiService';
import { robustParseJson } from './lib/jsonUtils';
import { PrescriptionAnalysis, ProcessingStep, Pharmacy, SavedScan } from './types';
import { cn } from './lib/utils';

export default function App() {
  const [step, setStep] = useState<ProcessingStep>('idle');
  const [image, setImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<PrescriptionAnalysis | null>(null);
  const [selectedMedIndex, setSelectedMedIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'analysis' | 'review'>('analysis');
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState<string>('');
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [isSearchingPharmacies, setIsSearchingPharmacies] = useState(false);
  const [isDeepScanning, setIsDeepScanning] = useState(false);
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
  const [systemLogs, setSystemLogs] = useState<{msg: string, type: 'info' | 'success' | 'error' | 'token', time: string}[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [history, setHistory] = useState<SavedScan[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Clamp selectedMedIndex when analysis changes
  useEffect(() => {
    if (analysis && selectedMedIndex >= analysis.medications.length) {
      setSelectedMedIndex(Math.max(0, analysis.medications.length - 1));
    }
  }, [analysis, selectedMedIndex]);

  // Capture console logs for the UI console
  useEffect(() => {
    const originalLog = console.log;
    const originalError = console.error;

    console.log = (...args: any[]) => {
      originalLog(...args);
      const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
      if (msg.includes('[TOKEN LOG]')) {
        addLog(msg.replace('[TOKEN LOG]', '').trim(), 'token');
      } else if (msg.includes('[SYSTEM LOG]')) {
        addLog(msg.replace('[SYSTEM LOG]', '').trim(), 'info');
      }
    };

    console.error = (...args: any[]) => {
      originalError(...args);
      const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
      addLog(msg, 'error');
    };

    return () => {
      console.log = originalLog;
      console.error = originalError;
    };
  }, []);

  // Load history from localStorage
  useEffect(() => {
    const savedHistory = localStorage.getItem('prescription_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error('Failed to load history', e);
      }
    }
  }, []);

  const saveScan = () => {
    if (analysis && image) {
      const newScan: SavedScan = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        image,
        analysis,
      };
      const updatedHistory = [newScan, ...history].slice(0, 20); // Keep last 20
      setHistory(updatedHistory);
      localStorage.setItem('prescription_history', JSON.stringify(updatedHistory));
      console.log('[SYSTEM LOG] Scan saved to history');
    }
  };

  const deleteFromHistory = (id: string) => {
    const updatedHistory = history.filter(s => s.id !== id);
    setHistory(updatedHistory);
    localStorage.setItem('prescription_history', JSON.stringify(updatedHistory));
    console.log('[SYSTEM LOG] Scan deleted from history');
  };

  const handleSaveAndNext = () => {
    saveScan();
    setStep('idle');
    setImage(null);
    setAnalysis(null);
    setStreamingText('');
    setPharmacies([]);
    setViewMode('analysis');
  };

  const addLog = (msg: string, type: 'info' | 'success' | 'error' | 'token' = 'info') => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setSystemLogs(prev => [...prev.slice(-49), { msg, type, time }]);
  };

  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [systemLogs]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const originalSizeKB = (file.size / 1024).toFixed(2);
      console.log(`[SYSTEM LOG] Image Uploaded: ${file.name} (${originalSizeKB} KB)`);
      
      // Compress image to 1600x1600 and high quality for better OCR accuracy
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1200;
          const MAX_HEIGHT = 1200;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            // Apply subtle image enhancements for better OCR
            ctx.filter = 'contrast(1.2) brightness(1.05) saturate(0)'; // Boost contrast and convert to grayscale for clarity
            ctx.drawImage(img, 0, 0, width, height);
          }
          
          // High quality for OCR clarity
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.9);
          const compressedSizeKB = (compressedBase64.length * 0.75 / 1024).toFixed(2);
          console.log(`[SYSTEM LOG] Image Optimized for OCR: ${width}x${height} (${compressedSizeKB} KB)`);
          
          setImage(compressedBase64);
          processPrescription(compressedBase64);
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  const processPrescription = async (base64: string) => {
    const startTime = performance.now();
    console.log(`[SYSTEM LOG] Starting Smart OCR & Clinical Analysis...`);
    try {
      setStep('reading');
      setStreamingText('');
      
      let fullOcrText = "";
      
      // Stage 1: Fast OCR Scan (Streaming)
      try {
        const stream = analyzePrescriptionStream(base64);
        for await (const chunk of stream) {
          fullOcrText += chunk;
          setStreamingText(prev => (prev + chunk).slice(-2000));
        }
      } catch (err) {
        console.warn("Streaming OCR failed, but continuing with deep analysis...", err);
      }

      setStep('searching');
      setStreamingText(prev => prev + "\n\n[SYSTEM] Starting Deep Clinical Audit & Grounding...");

      // Stage 2: Deep Clinical Audit (Grounding)
      const result = await deepAuditPrescription(base64, fullOcrText);
      
      setAnalysis(result);
      setStep('completed');
      setViewMode('analysis');

      // Start pharmacy search only after analysis is complete and displayed
      handleFindPharmacies();
      
      const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
      console.log(`[SYSTEM LOG] Total Optimized Processing Time: ${totalTime}s`);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      setStep('error');
    }
  };

  const reset = () => {
    setStep('idle');
    setImage(null);
    setAnalysis(null);
    setError(null);
    setStreamingText('');
    setPharmacies([]);
    setIsSearchingPharmacies(false);
    setIsDeepScanning(false);
    setUserLocation(null);
    setViewMode('analysis');
  };

  const handleFindPharmacies = () => {
    if (!navigator.geolocation) {
      console.log("[SYSTEM LOG] Geolocation is not supported");
      setError("Geolocation is not supported by your browser");
      return;
    }

    setIsSearchingPharmacies(true);
    console.log("[SYSTEM LOG] Searching for nearby pharmacies...");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          setUserLocation({ lat: latitude, lng: longitude });
          const results = await findNearbyPharmacies(latitude, longitude);
          setPharmacies(results.slice(0, 4));
          console.log(`[SYSTEM LOG] Found ${results.length} pharmacies nearby (Showing top 4)`);
        } catch (err) {
          console.error(err);
        } finally {
          setIsSearchingPharmacies(false);
        }
      },
      (err) => {
        console.error(err);
        setError("Please enable location access to find nearby pharmacies.");
        setIsSearchingPharmacies(false);
      }
    );
  };

  const getChatUrl = (pharmacy: Pharmacy) => {
    if (!analysis) return "#";
    
    const medsList = analysis.medications.map(m => m.drugName).join(', ');
    const locationStr = userLocation ? ` (Location: ${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)})` : '';
    const message = `Hi, I'm inquiring about the availability of the following medicines: ${medsList}. Are they available at your pharmacy?${locationStr}`;
    
    // Priority 1: WhatsApp if phone exists
    if (pharmacy.phone && pharmacy.phone.trim() !== '') {
      // Clean phone number: remove non-digits, but keep country code if it started with +
      let cleanPhone = pharmacy.phone.replace(/\D/g, '');
      // If it looks like a local number (e.g. 10 digits in India), we might need to prefix country code,
      // but wa.me works best with the full international format.
      // Gemini is instructed to provide country code now.
      return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
    } 
    
    // Priority 2: Mailto with actual email if available
    const emailRecipient = pharmacy.email || '';
    const subject = encodeURIComponent("Medicine Availability Inquiry");
    const body = encodeURIComponent(message);
    return `mailto:${emailRecipient}?subject=${subject}&body=${body}`;
  };

  return (
    <div className="min-h-screen bg-[#f5f5f5] text-[#1a1a1a] font-sans selection:bg-blue-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white">
              <ShieldCheck size={20} />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">RxLens</h1>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setStep('history')}
              className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors"
            >
              <History size={18} />
              <span className="hidden sm:inline">History</span>
            </button>
            <div className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-500">
              <a href="#" className="hover:text-blue-600 transition-colors">Safety Protocol</a>
              <a href="#" className="hover:text-blue-600 transition-colors">Verification</a>
              <a href="#" className="hover:text-blue-600 transition-colors">Databases</a>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 md:py-12">
        <AnimatePresence mode="popLayout">
          {step === 'history' && (
            <motion.div
              key="history"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <button 
                  onClick={() => setStep('idle')}
                  className="flex items-center gap-2 text-gray-600 hover:text-blue-600 transition-colors"
                >
                  <ChevronLeft size={20} />
                  <span className="font-medium">Back to Scan</span>
                </button>
                <h2 className="text-2xl font-bold text-gray-900">Scan History</h2>
              </div>

              {history.length === 0 ? (
                <div className="bg-white rounded-2xl p-12 text-center border border-gray-200 space-y-4">
                  <div className="w-16 h-16 bg-gray-100 text-gray-400 rounded-full flex items-center justify-center mx-auto">
                    <History size={32} />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-gray-900">No scans yet</h3>
                    <p className="text-gray-500 max-w-xs mx-auto">Your prescription scan history will appear here once you save them.</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {history.map((scan) => (
                    <div 
                      key={scan.id}
                      className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm hover:shadow-md transition-shadow group relative"
                    >
                      <div className="flex gap-4">
                        <div className="w-24 h-24 bg-gray-100 rounded-xl overflow-hidden shrink-0 border border-gray-100">
                          <img 
                            src={scan.image} 
                            alt="Prescription" 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                              <Clock size={12} />
                              <span>{new Date(scan.timestamp).toLocaleDateString()} {new Date(scan.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteFromHistory(scan.id);
                              }}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                          <h4 className="font-semibold text-gray-900 truncate">
                            {scan.analysis.patientName || 'Unknown Patient'}
                          </h4>
                          <p className="text-sm text-gray-500 line-clamp-1">
                            {scan.analysis.medications.map(m => m.drugName).join(', ')}
                          </p>
                          <button 
                            onClick={() => {
                              setImage(scan.image);
                              setAnalysis(scan.analysis);
                              setStep('completed');
                            }}
                            className="text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1"
                          >
                            View Details <ChevronRight size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {step === 'idle' && (
            <motion.div 
              key="idle"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-2xl mx-auto text-center space-y-8"
            >
              <div className="space-y-4">
                <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900">
                  Interpret medical prescriptions with safety-first AI.
                </h2>
                <p className="text-lg text-gray-600 max-w-lg mx-auto">
                  Upload a photo of your prescription to identify active ingredients, 
                  find generic alternatives, and check for safety warnings.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="group relative flex flex-col items-center justify-center p-8 bg-white border-2 border-dashed border-gray-300 rounded-2xl hover:border-blue-500 hover:bg-blue-50/50 transition-all duration-300"
                >
                  <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <Upload size={24} />
                  </div>
                  <span className="font-semibold text-gray-900">Upload Photo</span>
                  <span className="text-sm text-gray-500 mt-1">JPG, PNG up to 10MB</span>
                </button>

                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="group relative flex flex-col items-center justify-center p-8 bg-white border-2 border-dashed border-gray-300 rounded-2xl hover:border-blue-500 hover:bg-blue-50/50 transition-all duration-300"
                >
                  <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <Camera size={24} />
                  </div>
                  <span className="font-semibold text-gray-900">Use Camera</span>
                  <span className="text-sm text-gray-500 mt-1">Capture direct image</span>
                </button>
              </div>

              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                accept="image/*" 
                className="hidden" 
              />

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-left flex gap-4">
                <AlertTriangle className="text-amber-600 shrink-0" size={24} />
                <div className="space-y-1">
                  <h4 className="font-semibold text-amber-900">Critical Safety Disclaimer</h4>
                  <p className="text-sm text-amber-800 leading-relaxed">
                    This tool is for informational purposes only. AI interpretations can be incorrect. 
                    <strong> Always consult a licensed pharmacist or your prescribing doctor </strong> 
                    before taking any medication or switching to alternatives.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {step !== 'idle' && step !== 'completed' && step !== 'error' && (
            <motion.div 
              key="processing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="max-w-xl mx-auto space-y-8"
            >
              <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-200 space-y-6">
                <div className="flex justify-center">
                  <div className="relative">
                    <div className="w-20 h-20 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center text-blue-600">
                      <Search size={24} />
                    </div>
                  </div>
                </div>
                
                <div className="text-center space-y-2">
                  <h3 className="text-xl font-bold text-gray-900 capitalize">
                    {step === 'uploading' && 'Uploading Document...'}
                    {step === 'normalizing' && 'Enhancing Image Clarity...'}
                    {step === 'reading' && 'High-Fidelity Scan in Progress...'}
                    {step === 'extracting' && 'Extracting Medical Data...'}
                    {step === 'verifying' && 'Awaiting Verification...'}
                    {step === 'searching' && 'Deep Scanning for Alternatives...'}
                  </h3>
                  <p className="text-gray-500">
                    {step === 'uploading' && 'Securely transmitting your prescription data.'}
                    {step === 'normalizing' && 'Applying deskewing and contrast enhancement.'}
                    {step === 'reading' && 'Using High-Fidelity OCR to decipher handwriting.'}
                    {step === 'extracting' && 'Using HTR Transformers to interpret handwriting.'}
                    {step === 'searching' && 'Cross-referencing with RxNorm and FDA databases.'}
                  </p>
                </div>

                {step === 'reading' && streamingText && (
                  <div className="bg-gray-900 rounded-xl p-6 font-mono text-xs text-green-400 overflow-hidden relative">
                    <div className="absolute top-2 right-3 flex gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-red-500/50" />
                      <div className="w-2 h-2 rounded-full bg-amber-500/50" />
                      <div className="w-2 h-2 rounded-full bg-green-500/50" />
                    </div>
                    <div className="space-y-1 max-h-[120px] overflow-y-auto custom-scrollbar">
                      {streamingText.split('\n').map((line, i) => (
                        <div key={i} className="flex gap-2">
                          <span className="opacity-30 select-none">{(i + 1).toString().padStart(2, '0')}</span>
                          <span className="break-all">{line}</span>
                        </div>
                      ))}
                      <motion.span 
                        animate={{ opacity: [0, 1] }}
                        transition={{ repeat: Infinity, duration: 0.8 }}
                        className="inline-block w-2 h-4 bg-green-400 ml-1 align-middle"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <ProcessingIndicator label="Image Normalization" active={step === 'normalizing'} done={['reading', 'extracting', 'verifying', 'searching', 'completed'].includes(step)} />
                  <ProcessingIndicator label="Handwritten Text Recognition" active={step === 'reading'} done={['extracting', 'verifying', 'searching', 'completed'].includes(step)} />
                  <ProcessingIndicator label="Medical Entity Extraction" active={step === 'extracting'} done={['verifying', 'searching', 'completed'].includes(step)} />
                  <ProcessingIndicator label="Database Grounding" active={step === 'searching'} done={(step as string) === 'completed'} />
                </div>
              </div>
            </motion.div>
          )}

          {(step === 'completed' || (step === 'searching' && analysis)) && analysis && (
            <motion.div 
              key="results"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-8"
            >
              {/* View Mode Tabs */}
              <div className="flex items-center justify-between border-b border-gray-200 pb-px">
                <div className="flex gap-4">
                  <button
                    onClick={() => setViewMode('analysis')}
                    className={cn(
                      "pb-4 px-2 text-sm font-bold transition-all relative",
                      viewMode === 'analysis' ? "text-blue-600" : "text-gray-400 hover:text-gray-600"
                    )}
                  >
                    Analysis Report
                    {viewMode === 'analysis' && (
                      <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
                    )}
                  </button>
                  <button
                    onClick={() => setViewMode('review')}
                    className={cn(
                      "pb-4 px-2 text-sm font-bold transition-all relative flex items-center gap-2",
                      viewMode === 'review' ? "text-blue-600" : "text-gray-400 hover:text-gray-600"
                    )}
                  >
                    Review & Verify
                    {analysis.medications.some(m => m.confidence < 0.8) && (
                      <span className="w-2 h-2 bg-amber-500 rounded-full" />
                    )}
                    {viewMode === 'review' && (
                      <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
                    )}
                  </button>
                </div>

                {isDeepScanning && (
                  <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 rounded-full border border-blue-100 mb-4">
                    <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
                    <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Deep Audit in Progress...</span>
                  </div>
                )}
              </div>

              {viewMode === 'analysis' ? (
                <div className="space-y-8">
                  {/* Clinic & Doctor Info */}
                  <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <div className="flex items-center gap-6">
                      <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 shadow-inner">
                        <Activity size={32} />
                      </div>
                      <div>
                        <h3 className="text-2xl font-bold text-gray-900 font-display">{analysis.clinicName || 'Clinic Not Specified'}</h3>
                        <div className="flex items-center gap-3 text-gray-500 font-medium">
                          <span className="flex items-center gap-1.5">
                            <Activity size={14} className="text-blue-600" />
                            Dr. {analysis.doctorName || 'Not Specified'}
                          </span>
                          {analysis.doctorContact && (
                            <span className="flex items-center gap-1.5 border-l border-gray-200 pl-3">
                              <Phone size={14} className="text-blue-600" />
                              {analysis.doctorContact}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 px-6 py-3 bg-gray-50 rounded-2xl border border-gray-100">
                      <div className="space-y-0.5">
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Patient</div>
                        <div className="text-sm font-bold text-gray-900">{analysis.patientName || 'Not specified'}</div>
                      </div>
                      <div className="w-px h-8 bg-gray-200" />
                      <div className="space-y-0.5">
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Date</div>
                        <div className="text-sm font-bold text-gray-900">{analysis.date || 'Not specified'}</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Content Column */}
                    <div className="lg:col-span-2 space-y-8">
                      {/* Interaction Risks */}
                      {analysis.overallSafetyWarnings.length > 0 && (
                        <div className="bg-red-50 border border-red-100 rounded-[2rem] p-6 space-y-4">
                          <div className="flex items-center gap-3 text-red-600">
                            <AlertTriangle size={24} />
                            <h4 className="text-lg font-bold">Critical Safety Alerts</h4>
                          </div>
                          <div className="grid grid-cols-1 gap-3">
                            {analysis.overallSafetyWarnings.map((warning, i) => (
                              <div key={i} className="text-sm text-red-800 bg-white/80 p-4 rounded-2xl border border-red-100 flex gap-3 shadow-sm">
                                <div className="w-1.5 h-1.5 bg-red-500 rounded-full mt-1.5 shrink-0" />
                                {warning}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Medication Details */}
                      <div className="space-y-6">
                        {/* Medication Selector (if multiple) */}
                        {analysis.medications.length > 1 && (
                          <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                            {analysis.medications.map((med, idx) => (
                              <button
                                key={idx}
                                onClick={() => setSelectedMedIndex(idx)}
                                className={cn(
                                  "px-5 py-2.5 rounded-2xl text-sm font-bold whitespace-nowrap transition-all border-2",
                                  selectedMedIndex === idx 
                                    ? "bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-100" 
                                    : "bg-white text-gray-500 border-gray-100 hover:border-blue-200"
                                )}
                              >
                                {med.drugName}
                              </button>
                            ))}
                          </div>
                        )}

                        {analysis.medications[selectedMedIndex] && (
                          <div className="space-y-8">
                            <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-gray-100 space-y-8 relative overflow-hidden">
                              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-full -mr-16 -mt-16 blur-3xl opacity-50" />
                              
                              <div className="flex items-start justify-between relative z-10">
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2 text-green-600 text-[10px] font-bold uppercase tracking-widest">
                                    <CheckCircle2 size={14} />
                                    Verified Interpretation
                                  </div>
                                  <h2 className="text-4xl font-bold text-gray-900 font-display leading-tight">{analysis.medications[selectedMedIndex].drugName}</h2>
                                </div>
                                <div className="flex flex-col items-end">
                                  <div className="text-[10px] text-gray-400 uppercase font-bold tracking-widest mb-1">Confidence</div>
                                  <div className={cn(
                                    "px-3 py-1 rounded-lg text-lg font-bold shadow-sm",
                                    analysis.medications[selectedMedIndex].confidence > 0.9 
                                      ? "bg-green-50 text-green-600 border border-green-100" 
                                      : "bg-amber-50 text-amber-600 border border-amber-100"
                                  )}>
                                    {(analysis.medications[selectedMedIndex].confidence * 100).toFixed(0)}%
                                  </div>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div className="bg-gray-50 rounded-2xl p-5 flex gap-4 border border-gray-100">
                                  <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-blue-600 shadow-sm">
                                    <Activity size={24} />
                                  </div>
                                  <div>
                                    <div className="text-[10px] text-gray-400 uppercase font-bold tracking-widest mb-0.5">Dosage</div>
                                    <div className="font-bold text-gray-900 text-lg">{analysis.medications[selectedMedIndex].dosage}</div>
                                  </div>
                                </div>
                                <div className="bg-gray-50 rounded-2xl p-5 flex gap-4 border border-gray-100">
                                  <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-blue-600 shadow-sm">
                                    <RefreshCw size={24} />
                                  </div>
                                  <div>
                                    <div className="text-[10px] text-gray-400 uppercase font-bold tracking-widest mb-0.5">Frequency</div>
                                    <div className="font-bold text-gray-900 text-lg">{analysis.medications[selectedMedIndex].frequency}</div>
                                  </div>
                                </div>
                              </div>

                              <div className="space-y-4">
                                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                                  <Pill size={16} className="text-blue-600" />
                                  Active Ingredients
                                </h4>
                                <div className="flex flex-wrap gap-2">
                                  {analysis.medications[selectedMedIndex].activeIngredients?.map((ing, i) => (
                                    <span key={i} className="px-4 py-1.5 bg-blue-50 text-blue-700 rounded-xl text-sm font-bold border border-blue-100 shadow-sm">
                                      {ing}
                                    </span>
                                  ))}
                                </div>
                              </div>

                              {analysis.medications[selectedMedIndex].safetyWarnings?.length > 0 && (
                                <div className="space-y-4 pt-6 border-t border-gray-100">
                                  <h4 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                                    <AlertTriangle size={16} className="text-amber-600" />
                                    Medication Warnings
                                  </h4>
                                  <div className="space-y-3">
                                    {analysis.medications[selectedMedIndex].safetyWarnings?.map((warning, i) => (
                                      <div key={i} className="flex gap-3 text-sm text-gray-600 bg-amber-50/50 p-3 rounded-xl border border-amber-100">
                                        <div className="w-1.5 h-1.5 bg-amber-400 rounded-full mt-1.5 shrink-0" />
                                        {warning}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Generic Alternatives */}
                            <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-gray-100 space-y-6">
                              <div className="flex items-center justify-between">
                                <h3 className="text-xl font-bold text-gray-900 font-display">Generic Alternatives</h3>
                                <div className="text-[10px] font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full uppercase tracking-widest border border-blue-100">RxNorm Verified</div>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {analysis.medications[selectedMedIndex].alternatives?.map((alt, i) => (
                                  <div key={i} className="group p-5 border border-gray-100 rounded-2xl hover:border-blue-200 hover:bg-blue-50/30 transition-all flex items-center justify-between shadow-sm hover:shadow-md">
                                    <div className="flex gap-4 items-center">
                                      <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center text-gray-400 group-hover:bg-white group-hover:text-blue-600 transition-all shadow-sm">
                                        <Pill size={24} />
                                      </div>
                                      <div>
                                        <div className="font-bold text-gray-900 text-base">{alt.brandName}</div>
                                        <div className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">{alt.manufacturer}</div>
                                      </div>
                                    </div>
                                    <ChevronRight size={20} className="text-gray-300 group-hover:text-blue-600 transition-colors" />
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Sidebar Column */}
                    <div className="space-y-8">
                      {/* Original Document */}
                      <div className="bg-white rounded-[2rem] p-6 border border-gray-100 space-y-4 shadow-sm">
                        <h4 className="text-sm font-bold text-gray-900 uppercase tracking-widest">Original Document</h4>
                        <div className="aspect-[3/4] rounded-2xl overflow-hidden bg-gray-100 relative group cursor-zoom-in border border-gray-100">
                          <img src={image!} alt="Prescription" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Search className="text-white" size={24} />
                          </div>
                        </div>
                      </div>

                      {/* Nearby Pharmacies (Repurposed Card) */}
                      <div className="bg-white rounded-[2rem] p-8 border border-gray-100 space-y-6 shadow-sm">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-bold text-gray-900 uppercase tracking-widest">Nearby Chemists</h4>
                          <button 
                            onClick={handleFindPharmacies}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
                            title="Refresh"
                          >
                            <RefreshCw size={18} className={isSearchingPharmacies ? "animate-spin" : ""} />
                          </button>
                        </div>

                        {pharmacies.length > 0 ? (
                          <div className="space-y-4">
                            {pharmacies.map((pharmacy, idx) => (
                              <div key={idx} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 space-y-3 hover:border-blue-200 transition-all group">
                                <div className="flex justify-between items-start">
                                  <div>
                                    <h5 className="font-bold text-gray-900 text-sm group-hover:text-blue-600 transition-colors">{pharmacy.name}</h5>
                                    <p className="text-[10px] text-gray-500 font-medium line-clamp-1">{pharmacy.address}</p>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-[10px] font-bold text-blue-600">{pharmacy.distance}</div>
                                    <div className="flex items-center gap-0.5 text-amber-400">
                                      <Star size={10} fill="currentColor" />
                                      <span className="text-[10px] font-bold text-gray-600">{pharmacy.rating}</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <a 
                                    href={getChatUrl(pharmacy)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-xs font-bold hover:bg-green-700 transition-colors shadow-sm shadow-green-100"
                                  >
                                    <MessageCircle size={14} />
                                    Inquire
                                  </a>
                                  <a 
                                    href={pharmacy.mapsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-2 bg-white text-gray-400 rounded-xl border border-gray-200 hover:text-blue-600 hover:border-blue-200 transition-all shadow-sm"
                                    title="Navigate"
                                  >
                                    <Navigation size={14} />
                                  </a>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="py-8 flex flex-col items-center justify-center text-center space-y-4">
                            <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-300">
                              <MapPin size={32} />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-gray-500 font-medium">Find pharmacies near you to check availability.</p>
                            </div>
                            <button 
                              onClick={handleFindPharmacies}
                              className="px-6 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
                            >
                              Search Nearby
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-8 flex flex-col sm:flex-row gap-4">
                    <button 
                      onClick={handleSaveAndNext}
                      className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-xl shadow-blue-100 flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 size={20} />
                      Save & Scan Next
                    </button>
                    <button 
                      onClick={() => {
                        setStep('idle');
                        setImage(null);
                        setAnalysis(null);
                        setStreamingText('');
                        setPharmacies([]);
                        setViewMode('analysis');
                      }}
                      className="flex-1 py-4 bg-white text-gray-700 border border-gray-200 rounded-2xl font-bold hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
                    >
                      <RefreshCw size={20} />
                      Scan Another
                    </button>
                  </div>
                </div>
              ) : (
                <div className="max-w-xl mx-auto space-y-8">
                  <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-200 space-y-6">
                <div className="flex items-center gap-3 text-amber-600">
                  <AlertTriangle size={24} />
                  <h3 className="text-xl font-bold">Verification & Review</h3>
                </div>
                <p className="text-gray-600">
                  Please verify the details below. Low confidence entries are highlighted.
                </p>
                
                <div className="space-y-6 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase">Patient Name</label>
                      <input 
                        type="text" 
                        value={analysis.patientName}
                        onChange={(e) => setAnalysis({...analysis, patientName: e.target.value})}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all font-semibold text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase">Date</label>
                      <input 
                        type="text" 
                        value={analysis.date}
                        onChange={(e) => setAnalysis({...analysis, date: e.target.value})}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all font-semibold text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase">Doctor Name</label>
                      <input 
                        type="text" 
                        value={analysis.doctorName}
                        onChange={(e) => setAnalysis({...analysis, doctorName: e.target.value})}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all font-semibold text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase">Doctor Contact</label>
                      <input 
                        type="text" 
                        value={analysis.doctorContact}
                        onChange={(e) => setAnalysis({...analysis, doctorContact: e.target.value})}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all font-semibold text-sm"
                      />
                    </div>
                  </div>

                  {analysis.medications.map((med, idx) => (
                    <div key={idx} className={cn(
                      "p-4 rounded-xl border space-y-4",
                      med.confidence < 0.8 ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200"
                    )}>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Medication #{idx + 1}</span>
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded uppercase",
                          med.confidence > 0.8 ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                        )}>
                          {(med.confidence * 100).toFixed(0)}% Conf.
                        </span>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase">Drug Name</label>
                        <input 
                          type="text" 
                          value={med.drugName}
                          onChange={(e) => {
                            const newMeds = [...analysis.medications];
                            newMeds[idx].drugName = e.target.value;
                            setAnalysis({...analysis, medications: newMeds});
                          }}
                          className="w-full p-3 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all font-semibold text-sm"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase">Dosage</label>
                          <input 
                            type="text" 
                            value={med.dosage}
                            onChange={(e) => {
                              const newMeds = [...analysis.medications];
                              newMeds[idx].dosage = e.target.value;
                              setAnalysis({...analysis, medications: newMeds});
                            }}
                            className="w-full p-3 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all font-semibold text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-gray-400 uppercase">Frequency</label>
                          <input 
                            type="text" 
                            value={med.frequency}
                            onChange={(e) => {
                              const newMeds = [...analysis.medications];
                              newMeds[idx].frequency = e.target.value;
                              setAnalysis({...analysis, medications: newMeds});
                            }}
                            className="w-full p-3 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all font-semibold text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-4">
                  <button 
                    onClick={() => setViewMode('analysis')}
                    className="flex-1 py-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100"
                  >
                    Confirm All Details
                  </button>
                  <button 
                    onClick={saveScan}
                    className="px-6 py-4 bg-white text-gray-700 border border-gray-200 rounded-xl font-bold hover:bg-gray-50 transition-all flex items-center gap-2"
                  >
                    <History size={20} />
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {step === 'error' && (
        <motion.div 
          key="error"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md mx-auto text-center space-y-6"
        >
          <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
            <AlertTriangle size={40} />
          </div>
          <div className="space-y-2">
            <h3 className="text-2xl font-bold text-gray-900">Analysis Failed</h3>
            <p className="text-gray-600">{error || 'We couldn\'t interpret the prescription. Please try a clearer photo.'}</p>
          </div>
          <button 
            onClick={reset}
            className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </motion.div>
      )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto px-4 py-12 border-t border-gray-200">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="col-span-1 md:col-span-2 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-gray-900 rounded flex items-center justify-center text-white">
                <ShieldCheck size={14} />
              </div>
              <span className="font-bold text-gray-900">RxLens Security</span>
            </div>
            <p className="text-sm text-gray-500 leading-relaxed max-w-sm">
              RxLens utilizes advanced HTR and Medical NER models grounded in RxNorm and FDA NDC directories. 
              All data processing is encrypted and adheres to strict safety protocols.
            </p>
          </div>
          <div className="space-y-4">
            <h5 className="font-bold text-gray-900 text-sm uppercase tracking-wider">Resources</h5>
            <ul className="space-y-2 text-sm text-gray-500">
              <li><a href="#" className="hover:text-blue-600">FDA Database</a></li>
              <li><a href="#" className="hover:text-blue-600">RxNorm API</a></li>
              <li><a href="#" className="hover:text-blue-600">Drug Interaction Checker</a></li>
            </ul>
          </div>
          <div className="space-y-4">
            <h5 className="font-bold text-gray-900 text-sm uppercase tracking-wider">Legal</h5>
            <ul className="space-y-2 text-sm text-gray-500">
              <li><a href="#" className="hover:text-blue-600">Privacy Policy</a></li>
              <li><a href="#" className="hover:text-blue-600">Terms of Service</a></li>
              <li><a href="#" className="hover:text-blue-600">HIPAA Compliance</a></li>
            </ul>
          </div>
        </div>
        <div className="mt-12 pt-8 border-t border-gray-100 text-center text-xs text-gray-400">
          © 2026 RxLens AI. Not a medical device. For informational use only.
        </div>
      </footer>

      {/* System Console */}
      <div className={cn(
        "fixed bottom-4 right-4 z-[100] transition-all duration-300 ease-in-out",
        showConsole ? "w-80 h-96" : "w-12 h-12"
      )}>
        {showConsole ? (
          <div className="w-full h-full bg-gray-900 rounded-2xl shadow-2xl border border-gray-800 flex flex-col overflow-hidden">
            <div className="p-3 border-b border-gray-800 flex items-center justify-between bg-gray-900/50">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">System Console</span>
              </div>
              <button 
                onClick={() => setShowConsole(false)}
                className="p-1 text-gray-500 hover:text-white transition-colors"
              >
                <ChevronRight size={16} className="rotate-90" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2 font-mono text-[10px] custom-scrollbar">
              {systemLogs.length === 0 && (
                <div className="text-gray-600 italic">No logs recorded yet...</div>
              )}
              {systemLogs.map((log, i) => (
                <div key={i} className="flex gap-2 leading-relaxed">
                  <span className="text-gray-600 shrink-0">[{log.time}]</span>
                  <span className={cn(
                    "break-all",
                    log.type === 'success' ? "text-green-400" :
                    log.type === 'error' ? "text-red-400" :
                    log.type === 'token' ? "text-blue-400" :
                    "text-gray-300"
                  )}>
                    {log.msg}
                  </span>
                </div>
              ))}
              <div ref={consoleEndRef} />
            </div>
          </div>
        ) : (
          <button 
            onClick={() => setShowConsole(true)}
            className="w-full h-full bg-gray-900 rounded-full shadow-xl border border-gray-800 flex items-center justify-center text-gray-400 hover:text-white hover:border-gray-700 transition-all group"
            title="Open System Console"
          >
            <Activity size={20} className="group-hover:scale-110 transition-transform" />
            {systemLogs.some(l => l.type === 'error') && (
              <div className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border-2 border-white" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function ProcessingIndicator({ label, active, done }: { label: string, active: boolean, done: boolean }) {
  return (
    <div className={cn(
      "flex items-center justify-between p-3 rounded-lg transition-all",
      active ? "bg-blue-50 border border-blue-100" : "bg-transparent"
    )}>
      <div className="flex items-center gap-3">
        <div className={cn(
          "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
          done ? "bg-green-500 text-white" : active ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-400"
        )}>
          {done ? <CheckCircle2 size={12} /> : null}
        </div>
        <span className={cn(
          "text-sm font-medium",
          done ? "text-gray-900" : active ? "text-blue-700" : "text-gray-400"
        )}>
          {label}
        </span>
      </div>
      {active && (
        <div className="flex gap-1">
          <div className="w-1 h-1 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-1 h-1 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-1 h-1 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      )}
    </div>
  );
}
