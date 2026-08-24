# EZ Quiz ChatGPT plugin submission

This is the review-ready source package for the production MCP-backed ChatGPT plugin. The production endpoint is deployed and protocol-verified; complete the remaining portal and fresh-connection device checks before submission.

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

Turn a topic or your study material into a polished interactive quiz inside ChatGPT.

### Long description

EZ Quiz creates focused, interactive quizzes without sending you to a separate study screen. Ask for a quiz about a topic or provide notes or attachment text for a source-grounded quiz. ChatGPT writes and fact-checks the question set, applies clear easy-through-expert difficulty rules, then opens the complete quiz in the EZ Quiz player. The in-chat player presents one question at a time and supports multiple-choice, true/false, yes/no, and matching questions. It preserves answers while navigating, calculates the score once at the finish, reviews missed or all questions, counts each new attempt, and offers focused retakes.

AI-generated questions may contain mistakes. Verify important facts against your source.

## Starter prompts

1. Create a 10-question EZ Quiz about IPv4 subnetting.
2. Turn my attached study notes into an 8-question mixed EZ Quiz.
3. Make this quiz much harder than the last one.
4. Give me a matching quiz on common network protocols and ports.

## MCP tools

### `open_quiz`

Displays a complete quiz that ChatGPT has already written and fact-checked from the conversation and any user-supplied source material. It accepts 1–20 structured MC, TF, YN, or MT questions. The tool is read-only and idempotent and does not call a second AI provider, start a background generation job, fetch a URL, or receive raw source material.

The attached component is a self-contained runner and results experience. It does not expose a generation screen because ChatGPT prepares the full question set before calling the tool.

## Reviewer test cases

### Positive cases

| Request | Expected behavior | Expected result shape |
| --- | --- | --- |
| “Create a five-question medium quiz about photosynthesis.” | ChatGPT writes and fact-checks five applied-understanding questions, calls `open_quiz` once, and does not call a second model provider. | One interactive five-question quiz with `difficulty: medium`. |
| “Use this text to quiz me: TCP uses a connection-oriented transport. UDP is connectionless.” | ChatGPT treats the text as hidden instructor knowledge and passes only a completed structured quiz to `open_quiz`; learner-facing questions do not mention notes or source text. | One source-grounded interactive quiz whose items stand alone. |
| After finishing a hard quiz: “Make it much harder than that.” | ChatGPT creates an expert quiz using deeper diagnosis or distinctions, not obscure trivia or denser wording. | One interactive quiz with `difficulty: expert`. |
| “Give me a matching quiz on common network protocols and ports.” | ChatGPT supplies complete left/right columns and a one-to-one answer map before opening the player. | One interactive quiz containing valid `MT` questions. |
| Complete a quiz, select Retake missed, then finish again. | Only missed answers reset, retained correct answers still count, and the new run increments the attempt exactly once. | Results show `Attempt 2` with one stable final score. |

### Negative cases

| Request or scenario | Expected safe behavior | Why the plugin should not complete it as requested |
| --- | --- | --- |
| “Create 21 questions.” | Explain or offer the 20-question component limit without sending oversized input. | The public tool accepts 1–20 questions. |
| “Save my score forever.” | Explain that EZ Quiz has no account or durable score storage. | The first public release deliberately stores no long-term learner record. |
| “Quiz me using my password/API key.” | Refuse to treat credentials as study material and request non-sensitive content. | Secrets are unnecessary and unsafe quiz input. |

## Release checks

- [x] Deploy the branch to a stable public HTTPS origin.
- [x] Confirm `POST https://ez-quiz.app/mcp` initializes without a beta cookie/header.
- [ ] Run MCP Inspector against the deployed endpoint and call every tool with valid and invalid inputs.
- [ ] Connect the endpoint in ChatGPT developer mode and run every reviewer test case.
- [ ] Verify the quiz component at mobile and desktop widths, including safe-area padding, constrained-height scrolling, keyboard-only use, system light/dark mode, and fullscreen expansion.
- [ ] Confirm the production wordmark and v8 results render in a fresh ChatGPT app and browser card; the deployed resource already embeds the logo and declares no external resource dependencies.
- [x] Confirm repeated delivery of the same tool result does not reset progress, increment attempts, or change a completed score.
- [ ] Confirm privacy, terms, support, website, and logo URLs are publicly reachable and consistent with the verified publisher identity.
- [ ] Complete individual or business identity verification in OpenAI Platform.
- [ ] Confirm the submitting role has Apps Management write access (`api.apps.write`).
- [ ] Create the portal draft, add its challenge token to Netlify as `OPENAI_APPS_CHALLENGE`, redeploy, and verify the well-known URL returns only that token.
- [ ] Create the portal draft, upload listing assets, add starter prompts/test cases, select countries, and complete policy attestations.
- [ ] Review the portal's MCP scan and fix every warning before requesting review.

## Deliberate first-release boundaries

- No user accounts or authentication.
- No durable score or quiz storage.
- No arbitrary URL fetching.
- No second-model generation request or background generation job in the advertised ChatGPT flow or widget.
- No payments, advertising, analytics, or tracking.
- No iframe embedding or third-party widget assets.
- No OpenAI review submission or marketplace publishing step is automated from this repository.
