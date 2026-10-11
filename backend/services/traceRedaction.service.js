// Centralized redaction for upstream API traces (services/httpClient.service.js
// via traceStorage.service.js). Everything persisted to UpstreamTrace passes
// through here FIRST — this is the one place that decides what's safe to
// store, so no individual call site has to get it right on its own.
//
// Threat model: these are outbound requests to PUBLIC job-board APIs
// (Greenhouse/Lever/Ashby are unauthenticated; Adzuna carries its app_id/
// app_key as query-string credentials). None of this traffic is expected to
// carry user PII or payment data — but "expected" is not a safety guarantee,
// so every layer below is defensive by default (allowlist headers, redact by
// field-name pattern) rather than trusting the specific provider.

// Headers worth keeping for debugging; everything else is dropped, not just
// Authorization/Cookie — an allowlist is safer than a blocklist here, since a
// blocklist only protects against sensitive header names we thought of.
const REQUEST_HEADER_ALLOWLIST = new Set(['accept', 'accept-encoding', 'content-type', 'user-agent']);
const RESPONSE_HEADER_ALLOWLIST = new Set([
  'content-type', 'content-length', 'content-encoding', 'date', 'etag', 'last-modified',
  'cache-control', 'retry-after', 'x-request-id',
  'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
  'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset',
]);

const sanitizeHeaders = (headers, allowlist) => {
  const out = {};
  if (!headers) return out;
  for (const [key, value] of Object.entries(headers)) {
    if (allowlist.has(key.toLowerCase())) out[key] = value;
  }
  return out;
};

// Query/URL param names that must never have their VALUE persisted, even
// though the key name itself is useful for understanding what the request
// looked like (e.g. "app_id=[REDACTED]" is more informative for debugging
// than silently dropping the param, while still never storing the secret).
// A contains-match (see SENSITIVE_FIELD_NAME_RE's comment for why) — catches
// "app_id"/"app_key" (Adzuna's actual credentials) as well as compound names
// like "oauth_token" without needing an exhaustive exact-name list.
const SENSITIVE_PARAM_NAME_RE = /(app[_-]?id|app[_-]?key|api[_-]?key|access[_-]?token|authorization|token|secret|password|client[_-]?secret|session|credential)/i;

// Removes sensitive query-string VALUES from a URL before it's ever stored —
// this is the fix for Adzuna specifically, whose credentials are passed as
// query params (app_id/app_key), not headers. Falls back to returning the
// input unchanged if it isn't a parseable URL (never throws on malformed input).
const sanitizeUrl = (rawUrl) => {
  try {
    const u = new URL(rawUrl);
    for (const key of [...u.searchParams.keys()]) {
      if (SENSITIVE_PARAM_NAME_RE.test(key)) u.searchParams.set(key, '[REDACTED]');
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
};

// Same param-name check, for config.params objects (axios builds the final
// URL from `url` + `params` — both are sanitized independently so neither
// path can leak a credential).
const sanitizeParams = (params) => {
  if (!params || typeof params !== 'object') return params;
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = SENSITIVE_PARAM_NAME_RE.test(key) ? '[REDACTED]' : value;
  }
  return out;
};

// Field names that must never have their VALUE persisted, wherever they
// appear in a JSON request/response body, at any nesting depth. Intentionally
// a CONTAINS match (not anchored to the whole field name) so compound names
// like "auth_token", "my_api_key", or "oauth_client_secret" are all caught —
// not just an exact "token"/"secret"/"apiKey". Deliberately does NOT include
// a bare "auth" or "key" substring, which would false-positive on innocuous
// job-data field names like "author" or "keywords".
const SENSITIVE_FIELD_NAME_RE = /(password|passwd|secret|token|api[_-]?key|apikey|authorization|session[_-]?id|\bcookie\b|credential|\bssn\b|social[_-]?security|credit[_-]?card|card[_-]?number|\bcvv\b|private[_-]?key)/i;

// Bounds recursion for defensive reasons (a pathological or adversarial
// response shouldn't be able to exhaust the call stack) — real job-board
// payloads never nest anywhere near this deep.
const MAX_REDACT_DEPTH = 12;

// Recursively redacts a parsed JSON value (object/array/primitive) by FIELD
// NAME, not by guessing at value shape — a field called "password" is
// redacted even if its value happens to look like a normal string, and a
// field called "title" is never touched even if its value coincidentally
// looks sensitive. This is what keeps real job content (titles, descriptions,
// locations, salaries) fully intact while still catching anything that looks
// like a credential.
const redactValue = (value, depth = 0) => {
  if (depth > MAX_REDACT_DEPTH) return '[REDACTED:max-depth]';
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SENSITIVE_FIELD_NAME_RE.test(key) ? '[REDACTED]' : redactValue(v, depth + 1);
    }
    return out;
  }
  return value; // primitive — left as-is
};

// Public API: redact a captured request before it's ever written to the DB.
const redactRequest = ({ url, params, headers, body } = {}) => ({
  url: url ? sanitizeUrl(url) : url,
  params: sanitizeParams(params),
  headers: sanitizeHeaders(headers, REQUEST_HEADER_ALLOWLIST),
  body: body != null ? redactValue(body) : null,
});

// Public API: redact a captured response before it's ever written to the DB.
const redactResponse = ({ headers, body } = {}) => ({
  headers: sanitizeHeaders(headers, RESPONSE_HEADER_ALLOWLIST),
  body: body != null ? redactValue(body) : null,
});

// Defense in depth for free-text error messages (e.g. axios error.message),
// which aren't structured JSON but could still embed a "key=value"-shaped
// credential if a URL or query string ever ends up inside one. Also caps
// length so a pathological/huge message can't bloat a trace document.
const sanitizeErrorMessage = (message) => {
  if (!message) return message;
  const redacted = String(message).replace(
    /([?&](?:app_id|app_key|api[_-]?key|access[_-]?token|auth|authorization|token|secret|password|client[_-]?secret|session|credential)s?=)[^&\s]+/gi,
    '$1[REDACTED]'
  );
  return redacted.length > 500 ? `${redacted.slice(0, 500)}…` : redacted;
};

module.exports = {
  redactRequest,
  redactResponse,
  sanitizeUrl,
  sanitizeErrorMessage,
  sanitizeParams,
  sanitizeHeaders,
  redactValue,
  REQUEST_HEADER_ALLOWLIST,
  RESPONSE_HEADER_ALLOWLIST,
  SENSITIVE_PARAM_NAME_RE,
  SENSITIVE_FIELD_NAME_RE,
};
