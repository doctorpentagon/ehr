const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { requireTenantPatient } = require('../utils/tenantRecords');

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const allowedTypes = {
  '.jpeg': ['image/jpeg'],
  '.jpg': ['image/jpeg'],
  '.png': ['image/png'],
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.webp': ['image/webp'],
};

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function removeLocalFile(filePath) {
  if (filePath) fs.unlink(filePath, () => {});
}

async function hasValidSignature(file) {
  const buffer = await fs.promises.readFile(file.path);
  const hex = buffer.subarray(0, 12).toString('hex');
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return hex.startsWith('ffd8ff');
  if (ext === '.png') return hex.startsWith('89504e470d0a1a0a');
  if (ext === '.pdf') return hex.startsWith('25504446');
  if (ext === '.webp') return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  if (ext === '.doc') return hex.startsWith('d0cf11e0a1b11ae1');
  if (ext === '.docx') {
    return hex.startsWith('504b0304')
      && buffer.includes(Buffer.from('[Content_Types].xml'))
      && buffer.includes(Buffer.from('word/'));
  }
  return false;
}

const publicDocumentSelect = {
  id: true,
  patientId: true,
  originalName: true,
  size: true,
  mimetype: true,
  createdAt: true,
  updatedAt: true,
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedMimes = allowedTypes[ext];
    if (!allowedMimes || !allowedMimes.includes(file.mimetype)) {
      return cb(httpError(400, 'Unsupported file type'));
    }
    cb(null, true);
  },
});

router.post('/', [authenticate, tenant, requirePermission('patients')], upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!(await hasValidSignature(req.file))) {
      removeLocalFile(req.file.path);
      return res.status(400).json({ error: 'File content does not match its declared type' });
    }
    if (req.body.patientId) await requireTenantPatient(req.ctx.facilityId, req.body.patientId);
    const fileUrl = `local:${req.file.filename}`;
    let cloudUrl = fileUrl;
    if (process.env.CLOUDINARY_API_KEY) {
      try {
        const cloudinary = require('cloudinary').v2;
        cloudinary.config({
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_API_SECRET,
        });
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: `awibi-ehr/${req.ctx.facilityId}`, resource_type: 'auto',
        });
        cloudUrl = result.secure_url;
        fs.unlink(req.file.path, () => {});
      } catch { /* Cloudinary failed — keep local file */ }
    }
    const doc = await prisma.patientDocument.create({
      data: {
        facilityId: req.ctx.facilityId,
        patientId: req.body.patientId || null,
        uploadedById: req.ctx.userId,
        originalName: req.file.originalname,
        filename: req.file.filename,
        url: cloudUrl,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
    res.json(Object.fromEntries(Object.keys(publicDocumentSelect).map((key) => [key, doc[key]])));
  } catch (e) {
    removeLocalFile(req.file?.path);
    next(e);
  }
});

router.get('/', [authenticate, tenant, requirePermission('patients')], async (req, res, next) => {
  try {
    const { patientId } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (patientId) where.patientId = patientId;
    const docs = await prisma.patientDocument.findMany({
      where,
      select: publicDocumentSelect,
      orderBy: { createdAt: 'desc' },
    });
    res.json(docs);
  } catch (e) { next(e); }
});

router.get('/:id/download', [authenticate, tenant, requirePermission('patients')], async (req, res, next) => {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
      throw httpError(404, 'Document not found');
    }
    const doc = await prisma.patientDocument.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!doc) throw httpError(404, 'Document not found');

    const storedName = path.basename(doc.filename || '');
    const localPath = path.resolve(uploadDir, storedName);
    const isInsideUploadDir = localPath.startsWith(`${path.resolve(uploadDir)}${path.sep}`);
    const originalName = path.basename(doc.originalName || 'document');
    const asciiName = originalName.replace(/[^\x20-\x7e]|["\\]/g, '_');
    const utf8Name = encodeURIComponent(originalName).replace(/['()]/g, escape);
    res.setHeader('Content-Disposition', `inline; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`);
    res.type(doc.mimetype || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store');

    if (storedName && isInsideUploadDir && fs.existsSync(localPath)) {
      return res.sendFile(localPath);
    }

    const remoteUrl = new URL(doc.url || '');
    if (remoteUrl.protocol !== 'https:' || !/(^|\.)cloudinary\.com$/i.test(remoteUrl.hostname)) {
      throw httpError(404, 'Document file is unavailable');
    }
    const upstream = await fetch(remoteUrl, { signal: AbortSignal.timeout(15_000) });
    if (!upstream.ok || !upstream.body) throw httpError(502, 'Document storage is unavailable');
    return Readable.fromWeb(upstream.body).pipe(res);
  } catch (e) { next(e); }
});

module.exports = router;
