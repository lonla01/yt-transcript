import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './lib/errors.js';
import { parseYouTubeUrl } from './lib/youtube.js';
import { getVideoInfo, fetchCaptions } from './lib/captions.js';
import { transcribeAudio } from './lib/whisper.js';
import { buildPdf, safeFilename } from './lib/pdf.js';
import { buildEpub } from './lib/epub.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Limiteur simple : 8 transcriptions par minute et par IP.
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const list = (hits.get(req.ip) || []).filter((t) => now - t < 60_000);
  if (list.length >= 8) {
    return res.status(429).json({ error: { code: 'RATE_LIMIT', message: 'Trop de demandes. Réessaie dans une minute.' } });
  }
  list.push(now);
  hits.set(req.ip, list);
  next();
}

app.post('/api/transcribe', rateLimit, async (req, res, next) => {
  try {
    const { id, url } = parseYouTubeUrl(req.body?.url);
    const info = await getVideoInfo(url);

    if (info.is_live || info.live_status === 'is_live') {
      throw new AppError('LIVE', "Cette vidéo est un direct en cours. Reviens quand il sera terminé.", 422);
    }

    let result = await fetchCaptions(info, url);
    if (!result) result = await transcribeAudio(url, info);

    res.json({
      id,
      url,
      title: info.title || 'Sans titre',
      channel: info.uploader || info.channel || '',
      duration: info.duration || null,
      language: result.language,
      source: result.kind, // manual | auto | whisper
      paragraphs: result.paragraphs,
    });
  } catch (err) {
    next(err);
  }
});

/** Valide et nettoie le corps envoyé par le client pour l'export (PDF, EPUB). */
function exportInput(body) {
  const { title, channel, url, source, language, paragraphs } = body || {};
  if (!Array.isArray(paragraphs) || !paragraphs.length || !paragraphs.every((p) => typeof p === 'string')) {
    throw new AppError('BAD_EXPORT_INPUT', "Il n'y a pas de transcription à exporter.");
  }
  return {
    title: String(title || '').slice(0, 300),
    channel: String(channel || '').slice(0, 200),
    url: typeof url === 'string' && /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(url) ? url : '',
    kind: source,
    language: typeof language === 'string' ? language.slice(0, 35) : '',
    paragraphs,
  };
}

app.post('/api/pdf', (req, res, next) => {
  try {
    const input = exportInput(req.body);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(input.title)}"`);
    buildPdf(res, input);
  } catch (err) {
    next(err);
  }
});

app.post('/api/epub', (req, res, next) => {
  try {
    const input = exportInput(req.body);
    const epub = buildEpub(input);
    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(input.title, 'epub')}"`);
    res.send(epub);
  } catch (err) {
    next(err);
  }
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: "Une erreur inattendue est survenue. Réessaie." } });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Serveur prêt sur http://localhost:${port}`));
