/* ===== Hadoop lab simulator: file systems, shell, HDFS, daemons ===== */
(function (G) {
'use strict';
const HOST = 'gls-university', USER = 'hadoop', HOME = '/home/hadoop';
const NN = 'hdfs://localhost:9000';
const HADOOP_HOME = '/usr/local/hadoop';
const EXAMPLES_JAR = HADOOP_HOME + '/share/hadoop/mapreduce/hadoop-mapreduce-examples-3.3.6.jar';

/* ---------- helpers ---------- */
const pad = (s, n) => String(s).padStart(n);
const padR = (s, n) => String(s).padEnd(n);
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function two(n) { return String(n).padStart(2, '0'); }
function hdfsDate(t) { const d = new Date(t); return `${d.getFullYear()}-${two(d.getMonth()+1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`; }
function lsDate(t) { const d = new Date(t); return `${MON[d.getMonth()]} ${pad(d.getDate(),2)} ${two(d.getHours())}:${two(d.getMinutes())}`; }
function globToRe(g) { return new RegExp('^' + g.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$'); }
const hasGlob = s => /[*?]/.test(s);
function byteLen(s) { let n = 0; for (const ch of s) { const c = ch.codePointAt(0); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; } return n; }

/* ---------- file system ---------- */
class FS {
  constructor(kind, data) { this.kind = kind; this.root = data || { t: 'd', c: {}, m: Date.now() }; }
  norm(p, cwd) {
    if (!p.startsWith('/')) p = (cwd || '/') + '/' + p;
    const out = [];
    for (const part of p.split('/')) { if (!part || part === '.') continue; if (part === '..') out.pop(); else out.push(part); }
    return '/' + out.join('/');
  }
  node(abs) { if (abs === '/') return this.root; let n = this.root; for (const part of abs.split('/').slice(1)) { if (!n || n.t !== 'd') return null; n = n.c[part]; } return n || null; }
  parent(abs) { const i = abs.lastIndexOf('/'); return [i <= 0 ? '/' : abs.slice(0, i), abs.slice(i + 1)]; }
  exists(abs) { return !!this.node(abs); }
  isDir(abs) { const n = this.node(abs); return !!n && n.t === 'd'; }
  isFile(abs) { const n = this.node(abs); return !!n && n.t === 'f'; }
  mkdir(abs, parents) {
    if (this.exists(abs)) return this.isDir(abs) ? 'exists' : 'notdir';
    const [par, name] = this.parent(abs);
    if (!this.exists(par)) { if (!parents) return 'noparent'; const r = this.mkdir(par, true); if (r !== true && r !== 'exists') return r; }
    const pn = this.node(par); if (pn.t !== 'd') return 'notdir';
    pn.c[name] = { t: 'd', c: {}, m: Date.now() }; pn.m = Date.now(); return true;
  }
  write(abs, data, append) {
    const [par, name] = this.parent(abs); const pn = this.node(par);
    if (!pn || pn.t !== 'd') return false;
    const ex = pn.c[name];
    if (ex && ex.t === 'd') return false;
    pn.c[name] = { t: 'f', d: (append && ex ? ex.d : '') + data, m: Date.now() }; return true;
  }
  read(abs) { const n = this.node(abs); return n && n.t === 'f' ? n.d : null; }
  rm(abs) { const [par, name] = this.parent(abs); const pn = this.node(par); if (pn && pn.c[name]) { delete pn.c[name]; return true; } return false; }
  list(abs) { const n = this.node(abs); if (!n || n.t !== 'd') return []; return Object.keys(n.c).sort(); }
  size(abs) { const n = this.node(abs); if (!n) return 0; if (n.t === 'f') return byteLen(n.d); return this.list(abs).reduce((s, k) => s + this.size(abs === '/' ? '/' + k : abs + '/' + k), 0); }
  counts(abs) { const n = this.node(abs); if (!n) return [0, 0]; if (n.t === 'f') return [0, 1]; let d = 1, f = 0; for (const k of this.list(abs)) { const [a, b] = this.counts(this.join(abs, k)); d += a; f += b; } return [d, f]; }
  join(a, b) { return a === '/' ? '/' + b : a + '/' + b; }
  copy(src, dst) { const n = this.node(src); if (!n) return false; const [par, name] = this.parent(dst); const pn = this.node(par); if (!pn || pn.t !== 'd') return false; pn.c[name] = JSON.parse(JSON.stringify(n)); pn.c[name].m = Date.now(); return true; }
  glob(pattern, cwd) {
    const abs = this.norm(pattern, cwd); if (!hasGlob(abs)) return [abs];
    let cur = ['/'];
    for (const part of abs.split('/').slice(1)) {
      const next = [];
      for (const c of cur) {
        if (hasGlob(part)) { const re = globToRe(part); for (const k of this.list(c)) if (re.test(k) && !k.startsWith('.')) next.push(this.join(c, k)); }
        else if (this.exists(this.join(c, part))) next.push(this.join(c, part));
      }
      cur = next;
    }
    return cur;
  }
}

/* ---------- Java-style messages ---------- */
const CONN_REFUSED = (cmd) => `${cmd}: Call From ${HOST}/127.0.1.1 to localhost:9000 failed on connection exception: java.net.ConnectException: Connection refused; For more details see:  http://wiki.apache.org/hadoop/ConnectionRefused`;

/* ---------- the machine ---------- */
class Machine {
  constructor(saved) {
    this.listeners = [];
    this.events = [];
    this.reset(saved);
  }
  reset(saved) {
    const s = saved || {};
    this.local = new FS('local', s.local);
    this.hdfs = new FS('hdfs', s.hdfs);
    this.svc = Object.assign({ dfs: false, yarn: false, pids: {} }, s.svc || {});
    this.env = Object.assign({ HOME, USER, HADOOP_HOME, HIVE_HOME: '/usr/local/hive', SPARK_HOME: '/usr/local/spark', JAVA_HOME: '/usr/lib/jvm/java-8-openjdk-amd64', PATH: '/usr/local/hadoop/bin:/usr/local/hadoop/sbin:/usr/local/hive/bin:/usr/local/spark/bin:/usr/bin:/bin', SHELL: '/bin/bash' }, s.env || {});
    this.cwd = s.cwd || HOME;
    this.history = s.history || [];
    this.hive = s.hive || null;            // hive metastore, owned by hive.js
    this.jobSeq = s.jobSeq || 1;
    this.appSeq = s.appSeq || 1;
    if (!saved) this.seed();
    this.modes = [];                        // interactive mode stack (hive, pyspark, heredoc)
    this.pending = [];                       // heredoc / continuation buffer
  }
  seed() {
    const L = this.local;
    ['/home/hadoop', '/home/hadoop/Documents', '/home/hadoop/Downloads', '/home/hadoop/Desktop', '/tmp', HADOOP_HOME + '/share/hadoop/mapreduce', HADOOP_HOME + '/etc/hadoop', HADOOP_HOME + '/bin', HADOOP_HOME + '/sbin', '/usr/local/hive/bin', '/usr/local/spark/bin'].forEach(p => L.mkdir(p, true));
    L.write(EXAMPLES_JAR, 'PK\u0003\u0004 (binary jar)');
    L.write(HADOOP_HOME + '/share/hadoop/mapreduce/hadoop-mapreduce-client-core-3.3.6.jar', 'PK\u0003\u0004 (binary jar)');
    L.write(HADOOP_HOME + '/etc/hadoop/core-site.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<configuration>\n  <property>\n    <name>fs.defaultFS</name>\n    <value>${NN}</value>\n  </property>\n</configuration>\n`);
    L.write(HADOOP_HOME + '/etc/hadoop/hdfs-site.xml', `<configuration>\n  <property>\n    <name>dfs.replication</name>\n    <value>1</value>\n  </property>\n</configuration>\n`);
    const H = this.hdfs;
    ['/tmp', '/user/hadoop', '/user/hive/warehouse'].forEach(p => H.mkdir(p, true));
    this.svc = { dfs: false, yarn: false, pids: {} };
  }
  snapshot() {
    return { local: this.local.root, hdfs: this.hdfs.root, svc: this.svc, env: this.env, cwd: this.cwd, history: this.history.slice(-200), hive: this.hive, jobSeq: this.jobSeq, appSeq: this.appSeq };
  }
  /* output */
  on(fn) { this.listeners.push(fn); }
  out(text, cls) { if (text === undefined || text === null) return; for (const fn of this.listeners) fn(String(text), cls || ''); }
  err(text) { this.out(text, 'err'); }
  event(e) { this.events.push(Object.assign({ t: Date.now() }, e)); if (this.events.length > 300) this.events.shift(); for (const fn of this.listeners) fn(null, 'event', e); }
  /* prompt */
  prompt() {
    if (this.pending.length && this.pendingPrompt) return this.pendingPrompt;
    const m = this.modes[this.modes.length - 1];
    if (m) return m.prompt();
    const d = this.cwd === HOME ? '~' : this.cwd.startsWith(HOME + '/') ? '~' + this.cwd.slice(HOME.length) : this.cwd;
    return { user: `${USER}@${HOST}`, path: d, sym: '$ ' };
  }
  mode() { const m = this.modes[this.modes.length - 1]; return m ? m.name : 'bash'; }
  /* main entry: one physical line */
  async feed(line) {
    const m = this.modes[this.modes.length - 1];
    if (m) { await m.feed(line); return; }
    if (this.heredoc) {
      if (line.trim() === this.heredoc.delim) { const h = this.heredoc; this.heredoc = null; this.pendingPrompt = null; await this.runLine(h.line, h.body.join('\n') + (h.body.length ? '\n' : '')); }
      else this.heredoc.body.push(this.heredoc.expand ? this.expandVars(line) : line);
      return;
    }
    if (this.cont !== undefined && this.cont !== null) { line = this.cont + '\n' + line; this.cont = null; this.pendingPrompt = null; }
    if (/\\$/.test(line)) { this.cont = line.slice(0, -1); this.pendingPrompt = { sym: '> ' }; this.pending = [1]; return; }
    this.pending = [];
    if (!line.trim()) return;
    this.history.push(line);
    const hd = line.match(/<<-?\s*(['"]?)(\w+)\1/);
    if (hd) { this.heredoc = { delim: hd[2], body: [], line: line.replace(hd[0], ''), expand: !hd[1] }; this.pendingPrompt = { sym: '> ' }; this.pending = [1]; return; }
    await this.runLine(line, null);
  }
  /* ---------- bash ---------- */
  expandVars(s) {
    return s.replace(/\$\{?(\w+)\}?/g, (m, v) => (v in this.env ? this.env[v] : ''));
  }
  substitute(s) {
    // command substitution: `cmd` and $(cmd) — synchronous subset
    const run = (cmd) => { const r = this.syncCmd(cmd.trim()); return r.replace(/\n+$/, ''); };
    s = s.replace(/`([^`]*)`/g, (m, c) => run(c));
    s = s.replace(/\$\(([^()]*)\)/g, (m, c) => run(c));
    return s;
  }
  syncCmd(cmd) {
    const w = cmd.split(/\s+/);
    if (cmd === 'hadoop classpath') return `${HADOOP_HOME}/etc/hadoop:${HADOOP_HOME}/share/hadoop/common/lib/*:${HADOOP_HOME}/share/hadoop/common/*:${HADOOP_HOME}/share/hadoop/hdfs/*:${HADOOP_HOME}/share/hadoop/mapreduce/*:${HADOOP_HOME}/share/hadoop/yarn/*`;
    if (w[0] === 'pwd') return this.cwd;
    if (w[0] === 'whoami') return USER;
    if (w[0] === 'hostname') return HOST;
    if (w[0] === 'date') return new Date().toString();
    if (w[0] === 'echo') return w.slice(1).join(' ');
    return '';
  }
  splitTop(line, seps) {
    // split on separators outside quotes; returns [{text, sep}]
    const parts = []; let cur = '', q = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { cur += ch; if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { q = ch; cur += ch; continue; }
      let hit = null; for (const s of seps) if (line.startsWith(s, i)) { hit = s; break; }
      if (hit) { parts.push({ text: cur, sep: hit }); cur = ''; i += hit.length - 1; continue; }
      cur += ch;
    }
    parts.push({ text: cur, sep: null });
    return parts;
  }
  words(text) {
    // returns [{w, quoted}] after var expansion; handles redirections as separate tokens
    const out = []; let cur = '', q = null, quoted = false, started = false;
    const push = () => { if (started) out.push({ w: cur, quoted }); cur = ''; quoted = false; started = false; };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q === "'") { if (ch === "'") q = null; else cur += ch; continue; }
      if (q === '"') { if (ch === '"') q = null; else if (ch === '\\' && '"\\$'.includes(text[i + 1])) cur += text[++i]; else if (ch === '$') { const m = text.slice(i).match(/^\$\{?(\w+)\}?/); if (m) { cur += this.env[m[1]] || ''; i += m[0].length - 1; } else cur += ch; } else cur += ch; continue; }
      if (ch === "'" || ch === '"') { q = ch; quoted = true; started = true; continue; }
      if (/\s/.test(ch)) { push(); continue; }
      if (ch === '\\' && i + 1 < text.length) { cur += text[++i]; started = true; quoted = true; continue; }
      if (ch === '>' || ch === '<') {
        // redirection tokens: 2>&1 2> > >> <
        if (cur === '2' && !quoted) { cur = ''; started = false; if (text.slice(i, i + 3) === '>&1') { out.push({ w: '2>&1', op: true }); i += 2; continue; } out.push({ w: '2>', op: true }); continue; }
        push();
        if (text[i + 1] === '>') { out.push({ w: '>>', op: true }); i++; } else out.push({ w: ch, op: true });
        continue;
      }
      if (ch === '$') { const m = text.slice(i).match(/^\$\{?(\w+)\}?/); if (m) { cur += this.env[m[1]] || ''; i += m[0].length - 1; started = true; continue; } }
      if (ch === '~' && !started && (text[i + 1] === undefined || text[i + 1] === '/' || /\s/.test(text[i + 1]))) { cur += HOME; started = true; continue; }
      cur += ch; started = true;
    }
    if (q) return { error: 'unexpected EOF while looking for matching `' + q + "'" };
    push();
    return out;
  }
  async runLine(line, stdin) {
    line = this.substitute(line);
    const chain = this.splitTop(line, ['&&', '||', ';']);
    let code = 0, prevSep = null;
    for (const seg of chain) {
      if (prevSep === '&&' && code !== 0) { prevSep = seg.sep; continue; }
      if (prevSep === '||' && code === 0) { prevSep = seg.sep; continue; }
      if (seg.text.trim()) code = await this.runPipeline(seg.text, stdin);
      stdin = null; prevSep = seg.sep;
      if (this.modes.length) {
        // an interactive program started (hive/pyspark): feed the rest of the chain to it later
        break;
      }
    }
    this.lastCode = code;
    return code;
  }
  async runPipeline(text, heredocIn) {
    const stages = this.splitTop(text, ['|']).map(s => s.text);
    let input = heredocIn, code = 0;
    for (let i = 0; i < stages.length; i++) {
      const toks = this.words(stages[i]);
      if (toks.error) { this.err('bash: ' + toks.error); return 2; }
      const args = []; let outFile = null, append = false, errNull = false, mergeErr = false, inFile = null;
      for (let k = 0; k < toks.length; k++) {
        const t = toks[k];
        if (t.op) {
          if (t.w === '>' || t.w === '>>') { outFile = toks[++k] && toks[k].w; append = t.w === '>>'; if (!outFile) { this.err("bash: syntax error near unexpected token `newline'"); return 2; } }
          else if (t.w === '<') { inFile = toks[++k] && toks[k].w; }
          else if (t.w === '2>') { const f = toks[++k]; if (f && f.w === '/dev/null') errNull = true; }
          else if (t.w === '2>&1') mergeErr = true;
          continue;
        }
        if (!t.quoted && hasGlob(t.w)) {
          const m = this.local.glob(t.w, this.cwd).filter(p => this.local.exists(p));
          if (m.length) { const rel = !t.w.startsWith('/'); m.forEach(p => args.push(rel ? this.relPath(p) : p)); continue; }
        }
        args.push(t.w);
      }
      if (!args.length) continue;
      // env assignment
      if (/^\w+=/.test(args[0]) && args.length === 1) { const [k, ...v] = args[0].split('='); this.env[k] = v.join('='); continue; }
      if (inFile) { const p = this.local.norm(inFile, this.cwd); input = this.local.read(p); if (input === null) { this.err(`bash: ${inFile}: No such file or directory`); return 1; } }
      const last = i === stages.length - 1;
      const capture = !last || !!outFile;
      const res = await this.exec(args, input, { capture, errNull, mergeErr });
      code = res.code;
      if (outFile) {
        const p = this.local.norm(outFile, this.cwd);
        if (outFile === '/dev/null') {}
        else if (this.local.isDir(p)) { this.err(`bash: ${outFile}: Is a directory`); return 1; }
        else if (!this.local.write(p, res.out || '', append)) { this.err(`bash: ${outFile}: No such file or directory`); return 1; }
        input = null;
      } else if (!last) input = res.out || '';
      else if (res.out) this.out(res.out.replace(/\n$/, ''));
    }
    return code;
  }
  relPath(abs) { if (abs.startsWith(this.cwd + '/')) return abs.slice(this.cwd.length + 1); return abs; }
  async exec(args, stdin, opt) {
    const [cmd, ...rest] = args;
    const buf = []; const errs = [];
    const io = {
      stdin, cwd: this.cwd,
      print: (s) => { if (opt.capture) buf.push(s); else this.out(s); },
      error: (s) => { if (opt.errNull) return; if (opt.mergeErr && opt.capture) buf.push(s); else this.err(s); },
    };
    const fn = COMMANDS[cmd];
    let code = 0;
    if (!fn) {
      if (cmd.startsWith('./') || cmd.endsWith('.sh')) { const p = this.local.norm(cmd, this.cwd); if (!this.local.exists(p)) { io.error(`bash: ${cmd}: No such file or directory`); return { code: 127, out: '' }; } }
      io.error(`${cmd}: command not found`); code = 127;
    } else {
      try { const r = await fn.call(this, rest, io, cmd); code = typeof r === 'number' ? r : 0; }
      catch (e) { io.error(String(e && e.message || e)); code = 1; if (G.__SIM_DEBUG) console.error(e); }
    }
    this.event({ kind: 'shell', cmd: args.join(' '), code });
    return { code, out: buf.length ? buf.join('\n') + '\n' : '' };
  }
  /* path helpers for HDFS */
  hpath(p) {
    if (p.startsWith('hdfs://')) { const m = p.match(/^hdfs:\/\/([^/]+)(\/.*)?$/); if (!m) return { error: 'bad uri' }; if (m[1] !== 'localhost:9000') return { error: 'port', host: m[1] }; p = m[2] || '/'; }
    if (p.startsWith('file:')) return { error: 'file' };
    return { path: this.hdfs.norm(p, '/user/hadoop') };
  }
  dfsUp(cmdName, io) { if (!this.svc.dfs) { io.error(CONN_REFUSED(cmdName)); return false; } return true; }
  pid() { return 2000 + Math.floor(Math.random() * 7000); }
  async sleep(ms) { if (G.__SIM_FAST) return; await new Promise(r => setTimeout(r, ms)); }
}

/* ---------- commands ---------- */
const COMMANDS = {};
COMMANDS.pwd = function (a, io) { io.print(this.cwd); };
COMMANDS.whoami = function (a, io) { io.print(USER); };
COMMANDS.hostname = function (a, io) { io.print(HOST); };
COMMANDS.date = function (a, io) { io.print(new Date().toString().replace(/ GMT.*/, ' IST 2026').replace(/ 2026 IST 2026/, ' IST 2026')); };
COMMANDS.clear = function () { this.out('', 'clear'); };
COMMANDS.history = function (a, io) { this.history.slice(-50).forEach((h, i) => io.print(pad(this.history.length - Math.min(50, this.history.length) + i + 1, 5) + '  ' + h)); };
COMMANDS.exit = function () { this.out('logout', 'dim'); this.out('(this is a simulator — the session stays open)', 'dim'); };
COMMANDS.sudo = function (a, io) { if (!a.length) { io.error('usage: sudo command'); return 1; } io.print('[sudo] password for hadoop: '); return this.exec(a, io.stdin, { capture: false }).then(r => r.code); };
COMMANDS.echo = function (a, io) { let s = a; let nl = true; if (s[0] === '-n') { nl = false; s = s.slice(1); } if (s[0] === '-e') s = s.slice(1).map(x => x.replace(/\\n/g, '\n').replace(/\\t/g, '\t')); io.print(s.join(' ')); };
COMMANDS.printf = function (a, io) { if (!a.length) { io.error('printf: usage: printf format [arguments]'); return 2; } let i = 1; const out = a[0].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/%[sd]/g, () => (a[i++] || '')); io.print(out.replace(/\n$/, '')); };
COMMANDS.export = function (a) { for (const x of a) { const i = x.indexOf('='); if (i > 0) this.env[x.slice(0, i)] = x.slice(i + 1); } };
COMMANDS.env = function (a, io) { Object.keys(this.env).sort().forEach(k => io.print(k + '=' + this.env[k])); };
COMMANDS.cd = function (a, io) {
  const t = a[0] === undefined || a[0] === '~' ? HOME : a[0] === '-' ? (this.oldpwd || HOME) : a[0];
  const p = this.local.norm(t, this.cwd);
  if (!this.local.exists(p)) { io.error(`bash: cd: ${a[0]}: No such file or directory`); return 1; }
  if (!this.local.isDir(p)) { io.error(`bash: cd: ${a[0]}: Not a directory`); return 1; }
  this.oldpwd = this.cwd; this.cwd = p;
};
COMMANDS.ls = function (a, io) {
  const flags = a.filter(x => x.startsWith('-')).join(''); const paths = a.filter(x => !x.startsWith('-'));
  const long = flags.includes('l'), all = flags.includes('a');
  const targets = paths.length ? paths : ['.'];
  let code = 0; const multi = targets.length > 1;
  targets.forEach((t, ti) => {
    const p = this.local.norm(t, this.cwd);
    const n = this.local.node(p);
    if (!n) { io.error(`ls: cannot access '${t}': No such file or directory`); code = 2; return; }
    const entries = n.t === 'f' ? [[t, n]] : this.local.list(p).filter(k => all || !k.startsWith('.')).map(k => [k, n.c[k]]);
    if (multi && n.t === 'd') { if (ti) io.print(''); io.print(t + ':'); }
    if (long) {
      if (n.t === 'd') io.print('total ' + entries.length * 4);
      entries.forEach(([k, e]) => io.print(`${e.t === 'd' ? 'drwxrwxr-x 2' : '-rw-rw-r-- 1'} hadoop hadoop ${pad(e.t === 'd' ? 4096 : byteLen(e.d), 5)} ${lsDate(e.m)} ${e.t === 'd' ? '\u001bD' + k + '\u001b0' : k}`));
    } else if (entries.length) io.print(entries.map(([k, e]) => e.t === 'd' ? '\u001bD' + k + '\u001b0' : /\.(sh)$/.test(k) ? '\u001bX' + k + '\u001b0' : /\.jar$/.test(k) ? '\u001bJ' + k + '\u001b0' : k).join('  '));
  });
  return code;
};
COMMANDS.ll = function (a, io) { return COMMANDS.ls.call(this, ['-la', ...a], io); };
COMMANDS.mkdir = function (a, io) {
  const parents = a.includes('-p'); let code = 0;
  for (const t of a.filter(x => !x.startsWith('-'))) {
    const r = this.local.mkdir(this.local.norm(t, this.cwd), parents);
    if (r === 'exists' && !parents) { io.error(`mkdir: cannot create directory ‘${t}’: File exists`); code = 1; }
    else if (r === 'noparent') { io.error(`mkdir: cannot create directory ‘${t}’: No such file or directory`); code = 1; }
  }
  if (!a.filter(x => !x.startsWith('-')).length) { io.error('mkdir: missing operand'); return 1; }
  return code;
};
COMMANDS.touch = function (a, io) { for (const t of a) { const p = this.local.norm(t, this.cwd); if (!this.local.exists(p)) { if (!this.local.write(p, '')) { io.error(`touch: cannot touch '${t}': No such file or directory`); return 1; } } else this.local.node(p).m = Date.now(); } };
COMMANDS.cat = function (a, io) {
  if (!a.length) { if (io.stdin !== null && io.stdin !== undefined) io.print(io.stdin.replace(/\n$/, '')); return; }
  let code = 0;
  for (const t of a) {
    const p = this.local.norm(t, this.cwd);
    if (this.local.isDir(p)) { io.error(`cat: ${t}: Is a directory`); code = 1; continue; }
    const d = this.local.read(p);
    if (d === null) { io.error(`cat: ${t}: No such file or directory`); code = 1; continue; }
    if (d.startsWith('PK\u0003')) { io.print('PK (binary jar file — run it with hadoop jar)'); continue; }
    if (d.length) io.print(d.replace(/\n$/, ''));
  }
  return code;
};
function textOf(m, a, io, name) {
  const files = a.filter(x => !/^-/.test(x));
  if (!files.length) return io.stdin || '';
  const p = m.local.norm(files[0], m.cwd); const d = m.local.read(p);
  if (d === null) { io.error(`${name}: cannot open '${files[0]}' for reading: No such file or directory`); return null; }
  return d;
}
COMMANDS.head = function (a, io) { let n = 10; const i = a.indexOf('-n'); if (i >= 0) { n = +a[i + 1]; a = a.filter((_, k) => k !== i && k !== i + 1); } const m1 = a.find(x => /^-\d+$/.test(x)); if (m1) { n = +m1.slice(1); a = a.filter(x => x !== m1); } const t = textOf(this, a, io, 'head'); if (t === null) return 1; const lines = t.replace(/\n$/, '').split('\n').slice(0, n); if (t) io.print(lines.join('\n')); };
COMMANDS.tail = function (a, io) { let n = 10; const i = a.indexOf('-n'); if (i >= 0) { n = +a[i + 1]; a = a.filter((_, k) => k !== i && k !== i + 1); } const m1 = a.find(x => /^-\d+$/.test(x)); if (m1) { n = +m1.slice(1); a = a.filter(x => x !== m1); } const t = textOf(this, a, io, 'tail'); if (t === null) return 1; const lines = t.replace(/\n$/, '').split('\n'); if (t) io.print(lines.slice(-n).join('\n')); };
COMMANDS.wc = function (a, io) {
  const flags = a.filter(x => x.startsWith('-')).join(''); const t = textOf(this, a, io, 'wc'); if (t === null) return 1;
  const l = (t.match(/\n/g) || []).length, w = (t.match(/\S+/g) || []).length, c = byteLen(t);
  const f = a.find(x => !x.startsWith('-')) || '';
  if (flags.includes('l')) io.print(l + (f ? ' ' + f : '')); else if (flags.includes('w')) io.print(w + (f ? ' ' + f : '')); else io.print(`${pad(l, 2)} ${pad(w, 2)} ${pad(c, 3)}${f ? ' ' + f : ''}`);
};
COMMANDS.grep = function (a, io) {
  const flags = a.filter(x => /^-[a-z]+$/.test(x)).join(''); const rest = a.filter(x => !/^-[a-z]+$/.test(x));
  const pat = rest[0]; if (pat === undefined) { io.error('Usage: grep [OPTION]... PATTERNS [FILE]...'); return 2; }
  const t = textOf(this, rest.slice(1), io, 'grep'); if (t === null) return 2;
  let re; try { re = new RegExp(pat, flags.includes('i') ? 'i' : ''); } catch (e) { re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); }
  const hits = t.replace(/\n$/, '').split('\n').filter(l => flags.includes('v') ? !re.test(l) : re.test(l));
  if (flags.includes('c')) io.print(String(hits.length)); else if (hits.length) io.print(hits.join('\n'));
  return hits.length ? 0 : 1;
};
COMMANDS.sort = function (a, io) { const t = textOf(this, a, io, 'sort'); if (t === null) return 2; let lines = t.replace(/\n$/, '').split('\n'); const num = a.some(x => /^-\w*n/.test(x)), rev = a.some(x => /^-\w*r/.test(x)); lines.sort(num ? (x, y) => parseFloat(x) - parseFloat(y) : (x, y) => x.localeCompare(y)); if (rev) lines.reverse(); if (t) io.print(lines.join('\n')); };
COMMANDS.uniq = function (a, io) { const t = textOf(this, a, io, 'uniq'); if (t === null) return 1; const lines = t.replace(/\n$/, '').split('\n'); io.print(lines.filter((l, i) => l !== lines[i - 1]).join('\n')); };
COMMANDS.rm = function (a, io) {
  const flags = a.filter(x => x.startsWith('-')).join(''); let code = 0;
  for (const t of a.filter(x => !x.startsWith('-'))) {
    const p = this.local.norm(t, this.cwd);
    if (!this.local.exists(p)) { if (!flags.includes('f')) { io.error(`rm: cannot remove '${t}': No such file or directory`); code = 1; } continue; }
    if (this.local.isDir(p) && !/[rR]/.test(flags)) { io.error(`rm: cannot remove '${t}': Is a directory`); code = 1; continue; }
    this.local.rm(p);
  }
  return code;
};
COMMANDS.rmdir = function (a, io) { for (const t of a) { const p = this.local.norm(t, this.cwd); if (!this.local.isDir(p)) { io.error(`rmdir: failed to remove '${t}': No such file or directory`); return 1; } if (this.local.list(p).length) { io.error(`rmdir: failed to remove '${t}': Directory not empty`); return 1; } this.local.rm(p); } };
COMMANDS.cp = function (a, io) {
  const r = a.includes('-r') || a.includes('-R'); const f = a.filter(x => !x.startsWith('-'));
  if (f.length < 2) { io.error('cp: missing destination file operand'); return 1; }
  const dst = this.local.norm(f[f.length - 1], this.cwd);
  for (const s of f.slice(0, -1)) {
    const sp = this.local.norm(s, this.cwd);
    if (!this.local.exists(sp)) { io.error(`cp: cannot stat '${s}': No such file or directory`); return 1; }
    if (this.local.isDir(sp) && !r) { io.error(`cp: -r not specified; omitting directory '${s}'`); return 1; }
    const target = this.local.isDir(dst) ? this.local.join(dst, sp.split('/').pop()) : dst;
    if (!this.local.copy(sp, target)) { io.error(`cp: cannot create regular file '${f[f.length - 1]}': No such file or directory`); return 1; }
  }
};
COMMANDS.mv = function (a, io) {
  const f = a.filter(x => !x.startsWith('-')); if (f.length < 2) { io.error('mv: missing destination file operand'); return 1; }
  const dst = this.local.norm(f[f.length - 1], this.cwd);
  for (const s of f.slice(0, -1)) {
    const sp = this.local.norm(s, this.cwd);
    if (!this.local.exists(sp)) { io.error(`mv: cannot stat '${s}': No such file or directory`); return 1; }
    const target = this.local.isDir(dst) ? this.local.join(dst, sp.split('/').pop()) : dst;
    if (!this.local.copy(sp, target)) { io.error(`mv: cannot move '${s}': No such file or directory`); return 1; }
    this.local.rm(sp);
  }
};
COMMANDS.find = function (a, io) {
  const start = a[0] && !a[0].startsWith('-') ? a[0] : '.'; const ni = a.indexOf('-name'); const pat = ni >= 0 ? a[ni + 1] : null;
  const ti = a.indexOf('-type'); const type = ti >= 0 ? a[ti + 1] : null;
  const root = this.local.norm(start, this.cwd);
  if (!this.local.exists(root)) { io.error(`find: ‘${start}’: No such file or directory`); return 1; }
  const re = pat ? globToRe(pat) : null; const res = [];
  const walk = (p, disp) => { const n = this.local.node(p); const name = p.split('/').pop(); if ((!re || re.test(name)) && (!type || (type === 'd') === (n.t === 'd'))) res.push(disp); if (n.t === 'd') for (const k of this.local.list(p)) walk(this.local.join(p, k), disp.replace(/\/$/, '') + '/' + k); };
  walk(root, start);
  if (res.length) io.print(res.join('\n'));
};
COMMANDS.nano = async function (a, io) {
  const f = a.filter(x => !x.startsWith('-'))[0];
  if (!f) { io.error('Use: nano <filename>'); return 1; }
  const p = this.local.norm(f, this.cwd);
  if (this.local.isDir(p)) { io.error(`"${f}" is a directory`); return 1; }
  const [par] = this.local.parent(p);
  if (!this.local.isDir(par)) { io.error(`Directory '${par}' does not exist`); return 1; }
  const initial = this.local.read(p);
  if (!this.editor) { io.error('nano: no editor available'); return 1; }
  const res = await this.editor(f, initial === null ? '' : initial);
  if (res !== null && res !== undefined) { this.local.write(p, res); this.event({ kind: 'nano', path: p }); }
};
COMMANDS.vi = COMMANDS.vim = function (a, io) { io.error('vim is not installed in this lab. Use nano instead:  nano ' + (a[0] || 'file.txt')); return 127; };
COMMANDS.gedit = COMMANDS.vi;
COMMANDS.help = function (a, io) {
  io.print([
    'Linux     ls cd pwd mkdir touch cat nano rm cp mv head tail wc grep find echo clear',
    'Hadoop    jps start-dfs.sh start-yarn.sh start-all.sh stop-dfs.sh stop-yarn.sh stop-all.sh',
    'HDFS      hdfs dfs -mkdir -ls -put -get -cat -head -tail -touchz -cp -mv -rm -rmdir -count -du',
    '          hdfs getconf -confKey fs.defaultFS · hdfs dfsadmin -report',
    'MapReduce hadoop jar <jar> <class|example> <args>  ·  javac  ·  jar -cvf',
    'Hive      hive   (then HiveQL ending with ;  —  quit; to leave)',
    'Spark     pyspark   ·   spark-submit file.py',
  ].join('\n'));
};
COMMANDS.java = function (a, io) { if (a[0] === '-version') { io.error('openjdk version "1.8.0_402"\nOpenJDK Runtime Environment (build 1.8.0_402-8u402-ga-2ubuntu1~22.04-b06)\nOpenJDK 64-Bit Server VM (build 25.402-b06, mixed mode)'); return; } io.error('Run Java programs with:  hadoop jar <file>.jar <MainClass> <input> <output>'); return 1; };
COMMANDS.python3 = COMMANDS.python = function (a, io) { if (a[0] && a[0].endsWith('.py')) { io.error('This lab runs PySpark scripts with:  spark-submit ' + a[0]); return 1; } io.error('Use  pyspark  for the interactive PySpark shell.'); return 1; };
COMMANDS.ssh = function (a, io) { io.print('Welcome to Ubuntu 22.04.4 LTS (GNU/Linux 6.5.0-28-generic x86_64)'); };
COMMANDS.chmod = function () {};

/* ---------- daemons ---------- */
COMMANDS.jps = function (a, io) {
  const P = this.svc.pids; const rows = [];
  if (this.svc.dfs) rows.push([P.nn, 'NameNode'], [P.dn, 'DataNode'], [P.snn, 'SecondaryNameNode']);
  if (this.svc.yarn) rows.push([P.rm, 'ResourceManager'], [P.nm, 'NodeManager']);
  rows.push([this.pid(), 'Jps']);
  io.print(rows.map(r => r[0] + ' ' + r[1]).join('\n'));
  this.event({ kind: 'jps' });
};
COMMANDS['start-dfs.sh'] = async function (a, io) {
  if (this.svc.dfs) { io.print(`Starting namenodes on [localhost]\nlocalhost: namenode is running as process ${this.svc.pids.nn}.  Stop it first and ensure /tmp/hadoop-hadoop-namenode.pid file is empty before retry.\nStarting datanodes\nlocalhost: datanode is running as process ${this.svc.pids.dn}.  Stop it first and ensure /tmp/hadoop-hadoop-datanode.pid file is empty before retry.\nStarting secondary namenodes [${HOST}]\n${HOST}: secondarynamenode is running as process ${this.svc.pids.snn}.  Stop it first and ensure /tmp/hadoop-hadoop-secondarynamenode.pid file is empty before retry.`); return; }
  io.print('Starting namenodes on [localhost]'); await this.sleep(350);
  io.print('Starting datanodes'); await this.sleep(300);
  io.print(`Starting secondary namenodes [${HOST}]`); await this.sleep(300);
  this.svc.dfs = true; Object.assign(this.svc.pids, { nn: this.pid(), dn: this.pid(), snn: this.pid() });
  this.event({ kind: 'svc' });
};
COMMANDS['start-yarn.sh'] = async function (a, io) {
  if (this.svc.yarn) { io.print(`Starting resourcemanager\nresourcemanager is running as process ${this.svc.pids.rm}.  Stop it first and ensure /tmp/hadoop-hadoop-resourcemanager.pid file is empty before retry.\nStarting nodemanagers\nlocalhost: nodemanager is running as process ${this.svc.pids.nm}.  Stop it first and ensure /tmp/hadoop-hadoop-nodemanager.pid file is empty before retry.`); return; }
  io.print('Starting resourcemanager'); await this.sleep(350);
  io.print('Starting nodemanagers'); await this.sleep(300);
  this.svc.yarn = true; Object.assign(this.svc.pids, { rm: this.pid(), nm: this.pid() });
  this.event({ kind: 'svc' });
};
COMMANDS['start-all.sh'] = async function (a, io) { io.print('WARNING: Attempting to start all Apache Hadoop daemons as hadoop in 10 seconds.\nWARNING: This is not a recommended production deployment configuration.\nWARNING: Use CTRL-C to abort.'); await this.sleep(400); await COMMANDS['start-dfs.sh'].call(this, a, io); await COMMANDS['start-yarn.sh'].call(this, a, io); };
COMMANDS['stop-dfs.sh'] = async function (a, io) { io.print('Stopping namenodes on [localhost]\nStopping datanodes\nStopping secondary namenodes [' + HOST + ']'); this.svc.dfs = false; this.event({ kind: 'svc' }); };
COMMANDS['stop-yarn.sh'] = async function (a, io) { io.print('Stopping nodemanagers\nStopping resourcemanager'); this.svc.yarn = false; this.event({ kind: 'svc' }); };
COMMANDS['stop-all.sh'] = async function (a, io) { io.print('WARNING: Stopping all Apache Hadoop daemons as hadoop in 10 seconds.\nWARNING: Use CTRL-C to abort.'); await COMMANDS['stop-dfs.sh'].call(this, a, io); await COMMANDS['stop-yarn.sh'].call(this, a, io); };

/* ---------- hdfs ---------- */
COMMANDS.hdfs = async function (a, io) {
  const sub = a[0];
  if (sub === 'dfs') return HDFS.call(this, a.slice(1), io, 'hdfs dfs');
  if (sub === 'getconf') { const i = a.indexOf('-confKey'); const k = a[i + 1]; const conf = { 'fs.defaultFS': NN, 'dfs.replication': '1', 'dfs.blocksize': '134217728', 'dfs.namenode.name.dir': 'file:///home/hadoop/hadoopdata/hdfs/namenode' }; if (a.includes('-namenodes')) { io.print('localhost'); return; } if (k in conf) io.print(conf[k]); else { io.error(`Configuration ${k} is missing.`); return 1; } return; }
  if (sub === 'dfsadmin') { if (!this.dfsUp('report', io)) return 1; const used = this.hdfs.size('/'); io.print(`Configured Capacity: 105089261568 (97.87 GB)\nPresent Capacity: 68415287296 (63.72 GB)\nDFS Remaining: ${68415287296 - used} (63.72 GB)\nDFS Used: ${used} (${(used / 1024).toFixed(2)} KB)\nDFS Used%: 0.00%\nReplicated Blocks:\n\tUnder replicated blocks: 0\n\tMissing blocks: 0\n-------------------------------------------------\nLive datanodes (1):\n\nName: 127.0.0.1:9866 (localhost)\nHostname: ${HOST}\nDecommission Status : Normal`); return; }
  if (sub === 'namenode' && a[1] === '-format') {
    if (this.svc.dfs) { io.error('ERROR namenode.NameNode: Failed to start namenode. Stop HDFS (stop-dfs.sh) before formatting.'); return 1; }
    io.print('STARTUP_MSG: Starting NameNode\n...\nINFO common.Storage: Storage directory /home/hadoop/hadoopdata/hdfs/namenode has been successfully formatted.\nSHUTDOWN_MSG: Shutting down NameNode at ' + HOST + '/127.0.1.1');
    this.hdfs = new FS('hdfs'); ['/tmp', '/user/hadoop', '/user/hive/warehouse'].forEach(p => this.hdfs.mkdir(p, true)); this.hive = null; return;
  }
  if (sub === 'version' || sub === '--version') { io.print('Hadoop 3.3.6'); return; }
  io.print('Usage: hdfs [OPTIONS] SUBCOMMAND [SUBCOMMAND OPTIONS]\n  dfs        run a filesystem command on the file system\n  getconf    get config values from configuration\n  dfsadmin   run a DFS admin client\n  namenode   run the DFS namenode');
  return sub ? 1 : 0;
};
COMMANDS.hadoop = async function (a, io) {
  const sub = a[0];
  if (sub === 'fs' || sub === 'dfs') return HDFS.call(this, a.slice(1), io, 'hadoop fs');
  if (sub === 'version') { io.print('Hadoop 3.3.6\nSource code repository https://github.com/apache/hadoop.git -r 1be78238728da9266a4f88195058f08fd012bf9c\nCompiled by ubuntu on 2023-06-18T08:22Z\nThis command was run using /usr/local/hadoop/share/hadoop/common/hadoop-common-3.3.6.jar'); return; }
  if (sub === 'classpath') { io.print(this.syncCmd('hadoop classpath')); return; }
  if (sub === 'jar') { if (!G.MR) { io.error('MapReduce module missing'); return 1; } return G.MR.hadoopJar(this, a.slice(1), io); }
  io.print('Usage: hadoop [OPTIONS] SUBCOMMAND [SUBCOMMAND OPTIONS]\n  fs         run a generic filesystem user client\n  jar <jar>  run a jar file\n  version    print the version\n  classpath  prints the class path');
  return sub ? 1 : 0;
};
COMMANDS.javac = function (a, io) { return G.MR.javac(this, a, io); };
COMMANDS.jar = function (a, io) { return G.MR.jar(this, a, io); };
COMMANDS.hive = function (a, io) { return G.HIVE.start(this, a, io); };
COMMANDS.beeline = function (a, io) { io.print('Beeline is not configured in this lab; starting the Hive CLI instead.'); return G.HIVE.start(this, [], io); };
COMMANDS.pyspark = function (a, io) { return G.PY.startShell(this, a, io); };
COMMANDS['spark-submit'] = function (a, io) { return G.PY.submit(this, a, io); };

/* HDFS shell */
const HDFS_USAGE = `Usage: hadoop fs [generic options]
	[-cat [-ignoreCrc] <src> ...]
	[-copyFromLocal [-f] <localsrc> ... <dst>]
	[-copyToLocal <src> ... <localdst>]
	[-count [-q] [-h] <path> ...]
	[-cp [-f] <src> ... <dst>]
	[-du [-s] [-h] <path> ...]
	[-get <src> ... <localdst>]
	[-head <file>]
	[-ls [-R] [-h] <path> ...]
	[-mkdir [-p] <path> ...]
	[-mv <src> ... <dst>]
	[-put [-f] <localsrc> ... <dst>]
	[-rm [-f] [-r|-R] [-skipTrash] <src> ...]
	[-rmdir <dir> ...]
	[-tail [-f] <file>]
	[-touchz <path> ...]`;
async function HDFS(a, io, label) {
  const m = this; const H = m.hdfs, L = m.local;
  let op = a[0];
  if (!op) { io.error(HDFS_USAGE); return -1; }
  if (!op.startsWith('-')) { io.error(`${op}: Unknown command\nUsage: hadoop fs [generic options]`); return -1; }
  op = op.slice(1);
  const known = ['ls', 'lsr', 'mkdir', 'put', 'copyFromLocal', 'moveFromLocal', 'get', 'copyToLocal', 'cat', 'text', 'head', 'tail', 'touchz', 'touch', 'cp', 'mv', 'rm', 'rmr', 'rmdir', 'count', 'du', 'dus', 'df', 'stat', 'test', 'chmod', 'chown', 'setrep', 'appendToFile', 'getmerge', 'help', 'usage', 'find'];
  if (!known.includes(op)) { io.error(`-${op}: Unknown command\n${HDFS_USAGE}`); return -1; }
  if (op === 'help' || op === 'usage') { io.print(HDFS_USAGE); return 0; }
  if (!m.dfsUp(op, io)) return 1;
  const flags = new Set(); const args = [];
  for (const x of a.slice(1)) { if (/^-[a-zA-Z]+$/.test(x) && !['-skipTrash', '-ignoreCrc'].includes(x)) for (const c of x.slice(1)) flags.add(c); else if (x !== '-skipTrash' && x !== '-ignoreCrc') args.push(x); }
  const resolve = (p) => { const r = m.hpath(p); if (r.error === 'port') { io.error(`${op}: Call From ${HOST}/127.0.1.1 to ${r.host} failed on connection exception: java.net.ConnectException: Connection refused`); return null; } if (r.error) { io.error(`${op}: Wrong FS: ${p}, expected: ${NN}`); return null; } return r.path; };
  const expand = (p) => { const abs = resolve(p); if (abs === null) return null; if (!hasGlob(abs)) return [abs]; return H.glob(abs, '/').filter(x => H.exists(x)); };
  const shown = (orig, abs) => orig.startsWith('hdfs://') ? NN + abs : orig.startsWith('/') ? abs : orig;
  const noSuch = (p) => io.error(`${op}: \`${p}': No such file or directory`);
  const fmtEntry = (abs, e) => e.t === 'd' ? `drwxr-xr-x   - hadoop supergroup ${pad(0, 10)} ${hdfsDate(e.m)} ${abs}` : `-rw-r--r--   1 hadoop supergroup ${pad(byteLen(e.d), 10)} ${hdfsDate(e.m)} ${abs}`;
  let code = 0;
  switch (op) {
    case 'ls': case 'lsr': {
      const rec = flags.has('R') || op === 'lsr'; const targets = args.length ? args : ['.'];
      for (const t of targets) {
        const list = expand(t); if (!list) return 1;
        if (!list.length || !H.exists(list[0])) { noSuch(t === '.' ? '.' : t); code = 1; continue; }
        for (const abs of list) {
          const n = H.node(abs);
          if (n.t === 'f') { io.print(fmtEntry(t.startsWith('/') || t.startsWith('hdfs') ? abs : t, n)); continue; }
          const rows = [];
          const walk = (p) => { for (const k of H.list(p)) { const cp = H.join(p, k); const disp = t.startsWith('/') || t.startsWith('hdfs') ? (t.startsWith('hdfs') ? NN + cp : cp) : (t === '.' ? k : t.replace(/\/$/, '') + '/' + k) ; rows.push(fmtEntry(disp, H.node(cp))); if (rec && H.isDir(cp)) walk(cp); } };
          walk(abs);
          if (!rec && rows.length) io.print(`Found ${rows.length} items`);
          if (rows.length) io.print(rows.join('\n'));
        }
      }
      m.event({ kind: 'hdfs', op: 'ls' });
      return code;
    }
    case 'mkdir': {
      if (!args.length) { io.error('-mkdir: Not enough arguments: expected 1 but got 0\nUsage: hadoop fs [generic options] -mkdir [-p] <path> ...'); return -1; }
      for (const t of args) {
        const abs = resolve(t); if (abs === null) return 1;
        const r = H.mkdir(abs, flags.has('p'));
        if (r === 'exists' && !flags.has('p')) { io.error(`mkdir: \`${t}': File exists`); code = 1; }
        else if (r === 'noparent') { io.error(`mkdir: \`${t}': No such file or directory`); code = 1; }
        else if (r === 'notdir') { io.error(`mkdir: \`${t}': Is not a directory`); code = 1; }
        else m.event({ kind: 'hdfs', op: 'mkdir', path: abs });
      }
      return code;
    }
    case 'put': case 'copyFromLocal': case 'moveFromLocal': {
      if (args.length < 1) { io.error(`-${op}: Not enough arguments: expected 1 but got 0`); return -1; }
      const srcs = args.length === 1 ? args : args.slice(0, -1); const dstArg = args.length === 1 ? '.' : args[args.length - 1];
      const dst = resolve(dstArg); if (dst === null) return 1;
      const many = srcs.length > 1;
      if (many && !H.isDir(dst)) { io.error(`${op}: \`${dstArg}': ${H.exists(dst) ? 'Is not a directory' : 'No such file or directory'}`); return 1; }
      for (const s of srcs) {
        const sp = L.norm(s, m.cwd);
        if (!L.exists(sp)) { io.error(`${op}: \`${s}': No such file or directory`); code = 1; continue; }
        let target = H.isDir(dst) ? H.join(dst, sp.split('/').pop()) : dst;
        const [tpar] = H.parent(target);
        if (!H.isDir(tpar)) { io.error(`${op}: \`${dstArg}': No such file or directory: \`${NN}${target}'`); code = 1; continue; }
        if (H.exists(target) && !flags.has('f')) { io.error(`${op}: \`${shown(dstArg, target) === dstArg && !H.isDir(dst) ? dstArg : (dstArg.replace(/\/$/, '') + '/' + sp.split('/').pop())}': File exists`); code = 1; continue; }
        if (H.exists(target)) H.rm(target);
        if (L.isDir(sp)) { const copyDir = (lp, hp) => { H.mkdir(hp, true); for (const k of L.list(lp)) { const c = L.join(lp, k); if (L.isDir(c)) copyDir(c, H.join(hp, k)); else H.write(H.join(hp, k), L.read(c)); } }; copyDir(sp, target); }
        else H.write(target, L.read(sp));
        if (op === 'moveFromLocal') L.rm(sp);
        m.event({ kind: 'hdfs', op: 'put', path: target });
      }
      return code;
    }
    case 'get': case 'copyToLocal': {
      if (!args.length) { io.error(`-${op}: Not enough arguments: expected 1 but got 0`); return -1; }
      const srcs = args.length === 1 ? args : args.slice(0, -1); const dstArg = args.length === 1 ? '.' : args[args.length - 1];
      const dst = L.norm(dstArg, m.cwd);
      for (const s of srcs) {
        const list = expand(s); if (!list) return 1;
        if (!list.length || !H.exists(list[0])) { noSuch(s); code = 1; continue; }
        for (const abs of list) {
          const target = L.isDir(dst) ? L.join(dst, abs.split('/').pop()) : dst;
          if (L.exists(target) && !flags.has('f')) { io.error(`${op}: \`${L.isDir(dst) ? (dstArg.replace(/\/$/, '') + '/' + abs.split('/').pop()).replace(/^\.\//, '') : dstArg}': File exists`); code = 1; continue; }
          if (!L.isDir(L.parent(target)[0])) { io.error(`${op}: \`${dstArg}': No such file or directory`); code = 1; continue; }
          if (H.isDir(abs)) { const cp = (hp, lp) => { L.mkdir(lp, true); for (const k of H.list(hp)) { const c = H.join(hp, k); if (H.isDir(c)) cp(c, L.join(lp, k)); else L.write(L.join(lp, k), H.read(c)); } }; cp(abs, target); }
          else L.write(target, H.read(abs));
          m.event({ kind: 'hdfs', op: 'get', path: abs, local: target });
        }
      }
      return code;
    }
    case 'cat': case 'text': case 'head': case 'tail': {
      if (!args.length) { io.error(`-${op}: Not enough arguments: expected 1 but got 0`); return -1; }
      for (const t of args) {
        const list = expand(t); if (!list) return 1;
        if (!list.length || !H.exists(list[0])) { noSuch(t); code = 1; continue; }
        for (const abs of list) {
          if (H.isDir(abs)) { io.error(`${op}: \`${hasGlob(t) ? abs : t}': Is a directory`); code = 1; continue; }
          let d = H.read(abs);
          if (op === 'head') d = d.slice(0, 1024); if (op === 'tail') d = d.slice(-1024);
          if (d.length) io.print(d.replace(/\n$/, '').replace(/\u0001/g, '\u001bA^A\u001b0'));
          m.event({ kind: 'hdfs', op: 'cat', path: abs });
        }
      }
      return code;
    }
    case 'touchz': case 'touch': {
      for (const t of args) {
        const abs = resolve(t); if (abs === null) return 1;
        if (H.isDir(abs)) { io.error(`touchz: \`${t}': Is a directory`); code = 1; continue; }
        if (H.exists(abs) && H.read(abs).length) { io.error(`touchz: \`${t}': Not a zero-length file`); code = 1; continue; }
        if (!H.isDir(H.parent(abs)[0])) { io.error(`touchz: \`${t}': No such file or directory`); code = 1; continue; }
        H.write(abs, ''); m.event({ kind: 'hdfs', op: 'touchz', path: abs });
      }
      return code;
    }
    case 'cp': case 'mv': {
      if (args.length < 2) { io.error(`-${op}: Not enough arguments: expected 2 but got ${args.length}`); return -1; }
      const dstArg = args[args.length - 1]; const dst = resolve(dstArg); if (dst === null) return 1;
      for (const s of args.slice(0, -1)) {
        const list = expand(s); if (!list) return 1;
        if (!list.length || !H.exists(list[0])) { noSuch(s); code = 1; continue; }
        for (const abs of list) {
          const target = H.isDir(dst) ? H.join(dst, abs.split('/').pop()) : dst;
          if (H.exists(target) && !(op === 'cp' && flags.has('f'))) { io.error(`${op}: \`${H.isDir(dst) ? target : dstArg}': File exists`); code = 1; continue; }
          if (!H.isDir(H.parent(target)[0])) { io.error(`${op}: \`${dstArg}': No such file or directory`); code = 1; continue; }
          if (target === abs || target.startsWith(abs + '/')) { io.error(`${op}: \`${s}' to \`${dstArg}': is a subdirectory of itself`); code = 1; continue; }
          H.copy(abs, target); if (op === 'mv') H.rm(abs);
          m.event({ kind: 'hdfs', op, path: abs, to: target });
        }
      }
      return code;
    }
    case 'rm': case 'rmr': {
      if (!args.length) { io.error('-rm: Not enough arguments: expected 1 but got 0'); return -1; }
      const rec = flags.has('r') || flags.has('R') || op === 'rmr';
      for (const t of args) {
        const list = expand(t); if (!list) return 1;
        if (!list.length || !H.exists(list[0])) { if (!flags.has('f')) { noSuch(t); code = 1; } continue; }
        for (const abs of list) {
          if (H.isDir(abs) && !rec) { io.error(`rm: \`${t}': Is a directory`); code = 1; continue; }
          if (abs === '/') { io.error('rm: Cannot delete root directory'); code = 1; continue; }
          H.rm(abs); io.print(`Deleted ${t.startsWith('hdfs://') ? NN + abs : hasGlob(t) || t.startsWith('/') ? abs : t}`);
          m.event({ kind: 'hdfs', op: 'rm', path: abs });
        }
      }
      return code;
    }
    case 'rmdir': {
      for (const t of args) {
        const abs = resolve(t); if (abs === null) return 1;
        if (!H.exists(abs)) { io.error(`rmdir: \`${t}': No such file or directory`); code = 1; continue; }
        if (!H.isDir(abs)) { io.error(`rmdir: \`${t}': Is not a directory`); code = 1; continue; }
        if (H.list(abs).length) { io.error(`rmdir: \`${t}': Directory is not empty`); code = 1; continue; }
        H.rm(abs); m.event({ kind: 'hdfs', op: 'rmdir', path: abs });
      }
      return code;
    }
    case 'count': {
      const targets = args.length ? args : ['.'];
      for (const t of targets) {
        const list = expand(t); if (!list) return 1;
        if (!list.length || !H.exists(list[0])) { io.error(`count: \`${t}': No such file or directory`); code = 1; continue; }
        for (const abs of list) { const [d, f] = H.counts(abs); const sz = H.size(abs); io.print(`${pad(d, 12)} ${pad(f, 11)} ${pad(flags.has('h') ? human(sz) : sz, 18)} ${t.startsWith('hdfs') ? NN + abs : t.startsWith('/') ? abs : t}`); }
        m.event({ kind: 'hdfs', op: 'count', path: list[0] });
      }
      return code;
    }
    case 'du': case 'dus': {
      const targets = args.length ? args : ['.']; const sum = flags.has('s') || op === 'dus';
      for (const t of targets) {
        const list = expand(t); if (!list) return 1;
        if (!list.length || !H.exists(list[0])) { io.error(`du: \`${t}': No such file or directory`); code = 1; continue; }
        for (const abs of list) {
          const f = (x) => flags.has('h') ? human(x) : x;
          const lines = (sum || H.isFile(abs)) ? [[H.size(abs), abs]] : H.list(abs).map(k => [H.size(H.join(abs, k)), H.join(abs, k)]);
          const w = Math.max(...lines.map(l => String(f(l[0])).length), 1);
          io.print(lines.map(([s, p]) => `${padR(f(s), w)}  ${padR(f(s), w)}  ${p}`).join('\n'));
        }
        m.event({ kind: 'hdfs', op: 'du', path: list[0] });
      }
      return code;
    }
    case 'df': { const used = H.size('/'); io.print(`Filesystem                     Size   Used   Available  Use%\n${NN}  105089261568  ${used}  68415287296    0%`); return 0; }
    case 'stat': { const abs = resolve(args[args.length - 1]); const n = H.node(abs); if (!n) { noSuch(args[args.length - 1]); return 1; } io.print(hdfsDate(n.m) + ':00'); return 0; }
    case 'test': { const abs = resolve(args[0]); const n = H.node(abs); if (flags.has('e')) return n ? 0 : 1; if (flags.has('d')) return n && n.t === 'd' ? 0 : 1; if (flags.has('f')) return n && n.t === 'f' ? 0 : 1; if (flags.has('z')) return n && n.t === 'f' && !n.d.length ? 0 : 1; return 1; }
    case 'chmod': case 'chown': case 'setrep': return 0;
    case 'appendToFile': { const dst = resolve(args[args.length - 1]); for (const s of args.slice(0, -1)) { const d = L.read(L.norm(s, m.cwd)); if (d === null) { io.error(`appendToFile: \`${s}': No such file or directory`); return 1; } if (!H.write(dst, d, true)) { noSuch(args[args.length - 1]); return 1; } } return 0; }
    case 'getmerge': { const list = expand(args[0]); if (!list || !H.isDir(list[0])) { noSuch(args[0]); return 1; } const d = H.list(list[0]).filter(k => !k.startsWith('_')).map(k => H.read(H.join(list[0], k)) || '').join(''); L.write(L.norm(args[1], m.cwd), d); return 0; }
    case 'find': { const abs = resolve(args[0] || '/'); const ni = a.indexOf('-name'); const re = ni >= 0 ? globToRe(a[ni + 1]) : null; const res = []; const walk = (p) => { if (!re || re.test(p.split('/').pop())) res.push(p); if (H.isDir(p)) for (const k of H.list(p)) walk(H.join(p, k)); }; if (!H.exists(abs)) { noSuch(args[0]); return 1; } walk(abs); io.print(res.join('\n')); return 0; }
  }
  return 0;
}
function human(n) { if (n < 1024) return String(n); const u = ['K', 'M', 'G']; let i = -1; do { n /= 1024; i++; } while (n >= 1024 && i < 2); return (Math.round(n * 10) / 10) + ' ' + u[i]; }

/* ---------- completion ---------- */
Machine.prototype.complete = function (line) {
  const mode = this.mode();
  const words = line.split(/\s+/); const last = words[words.length - 1] || '';
  let cands = [];
  if (mode === 'bash' && words.length === 1) cands = Object.keys(COMMANDS).filter(c => c.startsWith(last));
  else if (mode === 'bash') {
    const slash = last.lastIndexOf('/'); const dirPart = slash >= 0 ? last.slice(0, slash + 1) : ''; const base = last.slice(slash + 1);
    const isHdfs = /^hdfs dfs|^hadoop fs/.test(line) && (last.startsWith('/') || last.startsWith('hdfs')) && !(words[2] === '-put' && words.length === 4) && !(words[2] === '-get' && words.length === 5);
    const fs = isHdfs ? this.hdfs : this.local;
    const dirAbs = isHdfs ? fs.norm(dirPart || '/', '/') : fs.norm((dirPart || '.').replace(/^~/, HOME), this.cwd);
    if (isHdfs && last.startsWith('hdfs')) return [];
    cands = fs.list(dirAbs).filter(k => k.startsWith(base)).map(k => dirPart + k + (fs.isDir(fs.join(dirAbs, k)) ? '/' : ''));
  } else if (mode === 'hive') {
    const kw = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'SORT BY', 'HAVING', 'LIMIT', 'CREATE', 'TABLE', 'DATABASE', 'INSERT', 'OVERWRITE', 'INTO', 'LOAD', 'DATA', 'INPATH', 'DESCRIBE', 'SHOW', 'TABLES', 'DATABASES', 'ALTER', 'DROP', 'EXPORT', 'IMPORT', 'JOIN', 'LEFT', 'RIGHT', 'FULL', 'OUTER'];
    const tables = G.HIVE ? G.HIVE.names(this) : [];
    cands = kw.concat(tables).filter(k => k.toLowerCase().startsWith(last.toLowerCase()) && last.length);
    if (cands.length) cands = cands.map(c => /[a-z]/.test(last) && /^[A-Z ]+$/.test(c) ? c.toLowerCase() : c);
  }
  return cands.map(c => words.slice(0, -1).concat(c).join(' ') + (mode === 'bash' && !c.endsWith('/') && cands.length === 1 ? ' ' : ''));
};

G.SIM = { Machine, FS, COMMANDS, NN, HOME, HOST, HADOOP_HOME, EXAMPLES_JAR, byteLen, hdfsDate, pad, padR, globToRe, hasGlob };
})(typeof window !== 'undefined' ? window : globalThis);

/* ---------- lines needed to run a snippet in a given shell (used by "Run in terminal") ---------- */
(function (G) {
  G.SIM.Machine.prototype.linesFor = function (target, code) {
    const out = []; let cur = this.mode();
    const toBash = () => { if (cur === 'hive') out.push('quit;'); if (cur === 'pyspark') out.push('exit()'); cur = 'bash'; };
    const needDfs = target !== 'bash' || /\b(hdfs|hadoop|hive|pyspark|spark-submit)\b/.test(code);
    const needYarn = target === 'hive' || /hadoop jar|\bhive\b/.test(code);
    if ((needDfs && !this.svc.dfs) || (needYarn && !this.svc.yarn)) {
      toBash();
      if (!/start-dfs/.test(code) && needDfs && !this.svc.dfs) out.push('start-dfs.sh');
      if (!/start-yarn/.test(code) && needYarn && !this.svc.yarn) out.push('start-yarn.sh');
    }
    if (target === 'bash') toBash();
    else if (target === 'hive') { if (cur === 'pyspark') toBash(); if (cur !== 'hive') out.push('hive'); }
    else if (target === 'py') { if (cur === 'hive') toBash(); if (cur !== 'pyspark') out.push('pyspark'); }
    const lines = code.replace(/\n+$/, '').split('\n');
    out.push(...lines);
    if (target === 'py' && lines.some(l => /^\s+\S/.test(l) && !/\\$/.test(lines[lines.indexOf(l) - 1] || '')) && /:\s*$/.test(lines.find(l => /:\s*$/.test(l)) || '')) out.push('');
    return out;
  };
})(typeof window !== 'undefined' ? window : globalThis);
