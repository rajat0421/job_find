const mongoose = require('mongoose');
const UpstreamTrace = require('../models/UpstreamTrace');
const TraceStorageStats = require('../models/TraceStorageStats');
const { decompressBody, extractJobList } = require('../services/traceStorage.service');
const { getOperationalOverview } = require('../services/monitoring.service');

// Kept entirely separate from admin.controller.js's job/matching endpoints
// (Phase 8) — this file owns upstream-trace administration only: listing,
// detail retrieval + decompression, raw-job extraction, and the lightweight
// operational overview. It never creates traces itself (that happens only in
// services/httpClient.service.js, at the point a request is actually made).

const MAX_LIST_LIMIT = 100;
const VALID_PROVIDERS = new Set(['greenhouse', 'lever', 'ashby', 'adzuna']);

// Never excludes a param as invalid by silently ignoring it — an admin
// debugging a specific incident needs to know their filter was rejected, not
// see an unfiltered list and assume the filter just matched everything.
const parseListQuery = (query) => {
  const errors = [];

  let page = 1;
  if (query.page !== undefined) {
    page = parseInt(query.page, 10);
    if (!Number.isInteger(page) || page < 1) errors.push('page must be a positive integer');
  }

  let limit = 20;
  if (query.limit !== undefined) {
    limit = parseInt(query.limit, 10);
    if (!Number.isInteger(limit) || limit < 1) errors.push('limit must be a positive integer');
  }
  limit = Math.min(limit || 20, MAX_LIST_LIMIT);

  const filter = {};
  if (query.provider !== undefined) {
    if (!VALID_PROVIDERS.has(query.provider)) errors.push(`provider must be one of: ${[...VALID_PROVIDERS].join(', ')}`);
    else filter.provider = query.provider;
  }
  if (query.success !== undefined) {
    if (query.success !== 'true' && query.success !== 'false') errors.push('success must be "true" or "false"');
    else filter.success = query.success === 'true';
  }
  if (query.statusCode !== undefined) {
    const sc = parseInt(query.statusCode, 10);
    if (!Number.isInteger(sc)) errors.push('statusCode must be an integer');
    else filter.statusCode = sc;
  }
  if (query.traceId !== undefined) {
    if (typeof query.traceId !== 'string' || !query.traceId.trim()) errors.push('traceId must be a non-empty string');
    else filter.traceId = query.traceId.trim();
  }
  if (query.jobId !== undefined) {
    const jobId = String(query.jobId).trim();
    if (!jobId) errors.push('jobId must be a non-empty string');
    // A 24-char hex string is treated as an internal Mongo Job _id; anything
    // else is treated as an upstream provider job ID — both are indexed
    // array fields, so either lookup is a bounded, efficient point query.
    else if (mongoose.isValidObjectId(jobId) && /^[0-9a-fA-F]{24}$/.test(jobId)) filter.resultingJobIds = jobId;
    else filter.observedSourceJobIds = jobId;
  }
  if (query.from !== undefined || query.to !== undefined) {
    filter.requestedAt = {};
    if (query.from !== undefined) {
      const from = new Date(query.from);
      if (Number.isNaN(from.getTime())) errors.push('from must be a valid date');
      else filter.requestedAt.$gte = from;
    }
    if (query.to !== undefined) {
      const to = new Date(query.to);
      if (Number.isNaN(to.getTime())) errors.push('to must be a valid date');
      else filter.requestedAt.$lte = to;
    }
  }

  return { page, limit, filter, errors };
};

