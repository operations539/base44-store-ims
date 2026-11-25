import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireAuth } from '../auth.js';
import { bad, wrap } from '../util.js';

const router = Router();

// Bill photos / signed DC images live on a writable volume inside the app and
// are only served to signed-in users (never a public URL).
const DIR = process.env.UPLOAD_DIR || '/app/uploads';
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

router.post(
  '/files',
  requireAuth,
  wrap(async (req, res) => {
    const dataUrl = String(req.body?.data_url || '');
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw bad('Choose a JPG, PNG or WEBP image.', { file: 'Unsupported file' });

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 4 * 1024 * 1024) throw bad('That image is larger than 4 MB.', { file: 'Too large' });

    await fs.mkdir(DIR, { recursive: true });
    const name = `${crypto.randomBytes(16).toString('hex')}.${MIME_EXT[match[1]]}`;
    await fs.writeFile(path.join(DIR, name), buffer);
    res.status(201).json({ url: `/api/files/${name}`, name, size: buffer.length });
  })
);

router.get(
  '/files/:name',
  requireAuth,
  wrap(async (req, res) => {
    if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(req.params.name)) {
      return res.status(400).json({ error: 'Invalid file name.' });
    }
    const full = path.join(DIR, req.params.name);
    try {
      await fs.access(full);
    } catch {
      return res.status(404).json({ error: 'File not found.' });
    }
    return res.type(path.extname(req.params.name)).sendFile(full);
  })
);

export default router;
