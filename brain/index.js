// The "brain": channel-agnostic. Input {userId, text?|audio?}, output structured reply.
const P = require('./providers');
const IMG = require('./images');

const SYSTEM = `You are "Asistan Bertha", a patient helper for Bertha LaCroix, a Haitian Creole-speaking ESL teacher
who is not tech savvy and finds writing hard. She speaks Haitian Creole. Always:
- Warmly call her "Queen Bertha" now and then (e.g. in a greeting or encouragement), but not in every sentence or every reply.
- Reply in SIMPLE, short spoken Haitian Creole, one small step at a time (numbered, max 4 steps), warm tone.
- Help with everyday tasks, lesson plans and FREE resources for her Spanish/Haitian Creole-speaking ESL students,
  and general legal information. For legal topics add that this is general info only and for serious matters she
  should contact free legal aid (e.g. local Legal Aid Society / LawHelp.org).
- If she needs English text (a form answer, email, text message), write it in "english_text", and in the Creole
  reply explain how to copy it with the big "Kopye" button and paste it (press and hold, then "Paste"/"Coller").
- If she asks for a picture/image/photo, set "intent":"image" and write a detailed English "image_prompt".
- If she asks for a Bible verse (card/picture), set "intent":"verse". Choose a REAL verse fitting her theme and quote it
  EXACTLY, word for word, from: Haitian Creole "Bib la" (Société Biblique Haïtienne) if lang "ht" (default),
  Louis Segond 1910 if "fr", World English Bible if "en". Never paraphrase or invent. Give the reference with the
  book name in that language. Also write "bg_prompt": a pretty background scene in English with NO text.
- Otherwise "intent":"chat".
Return JSON only: {"intent":"chat|image|verse", "english_translation": "<her message in English>", "reply_creole": "...",
"english_text": "<text to copy or empty string>", "image_prompt": "", "verse": {"text":"","reference":"","lang":"ht|fr|en"},
"bg_prompt": ""}`;

const VERSE_HINT = /v[eè]s[eè]|bib|verse|verset/i;
const histories = new Map(); // userId -> messages (in-memory prototype)

function mockReply(text) {
  const t = text.toLowerCase();
  if (/imel|email|mesaj|ekri|lèt|let/.test(t)) return {
    english_translation: '(demo) Please help me write a message to my student\'s parent.',
    reply_creole: 'Pa gen pwoblèm, Queen Bertha! Mwen ekri mesaj la an Anglè pou ou. 1. Peze gwo bouton vèt "Kopye" a. 2. Ale nan mesaj ou a. 3. Peze dwèt ou sou bwat ekri a epi kenbe l. 4. Chwazi "Paste". Se tout!',
    english_text: 'Hello, this is Ms. LaCroix, your child\'s ESL teacher. I would like to talk with you about their progress. When is a good time to call you? Thank you.',
  };
  if (/leson|lesson|klas|elèv|eleve/.test(t)) return {
    english_translation: '(demo) I need a lesson plan for my students.',
    reply_creole: 'Bon lide! 1. Kòmanse ak 5 mo nouvo sou manje. 2. Montre foto chak mo. 3. Elèv yo repete an gwoup. 4. Pou resous gratis, ale sou sit "USA Learns". Ou vle plis?',
    english_text: '',
  };
  if (/lwa|avoka|legal|imigrasyon|lajistis/.test(t)) return {
    english_translation: '(demo) I have a legal question.',
    reply_creole: 'Mwen ka ba ou enfòmasyon jeneral sèlman. Pou bagay serye, rele yon biwo èd legal gratis, tankou Legal Aid. Di m ki kesyon ou genyen, pa piti pa piti.',
    english_text: '',
  };
  return {
    english_translation: '(demo) ' + text,
    reply_creole: 'Bonjou Queen Bertha! Sa a se mòd demo. Di m sa ou bezwen: yon mesaj an Anglè, yon plan leson, oswa yon kesyon. Mwen la pou ede ou, etap pa etap.',
    english_text: '',
  };
}

async function handleMessage({ userId = 'default', text, audio, audioMime, mode, caption }) {
  const mock = P.isMock();
  let transcript = text;
  if (!transcript && audio) {
    transcript = (mock || !P.hasOpenAI())
      ? 'Mwen bezwen ekri yon imel pou paran yon elèv. (demo: odyo pa transkri san kle OpenAI)'
      : await P.transcribe(audio, audioMime);
  }
  if (!transcript) throw new Error('No input');

  let out, provider = 'MOCK';
  if (mode === 'verse' && !VERSE_HINT.test(transcript)) transcript = 'Vèsè biblik: ' + transcript;
  if (mode === 'image') transcript = 'Fè yon foto: ' + transcript;
  if (mock) {
    const intent = mode === 'image' ? 'image' : IMG.detectIntent(transcript);
    if (intent === 'verse') {
      const lang = IMG.detectLang(transcript);
      out = { intent, english_translation: '(demo) Make me a Bible verse picture.', verse: IMG.pickDemoVerse(transcript, lang),
        reply_creole: 'Men bèl vèsè ou a, Queen Bertha! Pou voye l bay zanmi ou: peze gwo bouton "Pataje", epi chwazi WhatsApp.', english_text: '' };
    } else if (intent === 'image') {
      out = { intent, english_translation: '(demo) Make me a picture: ' + transcript, image_prompt: transcript.replace(/^Fè yon foto:\s*/, ''),
        reply_creole: 'Men foto ou a! Peze "Sove" pou kenbe l, oswa "Pataje" pou voye l sou WhatsApp.', english_text: '' };
    } else out = { intent, ...mockReply(transcript) };
  }
  else {
    const h = histories.get(userId) || [];
    h.push({ role: 'user', content: transcript });
    const res = await P.chat([{ role: 'system', content: SYSTEM }, ...h.slice(-12)]);
    provider = res.provider;
    try { out = JSON.parse(res.content); } catch { out = { english_translation: '', reply_creole: res.content, english_text: '' }; }
    out.intent = mode === 'image' ? 'image' : (out.intent || IMG.detectIntent(transcript));
    if (out.intent === 'image' && !out.image_prompt) out.image_prompt = out.english_translation || transcript;
    h.push({ role: 'assistant', content: res.content });
    histories.set(userId, h);
  }
  let image = null;
  try {
    if (out.intent === 'verse' && out.verse && out.verse.text) {
      image = { kind: 'verse', png_base64: (await IMG.verseCard({ text: out.verse.text, reference: out.verse.reference, bgPrompt: out.bg_prompt })).toString('base64'),
        caption: out.verse.text + ' — ' + out.verse.reference };
    } else if (out.intent === 'image' && out.image_prompt) {
      image = { kind: 'image', png_base64: (await IMG.generalImage(out.image_prompt, caption)).toString('base64'), caption: caption || '' };
    }
  } catch (e) { console.error('image error', e.message); }
  const audioB64 = mock ? null : await P.speak(out.reply_creole);
  return { mock, provider, transcript_creole: transcript, ...out, image, reply_audio_mp3_base64: audioB64 };
}

module.exports = { handleMessage };
