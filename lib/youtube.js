import { AppError } from './errors.js';

const HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be',
]);
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Valide l'URL et renvoie { id, url } normalisés. Lève AppError si invalide. */
export function parseYouTubeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new AppError('EMPTY_URL', "Colle l'URL d'une vidéo YouTube pour commencer.");

  let u;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new AppError('INVALID_URL', "Cette adresse n'est pas une URL valide.");
  }
  if (!HOSTS.has(u.hostname.toLowerCase())) {
    throw new AppError('NOT_YOUTUBE', "Seules les URL YouTube sont acceptées (youtube.com ou youtu.be).");
  }

  let id = null;
  if (u.hostname === 'youtu.be') {
    id = u.pathname.split('/')[1];
  } else if (u.pathname === '/watch') {
    id = u.searchParams.get('v');
  } else {
    const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
    if (m) id = m[2];
  }
  if (!id || !ID_RE.test(id)) {
    throw new AppError('NO_VIDEO_ID', "Aucune vidéo trouvée dans cette URL. Vérifie qu'elle pointe vers une vidéo précise.");
  }
  return { id, url: `https://www.youtube.com/watch?v=${id}` };
}
