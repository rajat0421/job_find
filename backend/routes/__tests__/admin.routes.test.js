// Guards Improvement 6's requirement that the new diagnostics/analytics
// endpoints stay behind the SAME admin authentication as every other admin
// route — not a parallel, possibly-forgotten auth check. admin.routes.js
// applies `router.use(isAdmin)` once, before any route is registered, so
// proving that layer is isAdmin (by reference) proves every route added
// after it — including /diagnostics and /analytics — inherits it.

jest.mock('../../controllers/admin.controller', () => new Proxy({}, { get: () => jest.fn() }));
jest.mock('../../controllers/feedback.controller', () => new Proxy({}, { get: () => jest.fn() }));

const { isAdmin } = require('../../middleware/admin.middleware');
const router = require('../admin.routes');

test('isAdmin is registered as the first layer of the admin router, ahead of every route', () => {
  const firstLayer = router.stack[0];
  expect(firstLayer.handle).toBe(isAdmin);
  expect(firstLayer.route).toBeUndefined(); // a router.use(), not a specific path — applies to everything after it
});

test('the new diagnostics and analytics routes are registered on this same protected router', () => {
  const paths = router.stack.filter((l) => l.route).map((l) => l.route.path);
  expect(paths).toEqual(expect.arrayContaining(['/diagnostics', '/analytics']));
});
