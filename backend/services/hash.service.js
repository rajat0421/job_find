const crypto = require('crypto');

// SHA-256 of a file buffer — used as the per-user parse cache key so re-uploading
// the same resume skips the (paid) AI call.
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

module.exports = { sha256 };
