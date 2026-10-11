// Guards the one piece of logic every self-service endpoint (including the
// simplified DELETE /user/account flow) relies on for "who is making this
// request": protect() must reject anything without a valid, verifiable JWT,
// and must never call next() in that case — next() is what hands control to
// a controller like deleteAccount, so it must be unreachable without a real
// session.

jest.mock('jsonwebtoken', () => ({ verify: jest.fn() }));

const jwt = require('jsonwebtoken');
const { protect } = require('../auth.middleware');

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

beforeEach(() => jest.clearAllMocks());

test('rejects a request with no Authorization header at all', () => {
  const req = { headers: {} };
  const res = mockRes();
  const next = jest.fn();

  protect(req, res, next);

  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(401);
});

test('rejects a non-Bearer Authorization header', () => {
  const req = { headers: { authorization: 'Basic abc123' } };
  const res = mockRes();
  const next = jest.fn();

  protect(req, res, next);

  expect(jwt.verify).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(401);
});

test('rejects a Bearer token that fails verification, and never sets req.user', () => {
  jwt.verify.mockImplementation(() => { throw new Error('bad signature'); });
  const req = { headers: { authorization: 'Bearer not-a-real-token' } };
  const res = mockRes();
  const next = jest.fn();

  protect(req, res, next);

  expect(next).not.toHaveBeenCalled();
  expect(req.user).toBeUndefined();
  expect(res.status).toHaveBeenCalledWith(401);
});

test('a valid token sets req.user from the verified payload and calls next()', () => {
  jwt.verify.mockReturnValue({ id: 'u1' });
  const req = { headers: { authorization: 'Bearer good-token' } };
  const res = mockRes();
  const next = jest.fn();

  protect(req, res, next);

  expect(req.user).toEqual({ id: 'u1' });
  expect(next).toHaveBeenCalledTimes(1);
  expect(res.status).not.toHaveBeenCalled();
});
