import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import compression from 'compression';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));

// Service logic for Pharmacy search
async function handlePharmacies(req, res) {
  try {
    const { lat, lng } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) return res.status(500).json({ error: "API Key Not Found" });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const client = new GoogleGenAI({ apiKey });
    const modelName = "gemini-2.5-flash";

    // Immediate heartbeat for Cloud Run/Vercel bypass
    res.write("[System] Connection Established. Accessing GPS & Pharmacy Databases. (Cloud Run Bypass)\n");

    const response = await client.models.generateContent({
      model: modelName,
      contents: `Find the 4 nearest chemists/pharmacies around latitude ${lat}, longitude ${lng} using Google Search. Return JSON.`,
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

    res.write(response.text);
    res.end();
  } catch (err) {
    console.error(err);
    res.write(`\n[Error] ${err.message}`);
    res.end();
  }
}

// Service logic for Prescription Analysis
async function handleAnalyze(req, res) {
  try {
    const { image, ocrText, type } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) return res.status(500).json({ error: "API Key Not Found" });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const client = new GoogleGenAI({ apiKey });
    const model = "gemini-2.5-flash";

    res.write(`[System] Connection Established. Starting ${type === 'audit' ? 'Deep Audit' : 'OCR Scan'}... (Cloud Run Bypass)\n`);

    let prompt = "";
    let systemInstruction = "";
    let responseMimeType = "text/plain";
    let responseSchema = undefined;

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
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: image } }] }],
      config: {
        systemInstruction: systemInstruction || undefined,
        responseMimeType: responseMimeType,
        responseSchema: responseSchema,
        maxOutputTokens: 2048
      }
    });

    res.write(response.text);
    res.end();
  } catch (err) {
    console.error(err);
    res.write(`\n[Error] ${err.message}`);
    res.end();
  }
}

// API Routes
app.post('/api/pharmacies', handlePharmacies);
app.post('/api/analyze', handleAnalyze);

// Static files (from Vite build)
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
