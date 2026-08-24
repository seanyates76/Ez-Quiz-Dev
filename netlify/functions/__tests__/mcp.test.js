'use strict';

function event(body, overrides = {}) {
  return { httpMethod: 'POST', headers: {}, body: JSON.stringify(body), ...overrides };
}

function json(response) {
  return response.body ? JSON.parse(response.body) : null;
}

function widgetDocument() {
  const { quizWidgetHtml } = require('../lib/mcpQuizWidget.js');
  const html = quizWidgetHtml();
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
  if (!scriptMatch) throw new Error('Widget script was not embedded');
  return { html, script: scriptMatch[1] };
}

function mountWidget(html, openai) {
  document.open();
  document.write(html.replace(/<script>[\s\S]*<\/script>/, ''));
  document.close();
  window.openai = openai;
  window.parent.postMessage = jest.fn();
}

async function flushWidget() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 25));
}

function quiz(overrides = {}) {
  return {
    quizId: 'quiz-network-basics',
    title: 'Network Basics',
    topic: 'CCNA',
    difficulty: 'medium',
    questionCount: 2,
    aiGenerated: true,
    questions: [
      {
        type: 'MC',
        text: 'Which subnet mask provides 30 usable IPv4 host addresses?',
        options: ['255.255.255.0', '255.255.255.224', '255.255.255.240'],
        correct: [1],
      },
      { type: 'TF', text: 'OSPF is a link-state routing protocol.', correct: true },
    ],
    ...overrides,
  };
}

function clickInput(selector) {
  const input = document.querySelector(selector);
  expect(input).not.toBeNull();
  input.click();
  return input;
}

