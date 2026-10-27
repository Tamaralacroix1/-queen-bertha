// Image features: general image generation + Bible verse cards (text composed server-side, never by the image model).
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const P = require('./providers');
GlobalFonts.registerFromPath(path.join(__dirname, '../assets/fonts/DejaVuSerif-Bold.ttf'), 'CardSerifBold');
GlobalFonts.registerFromPath(path.join(__dirname, '../assets/fonts/DejaVuSerif.ttf'), 'CardSerif');
GlobalFonts.registerFromPath(path.join(__dirname, '../assets/fonts/NotoColorEmoji.ttf'), 'CardEmoji');

// --- Intent detection (keyword fallback; real mode also lets the LLM classify) ---
const VERSE_RE = /v[eè]s[eè]|bib|b[iy]b|bible|verse|verset|pawòl bondye|pawol bondye|sòm|psalm/i;
const IMAGE_RE = /foto|imaj|image|pòtrè|desen|picture|photo|dessin|fè yon pòtrè/i;
function detectIntent(text) {
  if (VERSE_RE.test(text)) return 'verse';
  if (IMAGE_RE.test(text)) return 'image';
  return 'chat';
}
function detectLang(text) {
  if (/angl[eè]|english/i.test(text)) return 'en';
  if (/frans[eè]|fran[cç]ais|french/i.test(text)) return 'fr';
  return 'ht';
}

// Small demo verse library. EN = World English Bible (public domain), FR = Louis Segond 1910 (public domain),
// HT = Haitian Creole Bib la (Société Biblique Haïtienne). Verify HT wording before production.
const VERSES = {
  love: { theme: /renmen|lanmou|love|amour/i, ref: { ht: 'Jan 3:16', fr: 'Jean 3:16', en: 'John 3:16' },
    ht: "Paske, Bondye sitèlman renmen lèzòm, li bay sèl Pitit li a pou tout moun ki mete konfyans yo nan li pa mouri, men pou yo gen lavi ki p'ap janm fini an.",
    fr: "Car Dieu a tant aimé le monde qu'il a donné son Fils unique, afin que quiconque croit en lui ne périsse point, mais qu'il ait la vie éternelle.",
    en: "For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life." },
  peace: { theme: /lapè|lape|peace|paix|pè|pa pè|krent|fear/i, ref: { ht: 'Sòm 23:1', fr: 'Psaume 23:1', en: 'Psalm 23:1' },
    ht: "Seyè a se gadò mwen, mwen p'ap manke anyen.",
    fr: "L'Éternel est mon berger: je ne manquerai de rien.",
    en: "Yahweh is my shepherd: I shall lack nothing." },
  hope: { theme: /espwa|lespwa|hope|espoir|fòs|strength|force/i, ref: { ht: 'Filipyen 4:13', fr: 'Philippiens 4:13', en: 'Philippians 4:13' },
    ht: "Mwen ka fè tout bagay grasa Kris la ki ban m fòs.",
    fr: "Je puis tout par celui qui me fortifie.",
    en: "I can do all things through Christ, who strengthens me." },
};
function pickDemoVerse(text, lang) {
  const v = Object.values(VERSES).find(v => v.theme.test(text)) || VERSES.hope;
  return { text: v[lang], reference: v.ref[lang], lang };
}

// --- Image generation ---
async function generateImage(prompt, size = '1024x1536') {
  if (P.isMock() || !P.hasOpenAI()) return null;
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1', prompt, size, n: 1 }),
  });
  if (!r.ok) { console.warn('image HTTP ' + r.status); return null; }
  const j = await r.json();
  const d = j.data[0];
  if (d.b64_json) return Buffer.from(d.b64_json, 'base64');
  if (d.url) return Buffer.from(await (await fetch(d.url)).arrayBuffer());
  return null;
}

const PALETTES = [['#ffd6e0', '#c3b1e1', '#7fb3ff'], ['#ffe29f', '#ffa99f', '#ff719a'], ['#a1ffce', '#66c6c0', '#3a7bd5']];
function placeholder(w, h, label) {
  const c = createCanvas(w, h), g = c.getContext('2d');
  const pal = PALETTES[Math.floor(Math.random() * PALETTES.length)];
  const gr = g.createLinearGradient(0, 0, w, h); pal.forEach((col, i) => gr.addColorStop(i / (pal.length - 1), col));
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 25; i++) { // soft bokeh dots
    g.fillStyle = `rgba(255,255,255,${0.08 + Math.random() * 0.15})`;
    g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 20 + Math.random() * 90, 0, 7); g.fill();
  }
  if (label) { g.fillStyle = 'rgba(0,0,0,.55)'; g.font = '34px CardSerif'; g.textAlign = 'center'; g.fillText(label, w / 2, h - 40); }
  return c.toBuffer('image/png');
}

function wrap(g, text, maxW) {
  const words = text.split(/\s+/), lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line); return lines;
}

async function composeVerseCard(bgBuf, verseText, reference) {
  const W = 1080, H = 1350, c = createCanvas(W, H), g = c.getContext('2d');
  const img = await loadImage(bgBuf);
  const s = Math.max(W / img.width, H / img.height); // cover
  g.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
  // auto-size font to fit the panel
  const maxW = W - 220; let size = 84, lines;
  for (; size >= 34; size -= 2) { g.font = `${size}px CardSerifBold, CardEmoji`; lines = wrap(g, reference ? '“' + verseText + '”' : verseText, maxW); if (lines.length * size * 1.35 < H * 0.55) break; }
  const lh = size * 1.35, blockH = lines.length * lh + (reference ? 120 : 20), top = (H - blockH) / 2;
  g.fillStyle = 'rgba(255,255,255,0.78)'; // legibility panel
  g.beginPath(); g.roundRect(70, top - 50, W - 140, blockH + 60, 40); g.fill();
  g.fillStyle = '#2b2350'; g.textAlign = 'center'; g.textBaseline = 'top';
  lines.forEach((l, i) => g.fillText(l, W / 2, top + i * lh));
  if (reference) {
  g.font = `italic ${Math.round(size * 0.8)}px CardSerif`; g.fillStyle = '#7a3e6e';
  g.fillText('— ' + reference, W / 2, top + lines.length * lh + 30); }
  return c.toBuffer('image/png');
}

async function verseCard({ text, reference, bgPrompt }) {
  const prompt = (bgPrompt || 'soft pastel flowers and gentle morning light') +
    '. Pretty, peaceful inspirational background, soft focus, lots of empty space in the center, absolutely NO text, letters or words.';
  const bg = (await generateImage(prompt)) || placeholder(1080, 1350);
  return composeVerseCard(bg, text, reference);
}
async function generalImage(prompt, caption) {
  const img = (await generateImage(prompt, '1024x1024')) || placeholder(1024, 1024, caption ? '' : 'DEMO: ' + prompt.slice(0, 40));
  return caption ? composeVerseCard(img, caption, '') : img;
  return (await generateImage(prompt, '1024x1024')) || placeholder(1024, 1024, 'DEMO: ' + prompt.slice(0, 40));
}

module.exports = { detectIntent, detectLang, pickDemoVerse, verseCard, generalImage, composeVerseCard };
