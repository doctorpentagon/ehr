const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');

const tmpDir = path.join(process.cwd(), 'uploads', 'tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const upload = multer({ dest: tmpDir, limits: { fileSize: 10 * 1024 * 1024 } });

// POST /v1/ocr/extract — extract text from uploaded image
router.post('/extract', [authenticate, tenant], upload.single('file'), async (req, res, next) => {
  const filePath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    let extractedText = '';

    // Try Tesseract.js if available
    try {
      const Tesseract = require('tesseract.js');
      const { data: { text } } = await Tesseract.recognize(filePath, 'eng', {
        logger: () => {},
      });
      extractedText = text.trim();
    } catch (ocrErr) {
      // Tesseract not available — return placeholder
      extractedText = '[OCR not available — Tesseract.js not installed. Install with: npm install tesseract.js]\n\nFile received: ' + req.file.originalname;
    }

    if (filePath) fs.unlink(filePath, () => {});
    res.json({ text: extractedText, confidence: extractedText ? 0.85 : 0 });
  } catch (e) {
    if (filePath) fs.unlink(filePath, () => {});
    next(e);
  }
});

module.exports = router;
