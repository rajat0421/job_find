// In-memory stand-ins for User/Job/UserJob used by jobMatcher.service.js's
// Improvement 5 tests — faithful enough (find/sort/limit/select/populate,
// findById, findOne, insertMany, updateMany, bulkWrite) to run the real
// orchestration logic in jobMatcher.service.js end-to-end without a real
// MongoDB connection, while still being overridable per-test via the
// returned jest.fn()s (e.g. `Job.updateMany.mockRejectedValueOnce(...)`).

const matches = (doc, filter) =>
  Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.some((x) => x.toString() === (doc[k] || '').toString());
      if ('$ne' in v) return doc[k] !== v.$ne;
      if ('$nin' in v) return !v.$nin.includes(doc[k]);
    }
    return doc[k] === v;
  });

const createFakeCollection = () => {
  let store = [];
  let autoId = 0;

  // `populateMap` lets a specific collection (UserJob) resolve a reference
  // field (jobId/userId) into the full doc from another fake collection —
  // configured once via `__supportsPopulate` below, after all three
  // collections exist, so there's no circular construction issue.
  let populateMap = {};

  const resolveRefs = (docs, path) => {
    const other = populateMap[path];
    if (!other) return docs;
    return docs.map((d) => ({ ...d, [path]: other.__store().find((o) => o._id.toString() === (d[path] || '').toString()) || null }));
  };

  const makeQuery = (getResult) => {
    const q = {};
    let pendingPopulate = null;
    let pendingSort = null;
    let pendingLimit = null;
    q.sort = (spec) => { pendingSort = spec; return q; };
    q.limit = (n) => { pendingLimit = n; return q; };
    q.select = () => q;
    q.populate = (path) => { pendingPopulate = path; return q; };
    q.then = (resolve, reject) => {
      let result = getResult();
      if (pendingSort) {
        const [[field, dir]] = Object.entries(pendingSort);
        result = [...result].sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * dir);
      }
      if (pendingLimit != null) result = result.slice(0, pendingLimit);
      if (pendingPopulate) result = resolveRefs(result, pendingPopulate);
      return Promise.resolve(result).then(resolve, reject);
    };
    return q;
  };

  const find = jest.fn((filter = {}) => makeQuery(() => store.filter((d) => matches(d, filter))));
  const findById = jest.fn((id) => Promise.resolve(store.find((d) => d._id.toString() === id.toString()) || null));
  const findOne = jest.fn((filter = {}) => Promise.resolve(store.find((d) => matches(d, filter)) || null));
  const insertMany = jest.fn(async (docs) => {
    const saved = docs.map((d) => ({ _id: `gen_${autoId++}`, score: 0, matchedSkills: [], matchedRole: null, reasons: [], saved: false, applied: false, emailed: false, ...d }));
    store.push(...saved);
    return saved;
  });
  const updateMany = jest.fn(async (filter, update) => {
    const matched = store.filter((d) => matches(d, filter));
    matched.forEach((d) => Object.assign(d, update.$set || update));
    return { modifiedCount: matched.length };
  });
  const bulkWrite = jest.fn(async (ops) => {
    let count = 0;
    for (const { updateOne } of ops) {
      const doc = store.find((d) => d._id.toString() === updateOne.filter._id.toString());
      if (doc) { Object.assign(doc, updateOne.update.$set || updateOne.update); count++; }
    }
    return { modifiedCount: count };
  });
  const create = jest.fn(async (doc) => {
    const saved = { _id: `gen_${autoId++}`, ...doc };
    store.push(saved);
    return saved;
  });

  return {
    find, findById, findOne, insertMany, updateMany, bulkWrite, create,
    __store: () => store,
    __reset: (docs) => { store = [...docs]; },
    __supportsPopulate: (map) => { populateMap = map; },
  };
};

const User = createFakeCollection();
const Job = createFakeCollection();
const UserJob = createFakeCollection();
UserJob.__supportsPopulate({ jobId: Job, userId: User });

module.exports = { User, Job, UserJob, createFakeCollection };
