'use strict';

function event(body, overrides = {}) {
  return { httpMethod: 'POST', headers: {}, body: JSON.stringify(body), ...overrides };
}

function json(response) {
  return response.body ? JSON.parse(response.body) : null;
}

function widgetScript() {
  const { quizWidgetHtml } = require('../lib/mcpQuizWidget.js');
  const html = quizWidgetHtml();
  return { html, script: html.match(/<script>([\s\S]*)<\/script>/)[1] };
}

function mountWidget(html, openai) {
  document.documentElement.innerHTML = html.replace(/<script>[\s\S]*<\/script>/, '');
  window.openai = openai;
}

function mockJsonResponse(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

async function flushWidget() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('EZ Quiz MCP server', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      AI_PROVIDER: 'echo',
      EZQ_PLUGIN_API_ORIGIN: 'https://preview.ez-quiz.test',
    };
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  afterEach(() => {
    delete window.openai;
    delete window.fetch;
    jest.useRealTimers();
  });

  afterAll(() => { process.env = originalEnv; });

  test('negotiates MCP and advertises tools and resources', async () => {
    const { handler } = require('../mcp.js');
    const initialized = await handler(event({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }));
    expect(initialized.statusCode).toBe(200);
    expect(json(initialized).result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'ez-quiz' } });
    expect(json(initialized).result.capabilities).toHaveProperty('tools');
    expect(json(initialized).result.capabilities).toHaveProperty('resources');

    const listed = await handler(event({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
    const listedTools = json(listed).result.tools;
    expect(listedTools.map((tool) => tool.name)).toEqual(['generate_quiz', 'build_quiz', 'render_quiz']);
    expect(listedTools[0]._meta.ui.resourceUri).toBe('ui://ez-quiz/quiz-v1.html');
    expect(listedTools[0].annotations.openWorldHint).toBe(true);
    expect(listedTools[1]._meta.ui.visibility).toEqual(['app']);
    expect(listedTools[1]._meta['openai/visibility']).toBe('private');
  });

  test('serves a self-contained MCP Apps quiz component', async () => {
    const { handler } = require('../mcp.js');
    const res = await handler(event({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'ui://ez-quiz/quiz-v1.html' } }));
    const resource = json(res).result.contents[0];
    expect(resource.mimeType).toBe('text/html;profile=mcp-app');
    expect(resource._meta.ui).toMatchObject({
      domain: 'https://ez-quiz.app',
      csp: {
        connectDomains: ['https://preview.ez-quiz.test', 'https://ez-quiz.app'],
        resourceDomains: ['https://ez-quiz.app'],
      },
    });
    expect(resource.text).toContain('EZ');
    expect(resource.text).toContain('brand-title-source-light.png');
    expect(resource.text).toContain('ui/notifications/tool-result');
    expect(resource.text).toContain("request('ui/initialize'");
    expect(resource.text).toContain('Building your quiz...');
    expect(resource.text).toContain('Cancel generation');
    expect(resource.text).toContain('notifyIntrinsicHeight');
    expect(resource.text).toContain('safeArea');
    expect(resource.text).toContain('openai:set_globals');
    expect(resource.text).not.toContain("name:'build_quiz'");
    expect(resource.text).not.toContain("request('tools/call'");
    expect(resource.text).toContain('@media (max-width: 360px)');
    expect(resource.text).not.toMatch(/<script[^>]+src=/i);
  });

  test('keeps cached widget template URIs compatible across revisions', async () => {
    const { handler } = require('../mcp.js');
    const listed = await handler(event({ jsonrpc: '2.0', id: 31, method: 'resources/list' }));
    expect(json(listed).result.resources.map((resource) => resource.uri)).toEqual([
      'ui://ez-quiz/quiz-v1.html',
      'ui://ez-quiz/quiz-v2.html',
    ]);

    for (const uri of ['ui://ez-quiz/quiz-v1.html', 'ui://ez-quiz/quiz-v2.html']) {
      const read = await handler(event({ jsonrpc: '2.0', id: 32, method: 'resources/read', params: { uri } }));
      expect(json(read).result.contents[0]).toMatchObject({ uri, mimeType: 'text/html;profile=mcp-app' });
    }
  });

  test('the component runs a quiz and checks an answer', () => {
    const toolOutput = {
      title: 'One question',
      topic: 'Arithmetic',
      aiGenerated: true,
      questions: [{ type: 'MC', prompt: 'What is 2 + 2?', options: ['3', '4'], correct: [1] }],
    };
    const states = [];
    const heights = [];
    const { html, script } = widgetScript();
    mountWidget(html, {
      toolOutput,
      theme: 'dark',
      maxHeight: 520,
      safeArea: { insets: { top: 4, right: 6, bottom: 8, left: 10 } },
      setWidgetState: (state) => states.push(state),
      notifyIntrinsicHeight: () => heights.push(true),
    });
    window.eval(script);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.compact).toBe('true');
    expect(document.documentElement.style.getPropertyValue('--safe-left')).toBe('10px');
    expect(document.querySelector('#brandLogo').src).toContain('brand-title-source.png');
    expect(document.querySelector('h2').textContent).toBe('What is 2 + 2?');
    document.querySelector('input[value="1"]').click();
    document.querySelector('#check').click();
    expect(document.querySelector('#feedback').textContent).toBe('Correct!');
    expect(document.querySelector('#next').hidden).toBe(false);
    document.querySelector('#next').click();
    expect(document.querySelector('.finish h1').textContent).toBe('Quiz complete');
    expect(document.querySelector('.result-score').textContent).toContain('1out of 1');
    expect(states.length).toBeGreaterThan(0);
    expect(document.querySelector('#retake').textContent).toBe('Retake quiz');
  });

  test('the component triggers and polls the async job without calling an app-only MCP tool', async () => {
    const jobId = `qj_${'a'.repeat(32)}`;
    const workerToken = 'b'.repeat(32);
    const { html, script } = widgetScript();
    mountWidget(html, {
      toolInput: { topic: 'Dolphins', count: 3, difficulty: 'medium' },
      toolOutput: { status: 'loading', topic: 'Dolphins', count: 3, difficulty: 'medium' },
      toolResponseMetadata: {
        mcp_tool_result: {
          _meta: {
            generateRequest: { topic: 'Dolphins', count: 3, difficulty: 'medium' },
            generation: {
              jobId,
              workerToken,
              requestedCount: 3,
              workerUrl: 'https://preview.ez-quiz.test/.netlify/functions/generate-quiz-worker-background',
              statusUrl: 'https://preview.ez-quiz.test/.netlify/functions/generate-quiz-status',
              stopUrl: 'https://preview.ez-quiz.test/.netlify/functions/generate-quiz-stop',
            },
          },
        },
      },
    });
    window.fetch = jest.fn((url) => {
      if (String(url).includes('worker-background')) return mockJsonResponse({ status: 'queued' }, 202);
      if (String(url).includes('generate-quiz-status')) {
        return mockJsonResponse({
          jobId,
          status: 'complete',
          topic: 'Dolphins',
          title: 'Dolphins',
          requestedCount: 3,
          completedCount: 1,
          questions: ['TF|Dolphins are mammals.|T'],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    window.eval(script);
    expect(document.querySelector('.loading-card')).not.toBeNull();
    expect(document.querySelector('#loadingCount').textContent).toBe('Creating 3 questions');
    await flushWidget();
    expect(document.querySelector('h2').textContent).toBe('Dolphins are mammals.');
    expect(window.fetch).toHaveBeenCalledTimes(2);
    expect(window.fetch.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(window.fetch.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${workerToken}`);
  });

  test('the component cancels an active generation job', async () => {
    const jobId = `qj_${'c'.repeat(32)}`;
    const workerToken = 'd'.repeat(32);
    const generation = {
      jobId,
      workerToken,
      requestedCount: 5,
      workerUrl: 'https://preview.ez-quiz.test/.netlify/functions/generate-quiz-worker-background',
      statusUrl: 'https://preview.ez-quiz.test/.netlify/functions/generate-quiz-status',
      stopUrl: 'https://preview.ez-quiz.test/.netlify/functions/generate-quiz-stop',
    };
    const { html, script } = widgetScript();
    mountWidget(html, {
      toolInput: { topic: 'CCNA', count: 5, difficulty: 'medium' },
      toolOutput: { status: 'loading', topic: 'CCNA', count: 5, difficulty: 'medium' },
      toolResponseMetadata: { mcp_tool_result: { _meta: { generation, generateRequest: { topic: 'CCNA', count: 5, difficulty: 'medium' } } } },
      sendFollowUpMessage: jest.fn(),
    });
    window.fetch = jest.fn((url) => {
      if (String(url).includes('worker-background')) return mockJsonResponse({ status: 'queued' }, 202);
      if (String(url).includes('generate-quiz-status')) {
        return mockJsonResponse({ jobId, status: 'running', requestedCount: 5, completedCount: 0, progressMessage: 'Writing questions.' });
      }
      if (String(url).includes('generate-quiz-stop')) {
        return mockJsonResponse({ jobId, status: 'stopped', requestedCount: 5, completedCount: 0, progressMessage: 'Generation stopped before any questions were ready.' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    window.eval(script);
    await flushWidget();
    document.querySelector('#cancelGeneration').click();
    await flushWidget();

    expect(document.querySelector('.status-card h1').textContent).toBe('Quiz generation stopped');
    const stopCall = window.fetch.mock.calls.find(([url]) => String(url).includes('generate-quiz-stop'));
    expect(stopCall[1]).toMatchObject({ method: 'POST' });
    expect(stopCall[1].headers.Authorization).toBe(`Bearer ${workerToken}`);
  });

  test('an old loading card starts fresh instead of retrying the missing build resource', async () => {
    const sendFollowUpMessage = jest.fn().mockResolvedValue(undefined);
    const { html, script } = widgetScript();
    mountWidget(html, {
      toolInput: { topic: 'CCNA', count: 5, difficulty: 'medium' },
      toolOutput: { status: 'loading', topic: 'CCNA', count: 5, difficulty: 'medium' },
      sendFollowUpMessage,
    });

    window.eval(script);
    await new Promise((resolve) => setTimeout(resolve, 380));
    expect(document.querySelector('.status-card h1').textContent).toBe('This quiz card expired');
    expect(document.body.textContent).toContain('instead of retrying this broken card');
    document.querySelector('[data-start-fresh]').click();
    await flushWidget();
    expect(sendFollowUpMessage).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Create a fresh 5-question medium-difficulty EZ Quiz about CCNA.',
    }));
  });

  test('opens the loading UI with a private async generation capability', async () => {
    const { handler } = require('../mcp.js');
    const args = { topic: 'Network ports', count: 4, types: ['MC'], difficulty: 'medium' };
    const started = await handler(event({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'generate_quiz', arguments: args } }));
    expect(json(started).result.structuredContent).toEqual({ status: 'loading', topic: 'Network ports', count: 4, difficulty: 'medium' });
    expect(json(started).result._meta.generateRequest).toEqual(args);
    expect(json(started).result._meta.generation).toMatchObject({
      jobId: expect.stringMatching(/^qj_/),
      workerToken: expect.stringMatching(/^[A-Za-z0-9_-]{24,96}$/),
      requestedCount: 4,
      workerUrl: 'https://preview.ez-quiz.test/.netlify/functions/generate-quiz-worker-background',
      statusUrl: 'https://preview.ez-quiz.test/.netlify/functions/generate-quiz-status',
      stopUrl: 'https://preview.ez-quiz.test/.netlify/functions/generate-quiz-stop',
    });

    const res = await handler(event({ jsonrpc: '2.0', id: 41, method: 'tools/call', params: { name: 'build_quiz', arguments: args } }));
    const result = json(res).result;
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ topic: 'Network ports', questionCount: 4, aiGenerated: true });
    expect(result.structuredContent.questions).toHaveLength(4);
    expect(result.content[0].text).toContain('generated by AI');
  });

  test('starts jobs through the deployed endpoint when running on Netlify', async () => {
    process.env.NETLIFY = 'true';
    const jobId = `qj_${'n'.repeat(32)}`;
    const workerToken = 't'.repeat(32);
    global.fetch = jest.fn().mockResolvedValue({
      status: 202,
      text: async () => JSON.stringify({
        jobId,
        workerToken,
        requestedCount: 5,
        progressMessage: 'Generation job queued.',
      }),
    });
    const { handler } = require('../mcp.js');
    const started = await handler(event({
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/call',
      params: {
        name: 'generate_quiz',
        arguments: { topic: 'CCNA', count: 5, difficulty: 'medium' },
      },
    }));
    const result = json(started).result;

    expect(result.isError).not.toBe(true);
    expect(result._meta.generation).toMatchObject({ jobId, workerToken });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://preview.ez-quiz.test/.netlify/functions/generate-quiz-start',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({
      topic: 'CCNA',
      count: 5,
      format: 'legacy-lines',
    });
  });

  test('renders valid pasted lines and rejects malformed lines', async () => {
    const { handler } = require('../mcp.js');
    const valid = await handler(event({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'render_quiz', arguments: { title: 'Basics', lines: 'TF|The sky appears blue.|T\nYN|Is two even?|Y' } } }));
    expect(json(valid).result.structuredContent).toMatchObject({ title: 'Basics', questionCount: 2, aiGenerated: false });

    const invalid = await handler(event({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'render_quiz', arguments: { lines: 'not a quiz line' } } }));
    expect(json(invalid).result.isError).toBe(true);
    expect(json(invalid).result.content[0].text).toContain('Line 1');
  });

  test('handles notifications, malformed JSON, and unsupported methods correctly', async () => {
    const { handler } = require('../mcp.js');
    const notification = await handler(event({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    expect(notification).toMatchObject({ statusCode: 202, body: '' });

    const malformed = await handler({ httpMethod: 'POST', headers: {}, body: '{' });
    expect(malformed.statusCode).toBe(400);
    expect(json(malformed).error.code).toBe(-32700);

    const unknown = await handler(event({ jsonrpc: '2.0', id: 7, method: 'prompts/list' }));
    expect(json(unknown).error.code).toBe(-32601);
  });

  test('does not require the old beta opt-in header', async () => {
    const { handler } = require('../mcp.js');
    const res = await handler(event({ jsonrpc: '2.0', id: 8, method: 'ping' }));
    expect(res.statusCode).toBe(200);
  });
});
