import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { parseYouTubeUrl } from '../lib/youtube.js';
import { json3ToParagraphs, pickTrack } from '../lib/captions.js';
import { splitIntoParagraphs } from '../lib/whisper.js';
import { buildPdf, safeFilename } from '../lib/pdf.js';
import { ytdlpArgs } from '../lib/ytdlp.js';
import { buildEpub, epubLanguage } from '../lib/epub.js';

// Proxy / cookies / options passés à yt-dlp
process.env.YTDLP_PROXY = 'http://user:pass@proxy.example:8080';
process.env.YTDLP_COOKIES_B64 = Buffer.from('# Netscape HTTP Cookie File\n').toString('base64');
process.env.YTDLP_EXTRA_ARGS = '--js-runtimes node';
const extra = ytdlpArgs();
assert.deepEqual(extra.slice(0, 2), ['--proxy', 'http://user:pass@proxy.example:8080']);
assert.equal(extra[2], '--cookies');
assert.deepEqual(extra.slice(-2), ['--js-runtimes', 'node']);

// URL
assert.equal(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=10').id, 'dQw4w9WgXcQ');
assert.equal(parseYouTubeUrl('youtube.com/watch?v=dQw4w9WgXcQ&list=x').id, 'dQw4w9WgXcQ');
assert.equal(parseYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
for (const bad of ['', 'bonjour', 'https://vimeo.com/123', 'https://www.youtube.com/watch?v=court', 'https://www.youtube.com/']) {
  assert.throws(() => parseYouTubeUrl(bad), (e) => Boolean(e.code && e.message), `devrait refuser : ${bad}`);
}

// Sous-titres json3
const data = { events: [
  { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'Bonjour à tous,' }] },
  { tStartMs: 2000, dDurationMs: 2000, segs: [{ utf8: 'bienvenue.' }] },
  { tStartMs: 12000, dDurationMs: 2000, segs: [{ utf8: 'Deuxième partie.' }] },
  { tStartMs: 1, segs: undefined },
] };
assert.deepEqual(json3ToParagraphs(data), ['Bonjour à tous, bienvenue.', 'Deuxième partie.']);

// Choix de piste
const mk = (ext = 'json3') => [{ ext, url: 'https://x/' + ext }];
assert.equal(pickTrack({ language: 'fr', subtitles: { fr: mk() }, automatic_captions: { 'fr-orig': mk() } }).kind, 'manual');
const autoPick = pickTrack({ language: 'fr', subtitles: {}, automatic_captions: { 'fr-orig': mk(), en: mk() } });
assert.equal(autoPick.kind, 'auto');
assert.equal(autoPick.key, 'fr-orig');
assert.equal(pickTrack({ subtitles: {}, automatic_captions: {} }), null);

// Découpage
assert.ok(splitIntoParagraphs('Une phrase. '.repeat(200)).length > 1);

// PDF
const chunks = [];
const sink = new Writable({ write(c, _e, cb) { chunks.push(c); cb(); } });
await new Promise((resolve) => {
  sink.on('finish', resolve);
  buildPdf(sink, {
    title: 'Éléments de test : « accents » et œuvres',
    channel: 'Chaîne', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', kind: 'auto',
    paragraphs: Array.from({ length: 60 }, (_, i) => `Paragraphe ${i + 1}. ` + 'Texte de démonstration avec accents éàù. '.repeat(15)),
  });
});
const pdf = Buffer.concat(chunks);
assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
assert.ok(pdf.length > 5000);
assert.equal(safeFilename('Éléments : test / 1'), 'Elements-test-1.pdf');

// EPUB
const epub = buildEpub({
  title: 'Éléments <test> & « accents »', channel: 'Chaîne', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  kind: 'manual', language: 'fr-orig', paragraphs: ['Premier paragraphe éàù.', 'Second < & > paragraphe.'],
});
assert.equal(epub.readUInt32LE(0), 0x04034b50);
assert.equal(epub.subarray(30, 38).toString(), 'mimetype');
assert.equal(epub.subarray(38, 58).toString(), 'application/epub+zip');
assert.equal(epubLanguage('fr-orig'), 'fr');
assert.equal(epubLanguage('pt-BR'), 'pt-BR');
assert.equal(epubLanguage('<x>'), 'und');
assert.equal(safeFilename('Éléments : test / 1', 'epub'), 'Elements-test-1.epub');

console.log('Tous les tests passent. PDF de test :', pdf.length, 'octets');
