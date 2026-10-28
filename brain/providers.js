// Provider layer: OpenAI (STT, TTS, chat) and xAI/Grok (chat). Keys come only from env.
const OPENAI = 'https://api.openai.com/v1';
const XAI = 'https://api.x.ai/v1';
const hasOpenAI = () => !!process.env.OPENAI_API_KEY;
const hasXAI = () => !!process.env.XAI_API_KEY;
const isMock = () => process.env.MOCK_MODE === '1' || (!hasOpenAI() && !hasXAI());

async function chatWith(provider, messages) {
  const cfg = provider === 'XAI'
    ? { url: XAI, key: process.env.XAI_API_KEY, model: process.env.XAI_MODEL || 'grok-4' }
    : { url: OPENAI, key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o' };
  if (!cfg.key) throw new Error(provider + ' key missing');
  const r = await fetch(cfg.url + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: cfg.model, messages, response_format: { type: 'json_object' } }),
  });
  if (!r.ok) throw new Error(provider + ' chat HTTP ' + r.status);
  const j = await r.json();
  return j.choices[0].message.content;
}

async function chat(messages) {
  const primary = (process.env.CHAT_PROVIDER || 'OPENAI').toUpperCase();
  const order = primary === 'XAI' ? ['XAI', 'OPENAI'] : ['OPENAI', 'XAI'];
  let lastErr;
  for (const p of order) {
    try { return { provider: p, content: await chatWith(p, messages) }; }
    catch (e) { lastErr = e; console.warn('chat fallback:', e.message); }
  }
  throw lastErr;
}

async function transcribe(buf, mime = 'audio/webm') {
  if (!hasOpenAI()) throw new Error('OPENAI_API_KEY needed for speech-to-text');
  const fd = new FormData();
  const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm';
  fd.append('file', new Blob([buf], { type: mime }), 'audio.' + ext);
  fd.append('model', process.env.OPENAI_STT_MODEL || 'gpt-4o-transcribe');
  fd.append('language', 'ht');
  const r = await fetch(OPENAI + '/audio/transcriptions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY }, body: fd });
  if (!r.ok) throw new Error('STT HTTP ' + r.status);
  return (await r.json()).text;
}

async function speak(text) {
  if (!hasOpenAI()) return null;
  const r = await fetch(OPENAI + '/audio/speech', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', voice: process.env.OPENAI_TTS_VOICE || 'coral', input: text,
      instructions: 'You are a warm Haitian grandmother-friendly assistant. Speak in Haitian Creole (Kreyòl ayisyen) with a natural, authentic Haitian accent, as a native speaker from Port-au-Prince would. Do not use a French or American accent. Speak slowly, clearly, warmly and kindly, with gentle pauses.', response_format: 'mp3' }),
  });
  if (!r.ok) { console.warn('TTS HTTP ' + r.status); return null; }
  return Buffer.from(await r.arrayBuffer()).toString('base64');
}

module.exports = { chat, transcribe, speak, isMock, hasOpenAI, hasXAI };
