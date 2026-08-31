/* ==============================================================================
   OIL SIF SENTINEL — SAFETY INTELLIGENCE BACKEND & GEMINI PROXY
   Oil India Limited (OIL) Industrial Safety Decision Support Server
   ============================================================================== */

const path = require('path');
const dotenv = require('dotenv');

// Load .env locally if present (Cloud Run provides environment variables directly)
dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const datasetLoader = require('./backend/datasetLoader');
const analyzer = require('./backend/analyzer');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = '0.0.0.0'; // Bind to all network interfaces for Cloud Run container

// Preload dataset into memory on server initialization
try {
  datasetLoader.loadDataset();
} catch (err) {
  console.error('[Server] Warning: Failed to preload dataset on startup:', err.message);
}

// Enable CORS with full support for web, mobile WebView, and Capacitor origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.use(express.json({ limit: '1mb' }));

// Serve static frontend assets
app.use(express.static(path.join(__dirname)));

const SYSTEM_INSTRUCTION = `You are OIL SIF Sentinel AI, an enterprise safety intelligence assistant for Oil India Limited (OIL).
Your goal is to assist safety analysts in reviewing unstructured safety reports, identifying Serious Injury & Fatality (SIF) precursors, evaluating failed critical controls (LOTO, Gas Testing, Fall Protection), explaining risk scoring model outputs, and recommending preventive actions.`;

// Primary model and fallback candidate models
const PRIMARY_MODEL = 'gemini-flash-latest';
const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest'];

// Helper to format conversation history for Gemini API
function formatHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(item => item && item.role && (item.text || (item.parts && item.parts[0])))
    .map(item => {
      const text = item.text || (item.parts && item.parts[0] ? item.parts[0].text : '');
      const role = item.role === 'ai' || item.role === 'model' ? 'model' : 'user';
      return {
        role: role,
        parts: [{ text: String(text).trim() }]
      };
    })
    .slice(-10); // Keep last 10 turns to avoid excessive token overhead
}

// Check if a valid API key is present (SAFE - never logs the key)
function isKeyValid(apiKey) {
  return Boolean(
    apiKey &&
    apiKey.trim() &&
    apiKey !== 'YOUR_GEMINI_API_KEY_HERE' &&
    !apiKey.startsWith('YOUR_')
  );
}

// ================= API ENDPOINTS =================

// Standard Cloud Run health probe endpoint
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const configured = isKeyValid(apiKey);
  
  res.json({
    status: 'ok',
    geminiConfigured: configured,
    primaryModel: PRIMARY_MODEL
  });
});

// Dataset statistics endpoint
app.get('/api/dataset/stats', (req, res) => {
  try {
    const statsData = datasetLoader.getDatasetStats();
    res.json(statsData);
  } catch (err) {
    console.error('[API /api/dataset/stats] Error loading dataset stats:', err);
    res.status(500).json({
      status: 'error',
      error: err.message
    });
  }
});

// Dataset reports list endpoint (with filtering & pagination)
app.get('/api/dataset/reports', (req, res) => {
  try {
    const result = datasetLoader.getReports(req.query);
    res.json({
      status: 'ok',
      ...result
    });
  } catch (err) {
    console.error('[API /api/dataset/reports] Error querying reports:', err);
    res.status(500).json({
      status: 'error',
      error: err.message
    });
  }
});

// Single report details endpoint
app.get('/api/dataset/reports/:id', (req, res) => {
  try {
    const report = datasetLoader.getReportById(req.params.id);
    if (!report) {
      return res.status(404).json({
        status: 'error',
        error: `Report ${req.params.id} not found`
      });
    }
    res.json({
      status: 'ok',
      report: report
    });
  } catch (err) {
    console.error(`[API /api/dataset/reports/${req.params.id}] Error:`, err);
    res.status(500).json({
      status: 'error',
      error: err.message
    });
  }
});

