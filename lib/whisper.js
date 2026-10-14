import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppError } from './errors.js';
import { mapYtDlpError } from './captions.js';

const run = promisify(execFile);
const MAX_BYTES = 25 * 1024 * 1024; // limite de l'API de transcription

/** Télécharge l'audio (mono, 32 kb/s pour rester léger) puis l'envoie au modèle. */
export async function transcribeAudio(url, info) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new AppError(
      'NO_CAPTIONS_NO_STT',
      "Cette vidéo n'a pas de sous-titres, et la transcription audio n'est pas configurée sur ce serveur (clé OPENAI_API_KEY manquante).",
      422,
    );
  }
  const maxMin = Number(process.env.MAX_AUDIO_MINUTES || 100);
  if (info.duration && info.duration > maxMin * 60) {
    throw new AppError(
      'TOO_LONG',
      `Cette vidéo dure ${Math.round(info.duration / 60)} min et n'a pas de sous-titres. La transcription audio est limitée à ${maxMin} min.`,
      422,
    );
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'ytt-'));
  try {
    try {
      await run(
        'yt-dlp',
        [
          '--no-playlist', '--no-warnings', '-x', '--audio-format', 'mp3',
          '--postprocessor-args', 'ffmpeg:-ac 1 -b:a 32k',
          '-o', path.join(dir, 'audio.%(ext)s'), url,
        ],
        { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60_000 },
      );
    } catch (err) {
      throw mapYtDlpError(err);
    }

    const file = (await readdir(dir)).find((f) => f.startsWith('audio.'));
    if (!file) throw new AppError('NO_AUDIO', "Impossible d'extraire l'audio de cette vidéo.", 422);
    const full = path.join(dir, file);
    const { size } = await stat(full);
    if (size < 1024) throw new AppError('NO_AUDIO', "La piste audio de cette vidéo est vide.", 422);
    if (size > MAX_BYTES)
      throw new AppError('TOO_LONG', "L'audio de cette vidéo est trop volumineux pour être transcrit.", 422);

    const form = new FormData();
    form.append('file', new Blob([await readFile(full)], { type: 'audio/mpeg' }), 'audio.mp3');
    form.append('model', process.env.TRANSCRIPTION_MODEL || 'whisper-1');
    form.append('response_format', 'json');

    let res;
    try {
      res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(10 * 60_000),
      });
    } catch {
      throw new AppError('STT_UNREACHABLE', "Le service de transcription audio ne répond pas. Réessaie.", 504);
    }
    if (!res.ok) {
      console.error('STT error', res.status, await res.text().catch(() => ''));
      throw new AppError('STT_FAILED', "La transcription audio a échoué.", 502);
    }
    const { text } = await res.json();
    if (!text || !text.trim())
      throw new AppError('NO_SPEECH', "Aucune parole détectée dans cette vidéo.", 422);
    return { paragraphs: splitIntoParagraphs(text), language: info.language || null, kind: 'whisper' };
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Découpe un long texte brut en paragraphes d'environ 500 caractères, aux fins de phrases. */
export function splitIntoParagraphs(text) {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]+["»”)]*\s*|[^.!?…]+$/g) || [text];
  const out = [];
  let cur = '';
  for (const s of sentences) {
    cur += s;
    if (cur.length >= 500) { out.push(cur.trim()); cur = ''; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
