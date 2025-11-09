import { S } from './state.js';
import { runParseFlow } from './generator.js?v=1.5.25';

const shareBtn = document.getElementById('shareQuizBtn');
const shareLink = document.getElementById('shareLink');
const bag = (window.__EZQ__ = window.__EZQ__ || window.EZQ || {});

const prevOnQuizReady = typeof bag.onQuizReady === 'function' ? bag.onQuizReady : null;
bag.onQuizReady = function handleQuizReady(quiz){
  if(prevOnQuizReady){
    try { prevOnQuizReady(quiz); } catch {}
  }
  if(!quiz || !Array.isArray(quiz.questions) || !Array.isArray(quiz.answers)) return;
  bag._lastQuiz = quiz;
  if(shareBtn){
    shareBtn.classList.remove('hidden');
    shareBtn.disabled = false;
  }
  if(shareLink){
    shareLink.classList.add('hidden');
    shareLink.value = '';
  }
};

bag.loadQuestions = function loadQuestions(lines){
  if(!Array.isArray(lines) || !lines.length) return;
  const sanitized = lines.map((line) => String(line || '').trim()).filter(Boolean);
  if(!sanitized.length) return;
  const text = sanitized.join('\n');
  const editor = document.getElementById('editor');
  if(editor){
    editor.value = text;
    try { editor.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
  }
  const topicInput = document.getElementById('topicInput');
  if(topicInput && S.title){ topicInput.value = S.title; }
  try {
    runParseFlow(text, S.title || 'Shared Quiz', S.title || '');
    const statusBox = document.getElementById('status');
    if(statusBox) statusBox.textContent = 'Loaded shared quiz.';
  } catch (err) {
    console.error('load shared failed', err);
    alert('Shared quiz not found.');
  }
};

async function saveAndShare(){
  if(!bag._lastQuiz){
    alert('Generate or parse a quiz first.');
    return;
  }
  const confirmed = window.confirm('Sharing creates a public link. Make sure no personal info is in your quiz. Continue?');
  if(!confirmed) return;
  if(shareBtn){ shareBtn.disabled = true; }
  try {
    const quiz = bag._lastQuiz;
    if(!Array.isArray(quiz.questions) || !quiz.questions.length) throw new Error('No quiz in state');
    if(!Array.isArray(quiz.answers) || !quiz.answers.length) throw new Error('Missing answers');
    const res = await fetch('/.netlify/functions/save-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: quiz.title || S.quiz?.title || 'EZ-Quiz',
        questions: quiz.questions,
        answers: quiz.answers,
      }),
    });
    const data = await res.json();
    if(!res.ok || !data.ok) throw new Error(data.error || 'save_failed');
    const path = data.path || `/q/${data.id}`;
    const fullUrl = new URL(path, window.location.origin).toString();
    if(shareLink){
      shareLink.value = fullUrl;
      shareLink.classList.remove('hidden');
      shareLink.removeAttribute('disabled');
      try {
        shareLink.focus();
        shareLink.select();
      } catch {}
    }
    try {
      await navigator.clipboard.writeText(fullUrl);
    } catch {}
  } catch (err) {
    console.error('share failed', err);
    alert('Could not save quiz. Try again.');
  } finally {
    if(shareBtn) shareBtn.disabled = false;
  }
}

shareBtn?.addEventListener('click', saveAndShare);

(async function bootShared(){
  const match = window.location.pathname.match(/^\/q\/([a-f0-9]{16})$/i);
  if(!match) return;
  try {
    const id = match[1];
    const url = `/.netlify/functions/get-quiz?id=${encodeURIComponent(id)}`;
    const res = await fetch(url);
    const data = await res.json();
    if(!res.ok || !data.ok) throw new Error(data.error || 'load_failed');
    const q = data.quiz;
    if(!q || !Array.isArray(q.questions)) throw new Error('Invalid payload');
    S.title = q.title || 'Shared Quiz';
    bag.loadQuestions(q.questions);
  } catch (err) {
    console.error('load shared quiz failed', err);
    alert('Shared quiz not found.');
  }
})();