// GET /api/admin/traces — paginated, filtered trace list. Never returns the
// compressed body (bodyGzip) or raw request/response bodies here — those are
// loaded only when a single trace is opened (Phase 7), keeping this list
// endpoint cheap regardless of how large individual captured bodies are.
const listTraces = async (req, res) => {
  const { page, limit, filter, errors } = parseListQuery(req.query);
  if (errors.length) return res.status(400).json({ message: 'Invalid query', errors });

  try {
    const skip = (page - 1) * limit;
    const [total, traces] = await Promise.all([
      UpstreamTrace.countDocuments(filter),
      UpstreamTrace.find(filter)
        .sort({ requestedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-bodyGzip -requestBody')
        .lean(),
    ]);
    res.json({ traces, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/admin/traces/:traceId — full detail, including the decompressed
// (and already-redacted-at-write-time) body, when one was captured.
const getTraceDetail = async (req, res) => {
  try {
    const trace = await UpstreamTrace.findOne({ traceId: req.params.traceId }).lean();
    if (!trace) return res.status(404).json({ message: 'Trace not found' });

    const body = trace.bodyCaptureStatus === 'complete' || trace.bodyCaptureStatus === 'truncated'
      ? decompressBody(trace)
      : null;

    const { bodyGzip, ...rest } = trace;
    res.json({
      ...rest,
      body,
      bodyNotice:
        trace.bodyCaptureStatus === 'truncated' ? 'Partial capture — only a subset of this response\'s items was retained (see _originalCount/_keptCount in the body).'
        : trace.bodyCaptureStatus === 'omitted' ? `Body not retained (${trace.bodyOmittedReason || 'unknown reason'}).`
        : trace.bodyCaptureStatus === 'none' ? 'No response body was captured for this request.'
        : null,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/admin/traces/:traceId/jobs/:upstreamJobId — extract one raw job
// object from a captured list response, for comparing against the current
// normalized Job document (Phase 4). Every field in the response is explicit
// about provenance — this never fabricates or reconstructs anything; it only
// ever returns data that was genuinely present in a captured response.
const getRawJobFromTrace = async (req, res) => {
  try {
    const trace = await UpstreamTrace.findOne({ traceId: req.params.traceId }).lean();
    if (!trace) return res.status(404).json({ message: 'Trace not found', found: false });

    if (trace.bodyCaptureStatus !== 'complete' && trace.bodyCaptureStatus !== 'truncated') {
      return res.json({
        found: false,
        reason: trace.bodyCaptureStatus === 'omitted' ? 'body_omitted' : 'no_body_captured',
        message: 'The raw response body for this trace was not retained, so no individual job object can be extracted from it.',
      });
    }

    const body = decompressBody(trace);
    const { list } = extractJobList(body);
    const upstreamJobId = String(req.params.upstreamJobId);
    const job = list?.find((item) => item && String(item.id) === upstreamJobId) || null;

    if (!job) {
      return res.json({
        found: false,
        reason: trace.bodyCaptureStatus === 'truncated' ? 'item_not_in_truncated_subset' : 'item_not_in_response',
        message: trace.bodyCaptureStatus === 'truncated'
          ? 'This response was only partially captured, and the requested job was not among the retained items.'
          : 'The requested upstream job ID was not found in this captured response.',
      });
    }

    res.json({
      found: true,
      extractedFrom: trace.bodyCaptureStatus === 'truncated' ? 'truncated_capture' : 'captured_response',
      traceId: trace.traceId,
      capturedAt: trace.requestedAt,
      job, // the exact object as it appeared in the captured upstream response — never reconstructed
      provenance: `Extracted verbatim from the upstream response captured by trace ${trace.traceId} at ${new Date(trace.requestedAt).toISOString()}. This is NOT a live re-fetch.`,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/admin/overview — the new, focused Overview page's single data
// source. Reuses getOperationalOverview() (already used by the existing
// Analytics page — see services/monitoring.service.js) rather than
// re-deriving the same fetch/match/email health from scratch, plus adds
// request-level recent failures from the new trace collection (bounded,
// index-covered — see UpstreamTrace's {success,requestedAt} index) for finer
// granularity than FetchRun's aggregate errorSummary strings alone provide.
const getOverview = async (req, res) => {
  try {
    const [overview, recentErrors, traceStorage] = await Promise.all([
      getOperationalOverview(),
      UpstreamTrace.find({ success: false })
        .sort({ requestedAt: -1 })
        .limit(20)
        .select('traceId provider operation boardToken statusCode errorKind errorMessage durationMs requestedAt')
        .lean(),
      TraceStorageStats.findById('singleton').lean(),
    ]);

    res.json({
      ...overview,
      recentErrors,
      traceStorage: traceStorage || { totalRecords: 0, totalStoredBytes: 0 },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { listTraces, getTraceDetail, getRawJobFromTrace, getOverview };
