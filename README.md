# Asistan Bertha — voice assistant prototype (Haitian Creole)

Bertha taps one big red **PALE** button, speaks Haitian Creole, and gets a short spoken Creole reply that walks her through the task step by step. When she needs English text (for a form, email, or message), it shows in a big box with a green **Kopye** button, and the app explains in Creole how to paste it.

## Run
```bash
npm install
cp .env.example .env    # optional: add your keys
set -a; . ./.env; set +a
npm start               # http://localhost:3000
```
With no keys set, the app runs in **DEMO mode**. A yellow "MÒD DEMO" banner appears, replies are canned (try typing "imel", "leson", or "lwa"), and the browser's built-in voice reads them aloud.

## Environment variables
| Var | Purpose |
|---|---|
| `OPENAI_API_KEY` | Speech-to-text (gpt-4o-transcribe), TTS (gpt-4o-mini-tts), and chat |
| `XAI_API_KEY` | Grok chat |
| `CHAT_PROVIDER` | `OPENAI` (default) or `XAI`. If the main provider fails, the other one is used |
| `OPENAI_CHAT_MODEL`, `XAI_MODEL`, `OPENAI_STT_MODEL`, `OPENAI_TTS_MODEL` | Optional model overrides |
| `MOCK_MODE=1` | Turns on demo mode even when keys are set |
| `PORT` | Default 3000 |

Keys are read only from the environment. They are never logged or sent to the browser. Voice input needs `OPENAI_API_KEY`; with only an xAI key, use the text box.

## Structure
```
brain/index.js        channel-agnostic brain: handleMessage({userId, text|audio}) -> {transcript_creole, english_translation, reply_creole, english_text, reply_audio_mp3_base64}
brain/providers.js    OpenAI/xAI calls (STT, chat with fallback, TTS) and mock detection
channels/web/server.js  Express web channel: serves public/ and exposes the API
public/index.html     mobile-first UI (MediaRecorder, text fallback, Kopye)
```

## API
- `POST /message` with JSON `{"userId":"bertha","text":"..."}`, **or** a raw audio body (`Content-Type: audio/webm|ogg|mp4`, `?userId=`)
- `GET /health` returns `{ok, mock}`

## Adding WhatsApp later
Add `channels/whatsapp/` (Twilio WhatsApp or Meta Cloud API webhook). It should:
1. Receive the webhook and download the voice note (WhatsApp sends OGG/Opus, which OpenAI accepts).
2. Call `handleMessage({userId: <phone>, audio, audioMime: 'audio/ogg'})` or `{text}`.
3. Send back `reply_audio_mp3_base64` as an audio message (host the file or upload it as media), plus `reply_creole` as text. Send `english_text` as its own message so she can long-press and copy it.
The brain doesn't change. Conversation history is kept in memory per userId; use Redis or a database in production.

## Notes
- Legal answers are general information only. The prompt tells the assistant to point her to free legal aid for serious matters.
- Microphone access requires HTTPS (or localhost), so host it behind TLS.

## Images & Bible verse cards
- **General images.** If she asks for a picture ("fè yon foto…", "imaj", "desen"), the brain sets `intent:"image"` and generates it with the OpenAI Images API (`OPENAI_IMAGE_MODEL`, default `gpt-image-1`). The page shows it large with the **📤 Pataje** and **💾 Sove** buttons.
- **Bible verse cards.** She can tap the **📖 Vèsè Biblik** button on the home screen, then a theme (Lespwa / Lanmou / Lapè) and a language (Kreyòl, the default, or Fransè / Anglè). She can also just say "fè m yon vèsè sou lanmou". The AI picks a real verse and quotes it word for word: *Bib la* (Haitian Creole), Louis Segond 1910 (French), or World English Bible (English), with the reference. The image model draws **only a background with no text**. The verse and reference are added server-side with `@napi-rs/canvas` (`brain/images.js`) on a semi-transparent panel, with automatic font sizing and bundled DejaVu fonts (`assets/fonts`), so the spelling is always exactly right.
- **Demo mode.** The background is a random pastel gradient with soft circles, and the verses come from a small built-in list (John 3:16, Psalm 23:1, Philippians 4:13 in HT/FR/EN). ⚠️ Check the Creole wording against a printed *Bib la* before using it for real. LLM-quoted verses can also be wrong, so a production version should look verses up in a Bible text source (e.g. API.Bible) by reference.
- **Sharing.** Pataje uses the Web Share API with the PNG file and the verse as the caption, so on Android/iOS she can pick WhatsApp. If sharing isn't available, the app downloads the image and opens `wa.me/?text=<verse>`.
- **API.** `handleMessage` now accepts `mode:"verse"` (JSON `mode`, or `?mode=verse` for audio). It returns `intent` plus `image: {kind:"verse"|"image", png_base64, caption}`. A WhatsApp channel can upload `png_base64` as an image message with `caption`.

## 🎨 Fè yon Foto (pictures of anything)
The orange **🎨 Fè yon Foto** button sits above Vèsè Biblik. Tapping it asks her, in speech and on screen, "Ki foto ou vle?" She then says or types any subject. A small optional box, "Mo pa w sou foto a?", lets her add her own words (for example "Bòn fèt Mari! 🎉"). The server writes those words onto the picture the same way as on verse cards, with emoji supported through the bundled Noto Color Emoji font. The picture shows large with **Pataje** and **Sove**.
API: `mode:"image"` (JSON) or `?mode=image&caption=…` (audio) makes the brain treat the request as a picture request. `caption` is optional.
