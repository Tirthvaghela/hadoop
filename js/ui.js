/* ===== BDA Lab UI ===== */
(function () {
'use strict';
const C = window.CONTENT, J = window.JAVA;
const KEY = 'bdaLab.v1.';
const load = (k, d) => { try { const v = localStorage.getItem(KEY + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) {} };
const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ---------- machine ---------- */
let m;
try { m = new SIM.Machine(load('machine', null) || undefined); } catch (e) { m = new SIM.Machine(); }
let state = Object.assign({ tab: 'term', unit: 'u1', lab: 'l1' }, load('ui', {}));
const done = load('done', {});
const labDone = load('labs', {});
let saveTimer = null;
const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { save('machine', m.snapshot()); save('labs', labDone); }, 300); };

/* ---------- terminal output ---------- */
const screen = () => $('#screen');
const outBox = () => $('#out');
function lineHTML(text) {
  let html = '', open = false;
  const parts = text.split('\u001b');
  html += esc(parts[0]);
  for (let i = 1; i < parts.length; i++) {
    const code = parts[i][0], rest = esc(parts[i].slice(1));
    if (open) { html += '</span>'; open = false; }
    if (code === '0') { html += rest; continue; }
    html += `<span class="c${code}">` + rest; open = true;
  }
  if (open) html += '</span>';
  return html || '&#8203;';
}
function write(text, cls) {
  const box = outBox(); if (!box) return;
  if (cls === 'clear') { box.innerHTML = ''; return; }
  const frag = document.createDocumentFragment();
  for (const l of String(text).split('\n')) { const d = document.createElement('div'); d.className = 'ln' + (cls ? ' t-' + cls : ''); d.innerHTML = lineHTML(l); frag.appendChild(d); }
  box.appendChild(frag);
  while (box.childNodes.length > 4000) box.removeChild(box.firstChild);
}
function promptHTML() {
  const p = m.prompt();
  if (p.user) return `<span class="pu">${p.user}</span>:<span class="pp">${esc(p.path)}</span>$ `;
  return esc(p.sym);
}
function renderPrompt() { const el = $('#prompt'); if (el) el.innerHTML = promptHTML(); updateStatus(); }
function scrollDown() { const s = screen(); if (s) s.scrollTop = s.scrollHeight; }
m.on((text, cls, ev) => {
  if (text === null && cls === 'event') { onEvent(ev); return; }
  write(text, cls); scrollDown();
});

/* ---------- input queue ---------- */
const queue = []; let busy = false; const hist = []; let hi = -1;
function enqueue(item) { queue.push(item); pump(); }
async function pump() {
  if (busy) return; busy = true;
  try {
    while (queue.length) {
      const it = queue.shift();
      if (typeof it === 'object' && it.snippet) { const lines = m.linesFor(it.snippet.m, it.snippet.code); queue.unshift(...lines); continue; }
      if (typeof it === 'object' && it.fn) { it.fn(); continue; }
      const line = String(it);
      const box = outBox();
      if (box) { const d = document.createElement('div'); d.className = 'ln echo'; d.innerHTML = promptHTML() + esc(line); box.appendChild(d); }
      renderPrompt();
      try { await m.feed(line); } catch (e) { write('simulator error: ' + (e && e.message), 'err'); console.error(e); }
      renderPrompt(); scrollDown(); checkLabs(null); persist();
    }
  } finally { busy = false; renderPrompt(); scrollDown(); }
}
function cancelInput() {
  const mode = m.modes[m.modes.length - 1];
  write(promptHTMLText() + ($('#cmd').value || '') + '^C', '');
  $('#cmd').value = '';
  queue.length = 0;
  m.heredoc = null; m.cont = null; m.pending = []; m.pendingPrompt = null;
  if (mode && mode.cancel) mode.cancel();
  renderPrompt(); scrollDown();
}
function promptHTMLText() { const p = m.prompt(); return p.user ? `${p.user}:${p.path}$ ` : p.sym; }

/* ---------- nano ---------- */
m.editor = (name, text) => new Promise((resolve) => {
  const ov = $('#nano'); const ta = $('#nano-ta'); const st = $('#nano-status'); const ttl = $('#nano-title');
  let saved = null, current = text, asking = false;
  ttl.textContent = name; ta.value = text; ov.hidden = false; st.textContent = text ? `[ Read ${text.split('\n').length - (text.endsWith('\n') ? 1 : 0)} lines ]` : '[ New File ]';
  const modified = () => ta.value !== (saved === null ? text : saved);
  const upd = () => { $('#nano-mod').textContent = modified() ? 'Modified' : ''; };
  const doSave = () => { let v = ta.value; if (v && !v.endsWith('\n')) v += '\n'; saved = v; ta.value = v; st.textContent = `[ Wrote ${v ? v.split('\n').length - 1 : 0} lines ]`; upd(); };
  const close = (val) => { ov.hidden = true; ta.removeEventListener('keydown', onKey); ta.removeEventListener('input', upd); $('#nano-save').onclick = $('#nano-exit').onclick = null; $('#nano-ask').hidden = true; resolve(val); setTimeout(() => $('#cmd').focus(), 0); };
  const exit = () => { if (modified()) { asking = true; $('#nano-ask').hidden = false; st.textContent = ''; return; } close(saved); };
  const answer = (k) => { asking = false; $('#nano-ask').hidden = true; if (k === 'y') { doSave(); close(saved); } else if (k === 'n') close(saved); else { st.textContent = '[ Cancelled ]'; ta.focus(); } };
  function onKey(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (asking) { e.preventDefault(); const k = e.key.toLowerCase(); if (k === 'y' || k === 'n') answer(k); else if ((ctrl && k === 'c') || k === 'escape') answer('c'); return; }
    if (ctrl && (e.key === 'o' || e.key === 'O' || e.key === 's' || e.key === 'S')) { e.preventDefault(); doSave(); return; }
    if (ctrl && (e.key === 'x' || e.key === 'X')) { e.preventDefault(); exit(); return; }
    if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('    ', s, ta.selectionEnd, 'end'); upd(); }
  }
  ta.addEventListener('keydown', onKey); ta.addEventListener('input', upd);
  $('#nano-save').onclick = () => { doSave(); ta.focus(); };
  $('#nano-exit').onclick = () => exit();
  $('#nano-y').onclick = () => answer('y'); $('#nano-n').onclick = () => answer('n'); $('#nano-c').onclick = () => answer('c');
  upd(); setTimeout(() => ta.focus(), 0);
});

