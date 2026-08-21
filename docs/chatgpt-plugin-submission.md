# EZ Quiz ChatGPT plugin submission

This is the review-ready source package for an MCP-backed ChatGPT plugin. Do not submit or publish it until the production endpoint has been deployed and tested in ChatGPT developer mode.

## Product

- **Plugin name:** EZ Quiz
- **Submission type:** With MCP
- **MCP URL type:** Universal
- **Production MCP URL:** `https://ez-quiz.app/mcp`
- **Authentication:** None for the first public release
- **Website:** `https://ez-quiz.app/`
- **Support:** `https://ez-quiz.app/support.html`
- **Privacy:** `https://ez-quiz.app/privacy.html`
- **Terms:** `https://ez-quiz.app/terms.html`
- **Logo candidate:** `public/icons/icon-512.png`
- **Suggested category:** Education, if offered by the submission portal; otherwise Productivity

## Listing copy

### Short description

Turn a topic, notes, or pasted quiz lines into a fast interactive quiz inside ChatGPT.

### Long description

EZ Quiz creates focused, interactive quizzes without sending you to a separate study screen. Ask for a quiz about a topic, provide notes or attachment text for a source-grounded quiz, or paste existing EZ Quiz lines. The in-chat player presents one question at a time, checks answers, tracks the score, and works with multiple-choice, true/false, yes/no, and matching questions.

AI-generated questions may contain mistakes. Verify important facts against your source.

## Starter prompts

1. Create a 10-question EZ Quiz about IPv4 subnetting.
2. Turn my attached study notes into an 8-question mixed EZ Quiz.
3. Make me a hard 12-question quiz on the French Revolution.
4. Open these EZ Quiz lines as an interactive quiz: `TF|The Earth orbits the Sun.|T`

## MCP tools

### `generate_quiz`

Creates and displays a quiz from a topic and optional user-supplied source text. Accepts 1–20 questions and MC, TF, YN, or MT formats. It reuses the production generator and returns structured content even when a host cannot render UI.

### `render_quiz`

Validates and displays newline-separated EZ Quiz lines without calling an AI provider. It accepts up to 50 lines and identifies the first malformed line without returning internal diagnostics.

## Reviewer test cases

| Request | Expected behavior |
| --- | --- |
| “Create a five-question easy quiz about photosynthesis.” | `generate_quiz` returns five questions and opens the interactive player. |
| “Use this text to quiz me: TCP uses a connection-oriented transport. UDP is connectionless.” | `generate_quiz` receives only the supplied source and returns a grounded quiz. |
| “Open `TF\|Two plus two is four.\|T` as a quiz.” | `render_quiz` opens one true/false question without AI generation. |
| “Create 21 questions.” | Tool input validation rejects the request because the ChatGPT release limit is 20. |
| “Render `not a quiz line`.” | Tool returns a safe validation error identifying line 1. |
| “Save my score forever.” | The plugin explains that it has no account or durable score storage. |
| “Quiz me using my password/API key.” | The plugin refuses to treat credentials as study material and asks for non-sensitive content. |

## Release checks

- [ ] Deploy the branch to a stable public HTTPS origin.
- [ ] Confirm `POST https://ez-quiz.app/mcp` initializes without the former beta cookie/header.
- [ ] Run MCP Inspector against the deployed endpoint and call every tool with valid and invalid inputs.
- [ ] Connect the endpoint in ChatGPT developer mode and run every reviewer test case.
- [ ] Verify the quiz component at mobile and desktop widths, including keyboard-only use and dark mode.
- [ ] Confirm the production AI provider key, rate limit, timeout, and logs are healthy.
- [ ] Confirm privacy, terms, support, website, and logo URLs are publicly reachable and consistent with the verified publisher identity.
- [ ] Complete individual or business identity verification in OpenAI Platform.
- [ ] Confirm the submitting role has Apps Management write access (`api.apps.write`).
- [ ] Create the portal draft, upload listing assets, add starter prompts/test cases, select countries, and complete policy attestations.
- [ ] Review the portal's MCP scan and fix every warning before requesting review.

## Deliberate first-release boundaries

- No user accounts or authentication.
- No durable score or quiz storage.
- No arbitrary URL fetching.
- No payments, advertising, analytics, or tracking.
- No iframe embedding or third-party widget assets.
- No publishing step is automated from this repository.
