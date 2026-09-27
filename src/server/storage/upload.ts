import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.resolve(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.mov', '.mp3', '.wav', '.ogg', '.m4a'].includes(ext)
      ? ext
      : '.bin';
    const uniqueName = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${safeExt}`;
    cb(null, uniqueName);
  }
});

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: 35 * 1024 * 1024 // 35MB max for short videos/audio/images
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimePrefixes = ['image/', 'video/', 'audio/'];
    if (allowedMimePrefixes.some((prefix) => file.mimetype.startsWith(prefix))) {
      cb(null, true);
    } else {
      cb(new Error('نوع الملف غير مدعوم. يرجى رفع صورة أو فيديو أو ملف صوتي فقط.'));
    }
  }
});

export function getUploadsPath(): string {
  return UPLOADS_DIR;
}
