/* ===== Mini Python interpreter + PySpark ===== */
(function (G) {
'use strict';
const jd = (v) => G.javaDouble(v);
const NN = G.SIM.NN;

/* ================= values ================= */
class PyFloat { constructor(v) { this.v = v; } valueOf() { return this.v; } }
const F = (v) => new PyFloat(v);
const isF = (x) => x instanceof PyFloat;
const num = (x) => (isF(x) ? x.v : x);
const isNum = (x) => typeof x === 'number' || isF(x);
const isInt = (x) => typeof x === 'number';
const tup = (a) => { a.__tuple = true; return a; };
const isTup = (x) => Array.isArray(x) && x.__tuple;
const isList = (x) => Array.isArray(x) && !x.__tuple;
class PyErr extends Error { constructor(type, msg, extra) { super(msg); this.pytype = type; this.extra = extra; } }
const err = (t, m, x) => { throw new PyErr(t, m, x); };
class PyDict { constructor() { this.m = new Map(); } key(k) { return isF(k) ? 'n:' + k.v : typeof k === 'number' ? 'n:' + k : typeof k === 'string' ? 's:' + k : 'r:' + repr(k); } get(k) { const e = this.m.get(this.key(k)); return e ? e[1] : undefined; } set(k, v) { this.m.set(this.key(k), [k, v]); } has(k) { return this.m.has(this.key(k)); } del(k) { this.m.delete(this.key(k)); } keys() { return [...this.m.values()].map(e => e[0]); } values() { return [...this.m.values()].map(e => e[1]); } items() { return [...this.m.values()].map(e => tup([e[0], e[1]])); } get size() { return this.m.size; } }
class PyFunc { constructor(name, params, body, scope, isLambda) { this.name = name; this.params = params; this.body = body; this.scope = scope; this.isLambda = isLambda; } }
class Builtin { constructor(name, fn, self) { this.name = name; this.fn = fn; this.self = self; } }
const B = (name, fn) => new Builtin(name, fn);
class PyModule { constructor(name, attrs) { this.name = name; this.attrs = attrs; } }
class PyClassRef { constructor(name, ctor, attrs) { this.name = name; this.ctor = ctor; this.attrs = attrs || {}; } }

function typeName(x) {
  if (x === null || x === undefined) return 'NoneType';
  if (typeof x === 'boolean') return 'bool'; if (typeof x === 'number') return 'int'; if (isF(x)) return 'float'; if (typeof x === 'string') return 'str';
  if (isTup(x)) return 'tuple'; if (Array.isArray(x)) return 'list'; if (x instanceof PyDict) return 'dict';
  if (x instanceof PyFunc) return 'function'; if (x instanceof Builtin) return 'builtin_function_or_method'; if (x instanceof PyModule) return 'module';
  if (x && x.pyType) return x.pyType; return 'object';
}
function pyFloatRepr(v) {
  if (!isFinite(v)) return isNaN(v) ? 'nan' : v > 0 ? 'inf' : '-inf';
  if (Number.isInteger(v) && Math.abs(v) < 1e16) return v.toFixed(1);
  let s = String(v);
  if (/e/.test(s)) { s = s.replace(/e\+?/, 'e+').replace('e+-', 'e-'); const [mm, ee] = s.split('e'); const sign = ee[0]; const digits = ee.slice(1).padStart(2, '0'); s = mm + 'e' + sign + digits; }
  return s;
}
function strRepr(s) { const q = s.includes("'") && !s.includes('"') ? '"' : "'"; return q + s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(new RegExp(q, 'g'), '\\' + q) + q; }
function repr(x) {
  if (x === null || x === undefined) return 'None';
  if (x === true) return 'True'; if (x === false) return 'False';
  if (typeof x === 'number') return String(x);
  if (isF(x)) return pyFloatRepr(x.v);
  if (typeof x === 'string') return strRepr(x);
  if (isTup(x)) return x.length === 1 ? '(' + repr(x[0]) + ',)' : '(' + x.map(repr).join(', ') + ')';
  if (Array.isArray(x)) return '[' + x.map(repr).join(', ') + ']';
  if (x instanceof PyDict) return x.isDefault ? `defaultdict(<class 'int'>, {${x.items().map(([k, v]) => repr(k) + ': ' + repr(v)).join(', ')}})` : '{' + x.items().map(([k, v]) => repr(k) + ': ' + repr(v)).join(', ') + '}';
  if (x instanceof PyFunc) return x.isLambda ? '<function <lambda> at 0x7f3a2c1b4d30>' : `<function ${x.name} at 0x7f3a2c1b4d30>`;
  if (x instanceof Builtin) return `<built-in function ${x.name}>`;
  if (x instanceof PyModule) return `<module '${x.name}'>`;
  if (x instanceof PyClassRef) return `<class '${x.name}'>`;
  if (x && x.pyRepr) return x.pyRepr();
  return String(x);
}
function str(x) { if (typeof x === 'string') return x; if (x && x.pyStr) return x.pyStr(); return repr(x); }
function truthy(x) { if (x === null || x === undefined || x === false) return false; if (x === 0) return false; if (isF(x)) return x.v !== 0; if (typeof x === 'string' || Array.isArray(x)) return x.length > 0; if (x instanceof PyDict) return x.size > 0; if (x && x.pyBool) return x.pyBool(); return true; }
function pyEq(a, b) {
  if (isNum(a) && isNum(b)) return num(a) === num(b);
  if (typeof a === 'boolean' || typeof b === 'boolean') return (a === true ? 1 : a === false ? 0 : num(a)) === (b === true ? 1 : b === false ? 0 : num(b));
  if (Array.isArray(a) && Array.isArray(b)) return !!a.__tuple === !!b.__tuple && a.length === b.length && a.every((v, i) => pyEq(v, b[i]));
  if (a instanceof Row && b instanceof Row) return pyEq(a.vals, b.vals);
  return a === b;
}
function pyCmp(a, b, op) {
  if (isNum(a) && isNum(b) || typeof a === 'boolean' || typeof b === 'boolean') { const x = num(a === true ? 1 : a === false ? 0 : a), y = num(b === true ? 1 : b === false ? 0 : b); return x < y ? -1 : x > y ? 1 : 0; }
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (Array.isArray(a) && Array.isArray(b)) { for (let i = 0; i < Math.min(a.length, b.length); i++) { if (!pyEq(a[i], b[i])) return pyCmp(a[i], b[i], op); } return a.length - b.length; }
  err('TypeError', `'${op}' not supported between instances of '${typeName(a)}' and '${typeName(b)}'`);
}
function iterate(x) {
  if (Array.isArray(x)) return x;
  if (typeof x === 'string') return [...x];
  if (x instanceof PyDict) return x.keys();
  if (x && x.pyIter) return x.pyIter();
  err('TypeError', `'${typeName(x)}' object is not iterable`);
}

/* ================= lexer ================= */
const OPS = ['**=', '//=', '>>=', '<<=', '...', '**', '//', '==', '!=', '<=', '>=', '->', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '+', '-', '*', '/', '%', '@', '&', '|', '^', '~', '<', '>', '(', ')', '[', ']', '{', '}', ',', ':', '.', ';', '='];
function lex(src) {
  const toks = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    const sm = src.slice(i).match(/^([rRfFbBuU]{0,2})('''|"""|'|")/);
    if (sm && (sm[1] === '' || /^[a-zA-Z]+$/.test(sm[1]))) {
      const pre = sm[1].toLowerCase(), q = sm[2]; let j = i + sm[0].length, s = '';
      while (j < src.length && !src.startsWith(q, j)) {
        if (src[j] === '\\' && !pre.includes('r')) { const n = src[j + 1]; s += n === 'n' ? '\n' : n === 't' ? '\t' : n === '\\' ? '\\' : n === "'" ? "'" : n === '"' ? '"' : n === '\n' ? '' : '\\' + n; j += 2; continue; }
        if (q.length === 1 && src[j] === '\n') err('SyntaxError', 'unterminated string literal (detected at line 1)');
        s += src[j]; j++;
      }
      if (j >= src.length) err('SyntaxError', q.length === 3 ? 'unterminated triple-quoted string literal' : 'unterminated string literal (detected at line 1)');
      toks.push({ t: 'str', v: s, f: pre.includes('f') }); i = j + q.length; continue;
    }
    const nm = src.slice(i).match(/^(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?/);
    if (nm && !/[a-zA-Z_]/.test(src[i - 1] || '')) { const txt = nm[0]; toks.push({ t: 'num', v: Number(txt), float: /[.eE]/.test(txt) }); i += txt.length; continue; }
    const id = src.slice(i).match(/^[A-Za-z_]\w*/);
    if (id) { toks.push({ t: 'name', v: id[0] }); i += id[0].length; continue; }
    const op = OPS.find(o => src.startsWith(o, i));
    if (op) { toks.push({ t: 'op', v: op }); i += op.length; continue; }
    err('SyntaxError', `invalid character '${c}' (U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')})`);
  }
  toks.push({ t: 'eof' });
  return toks;
}

/* ================= parser ================= */
class Parser {
  constructor(toks) { this.t = toks; this.i = 0; }
  peek(o = 0) { return this.t[this.i + o]; }
  next() { return this.t[this.i++]; }
  isOp(v) { const k = this.peek(); return k.t === 'op' && k.v === v; }
  isName(v) { const k = this.peek(); return k.t === 'name' && k.v === v; }
  eat(v) { if (this.isOp(v) || this.isName(v)) return this.next(); return null; }
  expect(v) { if (!this.eat(v)) { const k = this.peek(); err('SyntaxError', k.t === 'eof' ? `'${v === ')' ? '(' : v === ']' ? '[' : v}' was never closed` : 'invalid syntax'); } }
  atEnd() { return this.peek().t === 'eof'; }
  exprList() { // tuple without parens
    const first = this.expr(); if (!this.isOp(',')) return first;
    const items = [first]; while (this.eat(',')) { if (this.atEnd() || this.isOp('=') || this.isOp(')')) break; items.push(this.expr()); }
    return { k: 'tuple', items };
  }
  expr() { // lambda / ternary
    if (this.isName('lambda')) {
      this.next(); const params = [];
      while (!this.isOp(':')) { const n = this.next(); if (n.t !== 'name') err('SyntaxError', 'invalid syntax'); let def = null; if (this.eat('=')) def = this.ternary(); params.push({ name: n.v, def }); if (!this.eat(',')) break; }
      this.expect(':'); return { k: 'lambda', params, body: this.expr() };
    }
    return this.ternary();
  }
  ternary() { const a = this.or(); if (this.isName('if')) { this.next(); const c = this.or(); if (!this.eat('else')) err('SyntaxError', "expected 'else' after 'if' expression"); const b = this.expr(); return { k: 'ifexp', c, a, b }; } return a; }
  or() { let l = this.and(); while (this.isName('or')) { this.next(); l = { k: 'bool', op: 'or', l, r: this.and() }; } return l; }
  and() { let l = this.not(); while (this.isName('and')) { this.next(); l = { k: 'bool', op: 'and', l, r: this.not() }; } return l; }
  not() { if (this.isName('not')) { this.next(); return { k: 'not', e: this.not() }; } return this.cmp(); }
  cmp() {
    let l = this.bor(); const ops = []; const rs = [];
    for (;;) {
      const k = this.peek(); let op = null;
      if (k.t === 'op' && ['<', '>', '==', '>=', '<=', '!='].includes(k.v)) { this.next(); op = k.v; }
      else if (this.isName('in')) { this.next(); op = 'in'; }
      else if (this.isName('not') && this.peek(1).t === 'name' && this.peek(1).v === 'in') { this.next(); this.next(); op = 'not in'; }
      else if (this.isName('is')) { this.next(); op = this.eat('not') ? 'is not' : 'is'; }
      if (!op) break; ops.push(op); rs.push(this.bor());
    }
    if (!ops.length) return l; return { k: 'cmp', l, ops, rs };
  }
  bor() { let l = this.bxor(); while (this.isOp('|')) { this.next(); l = { k: 'bin', op: '|', l, r: this.bxor() }; } return l; }
  bxor() { let l = this.band(); while (this.isOp('^')) { this.next(); l = { k: 'bin', op: '^', l, r: this.band() }; } return l; }
  band() { let l = this.shift(); while (this.isOp('&')) { this.next(); l = { k: 'bin', op: '&', l, r: this.shift() }; } return l; }
  shift() { let l = this.arith(); while (this.isOp('<<') || this.isOp('>>')) { const op = this.next().v; l = { k: 'bin', op, l, r: this.arith() }; } return l; }
  arith() { let l = this.term(); while (this.isOp('+') || this.isOp('-')) { const op = this.next().v; l = { k: 'bin', op, l, r: this.term() }; } return l; }
  term() { let l = this.unary(); while (['*', '/', '//', '%', '@'].some(o => this.isOp(o))) { const op = this.next().v; l = { k: 'bin', op, l, r: this.unary() }; } return l; }
  unary() { if (this.isOp('-') || this.isOp('+') || this.isOp('~')) { const op = this.next().v; return { k: 'unary', op, e: this.unary() }; } return this.power(); }
  power() { const b = this.postfix(); if (this.isOp('**')) { this.next(); return { k: 'bin', op: '**', l: b, r: this.unary() }; } return b; }
  postfix() {
    let e = this.atom();
    for (;;) {
      if (this.isOp('.')) { this.next(); const n = this.next(); if (n.t !== 'name') err('SyntaxError', 'invalid syntax'); e = { k: 'attr', o: e, name: n.v }; continue; }
      if (this.isOp('(')) { this.next(); const { args, kwargs, star } = this.callArgs(); e = { k: 'call', f: e, args, kwargs, star }; continue; }
      if (this.isOp('[')) { this.next(); const idx = this.subscript(); this.expect(']'); e = { k: 'index', o: e, idx }; continue; }
      break;
    }
    return e;
  }
  subscript() {
    const part = () => (this.isOp(':') || this.isOp(']') ? null : this.expr());
    const a = part();
    if (this.isOp(':')) { this.next(); const b = part(); let c = null; if (this.eat(':')) c = part(); return { k: 'slice', a, b, c }; }
    if (this.isOp(',')) { const items = [a]; while (this.eat(',')) { if (this.isOp(']')) break; items.push(this.expr()); } return { k: 'tuple', items }; }
    return a;
  }
  callArgs() {
    const args = [], kwargs = [], star = [];
    while (!this.isOp(')')) {
      if (this.atEnd()) err('SyntaxError', "'(' was never closed");
      if (this.isOp('*')) { this.next(); args.push({ k: 'star', e: this.expr() }); }
      else if (this.isOp('**')) { this.next(); kwargs.push({ name: '**', e: this.expr() }); }
      else if (this.peek().t === 'name' && this.peek(1).t === 'op' && this.peek(1).v === '=') { const n = this.next().v; this.next(); kwargs.push({ name: n, e: this.expr() }); }
      else { if (kwargs.length) err('SyntaxError', 'positional argument follows keyword argument'); const e = this.expr(); if (this.isName('for')) { args.push(this.compFor(e, 'gen')); } else args.push(e); }
      if (!this.eat(',')) break;
    }
    this.expect(')');
    return { args, kwargs, star };
  }
  compFor(elt, kind, valElt) {
    const gens = [];
    while (this.isName('for')) {
      this.next(); const target = this.targetList(); if (!this.eat('in')) err('SyntaxError', 'invalid syntax'); const it = this.or(); const conds = [];
      while (this.isName('if')) { this.next(); conds.push(this.or()); }
      gens.push({ target, it, conds });
    }
    return { k: 'comp', kind, elt, valElt, gens };
  }
  targetList() { const t = []; do { if (this.isOp('(')) { this.next(); const inner = this.targetList(); this.expect(')'); t.push(inner); } else { const n = this.next(); if (n.t !== 'name') err('SyntaxError', 'invalid syntax'); t.push({ k: 'name', v: n.v }); } } while (this.isOp(',') && this.next()); return t.length === 1 ? t[0] : { k: 'tuple', items: t }; }
  atom() {
    const k = this.next();
    if (k.t === 'num') return { k: 'num', v: k.v, float: k.float };
    if (k.t === 'str') { let parts = [k]; while (this.peek().t === 'str') parts.push(this.next()); if (parts.some(p => p.f)) return { k: 'fstr', parts }; return { k: 'str', v: parts.map(p => p.v).join('') }; }
    if (k.t === 'name') {
      if (k.v === 'True') return { k: 'const', v: true }; if (k.v === 'False') return { k: 'const', v: false }; if (k.v === 'None') return { k: 'const', v: null };
      if (['if', 'else', 'for', 'in', 'and', 'or', 'not', 'def', 'return', 'import', 'from', 'class', 'while', 'pass'].includes(k.v)) err('SyntaxError', 'invalid syntax');
      return { k: 'name', v: k.v };
    }
    if (k.t === 'op') {
      if (k.v === '(') {
        if (this.eat(')')) return { k: 'tuple', items: [] };
        const e = this.expr();
        if (this.isName('for')) { const c = this.compFor(e, 'gen'); this.expect(')'); return c; }
        if (this.isOp(',')) { const items = [e]; while (this.eat(',')) { if (this.isOp(')')) break; items.push(this.expr()); } this.expect(')'); return { k: 'tuple', items }; }
        this.expect(')'); return e;
      }
      if (k.v === '[') {
        if (this.eat(']')) return { k: 'list', items: [] };
        const first = this.isOp('*') ? (this.next(), { k: 'star', e: this.expr() }) : this.expr();
        if (this.isName('for')) { const c = this.compFor(first, 'list'); this.expect(']'); return c; }
        const items = [first]; while (this.eat(',')) { if (this.isOp(']')) break; items.push(this.isOp('*') ? (this.next(), { k: 'star', e: this.expr() }) : this.expr()); }
        this.expect(']'); return { k: 'list', items };
      }
      if (k.v === '{') {
        if (this.eat('}')) return { k: 'dict', items: [] };
        const key = this.expr();
        if (this.eat(':')) { const val = this.expr(); if (this.isName('for')) { const c = this.compFor(key, 'dict', val); this.expect('}'); return c; } const items = [[key, val]]; while (this.eat(',')) { if (this.isOp('}')) break; const kk = this.expr(); this.expect(':'); items.push([kk, this.expr()]); } this.expect('}'); return { k: 'dict', items }; }
        if (this.isName('for')) { const c = this.compFor(key, 'set'); this.expect('}'); return c; }
        const items = [key]; while (this.eat(',')) { if (this.isOp('}')) break; items.push(this.expr()); } this.expect('}'); return { k: 'set', items };
      }
    }
    if (k.t === 'eof') err('SyntaxError', 'invalid syntax');
    err('SyntaxError', 'invalid syntax');
  }
}
function parseExpr(src) { const p = new Parser(lex(src)); const e = p.exprList(); if (!p.atEnd()) err('SyntaxError', 'invalid syntax'); return e; }

/* ===== statements: logical lines and blocks ===== */
function logicalLines(src) {
  const out = []; const lines = src.replace(/\r/g, '').split('\n'); let buf = '', depth = 0, inTriple = null, start = 0;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (!buf && !line.trim()) continue;
    if (!buf) start = n;
    buf += (buf ? '\n' : '') + line;
    // scan for brackets/strings
    let i = 0; depth = 0; inTriple = null; let q = null;
    const s = buf;
    for (i = 0; i < s.length; i++) {
      const c = s[i];
      if (inTriple) { if (s.startsWith(inTriple, i)) { inTriple = null; i += 2; } continue; }
      if (q) { if (c === '\\') { i++; continue; } if (c === q || c === '\n') q = null; continue; }
      if (c === '#') { while (i < s.length && s[i] !== '\n') i++; continue; }
      if (s.startsWith("'''", i) || s.startsWith('"""', i)) { inTriple = s.substr(i, 3); i += 2; continue; }
      if (c === "'" || c === '"') { q = c; continue; }
      if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--;
    }
    if (inTriple || depth > 0 || /\\$/.test(buf)) continue;
    const indent = buf.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
    const text = buf.trim();
    if (!text.startsWith('#')) out.push({ indent, text, line: start + 1 });
    buf = '';
  }
  if (buf.trim()) out.push({ indent: buf.match(/^[ \t]*/)[0].length, text: buf.trim(), line: start + 1, incomplete: true });
  return out;
}
function needsMore(src) {
  const ll = logicalLines(src);
  if (ll.some(l => l.incomplete)) return true;
  const last = ll[ll.length - 1];
  if (!last) return false;
  if (ll.length && /:\s*(#.*)?$/.test(ll[0].text) && /^(def|for|if|while|with|try|class|elif|else|except|finally)\b/.test(ll[0].text)) return !/\n\s*$/.test(src);
  return false;
}
function splitTopLevel(text, sepRe) { // find top-level '=' etc
  let d = 0, q = null;
  for (let i = 0; i < text.length; i++) { const c = text[i]; if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; } if (c === "'" || c === '"') { q = c; continue; } if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--; else if (d === 0 && sepRe(text, i)) return i; }
  return -1;
}
function parseBlock(lines, idx, indent) {
  const stmts = [];
  while (idx < lines.length) {
    const L = lines[idx];
    if (L.indent < indent) break;
    if (L.indent > indent) err('IndentationError', 'unexpected indent', { line: L.line });
    const [st, ni] = parseStmt(lines, idx);
    stmts.push(st); idx = ni;
  }
  return [stmts, idx];
}
function parseSuite(lines, idx, L, headLen) {
  const rest = L.text.slice(headLen).trim();
  if (rest) { const [st] = parseStmt([{ indent: L.indent, text: rest, line: L.line }], 0); return [[st], idx + 1]; }
  const next = lines[idx + 1];
  if (!next || next.indent <= L.indent) err('IndentationError', `expected an indented block after '${L.text.split(/[\s(:]/)[0]}' statement on line ${L.line}`);
  return parseBlock(lines, idx + 1, next.indent);
}
function headerColon(text) { return splitTopLevel(text, (s, i) => s[i] === ':' && !/^\s*$/.test(s.slice(i + 1).replace(/#.*$/, '')) ? true : s[i] === ':' && i === s.replace(/\s*(#.*)?$/, '').length - 1); }
function parseStmt(lines, idx) {
  const L = lines[idx]; let t = L.text.replace(/;\s*$/, '');
  const at = (k) => ({ ...k, line: L.line });
  let m;
  if (splitTopLevel(t, (s, i) => s[i] === ';') >= 0 && !/^(for|if|while|def)\b/.test(t)) {
    const parts = []; let rest = t; let p;
    while ((p = splitTopLevel(rest, (s, i) => s[i] === ';')) >= 0) { parts.push(rest.slice(0, p)); rest = rest.slice(p + 1); } parts.push(rest);
    return [at({ k: 'multi', body: parts.filter(x => x.trim()).map(x => parseStmt([{ indent: 0, text: x.trim(), line: L.line }], 0)[0]) }), idx + 1];
  }
  if ((m = t.match(/^(for)\s+(.+?)\s+in\s+(.+?):(.*)$/s)) && headerColon(t) >= 0) {
    const ci = headerColon(t); const head = t.slice(0, ci); const mm = head.match(/^for\s+(.+?)\s+in\s+(.+)$/s);
    const tp = new Parser(lex(mm[1])); const target = tp.targetList();
    const [body, ni] = parseSuite(lines, idx, { ...L, text: t }, ci + 1);
    return [at({ k: 'for', target, it: parseExpr(mm[2]), body }), ni];
  }
  if ((m = t.match(/^(if|while)\s+(.+)$/s)) && headerColon(t) >= 0) {
    const ci = headerColon(t); const cond = parseExpr(t.slice(m[1].length, ci));
    let [body, ni] = parseSuite(lines, idx, { ...L, text: t }, ci + 1);
    if (m[1] === 'while') return [at({ k: 'while', cond, body }), ni];
    const branches = [{ cond, body }]; let orelse = null;
    while (ni < lines.length && lines[ni].indent === L.indent) {
      const N = lines[ni];
      if (/^elif\s/.test(N.text)) { const c2 = headerColon(N.text); const cd = parseExpr(N.text.slice(4, c2)); const [b2, n2] = parseSuite(lines, ni, N, c2 + 1); branches.push({ cond: cd, body: b2 }); ni = n2; continue; }
      if (/^else\s*:/.test(N.text)) { const c2 = N.text.indexOf(':'); const [b2, n2] = parseSuite(lines, ni, N, c2 + 1); orelse = b2; ni = n2; }
      break;
    }
    return [at({ k: 'if', branches, orelse }), ni];
  }
  if ((m = t.match(/^def\s+(\w+)\s*\((.*)\)\s*(->\s*[^:]+)?:/s))) {
    const ci = t.indexOf(':', t.indexOf(')')); const params = [];
    if (m[2].trim()) { const p = new Parser(lex(m[2])); while (!p.atEnd()) { let star = p.eat('*') ? '*' : ''; const n = p.next(); if (n.t !== 'name') err('SyntaxError', 'invalid syntax'); if (p.eat(':')) p.expr(); let def = null; if (p.eat('=')) def = p.expr(); params.push({ name: n.v, def, star }); if (!p.eat(',')) break; } }
    const [body, ni] = parseSuite(lines, idx, L, ci + 1);
    return [at({ k: 'def', name: m[1], params, body }), ni];
  }
  if (/^try\s*:/.test(t)) {
    const [body, ni0] = parseSuite(lines, idx, L, t.indexOf(':') + 1); let ni = ni0; const handlers = []; let fin = null;
    while (ni < lines.length && lines[ni].indent === L.indent && /^(except|finally)\b/.test(lines[ni].text)) {
      const N = lines[ni]; const c2 = headerColon(N.text);
      const [b2, n2] = parseSuite(lines, ni, N, c2 + 1);
      if (/^finally/.test(N.text)) fin = b2; else { const hm = N.text.slice(0, c2).match(/^except\s*([\w.]+)?(?:\s+as\s+(\w+))?/); handlers.push({ type: hm[1] || null, as: hm[2] || null, body: b2 }); }
      ni = n2;
    }
    return [at({ k: 'try', body, handlers, fin }), ni];
  }
  if (/^(else|elif|except|finally)\b/.test(t)) err('SyntaxError', 'invalid syntax');
  if (/^class\s/.test(t)) err('SyntaxError', 'class definitions are not supported in this lab shell');
  if (/^with\s/.test(t)) err('SyntaxError', "'with' blocks are not supported in this lab shell");
  if (t === 'pass') return [at({ k: 'pass' }), idx + 1];
  if (t === 'break') return [at({ k: 'break' }), idx + 1];
  if (t === 'continue') return [at({ k: 'continue' }), idx + 1];
  if ((m = t.match(/^return\b(.*)$/s))) return [at({ k: 'return', e: m[1].trim() ? parseExpr(m[1]) : null }), idx + 1];
  if ((m = t.match(/^import\s+(.+)$/s))) return [at({ k: 'import', names: m[1].split(',').map(x => { const mm = x.trim().match(/^([\w.]+)(?:\s+as\s+(\w+))?$/); if (!mm) err('SyntaxError', 'invalid syntax'); return { mod: mm[1], as: mm[2] }; }) }), idx + 1];
  if ((m = t.match(/^from\s+([\w.]+)\s+import\s+(.+)$/s))) { const list = m[2].replace(/[()]/g, ''); return [at({ k: 'from', mod: m[1], names: list.trim() === '*' ? '*' : list.split(',').map(x => x.trim()).filter(Boolean).map(x => { const mm = x.match(/^(\w+)(?:\s+as\s+(\w+))?$/); if (!mm) err('SyntaxError', 'invalid syntax'); return { name: mm[1], as: mm[2] }; }) }), idx + 1]; }
  if ((m = t.match(/^del\s+(.+)$/))) return [at({ k: 'del', e: parseExpr(m[1]) }), idx + 1];
  if (/^print\s+[^(=]/.test(t)) err('SyntaxError', `Missing parentheses in call to 'print'. Did you mean print(...)?`);
  // augmented assignment
  const aug = splitTopLevel(t, (s, i) => /^(\+=|-=|\*=|\/=|\/\/=|%=|\*\*=)/.test(s.slice(i)) && !'=!<>'.includes(s[i - 1] || ''));
  if (aug >= 0) { const opm = t.slice(aug).match(/^(\+|-|\*\*|\*|\/\/|\/|%)=/); return [at({ k: 'aug', target: parseExpr(t.slice(0, aug)), op: opm[1], e: parseExpr(t.slice(aug + opm[0].length)) }), idx + 1]; }
  // assignment (possibly chained)
  const eqs = []; let rest = t; let off = 0;
  for (;;) { const p = splitTopLevel(rest, (s, i) => s[i] === '=' && s[i + 1] !== '=' && !'=!<>+-*/%&|^:'.includes(s[i - 1] || '')); if (p < 0) break; eqs.push(rest.slice(0, p)); rest = rest.slice(p + 1); off += p + 1; }
  if (eqs.length) {
    const targets = eqs.map(x => { const e = parseExpr(x); if (!['name', 'attr', 'index', 'tuple', 'list'].includes(e.k)) err('SyntaxError', e.k === 'call' ? "cannot assign to function call here. Maybe you meant '==' instead of '='?" : 'cannot assign to expression'); return e; });
    return [at({ k: 'assign', targets, e: parseExpr(rest) }), idx + 1];
  }
  return [at({ k: 'expr', e: parseExpr(t) }), idx + 1];
}
function parseProgram(src) { const lines = logicalLines(src); if (lines.some(l => l.incomplete)) err('SyntaxError', 'unexpected EOF while parsing'); const base = lines.length ? lines[0].indent : 0; if (base > 0) err('IndentationError', 'unexpected indent'); const [stmts] = parseBlock(lines, 0, 0); return stmts; }

/* ================= interpreter ================= */
class Scope { constructor(parent) { this.vars = new Map(); this.parent = parent; } get(n) { let s = this; while (s) { if (s.vars.has(n)) return s.vars.get(n); s = s.parent; } return undefined; } has(n) { let s = this; while (s) { if (s.vars.has(n)) return true; s = s.parent; } return false; } set(n, v) { this.vars.set(n, v); } }
class ReturnSig { constructor(v) { this.v = v; } }
const BREAK = { b: 1 }, CONTINUE = { c: 1 };

class Interp {
  constructor(machine, out) { this.m = machine; this.out = out; this.globals = new Scope(BUILTINS); this.stdoutBuf = null; }
  print(s) { this.out(s); }
  run(src, interactive) {
    const stmts = parseProgram(src);
    for (const st of stmts) {
      if (interactive && st.k === 'expr') { const v = this.eval(st.e, this.globals); if (v !== null && v !== undefined) this.print(repr(v)); }
      else this.exec(st, this.globals);
    }
  }
  execBlock(stmts, scope) { for (const s of stmts) { const r = this.exec(s, scope); if (r) return r; } return null; }
  exec(st, scope) {
    this.line = st.line || this.line;
    switch (st.k) {
      case 'expr': this.eval(st.e, scope); return null;
      case 'multi': for (const s of st.body) { const r = this.exec(s, scope); if (r) return r; } return null;
      case 'assign': { const v = this.eval(st.e, scope); for (const t of st.targets) this.assign(t, v, scope); return null; }
      case 'aug': { const cur = this.eval(st.target, scope); const v = this.binop(st.op, cur, this.eval(st.e, scope)); this.assign(st.target, v, scope); return null; }
      case 'pass': return null;
      case 'break': return BREAK; case 'continue': return CONTINUE;
      case 'return': return new ReturnSig(st.e ? this.eval(st.e, scope) : null);
      case 'del': { if (st.e.k === 'name') { if (!scope.vars.has(st.e.v)) err('NameError', `name '${st.e.v}' is not defined`); scope.vars.delete(st.e.v); } else if (st.e.k === 'index') { const o = this.eval(st.e.o, scope); const k = this.eval(st.e.idx, scope); if (o instanceof PyDict) o.del(k); else if (Array.isArray(o)) o.splice(num(k), 1); } return null; }
      case 'if': { for (const b of st.branches) if (truthy(this.eval(b.cond, scope))) return this.execBlock(b.body, scope); return st.orelse ? this.execBlock(st.orelse, scope) : null; }
      case 'while': { let guard = 0; while (truthy(this.eval(st.cond, scope))) { if (++guard > 100000) err('RuntimeError', 'loop ran too long (stopped by the lab simulator)'); const r = this.execBlock(st.body, scope); if (r === BREAK) break; if (r === CONTINUE) continue; if (r) return r; } return null; }
      case 'for': { const it = iterate(this.eval(st.it, scope)); for (const v of it) { this.assign(st.target, v, scope); const r = this.execBlock(st.body, scope); if (r === BREAK) break; if (r === CONTINUE) continue; if (r) return r; } return null; }
      case 'def': { scope.set(st.name, new PyFunc(st.name, st.params.map(p => ({ name: p.name, def: p.def ? this.eval(p.def, scope) : undefined, star: p.star })), st.body, scope, false)); return null; }
      case 'try': {
        try { const r = this.execBlock(st.body, scope); if (r) return r; }
        catch (e) {
          if (!(e instanceof PyErr)) throw e;
          const h = st.handlers.find(h => !h.type || h.type === 'Exception' || h.type === e.pytype || h.type.split('.').pop() === e.pytype.split('.').pop());
          if (!h) throw e;
          if (h.as) scope.set(h.as, new PyExc(e));
          const r = this.execBlock(h.body, scope); if (r) return r;
        } finally { if (st.fin) this.execBlock(st.fin, scope); }
        return null;
      }
      case 'import': for (const n of st.names) { const mod = getModule(n.mod); if (n.as) scope.set(n.as, mod); else { const top = n.mod.split('.')[0]; scope.set(top, getModule(top)); } } return null;
      case 'from': {
        const mod = getModule(st.mod);
        if (st.names === '*') { for (const [k, v] of Object.entries(mod.attrs)) if (!k.startsWith('_') && !(v instanceof PyModule)) scope.set(k, v); return null; }
        for (const n of st.names) { let v = mod.attrs[n.name]; if (v === undefined) { const sub = MODULES[st.mod + '.' + n.name]; if (sub) v = getModule(st.mod + '.' + n.name); } if (v === undefined) err('ImportError', `cannot import name '${n.name}' from '${st.mod}' (/usr/local/spark/python/${st.mod.replace(/\./g, '/')}/__init__.py)`); scope.set(n.as || n.name, v); }
        return null;
      }
    }
    err('SyntaxError', 'invalid syntax');
  }
  assign(t, v, scope) {
    if (t.k === 'name') { scope.set(t.v, v); return; }
    if (t.k === 'tuple' || t.k === 'list') { const vals = iterate(v); if (vals.length !== t.items.length) err('ValueError', vals.length > t.items.length ? `too many values to unpack (expected ${t.items.length})` : `not enough values to unpack (expected ${t.items.length}, got ${vals.length})`); t.items.forEach((it, i) => this.assign(it, vals[i], scope)); return; }
    if (t.k === 'index') { const o = this.eval(t.o, scope); const k = this.eval(t.idx, scope); if (o instanceof PyDict) { o.set(k, v); return; } if (isList(o)) { let i = num(k); if (i < 0) i += o.length; if (i >= o.length || i < 0) err('IndexError', 'list assignment index out of range'); o[i] = v; return; } err('TypeError', `'${typeName(o)}' object does not support item assignment`); }
    if (t.k === 'attr') { const o = this.eval(t.o, scope); err('AttributeError', `'${typeName(o)}' object attribute '${t.name}' is read-only`); }
    err('SyntaxError', 'cannot assign to expression');
  }
  eval(e, scope) {
    switch (e.k) {
      case 'num': return e.float ? F(e.v) : e.v;
      case 'str': return e.v;
      case 'fstr': return e.parts.map(p => p.f ? this.fmt(p.v, scope) : p.v).join('');
      case 'const': return e.v;
      case 'name': { if (scope.has(e.v)) return scope.get(e.v); err('NameError', `name '${e.v}' is not defined` + (FN_HINT[e.v] ? `. ${FN_HINT[e.v]}` : '')); }
      case 'tuple': return tup(this.items(e.items, scope));
      case 'list': return this.items(e.items, scope);
      case 'set': { const out = []; for (const v of this.items(e.items, scope)) if (!out.some(x => pyEq(x, v))) out.push(v); out.pySet = true; return out; }
      case 'dict': { const d = new PyDict(); for (const [k, v] of e.items) d.set(this.eval(k, scope), this.eval(v, scope)); return d; }
      case 'comp': return this.comp(e, scope);
      case 'lambda': return new PyFunc('<lambda>', e.params.map(p => ({ name: p.name, def: p.def ? this.eval(p.def, scope) : undefined })), e.body, scope, true);
      case 'ifexp': return truthy(this.eval(e.c, scope)) ? this.eval(e.a, scope) : this.eval(e.b, scope);
      case 'bool': { const l = this.eval(e.l, scope); if (l instanceof Column) err('ValueError', 'Cannot convert column into bool: please use \'&\' for \'and\', \'|\' for \'or\', \'~\' for \'not\' when building DataFrame boolean expressions.'); if (e.op === 'and') return truthy(l) ? this.eval(e.r, scope) : l; return truthy(l) ? l : this.eval(e.r, scope); }
      case 'not': { const v = this.eval(e.e, scope); if (v instanceof Column) err('ValueError', "Cannot convert column into bool: please use '&' for 'and', '|' for 'or', '~' for 'not' when building DataFrame boolean expressions."); return !truthy(v); }
      case 'unary': { const v = this.eval(e.e, scope); if (v instanceof Column) return e.op === '-' ? new Column({ k: 'neg', e: v.x }) : e.op === '~' ? new Column({ k: 'not', e: v.x }) : v; if (e.op === '-') { if (typeof v === 'number') return -v; if (isF(v)) return F(-v.v); if (typeof v === 'boolean') return -(+v); } if (e.op === '+' && isNum(v)) return v; if (e.op === '~' && typeof v === 'number') return ~v; err('TypeError', `bad operand type for unary ${e.op}: '${typeName(v)}'`); }
      case 'bin': return this.binop(e.op, this.eval(e.l, scope), this.eval(e.r, scope));
      case 'cmp': {
        let l = this.eval(e.l, scope); let result = true;
        for (let i = 0; i < e.ops.length; i++) { const r = this.eval(e.rs[i], scope); const v = this.compare(e.ops[i], l, r); if (v instanceof Column) { if (e.ops.length > 1) err('ValueError', 'Cannot convert column into bool: please use \'&\' for \'and\', \'|\' for \'or\', \'~\' for \'not\' when building DataFrame boolean expressions.'); return v; } if (!v) { result = false; break; } l = r; }
        return result;
      }
      case 'attr': return getattr(this.eval(e.o, scope), e.name, this);
      case 'index': return this.index(this.eval(e.o, scope), e.idx, scope);
      case 'call': {
        const f = this.eval(e.f, scope);
        const args = []; for (const a of e.args) { if (a.k === 'star') args.push(...iterate(this.eval(a.e, scope))); else args.push(this.eval(a, scope)); }
        const kw = {}; for (const k of e.kwargs) { if (k.name === '**') { const d = this.eval(k.e, scope); for (const [kk, vv] of d.items()) kw[kk] = vv; } else kw[k.name] = this.eval(k.e, scope); }
        return this.call(f, args, kw, e.f.k === 'attr' ? e.f.name : e.f.k === 'name' ? e.f.v : '');
      }
      case 'star': err('SyntaxError', 'can\'t use starred expression here');
      case 'slice': err('SyntaxError', 'invalid syntax');
    }
    err('SyntaxError', 'invalid syntax');
  }
  items(list, scope) { const out = []; for (const it of list) { if (it.k === 'star') out.push(...iterate(this.eval(it.e, scope))); else out.push(this.eval(it, scope)); } return out; }
  comp(e, scope) {
    const inner = new Scope(scope); const out = []; const d = e.kind === 'dict' ? new PyDict() : null;
    const rec = (gi) => {
      if (gi === e.gens.length) { if (d) d.set(this.eval(e.elt, inner), this.eval(e.valElt, inner)); else out.push(this.eval(e.elt, inner)); return; }
      const g = e.gens[gi];
      for (const v of iterate(this.eval(g.it, inner))) { this.assign(g.target, v, inner); if (g.conds.every(c => truthy(this.eval(c, inner)))) rec(gi + 1); }
    };
    rec(0);
    if (d) return d; if (e.kind === 'set') { const u = []; out.forEach(v => { if (!u.some(x => pyEq(x, v))) u.push(v); }); u.pySet = true; return u; }
    return out;
  }
  fmt(s, scope) {
    return s.replace(/\{\{|\}\}|\{([^{}]*)\}/g, (m, inner) => {
      if (m === '{{') return '{'; if (m === '}}') return '}';
      let spec = ''; let conv = ''; let expr = inner;
      const ci = splitTopLevel(inner, (t, i) => t[i] === ':' ); if (ci >= 0) { spec = inner.slice(ci + 1); expr = inner.slice(0, ci); }
      const bi = expr.lastIndexOf('!'); if (bi > 0 && /^![rs]$/.test(expr.slice(bi))) { conv = expr.slice(bi + 1); expr = expr.slice(0, bi); }
      const v = this.eval(parseExpr(expr), scope);
      return formatSpec(conv === 'r' ? repr(v) : v, spec);
    });
  }
  index(o, idxNode, scope) {
    if (idxNode && idxNode.k === 'slice') {
      const a = idxNode.a ? num(this.eval(idxNode.a, scope)) : null, b = idxNode.b ? num(this.eval(idxNode.b, scope)) : null, st = idxNode.c ? num(this.eval(idxNode.c, scope)) : 1;
      if (typeof o === 'string' || Array.isArray(o)) { const arr = typeof o === 'string' ? [...o] : o; const len = arr.length; const norm = (x, d) => x === null ? d : x < 0 ? Math.max(0, len + x) : Math.min(len, x); let res; if (st > 0) res = arr.slice(norm(a, 0), norm(b, len)).filter((_, i) => i % st === 0); else { const s2 = a === null ? len - 1 : a < 0 ? len + a : Math.min(a, len - 1); const e2 = b === null ? -1 : b < 0 ? len + b : b; res = []; for (let i = s2; i > e2; i += st) res.push(arr[i]); } return typeof o === 'string' ? res.join('') : isTup(o) ? tup(res) : res; }
      err('TypeError', `'${typeName(o)}' object is not subscriptable`);
    }
    const k = this.eval(idxNode, scope);
    return getitem(o, k);
  }
  call(f, args, kw, name) {
    if (f instanceof Builtin) return f.fn.call(f.self, args, kw, this);
    if (f instanceof PyClassRef) return f.ctor(args, kw, this);
    if (f instanceof PyFunc) return this.callFunc(f, args, kw);
    if (typeof f === 'function') return f(args, kw, this);
    err('TypeError', `'${typeName(f)}' object is not callable`);
  }
  callFunc(f, args, kw) {
    const sc = new Scope(f.scope);
    const ps = f.params;
    let ai = 0;
    for (const p of ps) {
      if (p.star === '*') { sc.set(p.name, tup(args.slice(ai))); ai = args.length; continue; }
      if (ai < args.length) sc.set(p.name, args[ai++]);
      else if (kw && p.name in kw) sc.set(p.name, kw[p.name]);
      else if (p.def !== undefined) sc.set(p.name, p.def);
      else err('TypeError', `${f.isLambda ? '<lambda>' : f.name}() missing 1 required positional argument: '${p.name}'`);
    }
    if (ai < args.length) err('TypeError', `${f.isLambda ? '<lambda>' : f.name}() takes ${ps.length} positional argument${ps.length === 1 ? '' : 's'} but ${args.length} ${args.length === 1 ? 'was' : 'were'} given`);
    if (f.isLambda) return this.eval(f.body, sc);
    const r = this.execBlock(f.body, sc);
    return r instanceof ReturnSig ? r.v : null;
  }
  callPy(f, ...args) { return this.call(f, args, {}); }
  binop(op, a, b) {
    if (a instanceof Column || b instanceof Column) return colBin(op, a, b);
    const both = isNum(a) && isNum(b) || (typeof a === 'boolean' && isNum(b)) || (isNum(a) && typeof b === 'boolean');
    if (both) {
      const x = num(a === true ? 1 : a === false ? 0 : a), y = num(b === true ? 1 : b === false ? 0 : b); const fl = isF(a) || isF(b);
      switch (op) {
        case '+': return fl ? F(x + y) : x + y; case '-': return fl ? F(x - y) : x - y; case '*': return fl ? F(x * y) : x * y;
        case '/': if (y === 0) err('ZeroDivisionError', 'division by zero'); return F(x / y);
        case '//': if (y === 0) err('ZeroDivisionError', 'integer division or modulo by zero'); return fl ? F(Math.floor(x / y)) : Math.floor(x / y);
        case '%': if (y === 0) err('ZeroDivisionError', 'integer division or modulo by zero'); { const r = ((x % y) + y) % y; return fl ? F(r) : r; }
        case '**': { const r = Math.pow(x, y); return fl || y < 0 ? F(r) : r; }
        case '&': return x & y; case '|': return x | y; case '^': return x ^ y; case '<<': return x << y; case '>>': return x >> y;
      }
    }
    if (op === '+' && typeof a === 'string' && typeof b === 'string') return a + b;
    if (op === '+' && Array.isArray(a) && Array.isArray(b) && !!a.__tuple === !!b.__tuple) { const r = a.concat(b); return a.__tuple ? tup(r) : r; }
    if (op === '*' && (typeof a === 'string' || Array.isArray(a)) && isInt(b)) { if (typeof a === 'string') return a.repeat(Math.max(0, b)); let r = []; for (let i = 0; i < b; i++) r = r.concat(a); return a.__tuple ? tup(r) : r; }
    if (op === '%' && typeof a === 'string') return percentFormat(a, b);
    if (op === '+' && typeof a === 'string') err('TypeError', `can only concatenate str (not "${typeName(b)}") to str`);
    err('TypeError', `unsupported operand type(s) for ${op}: '${typeName(a)}' and '${typeName(b)}'`);
  }
  compare(op, a, b) {
    if (a instanceof Column || b instanceof Column) { if (op === 'in' || op === 'not in') err('ValueError', "Cannot convert column into bool: please use '&' for 'and', '|' for 'or', '~' for 'not' when building DataFrame boolean expressions."); return colBin(op, a, b); }
    switch (op) {
      case '==': return pyEq(a, b); case '!=': return !pyEq(a, b);
      case '<': return pyCmp(a, b, '<') < 0; case '>': return pyCmp(a, b, '>') > 0; case '<=': return pyCmp(a, b, '<=') <= 0; case '>=': return pyCmp(a, b, '>=') >= 0;
      case 'is': return a === b || (a === null && b === undefined) || (a === undefined && b === null); case 'is not': return !(a === b || (a == null && b == null));
      case 'in': return contains(b, a); case 'not in': return !contains(b, a);
    }
  }
}
function contains(c, x) { if (typeof c === 'string') { if (typeof x !== 'string') err('TypeError', `'in <string>' requires string as left operand, not ${typeName(x)}`); return c.includes(x); } if (Array.isArray(c)) return c.some(v => pyEq(v, x)); if (c instanceof PyDict) return c.has(x); if (c instanceof Row) return c.vals.some(v => pyEq(v, x)); err('TypeError', `argument of type '${typeName(c)}' is not iterable`); }
function getitem(o, k) {
  if (typeof o === 'string' || Array.isArray(o)) { if (!isInt(k)) err('TypeError', `${typeName(o)} indices must be integers or slices, not ${typeName(k)}`); let i = k; if (i < 0) i += o.length; if (i < 0 || i >= o.length) err('IndexError', `${typeName(o)} index out of range`); return typeof o === 'string' ? o[i] : o[i]; }
  if (o instanceof PyDict) { const v = o.get(k); if (v === undefined) { if (o.isDefault) { o.set(k, 0); return 0; } err('KeyError', repr(k)); } return v; }
  if (o && o.pyGetItem) return o.pyGetItem(k);
  err('TypeError', `'${typeName(o)}' object is not subscriptable`);
}
function formatSpec(v, spec) {
  if (!spec) return str(v);
  const m = spec.match(/^([<>^]?)(,)?(\d+)?(,)?(\.(\d+))?([dfs%e]?)$/);
  if (!m) return str(v);
  let s; const prec = m[6] !== undefined ? +m[6] : null; const type = m[7];
  if (type === 'f' || (prec !== null && isNum(v) && type !== 's')) s = num(v).toFixed(prec === null ? 6 : prec);
  else if (type === '%') s = (num(v) * 100).toFixed(prec === null ? 6 : prec) + '%';
  else if (type === 'd') s = String(Math.trunc(num(v)));
  else s = str(v);
  if (m[2] || m[4]) { const [i, d] = s.split('.'); s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d : ''); }
  if (m[3]) { const w = +m[3]; const al = m[1] || (isNum(v) ? '>' : '<'); s = al === '>' ? s.padStart(w) : al === '^' ? s.padStart(Math.floor((w + s.length) / 2)).padEnd(w) : s.padEnd(w); }
  return s;
}
function percentFormat(fmt, args) { const list = isTup(args) ? args.slice() : [args]; let i = 0; return fmt.replace(/%(\.\d+)?([sdfr%])/g, (m, p, t) => { if (t === '%') return '%'; const v = list[i++]; if (t === 'd') return String(Math.trunc(num(v))); if (t === 'f') return num(v).toFixed(p ? +p.slice(1) : 6); if (t === 'r') return repr(v); return str(v); }); }
class PyExc { constructor(e) { this.e = e; this.pyType = e.pytype; } pyRepr() { return `${this.e.pytype}(${strRepr(this.e.message)})`; } pyStr() { return this.e.message; } }

/* ================= attribute access ================= */
const STR_METHODS = {
  split(s, a, kw) { const sep = a[0] === undefined || a[0] === null ? (kw.sep === undefined ? null : kw.sep) : a[0]; const max = a[1] !== undefined ? a[1] : kw.maxsplit !== undefined ? kw.maxsplit : -1; let parts; if (sep === null) { parts = s.trim().split(/\s+/).filter(x => x.length); if (s.trim() === '') parts = []; } else { if (sep === '') err('ValueError', 'empty separator'); parts = s.split(sep); } if (max >= 0 && parts.length > max + 1) { const head = parts.slice(0, max); const tail = sep === null ? s.trim().split(/\s+/).slice(max).join(' ') : parts.slice(max).join(sep); parts = head.concat([tail]); } return parts; },
  rsplit(s, a) { return STR_METHODS.split(s, a, {}); },
  strip(s, a) { if (a[0] === undefined || a[0] === null) return s.trim(); const ch = a[0]; let i = 0, j = s.length; while (i < j && ch.includes(s[i])) i++; while (j > i && ch.includes(s[j - 1])) j--; return s.slice(i, j); },
  lstrip(s, a) { if (!a[0]) return s.replace(/^\s+/, ''); let i = 0; while (i < s.length && a[0].includes(s[i])) i++; return s.slice(i); },
  rstrip(s, a) { if (!a[0]) return s.replace(/\s+$/, ''); let j = s.length; while (j > 0 && a[0].includes(s[j - 1])) j--; return s.slice(0, j); },
  upper: (s) => s.toUpperCase(), lower: (s) => s.toLowerCase(), title: (s) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()), capitalize: (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(), swapcase: (s) => [...s].map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join(''),
  startswith: (s, a) => Array.isArray(a[0]) ? a[0].some(p => s.startsWith(p)) : s.startsWith(a[0]), endswith: (s, a) => Array.isArray(a[0]) ? a[0].some(p => s.endsWith(p)) : s.endsWith(a[0]),
  replace: (s, a) => a[2] !== undefined ? (() => { let r = s; for (let i = 0; i < a[2]; i++) r = r.replace(a[0], a[1]); return r; })() : s.split(a[0]).join(a[1]),
  join: (s, a) => iterate(a[0]).map(x => { if (typeof x !== 'string') err('TypeError', `sequence item 0: expected str instance, ${typeName(x)} found`); return x; }).join(s),
  find: (s, a) => s.indexOf(a[0]), index: (s, a) => { const i = s.indexOf(a[0]); if (i < 0) err('ValueError', 'substring not found'); return i; }, count: (s, a) => s.split(a[0]).length - 1,
  isdigit: (s) => /^\d+$/.test(s), isnumeric: (s) => /^\d+$/.test(s), isalpha: (s) => /^[A-Za-z]+$/.test(s), isalnum: (s) => /^[A-Za-z0-9]+$/.test(s), isspace: (s) => /^\s+$/.test(s), isupper: (s) => /[A-Z]/.test(s) && s === s.toUpperCase(), islower: (s) => /[a-z]/.test(s) && s === s.toLowerCase(),
  zfill: (s, a) => s.padStart(a[0], '0'), center: (s, a) => s.padStart(Math.floor((a[0] + s.length) / 2)).padEnd(a[0]), ljust: (s, a) => s.padEnd(a[0], a[1] || ' '), rjust: (s, a) => s.padStart(a[0], a[1] || ' '),
  splitlines: (s) => s.split(/\r?\n/).filter((x, i, arr) => !(i === arr.length - 1 && x === '')),
  format(s, a, kw, it) { let i = 0; return s.replace(/\{\{|\}\}|\{([^{}]*)\}/g, (m, inner) => { if (m === '{{') return '{'; if (m === '}}') return '}'; let [name, spec] = inner.split(':'); let v; if (name === '') v = a[i++]; else if (/^\d+$/.test(name)) v = a[+name]; else v = kw[name]; return formatSpec(v, spec || ''); }); },
  encode: (s) => s,
};
const LIST_METHODS = {
  append(l, a) { if (isTup(l)) err('AttributeError', "'tuple' object has no attribute 'append'"); l.push(a[0]); return null; },
  extend(l, a) { l.push(...iterate(a[0])); return null; }, insert(l, a) { l.splice(a[0], 0, a[1]); return null; },
  pop(l, a) { if (!l.length) err('IndexError', 'pop from empty list'); const i = a[0] === undefined ? l.length - 1 : (a[0] < 0 ? l.length + a[0] : a[0]); return l.splice(i, 1)[0]; },
  remove(l, a) { const i = l.findIndex(v => pyEq(v, a[0])); if (i < 0) err('ValueError', 'list.remove(x): x not in list'); l.splice(i, 1); return null; },
  index(l, a) { const i = l.findIndex(v => pyEq(v, a[0])); if (i < 0) err('ValueError', `${repr(a[0])} is not in list`); return i; }, count: (l, a) => l.filter(v => pyEq(v, a[0])).length,
  sort(l, a, kw, it) { const key = kw.key ? (x) => it.callPy(kw.key, x) : (x) => x; const s = l.map(v => [key(v), v]).sort((x, y) => pyCmp(x[0], y[0], '<')); if (truthy(kw.reverse)) s.reverse(); s.forEach((p, i) => { l[i] = p[1]; }); return null; },
  reverse(l) { l.reverse(); return null; }, copy: (l) => l.slice(), clear(l) { l.length = 0; return null; },
};
const DICT_METHODS = {
  get: (d, a) => { const v = d.get(a[0]); return v === undefined ? (a[1] === undefined ? null : a[1]) : v; }, keys: (d) => d.keys(), values: (d) => d.values(), items: (d) => d.items(),
  update(d, a) { const o = a[0]; if (o instanceof PyDict) o.items().forEach(([k, v]) => d.set(k, v)); return null; }, pop(d, a) { const v = d.get(a[0]); if (v === undefined) { if (a.length > 1) return a[1]; err('KeyError', repr(a[0])); } d.del(a[0]); return v; },
  setdefault(d, a) { if (!d.has(a[0])) d.set(a[0], a[1] === undefined ? null : a[1]); return d.get(a[0]); }, copy(d) { const n = new PyDict(); d.items().forEach(([k, v]) => n.set(k, v)); return n; },
};
function getattr(o, name, it) {
  if (o === null || o === undefined) err('AttributeError', `'NoneType' object has no attribute '${name}'`);
  if (typeof o === 'string') { const f = STR_METHODS[name]; if (f) return new Builtin(name, (a, kw, i2) => f(o, a, kw, i2)); }
  else if (Array.isArray(o)) { const f = LIST_METHODS[name]; if (f && !(isTup(o) && !['index', 'count'].includes(name))) return new Builtin(name, (a, kw, i2) => f(o, a, kw, i2)); }
  else if (o instanceof PyDict) { const f = DICT_METHODS[name]; if (f) return new Builtin(name, (a, kw, i2) => f(o, a, kw, i2)); }
  else if (o instanceof PyModule) { if (name in o.attrs) return o.attrs[name]; const sub = MODULES[o.name + '.' + name]; if (sub) return getModule(o.name + '.' + name); err('AttributeError', `module '${o.name}' has no attribute '${name}'`); }
  else if (o instanceof PyClassRef) { if (name in o.attrs) { const v = o.attrs[name]; return typeof v === 'function' ? v() : v; } }
  else if (isF(o) && name === 'is_integer') return B(name, () => Number.isInteger(o.v));
  else if (o instanceof PyExc && name === 'args') return tup([o.e.message]);
  else if (o && o.pyAttr) { const v = o.pyAttr(name, it); if (v !== undefined) return v; }
  err('AttributeError', `'${typeName(o)}' object has no attribute '${name}'` + (o && o.pyHint ? o.pyHint(name) : ''));
}
const meth = (self, name, fn) => new Builtin(name, fn, self);

/* ================= builtins ================= */
const BUILTINS = new Scope(null);
const FN_HINT = { col: "Did you run  from pyspark.sql.functions import col  ?", sum: 'Import it:  from pyspark.sql.functions import sum', avg: 'Import it:  from pyspark.sql.functions import avg', when: 'Import it:  from pyspark.sql.functions import when', StructType: 'Import it:  from pyspark.sql.types import StructType, StructField, IntegerType, StringType', StructField: 'Import it from pyspark.sql.types', IntegerType: 'Import it from pyspark.sql.types', StringType: 'Import it from pyspark.sql.types', lit: 'Import it:  from pyspark.sql.functions import lit', spark: 'Create it:  spark = SparkSession.builder.appName("App").getOrCreate()', sc: 'Create it:  sc = spark.sparkContext', df: 'Create the DataFrame first, e.g.  df = spark.read.csv(path, schema=schema, header=False)', path: 'Define it first:  path = "hdfs://localhost:9000/bda/employee_data.csv"', schema: 'Define the schema first with StructType([...])', emp: 'Create it first, e.g.  emp = rdd.map(lambda line: line.split(","))', rdd: 'Create it first:  rdd = sc.textFile(path)', SparkSession: 'Import it:  from pyspark.sql import SparkSession', add: 'Import it:  from operator import add' };
function toPyInt(x, base) {
  if (typeof x === 'number') return x; if (isF(x)) return Math.trunc(x.v); if (typeof x === 'boolean') return +x;
  if (typeof x === 'string') { const t = x.trim().replace(/_/g, ''); if (base) { const n = parseInt(t, base); if (isNaN(n)) err('ValueError', `invalid literal for int() with base ${base}: ${strRepr(x)}`); return n; } if (!/^[-+]?\d+$/.test(t)) err('ValueError', `invalid literal for int() with base 10: ${strRepr(x)}`); return parseInt(t, 10); }
  if (x === null || x === undefined) err('TypeError', "int() argument must be a string, a bytes-like object or a real number, not 'NoneType'");
  err('TypeError', `int() argument must be a string, a bytes-like object or a real number, not '${typeName(x)}'`);
}
function toPyFloat(x) { if (isNum(x)) return F(num(x)); if (typeof x === 'string') { const t = x.trim().toLowerCase(); if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/.test(t)) return F(parseFloat(t)); if (/^[-+]?(inf|infinity)$/.test(t)) return F(t.startsWith('-') ? -Infinity : Infinity); if (t === 'nan') return F(NaN); err('ValueError', `could not convert string to float: ${strRepr(x)}`); } if (typeof x === 'boolean') return F(+x); err('TypeError', `float() argument must be a string or a real number, not '${typeName(x)}'`); }
function pyRound(x, n) { const v = num(x); if (n === undefined || n === null) { const f = Math.floor(v), d = v - f; if (d === 0.5) return f % 2 === 0 ? f : f + 1; return Math.round(v); } const p = Math.pow(10, n); const y = v * p; const f = Math.floor(y), d = y - f; let r = Math.abs(d - 0.5) < 1e-9 ? (f % 2 === 0 ? f : f + 1) : Math.round(y); r = r / p; return isInt(x) ? Math.round(r) : F(r); }
function minmax(args, kw, it, sign, name) {
  let list = args.length === 1 ? iterate(args[0]) : args;
  if (!list.length) { if ('default' in kw) return kw.default; err('ValueError', `${name}() arg is an empty sequence`); }
  const key = kw.key ? (x) => it.callPy(kw.key, x) : (x) => x;
  let best = list[0], bk = key(best);
  for (const v of list.slice(1)) { const k = key(v); if (pyCmp(k, bk, '<') * sign > 0) { best = v; bk = k; } }
  return best;
}
const bset = (n, f) => BUILTINS.set(n, B(n, f));
bset('print', function (a, kw, it) { const sep = kw.sep === undefined ? ' ' : kw.sep; const end = kw.end === undefined ? '\n' : kw.end; const s = a.map(str).join(sep) + end; it.print(s.replace(/\n$/, '')); return null; });
bset('len', (a) => { const o = a[0]; if (typeof o === 'string' || Array.isArray(o)) return o.length; if (o instanceof PyDict) return o.size; if (o instanceof Row) return o.vals.length; if (o && o.pyLen) return o.pyLen(); err('TypeError', `object of type '${typeName(o)}' has no len()`); });
bset('int', (a) => (a.length ? toPyInt(a[0], a[1]) : 0)); bset('float', (a) => (a.length ? toPyFloat(a[0]) : F(0)));
bset('str', (a) => (a.length ? str(a[0]) : '')); bset('bool', (a) => truthy(a[0])); bset('repr', (a) => repr(a[0]));
bset('list', (a) => (a.length ? iterate(a[0]).slice() : [])); bset('tuple', (a) => tup(a.length ? iterate(a[0]).slice() : []));
bset('set', (a) => { const u = []; if (a.length) iterate(a[0]).forEach(v => { if (!u.some(x => pyEq(x, v))) u.push(v); }); u.pySet = true; return u; });
bset('dict', (a, kw) => { const d = new PyDict(); if (a[0]) { if (a[0] instanceof PyDict) a[0].items().forEach(([k, v]) => d.set(k, v)); else iterate(a[0]).forEach(p => d.set(p[0], p[1])); } Object.entries(kw).forEach(([k, v]) => d.set(k, v)); return d; });
bset('range', (a) => { const [s, e, st] = a.length === 1 ? [0, a[0], 1] : [a[0], a[1], a[2] || 1]; const out = []; if (st > 0) for (let i = s; i < e; i += st) out.push(i); else for (let i = s; i > e; i += st) out.push(i); if (out.length > 1e6) err('MemoryError', ''); return out; });
bset('sorted', (a, kw, it) => { const l = iterate(a[0]).slice(); LIST_METHODS.sort(l, [], kw, it); return l; });
bset('reversed', (a) => iterate(a[0]).slice().reverse());
bset('sum', (a) => { let t = a[1] === undefined ? 0 : a[1]; for (const v of iterate(a[0])) { if (!isNum(v) && typeof v !== 'boolean') err('TypeError', `unsupported operand type(s) for +: '${typeName(t)}' and '${typeName(v)}'`); t = (isF(t) || isF(v)) ? F(num(t) + num(v === true ? 1 : v === false ? 0 : v)) : t + (v === true ? 1 : v === false ? 0 : v); } return t; });
bset('max', (a, kw, it) => minmax(a, kw, it, 1, 'max')); bset('min', (a, kw, it) => minmax(a, kw, it, -1, 'min'));
bset('abs', (a) => (isF(a[0]) ? F(Math.abs(a[0].v)) : Math.abs(a[0]))); bset('round', (a) => pyRound(a[0], a[1]));
bset('enumerate', (a) => iterate(a[0]).map((v, i) => tup([i + (a[1] || 0), v])));
bset('zip', (a) => { const ls = a.map(iterate); const n = Math.min(...ls.map(l => l.length)); const out = []; for (let i = 0; i < n; i++) out.push(tup(ls.map(l => l[i]))); return out; });
bset('map', (a, kw, it) => iterate(a[1]).map(v => it.callPy(a[0], v))); bset('filter', (a, kw, it) => iterate(a[1]).filter(v => (a[0] === null ? truthy(v) : truthy(it.callPy(a[0], v)))));
bset('any', (a) => iterate(a[0]).some(truthy)); bset('all', (a) => iterate(a[0]).every(truthy));
bset('type', (a) => new PyClassRef(typeName(a[0]), () => null)); bset('isinstance', (a) => { const t = a[1]; const names = Array.isArray(t) ? t.map(x => x.name) : [t && t.name]; return names.includes(typeName(a[0])) || (names.includes('int') && typeof a[0] === 'boolean'); });
bset('chr', (a) => String.fromCharCode(a[0])); bset('ord', (a) => a[0].charCodeAt(0));
bset('input', () => err('RuntimeError', 'input() is not available in the lab terminal'));
bset('open', () => err('PermissionError', "[Errno 13] Reading local files with open() is not part of this lab. Use spark.read or sc.textFile."));
bset('help', (a, kw, it) => { it.print('Type the PySpark commands from your practical. help() is not available in this lab shell.'); return null; });
bset('dir', (a) => (a[0] instanceof DataFrame ? ['agg', 'collect', 'columns', 'count', 'createOrReplaceTempView', 'crosstab', 'describe', 'distinct', 'drop', 'dtypes', 'filter', 'first', 'groupBy', 'head', 'join', 'limit', 'orderBy', 'printSchema', 'rdd', 'schema', 'select', 'show', 'sort', 'take', 'union', 'where', 'withColumn', 'withColumnRenamed', 'write'] : []));
bset('divmod', (a) => tup([Math.floor(num(a[0]) / num(a[1])), num(a[0]) % num(a[1])]));
bset('hash', (a) => { let h = 0; for (const c of str(a[0])) h = (h * 31 + c.charCodeAt(0)) | 0; return h; });
for (const [n, f] of [['int', 0], ['float', 0], ['str', 0], ['list', 0], ['tuple', 0], ['dict', 0], ['bool', 0]]) { const b = BUILTINS.get(n); b.pyTypeName = n; }
['int', 'float', 'str', 'list', 'tuple', 'dict', 'bool'].forEach(n => { const b = BUILTINS.get(n); BUILTINS.set(n, Object.assign(new PyClassRef(n, (a, kw, it) => b.fn(a, kw, it)), { })); });
BUILTINS.set('Exception', new PyClassRef('Exception', (a) => new PyExc(new PyErr('Exception', a[0] || ''))));
BUILTINS.set('ValueError', new PyClassRef('ValueError', (a) => new PyExc(new PyErr('ValueError', a[0] || ''))));

/* ================= Spark: types & schema ================= */
const SPARK_TYPES = { int: ['IntegerType', 'integer', 'int'], bigint: ['LongType', 'long', 'bigint'], double: ['DoubleType', 'double', 'double'], float: ['FloatType', 'float', 'float'], string: ['StringType', 'string', 'string'], boolean: ['BooleanType', 'boolean', 'boolean'], date: ['DateType', 'date', 'date'], timestamp: ['TimestampType', 'timestamp', 'timestamp'], void: ['NullType', 'void', 'void'] };
class DType { constructor(t) { this.t = t; this.pyType = SPARK_TYPES[t][0]; } pyRepr() { return SPARK_TYPES[this.t][0] + '()'; } pyAttr(n) { if (n === 'simpleString') return B(n, () => SPARK_TYPES[this.t][2]); } }
class StructField { constructor(name, type, nullable) { this.name = name; this.type = type; this.nullable = nullable; this.pyType = 'StructField'; } pyRepr() { return `StructField('${this.name}', ${SPARK_TYPES[this.type][0]}(), ${this.nullable ? 'True' : 'False'})`; } pyAttr(n) { if (n === 'name') return this.name; if (n === 'dataType') return new DType(this.type); if (n === 'nullable') return this.nullable; } }
class StructType { constructor(fields) { this.fields = fields; this.pyType = 'StructType'; } pyRepr() { return `StructType([${this.fields.map(f => f.pyRepr()).join(', ')}])`; } pyAttr(n) { if (n === 'fields') return this.fields; if (n === 'names') return this.fields.map(f => f.name); if (n === 'add') return meth(this, n, (a) => { const t = a[1] instanceof DType ? a[1].t : parseDDLType(String(a[1])); this.fields.push(new StructField(a[0], t, a[2] === undefined ? true : a[2])); return this; }); if (n === 'simpleString') return B(n, () => 'struct<' + this.fields.map(f => f.name + ':' + SPARK_TYPES[f.type][2]).join(',') + '>'); } pyIter() { return this.fields; } pyLen() { return this.fields.length; } pyGetItem(k) { if (typeof k === 'number') return this.fields[k]; return this.fields.find(f => f.name === k) || err('KeyError', `No StructField named ${k}`); } }
function parseDDLType(t) { t = t.trim().toLowerCase(); const map = { int: 'int', integer: 'int', bigint: 'bigint', long: 'bigint', double: 'double', float: 'float', real: 'float', string: 'string', varchar: 'string', boolean: 'boolean', bool: 'boolean', date: 'date', timestamp: 'timestamp' }; const k = t.replace(/\(.*\)/, ''); if (!map[k]) err('pyspark.errors.exceptions.captured.ParseException', `\n[UNSUPPORTED_DATATYPE] Unsupported data type "${t.toUpperCase()}".`); return map[k]; }
function schemaFrom(x) {
  if (x instanceof StructType) return x.fields.map(f => ({ name: f.name, type: f.type, nullable: f.nullable }));
  if (typeof x === 'string') return x.split(',').map(p => { const mm = p.trim().match(/^`?(\w+)`?\s*:?\s+(\w+(?:\(\d+(?:,\s*\d+)?\))?)$/); if (!mm) err('pyspark.errors.exceptions.captured.ParseException', `\n[PARSE_SYNTAX_ERROR] Syntax error at or near '${p.trim()}'.`); return { name: mm[1], type: parseDDLType(mm[2]), nullable: true }; });
  return null;
}

/* ================= Spark: Column expressions ================= */
class Column {
  constructor(x) { this.x = x; this.pyType = 'Column'; }
  pyRepr() { return `Column<'${exprName(this.x)}'>`; }
  pyBool() { err('ValueError', "Cannot convert column into bool: please use '&' for 'and', '|' for 'or', '~' for 'not' when building DataFrame boolean expressions."); }
  pyIter() { err('TypeError', 'Column is not iterable'); }
  pyAttr(n) {
    const c = this.x; const M = (f) => meth(this, n, f);
    switch (n) {
      case 'alias': case 'name': return M((a) => new Column({ k: 'alias', e: c, name: a[0] }));
      case 'asc': return M(() => new Column({ k: 'sort', e: c, dir: 'asc' })); case 'desc': return M(() => new Column({ k: 'sort', e: c, dir: 'desc' }));
      case 'asc_nulls_last': return M(() => new Column({ k: 'sort', e: c, dir: 'asc', nl: true })); case 'desc_nulls_last': return M(() => new Column({ k: 'sort', e: c, dir: 'desc', nl: true }));
      case 'between': return M((a) => new Column({ k: 'between', e: c, lo: litX(a[0]), hi: litX(a[1]) }));
      case 'isin': return M((a) => new Column({ k: 'isin', e: c, vals: (a.length === 1 && Array.isArray(a[0]) ? a[0] : a).map(litX) }));
      case 'isNull': return M(() => new Column({ k: 'isnull', e: c })); case 'isNotNull': return M(() => new Column({ k: 'isnull', e: c, neg: true }));
      case 'like': return M((a) => new Column({ k: 'like', e: c, pat: a[0] })); case 'rlike': return M((a) => new Column({ k: 'rlike', e: c, pat: a[0] }));
      case 'contains': return M((a) => new Column({ k: 'strfn', f: 'contains', e: c, arg: litX(a[0]) })); case 'startswith': return M((a) => new Column({ k: 'strfn', f: 'startswith', e: c, arg: litX(a[0]) })); case 'endswith': return M((a) => new Column({ k: 'strfn', f: 'endswith', e: c, arg: litX(a[0]) }));
      case 'cast': case 'astype': return M((a) => new Column({ k: 'cast', e: c, to: a[0] instanceof DType ? a[0].t : parseDDLType(String(a[0])) }));
      case 'otherwise': if (c.k !== 'case') err('pyspark.errors.exceptions.base.PySparkValueError', '[ONLY_ALLOWED_FOR_SINGLE_COLUMN] otherwise() can only be applied on a Column previously generated by when()'); return M((a) => new Column(Object.assign({}, c, { els: litX(a[0]) })));
      case 'when': if (c.k !== 'case') err('AttributeError', "'Column' object has no attribute 'when'"); return M((a) => new Column(Object.assign({}, c, { branches: c.branches.concat([[colX(a[0], true), litX(a[1])]]) })));
      case 'substr': return M((a) => new Column({ k: 'fn', f: 'substring', args: [c, litX(a[0]), litX(a[1])] }));
      case 'getItem': return M((a) => new Column({ k: 'getitem', e: c, i: a[0] }));
    }
    return undefined;
  }
  pyHint(n) { return ['show', 'collect', 'count'].includes(n) ? ' (a Column is not a DataFrame — use df.select(...).' + n + '())' : ''; }
  pyGetItem(k) { return new Column({ k: 'getitem', e: this.x, i: k }); }
}
const litX = (v) => (v instanceof Column ? v.x : { k: 'lit', v });
const colX = (v, strIsCol) => (v instanceof Column ? v.x : typeof v === 'string' && strIsCol ? { k: 'col', name: v } : { k: 'lit', v });
function colBin(op, a, b) {
  const map = { '==': '=', '!=': '!=', '<': '<', '>': '>', '<=': '<=', '>=': '>=', '+': '+', '-': '-', '*': '*', '/': '/', '%': '%', '&': 'AND', '|': 'OR', '**': 'POWER' };
  if (!(op in map)) err('TypeError', `unsupported operand for Column: ${op}`);
  if ((op === '&' || op === '|') && (typeof a === 'boolean' || typeof b === 'boolean')) {}
  return new Column({ k: 'bin', op: map[op], l: litX(a), r: litX(b) });
}
function litName(v) { if (v === null || v === undefined) return 'NULL'; if (isF(v)) return pyFloatRepr(v.v).replace(/^(\d+)\.0$/, '$1.0'); if (typeof v === 'boolean') return v ? 'true' : 'false'; return String(v); }
function exprName(x) {
  switch (x.k) {
    case 'col': return x.name; case 'star': return '*';
    case 'lit': return litName(x.v);
    case 'alias': return x.name;
    case 'bin': return x.op === 'POWER' ? `POWER(${exprName(x.l)}, ${exprName(x.r)})` : x.op === '!=' ? `(NOT (${exprName(x.l)} = ${exprName(x.r)}))` : `(${exprName(x.l)} ${x.op} ${exprName(x.r)})`;
    case 'not': return `(NOT ${exprName(x.e)})`; case 'neg': return `(- ${exprName(x.e)})`;
    case 'agg': return x.f === 'count' && x.arg.k === 'star' ? 'count(1)' : `${x.f}(${x.distinct ? 'DISTINCT ' : ''}${exprName(x.arg)})`;
    case 'fn': return `${x.f}(${x.args.map(exprName).join(', ')})`;
    case 'case': return 'CASE ' + x.branches.map(([c, v]) => `WHEN ${exprName(c)} THEN ${exprName(v)}`).join(' ') + (x.els ? ` ELSE ${exprName(x.els)}` : '') + ' END';
    case 'sort': return `${exprName(x.e)} ${x.dir.toUpperCase()} NULLS ${x.dir === 'asc' ? (x.nl ? 'LAST' : 'FIRST') : (x.nl ? 'LAST' : 'LAST')}`;
    case 'between': return `((${exprName(x.e)} >= ${exprName(x.lo)}) AND (${exprName(x.e)} <= ${exprName(x.hi)}))`;
    case 'isin': return `(${exprName(x.e)} IN (${x.vals.map(exprName).join(', ')}))`;
    case 'isnull': return `(${exprName(x.e)} IS ${x.neg ? 'NOT ' : ''}NULL)`;
    case 'like': return `${exprName(x.e)} LIKE ${x.pat}`; case 'rlike': return `RLIKE(${exprName(x.e)}, ${x.pat})`;
    case 'strfn': return `${x.f}(${exprName(x.e)}, ${exprName(x.arg)})`;
    case 'cast': return `CAST(${exprName(x.e)} AS ${SPARK_TYPES[x.to][2].toUpperCase()})`;
    case 'getitem': return `${exprName(x.e)}[${x.i}]`;
    case 'raw': return x.text;
  }
  return '?';
}
function hasAgg(x) { if (!x || typeof x !== 'object') return false; if (x.k === 'agg') return true; return ['l', 'r', 'e', 'lo', 'hi', 'els', 'arg'].some(k => hasAgg(x[k])) || (x.args || []).some(hasAgg) || (x.branches || []).some(([c, v]) => hasAgg(c) || hasAgg(v)) || (x.vals || []).some(hasAgg); }
function sparkErr(cls, msg) { err('pyspark.errors.exceptions.captured.' + cls, msg); }
function unresolved(name, schema) {
  const names = schema.map(c => '`' + c.name + '`');
  const sorted = names.slice().sort((a, b) => lev(a.toLowerCase(), '`' + name.toLowerCase() + '`') - lev(b.toLowerCase(), '`' + name.toLowerCase() + '`'));
  sparkErr('AnalysisException', `[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column or function parameter with name \`${name}\` cannot be resolved. Did you mean one of the following? [${sorted.slice(0, 5).join(', ')}].;`);
}
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
function litType(v) { if (v === null || v === undefined) return 'void'; if (typeof v === 'boolean') return 'boolean'; if (typeof v === 'number') return Math.abs(v) > 2147483647 ? 'bigint' : 'int'; if (isF(v)) return 'double'; return 'string'; }
const NUMT = ['int', 'bigint', 'float', 'double'];
function widen(a, b) { if (a === 'double' || b === 'double' || a === 'float' || b === 'float') return 'double'; if (a === 'bigint' || b === 'bigint') return 'bigint'; if (a === 'string' || b === 'string') return 'double'; return 'int'; }
function toSparkVal(v) { if (isF(v)) return v.v; if (v === undefined) return null; return v; }
function sparkNum(v) { if (v === null) return null; if (typeof v === 'string') { const t = v.trim(); return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? parseFloat(t) : null; } if (typeof v === 'boolean') return +v; return v; }
function roundHalfUp(v, n) { if (v === null) return null; const p = Math.pow(10, n); const s = Math.sign(v); const r = Math.round(Math.abs(v) * p + 1e-9) / p; return s * r; }
function likeRe(p) { return new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 's'); }
// compile expression against schema -> {get(row), type, name}
function compile(x, schema, ctx) {
  ctx = ctx || {};
  switch (x.k) {
    case 'col': {
      if (x.name === '*') sparkErr('AnalysisException', '[INVALID_USAGE_OF_STAR_OR_REGEX] Invalid usage of \'*\' in expression.');
      let name = x.name; let idx;
      if (x.df) { idx = schema.findIndex(c => c.df === x.df && c.name.toLowerCase() === name.toLowerCase()); if (idx < 0) idx = schema.findIndex(c => c.name.toLowerCase() === name.toLowerCase()); }
      else {
        const hits = schema.map((c, i) => [c, i]).filter(([c]) => c.name.toLowerCase() === name.toLowerCase() || (c.qual && (c.qual + '.' + c.name).toLowerCase() === name.toLowerCase()));
        if (hits.length > 1 && !hits.every(([c]) => c.name === hits[0][0].name && c.df === hits[0][0].df)) sparkErr('AnalysisException', `[AMBIGUOUS_REFERENCE] Reference \`${name}\` is ambiguous, could be: [${hits.map(([c]) => '`' + c.name + '`').join(', ')}].`);
        idx = hits.length ? hits[0][1] : -1;
      }
      if (idx < 0) unresolved(name, schema);
      return { get: (r) => r[idx], type: schema[idx].type, name: schema[idx].name };
    }
    case 'lit': { const v = toSparkVal(x.v); return { get: () => v, type: litType(x.v), name: litName(x.v) }; }
    case 'alias': { const c = compile(x.e, schema, ctx); return { get: c.get, type: c.type, name: x.name, agg: c.agg }; }
    case 'sort': return compile(x.e, schema, ctx);
    case 'bin': {
      const l = compile(x.l, schema, ctx), r = compile(x.r, schema, ctx); const name = exprName(x);
      if (['AND', 'OR'].includes(x.op)) return { name, type: 'boolean', get: (row) => { const a = l.get(row), b = r.get(row); if (x.op === 'AND') { if (a === false || b === false) return false; if (a === null || b === null) return null; return true; } if (a === true || b === true) return true; if (a === null || b === null) return null; return false; } };
      if (['=', '!=', '<', '>', '<=', '>='].includes(x.op)) {
        const numeric = NUMT.includes(l.type) || NUMT.includes(r.type);
        return { name, type: 'boolean', get: (row) => { let a = l.get(row), b = r.get(row); if (a === null || b === null) return null; if (numeric && (typeof a === 'string' || typeof b === 'string')) { a = sparkNum(a); b = sparkNum(b); if (a === null || b === null) return null; } switch (x.op) { case '=': return a === b; case '!=': return a !== b; case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b; } } };
      }
      const t = x.op === '/' ? 'double' : x.op === 'POWER' ? 'double' : widen(l.type, r.type);
      if (l.type === 'string' && r.type === 'string' && x.op === '+') return { name, type: 'double', get: (row) => { const a = sparkNum(l.get(row)), b = sparkNum(r.get(row)); return a === null || b === null ? null : a + b; } };
      return { name, type: t, get: (row) => { let a = l.get(row), b = r.get(row); if (a === null || b === null) return null; a = sparkNum(a); b = sparkNum(b); if (a === null || b === null) return null; switch (x.op) { case '+': return a + b; case '-': return a - b; case '*': return t === 'int' || t === 'bigint' ? Math.trunc(a * b) : a * b; case '/': return b === 0 ? null : a / b; case '%': return b === 0 ? null : a % b; case 'POWER': return Math.pow(a, b); } } };
    }
    case 'not': { const c = compile(x.e, schema, ctx); return { name: exprName(x), type: 'boolean', get: (r) => { const v = c.get(r); return v === null ? null : !v; } }; }
    case 'neg': { const c = compile(x.e, schema, ctx); return { name: exprName(x), type: c.type, get: (r) => { const v = c.get(r); return v === null ? null : -v; } }; }
    case 'between': { const e = compile(x.e, schema, ctx), lo = compile(x.lo, schema, ctx), hi = compile(x.hi, schema, ctx); return { name: exprName(x), type: 'boolean', get: (r) => { const v = e.get(r), a = lo.get(r), b = hi.get(r); if (v === null || a === null || b === null) return null; return v >= a && v <= b; } }; }
    case 'isin': { const e = compile(x.e, schema, ctx); const vs = x.vals.map(v => compile(v, schema, ctx)); return { name: exprName(x), type: 'boolean', get: (r) => { const v = e.get(r); if (v === null) return null; return vs.some(c => c.get(r) === v || (typeof v === 'number' && sparkNum(c.get(r)) === v)); } }; }
    case 'isnull': { const e = compile(x.e, schema, ctx); return { name: exprName(x), type: 'boolean', get: (r) => (e.get(r) === null) !== !!x.neg }; }
    case 'like': case 'rlike': { const e = compile(x.e, schema, ctx); const re = x.k === 'like' ? likeRe(x.pat) : new RegExp(x.pat); return { name: exprName(x), type: 'boolean', get: (r) => { const v = e.get(r); return v === null ? null : re.test(String(v)); } }; }
    case 'strfn': { const e = compile(x.e, schema, ctx), a = compile(x.arg, schema, ctx); return { name: exprName(x), type: 'boolean', get: (r) => { const v = e.get(r), b = a.get(r); if (v === null || b === null) return null; const s = String(v); return x.f === 'contains' ? s.includes(b) : x.f === 'startswith' ? s.startsWith(b) : s.endsWith(b); } }; }
    case 'cast': { const e = compile(x.e, schema, ctx); return { name: exprName(x), type: x.to, get: (r) => castVal(e.get(r), x.to) }; }
    case 'case': {
      const bs = x.branches.map(([c, v]) => [compile(c, schema, ctx), compile(v, schema, ctx)]); const el = x.els ? compile(x.els, schema, ctx) : null;
      const types = bs.map(b => b[1].type).concat(el ? [el.type] : []).filter(t => t !== 'void');
      const t = types.every(tt => NUMT.includes(tt)) && types.length ? types.reduce(widen) : types[0] || 'string';
      return { name: exprName(x), type: t, get: (r) => { for (const [c, v] of bs) if (c.get(r) === true) return v.get(r); return el ? el.get(r) : null; } };
    }
    case 'fn': {
      const args = x.args.map(a => compile(a, schema, ctx)); const n = exprName(x);
      const g = (r) => args.map(a => a.get(r));
      switch (x.f) {
        case 'round': { const d = x.args[1] ? x.args[1].v : 0; return { name: n, type: args[0].type, get: (r) => { const v = args[0].get(r); if (v === null) return null; return roundHalfUp(v, d); } }; }
        case 'bround': { const d = x.args[1] ? x.args[1].v : 0; return { name: n, type: args[0].type, get: (r) => { const v = args[0].get(r); return v === null ? null : pyRound(v, d) instanceof PyFloat ? pyRound(v, d).v : pyRound(v, d); } }; }
        case 'upper': return { name: n, type: 'string', get: (r) => { const v = args[0].get(r); return v === null ? null : String(v).toUpperCase(); } };
        case 'lower': return { name: n, type: 'string', get: (r) => { const v = args[0].get(r); return v === null ? null : String(v).toLowerCase(); } };
        case 'length': return { name: n, type: 'int', get: (r) => { const v = args[0].get(r); return v === null ? null : String(v).length; } };
        case 'trim': return { name: n, type: 'string', get: (r) => { const v = args[0].get(r); return v === null ? null : String(v).trim(); } };
        case 'abs': return { name: n, type: args[0].type, get: (r) => { const v = args[0].get(r); return v === null ? null : Math.abs(v); } };
        case 'sqrt': return { name: n.replace(/^sqrt/, 'SQRT'), type: 'double', get: (r) => { const v = args[0].get(r); return v === null ? null : Math.sqrt(v); } };
        case 'concat': return { name: n, type: 'string', get: (r) => { const vs = g(r); return vs.some(v => v === null) ? null : vs.map(v => fmtCell(v)).join(''); } };
        case 'concat_ws': return { name: n, type: 'string', get: (r) => { const vs = g(r); return vs.slice(1).filter(v => v !== null).map(v => fmtCell(v)).join(vs[0]); } };
        case 'coalesce': return { name: n, type: args[0].type, get: (r) => { for (const a of args) { const v = a.get(r); if (v !== null) return v; } return null; } };
        case 'substring': return { name: n, type: 'string', get: (r) => { const [s, p, l] = g(r); if (s === null) return null; const st = p > 0 ? p - 1 : p < 0 ? String(s).length + p : 0; return String(s).substr(st, l); } };
        case 'isnull': return { name: n, type: 'boolean', get: (r) => args[0].get(r) === null };
        case 'year': return { name: n, type: 'int', get: (r) => { const v = args[0].get(r); return v === null ? null : parseInt(String(v).slice(0, 4), 10); } };
      }
      sparkErr('AnalysisException', `[UNRESOLVED_ROUTINE] Cannot resolve function \`${x.f}\`.`);
    }
    case 'agg': {
      if (!ctx.group) sparkErr('AnalysisException', `[MISSING_GROUP_BY] The query does not include a GROUP BY clause. Add GROUP BY or turn it into the window functions using OVER clauses.;`);
      const a = x.arg.k === 'star' ? null : compile(x.arg, schema, ctx);
      const name = exprName(x); const f = x.f;
      const type = f === 'count' ? 'bigint' : f === 'avg' || f === 'stddev' || f === 'stddev_samp' || f === 'variance' ? 'double' : f === 'sum' ? (['int', 'bigint'].includes(a.type) ? 'bigint' : 'double') : f === 'collect_list' || f === 'collect_set' ? 'array' : a.type;
      if (['sum', 'avg', 'stddev', 'stddev_samp', 'variance'].includes(f) && a && a.type === 'string') {}
      return { name, type, agg: true, get: (rows) => {
        if (f === 'count') { if (!a) return rows.length; const vals = rows.map(a.get).filter(v => v !== null); return x.distinct ? new Set(vals.map(String)).size : vals.length; }
        let vals = rows.map(a.get).filter(v => v !== null);
        if (x.distinct) { const seen = new Set(); vals = vals.filter(v => { const k = String(v); if (seen.has(k)) return false; seen.add(k); return true; }); }
        if (f === 'collect_list') return vals; if (f === 'collect_set') return [...new Map(vals.map(v => [String(v), v])).values()];
        if (f === 'first') return rows.length ? a.get(rows[0]) : null; if (f === 'last') return rows.length ? a.get(rows[rows.length - 1]) : null;
        if (!vals.length) return null;
        if (f === 'max') return vals.reduce((p, c) => (c > p ? c : p)); if (f === 'min') return vals.reduce((p, c) => (c < p ? c : p));
        const nums = vals.map(sparkNum).filter(v => v !== null);
        if (f === 'sum') return nums.reduce((p, c) => p + c, 0);
        if (f === 'avg') return nums.reduce((p, c) => p + c, 0) / nums.length;
        if (f === 'stddev' || f === 'stddev_samp' || f === 'variance') { if (nums.length < 2) return null; const mean = nums.reduce((p, c) => p + c, 0) / nums.length; const v = nums.reduce((p, c) => p + (c - mean) ** 2, 0) / (nums.length - 1); return f === 'variance' ? v : Math.sqrt(v); }
        return null;
      } };
    }
    case 'getitem': { const e = compile(x.e, schema, ctx); return { name: exprName(x), type: 'string', get: (r) => { const v = e.get(r); return Array.isArray(v) ? (v[x.i] === undefined ? null : v[x.i]) : null; } }; }
    case 'star': sparkErr('AnalysisException', "[INVALID_USAGE_OF_STAR_OR_REGEX] Invalid usage of '*'.");
  }
  sparkErr('AnalysisException', 'Unsupported expression');
}
// in group context: evaluate an expression that contains aggregates over a list of rows
function compileGroupExpr(x, schema, keyIdx) {
  if (x.k === 'agg') return compile(x, schema, { group: true });
  if (x.k === 'alias') { const c = compileGroupExpr(x.e, schema, keyIdx); return Object.assign({}, c, { name: x.name }); }
  if (!hasAgg(x)) { const c = compile(x, schema, {}); return { name: c.name, type: c.type, get: (rows) => (rows.length ? c.get(rows[0]) : null) }; }
  // expression wrapping aggregates, e.g. round(avg(x), 2)
  const parts = []; const sub = (n) => { if (n.k === 'agg') { const c = compile(n, schema, { group: true }); parts.push(c); return { k: '__slot', i: parts.length - 1, type: c.type, name: c.name }; } const o = Object.assign({}, n); for (const k of ['l', 'r', 'e', 'lo', 'hi', 'els', 'arg']) if (o[k]) o[k] = sub(o[k]); if (o.args) o.args = o.args.map(sub); if (o.branches) o.branches = o.branches.map(([c, v]) => [sub(c), sub(v)]); return o; };
  const tx = sub(x);
  const slotSchema = parts.map((p, i) => ({ name: '__slot' + i, type: p.type }));
  const fix = (n) => { if (n.k === '__slot') return { k: 'col', name: '__slot' + n.i, display: n.name }; const o = Object.assign({}, n); for (const k of ['l', 'r', 'e', 'lo', 'hi', 'els', 'arg']) if (o[k]) o[k] = fix(o[k]); if (o.args) o.args = o.args.map(fix); if (o.branches) o.branches = o.branches.map(([c, v]) => [fix(c), fix(v)]); return o; };
  const inner = compile(fix(tx), slotSchema, {});
  return { name: exprName(x), type: inner.type, get: (rows) => inner.get(parts.map(p => p.get(rows))) };
}
function castVal(v, t) {
  if (v === null || v === undefined) return null;
  if (t === 'int' || t === 'bigint') { const n = typeof v === 'number' ? v : sparkNum(String(v)); return n === null ? null : Math.trunc(n); }
  if (t === 'double' || t === 'float') { const n = typeof v === 'number' ? v : sparkNum(String(v)); return n; }
  if (t === 'string') return fmtCell(v);
  if (t === 'boolean') { if (typeof v === 'boolean') return v; const s = String(v).toLowerCase(); return s === 'true' ? true : s === 'false' ? false : null; }
  return v;
}

/* ================= SQL expression parser (for filter("...") / expr()) ================= */
function sqlToCol(text) {
  const toks = []; const re = /\s*(?:(\d+\.\d*|\.\d+|\d+)|'((?:\\'|''|[^'])*)'|"((?:\\"|[^"])*)"|`([^`]+)`|([A-Za-z_]\w*)|(<=|>=|<>|!=|==|[-+*/%(),<>=.]))/y;
  let mm; re.lastIndex = 0;
  while (re.lastIndex < text.length && (mm = re.exec(text))) { if (mm[1] !== undefined) toks.push({ t: 'num', v: mm[1] }); else if (mm[2] !== undefined) toks.push({ t: 'str', v: mm[2].replace(/''/g, "'") }); else if (mm[3] !== undefined) toks.push({ t: 'str', v: mm[3] }); else if (mm[4] !== undefined) toks.push({ t: 'id', v: mm[4] }); else if (mm[5] !== undefined) toks.push({ t: 'id', v: mm[5] }); else toks.push({ t: 'op', v: mm[6] }); }
  if (/\S/.test(text.slice(re.lastIndex))) sparkErr('ParseException', `\n[PARSE_SYNTAX_ERROR] Syntax error at or near '${text.slice(re.lastIndex).trim()[0]}'.`);
  let i = 0; const kw = (v) => toks[i] && toks[i].t === 'id' && toks[i].v.toLowerCase() === v; const op = (v) => toks[i] && toks[i].t === 'op' && toks[i].v === v;
  const fail = () => sparkErr('ParseException', `\n[PARSE_SYNTAX_ERROR] Syntax error at or near ${toks[i] ? "'" + toks[i].v + "'" : 'end of input'}.(line 1, pos ${i})\n\n== SQL ==\n${text}`);
  const or = () => { let l = and(); while (kw('or')) { i++; l = { k: 'bin', op: 'OR', l, r: and() }; } return l; };
  const and = () => { let l = not(); while (kw('and')) { i++; l = { k: 'bin', op: 'AND', l, r: not() }; } return l; };
  const not = () => { if (kw('not')) { i++; return { k: 'not', e: not() }; } return cmp(); };
  const cmp = () => {
    const l = add();
    if (toks[i] && toks[i].t === 'op' && ['=', '==', '!=', '<>', '<', '>', '<=', '>='].includes(toks[i].v)) { const o = toks[i++].v; const r = add(); return { k: 'bin', op: o === '==' ? '=' : o === '<>' ? '!=' : o, l, r }; }
    let neg = false; if (kw('not')) { neg = true; i++; }
    if (kw('between')) { i++; const lo = add(); if (!kw('and')) fail(); i++; const hi = add(); const b = { k: 'between', e: l, lo, hi }; return neg ? { k: 'not', e: b } : b; }
    if (kw('in')) { i++; if (!op('(')) fail(); i++; const vals = [add()]; while (op(',')) { i++; vals.push(add()); } if (!op(')')) fail(); i++; const b = { k: 'isin', e: l, vals }; return neg ? { k: 'not', e: b } : b; }
    if (kw('like')) { i++; const p = toks[i++]; const b = { k: 'like', e: l, pat: p.v }; return neg ? { k: 'not', e: b } : b; }
    if (kw('is')) { i++; let n2 = false; if (kw('not')) { n2 = true; i++; } if (!kw('null')) fail(); i++; return { k: 'isnull', e: l, neg: n2 }; }
    if (neg) fail();
    return l;
  };
  const add = () => { let l = mul(); while (op('+') || op('-')) { const o = toks[i++].v; l = { k: 'bin', op: o, l, r: mul() }; } return l; };
  const mul = () => { let l = un(); while (op('*') || op('/') || op('%')) { const o = toks[i++].v; l = { k: 'bin', op: o, l, r: un() }; } return l; };
  const un = () => { if (op('-')) { i++; return { k: 'neg', e: un() }; } return prim(); };
  const AGG = ['sum', 'avg', 'mean', 'max', 'min', 'count', 'stddev', 'first', 'last'];
  const prim = () => {
    const k = toks[i++]; if (!k) fail();
    if (k.t === 'num') return { k: 'lit', v: /\./.test(k.v) ? F(Number(k.v)) : Number(k.v) };
    if (k.t === 'str') return { k: 'lit', v: k.v };
    if (k.t === 'op' && k.v === '(') { const e = or(); if (!op(')')) fail(); i++; return e; }
    if (k.t === 'op' && k.v === '*') return { k: 'star' };
    if (k.t === 'id') {
      const lv = k.v.toLowerCase();
      if (lv === 'true' || lv === 'false') return { k: 'lit', v: lv === 'true' }; if (lv === 'null') return { k: 'lit', v: null };
      if (lv === 'case') { const branches = []; let els = null; while (kw('when')) { i++; const c = or(); if (!kw('then')) fail(); i++; branches.push([c, or()]); } if (kw('else')) { i++; els = or(); } if (!kw('end')) fail(); i++; return { k: 'case', branches, els }; }
      if (op('(')) {
        i++; let distinct = false; if (kw('distinct')) { distinct = true; i++; }
        const args = []; if (!op(')')) { args.push(op('*') ? (i++, { k: 'star' }) : or()); while (op(',')) { i++; args.push(or()); } }
        if (!op(')')) fail(); i++;
        if (AGG.includes(lv)) return { k: 'agg', f: lv === 'mean' ? 'avg' : lv, arg: args[0] || { k: 'star' }, distinct };
        return { k: 'fn', f: lv, args };
      }
      let name = k.v; while (op('.') && toks[i + 1] && toks[i + 1].t === 'id') { i++; name += '.' + toks[i++].v; }
      return { k: 'col', name: name.includes('.') ? name.split('.').pop() : name, qual: name.includes('.') ? name.split('.')[0] : null };
    }
    fail();
  };
  const e = or();
  let alias = null;
  if (kw('as')) { i++; alias = toks[i++].v; } else if (toks[i] && toks[i].t === 'id' && i === toks.length - 1) alias = toks[i++].v;
  if (i < toks.length) fail();
  const res = alias ? { k: 'alias', e, name: alias } : e;
  return res;
}

/* ================= Row ================= */
class Row {
  constructor(names, vals) { this.names = names; this.vals = vals; this.pyType = 'Row'; }
  pyRepr() { return this.names ? `Row(${this.names.map((n, i) => `${n}=${repr(this.vals[i])}`).join(', ')})` : `<Row(${this.vals.map(repr).join(', ')})>`; }
  pyAttr(n) {
    if (this.names) { const i = this.names.indexOf(n); if (i >= 0) return this.vals[i]; }
    if (n === 'asDict') return meth(this, n, () => { const d = new PyDict(); this.names.forEach((k, i) => d.set(k, this.vals[i])); return d; });
    if (n === 'count' || n === 'index') return meth(this, n, (a) => n === 'count' ? this.vals.filter(v => pyEq(v, a[0])).length : this.vals.findIndex(v => pyEq(v, a[0])));
    return undefined;
  }
  pyHint() { return ''; }
  pyGetItem(k) { if (typeof k === 'number') { const i = k < 0 ? this.vals.length + k : k; if (i < 0 || i >= this.vals.length) err('IndexError', 'tuple index out of range'); return this.vals[i]; } if (typeof k === 'string') { const i = this.names ? this.names.indexOf(k) : -1; if (i < 0) err('ValueError', k); return this.vals[i]; } err('TypeError', 'tuple indices must be integers or slices, not ' + typeName(k)); }
  pyIter() { return this.vals; } pyLen() { return this.vals.length; }
}
function toPy(v, t) { if (v === null || v === undefined) return null; if ((t === 'double' || t === 'float') && typeof v === 'number') return F(v); if (Array.isArray(v)) return v.map(x => toPy(x, typeof x === 'number' && !Number.isInteger(x) ? 'double' : null)); return v; }

/* ================= DataFrame ================= */
let DF_ID = 0;
class DataFrame {
  constructor(spark, schema, rows) { this.spark = spark; this.schema = schema.map(c => ({ name: c.name, type: c.type, nullable: c.nullable !== false, qual: c.qual, df: c.df })); this.rows = rows; this.id = ++DF_ID; this.pyType = 'DataFrame'; }
  pyRepr() { return `DataFrame[${this.schema.map(c => `${c.name}: ${SPARK_TYPES[c.type] ? SPARK_TYPES[c.type][2] : c.type}`).join(', ')}]`; }
  pyLen() { err('TypeError', "object of type 'DataFrame' has no len()  (use df.count())"); }
  pyHint(n) { const map = { shoe: 'show', Show: 'show', print_schema: 'printSchema', printschema: 'printSchema', groupby: 'groupBy', orderby: 'orderBy', withcolumn: 'withColumn', filters: 'filter', selects: 'select', sum: "agg(sum(...))  or  groupBy(...).sum(...)", avg: 'agg(avg(...))', head: 'head' }; return map[n] ? `. Did you mean: '${map[n]}'?` : ''; }
  bind() { return this.schema.map(c => Object.assign({}, c, { df: c.df || this.id })); }
  pyGetItem(k) { if (typeof k === 'string') { if (!this.schema.find(c => c.name.toLowerCase() === k.toLowerCase())) unresolved(k, this.schema); return new Column({ k: 'col', name: k, df: this.id }); } if (k instanceof Column) return this.filter(k); if (Array.isArray(k)) return this.select(k); if (typeof k === 'number') return new Column({ k: 'col', name: this.schema[k].name, df: this.id }); err('TypeError', 'unexpected item type'); }
  pyAttr(n, it) {
    const M = (f) => meth(this, n, f);
    switch (n) {
      case 'columns': return this.schema.map(c => c.name);
      case 'dtypes': return this.schema.map(c => tup([c.name, SPARK_TYPES[c.type][2]]));
      case 'schema': return new StructType(this.schema.map(c => new StructField(c.name, c.type, c.nullable)));
      case 'show': return M((a, kw) => { this.show(a[0] !== undefined ? a[0] : kw.n !== undefined ? kw.n : 20, a[1] !== undefined ? a[1] : kw.truncate !== undefined ? kw.truncate : true, kw.vertical, it); return null; });
      case 'printSchema': return M(() => { it.print('root\n' + this.schema.map(c => ` |-- ${c.name}: ${SPARK_TYPES[c.type][1]} (nullable = ${c.nullable ? 'true' : 'false'})`).join('\n') + '\n'); return null; });
      case 'count': return M(() => this.rows.length);
      case 'collect': return M(() => this.collect());
      case 'first': return M(() => (this.rows.length ? this.collect()[0] : null));
      case 'head': return M((a, kw) => { const k = a[0] !== undefined ? a[0] : kw.n; if (k === undefined || k === null) return this.rows.length ? this.collect()[0] : null; return this.collect().slice(0, k); });
      case 'take': return M((a) => this.collect().slice(0, a[0]));
      case 'tail': return M((a) => this.collect().slice(-a[0]));
      case 'isEmpty': return M(() => this.rows.length === 0);
      case 'limit': return M((a) => new DataFrame(this.spark, this.schema, this.rows.slice(0, a[0])));
      case 'select': return M((a) => this.select(a));
      case 'selectExpr': return M((a) => this.select((a.length === 1 && Array.isArray(a[0]) ? a[0] : a).map(s => new Column(sqlToCol(s)))));
      case 'filter': case 'where': return M((a) => { if (a[0] === undefined) err('TypeError', `${n}() missing 1 required positional argument: 'condition'`); return this.filter(a[0]); });
      case 'withColumn': return M((a) => this.withColumn(a[0], a[1]));
      case 'withColumns': return M((a) => { let d = this; for (const [k, v] of a[0].items()) d = d.withColumn(k, v); return d; });
      case 'withColumnRenamed': return M((a) => { const i = this.schema.findIndex(c => c.name.toLowerCase() === String(a[0]).toLowerCase()); if (i < 0) return this; const s = this.schema.map((c, j) => (j === i ? Object.assign({}, c, { name: a[1] }) : c)); return new DataFrame(this.spark, s, this.rows); });
      case 'drop': return M((a) => { const names = a.map(x => (x instanceof Column ? exprName(x.x) : x)).map(x => String(x).toLowerCase()); const keep = this.schema.map((c, i) => [c, i]).filter(([c]) => !names.includes(c.name.toLowerCase())); return new DataFrame(this.spark, keep.map(k => k[0]), this.rows.map(r => keep.map(k => r[k[1]]))); });
      case 'toDF': return M((a) => { if (a.length !== this.schema.length) sparkErr('IllegalArgumentException', `requirement failed: The number of columns doesn't match.\nOld column names (${this.schema.length}): ${this.schema.map(c => c.name).join(', ')}\nNew column names (${a.length}): ${a.join(', ')}`); return new DataFrame(this.spark, this.schema.map((c, i) => Object.assign({}, c, { name: a[i] })), this.rows); });
      case 'groupBy': case 'groupby': return M((a) => new GroupedData(this, (a.length === 1 && Array.isArray(a[0]) ? a[0] : a).map(x => colX(x, true))));
      case 'agg': return M((a) => new GroupedData(this, []).pyAttr('agg', it).fn.call(null, a, {}, it));
      case 'orderBy': case 'sort': return M((a, kw) => this.orderBy(a, kw));
      case 'distinct': return M(() => this.distinct());
      case 'dropDuplicates': case 'drop_duplicates': return M((a) => { const cols = a[0] ? a[0].map(nm => this.idx(nm)) : null; const seen = new Set(); return new DataFrame(this.spark, this.schema, this.rows.filter(r => { const k = JSON.stringify(cols ? cols.map(i => r[i]) : r); if (seen.has(k)) return false; seen.add(k); return true; })); });
      case 'describe': case 'summary': return M((a) => this.describe(a.length === 1 && Array.isArray(a[0]) ? a[0] : a, n === 'summary'));
      case 'crosstab': return M((a) => this.crosstab(a[0], a[1]));
      case 'union': case 'unionAll': case 'unionByName': return M((a) => { const o = a[0]; if (o.schema.length !== this.schema.length) sparkErr('AnalysisException', `[NUM_COLUMNS_MISMATCH] UNION can only be performed on inputs with the same number of columns, but the first input has ${this.schema.length} columns and the second input has ${o.schema.length} columns.`); return new DataFrame(this.spark, this.schema, this.rows.concat(n === 'unionByName' ? o.rows.map(r => this.schema.map(c => r[o.idx(c.name)])) : o.rows)); });
      case 'join': return M((a, kw) => this.join(a[0], a[1] !== undefined ? a[1] : kw.on, a[2] !== undefined ? a[2] : kw.how || 'inner'));
      case 'alias': return M(() => this);
      case 'cache': case 'persist': case 'unpersist': case 'coalesce': case 'repartition': return M(() => this);
      case 'createOrReplaceTempView': case 'createTempView': case 'createGlobalTempView': case 'registerTempTable': return M((a) => { if (n === 'createTempView' && this.spark.views[a[0].toLowerCase()]) sparkErr('AnalysisException', `[TEMP_TABLE_OR_VIEW_ALREADY_EXISTS] Cannot create the temporary view \`${a[0]}\` because it already exists.`); this.spark.views[a[0].toLowerCase()] = this; return null; });
      case 'rdd': return new RDD(this.spark.sc, () => this.collect(), 'MapPartitionsRDD', 'javaToPython at NativeMethodAccessorImpl.java:0');
      case 'write': return new DataFrameWriter(this);
      case 'na': return { pyType: 'DataFrameNaFunctions', pyAttr: (m2) => m2 === 'fill' ? meth(this, m2, (a) => this.fillna(a[0])) : m2 === 'drop' ? meth(this, m2, () => this.dropna()) : undefined };
      case 'fillna': return M((a) => this.fillna(a[0]));
      case 'dropna': return M(() => this.dropna());
      case 'explain': return M(() => { it.print('== Physical Plan ==\n*(1) Scan csv [' + this.schema.map(c => c.name).join(',') + ']'); return null; });
      case 'toPandas': return M(() => err('ModuleNotFoundError', "No module named 'pandas'  (pandas is not installed in this lab — use show())"));
      case 'printschema': return undefined;
    }
    const col = this.schema.find(c => c.name === n);
    if (col) return new Column({ k: 'col', name: n, df: this.id });
    return undefined;
  }
  idx(name) { const i = this.schema.findIndex(c => c.name.toLowerCase() === String(name).toLowerCase()); if (i < 0) unresolved(name, this.schema); return i; }
  collect() { const names = this.schema.map(c => c.name); return this.rows.map(r => new Row(names, r.map((v, i) => toPy(v, this.schema[i].type)))); }
  expandSelect(items) {
    const out = [];
    for (const it of items) {
      if (it === '*' || (it instanceof Column && it.x.k === 'col' && it.x.name === '*') || (it instanceof Column && it.x.k === 'star')) { this.schema.forEach(c => out.push({ k: 'col', name: c.name, df: c.df })); continue; }
      if (typeof it === 'string') { out.push({ k: 'col', name: it }); continue; }
      if (it instanceof Column) { out.push(it.x); continue; }
      if (Array.isArray(it)) { out.push(...this.expandSelect(it)); continue; }
      err('pyspark.errors.exceptions.base.PySparkTypeError', `[NOT_COLUMN_OR_STR] Argument \`col\` should be a Column or str, got ${typeName(it)}.`);
    }
    return out;
  }
  select(items) {
    const xs = this.expandSelect(items); const sch = this.bind();
    if (xs.some(hasAgg)) { const g = new GroupedData(this, []); return g.aggregate(xs); }
    const cs = xs.map(x => compile(x, sch));
    return new DataFrame(this.spark, cs.map(c => ({ name: c.name, type: c.type })), this.rows.map(r => cs.map(c => c.get(r))));
  }
  filter(cond) {
    let x;
    if (typeof cond === 'string') x = sqlToCol(cond); else if (cond instanceof Column) x = cond.x; else if (typeof cond === 'boolean') x = { k: 'lit', v: cond };
    else err('pyspark.errors.exceptions.base.PySparkTypeError', `[NOT_COLUMN_OR_STR] Argument \`condition\` should be a Column or str, got ${typeName(cond)}.`);
    if (hasAgg(x)) sparkErr('AnalysisException', `[INVALID_WHERE_CONDITION] The WHERE condition "${exprName(x)}" contains invalid expressions: ${exprName(x)}. Rewrite the query to avoid window functions, aggregate functions, and generator functions in the WHERE clause.`);
    const c = compile(x, this.bind());
    if (c.type !== 'boolean') sparkErr('AnalysisException', `[DATATYPE_MISMATCH.FILTER_NOT_BOOLEAN] Cannot resolve "${c.name}" due to data type mismatch: Filter expression "${c.name}" of type "${(SPARK_TYPES[c.type] || [0, 0, c.type])[2].toUpperCase()}" is not a boolean.`);
    return new DataFrame(this.spark, this.schema, this.rows.filter(r => c.get(r) === true));
  }
  withColumn(name, col) {
    if (typeof name !== 'string') err('pyspark.errors.exceptions.base.PySparkTypeError', `[NOT_STR] Argument \`colName\` should be a str, got ${typeName(name)}.`);
    if (!(col instanceof Column)) err('pyspark.errors.exceptions.base.PySparkTypeError', `[NOT_COLUMN] Argument \`col\` should be a Column, got ${typeName(col)}.` + (typeof col === 'string' || isNum(col) ? '  (wrap constants in lit(...))' : ''));
    if (hasAgg(col.x)) sparkErr('AnalysisException', `[MISSING_GROUP_BY] The query does not include a GROUP BY clause. Add GROUP BY or turn it into the window functions using OVER clauses.`);
    const c = compile(col.x, this.bind());
    const i = this.schema.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
    const schema = this.schema.slice(); const rows = this.rows.map(r => { const v = c.get(r); const nr = r.slice(); if (i >= 0) nr[i] = v; else nr.push(v); return nr; });
    if (i >= 0) schema[i] = { name, type: c.type }; else schema.push({ name, type: c.type });
    return new DataFrame(this.spark, schema, rows);
  }
  orderBy(a, kw) {
    let items = a.length === 1 && Array.isArray(a[0]) ? a[0] : a;
    if (!items.length) sparkErr('PySparkValueError', '[CANNOT_BE_EMPTY] At least one column must be specified.');
    let asc = kw.ascending === undefined ? null : kw.ascending;
    const sch = this.bind();
    const keys = items.map((it, k) => { let x = typeof it === 'string' ? { k: 'col', name: it } : it.x; let dir = 'asc', nl = false; if (x.k === 'sort') { dir = x.dir; nl = x.nl; x = x.e; } if (asc !== null) { const av = Array.isArray(asc) ? asc[k] : asc; dir = truthy(av) ? 'asc' : 'desc'; } return { c: compile(x, sch), dir, nl }; });
    const rows = this.rows.slice().sort((r1, r2) => { for (const k of keys) { const a1 = k.c.get(r1), b1 = k.c.get(r2); if (a1 === b1) continue; let d; if (a1 === null) d = k.dir === 'asc' ? -1 : 1; else if (b1 === null) d = k.dir === 'asc' ? 1 : -1; else d = a1 < b1 ? -1 : 1; if (a1 === null || b1 === null) return d; return k.dir === 'desc' ? -d : d; } return 0; });
    return new DataFrame(this.spark, this.schema, rows);
  }
  distinct() { const seen = new Set(); return new DataFrame(this.spark, this.schema, this.rows.filter(r => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; })); }
  fillna(v) { return new DataFrame(this.spark, this.schema, this.rows.map(r => r.map((x, i) => { if (x !== null) return x; const t = this.schema[i].type; if (v instanceof PyDict) { const vv = v.get(this.schema[i].name); return vv === undefined ? null : toSparkVal(vv); } if (isNum(v) && NUMT.includes(t)) return num(v); if (typeof v === 'string' && t === 'string') return v; return null; }))); }
  dropna() { return new DataFrame(this.spark, this.schema, this.rows.filter(r => r.every(x => x !== null))); }
  show(n, truncate, vertical, it) {
    n = num(n); const tr = truncate === true ? 20 : truncate === false ? 0 : num(truncate);
    const rows = this.rows.slice(0, n);
    const cell = (v, t) => { let s = v === null || v === undefined ? 'NULL' : fmtCell(v, t); if (tr > 0 && s.length > tr) s = tr < 4 ? s.slice(0, tr) : s.slice(0, tr - 3) + '...'; return s; };
    const header = this.schema.map(c => (tr > 0 && c.name.length > tr ? c.name.slice(0, tr - 3) + '...' : c.name));
    const cells = rows.map(r => r.map((v, i) => cell(v, this.schema[i].type)));
    if (vertical) { const w = Math.max(...header.map(h => h.length)); rows.forEach((r, ri) => { it.print(`-RECORD ${ri}` + '-'.repeat(Math.max(0, w + 6))); header.forEach((h, i) => it.print(` ${h.padEnd(w)} | ${cells[ri][i]}`)); }); if (!rows.length) it.print('(0 rows)'); it.print(''); return; }
    const widths = header.map((h, i) => Math.max(3, h.length, ...cells.map(r => r[i].length)));
    const sep = '+' + widths.map(w => '-'.repeat(w)).join('+') + '+';
    const fmtRow = (vals) => '|' + vals.map((v, i) => (tr > 0 ? v.padStart(widths[i]) : v.padEnd(widths[i]))).join('|') + '|';
    const lines = [sep, fmtRow(header), sep, ...cells.map(fmtRow), sep];
    if (this.rows.length > n) lines.push(`only showing top ${n} row${n === 1 ? '' : 's'}`);
    it.print(lines.join('\n') + '\n');
    it.lastShow = { cols: this.schema.map(c => c.name), rows: this.rows.slice(0, n).map(r => r.map((v, i) => (v === null ? 'NULL' : fmtCell(v, this.schema[i].type)))) };
    if (it.onShow) it.onShow(it.lastShow);
  }
  describe(cols, isSummary) {
    let targets = cols.length ? cols.map(c => this.schema[this.idx(c)]) : this.schema.filter(c => NUMT.includes(c.type) || c.type === 'string');
    const stats = isSummary ? ['count', 'mean', 'stddev', 'min', '25%', '50%', '75%', 'max'] : ['count', 'mean', 'stddev', 'min', 'max'];
    const rows = stats.map(s => [s].concat(targets.map(c => {
      const i = this.schema.indexOf(c); const vals = this.rows.map(r => r[i]).filter(v => v !== null);
      const numeric = NUMT.includes(c.type);
      const nums = numeric ? vals : vals.map(sparkNum).filter(v => v !== null);
      if (s === 'count') return String(vals.length);
      if (s === 'mean') return nums.length ? jd(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
      if (s === 'stddev') { if (nums.length < 2) return null; const mean = nums.reduce((a, b) => a + b, 0) / nums.length; return jd(Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1))); }
      if (s === 'min' || s === 'max') { if (!vals.length) return null; const v = vals.reduce((p, q) => (s === 'min' ? (q < p ? q : p) : (q > p ? q : p))); return fmtCell(v, c.type); }
      if (/%$/.test(s)) { if (!nums.length) return null; const sorted = nums.slice().sort((a, b) => a - b); const p = parseInt(s, 10) / 100; return fmtCell(sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)], c.type); }
    })));
    return new DataFrame(this.spark, [{ name: 'summary', type: 'string' }].concat(targets.map(c => ({ name: c.name, type: 'string' }))), rows);
  }
  crosstab(c1, c2) {
    const i1 = this.idx(c1), i2 = this.idx(c2);
    const keys1 = [], keys2 = new Set(); const counts = new Map();
    for (const r of this.rows) { const a = r[i1] === null ? 'null' : fmtCell(r[i1]), b = r[i2] === null ? 'null' : fmtCell(r[i2]); if (!keys1.includes(a)) keys1.push(a); keys2.add(b); counts.set(a + '\u0000' + b, (counts.get(a + '\u0000' + b) || 0) + 1); }
    const k2 = [...keys2].sort();
    return new DataFrame(this.spark, [{ name: `${c1}_${c2}`, type: 'string' }].concat(k2.map(k => ({ name: k, type: 'bigint' }))), keys1.map(a => [a].concat(k2.map(b => counts.get(a + '\u0000' + b) || 0))));
  }
  join(other, on, how) {
    if (!(other instanceof DataFrame)) err('pyspark.errors.exceptions.base.PySparkTypeError', '[NOT_DATAFRAME] Argument `other` should be a DataFrame.');
    how = String(how || 'inner').toLowerCase().replace(/_/g, ''); const H = { inner: 'inner', left: 'left', leftouter: 'left', right: 'right', rightouter: 'right', outer: 'full', full: 'full', fullouter: 'full', leftsemi: 'semi', semi: 'semi', leftanti: 'anti', anti: 'anti', cross: 'cross' }[how];
    if (!H) err('pyspark.errors.exceptions.captured.IllegalArgumentException', `Unsupported join type '${how}'.`);
    const L = this.bind(), R = other.bind(); let cond, usingCols = null;
    if (on === null || on === undefined) cond = () => true;
    else if (typeof on === 'string' || (Array.isArray(on) && on.every(x => typeof x === 'string'))) { usingCols = typeof on === 'string' ? [on] : on; const li = usingCols.map(c => this.idx(c)), ri = usingCols.map(c => other.idx(c)); cond = (l, r) => li.every((x, k) => l[x] !== null && l[x] === r[ri[k]]); }
    else { const x = on instanceof Column ? on.x : Array.isArray(on) ? on.map(c => c.x).reduce((a, b) => ({ k: 'bin', op: 'AND', l: a, r: b })) : null; const c = compile(x, L.concat(R)); cond = (l, r) => c.get(l.concat(r)) === true; }
    const out = []; const rMatched = new Set();
    for (const l of this.rows) { let hit = false; other.rows.forEach((r, ri) => { if (cond(l, r)) { hit = true; rMatched.add(ri); if (H !== 'semi' && H !== 'anti') out.push(l.concat(r)); } }); if (H === 'semi' && hit) out.push(l); if (H === 'anti' && !hit) out.push(l); if (!hit && (H === 'left' || H === 'full')) out.push(l.concat(R.map(() => null))); }
    if (H === 'right' || H === 'full') other.rows.forEach((r, ri) => { if (!rMatched.has(ri)) out.push(L.map(() => null).concat(r)); });
    if (H === 'semi' || H === 'anti') return new DataFrame(this.spark, L, out);
    if (usingCols) {
      const li = usingCols.map(c => this.idx(c)), ri = usingCols.map(c => other.idx(c));
      const sch = usingCols.map((c, k) => L[li[k]]).concat(L.filter((_, i) => !li.includes(i)), R.filter((_, i) => !ri.includes(i)));
      const rows = out.map(row => { const l = row.slice(0, L.length), r = row.slice(L.length); return li.map((x, k) => (l[x] !== null ? l[x] : r[ri[k]])).concat(l.filter((_, i) => !li.includes(i)), r.filter((_, i) => !ri.includes(i))); });
      return new DataFrame(this.spark, sch, rows);
    }
    return new DataFrame(this.spark, L.concat(R), out);
  }
}
function fmtCell(v, t) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') { if (t === 'double' || t === 'float' || !Number.isInteger(v)) return jd(v); return String(v); }
  if (Array.isArray(v)) return '[' + v.map(x => fmtCell(x)).join(', ') + ']';
  return String(v);
}
class GroupedData {
  constructor(df, keys) { this.df = df; this.keys = keys; this.pyType = 'GroupedData'; }
  pyRepr() { return `GroupedData[grouping expressions: [${this.keys.map(exprName).join(', ')}], value: [${this.df.schema.map(c => c.name + ': ' + SPARK_TYPES[c.type][2]).join(', ')}], type: GroupBy]`; }
  pyHint(n) { return n === 'show' ? '  (aggregate first, e.g. df.groupBy("Department").count().show())' : ''; }
  pyAttr(n, it) {
    const M = (f) => meth(this, n, f);
    const numCols = () => this.df.schema.filter(c => NUMT.includes(c.type)).map(c => c.name);
    const simple = (f) => M((a) => { const cols = a.length ? a : numCols(); cols.forEach(c => { const i = this.df.idx(c); if (!NUMT.includes(this.df.schema[i].type)) sparkErr('AnalysisException', `"${c}" is not a numeric column. Aggregation function can only be applied on a numeric column.`); }); return this.aggregate(cols.map(c => ({ k: 'agg', f, arg: { k: 'col', name: c } }))); });
    switch (n) {
      case 'count': return M(() => this.aggregate([{ k: 'alias', name: 'count', e: { k: 'agg', f: 'count', arg: { k: 'star' } } }]));
      case 'sum': return simple('sum'); case 'avg': case 'mean': return simple('avg'); case 'max': return simple('max'); case 'min': return simple('min');
      case 'agg': return M((a) => {
        if (a.length === 1 && a[0] instanceof PyDict) return this.aggregate(a[0].items().map(([c, f]) => ({ k: 'agg', f: f === 'mean' ? 'avg' : f, arg: c === '*' ? { k: 'star' } : { k: 'col', name: c } })));
        const xs = (a.length === 1 && Array.isArray(a[0]) ? a[0] : a).map(x => { if (!(x instanceof Column)) err('pyspark.errors.exceptions.base.PySparkTypeError', '[NOT_COLUMN] Argument `exprs` should be a Column, got ' + typeName(x) + '.'); return x.x; });
        xs.forEach(x => { if (!hasAgg(x) && x.k !== 'lit') sparkErr('AnalysisException', `[MISSING_AGGREGATION] The non-aggregating expression "${exprName(x)}" is based on columns which are not participating in the GROUP BY clause.`); });
        return this.aggregate(xs);
      });
    }
    return undefined;
  }
  aggregate(xs) {
    const sch = this.df.bind();
    const keyC = this.keys.map(k => compile(k, sch));
    const groups = new Map();
    for (const r of this.df.rows) { const kv = keyC.map(k => k.get(r)); const ks = JSON.stringify(kv); if (!groups.has(ks)) groups.set(ks, { kv, rows: [] }); groups.get(ks).rows.push(r); }
    if (!this.keys.length && !groups.size) groups.set('[]', { kv: [], rows: [] });
    const aggs = xs.map(x => compileGroupExpr(x, sch));
    const schema = keyC.map(k => ({ name: k.name, type: k.type })).concat(aggs.map(a => ({ name: a.name, type: a.type })));
    const rows = [...groups.values()].map(g => g.kv.concat(aggs.map(a => a.get(g.rows))));
    return new DataFrame(this.df.spark, schema, rows);
  }
}
class DataFrameWriter {
  constructor(df) { this.df = df; this.opts = { mode: 'errorifexists', header: false, sep: ',' }; this.pyType = 'DataFrameWriter'; }
  pyAttr(n, it) {
    const M = (f) => meth(this, n, f);
    if (n === 'mode') return M((a) => { this.opts.mode = String(a[0]).toLowerCase(); return this; });
    if (n === 'option') return M((a) => { this.opts[String(a[0]).toLowerCase()] = a[1]; return this; });
    if (n === 'options') return M((a, kw) => { Object.assign(this.opts, kw); return this; });
    if (n === 'format') return M((a) => { this.opts.format = a[0]; return this; });
    if (n === 'csv' || n === 'save' || n === 'text') return M((a, kw) => { Object.assign(this.opts, kw); if (kw.mode) this.opts.mode = kw.mode; this.save(a[0] || kw.path, n, it); return null; });
    if (n === 'saveAsTable') return M(() => err('pyspark.errors.exceptions.captured.AnalysisException', 'saveAsTable needs Hive support, which is not enabled in this lab. Use df.write.csv(path).'));
    if (['json', 'parquet', 'orc'].includes(n)) return M(() => err('pyspark.errors.exceptions.captured.AnalysisException', `${n} output is not part of this lab. Use df.write.csv(path, header=True).`));
    return undefined;
  }
  save(path, kind, it) {
    const sp = this.df.spark; const target = sp.resolvePath(path);
    const fs = target.fs; const abs = target.path;
    if (fs.exists(abs)) { if (this.opts.mode === 'overwrite') fs.rm(abs); else if (this.opts.mode === 'ignore') return; else if (this.opts.mode !== 'append') sparkErr('AnalysisException', `[PATH_ALREADY_EXISTS] Path ${target.uri} already exists. Set mode as "overwrite" to overwrite the existing path.`); }
    fs.mkdir(abs, true);
    const header = truthy(this.opts.header) && String(this.opts.header).toLowerCase() !== 'false';
    const sep = this.opts.sep || this.opts.delimiter || ',';
    const lines = this.df.rows.map(r => r.map((v, i) => (v === null ? '' : csvQuote(fmtCell(v, this.df.schema[i].type), sep))).join(sep));
    const text = (header ? this.df.schema.map(c => c.name).join(sep) + '\n' : '') + (lines.length ? lines.join('\n') + '\n' : '');
    const id = 'part-00000-' + Math.random().toString(16).slice(2, 10) + '-6b1c-4d2a-9f3e-' + Math.random().toString(16).slice(2, 14) + '-c000.csv';
    fs.write(abs + '/' + id, text); fs.write(abs + '/_SUCCESS', '');
    sp.m.event({ kind: 'py', type: 'write', path: abs });
  }
}
function csvQuote(s, sep) { return s.includes(sep) || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '\\"') + '"' : s; }
function parseCSVLine(line, sep) { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '\\' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"' && cur === '') q = true; else if (line.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; } else cur += c; } out.push(cur); return out; }

/* ================= RDD ================= */
class RDD {
  constructor(sc, compute, kind, where) { this.sc = sc; this.compute = compute; this.id = sc ? sc.nextId() : 0; this.kind = kind || 'PythonRDD'; this.where = where || 'RDD at PythonRDD.scala:53'; this.pyType = 'RDD'; this.parts = 2; }
  pyRepr() { return `${this.prefix || ''}${this.kind}[${this.id}] at ${this.where}`; }
  data() { try { return this.compute(); } catch (e) { if (e instanceof PyErr && !/^org\.apache|^pyspark|^py4j/.test(e.pytype) && !e.wrapped) { const w = new PyErr('org.apache.spark.api.python.PythonException', `\n  Traceback (most recent call last):\n    File "<stdin>", line 1, in <lambda>\n  ${e.pytype}: ${e.message}\n`); w.wrapped = true; w.inner = e; throw w; } throw e; } }
  derive(fn) { const p = this; return new RDD(this.sc, () => fn(p.compute())); }
  pyAttr(n, it) {
    const M = (f) => meth(this, n, f); const call = (f, ...a) => it.callPy(f, ...a);
    const pairs = (arr) => arr.map(x => { const v = iterate(x); if (v.length !== 2) err('ValueError', `too many values to unpack (expected 2)`); return v; });
    switch (n) {
      case 'map': return M((a) => this.derive(d => d.map(x => call(a[0], x))));
      case 'flatMap': return M((a) => this.derive(d => d.flatMap(x => iterate(call(a[0], x)))));
      case 'filter': return M((a) => this.derive(d => d.filter(x => truthy(call(a[0], x)))));
      case 'mapValues': return M((a) => this.derive(d => pairs(d).map(([k, v]) => tup([k, call(a[0], v)]))));
      case 'flatMapValues': return M((a) => this.derive(d => pairs(d).flatMap(([k, v]) => iterate(call(a[0], v)).map(x => tup([k, x])))));
      case 'keys': return M(() => this.derive(d => pairs(d).map(p => p[0]))); case 'values': return M(() => this.derive(d => pairs(d).map(p => p[1])));
      case 'reduceByKey': return M((a) => this.derive(d => { const m2 = new PyDict(); for (const [k, v] of pairs(d)) { const cur = m2.get(k); m2.set(k, cur === undefined ? v : call(a[0], cur, v)); } return m2.items(); }));
      case 'groupByKey': return M(() => this.derive(d => { const m2 = new PyDict(); for (const [k, v] of pairs(d)) { const cur = m2.get(k); if (cur === undefined) m2.set(k, new ResultIterable([v])); else cur.vals.push(v); } return m2.items(); }));
      case 'countByKey': return M(() => { const d = new PyDict(); d.isDefault = true; for (const [k] of pairs(this.data())) d.set(k, (d.get(k) || 0) + 1); return d; });
      case 'countByValue': return M(() => { const d = new PyDict(); d.isDefault = true; for (const v of this.data()) d.set(v, (d.get(v) || 0) + 1); return d; });
      case 'sortByKey': return M((a, kw) => { const asc = a[0] !== undefined ? truthy(a[0]) : kw.ascending === undefined ? true : truthy(kw.ascending); return this.derive(d => { const s = pairs(d).map(p => tup(p)).sort((x, y) => pyCmp(x[0], y[0], '<')); return asc ? s : s.reverse(); }); });
      case 'sortBy': return M((a, kw) => { const asc = a[1] !== undefined ? truthy(a[1]) : kw.ascending === undefined ? true : truthy(kw.ascending); return this.derive(d => { const s = d.map(x => [call(a[0], x), x]).sort((x, y) => pyCmp(x[0], y[0], '<')); if (!asc) s.reverse(); return s.map(p => p[1]); }); });
      case 'distinct': return M(() => this.derive(d => { const out = []; const seen = new Set(); for (const v of d) { const k = repr(v); if (!seen.has(k)) { seen.add(k); out.push(v); } } return out; }));
      case 'union': return M((a) => { const o = a[0]; return new RDD(this.sc, () => this.compute().concat(o.compute()), 'UnionRDD', 'union at NativeMethodAccessorImpl.java:0'); });
      case 'intersection': return M((a) => this.derive(d => { const o = a[0].compute().map(repr); const out = []; const seen = new Set(); d.forEach(v => { const k = repr(v); if (o.includes(k) && !seen.has(k)) { seen.add(k); out.push(v); } }); return out; }));
      case 'subtract': return M((a) => this.derive(d => { const o = a[0].compute().map(repr); return d.filter(v => !o.includes(repr(v))); }));
      case 'join': case 'leftOuterJoin': case 'rightOuterJoin': case 'fullOuterJoin': return M((a) => this.derive(d => { const L = pairs(d), R = pairs(a[0].compute()); const out = []; const rm = new Set(); for (const [k, v] of L) { let hit = false; R.forEach(([k2, v2], i) => { if (pyEq(k, k2)) { hit = true; rm.add(i); out.push(tup([k, tup([v, v2])])); } }); if (!hit && (n === 'leftOuterJoin' || n === 'fullOuterJoin')) out.push(tup([k, tup([v, null])])); } if (n === 'rightOuterJoin' || n === 'fullOuterJoin') R.forEach(([k2, v2], i) => { if (!rm.has(i)) out.push(tup([k2, tup([null, v2])])); }); return out; }));
      case 'zipWithIndex': return M(() => this.derive(d => d.map((v, i) => tup([v, i]))));
      case 'cache': case 'persist': case 'unpersist': case 'repartition': case 'coalesce': case 'setName': return M(() => this);
      case 'getNumPartitions': return M(() => this.parts);
      case 'glom': return M(() => this.derive(d => { const h = Math.ceil(d.length / 2); return [d.slice(0, h), d.slice(h)]; }));
      case 'collect': return M(() => this.data().slice());
      case 'count': return M(() => this.data().length);
      case 'first': return M(() => { const d = this.data(); if (!d.length) err('pyspark.errors.exceptions.base.PySparkValueError', '[CANNOT_BE_EMPTY] RDD is empty'); return d[0]; });
      case 'take': return M((a) => this.data().slice(0, a[0]));
      case 'top': return M((a, kw) => { const key = kw.key ? (x) => call(kw.key, x) : (x) => x; return this.data().slice().sort((x, y) => pyCmp(key(y), key(x), '<')).slice(0, a[0]); });
      case 'takeOrdered': return M((a, kw) => { const key = (a[1] || kw.key) ? (x) => call(a[1] || kw.key, x) : (x) => x; return this.data().slice().sort((x, y) => pyCmp(key(x), key(y), '<')).slice(0, a[0]); });
      case 'reduce': return M((a) => { const d = this.data(); if (!d.length) err('ValueError', 'Can not reduce() empty RDD'); return d.reduce((p, c) => call(a[0], p, c)); });
      case 'fold': return M((a) => this.data().reduce((p, c) => call(a[1], p, c), a[0]));
      case 'sum': return M(() => BUILTINS.get('sum').fn([this.data()], {}));
      case 'max': return M((a, kw) => minmax([this.data()], { key: a[0] || kw.key }, it, 1, 'max'));
      case 'min': return M((a, kw) => minmax([this.data()], { key: a[0] || kw.key }, it, -1, 'min'));
      case 'mean': return M(() => { const d = this.data().map(num); return F(d.reduce((p, c) => p + c, 0) / d.length); });
      case 'stats': return M(() => { const d = this.data().map(num); const mean = d.reduce((p, c) => p + c, 0) / d.length; const sd = Math.sqrt(d.reduce((p, c) => p + (c - mean) ** 2, 0) / d.length); return { pyType: 'StatCounter', pyRepr: () => `(count: ${d.length}, mean: ${pyFloatRepr(mean)}, stdev: ${pyFloatRepr(sd)}, max: ${pyFloatRepr(Math.max(...d))}, min: ${pyFloatRepr(Math.min(...d))})` }; });
      case 'foreach': return M((a) => { this.data().forEach(x => call(a[0], x)); return null; });
      case 'collectAsMap': return M(() => { const d = new PyDict(); pairs(this.data()).forEach(([k, v]) => d.set(k, v)); return d; });
      case 'lookup': return M((a) => pairs(this.data()).filter(([k]) => pyEq(k, a[0])).map(p => p[1]));
      case 'isEmpty': return M(() => this.data().length === 0);
      case 'toDF': return M((a) => { const data = this.data(); const sp = this.sc.spark; return sp.createDF(data, a[0] !== undefined ? a[0] : null); });
      case 'saveAsTextFile': return M((a) => {
        const sp = this.sc.spark; const t = sp.resolvePath(a[0]); if (t.fs.exists(t.path)) err('py4j.protocol.Py4JJavaError', `An error occurred while calling o${this.id + 40}.saveAsTextFile.\n: org.apache.hadoop.mapred.FileAlreadyExistsException: Output directory ${t.uri} already exists`);
        const d = this.data(); const h = Math.ceil(d.length / 2); t.fs.mkdir(t.path, true);
        [d.slice(0, h), d.slice(h)].forEach((part, i) => t.fs.write(`${t.path}/part-0000${i}`, part.length ? part.map(str).join('\n') + '\n' : ''));
        t.fs.write(t.path + '/_SUCCESS', ''); sp.m.event({ kind: 'py', type: 'save', path: t.path }); return null;
      });
      case 'context': return this.sc;
      case 'id': return this.id;
    }
    return undefined;
  }
}
class ResultIterable { constructor(vals) { this.vals = vals; this.pyType = 'ResultIterable'; } pyRepr() { return '<pyspark.resultiterable.ResultIterable object at 0x7f6c1e2b3d90>'; } pyIter() { return this.vals; } pyLen() { return this.vals.length; } }
class SparkContext {
  constructor(spark) { this.spark = spark; this.rid = 0; this.pyType = 'SparkContext'; }
  nextId() { return this.rid++; }
  pyRepr() { return '<SparkContext master=local[*] appName=' + this.spark.appName + '>'; }
  pyAttr(n, it) {
    const M = (f) => meth(this, n, f);
    switch (n) {
      case 'parallelize': return M((a) => { const d = iterate(a[0]).slice(); const r = new RDD(this, () => d, 'ParallelCollectionRDD', 'readRDDFromFile at PythonRDD.scala:289'); if (a[1]) r.parts = a[1]; return r; });
      case 'range': return M((a) => { const d = BUILTINS.get('range').fn(a); return new RDD(this, () => d, 'PythonRDD', 'RDD at PythonRDD.scala:53'); });
      case 'textFile': return M((a) => { const p = a[0]; const sp = this.spark; const t = sp.resolvePath(p); const r = new RDD(this, () => sp.readLines(p, true).flatMap(f => f.lines), 'MapPartitionsRDD', 'textFile at NativeMethodAccessorImpl.java:0'); r.prefix = t.uri + ' '; return r; });
      case 'wholeTextFiles': return M((a) => { const sp = this.spark; return new RDD(this, () => sp.readLines(a[0], true).map(f => tup([f.uri, f.text])), 'MapPartitionsRDD', 'wholeTextFiles at NativeMethodAccessorImpl.java:0'); });
      case 'appName': return this.spark.appName; case 'master': return 'local[*]'; case 'version': return '3.5.1'; case 'defaultParallelism': return 2; case 'applicationId': return this.spark.appId;
      case 'setLogLevel': case 'stop': return M(() => null);
      case 'uiWebUrl': return 'http://gls-university:4040';
    }
    return undefined;
  }
}
class SparkSession {
  constructor(m, interp) { this.m = m; this.it = interp; this.appName = 'PySparkShell'; this.views = {}; this.sc = new SparkContext(this); this.appId = 'local-' + Date.now(); this.pyType = 'SparkSession'; }
  pyRepr() { return '<pyspark.sql.session.SparkSession object at 0x7f6c1e2a8b50>'; }
  resolvePath(p) {
    if (typeof p !== 'string') err('pyspark.errors.exceptions.base.PySparkTypeError', `[NOT_STR] Argument \`path\` should be a str, got ${typeName(p)}.`);
    if (p.startsWith('file:')) { const path = this.m.local.norm(p.replace(/^file:(\/\/)?/, ''), this.m.cwd); return { fs: this.m.local, path, uri: 'file:' + path, local: true }; }
    const r = this.m.hpath(p);
    if (r.error === 'port') err('py4j.protocol.Py4JJavaError', `An error occurred while calling o31.csv.\n: java.net.ConnectException: Call From gls-university/127.0.1.1 to ${r.host} failed on connection exception: java.net.ConnectException: Connection refused`);
    if (!this.m.svc.dfs) err('py4j.protocol.Py4JJavaError', `An error occurred while calling o31.csv.\n: java.net.ConnectException: Call From gls-university/127.0.1.1 to localhost:9000 failed on connection exception: java.net.ConnectException: Connection refused\n(HDFS is not running — exit with exit() and run start-dfs.sh)`);
    return { fs: this.m.hdfs, path: r.path, uri: NN + r.path };
  }
  readLines(p, lazyErr) {
    const paths = Array.isArray(p) ? p : [p]; const files = [];
    for (const one of paths) {
      const t = this.resolvePath(one); const fs = t.fs;
      const list = G.SIM.hasGlob(t.path) ? fs.glob(t.path, '/').filter(x => fs.exists(x)) : [t.path];
      if (!list.length || !fs.exists(list[0])) { if (lazyErr) err('py4j.protocol.Py4JJavaError', `An error occurred while calling z:org.apache.spark.api.python.PythonRDD.collectAndServe.\n: org.apache.hadoop.mapred.InvalidInputException: Input path does not exist: ${t.uri}${t.local ? '' : '\n(Check the path with  hdfs dfs -ls  — relative paths point to /user/hadoop in HDFS)'}`); sparkErr('AnalysisException', `[PATH_NOT_FOUND] Path does not exist: ${t.uri}.`); }
      for (const f of list) { if (fs.isDir(f)) fs.list(f).filter(k => !k.startsWith('_') && !k.startsWith('.') && fs.isFile(fs.join(f, k))).forEach(k => files.push({ uri: (t.local ? 'file:' : NN) + fs.join(f, k), text: fs.read(fs.join(f, k)) })); else files.push({ uri: (t.local ? 'file:' : NN) + f, text: fs.read(f) }); }
    }
    files.forEach(f => { const ls = f.text.split('\n'); if (ls[ls.length - 1] === '') ls.pop(); f.lines = ls.map(l => l.replace(/\r$/, '')); });
    return files;
  }
  readCSV(path, o) {
    const files = this.readLines(path, false); const sep = o.sep || o.delimiter || ',';
    const header = truthy(o.header) && String(o.header).toLowerCase() !== 'false';
    let raw = []; let names = null;
    files.forEach(f => { let ls = f.lines; if (header && ls.length) { if (!names) names = parseCSVLine(ls[0], sep).map(s => s.trim()); ls = ls.slice(1); } raw = raw.concat(ls.filter(l => l.length).map(l => parseCSVLine(l, sep))); });
    let schema = o.schema ? schemaFrom(o.schema) : null;
    if (!schema) {
      const n = Math.max(names ? names.length : 0, ...raw.map(r => r.length), 0);
      const infer = truthy(o.inferSchema) && String(o.inferSchema).toLowerCase() !== 'false';
      schema = Array.from({ length: n }, (_, i) => { let type = 'string'; if (infer) { const vals = raw.map(r => r[i]).filter(v => v !== undefined && v !== ''); if (vals.length && vals.every(v => /^[-+]?\d+$/.test(v))) type = vals.every(v => Math.abs(parseInt(v, 10)) <= 2147483647) ? 'int' : 'bigint'; else if (vals.length && vals.every(v => /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v))) type = 'double'; else if (vals.length && vals.every(v => /^(true|false)$/i.test(v))) type = 'boolean'; } return { name: names && names[i] ? names[i] : '_c' + i, type }; });
    }
    const rows = raw.map(r => schema.map((c, i) => { const v = r[i]; if (v === undefined || v === '') return null; return castVal(v, c.type); }));
    return new DataFrame(this, schema, rows);
  }
  createDF(data, schemaArg) {
    if (data instanceof RDD) data = data.data();
    if (data instanceof DataFrame) return data;
    data = iterate(data);
    let schema = schemaFrom(schemaArg);
    const first = data.find(r => r !== null);
    let rows;
    if (first instanceof Row) { rows = data.map(r => r.vals.slice()); if (!schema) schema = first.names ? first.names.map(n => ({ name: n })) : null; }
    else if (first instanceof PyDict) { const keys = first.keys(); rows = data.map(d => keys.map(k => d.get(k))); if (!schema) schema = keys.map(k => ({ name: k })); }
    else if (first !== undefined && !Array.isArray(first)) { rows = data.map(v => [v]); }
    else rows = data.map(r => iterate(r).slice());
    const width = rows.length ? rows[0].length : (schema ? schema.length : 0);
    if (!schema && Array.isArray(schemaArg)) schema = schemaArg.map(n => ({ name: n }));
    if (!schema) schema = Array.from({ length: width }, (_, i) => ({ name: '_' + (i + 1) }));
    if (schema.length !== width && rows.length) sparkErr('IllegalArgumentException', `[LENGTH_SHOULD_BE_THE_SAME] obj and fields should be of the same length, got ${width} and ${schema.length}.`);
    schema = schema.map((c, i) => { if (c.type) return c; const v = rows.map(r => r[i]).find(x => x !== null && x !== undefined); const t = v === undefined ? 'string' : typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'bigint' : isF(v) ? 'double' : 'string'; return { name: c.name, type: t }; });
    rows = rows.map(r => r.map((v, i) => { const sv = toSparkVal(v); if (sv === null) return null; const t = schema[i].type; if ((t === 'int' || t === 'bigint') && typeof sv !== 'number') err('pyspark.errors.exceptions.base.PySparkTypeError', `[FIELD_DATA_TYPE_UNACCEPTABLE] field ${schema[i].name}: ${SPARK_TYPES[t][0]}() can not accept object ${repr(v)} in type ${typeName(v)}.`); if (t === 'string' && typeof sv !== 'string') err('pyspark.errors.exceptions.base.PySparkTypeError', `[FIELD_DATA_TYPE_UNACCEPTABLE] field ${schema[i].name}: StringType() can not accept object ${repr(v)} in type ${typeName(v)}.`); return sv; }));
    return new DataFrame(this, schema, rows);
  }
  sql(q) {
    const H = G.HIVE; const norm = H.normalize(q.replace(/;\s*$/, ''));
    if (/^(show tables|show views)/.test(norm)) return new DataFrame(this, [{ name: 'namespace', type: 'string' }, { name: 'tableName', type: 'string' }, { name: 'isTemporary', type: 'boolean' }], Object.keys(this.views).map(v => ['', v, true]));
    if (!/^(select|with)\b/.test(norm)) sparkErr('ParseException', `\n[PARSE_SYNTAX_ERROR] Only SELECT queries on temp views are supported in this lab shell.\n\n== SQL ==\n${q}`);
    const resolve = (name) => { const v = this.views[name.toLowerCase()]; if (!v) sparkErr('AnalysisException', `[TABLE_OR_VIEW_NOT_FOUND] The table or view \`${name}\` cannot be found. Verify the spelling and correctness of the schema and catalog.\nIf you did not qualify the name with a schema, verify the current_schema() output, or qualify the name with the correct schema and catalog.\nTo tolerate the error on drop use DROP VIEW IF EXISTS or DROP TABLE IF EXISTS.; line 1 pos 0;`); return { name: name.toLowerCase(), cols: v.schema.map(c => ({ name: c.name.toLowerCase(), type: c.type })), rows: v.rows.map(r => { const o = {}; v.schema.forEach((c, i) => { o[c.name.toLowerCase()] = r[i]; }); return o; }), orig: v }; };
    let r;
    try { r = H.runSelect(this.m, { db: 'default', conf: {} }, norm, { resolve }); }
    catch (e) { if (e instanceof H.HiveError) { let msg = e.message.replace(/^FAILED: SemanticException (\[Error \d+\]: )?/, ''); const mm = msg.match(/Invalid table alias or column reference '(\w+)'/); if (mm) { const views = Object.values(this.views); const sch = views.length ? views[0].schema : []; unresolved(mm[1], sch); } sparkErr('AnalysisException', msg); } throw e; }
    // restore original column-name case
    const allCols = Object.values(this.views).flatMap(v => v.schema.map(c => c.name));
    const origItems = (() => { const mm = q.replace(/\s+/g, ' ').match(/^\s*select\s+(distinct\s+)?(.*?)\s+from\s/i); return mm ? G.HIVE.normalize ? splitList(mm[2]) : [] : []; })();
    const names = r.cols.map((c, i) => { const hit = allCols.find(x => x.toLowerCase() === c); if (hit && !/^_c\d+$/.test(c)) { const it2 = origItems[i]; const al = it2 && it2.match(/\s+as\s+`?(\w+)`?\s*$/i); return al ? al[1] : hit; } const it2 = origItems[i]; if (it2) { const al = it2.match(/\s+(?:as\s+)?`?(\w+)`?\s*$/i); if (al && !/\)$/.test(it2.trim())) return al[1]; if (/^_c\d+$/.test(c)) return it2.trim().replace(/\b([A-Za-z_]+)\s*\(/g, (mm, f) => f.toLowerCase() + '(').replace(/\s*\(\s*\*\s*\)/, '(1)'); } return c; });
    return new DataFrame(this, names.map((n, i) => ({ name: n, type: r.types[i] === 'int' && /count\(/i.test(n) ? 'bigint' : r.types[i] || 'string' })), r.rows);
  }
  pyAttr(n, it) {
    const M = (f) => meth(this, n, f);
    switch (n) {
      case 'read': return new DataFrameReader(this);
      case 'sparkContext': return this.sc;
      case 'sql': return M((a) => this.sql(a[0]));
      case 'createDataFrame': return M((a, kw) => this.createDF(a[0], a[1] !== undefined ? a[1] : kw.schema));
      case 'range': return M((a) => { const d = BUILTINS.get('range').fn(a); return new DataFrame(this, [{ name: 'id', type: 'bigint' }], d.map(x => [x])); });
      case 'table': return M((a) => { const v = this.views[String(a[0]).toLowerCase()]; if (!v) sparkErr('AnalysisException', `[TABLE_OR_VIEW_NOT_FOUND] The table or view \`${a[0]}\` cannot be found.`); return v; });
      case 'version': return '3.5.1';
      case 'stop': return M(() => null);
      case 'catalog': return { pyType: 'Catalog', pyAttr: (x) => x === 'listTables' ? B(x, () => Object.keys(this.views).map(v => ({ pyType: 'Table', pyRepr: () => `Table(name='${v}', catalog=None, namespace=[], description=None, tableType='TEMPORARY', isTemporary=True)` }))) : x === 'dropTempView' ? B(x, (a) => { delete this.views[String(a[0]).toLowerCase()]; return true; }) : undefined };
      case 'conf': return { pyType: 'RuntimeConfig', pyAttr: (x) => x === 'set' ? B(x, () => null) : x === 'get' ? B(x, (a) => a[1] || null) : undefined };
      case 'newSession': return M(() => this);
    }
    return undefined;
  }
}
function splitList(s) { const out = []; let d = 0, cur = '', q = null; for (const c of s) { if (q) { cur += c; if (c === q) q = null; continue; } if (c === "'" || c === '"') { q = c; cur += c; continue; } if (c === '(') d++; if (c === ')') d--; if (c === ',' && d === 0) { out.push(cur); cur = ''; continue; } cur += c; } if (cur) out.push(cur); return out.map(x => x.trim()); }
class DataFrameReader {
  constructor(sp) { this.sp = sp; this.o = {}; this.fmt = 'parquet'; this.pyType = 'DataFrameReader'; }
  pyAttr(n) {
    const M = (f) => meth(this, n, f);
    switch (n) {
      case 'option': return M((a) => { this.o[normOpt(a[0])] = a[1]; return this; });
      case 'options': return M((a, kw) => { for (const k in kw) this.o[normOpt(k)] = kw[k]; return this; });
      case 'schema': return M((a) => { this.o.schema = a[0]; return this; });
      case 'format': return M((a) => { this.fmt = String(a[0]).toLowerCase(); return this; });
      case 'csv': return M((a, kw) => { const o = Object.assign({}, this.o); if (a[1] !== undefined) o.schema = a[1]; for (const k in kw) o[normOpt(k)] = kw[k]; if (a[0] === undefined) err('TypeError', "csv() missing 1 required positional argument: 'path'"); return this.sp.readCSV(a[0], o); });
      case 'load': return M((a, kw) => { const o = Object.assign({}, this.o); for (const k in kw) o[normOpt(k)] = kw[k]; const fmt = (kw.format || this.fmt); if (fmt === 'csv') return this.sp.readCSV(a[0], o); if (fmt === 'text') return this.text(a[0]); sparkErr('AnalysisException', `[UNABLE_TO_INFER_SCHEMA] Unable to infer schema for ${fmt.toUpperCase()}. It must be specified manually. (Did you forget .format("csv")?)`); });
      case 'text': return M((a) => this.text(a[0]));
      case 'json': case 'parquet': case 'orc': return M(() => sparkErr('AnalysisException', `${n} files are not part of this lab. Use spark.read.csv(...).`));
      case 'table': return M((a) => this.sp.pyAttr('table').fn([a[0]], {}));
    }
    return undefined;
  }
  text(p) { const files = this.sp.readLines(p, false); return new DataFrame(this.sp, [{ name: 'value', type: 'string' }], files.flatMap(f => f.lines).map(l => [l])); }
}
function normOpt(k) { k = String(k); const l = k.toLowerCase(); return l === 'inferschema' ? 'inferSchema' : l; }
class Builder { constructor(get) { this.get = get; this.name = null; this.pyType = 'Builder'; } pyAttr(n) { const M = (f) => meth(this, n, f); if (['appName', 'master', 'config', 'enableHiveSupport'].includes(n)) return M((a) => { if (n === 'appName') this.name = a[0]; return this; }); if (n === 'getOrCreate') return M(() => { const s = this.get(); if (this.name && !s.__named) { s.appName = this.name; s.__named = true; } return s; }); return undefined; } }

/* ================= modules ================= */
let CURRENT = null; // interpreter currently running (for session access)
const fnA = (f) => B(f, (a) => { if (!a.length) err('TypeError', `${f}() missing 1 required positional argument: 'col'`); return new Column({ k: 'agg', f: f === 'mean' ? 'avg' : f === 'stddev_samp' ? 'stddev' : f, arg: a[0] === '*' ? { k: 'star' } : colX(a[0], true) }); });
const FUNCTIONS = {
  col: B('col', (a) => { if (typeof a[0] !== 'string') err('pyspark.errors.exceptions.base.PySparkTypeError', `[NOT_STR] Argument \`col\` should be a str, got ${typeName(a[0])}.`); return new Column(a[0] === '*' ? { k: 'star' } : { k: 'col', name: a[0] }); }),
  lit: B('lit', (a) => new Column({ k: 'lit', v: a[0] })),
  expr: B('expr', (a) => new Column(sqlToCol(a[0]))),
  sum: fnA('sum'), avg: fnA('avg'), mean: fnA('mean'), max: fnA('max'), min: fnA('min'), stddev: fnA('stddev'), stddev_samp: fnA('stddev_samp'), variance: fnA('variance'), first: fnA('first'), last: fnA('last'), collect_list: fnA('collect_list'), collect_set: fnA('collect_set'),
  count: B('count', (a) => new Column({ k: 'agg', f: 'count', arg: a[0] === '*' ? { k: 'star' } : colX(a[0], true) })),
  countDistinct: B('countDistinct', (a) => new Column({ k: 'agg', f: 'count', distinct: true, arg: colX(a[0], true) })),
  round: B('round', (a, kw) => new Column({ k: 'fn', f: 'round', args: [colX(a[0], true), { k: 'lit', v: a[1] !== undefined ? a[1] : kw.scale !== undefined ? kw.scale : 0 }] })),
  bround: B('bround', (a) => new Column({ k: 'fn', f: 'bround', args: [colX(a[0], true), { k: 'lit', v: a[1] || 0 }] })),
  when: B('when', (a) => { if (!(a[0] instanceof Column)) err('pyspark.errors.exceptions.base.PySparkTypeError', '[NOT_COLUMN] Argument `condition` should be a Column, got ' + typeName(a[0]) + '.'); return new Column({ k: 'case', branches: [[a[0].x, litX(a[1])]], els: null }); }),
  desc: B('desc', (a) => new Column({ k: 'sort', e: colX(a[0], true), dir: 'desc' })), asc: B('asc', (a) => new Column({ k: 'sort', e: colX(a[0], true), dir: 'asc' })),
};
['upper', 'lower', 'length', 'trim', 'abs', 'sqrt', 'year', 'isnull'].forEach(f => { FUNCTIONS[f] = B(f, (a) => new Column({ k: 'fn', f, args: [colX(a[0], true)] })); });
FUNCTIONS.concat = B('concat', (a) => new Column({ k: 'fn', f: 'concat', args: a.map(x => colX(x, true)) }));
FUNCTIONS.concat_ws = B('concat_ws', (a) => new Column({ k: 'fn', f: 'concat_ws', args: [{ k: 'lit', v: a[0] }].concat(a.slice(1).map(x => colX(x, true))) }));
FUNCTIONS.coalesce = B('coalesce', (a) => new Column({ k: 'fn', f: 'coalesce', args: a.map(x => colX(x, true)) }));
FUNCTIONS.substring = B('substring', (a) => new Column({ k: 'fn', f: 'substring', args: [colX(a[0], true), { k: 'lit', v: a[1] }, { k: 'lit', v: a[2] }] }));
FUNCTIONS.column = FUNCTIONS.col; FUNCTIONS.count_distinct = FUNCTIONS.countDistinct;
const typeCtor = (t) => new PyClassRef(SPARK_TYPES[t][0], () => new DType(t));
const TYPES_MOD = { StructType: new PyClassRef('StructType', (a) => new StructType(a[0] ? iterate(a[0]).slice() : [])), StructField: new PyClassRef('StructField', (a, kw) => { const name = a[0] !== undefined ? a[0] : kw.name; const dt = a[1] !== undefined ? a[1] : kw.dataType; if (!(dt instanceof DType)) err('pyspark.errors.exceptions.base.PySparkTypeError', `[NOT_DATATYPE] Argument \`dataType\` should be a DataType, got ${typeName(dt)}.` + (dt instanceof PyClassRef ? '  (add brackets: IntegerType())' : '')); return new StructField(name, dt.t, a[2] !== undefined ? truthy(a[2]) : kw.nullable === undefined ? true : truthy(kw.nullable)); }) };
for (const t of Object.keys(SPARK_TYPES)) TYPES_MOD[SPARK_TYPES[t][0]] = typeCtor(t);
const ROW = new PyClassRef('Row', (a, kw) => { if (a.length && !Object.keys(kw).length) { const names = a.slice(); return new PyClassRef('Row', (b) => new Row(names, b)); } return new Row(Object.keys(kw), Object.values(kw)); });
const SPARKSESSION = new PyClassRef('SparkSession', () => err('TypeError', 'Use SparkSession.builder.appName("...").getOrCreate()'), { builder: () => new Builder(() => CURRENT.session()) });
const MODULES = {
  'pyspark': () => ({ SparkContext: new PyClassRef('SparkContext', () => CURRENT.session().sc, { getOrCreate: () => B('getOrCreate', () => CURRENT.session().sc) }), SparkConf: new PyClassRef('SparkConf', () => ({ pyType: 'SparkConf', pyAttr: (n) => ['setAppName', 'setMaster', 'set'].includes(n) ? B(n, function () { return this; }.bind(null)) : undefined })) }),
  'pyspark.sql': () => ({ SparkSession: SPARKSESSION, Row: ROW, DataFrame: new PyClassRef('DataFrame', () => null), Column: new PyClassRef('Column', () => null) }),
  'pyspark.sql.functions': () => FUNCTIONS,
  'pyspark.sql.types': () => TYPES_MOD,
  'operator': () => ({ add: B('add', (a) => CURRENT.binop('+', a[0], a[1])), mul: B('mul', (a) => CURRENT.binop('*', a[0], a[1])), sub: B('sub', (a) => CURRENT.binop('-', a[0], a[1])), itemgetter: B('itemgetter', (a) => B('itemgetter', (b) => getitem(b[0], a[0]))) }),
  'math': () => ({ sqrt: B('sqrt', (a) => F(Math.sqrt(num(a[0])))), floor: B('floor', (a) => Math.floor(num(a[0]))), ceil: B('ceil', (a) => Math.ceil(num(a[0]))), pi: F(Math.PI), pow: B('pow', (a) => F(Math.pow(num(a[0]), num(a[1])))) }),
  'sys': () => ({ argv: ['app.py'], version: '3.10.12 (main, Mar 22 2024, 16:50:05) [GCC 11.4.0]', exit: B('exit', () => { throw new ExitSig(); }) }),
  'os': () => ({ getcwd: B('getcwd', () => CURRENT.m.cwd), environ: (() => { const d = new PyDict(); return d; })() }),
  'findspark': () => ({ init: B('init', () => null) }),
};
const MOD_CACHE = {};
function getModule(name) {
  if (MOD_CACHE[name]) return MOD_CACHE[name];
  if (!MODULES[name]) { if (/^(pandas|numpy|matplotlib|sklearn)/.test(name)) err('ModuleNotFoundError', `No module named '${name.split('.')[0]}'  (not installed in this lab)`); err('ModuleNotFoundError', `No module named '${name}'`); }
  const attrs = MODULES[name]();
  for (const k of Object.keys(MODULES)) if (k.startsWith(name + '.') && !k.slice(name.length + 1).includes('.')) { const sub = k.slice(name.length + 1); if (!(sub in attrs)) Object.defineProperty(attrs, sub, { get: () => getModule(k), enumerable: false }); }
  return (MOD_CACHE[name] = new PyModule(name, attrs));
}
class ExitSig {}

/* ================= shell & submit ================= */
class PySession extends Interp {
  constructor(m, out) { super(m, out); this._spark = null; }
  session() { if (!this._spark) this._spark = new SparkSession(this.m, this); return this._spark; }
  run(src, interactive) { CURRENT = this; return super.run(src, interactive); }
}
function traceback(e, file) {
  const lines = ['Traceback (most recent call last):', `  File "${file || '<stdin>'}", line ${(e.extra && e.extra.line) || 1}, in <module>`];
  if (/pyspark|py4j|org\.apache/.test(e.pytype)) lines.push('  File "/usr/local/spark/python/pyspark/errors/exceptions/captured.py", line 185, in deco', '    raise converted from None');
  if (e.pytype === 'org.apache.spark.api.python.PythonException') { return lines.concat(['py4j.protocol.Py4JJavaError: An error occurred while calling z:org.apache.spark.api.python.PythonRDD.collectAndServe.', ': org.apache.spark.SparkException: Job aborted due to stage failure: Task 0 in stage 0.0 failed 1 times, most recent failure: Lost task 0.0 in stage 0.0 (TID 0) (gls-university executor driver): org.apache.spark.api.python.PythonException: Traceback (most recent call last):' + e.message.replace(/\n$/, '')]).join('\n'); }
  if (e.pytype === 'SyntaxError' || e.pytype === 'IndentationError') return `  File "${file || '<stdin>'}", line ${(e.extra && e.extra.line) || 1}\n${e.pytype}: ${e.message}`;
  return lines.concat([`${e.pytype}: ${e.message}`]).join('\n');
}
function banner(m) {
  return `Python 3.10.12 (main, Mar 22 2024, 16:50:05) [GCC 11.4.0] on linux
Type "help", "copyright", "credits" or "license" for more information.
Setting default log level to "WARN".
To adjust logging level use sc.setLogLevel(newLevel). For SparkR, use setLogLevel(newLevel).
26/10/13 23:40:12 WARN NativeCodeLoader: Unable to load native-hadoop library for your platform... using builtin-java classes where applicable
Welcome to
      ____              __
     / __/__  ___ _____/ /__
    _\\ \\/ _ \\/ _ \`/ __/  '_/
   /__ / .__/\\_,_/_/ /_/\\_\\   version 3.5.1
      /_/

Using Python version 3.10.12 (main, Mar 22 2024 16:50:05)
Spark context Web UI available at http://gls-university:4040
Spark context available as 'sc' (master = local[*], app id = local-${Date.now()}).
SparkSession available as 'spark'.`;
}
function startShell(m, args, io) {
  const out = (s, c) => m.out(s, c);
  const sess = new PySession(m, out);
  sess.onShow = (s) => m.event({ kind: 'py', type: 'show', show: s });
  const spark = sess.session();
  sess.globals.set('spark', spark); sess.globals.set('sc', spark.sc); sess.globals.set('SparkSession', SPARKSESSION); sess.globals.set('sqlContext', spark);
  const quit = () => { throw new ExitSig(); };
  sess.globals.set('exit', B('exit', quit)); sess.globals.set('quit', B('quit', quit));
  out(banner(m).replace('26/10/13 23:40:12', new Date().toISOString().slice(2, 10).replace(/-/g, '/') + ' ' + new Date().toTimeString().slice(0, 8)), 'dim');
  let buf = [];
  const mode = {
    name: 'pyspark', sess,
    cancel() { buf = []; out('KeyboardInterrupt'); },
    eof() { m.modes.pop(); m.event({ kind: 'py', type: 'exit' }); },
    prompt: () => (buf.length ? { sym: '... ' } : { sym: '>>> ' }),
    async feed(line) {
      if (!buf.length && !line.trim()) return;
      if (/^(exit|quit)$/.test(line.trim()) && !buf.length) { out('Use exit() or Ctrl-D (i.e. EOF) to exit'); return; }
      buf.push(line);
      const src = buf.join('\n');
      let more = false;
      try { more = needsMore(src); } catch (e) { more = false; }
      if (more) return;
      buf = [];
      m.history.push(src.replace(/\n/g, ' '));
      try { sess.run(src, true); m.event({ kind: 'py', type: 'run', src }); }
      catch (e) {
        if (e instanceof ExitSig) { m.modes.pop(); m.event({ kind: 'py', type: 'exit' }); return; }
        if (e instanceof PyErr) { out(traceback(e), 'err'); m.event({ kind: 'py', type: 'error', src, error: e.pytype }); if (e.message.includes('Connection refused')) out('(HDFS is not running. Type exit() then run start-dfs.sh)', 'hint'); }
        else { out('Internal simulator error: ' + (e && e.message), 'err'); if (G.__SIM_DEBUG) console.error(e); }
      }
    },
  };
  m.modes.push(mode);
  m.event({ kind: 'py', type: 'start' });
  return 0;
}
async function submit(m, args, io) {
  const file = args.find(a => a.endsWith('.py'));
  if (!file) { io.error('Error: Must specify a primary resource (JAR or Python or R file)\nRun with --help for usage help or --verbose for debug output'); return 1; }
  const p = m.local.norm(file, m.cwd); const src = m.local.read(p);
  if (src === null) { io.error(`python3: can't open file '${p}': [Errno 2] No such file or directory`); return 2; }
  const out = (s, c) => io.print(s);
  const sess = new PySession(m, out);
  sess.onShow = (s) => m.event({ kind: 'py', type: 'show', show: s });
  const t = () => new Date().toISOString().slice(2, 10).replace(/-/g, '/') + ' ' + new Date().toTimeString().slice(0, 8);
  m.out(`${t()} WARN NativeCodeLoader: Unable to load native-hadoop library for your platform... using builtin-java classes where applicable\n${t()} INFO SparkContext: Running Spark version 3.5.1\n${t()} INFO SparkContext: Submitted application: ${file.replace(/^.*\//, '')}`, 'dim');
  await m.sleep(300);
  let code = 0;
  try { sess.run(src, false); }
  catch (e) { if (e instanceof ExitSig) {} else if (e instanceof PyErr) { m.out(traceback(e, p), 'err'); code = 1; } else { m.out('Internal simulator error: ' + (e && e.message), 'err'); if (G.__SIM_DEBUG) console.error(e); code = 1; } }
  m.out(`${t()} INFO SparkContext: Successfully stopped SparkContext\n${t()} INFO ShutdownHookManager: Shutdown hook called`, 'dim');
  m.event({ kind: 'py', type: 'submit', file, code });
  return code;
}
// evaluate reference code in a fresh session (for practice checks)
function referenceRun(m, setup, code) {
  const shows = []; const sess = new PySession(m, () => {}); sess.onShow = (s) => shows.push(s);
  const spark = sess.session(); sess.globals.set('spark', spark); sess.globals.set('sc', spark.sc);
  sess.run(setup, false); sess.run(code, false);
  return shows;
}

G.PY = { startShell, submit, Interp, PySession, parseProgram, repr, referenceRun, needsMore };
})(typeof window !== 'undefined' ? window : globalThis);
