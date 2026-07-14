const express = require('express');
const multer = require('multer');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { uploadResume, getResume, confirmResume, deleteResume } = require('../controllers/resume.controller');

// In-memory upload: 5 MB cap, PDF/DOCX only (enforced here + in the extractor)
const ALLOWED = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const okName = /\.(pdf|docx)$/i.test(file.originalname || '');
    if (ALLOWED.has(file.mimetype) || okName) return cb(null, true);
    cb(new Error('Only PDF and DOCX files are supported'));
  },
});

// Wrap multer so its errors (size/type) return clean JSON instead of a 500
const uploadMiddleware = (req, res, next) =>
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 5 MB limit' : err.message;
      return res.status(400).json({ message: msg });
    }
    next();
  });

router.post('/upload', protect, uploadMiddleware, uploadResume);
router.get('/', protect, getResume);
router.put('/confirm', protect, confirmResume);
router.delete('/', protect, deleteResume);

module.exports = router;
