/**
 * Validate ATS board tokens by hitting each provider's public API and keeping
 * only the ones that return jobs. Use this to bulk-verify candidate companies
 * before adding them to the board lists (or seeding the Company collection).
 *
 * Usage:
 *   node scripts/validate-boards.js greenhouse stripe airbnb figma ...
 *   node scripts/validate-boards.js lever meesho cred spotify ...
 *   node scripts/validate-boards.js ashby OpenAI Ramp Notion ...
 *
 * Or pipe a newline/space separated candidate file:
 *   node scripts/validate-boards.js greenhouse < candidates.txt
 *
 * Prints, for each live token:  <token>  <jobCount>
 * and a copy-paste-ready JSON array of the winners at the end.
 */
const axios = require('axios');

const PROVIDERS = {
  greenhouse: {
    url: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs`,
    count: (data) => (Array.isArray(data.jobs) ? data.jobs.length : 0),
  },
  lever: {
    url: (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,
    count: (data) => (Array.isArray(data) ? data.length : 0),
  },
  ashby: {
    url: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}`,
    count: (data) => (Array.isArray(data.jobs) ? data.jobs.length : 0),
  },
};

const CONCURRENCY = 8;

async function readStdin() {
  if (process.stdin.isTTY) return [];
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data.split(/\s+/).filter(Boolean);
}

async function probe(provider, token) {
  const p = PROVIDERS[provider];
  try {
    const res = await axios.get(p.url(token), { timeout: 8000 });
    return { token, count: p.count(res.data) };
  } catch {
    return { token, count: 0 };
  }
}

async function run() {
  const [, , provider, ...cliTokens] = process.argv;
  if (!PROVIDERS[provider]) {
    console.error(`Usage: node scripts/validate-boards.js <${Object.keys(PROVIDERS).join('|')}> <token...>`);
    process.exit(1);
  }

  const stdinTokens = await readStdin();
  const tokens = [...new Set([...cliTokens, ...stdinTokens])];
  if (!tokens.length) {
    console.error('No candidate tokens provided (pass as args or via stdin).');
    process.exit(1);
  }

  console.error(`Probing ${tokens.length} ${provider} tokens...\n`);

  const live = [];
  for (let i = 0; i < tokens.length; i += CONCURRENCY) {
    const batch = tokens.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((t) => probe(provider, t)));
    for (const r of results) {
      if (r.count > 0) {
        live.push(r);
        console.error(`  ✓ ${r.token} (${r.count})`);
      }
    }
  }

  live.sort((a, b) => b.count - a.count);
  console.error(`\n${live.length}/${tokens.length} live. Copy-paste:\n`);
  console.log(JSON.stringify(live.map((l) => l.token)));
}

run().catch((e) => { console.error(e); process.exit(1); });