// Precursor Intelligence Aggregation Endpoint
// Computes per-family SIF breakdown, barrier failures, and control status from cached dataset
app.get('/api/precursor/intelligence', (req, res) => {
  try {
    const { reports: allReports } = datasetLoader.loadDataset();

    // Build per-family aggregation map
    const familyMap = {};

    for (const row of allReports) {
      const family = String(row.precursor_family || 'Other').trim();
      if (!familyMap[family]) {
        familyMap[family] = {
          family: family,
          total: 0,
          sif_yes: 0,
          sif_review: 0,
          sif_no: 0,
          barrier_failure: String(row.barrier_failure || '').trim(),
          control_absent_failed: 0,
          control_potential_failure: 0,
          control_present_verified: 0,
          // Store a few sample report IDs for table display
          sampleReportIds: []
        };
      }

      const entry = familyMap[family];
      entry.total++;

      const sif = String(row.sif_precursor || '').trim().toUpperCase();
      if (sif === 'YES') entry.sif_yes++;
      else if (sif === 'REVIEW') entry.sif_review++;
      else if (sif === 'NO') entry.sif_no++;

      const cStatus = String(row.control_status || '').trim();
      if (cStatus === 'Absent/Failed') entry.control_absent_failed++;
      else if (cStatus === 'Potential failure ??? verify') entry.control_potential_failure++;
      else if (cStatus === 'Present/Verified') entry.control_present_verified++;

      // Capture barrier_failure from the first record (consistent within a family)
      if (!entry.barrier_failure && row.barrier_failure) {
        entry.barrier_failure = String(row.barrier_failure).trim();
      }

      // Store up to 5 sample report IDs per family for the table
      if (entry.sampleReportIds.length < 5 && row.report_id) {
        entry.sampleReportIds.push(String(row.report_id).trim());
      }
    }

    // Sort by total descending (highest density first)
    const families = Object.values(familyMap).sort((a, b) => b.total - a.total);

    res.json({
      status: 'ok',
      totalRecords: allReports.length,
      familyCount: families.length,
      families: families
    });
  } catch (err) {
    console.error('[API /api/precursor/intelligence] Error:', err);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Temporal Patterns Intelligence Aggregation Endpoint
// Computes time-series trends, precursor recurrence, location/department temporal density, and barrier failure recurrence across all 3,000 records
app.get('/api/temporal/intelligence', (req, res) => {
  try {
    const temporalData = datasetLoader.getTemporalIntelligence();
    res.json(temporalData);
  } catch (err) {
    console.error('[API /api/temporal/intelligence] Error:', err);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Knowledge Graph Intelligence Aggregation Endpoint
// Computes aggregated nodes (precursor, barrier, LSR, location, dept, SIF, severity, incident type, energy)
// and all directed relationship edges with report counts from the 3,000-record dataset
app.get('/api/graph/intelligence', (req, res) => {
  try {
    const graphData = datasetLoader.getGraphIntelligence();
    res.json(graphData);
  } catch (err) {
    console.error('[API /api/graph/intelligence] Error:', err);
    res.status(500).json({ status: 'error', error: err.message });
  }
});


// SIF Precursor Intelligence Analyzer Endpoint (referencing 3,000 synthetic records)

app.post('/api/analyze', (req, res) => {
  try {
    const { text, incidentType, location, activity } = req.body || {};
    console.log(`\n[API /api/analyze] Analyzing report: "${String(text || '').substring(0, 60)}..."`);
    
    const result = analyzer.analyzeReport({
      text,
      incidentType,
      location,
      activity
    });

    console.log(`[API /api/analyze] ✓ Result: SIF=${result.sifClassification}, Family="${result.precursorFamily}", TopMatch=${result.similarReports[0]?.reportId} (${result.similarReports[0]?.similarityScore}%)`);
    res.json(result);
  } catch (err) {
    console.error('[API /api/analyze] Error during report analysis:', err);
    res.status(400).json({
      status: 'error',
      error: err.message
    });
  }
});

// Chat completion endpoint (with safe development logging)
app.post('/api/chat', async (req, res) => {
  const { message, history = [] } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  const configured = isKeyValid(apiKey);

  console.log(`\n[API /api/chat] Incoming request: "${String(message || '').substring(0, 60)}"`);

  if (!message || typeof message !== 'string' || !message.trim()) {
    console.log('[API /api/chat] ✗ Empty message received');
    return res.status(400).json({
      success: false,
      fallback: true,
      error: 'Message is required'
    });
  }

  // If Gemini API Key is missing or placeholder, trigger silent fallback
  if (!configured) {
    console.log('[API /api/chat] ○ GEMINI_API_KEY loaded: NO (Placeholder or empty) -> Triggering local fallback');
    return res.status(503).json({
      success: false,
      fallback: true,
      error: 'Gemini API key is not configured'
    });
  }

  console.log('[API /api/chat] ✓ GEMINI_API_KEY loaded: YES');

  try {
    const genAI = new GoogleGenerativeAI(apiKey.trim());
    const formattedHistory = formatHistory(history);

    // Attempt generation with primary model, then fallbacks if necessary
    const modelsToTry = [PRIMARY_MODEL, ...FALLBACK_MODELS];
    let lastError = null;
    let responseText = null;
    let successfulModel = null;

    for (const modelName of modelsToTry) {
      try {
        console.log(`[API /api/chat] Calling Gemini model: ${modelName}...`);
        const modelInstance = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: SYSTEM_INSTRUCTION
        });

        const chatSession = modelInstance.startChat({
          history: formattedHistory,
          generationConfig: {
            temperature: 0.7,
            topP: 0.9,
            maxOutputTokens: 650
          }
        });

        const result = await chatSession.sendMessage(message.trim());
        const rawText = result.response.text();

        if (rawText && rawText.trim()) {
          responseText = rawText.trim();
          successfulModel = modelName;
          console.log(`[API /api/chat] ✓ Response received from ${modelName} (Length: ${responseText.length} chars)`);
          break;
        }
      } catch (modelErr) {
        lastError = modelErr;
        const statusCode = modelErr.status || modelErr.statusCode || (modelErr.message && modelErr.message.match(/\[(\d{3})\]/) ? modelErr.message.match(/\[(\d{3})\]/)[1] : 'Error');
        console.log(`[API /api/chat] ✗ Model ${modelName} returned status ${statusCode}: ${modelErr.message.split('\n')[0]}`);
      }
    }

    if (!responseText) {
      throw lastError || new Error('All candidate Gemini models failed');
    }

    return res.json({
      success: true,
      text: responseText,
      model: successfulModel
    });

  } catch (err) {
    const statusCode = err.status || 500;
    console.error(`[API /api/chat] ✗ Gemini API error (Status ${statusCode}):`, err.message.split('\n')[0]);
    console.log('[API /api/chat] ↳ Activating silent automatic fallback to DynamicAIEngine');
    
    // Return structured fallback flag without leaking internal secrets
    return res.status(500).json({
      success: false,
      fallback: true,
      error: 'Gemini service temporarily unavailable'
    });
  }
});

// Start Server on 0.0.0.0 and PORT for Cloud Run compatibility
app.listen(PORT, HOST, () => {
  const apiKey = process.env.GEMINI_API_KEY;
  const configured = isKeyValid(apiKey);
  let datasetInfo = 'None';
  try {
    const stats = datasetLoader.getDatasetStats();
    datasetInfo = `${stats.dataset.totalRows} records (${stats.dataset.fileName})`;
  } catch (e) {
    datasetInfo = `Failed to load: ${e.message}`;
  }

  console.log(`\n==================================================`);
  console.log(`  OIL SIF SENTINEL ACTIVE on http://localhost:${PORT}`);
  console.log(`  Dataset: ${datasetInfo}`);
  console.log(`  GEMINI_API_KEY loaded: ${configured ? 'YES' : 'NO'}`);
  console.log(`  Primary Model: ${PRIMARY_MODEL}`);
  console.log(`  Gemini API Status: ${configured ? '✓ Configured & Active' : '○ Standby (Local Fallback Active)'}`);
  console.log(`==================================================\n`);
});
