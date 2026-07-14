const OpenAI = require('openai');

// Provider-agnostic AI layer. OpenRouter is OpenAI-compatible, so swapping to a
// paid model later (Claude / GPT / Gemini / DeepSeek …) is just an env change:
//   OPENROUTER_API_KEY=sk-or-v1-...
//   AI_MODEL=deepseek/deepseek-chat-v3-0324:free   (or anthropic/claude-..., openai/gpt-..., etc.)
const MODEL = process.env.AI_MODEL || 'google/gemma-4-26b-a4b-it:free';
const DEFAULT_TIMEOUT_MS = 45000;

let client = null;
const getClient = () => {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not set');
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      // Optional attribution headers OpenRouter recommends
      defaultHeaders: {
        'HTTP-Referer': process.env.FRONTEND_URL || 'https://job-find-chi.vercel.app',
        'X-Title': 'JobFind',
      },
    });
  }
  return client;
};

// Strip ```json … ``` fences some models wrap around JSON output
const stripFences = (s) => s.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

// Turn a JSON-schema-ish object into a short field hint for the prompt (json_object
// mode doesn't enforce a schema, so we describe the expected shape explicitly).
const schemaHint = (schema) => {
  if (!schema?.properties) return '';
  const fields = Object.entries(schema.properties)
    .map(([k, v]) => `"${k}": ${v.type === 'array' ? 'string[]' : v.type}`)
    .join(', ');
  return `\n\nReturn a single JSON object with exactly these fields: { ${fields} }. Use empty string/array/0 when unknown.`;
};

/**
 * Generic structured-output call — reusable for future AI features
 * (ATS score, resume↔job match, cover letters, etc.).
 *
 * @param {string} prompt         Instruction + content (e.g. resume text)
 * @param {object} responseSchema JSON-schema-ish shape used to guide + validate output
 * @param {object} [opts]         { timeoutMs, retries, model }
 * @returns {Promise<{data: object, model: string}>}
 */
const generateStructured = async (prompt, responseSchema, opts = {}) => {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 1, model = MODEL } = opts;
  const ai = getClient();

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const completion = await ai.chat.completions.create(
        {
          model,
          messages: [
            { role: 'system', content: 'You are a precise data-extraction engine. Respond with a single valid JSON object only — no markdown, no code fences, no commentary.' },
            { role: 'user', content: prompt + schemaHint(responseSchema) },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        },
        { timeout: timeoutMs }
      );

      const content = completion.choices?.[0]?.message?.content;
      if (!content) throw new Error('Empty response from the AI model');
      return { data: JSON.parse(stripFences(content)), model };
    } catch (err) {
      lastErr = err;
      const status = err.status || err.response?.status;
      if (status === 429) throw new Error('AI is rate-limited right now — please try again in a minute');
      if (err.name === 'APIConnectionTimeoutError' || /timeout/i.test(err.message || '')) {
        throw new Error('The AI took too long to respond — please try again');
      }
      // JSON parse / transient → retry once, then fail
    }
  }
  throw new Error(`AI parsing failed: ${lastErr?.message || 'unknown error'}`);
};

module.exports = { generateStructured, MODEL };
