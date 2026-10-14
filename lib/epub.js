import zlib from 'node:zlib';
import crypto from 'node:crypto';

const LABELS = {
  manual: 'sous-titres de la vidéo',
  auto: 'sous-titres automatiques YouTube',
  whisper: 'transcription audio automatique',
};

// Caractères interdits en XML 1.0 retirés, puis échappement.
function esc(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Code langue BCP 47 utilisable dans l'EPUB (« fr-orig » → « fr »), sinon « und ». */
export function epubLanguage(lang) {
  const l = String(lang || '').replace(/-orig$/i, '');
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(l) ? l : 'und';
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Archive ZIP minimale : [{ name, data, store }] → Buffer. */
function zip(entries) {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, store } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.from(data, 'utf8');
    const body = store ? raw : zlib.deflateRawSync(raw);
    const method = store ? 0 : 8;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);         // version
    local.writeUInt16LE(0x0800, 6);     // noms en UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);  // champs 30-41 (extra, commentaire, attributs) à 0

    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Génère un EPUB 3 (compatible lecteurs EPUB 2 via toc.ncx) et renvoie un Buffer. */
export function buildEpub({ title, channel, url, kind, language, paragraphs }) {
  const t = esc(title || 'Transcription');
  const lang = epubLanguage(language);
  const uid = `urn:uuid:${crypto.randomUUID()}`;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const source = `Source : ${LABELS[kind] || 'transcription'} · générée le ${new Date().toLocaleDateString('fr-FR')}`;

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${uid}</dc:identifier>
    <dc:title>${t}</dc:title>
    <dc:language>${lang}</dc:language>
    ${channel ? `<dc:creator>${esc(channel)}</dc:creator>` : ''}
    ${url ? `<dc:source>${esc(url)}</dc:source>` : ''}
    <dc:publisher>YT Transcript</dc:publisher>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="text" href="text.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="text"/>
  </spine>
</package>`;

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8"/><title>${t}</title></head>
<body>
  <nav epub:type="toc" id="toc"><ol><li><a href="text.xhtml">${t}</a></li></ol></nav>
</body>
</html>`;

  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${uid}"/></head>
  <docTitle><text>${t}</text></docTitle>
  <navMap>
    <navPoint id="p1" playOrder="1"><navLabel><text>${t}</text></navLabel><content src="text.xhtml"/></navPoint>
  </navMap>
</ncx>`;

  const css = `body { font-family: serif; line-height: 1.5; margin: 0 5%; }
h1 { font-size: 1.6em; line-height: 1.2; margin: 1em 0 0.4em; }
.meta { font-size: 0.85em; color: #5A6A78; margin: 0 0 0.2em; }
.meta a { color: inherit; }
hr { border: 0; border-top: 1px solid #C9D3DB; margin: 1.2em 0 1.5em; }
p { margin: 0 0 0.9em; text-indent: 0; }`;

  const text = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8"/><title>${t}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
  <h1>${t}</h1>
  ${channel ? `<p class="meta">${esc(channel)}</p>` : ''}
  ${url ? `<p class="meta"><a href="${esc(url)}">${esc(url)}</a></p>` : ''}
  <p class="meta">${esc(source)}</p>
  <hr/>
${paragraphs.map((p) => `  <p>${esc(p)}</p>`).join('\n')}
</body>
</html>`;

  return zip([
    { name: 'mimetype', data: 'application/epub+zip', store: true }, // doit être le premier fichier, non compressé
    { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: nav },
    { name: 'OEBPS/toc.ncx', data: ncx },
    { name: 'OEBPS/style.css', data: css },
    { name: 'OEBPS/text.xhtml', data: text },
  ]);
}
