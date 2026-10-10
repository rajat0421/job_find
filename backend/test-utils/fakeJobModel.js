// A minimal in-memory stand-in for the Job Mongoose model, used by the
// jobLifecycle/platform-adapter tests. Mimics just enough of the Mongoose
// query surface (findOne/find().select()/create/updateOne/updateMany with
// $eq/$ne/$in matching) to exercise jobLifecycle.service.js's actual logic
// end-to-end without a real MongoDB connection.

const matches = (doc, query) =>
  Object.entries(query).every(([key, cond]) => {
    if (key === '$or') return cond.some((sub) => matches(doc, sub));
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$ne' in cond) return doc[key] !== cond.$ne;
      if ('$in' in cond) return cond.$in.includes(doc[key]);
      if ('$lt' in cond) return doc[key] instanceof Date ? doc[key].getTime() < cond.$lt.getTime() : doc[key] < cond.$lt;
    }
    return doc[key] === cond;
  });

const createFakeJobModel = () => {
  const store = [];
  let autoId = 1;

  return {
    __store: store,

    findOne: jest.fn((query = {}) => {
      const result = store.find((d) => matches(d, query)) || null;
      const thenable = Promise.resolve(result);
      thenable.select = () => thenable; // mimic Mongoose's chainable-and-thenable Query
      return thenable;
    }),

    find: jest.fn((query = {}) => {
      const result = store.filter((d) => matches(d, query));
      return {
        select: () => Promise.resolve(result),
        sort: () => ({ limit: () => Promise.resolve(result) }),
      };
    }),

    create: jest.fn(async (doc) => {
      const saved = {
        _id: `id${autoId++}`,
        missingScans: 0,
        status: 'active',
        sourceBoard: null,
        sourceJobId: null,
        ...doc,
      };
      store.push(saved);
      return saved;
    }),

    updateOne: jest.fn(async (filter, update) => {
      const doc = store.find((d) => matches(d, filter));
      if (doc) Object.assign(doc, update.$set || update);
      return { matchedCount: doc ? 1 : 0 };
    }),

    updateMany: jest.fn(async (filter, update) => {
      const matched = store.filter((d) => matches(d, filter));
      matched.forEach((d) => Object.assign(d, update.$set || update));
      return { modifiedCount: matched.length };
    }),
  };
};

module.exports = { createFakeJobModel };
