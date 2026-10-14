import PDFDocument from 'pdfkit';
import fs from 'node:fs';

const FONT_CANDIDATES = [
  ['/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'],
  ['/usr/share/fonts/dejavu/DejaVuSerif.ttf', '/usr/share/fonts/dejavu/DejaVuSerif-Bold.ttf'],
];

function pickFonts() {
  for (const [regular, bold] of FONT_CANDIDATES) {
    if (fs.existsSync(regular) && fs.existsSync(bold)) return { regular, bold };
  }
  return { regular: 'Times-Roman', bold: 'Times-Bold' }; // accents français OK, alphabets non latins non
}

const LABELS = {
  manual: 'sous-titres de la vidéo',
  auto: 'sous-titres automatiques YouTube',
  whisper: 'transcription audio automatique',
};

/** Génère le PDF et l'écrit dans le flux `out`. */
export function buildPdf(out, { title, channel, url, kind, paragraphs }) {
  const fonts = pickFonts();
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 64, bottom: 64, left: 72, right: 72 },
    bufferPages: true,
    info: { Title: title || 'Transcription', Author: channel || undefined, Creator: 'YT Transcript' },
  });
  doc.pipe(out);

  doc.font(fonts.bold).fontSize(20).fillColor('#14202B').text(title || 'Transcription', { lineGap: 4 });
  doc.moveDown(0.5);

  doc.font(fonts.regular).fontSize(9.5).fillColor('#5A6A78');
  if (channel) doc.text(channel);
  if (url) doc.text(url, { link: url, underline: false });
  doc.text(`Source : ${LABELS[kind] || 'transcription'} · générée le ${new Date().toLocaleDateString('fr-FR')}`);

  doc.moveDown(0.8);
  const y = doc.y;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y)
    .lineWidth(0.75).strokeColor('#C9D3DB').stroke();
  doc.moveDown(1);

  doc.font(fonts.regular).fontSize(11).fillColor('#14202B');
  for (const p of paragraphs) {
    doc.text(p, { align: 'left', lineGap: 4, paragraphGap: 8 });
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font(fonts.regular).fontSize(8.5).fillColor('#8393A0');
    doc.text(`${i + 1} / ${range.count}`, doc.page.margins.left, doc.page.height - 40, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: 'center',
      lineBreak: false,
    });
  }
  doc.end();
}

export function safeFilename(title) {
  const base = String(title || 'transcription')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80);
  return `${base || 'transcription'}.pdf`;
}
