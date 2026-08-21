'use strict';

const QUIZ_WIDGET_URI = 'ui://ez-quiz/quiz-v1.html';
const QUIZ_WIDGET_MIME_TYPE = 'text/html;profile=mcp-app';

function quizWidgetHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root{color-scheme:light dark;--ink:#171717;--muted:#68707d;--panel:#fff;--soft:#f4f5f7;--line:#d9dde4;--blue:#2f74ee;--purple:#7133d4;--green:#18a566;--yellow:#ffca05}
    *{box-sizing:border-box}body{margin:0;padding:12px;font:15px/1.45 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:transparent}
    .app{max-width:720px;margin:auto;border:1px solid var(--line);border-radius:18px;background:var(--panel);overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,.08)}
    header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;background:linear-gradient(120deg,#1d1d20,#30224b);color:#fff}
    .brand{display:flex;align-items:center;gap:9px;font-weight:900;font-size:18px;letter-spacing:.02em}.bolt{color:var(--yellow);font-size:22px}.tag{font-size:12px;color:#d8dbe3}
    main{padding:16px}.empty h1,.finish h1{margin:0 0 6px;font-size:22px}.empty p,.finish p{margin:0;color:var(--muted)}
    .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.chip{border:1px solid var(--line);border-radius:999px;padding:7px 10px;background:var(--soft);font-size:13px}
    .topline{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.eyebrow{font-weight:700;color:var(--purple)}.score{font-variant-numeric:tabular-nums;color:var(--muted)}
    .progress{height:7px;border-radius:999px;background:var(--soft);overflow:hidden;margin-bottom:18px}.progress>span{display:block;height:100%;background:linear-gradient(90deg,var(--blue),var(--purple));transition:width .2s ease}
    h2{font-size:20px;line-height:1.3;margin:0 0 15px}.answers{display:grid;gap:9px}.answer{display:flex;align-items:flex-start;gap:9px;padding:11px 12px;border:1px solid var(--line);border-radius:12px;background:var(--panel);cursor:pointer}.answer:hover{border-color:var(--blue);background:color-mix(in srgb,var(--blue) 6%,var(--panel))}.answer input{margin-top:3px}
    .match{display:grid;grid-template-columns:minmax(0,1fr) minmax(130px,.8fr);gap:9px;align-items:center}.match select{width:100%;padding:9px;border:1px solid var(--line);border-radius:9px;background:var(--panel);color:var(--ink)}
    .feedback{min-height:24px;margin-top:12px;font-weight:700}.feedback.good{color:var(--green)}.feedback.bad{color:#c43b3b}
    .buttons{display:flex;gap:9px;margin-top:10px}button{border:0;border-radius:11px;padding:10px 15px;font:inherit;font-weight:800;cursor:pointer}.primary{background:var(--blue);color:#fff}.next{background:var(--green);color:#fff}.secondary{background:var(--soft);color:var(--ink);border:1px solid var(--line)}button:disabled{opacity:.5;cursor:not-allowed}
    .note{margin-top:14px;color:var(--muted);font-size:12px}@media(prefers-color-scheme:dark){:root{--ink:#f5f7fb;--muted:#aab1bd;--panel:#202124;--soft:#2b2d31;--line:#41444b}}
    @media(max-width:460px){body{padding:6px}.app{border-radius:14px}main{padding:14px}.match{grid-template-columns:1fr}.buttons{flex-direction:column}button{width:100%}}
  </style>
</head>
<body>
  <section class="app" aria-live="polite">
    <header><div class="brand"><span>EZ</span><span class="bolt">⚡</span><span>QUIZ</span></div><div class="tag">Smart. Simple. Fast. EZ.</div></header>
    <main id="root"><div class="empty"><h1>Ready when you are.</h1><p>Ask ChatGPT to build a quiz from a topic, an attachment, or pasted EZ Quiz lines.</p><div class="actions"><span class="chip">Generate from topic</span><span class="chip">Use an attachment</span><span class="chip">Paste quiz lines</span></div></div></main>
  </section>
  <script>
    (()=>{
      const root=document.getElementById('root');let quiz=null,index=0,score=0,checked=false,nextRequestId=1;const pendingRequests=new Map();
      const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const save=()=>window.openai?.setWidgetState?.({index,score,checked:false});
      function request(method,params){const id=nextRequestId++;window.parent.postMessage({jsonrpc:'2.0',id,method,params},'*');return new Promise((resolve,reject)=>pendingRequests.set(id,{resolve,reject}))}
      function currentOutput(){return window.openai?.toolOutput||null}
      function load(value){const data=value?.structuredContent||value;if(!data||!Array.isArray(data.questions)||!data.questions.length)return;quiz=data;const prior=window.openai?.widgetState||{};index=Math.max(0,Math.min(data.questions.length-1,Number(prior.index)||0));score=Math.max(0,Number(prior.score)||0);checked=false;render()}
      function optionsFor(q){if(q.type==='MC')return q.options.map((o,i)=>'<label class="answer"><input type="'+(q.correct.length>1?'checkbox':'radio')+'" name="answer" value="'+i+'"><span>'+esc(o)+'</span></label>').join('');if(q.type==='TF'||q.type==='YN'){const labels=q.type==='TF'?['True','False']:['Yes','No'];return labels.map((o,i)=>'<label class="answer"><input type="radio" name="answer" value="'+(i===0?'true':'false')+'"><span>'+o+'</span></label>').join('')}if(q.type==='MT')return q.left.map((left,i)=>'<label class="match"><span>'+(i+1)+'. '+esc(left)+'</span><select data-left="'+i+'"><option value="">Choose a match</option>'+q.right.map((right,j)=>'<option value="'+j+'">'+String.fromCharCode(65+j)+'. '+esc(right)+'</option>').join('')+'</select></label>').join('');return ''}
      function isCorrect(q){if(q.type==='MC'){const chosen=[...root.querySelectorAll('input[name=answer]:checked')].map(el=>Number(el.value)).sort((a,b)=>a-b);return JSON.stringify(chosen)===JSON.stringify([...q.correct].sort((a,b)=>a-b))}if(q.type==='TF'||q.type==='YN'){const picked=root.querySelector('input[name=answer]:checked');return !!picked&&String(q.correct)===picked.value}if(q.type==='MT'){const chosen=[...root.querySelectorAll('select[data-left]')].map(el=>[Number(el.dataset.left),Number(el.value)]);return chosen.length===q.matches.length&&q.matches.every(([a,b])=>chosen.some(([x,y])=>x===a&&y===b))}return false}
      function answerText(q){if(q.type==='MC')return q.correct.map(i=>q.options[i]).join(', ');if(q.type==='TF')return q.correct?'True':'False';if(q.type==='YN')return q.correct?'Yes':'No';if(q.type==='MT')return q.matches.map(([a,b])=>(a+1)+'-'+String.fromCharCode(65+b)).join(', ');return ''}
      function render(){if(!quiz)return;const q=quiz.questions[index];const pct=Math.round((index/quiz.questions.length)*100);root.innerHTML='<div class="topline"><span class="eyebrow">Question '+(index+1)+' of '+quiz.questions.length+'</span><span class="score">Score: '+score+'</span></div><div class="progress" aria-label="Quiz progress"><span style="width:'+pct+'%"></span></div><h2>'+esc(q.prompt)+'</h2><div class="answers">'+optionsFor(q)+'</div><div id="feedback" class="feedback" role="status"></div><div class="buttons"><button id="check" class="primary">Check answer</button><button id="next" class="next" hidden>'+(index+1===quiz.questions.length?'See results':'Next question')+'</button></div><p class="note">'+(quiz.aiGenerated?'AI-generated quiz. Check important facts against your source.':'Quiz content supplied by the user.')+'</p>';root.querySelector('#check').onclick=()=>{if(checked)return;const ok=isCorrect(q);checked=true;if(ok)score++;const feedback=root.querySelector('#feedback');feedback.className='feedback '+(ok?'good':'bad');feedback.textContent=ok?'Correct!':'Not quite. Correct answer: '+answerText(q);root.querySelectorAll('input,select').forEach(el=>el.disabled=true);root.querySelector('#check').hidden=true;root.querySelector('#next').hidden=false};root.querySelector('#next').onclick=()=>{if(index+1>=quiz.questions.length){finish();return}index++;checked=false;save();render()}}
      function finish(){save();root.innerHTML='<div class="finish"><h1>'+score+' / '+quiz.questions.length+'</h1><p>'+(score===quiz.questions.length?'Perfect score.':score>=Math.ceil(quiz.questions.length*.7)?'Nice work.':'Good run—review the misses and try again.')+'</p><div class="buttons"><button id="restart" class="secondary">Try again</button></div><p class="note">'+esc(quiz.title||'EZ Quiz')+'</p></div>';root.querySelector('#restart').onclick=()=>{index=0;score=0;checked=false;save();render()}}
      window.addEventListener('message',event=>{if(event.source!==window.parent)return;const message=event.data;if(!message||message.jsonrpc!=='2.0')return;if(message.id!==undefined&&pendingRequests.has(message.id)){const pending=pendingRequests.get(message.id);pendingRequests.delete(message.id);if(message.error)pending.reject(message.error);else pending.resolve(message.result);return}if(message.method==='ui/notifications/tool-result')load(message.params)});
      load(currentOutput());
      request('ui/initialize',{protocolVersion:'2025-11-21',appInfo:{name:'ez-quiz-player',title:'EZ Quiz',version:'1.0.0',websiteUrl:'https://ez-quiz.app'},appCapabilities:{}}).then(()=>window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*')).catch(()=>{});
    })();
  </script>
</body>
</html>`;
}

module.exports = { QUIZ_WIDGET_MIME_TYPE, QUIZ_WIDGET_URI, quizWidgetHtml };