/* ---------- status ---------- */
function updateStatus() {
  const s = $('#status'); if (!s) return;
  const mode = m.mode();
  s.innerHTML = `<span class="pill ${m.svc.dfs ? 'on' : ''}"><i></i>HDFS</span><span class="pill ${m.svc.yarn ? 'on' : ''}"><i></i>YARN</span><span class="pill mode">${mode === 'bash' ? 'bash' : mode === 'hive' ? 'hive&gt;' : 'pyspark'}</span>`;
}

/* ---------- labs ---------- */
function labById(id) { return C.LABS.find(l => l.id === id) || C.LABS[0]; }
function onEvent(ev) { checkLabs(ev); if (ev && ev.kind === 'svc') updateStatus(); }
function checkLabs(ev) {
  let changed = false;
  for (const lab of C.LABS) {
    const d = labDone[lab.id] || (labDone[lab.id] = []);
    lab.steps.forEach((st, i) => { if (d.includes(i)) return; let ok = false; try { ok = st.ok(m, ev); } catch (e) { ok = false; } if (ok) { d.push(i); changed = true; if (lab.id === state.lab) flash(i); } });
  }
  if (changed) { renderLab(); persist(); }
}
let flashIdx = null;
function flash(i) { flashIdx = i; }
const modeOf = (c) => /^\s*(CREATE|SELECT|USE|SHOW|DESCRIBE|ALTER|DROP|LOAD|INSERT|EXPORT|IMPORT|SET)\b/i.test(c) ? 'hive' : (/^\s*(df|rdd|emp|print|from |import |sc\.|spark|nums)/.test(c) || /lambda/.test(c) || /^\s*\w+\s+=\s/.test(c)) ? 'py' : 'bash';
const WHERE = { bash: ['$', 'Linux terminal ($ prompt)'], hive: ['hive>', 'inside the Hive shell (hive> prompt)'], py: ['>>>', 'inside PySpark (>>> prompt)'] };
function renderLab() {
  const box = $('#lab'); if (!box) return;
  const units = [...new Set(C.LABS.map(l => l.unit))];
  let lab = labById(state.lab);
  if (!state.labUnit) state.labUnit = lab.unit;
  if (lab.unit !== state.labUnit) lab = C.LABS.find(l => l.unit === state.labUnit) || lab;
  state.lab = lab.id;
  const d = labDone[lab.id] || [];
  const nDone = lab.steps.filter((_, i) => d.includes(i)).length;
  const next = lab.steps.findIndex((_, i) => !d.includes(i));
  const labsHere = C.LABS.filter(l => l.unit === state.labUnit);
  const unitProg = (u) => { const ls = C.LABS.filter(l => l.unit === u); const t = ls.reduce((a, l) => a + l.steps.length, 0); const k = ls.reduce((a, l) => a + l.steps.filter((_, i) => (labDone[l.id] || []).includes(i)).length, 0); return [k, t]; };
  box.innerHTML = `
    <span class="eyebrow">Practice guide</span>
    <div class="uchips" role="tablist">${units.map(u => { const [k, t] = unitProg(u); return `<button class="uchip" role="tab" aria-selected="${u === state.labUnit}" data-lunit="${u}">${u}<small>${k}/${t}</small></button>`; }).join('')}</div>
    <div class="labs">${labsHere.map((l, i) => { const dd = l.steps.filter((_, j) => (labDone[l.id] || []).includes(j)).length; const full = dd === l.steps.length; return `<button class="labbtn ${l.id === lab.id ? 'on' : ''} ${full ? 'full' : ''}" data-lab="${l.id}"><span class="ln-no">${full ? '✓' : String.fromCharCode(65 + i)}</span><span class="lt">${esc(l.title)}</span><span class="lc">${dd}/${l.steps.length}</span></button>`; }).join('')}</div>
    <div class="labhead">
      <h3>${esc(lab.title)}</h3>
      ${lab.intro ? `<p class="labintro">${esc(lab.intro)}</p>` : ''}
      <div class="lab-prog"><span>${nDone} / ${lab.steps.length} steps</span><span class="bar"><i style="width:${(nDone / lab.steps.length) * 100}%"></i></span></div>
      ${lab.files ? `<button class="btn small" id="labfiles">Put the .java files in ~/${lab.files.folder}</button>` : ''}
    </div>
    <ol class="steps">${lab.steps.map((st, i) => {
      const ok = d.includes(i); const cur = i === next; const md = modeOf(st.c); const w = WHERE[md];
      const body = `<div class="guide">${st.h ? `<p>${esc(st.h)}</p>` : ''}<div class="where"><span class="ptag">${w[0]}</span> Type this ${w[1]}:</div><pre class="mini">${esc(st.c)}</pre><div class="gbtns"><button class="btn small primary" data-runstep="${i}">Run it for me</button><button class="btn small" data-copystep="${i}">Copy</button></div></div>`;
      return `<li class="${ok ? 'ok' : ''} ${cur ? 'next' : ''} ${flashIdx === i ? 'flash' : ''}">
        <span class="tick" aria-hidden="true">${ok ? '✓' : i + 1}</span>
        <div class="st"><div class="stt">${esc(st.t)}</div>
        ${cur ? body : `<details class="hint"><summary>${ok ? 'Done · see how' : 'How to do it'}</summary>${body}</details>`}</div></li>`; }).join('')}</ol>
    ${nDone === lab.steps.length ? `<p class="lab-done">Lab complete. ${labsHere.find((l, i) => i > labsHere.indexOf(lab)) ? 'Open the next lab above.' : 'Pick the next unit above.'}</p>` : '<p class="note small">Do each step in the terminal yourself. The tick appears automatically when the step is done correctly.</p>'}
    <button class="link" id="labreset">Reset this lab's ticks</button>`;
  flashIdx = null;
}
function labClick(e) {
  const t = e.target;
  if (t.id === 'labfiles') { const lab = labById(state.lab); const dir = SIM.HOME + '/' + lab.files.folder; m.local.mkdir(dir, true); Object.entries(lab.files.files).forEach(([n, s]) => m.local.write(dir + '/' + n, s)); write(`(saved ${Object.keys(lab.files.files).join(', ')} to ~/${lab.files.folder})`, 'hint'); checkLabs(null); persist(); scrollDown(); return; }
  if (t.dataset.runstep !== undefined) { const st = labById(state.lab).steps[+t.dataset.runstep]; switchTab('term'); enqueue({ snippet: { m: modeOf(st.c), code: st.c } }); return; }
  if (t.dataset.lunit) { state.labUnit = t.dataset.lunit; const l = C.LABS.find(x => x.unit === state.labUnit && (labDone[x.id] || []).length < x.steps.length) || C.LABS.find(x => x.unit === state.labUnit); state.lab = l.id; save('ui', state); renderLab(); return; }
  if (t.dataset.lab) { state.lab = t.dataset.lab; save('ui', state); renderLab(); return; }
  if (t.dataset.copystep !== undefined) { const st = labById(state.lab).steps[+t.dataset.copystep]; const ok = () => { t.textContent = 'Copied'; setTimeout(() => (t.textContent = 'Copy'), 1200); }; try { navigator.clipboard.writeText(st.c).then(ok, () => {}); } catch (er) {} return; }
  if (t.id === 'labreset') { labDone[state.lab] = []; renderLab(); persist(); return; }
}

