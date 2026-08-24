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

Turn a topic or your study material into a polished interactive quiz inside ChatGPT.

### Long description

EZ Quiz creates focused, interactive quizzes without sending you to a separate study screen. Ask for a quiz about a topic or provide notes or attachment text for a source-grounded quiz. ChatGPT writes and fact-checks the question set, then opens the complete quiz in the EZ Quiz player. The in-chat player presents one question at a time and supports multiple-choice, true/false, yes/no, and matching questions. It preserves answers while navigating, calculates the score once at the finish, reviews missed or all questions, and offers focused retakes.

AI-generated questions may contain mistakes. Verify important facts against your source.

## Starter prompts

1. Create a 10-question EZ Quiz about IPv4 subnetting.
2. Turn my attached study notes into an 8-question mixed EZ Quiz.
3. Make me a hard 12-question quiz on the French Revolution.
4. Give me a five-question true-or-false quiz about the solar system.

## MCP tools

### `open_quiz`

Displays a complete quiz that ChatGPT has already written and fact-checked from the conversation and any user-supplied source material. It accepts 1–20 structured MC, TF, YN, or MT questions. The tool is read-only and idempotent and does not call a second AI provider, start a background generation job, fetch a URL, or receive raw source material.

The attached component is a self-contained runner and results experience. It does not expose a generation screen because ChatGPT prepares the full question set before calling the tool.

## Reviewer test cases

| Request | Expected behavior |
| --- | --- |
| “Create a five-question easy quiz about photosynthesis.” | ChatGPT writes five complete questions, calls `open_quiz` once, and opens the interactive player. |
| “Use this text to quiz me: TCP uses a connection-oriented transport. UDP is connectionless.” | ChatGPT grounds the question set in the supplied text and passes only the completed structured quiz to `open_quiz`. |
| “Give me a matching quiz on common network protocols and ports.” | ChatGPT supplies complete left/right columns and a one-to-one answer map before opening the player. |
| “Create 21 questions.” | ChatGPT should offer the 20-question component limit; tool validation safely rejects oversized input. |
| Complete a quiz, navigate backward, and finish. | Prior answers remain selected and the final score is calculated once. |
| Retake missed questions. | Only missed answers reset; retained correct answers still count toward the final full-quiz score. |
| “Save my score forever.” | The plugin explains that it has no account or durable score storage. |
| “Quiz me using my password/API key.” | The plugin refuses to treat credentials as study material and asks for non-sensitive content. |

## Release checks

- [ ] Deploy the branch to a stable public HTTPS origin.
- [ ] Confirm `POST https://ez-quiz.app/mcp` initializes without the former beta cookie/header.
- [ ] Run MCP Inspector against the deployed endpoint and call every tool with valid and invalid inputs.
- [ ] Connect the endpoint in ChatGPT developer mode and run every reviewer test case.
- [ ] Verify the quiz component at mobile and desktop widths, including safe-area padding, constrained-height scrolling, keyboard-only use, system light/dark mode, and fullscreen expansion.
- [ ] Confirm the production wordmark renders in the ChatGPT app and browser with the widget CSP showing no external resource dependencies.
- [ ] Confirm repeated delivery of the same tool result does not reset progress or change a completed score.
- [ ] Confirm privacy, terms, support, website, and logo URLs are publicly reachable and consistent with the verified publisher identity.
- [ ] Complete individual or business identity verification in OpenAI Platform.
- [ ] Confirm the submitting role has Apps Management write access (`api.apps.write`).
- [ ] Create the portal draft, upload listing assets, add starter prompts/test cases, select countries, and complete policy attestations.
- [ ] Review the portal's MCP scan and fix every warning before requesting review.

## Deliberate first-release boundaries

- No user accounts or authentication.
- No durable score or quiz storage.
- No arbitrary URL fetching.
- No second-model generation request or background generation job inside the widget.
- No payments, advertising, analytics, or tracking.
- No iframe embedding or third-party widget assets.
- No publishing step is automated from this repository.
