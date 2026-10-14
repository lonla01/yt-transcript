import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppError } from './errors.js';
import { runYtDlp } from './ytdlp.js';

/** Métadonnées de la vidéo via yt-dlp (sans téléchargement). */
export async function getVideoInfo(url) {
  try {
    const { stdout } = await runYtDlp(
      ['--dump-single-json', '--no-playlist', '--skip-download', '--no-warnings', url],
      { maxBuffer: 64 * 1024 * 1024, timeout: 60_000 },
    );
    return JSON.parse(stdout);
  } catch (err) {
    throw mapYtDlpError(err);
  }
}

export function mapYtDlpError(err) {
  if (err.code === 'ENOENT') {
    return new AppError('YTDLP_MISSING', "Le serveur n'a pas yt-dlp installé. Consulte le README.", 500);
  }
  const s = String(err.stderr || err.message || '');
  console.error('yt-dlp :', s.split('\n').filter(Boolean).slice(-3).join(' | '));
  if (/Private video/i.test(s)) return new AppError('PRIVATE', "Cette vidéo est privée.", 422);
  if (/Video unavailable|has been removed|does not exist/i.test(s))
    return new AppError('UNAVAILABLE', "Cette vidéo est introuvable ou a été supprimée.", 422);
  if (/age|confirm your age/i.test(s) && /sign in/i.test(s))
    return new AppError('AGE_RESTRICTED', "Cette vidéo est soumise à une restriction d'âge.", 422);
  if (/Sign in to confirm|not a bot|HTTP Error 429/i.test(s))
    return new AppError('BLOCKED', "YouTube bloque temporairement le serveur. Réessaie dans quelques minutes.", 503);
  if (/members-only|Join this channel/i.test(s))
    return new AppError('MEMBERS_ONLY', "Cette vidéo est réservée aux membres de la chaîne.", 422);
  if (err.killed || err.signal === 'SIGTERM')
    return new AppError('TIMEOUT', "YouTube a mis trop de temps à répondre. Réessaie.", 504);
  return new AppError('YTDLP_FAILED', "Impossible de lire cette vidéo pour le moment.", 502);
}

/** Choisit la meilleure piste de sous-titres : manuelle d'abord, puis automatique. */
export function pickTrack(info) {
  const manual = info.subtitles || {};
  const auto = info.automatic_captions || {};
  const original = (info.language || '').split('-')[0];
  const prefs = [original, 'fr', 'en'].filter(Boolean);

  const json3 = (tracks) => (tracks || []).find((t) => t.ext === 'json3');

  for (const lang of prefs) {
    const key = Object.keys(manual).find((k) => k === lang || k.startsWith(`${lang}-`));
    if (key && json3(manual[key])) return { key, lang: key, kind: 'manual' };
  }
  // Sous-titres automatiques : la piste « -orig » est celle de la langue parlée.
  const origKey = Object.keys(auto).find((k) => k.endsWith('-orig'));
  if (origKey && json3(auto[origKey]))
    return { key: origKey, lang: origKey.replace('-orig', ''), kind: 'auto' };
  for (const lang of prefs) {
    if (json3(auto[lang])) return { key: lang, lang, kind: 'auto' };
  }
  const anyManual = Object.keys(manual).find((k) => json3(manual[k]));
  if (anyManual) return { key: anyManual, lang: anyManual, kind: 'manual' };
  return null;
}

/** Transforme le format json3 de YouTube en paragraphes lisibles. */
export function json3ToParagraphs(data) {
  const events = (data.events || []).filter((e) => e.segs);
  const paragraphs = [];
  let current = '';
  let lastEnd = 0;

  const flush = () => {
    const t = current.replace(/\s+/g, ' ').trim();
    if (t) paragraphs.push(t);
    current = '';
  };

  for (const e of events) {
    const text = e.segs.map((s) => s.utf8 || '').join('').replace(/\n/g, ' ');
    if (!text.trim()) continue;
    const start = e.tStartMs || 0;
    const gap = start - lastEnd;
    if (current && (gap > 3000 || (current.length > 550 && /[.!?…»]$/.test(current.trim())))) flush();
    current += (current ? ' ' : '') + text.trim();
    lastEnd = start + (e.dDurationMs || 0);
  }
  flush();
  return paragraphs;
}

/** Télécharge la piste choisie via yt-dlp (même proxy/cookies que le reste). */
export async function fetchCaptions(info, url) {
  const track = pickTrack(info);
  if (!track) return null;

  const dir = await mkdtemp(path.join(tmpdir(), 'yts-'));
  try {
    await runYtDlp(
      [
        '--skip-download', '--no-playlist', '--no-warnings',
        track.kind === 'manual' ? '--write-subs' : '--write-auto-subs',
        '--sub-langs', track.key, '--sub-format', 'json3',
        '-o', path.join(dir, 'sub.%(ext)s'), url,
      ],
      { maxBuffer: 16 * 1024 * 1024, timeout: 60_000 },
    );
    const file = (await readdir(dir)).find((f) => f.endsWith('.json3'));
    if (!file) return null;
    const paragraphs = json3ToParagraphs(JSON.parse(await readFile(path.join(dir, file), 'utf8')));
    if (!paragraphs.length) return null;
    return { paragraphs, language: track.lang, kind: track.kind };
  } catch (err) {
    const mapped = mapYtDlpError(err);
    if (mapped.code === 'BLOCKED') throw mapped; // inutile de tenter l'audio : même blocage
    return null; // sinon on laisse le repli audio prendre le relais
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