describe('EZ Quiz MCP server', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      AI_PROVIDER: 'echo',
      EZQ_PLUGIN_WIDGET_ORIGIN: 'https://ez-quiz.app',
    };
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  afterEach(() => {
    delete window.openai;
    jest.useRealTimers();
  });

  afterAll(() => { process.env = originalEnv; });

  test('negotiates MCP and advertises one structured, read-only quiz tool', async () => {
    const { handler } = require('../mcp.js');
    const initialized = await handler(event({
      jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' },
    }));
    expect(initialized.statusCode).toBe(200);
    expect(json(initialized).result).toMatchObject({
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'ez-quiz', version: '2.0.0' },
    });
    expect(json(initialized).result.instructions).toContain('write and fact-check the complete quiz yourself');

    const listed = await handler(event({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
    const listedTools = json(listed).result.tools;
    expect(listedTools.map((tool) => tool.name)).toEqual(['open_quiz']);
    expect(listedTools[0]).toMatchObject({
      inputSchema: { required: ['title', 'topic', 'questions'], additionalProperties: false },
      annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
      _meta: { ui: { resourceUri: 'ui://ez-quiz/quiz-v5.html' } },
    });
    expect(listedTools[0].inputSchema.properties).not.toHaveProperty('source_text');
    expect(listedTools[0].inputSchema.properties).not.toHaveProperty('lines');
    expect(listedTools[0].description).toContain('already written');
  });

  test('serves a self-contained runner with no generation or network dependencies', async () => {
    const { handler } = require('../mcp.js');
    const response = await handler(event({
      jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'ui://ez-quiz/quiz-v1.html' },
    }));
    const resource = json(response).result.contents[0];
    expect(resource.mimeType).toBe('text/html;profile=mcp-app');
    expect(resource._meta.ui).toMatchObject({
      domain: 'https://ez-quiz.app',
      csp: { connectDomains: [], resourceDomains: [] },
    });
    expect(resource._meta['openai/widgetCSP']).toEqual({ connect_domains: [], resource_domains: [] });
    expect(resource.text).toContain('data:image/png;base64,');
    expect(resource.text).toContain('alt="EZ Quiz"');
    expect(resource.text).toContain('ui/notifications/tool-result');
    expect(resource.text).toContain("request('ui/initialize'");
    expect(resource.text).toContain('ui/notifications/size-changed');
    expect(resource.text).toContain('notifyIntrinsicHeight');
    expect(resource.text).toContain('safeArea');
    expect(resource.text).toContain('openai:set_globals');
    expect(resource.text).not.toContain('data-size');
    expect(resource.text).not.toContain('ResizeObserver');
    expect(resource.text).toContain('Previous');
    expect(resource.text).toContain('Retake missed');
    expect(resource.text).not.toContain('Building your quiz');
    expect(resource.text).not.toContain('Cancel generation');
    expect(resource.text).not.toContain('Try again');
    expect(resource.text).not.toContain('requestModal');
    expect(resource.text).not.toContain('fetch(');
    expect(resource.text).not.toMatch(/<script[^>]+src=/i);
    expect(resource.text).not.toMatch(/<img[^>]+src="https?:/i);
  });

  test('keeps cached widget template URIs compatible across revisions', async () => {
    const { handler } = require('../mcp.js');
    const listed = await handler(event({ jsonrpc: '2.0', id: 31, method: 'resources/list' }));
    expect(json(listed).result.resources.map((resource) => resource.uri)).toEqual([
      'ui://ez-quiz/quiz-v1.html',
      'ui://ez-quiz/quiz-v2.html',
      'ui://ez-quiz/quiz-v3.html',
      'ui://ez-quiz/quiz-v4.html',
      'ui://ez-quiz/quiz-v5.html',
    ]);

    for (const uri of [
      'ui://ez-quiz/quiz-v1.html',
      'ui://ez-quiz/quiz-v2.html',
      'ui://ez-quiz/quiz-v3.html',
      'ui://ez-quiz/quiz-v4.html',
      'ui://ez-quiz/quiz-v5.html',
    ]) {
      const read = await handler(event({ jsonrpc: '2.0', id: 32, method: 'resources/read', params: { uri } }));
      expect(json(read).result.contents[0]).toMatchObject({ uri, mimeType: 'text/html;profile=mcp-app' });
    }
  });

  test('opens and canonicalizes a complete mixed-format quiz', async () => {
    const { handler } = require('../mcp.js');
    const args = {
      title: 'CCNA Review',
      topic: 'CCNA',
      difficulty: 'mixed',
      questions: [
        { type: 'MC', text: 'Choose the private IPv4 address.', options: ['8.8.8.8', '10.0.0.1'], correct: [1] },
        { type: 'TF', text: 'OSPF is link-state.', correct: true },
        { type: 'YN', text: 'Does ARP resolve IPv4 addresses to MAC addresses?', correct: true },
        {
          type: 'MT', text: 'Match each protocol to its port.', left: ['SSH', 'HTTPS'], right: ['443', '22'],
          pairs: [[1, 0], [0, 1]],
        },
      ],
    };
    const opened = await handler(event({
      jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'open_quiz', arguments: args },
    }));
    const result = json(opened).result;
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      quizId: expect.stringMatching(/^[a-f0-9]{20}$/), title: 'CCNA Review', topic: 'CCNA',
      difficulty: 'mixed', questionCount: 4, aiGenerated: true,
    });
    expect(result.structuredContent.questions[3].pairs).toEqual([[0, 1], [1, 0]]);
    expect(result.content[0].text).toContain('Opened a 4-question interactive EZ Quiz');

    const repeated = await handler(event({
      jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'open_quiz', arguments: args },
    }));
    expect(json(repeated).result.structuredContent.quizId).toBe(result.structuredContent.quizId);
  });

  test('dispatches cached generate_quiz and render_quiz calls without advertising them', async () => {
    const { handler } = require('../mcp.js');
    const generated = await handler(event({
      jsonrpc: '2.0',
      id: 51,
      method: 'tools/call',
      params: {
        name: 'generate_quiz',
        arguments: { topic: 'CCNA', count: 3, difficulty: 'medium', types: ['MC'] },
      },
    }));
    expect(json(generated).result).toMatchObject({
      structuredContent: {
        topic: 'CCNA',
        questionCount: 3,
        aiGenerated: true,
      },
      _meta: { compatibilityTool: true },
    });
    expect(json(generated).result.structuredContent.questions).toHaveLength(3);

    const rendered = await handler(event({
      jsonrpc: '2.0',
      id: 52,
      method: 'tools/call',
      params: {
        name: 'render_quiz',
        arguments: {
          title: 'Cached quiz',
          topic: 'Basics',
          lines: 'TF|The Earth orbits the Sun.|T\nYN|Does two plus two equal four?|Y',
        },
      },
    }));
    expect(json(rendered).result).toMatchObject({
      structuredContent: {
        title: 'Cached quiz',
        topic: 'Basics',
        questionCount: 2,
        aiGenerated: false,
      },
      _meta: { compatibilityTool: true },
    });

    const listed = await handler(event({ jsonrpc: '2.0', id: 53, method: 'tools/list' }));
    expect(json(listed).result.tools.map((tool) => tool.name)).toEqual(['open_quiz']);
  });

  test.each([
    ['duplicate choices', { title: 'Bad', topic: 'Bad', questions: [{ type: 'MC', text: 'Pick', options: ['Same', 'same'], correct: [0] }] }, 'duplicates'],
    ['bad answer index', { title: 'Bad', topic: 'Bad', questions: [{ type: 'MC', text: 'Pick', options: ['A', 'B'], correct: [2] }] }, 'out-of-range'],
    ['incomplete matching map', { title: 'Bad', topic: 'Bad', questions: [{ type: 'MT', text: 'Match', left: ['A', 'B'], right: ['1', '2'], pairs: [[0, 0], [0, 1]] }] }, 'every left index'],
    ['unsupported fields', { title: 'Bad', topic: 'Bad', source_text: 'Do not send raw source.', questions: [{ type: 'TF', text: 'Valid question', correct: true }] }, 'unsupported field'],
  ])('rejects %s', async (_label, args, message) => {
    const { handler } = require('../mcp.js');
    const response = await handler(event({
      jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'open_quiz', arguments: args },
    }));
    expect(json(response).result.isError).toBe(true);
    expect(json(response).result.content[0].text).toContain(message);
  });

  test('limits a quiz to twenty complete questions', async () => {
    const { handler } = require('../mcp.js');
    const questions = Array.from({ length: 21 }, (_, index) => ({
      type: 'TF', text: `Statement ${index + 1}`, correct: true,
    }));
    const response = await handler(event({
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: { name: 'open_quiz', arguments: { title: 'Too long', topic: 'Limits', questions } },
    }));
    expect(json(response).result.isError).toBe(true);
    expect(json(response).result.content[0].text).toContain('1 to 20');
  });

  test('uses original runner navigation, reports intrinsic height once, and calculates the score once on Finish', async () => {
    const states = [];
    const notifyIntrinsicHeight = jest.fn();
    const { html, script } = widgetDocument();
    mountWidget(html, {
      toolOutput: quiz(), theme: 'dark', maxHeight: 520,
      safeArea: { insets: { top: 4, right: 6, bottom: 8, left: 10 } },
      setWidgetState: (state) => states.push(state),
      notifyIntrinsicHeight,
    });
    window.eval(script);
    await flushWidget();

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.size).toBeUndefined();
    expect(document.documentElement.dataset.constrained).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue('--safe-left')).toBe('10px');
    expect(document.querySelector('#app').style.maxHeight).toBe('');
    expect(document.querySelector('#app').style.height).toBe('');
    expect(document.querySelector('#brandLogo').src).toContain('data:image/png;base64,');
    expect(document.querySelector('h2').textContent).toContain('subnet mask');
    expect(document.querySelector('#check')).toBeNull();
    expect(document.querySelector('#next').textContent).toBe('Next');
    expect(document.querySelector('.question-content').contains(document.querySelector('#next'))).toBe(false);
    expect(document.querySelector('.runner-actions').parentElement).toBe(document.querySelector('.question-layout'));
    expect(html).toContain('--content-pad-x: clamp(18px, 4vw, 24px);');
    expect(html).toContain('padding: 16px var(--content-pad-x) 8px;');
    expect(html).toContain('padding: 9px var(--content-pad-x) 14px;');
    expect(window.parent.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      method: 'ui/notifications/size-changed',
    }), '*');
    expect(notifyIntrinsicHeight).toHaveBeenCalled();

    clickInput('input[value="1"]');
    document.querySelector('#next').click();
    expect(document.querySelector('h2').textContent).toContain('OSPF');
    expect(document.querySelector('#next').textContent).toBe('Finish');
    clickInput('input[value="true"]');
    document.querySelector('#next').click();

    expect(document.querySelector('.results-copy h1').textContent).toBe('Quiz complete');
    expect(document.querySelector('.score-orb').textContent).toBe('2/2');
    expect(states.at(-1)).toMatchObject({ mode: 'results', answers: [[1], true] });
    expect(document.querySelector('.result-stat.correct strong').textContent).toBe('2');
    expect(document.querySelector('.result-stat.missed strong').textContent).toBe('0');
    expect(document.querySelectorAll('.result-actions button')).toHaveLength(2);
    expect(document.querySelector('#retakeMissed').disabled).toBe(true);
    expect(document.querySelector('#retakeAll')).not.toBeNull();
    expect(document.querySelector('.score-orb').textContent).toBe('2/2');
  });

  test('repeated tool-result delivery does not reset the question or inflate the score', () => {
    const output = quiz();
    const states = [];
    const { html, script } = widgetDocument();
    mountWidget(html, { toolOutput: output, setWidgetState: (state) => states.push(state) });
    window.eval(script);

    clickInput('input[value="1"]');
    document.querySelector('#next').click();
    clickInput('input[value="true"]');
    window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { toolOutput: output } } }));
    expect(document.querySelector('h2').textContent).toContain('OSPF');
    expect(document.querySelector('input[value="true"]').checked).toBe(true);
    document.querySelector('#next').click();
    expect(document.querySelector('.score-orb').textContent).toBe('2/2');
    window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { toolOutput: output } } }));
    expect(document.querySelector('.score-orb').textContent).toBe('2/2');
    expect(states.at(-1).mode).toBe('results');
  });

  test('plays a complete quiz returned through the cached generate_quiz contract', async () => {
    const { handler } = require('../mcp.js');
    const generated = await handler(event({
      jsonrpc: '2.0',
      id: 54,
      method: 'tools/call',
      params: {
        name: 'generate_quiz',
        arguments: { topic: 'CCNA', count: 2, difficulty: 'easy', types: ['MC'] },
      },
    }));
    const output = json(generated).result.structuredContent;
    expect(output.questions[0]).toHaveProperty('prompt');

    const { html, script } = widgetDocument();
    mountWidget(html, { toolOutput: output, setWidgetState: jest.fn() });
    window.eval(script);
    expect(document.querySelector('h2').textContent).toContain('Sample Q 1');
    clickInput('input[value="0"]');
    document.querySelector('#next').click();
    expect(document.querySelector('h2').textContent).toContain('Sample Q 2');
    clickInput('input[value="0"]');
    document.querySelector('#next').click();
    expect(document.querySelector('.score-orb').textContent).toBe('2/2');
  });

  test('Previous restores answers and a missed-only retake preserves prior correct answers', () => {
    const { html, script } = widgetDocument();
    mountWidget(html, { toolOutput: quiz(), setWidgetState: jest.fn() });
    window.eval(script);
    clickInput('input[value="1"]');
    document.querySelector('#next').click();
    clickInput('input[value="false"]');
    document.querySelector('#previous').click();
    expect(document.querySelector('input[value="1"]').checked).toBe(true);
    document.querySelector('#next').click();
    expect(document.querySelector('input[value="false"]').checked).toBe(true);
    document.querySelector('#next').click();

    expect(document.querySelector('.score-orb').textContent).toBe('1/2');
    expect(document.querySelector('.result-stat.missed strong').textContent).toBe('1');
    expect(document.querySelector('.result-summary').textContent).toContain('Question 2');
    document.querySelector('#retakeMissed').click();
    expect(document.querySelector('.eyebrow').textContent).toBe('Question 1 of 1');
    expect(document.querySelector('h2').textContent).toContain('OSPF');
    expect(document.querySelector('input[value="false"]').checked).toBe(false);
    clickInput('input[value="true"]');
    document.querySelector('#next').click();
    expect(document.querySelector('.score-orb').textContent).toBe('2/2');
  });

  test('restores persisted runner state for the same quiz', () => {
    const output = quiz();
    const { html, script } = widgetDocument();
    mountWidget(html, {
      toolOutput: output,
      widgetState: {
        version: 2, quizId: output.quizId, mode: 'quiz', attemptIndexes: [0, 1],
        answers: [[1], null], index: 1,
        startedAt: Date.now() - 1000, finishedAt: 0,
      },
      setWidgetState: jest.fn(),
    });
    window.eval(script);
    expect(document.querySelector('h2').textContent).toContain('OSPF');
    document.querySelector('#previous').click();
    expect(document.querySelector('input[value="1"]').checked).toBe(true);
  });

  test('follows system theme and standard safe-area context without launching a modal', async () => {
    const mediaListeners = [];
    window.matchMedia = jest.fn().mockReturnValue({
      matches: true,
      addEventListener: (_name, callback) => mediaListeners.push(callback),
    });
    const requestDisplayMode = jest.fn().mockResolvedValue({ mode: 'fullscreen' });
    const requestModal = jest.fn().mockResolvedValue(undefined);
    const setWidgetState = jest.fn();
    const { html, script } = widgetDocument();
    mountWidget(html, {
      toolOutput: quiz(), displayMode: 'inline', safeAreaInsets: { top: 3, right: 5, bottom: 7, left: 9 },
      requestDisplayMode, requestModal, setWidgetState,
    });
    window.eval(script);
    await flushWidget();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--safe-bottom')).toBe('7px');
    expect(document.querySelector('#expand')).toBeNull();
    expect(requestModal).not.toHaveBeenCalled();
    expect(requestDisplayMode).not.toHaveBeenCalled();
    expect(mediaListeners).toHaveLength(1);
  });

  test('does not feed host height changes back into visual density or a second sizing channel', async () => {
    const requestDisplayMode = jest.fn().mockResolvedValue({ mode: 'fullscreen' });
    const notifyIntrinsicHeight = jest.fn();
    const { html, script } = widgetDocument();
    mountWidget(html, {
      toolOutput: quiz(), displayMode: 'inline', requestDisplayMode,
      containerDimensions: { maxHeight: 420 },
      safeAreaInsets: { top: 5, bottom: 7, left: 4, right: 4 },
      notifyIntrinsicHeight,
    });
    window.eval(script);
    await flushWidget();
    await flushWidget();
    const density = document.querySelector('#root').dataset.density;
    const reportsBeforeHeightChanges = notifyIntrinsicHeight.mock.calls.length;
    [560, 418, 562, 416].forEach((maxHeight) => {
      window.dispatchEvent(new MessageEvent('message', {
        source: window.parent,
        data: {
          jsonrpc: '2.0',
          method: 'ui/notifications/host-context-changed',
          params: { containerDimensions: { maxHeight } },
        },
      }));
    });
    await flushWidget();
    expect(document.documentElement.dataset.size).toBeUndefined();
    expect(document.querySelector('#root').dataset.density).toBe(density);
    expect(html).not.toContain('data-size');
    expect(document.querySelector('#next')).not.toBeNull();
    expect(window.parent.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      method: 'ui/notifications/size-changed',
    }), '*');
    expect(reportsBeforeHeightChanges).toBeGreaterThan(0);
    expect(notifyIntrinsicHeight.mock.calls.length - reportsBeforeHeightChanges).toBeLessThanOrEqual(1);
    expect(requestDisplayMode).not.toHaveBeenCalled();
  });

  test('hydrates a remounted surface from canonical tool response metadata', () => {
    const { html, script } = widgetDocument();
    mountWidget(html, {
      theme: 'light',
      toolResponseMetadata: { mcp_tool_result: { structuredContent: quiz() } },
    });
    window.eval(script);
    expect(document.querySelector('#app').dataset.view).toBe('quiz');
    expect(document.querySelector('h2').textContent).toContain('subnet mask');
  });

  test('uses a painted, full-viewport presentation when the host enters fullscreen', () => {
    const { html, script } = widgetDocument();
    mountWidget(html, {
      toolOutput: quiz(), theme: 'dark', displayMode: 'fullscreen', maxHeight: 860,
      safeArea: { top: 18, right: 4, bottom: 24, left: 4 },
      requestDisplayMode: jest.fn(),
    });
    window.eval(script);
    expect(document.documentElement.dataset.displayMode).toBe('fullscreen');
    expect(document.querySelector('#expand')).toBeNull();
    expect(document.querySelector('#app').style.height).toBe('');
    expect(document.querySelector('#app').dataset.view).toBe('quiz');
    expect(document.querySelector('h2').textContent).toContain('subnet mask');
    expect(html).toContain(':root[data-display-mode="fullscreen"] body');
    expect(html).toContain('min-height: 100svh;');
    expect(html).toContain('background: var(--surface);');
    expect(html).not.toContain(':root[data-display-mode="fullscreen"] body { height: 100%');
  });

  test('compacts a text-heavy question while keeping navigation outside clipped content', () => {
    const longQuiz = quiz({
      questions: [{
        type: 'MC',
        text: 'Which answer best explains how a router selects the most specific matching route for a destination IPv4 address?',
        options: [
          'It compares every matching prefix and selects the route with the longest matching network prefix.',
          'It always selects the route learned first, regardless of prefix length or administrative distance.',
          'It selects the route with the numerically largest next-hop address and ignores the routing table prefix.',
          'It broadcasts the packet to every interface and waits for the destination host to acknowledge receipt.',
        ],
        correct: [0],
      }],
      questionCount: 1,
    });
    const { html, script } = widgetDocument();
    mountWidget(html, { toolOutput: longQuiz, maxHeight: 480 });
    window.eval(script);
    expect(document.querySelector('#root').dataset.density).toBe('tight');
    expect(document.querySelector('.question-content').contains(document.querySelector('#next'))).toBe(false);
    expect(document.querySelector('#next').textContent).toBe('Finish');
    expect(document.querySelector('#app').style.height).toBe('');
    expect(document.querySelector('#app').style.maxHeight).toBe('');
    expect(html).toContain('.ezq-main[data-density="tight"] .answer { min-height: 40px;');
  });

  test('keeps a padded, compact results summary and both retake actions in the card', () => {
    const { html, script } = widgetDocument();
    mountWidget(html, {
      toolOutput: quiz(),
      containerDimensions: { maxHeight: 420 },
      safeAreaInsets: { top: 4, right: 3, bottom: 4, left: 3 },
      setWidgetState: jest.fn(),
    });
    window.eval(script);
    clickInput('input[value="1"]');
    document.querySelector('#next').click();
    clickInput('input[value="false"]');
    document.querySelector('#next').click();
    expect(document.documentElement.dataset.size).toBeUndefined();
    expect(html).toContain('padding: 20px clamp(22px, 5vw, 28px) 22px;');
    expect(document.querySelector('.result-summary').textContent).toContain('Question 2');
    expect(document.querySelectorAll('.result-actions button')).toHaveLength(2);
    expect(document.querySelector('#retakeMissed').disabled).toBe(false);
    expect(document.querySelector('#retakeAll').textContent).toBe('Retake all');
    expect(document.querySelector('.result-list')).toBeNull();
    expect(document.querySelector('[data-explain]')).toBeNull();
    expect(document.querySelector('#app').style.height).toBe('');
    document.querySelector('#retakeAll').click();
    expect(document.querySelector('.eyebrow').textContent).toBe('Question 1 of 2');
  });

  test('shows a terminal unavailable card instead of a retry loop', () => {
    const { html, script } = widgetDocument();
    mountWidget(html, { toolOutput: { status: 'loading' } });
    window.eval(script);
    expect(document.querySelector('.status-card h1').textContent).toBe('Quiz unavailable');
    expect(document.body.textContent).toContain('Ask for a new EZ Quiz');
    expect(document.body.textContent).not.toContain('Try again');
  });

  test('handles notifications, malformed JSON, unsupported methods, and legacy clients', async () => {
    const { handler } = require('../mcp.js');
    const notification = await handler(event({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    expect(notification).toMatchObject({ statusCode: 202, body: '' });
    const malformed = await handler({ httpMethod: 'POST', headers: {}, body: '{' });
    expect(malformed.statusCode).toBe(400);
    expect(json(malformed).error.code).toBe(-32700);
    const unknown = await handler(event({ jsonrpc: '2.0', id: 8, method: 'prompts/list' }));
    expect(json(unknown).error.code).toBe(-32601);
    const ping = await handler(event({ jsonrpc: '2.0', id: 9, method: 'ping' }));
    expect(ping.statusCode).toBe(200);
  });
});
