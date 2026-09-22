# EZ Quiz · Standalone

EZ Quiz is a study space you can keep. This preservation edition runs the existing vanilla JavaScript quiz app from a local, dependency-free Node launcher. It needs no EZ Quiz account, cloud function, or maintainer-funded AI key.

## Run

Install Node.js 22 or newer. Download and extract this repository, open a terminal in the extracted folder, and run:

```sh
npm start
```

Open http://127.0.0.1:8787 and leave the terminal open. Stop with Ctrl+C. **No npm install is needed to use the standalone app.** The same command works on Windows, macOS, and Linux. This is a local browser application, not a native installer.

## Use

- **Try a demo → Start Quiz:** works without a key.
- **Write a quiz:** interactive and raw-text editors; MC, TF, YN, and MT formats.
- **Open .txt / Save .txt:** portable quiz files.
- **Last quiz:** recover the latest locally saved quiz.
- **Create Quiz:** optional Gemini or OpenAI generation through your local launcher.
- **Results:** review, explain on demand, or retake missed questions.

Settings contains the provider, model ID, and API key. Keys are saved in this browser for your next visit. Uncheck Remember key to use a key for this visit only. Save settings makes no provider call. Load models checks access and retrieves model IDs. Choose a model that supports the required text or image input; listing a model does not guarantee every feature.

[Gemini key console](https://aistudio.google.com/api-keys) · [OpenAI key console](https://platform.openai.com/api-keys)

API usage is billed to your account according to provider terms. Generation uses small batches with bounded fill attempts, which can incur multiple charges. Stopping prevents new batches and aborts the local request, but work already processed by the provider may still be billed.

## Imports and offline use

| Capability | Requirement |
| --- | --- |
| Manual quizzes, scoring, retakes, export | Browser; offline after shell caching |
| TXT, Markdown, HTML, CSV, JSON, RTF | Read locally in browser |
| DOCX | Local launcher; no AI |
| PDF | Gemini and explicit file-send confirmation |
| PNG, JPEG, GIF | Compatible Gemini/OpenAI model and file-send confirmation |
| Generate / Explain | Local launcher + internet + your key |

Binary imports are limited to 4 MiB; extracted text to 60,000 characters. DOCX extraction reads the document body, not embedded objects or images. Check formatting/extraction quality. The selected question alone is forwarded to the provider for an explanation.

Export important quizzes. Local storage can be cleared, and current answers/explanations are not durable saves.

## Security and privacy

The launcher binds only to 127.0.0.1, checks Host/Origin, uses a per-process request token, and serves only public assets. Provider URLs are fixed. Keys travel in HTTPS headers to the selected provider and are not logged or written by the launcher. No hosted fallback is used.

Keys are stored in browser localStorage on your device, outside quiz exports. Forget key removes the saved key; reset also clears EZ Quiz data. Neither action revokes the key at the provider. Browser storage is not an encrypted credential vault.

See [SECURITY.md](SECURITY.md) and [the complete data guide](public/privacy.html). The separate ChatGPT plugin and historical hosted generation infrastructure have different data paths.

## Troubleshooting

- Use the exact 127.0.0.1 address printed by the launcher. localhost is intentionally not accepted as an alternate Host.
- Set EZQ_PORT to a different port if 8787 is busy. Browser storage is separate for each origin/port.
- For authentication, quota, or model errors, check your provider console and use Load models.
- Do not open index.html with a file:// URL; ES modules need HTTP.
- Refresh between quiz sessions after updating files. Export first before Reset App.
- Keep a copy of the repository and LICENSE.txt. AI APIs can change; manual quizzes remain independent.

## Preservation

This edition closes the open-ended product roadmap with a usable, inspectable foundation. The repository is not automatically archived or made read-only. Forks and adaptations are welcome under MIT, with its notice preserved. A downloadable copy does not require continued operation of ez-quiz.app.

Development remains in Ez-Quiz-Dev; Ez-Quiz-App remains its filtered public mirror. The ChatGPT plugin is preserved as a separate integration. Do not switch the production mirror until release verification is complete.
