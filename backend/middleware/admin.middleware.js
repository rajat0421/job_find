const isAdmin = (req, res, next) => {
  const token = req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ message: 'Invalid admin token' });
  }
  next();
};

module.exports = { isAdmin };
