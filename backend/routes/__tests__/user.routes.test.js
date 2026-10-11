// Guards that the simplified account-deletion flow didn't loosen routing —
// DELETE /account (and every other self-service user route) must still sit
// behind the same `protect` middleware as before. Inspecting the router
// stack (same technique as admin.routes.test.js) proves this without
// needing supertest/a running server.

jest.mock('../../controllers/user.controller', () => new Proxy({}, { get: () => jest.fn() }));

const { protect } = require('../../middleware/auth.middleware');
const router = require('../user.routes');

test('every user route, including DELETE /account, is gated by the same protect middleware', () => {
  const routeLayers = router.stack.filter((l) => l.route);
  expect(routeLayers.length).toBeGreaterThan(0);

  for (const layer of routeLayers) {
    const handlers = layer.route.stack.map((s) => s.handle);
    expect(handlers[0]).toBe(protect);
  }
});

test('DELETE /account is registered on this protected router', () => {
  const deleteLayer = router.stack.find((l) => l.route?.path === '/account' && l.route.methods.delete);
  expect(deleteLayer).toBeDefined();
  expect(deleteLayer.route.stack[0].handle).toBe(protect);
});
