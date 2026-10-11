const mongoose = require('mongoose');

// One document per upstream HTTP request made by a job-ingestion provider
// adapter (Greenhouse/Lever/Ashby/Adzuna) — captured at the shared
// getWithRetry layer (services/httpClient.service.js) so every provider is
// traced the same way without touching each adapter's parsing logic. This is
// deliberately a SEPARATE collection from RequestLog (which logs INBOUND
// application traffic — user requests to this API, not outbound provider
// calls) and from FetchRun (which records per-cycle aggregate stats, not
// individual request/response evidence).
//
// Storage is intentionally bounded (see services/traceStorage.service.js):
// a TTL index below, a hard max-record count, and a global compressed-body
// byte budget are all enforced there, not just left to the TTL alone — TTL
// deletion is asynchronous (run by mongod roughly once a minute) and must
// never be treated as a synchronous/immediate cap.
const upstreamTraceSchema = new mongoose.Schema({
  traceId: { type: String, required: true, unique: true, index: true },

  provider: { type: String, required: true, enum: ['greenhouse', 'lever', 'ashby', 'adzuna'], index: true },
  operation: { type: String, required: true }, // e.g. 'list_jobs' (Greenhouse/Lever/Ashby), 'search' (Adzuna)
  boardToken: { type: String, default: null, index: true }, // company/board/category identifier, where applicable

  method: { type: String, default: 'GET' },
  url: { type: String, required: true }, // sanitized — credentials/secrets stripped before this is ever set (see traceRedaction.service.js)
  requestHeaders: { type: mongoose.Schema.Types.Mixed, default: {} }, // allowlisted-safe only
  requestBody: { type: mongoose.Schema.Types.Mixed, default: null }, // ingestion is GET-only today; present for forward-compatibility
  requestedAt: { type: Date, required: true }, // indexed below via the TTL index

  success: { type: Boolean, required: true },
  statusCode: { type: Number, default: null }, // null when no HTTP response was ever received (network/timeout failure)
  durationMs: { type: Number, required: true }, // total time including this call's own internal retries
  retries: { type: Number, default: 0 },
  respondedAt: { type: Date, default: null },
  responseHeaders: { type: mongoose.Schema.Types.Mixed, default: {} }, // allowlisted-safe only (content-type, rate-limit headers, etc.)
  errorKind: { type: String, default: null }, // httpClient.service.js's classifyError() reason, or null on success
  errorMessage: { type: String, default: null }, // short, sanitized summary only — never a raw stack trace or URL

  // Body capture — see traceStorage.service.js for exactly how each state is decided.
  bodyCaptureStatus: { type: String, enum: ['complete', 'truncated', 'omitted', 'none'], default: 'none' },
  bodyOmittedReason: { type: String, default: null }, // e.g. 'exceeds_max_body_size', 'exceeds_storage_budget', 'not_json', 'write_error'
  bodyOriginalSize: { type: Number, default: null }, // bytes, pre-compression, of the (redacted) JSON actually considered for storage
  bodyStoredSize: { type: Number, default: null }, // bytes actually stored (post-gzip)
  bodyGzip: { type: Buffer, default: null }, // gzip-compressed, redacted, valid-JSON text; parse after gunzip
  bodyIsArray: { type: Boolean, default: false }, // top-level shape hint so the UI/extraction logic doesn't need to decompress just to know this
  bodyItemCount: { type: Number, default: null }, // number of job-like items in the response, when recognizable — kept even if the body itself is omitted/truncated

  // Correlation — populated by a best-effort, non-blocking follow-up query
  // after the provider adapter finishes processing this response (see
  // services/traceCorrelation.service.js). Indexed so "find the trace(s) for
  // this upstream job ID" and "find the trace for this internal Job _id"
  // are both efficient point lookups, never a collection scan or a
  // decompress-and-search over stored bodies.
  observedSourceJobIds: { type: [String], default: [], index: true },
  resultingJobIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'Job', default: [], index: true },
}, { timestamps: true });

// TTL — the retention backstop. Deliberately NOT the only storage control
// (see the module comment above and traceStorage.service.js's count/budget
// enforcement) since TTL deletion is asynchronous and can lag well behind
// the configured retention window under load.
upstreamTraceSchema.index({ requestedAt: 1 }, { expireAfterSeconds: Number(process.env.TRACE_RETENTION_DAYS || 7) * 24 * 60 * 60 });

// Supports the trace-list page's default filters/sort (newest first, by
// provider) without a collection scan.
upstreamTraceSchema.index({ provider: 1, requestedAt: -1 });
upstreamTraceSchema.index({ success: 1, requestedAt: -1 });

module.exports = mongoose.model('UpstreamTrace', upstreamTraceSchema);
