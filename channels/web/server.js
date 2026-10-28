// Web channel: serves the PWA + exposes POST /message. A WhatsApp channel would be a sibling module.
const express = require('express');
const path = require('path');
const { handleMessage } = require('../../brain');
const { isMock } = require('../../brain/providers');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../../public')));
app.get('/health', (req, res) => res.json({ ok: true, mock: isMock() }));
// POST /message  JSON {userId, text}  OR raw audio body (Content-Type audio/*)
app.post('/message', express.raw({ type: 'audio/*', limit: '25mb' }), async (req, res) => {
  try {
    const isAudio = Buffer.isBuffer(req.body);
    const r = await handleMessage(isAudio
      ? { userId: req.query.userId, mode: req.query.mode, caption: req.query.caption, audio: req.body, audioMime: req.get('content-type') }
      : { userId: req.body.userId, text: req.body.text, mode: req.body.mode, caption: req.body.caption });
    res.json(r);
  } catch (e) { console.error(e.message); res.status(500).json({ error: e.message }); }
});
app.post('/tts', async (req, res) => {
  try { const P = require('../../brain/providers'); const a = isMock() ? null : await P.speak(String(req.body.text || '').slice(0, 4000)); res.json({ audio: a }); }
  catch (e) { res.json({ audio: null }); }
});
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Bertha assistant on http://localhost:${port} (mock=${isMock()})`));
