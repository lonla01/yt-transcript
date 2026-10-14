import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const execFileP = promisify(execFile);
let cookiesPath; // undefined = pas encore calculé, null = aucun cookie

/**
 * Cookies YouTube (format Netscape cookies.txt), fournis soit en base64 (YTDLP_COOKIES_B64,
 * pratique sur Railway), soit par un chemin de fichier (YTDLP_COOKIES_FILE).
 * yt-dlp réécrit le fichier de cookies : on travaille donc sur une copie temporaire.
 */
function getCookiesPath() {
  if (cookiesPath !== undefined) return cookiesPath;
  cookiesPath = null;
  try {
    const target = path.join(mkdtempSync(path.join(tmpdir(), 'ytc-')), 'cookies.txt');
    if (process.env.YTDLP_COOKIES_B64) {
      writeFileSync(target, Buffer.from(process.env.YTDLP_COOKIES_B64, 'base64'));
    } else if (process.env.YTDLP_COOKIES_FILE) {
      copyFileSync(process.env.YTDLP_COOKIES_FILE, target);
    } else {
      return cookiesPath;
    }
    chmodSync(target, 0o600);
    cookiesPath = target;
  } catch (err) {
    console.error('Cookies yt-dlp ignorés :', err.message);
  }
  return cookiesPath;
}

/** Arguments communs à tous les appels yt-dlp (proxy, cookies, options libres). */
export function ytdlpArgs() {
  const args = [];
  if (process.env.YTDLP_PROXY) args.push('--proxy', process.env.YTDLP_PROXY);
  const cookies = getCookiesPath();
  if (cookies) args.push('--cookies', cookies);
  if (process.env.YTDLP_EXTRA_ARGS) args.push(...process.env.YTDLP_EXTRA_ARGS.split(/\s+/).filter(Boolean));
  return args;
}

export function runYtDlp(args, opts) {
  return execFileP('yt-dlp', [...ytdlpArgs(), ...args], opts);
}
