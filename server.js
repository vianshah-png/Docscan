require('dotenv').config();

const express = require('express');
const path    = require('path');
const cors    = require('cors');
const compression = require('compression');
const { GoogleGenAI } = require('@google/genai');

const app  = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(compression());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------------------------------------------------ *
 *  Helper: get a fresh Gemini client
 * ------------------------------------------------------------------ */
function gemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in .env');
  return new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1beta' } });
}

/* ------------------------------------------------------------------ *
 *  POST /api/analyze
 *  Body: { image: base64string, ocrText?: string, type: 'stream'|'audit' }
 * ------------------------------------------------------------------ */
app.post('/api/analyze', async (req, res) => {
  try {
    const { image, ocrText, type } = req.body;
    if (!image) return res.status(400).json({ error: 'image is required' });

    const client = gemini();
    const model  = 'gemini-2.5-flash';

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');

    res.write('[System] Connection Established. Starting Analysis...\n');

    let prompt            = '';
    let systemInstruction = '';
    let responseMimeType  = 'text/plain';

    if (type === 'stream') {
      prompt = `You are a medical OCR specialist. Perform high-fidelity OCR on this prescription image.
Carefully decipher every word including handwritten text.
List:
- Patient name, doctor name, clinic name, date
- Every medication with dosage and frequency
- Any special instructions`;
    } else if (type === 'audit') {
      responseMimeType  = 'application/json';
      systemInstruction = `You are a Senior Medical Audit Specialist AI. Your role is CLERICAL: transcribing and auditing medical prescriptions for record-keeping.
NEVER provide medical advice. ONLY extract and organize factual data from the image.
OUTPUT RULES:
- Return ONLY a valid JSON object — no surrounding text, no markdown fences.
- If data is missing, use "Unknown" or null.
- Follow this exact schema:
{
  "patientName": "string",
  "doctorName": "string",
  "clinicName": "string",
  "date": "string",
  "medications": [
    {
      "drugName": "string",
      "dosage": "string",
      "frequency": "string",
      "confidence": 0.95,
      "activeIngredients": ["string"],
      "safetyWarnings": ["string"],
      "alternatives": [{ "brandName": "string", "manufacturer": "string" }]
    }
  ],
  "overallConfidence": 0.9,
  "overallSafetyWarnings": ["string"],
  "interactionRisks": ["string"]
}`;
      prompt = `OCR pre-scan text (may be incomplete): ${ocrText || 'none'}.
Now perform a deep clinical audit of the prescription image. Return the JSON object per the schema.`;
    } else {
      return res.status(400).json({ error: 'type must be "stream" or "audit"' });
    }

    const response = await client.models.generateContent({
      model,
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: image } }
        ]
      }],
      config: {
        systemInstruction: systemInstruction || undefined,
        responseMimeType,
        responseSchema: type === 'audit' ? {
          type: 'object',
          properties: {
            patientName: { type: 'string' },
            doctorName: { type: 'string' },
            clinicName: { type: 'string' },
            date: { type: 'string' },
            medications: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  drugName: { type: 'string' },
                  dosage: { type: 'string' },
                  frequency: { type: 'string' },
                  confidence: { type: 'number' },
                  activeIngredients: { type: 'array', items: { type: 'string' } },
                  safetyWarnings: { type: 'array', items: { type: 'string' } },
                  alternatives: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        brandName: { type: 'string' },
                        manufacturer: { type: 'string' }
                      }
                    }
                  }
                },
                required: ['drugName']
              }
            },
            overallConfidence: { type: 'number' },
            overallSafetyWarnings: { type: 'array', items: { type: 'string' } },
            interactionRisks: { type: 'array', items: { type: 'string' } }
          },
          required: ['patientName', 'medications']
        } : undefined,
        maxOutputTokens: 4096
      }
    });

    res.write(response.text);
    res.end();
  } catch (err) {
    console.error('[analyze error]', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`\n[Error] ${err.message}`);
      res.end();
    }
  }
});

/* ------------------------------------------------------------------ *
 *  POST /api/pharmacies
 *  Body: { lat: number, lng: number }
 * ------------------------------------------------------------------ */
app.post('/api/pharmacies', async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (lat == null || lng == null) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    const client    = gemini();
    const modelName = 'gemini-2.5-flash';

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');

    res.write('[System] Locating nearby chemists...\n');

    // Step 1: Ground search to find real pharmacies nearby
    const searchResponse = await client.models.generateContent({
      model: modelName,
      contents: `Find the 4 nearest chemists or pharmacies near latitude ${lat}, longitude ${lng}. Use Google Search to get real, accurate results including their phone numbers and contact emails if listed.`,
      config: { tools: [{ googleSearch: {} }] }
    });

    // Step 2: Format into strict JSON
    const formatResponse = await client.models.generateContent({
      model: modelName,
      contents: [{
        role: 'user',
        parts: [{
          text: `Based on this pharmacy search result, return a JSON array of the top 4 pharmacies.
Each entry must have: name, address, distance (e.g. "1.2 km"), rating (number 1-5), phone (with country code if available, e.g. +919876543210), email (if found, otherwise null), mapsUrl (https://www.google.com/maps/search/?api=1&query=NAME+ADDRESS), isOpen (boolean, default true).
Return ONLY the raw JSON array — no markdown, no extra text.

Search result:
${searchResponse.text}`
        }]
      }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name:      { type: 'string' },
              address:   { type: 'string' },
              distance:  { type: 'string' },
              rating:    { type: 'number' },
              phone:     { type: 'string' },
              email:     { type: 'string' },
              mapsUrl:   { type: 'string' },
              isOpen:    { type: 'boolean' }
            },
            required: ['name', 'address', 'distance', 'mapsUrl']
          }
        }
      }
    });

    res.write(formatResponse.text);
    res.end();
  } catch (err) {
    console.error('[pharmacies error]', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`\n[Error] ${err.message}`);
      res.end();
    }
  }
});

/* ------------------------------------------------------------------ *
 *  Fallback → index.html
 * ------------------------------------------------------------------ */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ RxLens running → http://localhost:${PORT}\n`);
});
