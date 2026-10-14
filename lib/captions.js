import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppError } from './errors.js';

const run = promisify(execFile);

/** Métadonnées de la vidéo via yt-dlp (sans téléchargement). */
export async function getVideoInfo(url) {
  try {
    const { stdout } = await run(
      'yt-dlp',
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
    if (key && json3(manual[key])) return { lang: key, kind: 'manual', url: json3(manual[key]).url };
  }
  // Sous-titres automatiques : la piste « -orig » est celle de la langue parlée.
  const origKey = Object.keys(auto).find((k) => k.endsWith('-orig'));
  if (origKey && json3(auto[origKey]))
    return { lang: origKey.replace('-orig', ''), kind: 'auto', url: json3(auto[origKey]).url };
  for (const lang of prefs) {
    if (json3(auto[lang])) return { lang, kind: 'auto', url: json3(auto[lang]).url };
  }
  const anyManual = Object.keys(manual).find((k) => json3(manual[k]));
  if (anyManual) return { lang: anyManual, kind: 'manual', url: json3(manual[anyManual]).url };
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

export async function fetchCaptions(info) {
  const track = pickTrack(info);
  if (!track) return null;

  let res;
  try {
    res = await fetch(track.url, { signal: AbortSignal.timeout(30_000) });
  } catch {
    return null; // on laissera le repli audio prendre le relais
  }
  if (!res.ok) return null;

  let data;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  const paragraphs = json3ToParagraphs(data);
  if (!paragraphs.length) return null;
  return { paragraphs, language: track.lang, kind: track.kind };
}
