const ResumeProfile = require('../models/ResumeProfile');
const { sha256 } = require('./hash.service');
const { detectType, extractText } = require('./textExtractor.service');
const { generateStructured, MODEL } = require('./ai.service');
const { normalizeParsed } = require('./resumeNormalizer.service');

const PROMPT_VERSION = 'v1';

// Structured-output schema for Gemini (GenAI responseSchema format).
const RESUME_SCHEMA = {
  type: 'object',
  properties: {
    name:            { type: 'string' },
    email:           { type: 'string' },
    phone:           { type: 'string' },
    summary:         { type: 'string' },
    skills:          { type: 'array', items: { type: 'string' } },
    desiredRoles:    { type: 'array', items: { type: 'string' } },
    experienceYears: { type: 'number' },
    education:       { type: 'array', items: { type: 'string' } },
    certifications:  { type: 'array', items: { type: 'string' } },
    projects:        { type: 'array', items: { type: 'string' } },
    companies:       { type: 'array', items: { type: 'string' } },
    locations:       { type: 'array', items: { type: 'string' } },
    languages:       { type: 'array', items: { type: 'string' } },
    tools:           { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'skills', 'experienceYears'],
};

const buildPrompt = (rawText) => `You are a precise resume parser. Extract structured data from the resume text below.
Rules:
- Return ONLY data present or directly inferable from the text. Do not invent facts.
- skills/tools: individual technologies, languages, frameworks (not sentences).
- desiredRoles: target job titles the candidate is suited for (max 3). If unclear, leave empty.
- experienceYears: total years of professional experience as a number (0 if fresher/student).
- education: degree + institution strings. projects: short project titles.
- companies: past employers. locations: cities/regions the candidate is in or open to.

RESUME TEXT:
"""
${rawText.slice(0, 20000)}
"""`;

/**
 * Parse an uploaded resume for a user. Uses a per-user cache keyed by file hash
 * so re-uploading the same resume (same prompt version) skips the AI call.
 * Always creates a new ResumeProfile document (history preserved).
 *
 * @returns {Promise<ResumeProfile>} the saved (status:'parsed') document
 */
const parseResume = async ({ userId, buffer, mimetype, originalname }) => {
  const fileType = detectType(mimetype, originalname);
  if (!fileType) {
    const err = new Error('Only PDF and DOCX files are supported');
    err.status = 400;
    throw err;
  }

  const rawText = await extractText(buffer, fileType); // throws friendly errors
  const resumeHash = sha256(buffer);

  // Per-user cache: reuse a prior parse of the same file + prompt version
  const cached = await ResumeProfile.findOne({ userId, resumeHash, promptVersion: PROMPT_VERSION }).sort({ createdAt: -1 });

  let parsedJson;
  let aiModel;
  let fromCache = false;

  if (cached) {
    parsedJson = cached.parsedJson;
    aiModel = cached.aiModel;
    fromCache = true;
  } else {
    const { data, model } = await generateStructured(buildPrompt(rawText), RESUME_SCHEMA);
    parsedJson = normalizeParsed(data);
    aiModel = model;
  }

  return ResumeProfile.create({
    userId,
    resumeHash,
    fileName: originalname || '',
    fileType,
    rawText,
    parsedJson,
    aiModel,
    promptVersion: PROMPT_VERSION,
    fromCache,
    status: 'parsed',
  });
};

module.exports = { parseResume, PROMPT_VERSION, RESUME_SCHEMA };
