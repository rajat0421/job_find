const logger = (req, res, next) => {
  const start = Date.now();

  // Capture response body by patching res.json
  const originalJson = res.json.bind(res);
  let responseBody;
  res.json = (body) => {
    responseBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    const ms = Date.now() - start;
    const statusColor = res.statusCode < 300 ? '\x1b[32m' : res.statusCode < 400 ? '\x1b[33m' : '\x1b[31m';
    const reset = '\x1b[0m';
    const dim = '\x1b[2m';
    const cyan = '\x1b[36m';
    const yellow = '\x1b[33m';

    console.log(`\n${dim}${'─'.repeat(60)}${reset}`);

    // Request
    console.log(`${cyan}▶ ${req.method} ${req.originalUrl}${reset}  ${dim}${new Date().toLocaleTimeString()}${reset}`);
    if (Object.keys(req.body || {}).length) {
      const sanitized = { ...req.body };
      if (sanitized.password) sanitized.password = '***';
      console.log(`${yellow}  REQ BODY:${reset}`, JSON.stringify(sanitized, null, 2));
    }
    if (Object.keys(req.params || {}).length) {
      console.log(`${yellow}  REQ PARAMS:${reset}`, req.params);
    }
    if (Object.keys(req.query || {}).length) {
      console.log(`${yellow}  REQ QUERY:${reset}`, req.query);
    }

    // Response
    console.log(`${statusColor}◀ ${res.statusCode}${reset}  ${dim}${ms}ms${reset}`);
    if (responseBody !== undefined) {
      const sanitizedRes = JSON.parse(JSON.stringify(responseBody));
      if (sanitizedRes.token)    sanitizedRes.token    = '***';
      if (sanitizedRes.otp)      sanitizedRes.otp      = '***';
      if (sanitizedRes.password) sanitizedRes.password = '***';
      console.log(`${yellow}  RES BODY:${reset}`, JSON.stringify(sanitizedRes, null, 2));
    }
  });

  next();
};

module.exports = logger;
