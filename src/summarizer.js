const https = require('https');

// Fallback models in priority order for resilience against high-demand spikes
const MODELS = [
  'models/gemini-3.6-flash',
  'models/gemini-3.5-flash-lite',
  'models/gemini-3.5-flash',
  'models/gemini-3.1-flash-lite',
  'models/gemini-flash-latest'
];

async function callGemini(model, payload, apiKey) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, parsed });
        } catch (e) {
          resolve({ status: res.statusCode, error: e.message });
        }
      });
    });

    req.on('error', (err) => resolve({ error: err.message }));
    req.setTimeout(25000, () => {
      req.destroy();
      resolve({ error: 'timeout' });
    });
    req.write(payload);
    req.end();
  });
}

/**
 * Sends a transcript to Gemini with model fallback and returns a structured summary.
 * @param {string} transcript 
 * @param {string} apiKey 
 * @param {string} [preferredModel]
 * @returns {Promise<string>}
 */
async function summarizeMeetingFeed(transcript, apiKey, preferredModel) {
  if (!apiKey) {
    return 'Gemini API Key not configured. Unable to generate summary.';
  }

  if (!transcript || transcript.trim().length === 0) {
    return 'No questions or chat messages were recorded in this session.';
  }

  const prompt = 
`You are an assistant summarizing a Zoom Webinar.
Analyze the following transcript of Webinar Questions, Answers, and Chat messages.
Provide a clean, concise, direct summary in Telegram HTML format (use <b>, <i>, <code>, <a> tags).
Do not use emojis.

Sections:
1. <b>Key Announcements and Updates</b> (Deadlines, instructions from mentors/host)
2. <b>Important Links and Resources</b> (Forms, groups, portal URLs, course links - format with HTML links)
3. <b>Frequently Asked Questions and Answers</b> (Top questions asked and answers provided)

Transcript:
${transcript}`;

  const payload = JSON.stringify({
    contents: [{
      parts: [{ text: prompt }]
    }]
  });

  // Prepare model priority list with user's preferred model first
  const normalizedPreferred = preferredModel 
    ? (preferredModel.startsWith('models/') ? preferredModel : `models/${preferredModel}`)
    : null;

  const candidateModels = normalizedPreferred
    ? [normalizedPreferred, ...MODELS.filter(m => m !== normalizedPreferred)]
    : MODELS;

  for (const model of candidateModels) {
    console.log(`[Summarizer] Attempting generation with ${model}...`);
    const res = await callGemini(model, payload, apiKey);
    if (res.status === 200 && res.parsed?.candidates?.[0]?.content?.parts?.[0]?.text) {
      return res.parsed.candidates[0].content.parts[0].text;
    }
    console.warn(`[Summarizer] ${model} unavailable (status ${res.status || res.error}). Trying next...`);
  }

  return 'All Gemini models are currently under heavy load. Please try /summary again in a moment.';
}

module.exports = {
  summarizeMeetingFeed
};