/* ---------- notes ---------- */
function unitById(id) { return C.UNITS.find(u => u.id === id) || C.UNITS[0]; }
let reveal = false, query = '';
function codeBlock(code, mode, extra) {
  const lab = { bash: 'bash', hive: 'hive', py: 'pyspark' }[mode] || mode;
  return `<div class="code"><div class="code-bar"><span class="lang">${lab}</span><span class="acts"><button class="btn small ghost" data-copy>Copy</button>${extra || ''}</span></div><pre>${esc(code)}</pre></div>`;
}
function renderNotes() {
  const u = unitById(state.unit); const view = $('#notes');
  const total = u.qs.length, n = u.qs.filter((_, i) => done[u.id + i]).length;
  const items = u.qs.map((q, i) => ({ q, i })).filter(({ q }) => !query || (q.q + q.code + q.g).toLowerCase().includes(query));
  let prev = '';
  view.innerHTML = `
    <nav class="subtabs" role="tablist">${C.UNITS.map(x => `<button class="subtab" role="tab" aria-selected="${x.id === u.id}" data-unit="${x.id}">${x.sub}<b>${x.label}</b></button>`).join('')}</nav>
    <div class="intro"><h2>${esc(u.title)}</h2><p>${esc(u.intro)}</p></div>
    <details class="setup" open><summary>Setup — run this first</summary>${codeBlock(u.setup.code, u.setup.m, `<button class="btn small" data-runsetup>Run in terminal</button>`)}</details>
    <div class="toolbar">
      <input type="search" id="q" placeholder="Search this unit" value="${esc(query)}">
      <button class="btn ${reveal ? 'primary' : ''}" id="revealAll">${reveal ? 'Hide all answers' : 'Show all answers'}</button>
      <button class="btn" id="resetNotes">Reset ticks</button>
      <div class="progress"><span>${n} / ${total} done</span><span class="bar"><i style="width:${total ? (n / total) * 100 : 0}%"></i></span></div>
    </div>
    <div class="list">${items.map(({ q, i }) => {
      const key = u.id + i; const lbl = q.g !== prev ? `<div class="section-label">${esc(q.g)}</div>` : ''; prev = q.g;
      const files = q.files ? `<div class="files">${Object.entries(q.files).map(([f, src]) => `<details class="jfile"><summary>${esc(f)}</summary><pre>${esc(src)}</pre></details>`).join('')}<button class="btn small" data-savefiles="${i}">Save these files to ~/${q.folder}</button></div>` : '';
      return `${lbl}<article class="card ${done[key] ? 'done' : ''}" data-i="${i}">
        <div class="qhead"><span class="qnum">Q${i + 1}</span><div class="qtext">${esc(q.q)}</div></div>
        <div class="actions"><button class="btn" data-show aria-expanded="${reveal}">${reveal ? 'Hide answer' : 'Show answer'}</button><button class="btn" data-done>${done[key] ? '✓ Done' : 'Mark done'}</button></div>
        <div class="ans" ${reveal ? '' : 'hidden'}>${files}${q.pre ? '<div class="note">First, in the Linux terminal:</div>' + codeBlock(q.pre.code, q.pre.m) : ''}${codeBlock(q.code, q.m, `<button class="btn small" data-run="${i}">Run in terminal</button>`)}<div class="result"><b>Output:</b> ${q.out}</div>${q.note ? `<div class="note">${q.note}</div>` : ''}</div>
      </article>`; }).join('') || '<p class="note">No question matches that search.</p>'}</div>`;
}
function saveCardFiles(q) {
  const dir = SIM.HOME + '/' + q.folder; m.local.mkdir(dir, true);
  Object.entries(q.files).forEach(([n, s]) => m.local.write(dir + '/' + n, s));
  if (!m.local.isFile(SIM.HOME + '/employee_data.csv')) m.local.write(SIM.HOME + '/employee_data.csv', J.EMPLOYEE_CSV);
  persist();
  return `(saved ${Object.keys(q.files).join(', ')} to ~/${q.folder})`;
}
function notesClick(e) {
  const t = e.target.closest('button'); if (!t) return;
  const u = unitById(state.unit);
  if (t.dataset.unit) { state.unit = t.dataset.unit; query = ''; save('ui', state); renderNotes(); return; }
  if (t.hasAttribute('data-copy')) { const txt = t.closest('.code').querySelector('pre').innerText; const done2 = () => { t.textContent = 'Copied'; setTimeout(() => (t.textContent = 'Copy'), 1200); }; try { navigator.clipboard.writeText(txt).then(done2, () => selectPre(t)); } catch (er) { selectPre(t); } return; }
  if (t.hasAttribute('data-runsetup')) { if (u.id === 'u3' || u.id === 'u2') ensureSamples(false); switchTab('term'); enqueue({ snippet: u.setup }); return; }
  if (t.dataset.run !== undefined) {
    const q = u.qs[+t.dataset.run]; switchTab('term');
    if (q.files) write(saveCardFiles(q), 'hint');
    if (q.pre) enqueue({ snippet: q.pre });
    if (u.id === 'u4' || u.id === 'u5') prepSpark(u, q);
    enqueue({ snippet: { m: q.m, code: q.code } }); return;
  }
  if (t.dataset.savefiles !== undefined) { const q = u.qs[+t.dataset.savefiles]; t.textContent = saveCardFiles(q).replace(/^\(|\)$/g, ''); return; }
  const card = t.closest('.card');
  if (t.hasAttribute('data-show')) { const a = card.querySelector('.ans'); a.hidden = !a.hidden; t.textContent = a.hidden ? 'Show answer' : 'Hide answer'; t.setAttribute('aria-expanded', !a.hidden); return; }
  if (t.hasAttribute('data-done')) { const k = u.id + card.dataset.i; done[k] = !done[k]; save('done', done); renderNotes(); return; }
  if (t.id === 'revealAll') { reveal = !reveal; renderNotes(); return; }
  if (t.id === 'resetNotes') { Object.keys(done).filter(k => k.startsWith(u.id)).forEach(k => delete done[k]); save('done', done); renderNotes(); }
}
function selectPre(t) { const pre = t.closest('.code').querySelector('pre'); const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
// make sure the data the Spark answers expect is in HDFS and the session has df / emp
function prepSpark(u, q) {
  const needsFile = !m.hdfs.isFile('/bda/employee_data.csv');
  const lines = [];
  if (needsFile) { ensureSamples(true); lines.push('hdfs dfs -mkdir -p /bda', 'hdfs dfs -put -f employee_data.csv /bda/'); }
  if (/\/input\/input\.txt/.test(q.code) && !m.hdfs.isFile('/input/input.txt')) { ensureSamples(true); lines.push('hdfs dfs -mkdir -p /input', 'hdfs dfs -put -f input.txt /input'); }
  if (lines.length) enqueue({ snippet: { m: 'bash', code: lines.join('\n') } });
  const sess = m.modes.find(x => x.sess && x.sess.globals);
  const has = (n) => sess && sess.sess.globals.vars.has(n);
  if (u.id === 'u5' && !/^schema = /.test(q.code) && !(has('df') && has('col'))) enqueue({ snippet: u.setup });
  if (u.id === 'u4' && /\bemp\b/.test(q.code) && !/^emp = /m.test(q.code) && !has('emp')) enqueue({ snippet: u.setup });
  if (u.id === 'u4' && /\brdd\b/.test(q.code) && !/^rdd = /m.test(q.code) && !has('rdd')) enqueue({ snippet: u.setup });
}
function ensureSamples(quiet) {
  const added = [];
  for (const [n, s] of Object.entries(J.SAMPLE_FILES)) { const p = SIM.HOME + '/' + n; if (!m.local.isFile(p)) { m.local.write(p, s); added.push(n); } }
  if (!quiet) write(added.length ? `(added ${added.join(', ')} to your home folder)` : '(practice files are already in your home folder)', 'hint');
  persist();
}

/* ---------- viva / quiz / exam day ---------- */
function renderViva() {
  const groups = ['HDFS', 'MapReduce', 'Hive', 'Spark', 'DataFrame'];
  $('#viva').innerHTML = `<div class="intro"><h2>Viva questions</h2><p>Short answers you can say out loud. Tap a question to open it.</p></div>
  <div class="tw"><table class="cmp"><tr><th>Task</th><th>MapReduce</th><th>Hive</th><th>RDD</th><th>DataFrame</th></tr>
  <tr><td>Group &amp; count</td><td>emit (dept, 1), reducer sums</td><td>GROUP BY department</td><td>map → (dept,1) → reduceByKey</td><td>groupBy("Department").count()</td></tr>
  <tr><td>Filter</td><td>if in mapper</td><td>WHERE salary &gt; 50000</td><td>filter(lambda x: int(x[3])&gt;50000)</td><td>filter(col("Salary")&gt;50000)</td></tr>
  <tr><td>Sort</td><td>salary as key</td><td>ORDER BY salary DESC</td><td>sortBy(…, ascending=False)</td><td>orderBy(col("Salary").desc())</td></tr></table></div>
  ${groups.map(g => `<div class="section-label">${g}</div><div class="viva list">${C.VIVA.filter(v => v[0] === g).map(v => `<details><summary>${esc(v[1])}</summary><p>${esc(v[2])}</p></details>`).join('')}</div>`).join('')}`;
}
let qstate = {};
function renderQuiz() {
  const right = Object.entries(qstate).filter(([i, a]) => C.QUIZ[i][2] === a).length; const ans = Object.keys(qstate).length;
  $('#quiz').innerHTML = `<div class="intro"><h2>Quick self-test</h2><p>${C.QUIZ.length} questions across all five units. Pick an answer to see why.</p></div>
  <div class="toolbar"><span class="score">${right} / ${ans} correct</span><button class="btn" id="qreset">Start again</button></div>
  <div class="list quiz">${C.QUIZ.map((q, i) => `<article class="card"><div class="qhead"><span class="qnum">${i + 1}</span><div class="qtext">${esc(q[0])}</div></div>
  ${q[1].map((o, j) => { let cls = ''; if (i in qstate) { if (j === q[2]) cls = 'right'; else if (j === qstate[i]) cls = 'wrong'; } return `<button class="opt ${cls}" data-q="${i}" data-o="${j}" ${i in qstate ? 'disabled' : ''}>${esc(o)}</button>`; }).join('')}
  ${i in qstate ? `<div class="why">${qstate[i] === q[2] ? 'Correct. ' : 'Answer: ' + esc(q[1][q[2]]) + '. '}${esc(q[3])}</div>` : ''}</article>`).join('')}</div>`;
}
function renderCheck() {
  $('#check').innerHTML = `<div class="intro"><h2>Exam-day checklist</h2><p>The steps and common errors that cost marks in a practical exam.</p></div>
  <div class="card"><ol class="checklist">${C.CHECK.map(c => `<li>${c}</li>`).join('')}</ol></div>
  <div class="section-label">Numbers to know by heart (employee_data.csv)</div>
  <div class="card tw"><table class="cmp num"><tr><th>Dept</th><th>Count</th><th>Total</th><th>Avg</th><th>Max</th><th>Min</th></tr>
  <tr><td>Finance</td><td>3</td><td>183000</td><td>61000</td><td>65000</td><td>58000</td></tr>
  <tr><td>HR</td><td>3</td><td>117000</td><td>39000</td><td>42000</td><td>35000</td></tr>
  <tr><td>IT</td><td>4</td><td>220000</td><td>55000</td><td>70000</td><td>45000</td></tr>
  <tr><td><b>All</b></td><td>10</td><td>520000</td><td>52000</td><td>70000</td><td>35000</td></tr></table>
  <p class="note">Cities: Ahmedabad 3 (137000) · Mumbai 3 (133000) · Delhi 2 (120000) · Pune 2 (130000). Salary &gt; 50000: Amit, Priya, Anita, Arjun, Rohan. WordCount: Apple 4, Banana 2, Mango 1, Orange 2.</p></div>`;
}

/* ---------- tabs ---------- */
const TABS = [['term', 'Terminal', 'Practise'], ['notes', 'Notes', 'Units 1–5'], ['viva', 'Viva', 'Q&amp;A'], ['quiz', 'Quiz', 'Self-test'], ['check', 'Exam day', 'Checklist']];
function renderTabs() { $('#tabs').innerHTML = TABS.map(([k, l, s]) => `<button class="tab" role="tab" aria-selected="${k === state.tab}" data-tab="${k}">${l}<small>${s}</small></button>`).join(''); }
function switchTab(k) {
  state.tab = k; save('ui', state); renderTabs();
  for (const [id] of TABS) $('#' + id).hidden = id !== k;
  if (k === 'notes') renderNotes(); if (k === 'viva') renderViva(); if (k === 'quiz') renderQuiz(); if (k === 'check') renderCheck();
  if (k === 'term') { renderLab(); setTimeout(() => { scrollDown(); if (!matchMedia('(pointer: coarse)').matches) $('#cmd').focus(); }, 0); }
}

/* ---------- boot ---------- */
function boot() {
  renderTabs();
  write('Welcome to the GLS BDA lab — Ubuntu 22.04 · Hadoop 3.3.6 · Hive 3.1.3 · Spark 3.5.1 (simulated in your browser).', 'dim');
  write('Your files and HDFS are saved on this device. Type  help  for commands.', 'dim');
  write(m.svc.dfs ? 'Hadoop is already running (jps to check).' : 'Start with:  start-dfs.sh   then   start-yarn.sh   then   jps', 'hint');
  renderPrompt();
  const cmd = $('#cmd');
  cmd.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const v = cmd.value; cmd.value = ''; if (v.trim()) { hist.push(v); } hi = -1; enqueue(v); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); const H = hist.length ? hist : m.history; if (!H.length) return; hi = hi < 0 ? H.length - 1 : Math.max(0, hi - 1); cmd.value = H[hi]; return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); const H = hist.length ? hist : m.history; if (hi < 0) return; hi++; if (hi >= H.length) { hi = -1; cmd.value = ''; } else cmd.value = H[hi]; return; }
    if (e.key === 'Tab') { e.preventDefault(); complete(); return; }
    if ((e.ctrlKey) && (e.key === 'c' || e.key === 'C') && !getSelection().toString()) { e.preventDefault(); cancelInput(); return; }
    if ((e.ctrlKey) && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); write('', 'clear'); return; }
    if ((e.ctrlKey) && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); const md = m.modes[m.modes.length - 1]; if (md && md.eof && !cmd.value) { write(promptHTMLText(), ''); md.eof(); renderPrompt(); persist(); } return; }
  });
  cmd.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!/\n/.test(text)) return;
    e.preventDefault();
    const start = cmd.value.slice(0, cmd.selectionStart), end = cmd.value.slice(cmd.selectionEnd);
    const lines = (start + text + end).replace(/\r/g, '').split('\n');
    const last = lines.pop(); cmd.value = last;
    lines.forEach(l => { if (l.trim()) hist.push(l); enqueue(l); });
  });
  $('#screen').addEventListener('click', () => { if (!getSelection().toString()) cmd.focus(); });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.tab) { switchTab(t.dataset.tab); return; }
    if (t.closest('#lab')) { labClick({ target: t }); return; }
    if (t.closest('#notes')) { notesClick(e); return; }
    if (t.dataset.q !== undefined) { qstate[t.dataset.q] = +t.dataset.o; renderQuiz(); return; }
    if (t.id === 'qreset') { qstate = {}; renderQuiz(); return; }
    if (t.dataset.key) { keyBtn(t.dataset.key); return; }
    if (t.id === 'samples') { ensureSamples(false); scrollDown(); return; }
    if (t.id === 'clear') { write('', 'clear'); cmd.focus(); return; }
    if (t.id === 'reset') {
      if (t.dataset.armed) { m.modes.length = 0; m.reset(null); write('', 'clear'); write('Machine reset: empty home folder, empty HDFS, Hadoop stopped.', 'hint'); renderPrompt(); persist(); delete t.dataset.armed; t.textContent = 'Reset machine'; return; }
      t.dataset.armed = '1'; t.textContent = 'Click again to wipe everything'; setTimeout(() => { delete t.dataset.armed; t.textContent = 'Reset machine'; }, 4000); return;
    }
  });
  document.addEventListener('change', (e) => { if (e.target.id === 'labsel') { state.lab = e.target.value; save('ui', state); renderLab(); } });
  document.addEventListener('input', (e) => { if (e.target.id === 'q') { query = e.target.value.toLowerCase(); const pos = e.target.selectionStart; renderNotes(); const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos); } });
  checkLabs(null);
  switchTab(state.tab);
}
function complete() {
  const cmd = $('#cmd'); const c = m.complete(cmd.value);
  if (c.length === 1) { cmd.value = c[0]; return; }
  if (c.length > 1) {
    const words = c.map(x => x.split(/\s+/).filter(Boolean).pop());
    let pre = c[0]; for (const x of c) { let i = 0; while (i < pre.length && pre[i] === x[i]) i++; pre = pre.slice(0, i); }
    if (pre.length > cmd.value.length) cmd.value = pre; else { write(promptHTMLText() + cmd.value, ''); write(words.join('  '), ''); scrollDown(); }
  }
}
function keyBtn(k) {
  const cmd = $('#cmd');
  if (k === 'tab') complete();
  else if (k === 'up') cmd.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  else if (k === 'down') cmd.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  else if (k === 'ctrlc') cancelInput();
  else if (k === 'enter') cmd.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  cmd.focus();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
