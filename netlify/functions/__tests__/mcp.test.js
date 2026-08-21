'use strict';

function event(body, overrides = {}) {
  return { httpMethod: 'POST', headers: {}, body: JSON.stringify(body), ...overrides };
}

function json(response) {
  return response.body ? JSON.parse(response.body) : null;
}

describe('EZ Quiz MCP server', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, AI_PROVIDER: 'echo' };
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
    expect(listedTools[0]._meta.ui.resourceUri).toBe('ui://ez-quiz/quiz-v2.html');
    expect(listedTools[0].annotations.openWorldHint).toBe(true);
    expect(listedTools[1]._meta.ui.visibility).toEqual(['app']);
    expect(listedTools[1]._meta['openai/visibility']).toBe('private');
  });

  test('serves a self-contained MCP Apps quiz component', async () => {
    const { handler } = require('../mcp.js');
    const res = await handler(event({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'ui://ez-quiz/quiz-v2.html' } }));
    const resource = json(res).result.contents[0];
    expect(resource.mimeType).toBe('text/html;profile=mcp-app');
    expect(resource._meta.ui).toMatchObject({ domain: 'https://ez-quiz.app', csp: { connectDomains: [], resourceDomains: [] } });
    expect(resource.text).toContain('EZ');
    expect(resource.text).toContain('ui/notifications/tool-result');
    expect(resource.text).toContain("request('ui/initialize'");
    expect(resource.text).toContain('Building your quiz...');
    expect(resource.text).toContain("name:'build_quiz'");
    expect(resource.text).toContain('@media(max-width:370px)');
    expect(resource.text).not.toMatch(/<script[^>]+src=/i);
  });

  test('the component runs a quiz and checks an answer', () => {
    const { quizWidgetHtml } = require('../lib/mcpQuizWidget.js');
    const toolOutput = {
      title: 'One question',
      topic: 'Arithmetic',
      aiGenerated: true,
      questions: [{ type: 'MC', prompt: 'What is 2 + 2?', options: ['3', '4'], correct: [1] }],
    };
    const states = [];
    const html = quizWidgetHtml();
    const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
    document.documentElement.innerHTML = html.replace(/<script>[\s\S]*<\/script>/, '');
    window.openai = { toolOutput, setWidgetState: (state) => states.push(state) };
    window.eval(script);
    expect(document.querySelector('h2').textContent).toBe('What is 2 + 2?');
    document.querySelector('input[value="1"]').click();
    document.querySelector('#check').click();
    expect(document.querySelector('#feedback').textContent).toBe('Correct!');
    expect(document.querySelector('#next').hidden).toBe(false);
    document.querySelector('#next').click();
    expect(document.querySelector('.finish h1').textContent).toBe('Quiz complete');
    expect(document.querySelector('.result-score').textContent).toContain('1out of 1');
    expect(states.length).toBeGreaterThan(0);
    delete window.openai;
  });

  test('the component shows loading while the app-only build tool runs', async () => {
    const { quizWidgetHtml } = require('../lib/mcpQuizWidget.js');
    const html = quizWidgetHtml();
    const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
    document.documentElement.innerHTML = html.replace(/<script>[\s\S]*<\/script>/, '');
    window.openai = {
      toolInput: { topic: 'Dolphins', count: 3, difficulty: 'medium' },
      toolOutput: { status: 'loading', topic: 'Dolphins', count: 3, difficulty: 'medium' },
    };
    const originalPostMessage = window.postMessage;
    window.postMessage = jest.fn((message) => {
      if (message.method !== 'tools/call') return;
      expect(message.params).toMatchObject({ name: 'build_quiz', arguments: { topic: 'Dolphins', count: 3 } });
      queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', {
        source: window,
        data: {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            structuredContent: {
              title: 'Dolphins', topic: 'Dolphins', aiGenerated: true, questionCount: 1, lines: 'TF|Dolphins are mammals.|T',
              questions: [{ type: 'TF', prompt: 'Dolphins are mammals.', correct: true }],
            },
          },
        },
      })));
    });

    window.eval(script);
    expect(document.querySelector('.loading-card')).not.toBeNull();
    expect(document.querySelector('#loadingCount').textContent).toBe('Creating 3 questions');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('h2').textContent).toBe('Dolphins are mammals.');

    window.postMessage = originalPostMessage;
    delete window.openai;
  });

  test('opens the loading UI before the app-only tool generates the quiz', async () => {
    const { handler } = require('../mcp.js');
    const args = { topic: 'Network ports', count: 4, types: ['MC'], difficulty: 'medium' };
    const started = await handler(event({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'generate_quiz', arguments: args } }));
    expect(json(started).result.structuredContent).toEqual({ status: 'loading', topic: 'Network ports', count: 4, difficulty: 'medium' });
    expect(json(started).result._meta.generateRequest).toEqual(args);

    const res = await handler(event({ jsonrpc: '2.0', id: 41, method: 'tools/call', params: { name: 'build_quiz', arguments: args } }));
    const result = json(res).result;
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ topic: 'Network ports', questionCount: 4, aiGenerated: true });
    expect(result.structuredContent.questions).toHaveLength(4);
    expect(result.content[0].text).toContain('generated by AI');
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
