/* ===== MapReduce: built-in examples, javac/jar, Java job runner ===== */
(function (G) {
'use strict';
const { NN, EXAMPLES_JAR, byteLen } = G.SIM;
const jd = (v) => G.javaDouble(v);

/* ---------- Java runtime shims ---------- */
class JavaException extends Error { constructor(cls, msg) { super(msg); this.jcls = cls; } }
class Writable { toString() { return String(this.v); } get() { return this.v; } set(x) { this.v = this.norm(x instanceof Writable ? x.get() : x); } norm(x) { return x; } equals(o) { return o instanceof Writable && o.v === this.v; } hashCode() { return 0; } compareTo(o) { return this.v < o.v ? -1 : this.v > o.v ? 1 : 0; } }
class Text extends Writable { constructor(x) { super(); this.v = x === undefined ? '' : String(x instanceof Writable ? x.toString() : x); } norm(x) { return String(x); } toString() { return this.v; } getLength() { return byteLen(this.v); } get() { throw new JavaException('error', 'cannot find symbol: method get() — Text has no get(); use toString()'); } }
const toInt = (x) => { const n = Number(x); return n < 0 ? Math.ceil(n) : Math.floor(n); };
class IntWritable extends Writable { constructor(x) { super(); this.v = x === undefined ? 0 : toInt(x instanceof Writable ? x.get() : x); } norm(x) { return toInt(x); } }
class LongWritable extends IntWritable {}
class DoubleWritable extends Writable { constructor(x) { super(); this.v = x === undefined ? 0 : Number(x instanceof Writable ? x.get() : x); } norm(x) { return Number(x); } toString() { return jd(this.v); } }
class FloatWritable extends DoubleWritable { toString() { return jd(Math.fround(this.v)); } }
class BooleanWritable extends Writable { constructor(x) { super(); this.v = !!x; } }
class NullWritableC extends Writable { constructor() { super(); this.v = null; } toString() { return '(null)'; } }
const NULLW = new NullWritableC();
const NullWritable = { get: () => NULLW };
const WCLS = { Text, IntWritable, LongWritable, DoubleWritable, FloatWritable, BooleanWritable, NullWritable: NullWritableC };
function javaParseInt(s) { const t = String(s); if (!/^[-+]?\d+$/.test(t)) throw new JavaException('java.lang.NumberFormatException', `For input string: "${t}"` + (s === undefined || s === null ? '' : '')); const n = parseInt(t, 10); if (n > 2147483647 || n < -2147483648) throw new JavaException('java.lang.NumberFormatException', `For input string: "${t}"`); return n; }
function javaParseDouble(s) { const t = String(s).trim(); if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?[dDfF]?$/.test(t)) throw new JavaException('java.lang.NumberFormatException', t === '' ? 'empty String' : `For input string: "${t}"`); return parseFloat(t); }
const Integer = { parseInt: (s) => javaParseInt(s), valueOf: (s) => typeof s === 'number' ? s : javaParseInt(s), toString: (x) => String(x), MAX_VALUE: 2147483647, MIN_VALUE: -2147483648, compare: (a, b) => a - b };
const Long = { parseLong: (s) => javaParseInt(s), valueOf: (s) => typeof s === 'number' ? s : javaParseInt(s), toString: (x) => String(x), MAX_VALUE: Number.MAX_SAFE_INTEGER, MIN_VALUE: Number.MIN_SAFE_INTEGER };
const Double = { parseDouble: javaParseDouble, valueOf: (s) => typeof s === 'number' ? s : javaParseDouble(s), toString: (x) => jd(x), MAX_VALUE: Number.MAX_VALUE, MIN_VALUE: Number.MIN_VALUE, compare: (a, b) => a - b };
const Float = { parseFloat: javaParseDouble, valueOf: javaParseDouble, MAX_VALUE: 3.4028235e38 };
const JString = { valueOf: (x) => (x instanceof Writable ? x.toString() : typeof x === 'number' && !Number.isInteger(x) ? jd(x) : String(x)), format: (f, ...a) => { let i = 0; return f.replace(/%(\.\d+)?[dsf]/g, (mm, p) => { const v = a[i++]; return mm.endsWith('f') ? Number(v).toFixed(p ? +p.slice(1) : 6) : String(v); }); }, join: (sep, arr) => Array.from(arr).join(sep) };
class StringTokenizer { constructor(s, d) { this.t = String(s).split(new RegExp('[' + (d === undefined ? ' \\t\\n\\r\\f' : d.replace(/[\]\\^-]/g, '\\$&')) + ']+')).filter(x => x.length); this.i = 0; } hasMoreTokens() { return this.i < this.t.length; } nextToken() { if (this.i >= this.t.length) throw new JavaException('java.util.NoSuchElementException', ''); return this.t[this.i++]; } countTokens() { return this.t.length - this.i; } hasMoreElements() { return this.hasMoreTokens(); } nextElement() { return this.nextToken(); } }
class ArrayList { constructor() { this.a = []; } add(x) { this.a.push(x); return true; } get(i) { if (i >= this.a.length) throw new JavaException('java.lang.IndexOutOfBoundsException', `Index ${i} out of bounds for length ${this.a.length}`); return this.a[i]; } size() { return this.a.length; } isEmpty() { return !this.a.length; } clear() { this.a = []; } contains(x) { return this.a.some(y => y === x || (y && y.equals && y.equals(x))); } iterator() { return iter(this.a); } [Symbol.iterator]() { return this.a[Symbol.iterator](); } }
class HashMap { constructor() { this.m = new Map(); } put(k, v) { this.m.set(String(k), [k, v]); } get(k) { const e = this.m.get(String(k)); return e ? e[1] : null; } containsKey(k) { return this.m.has(String(k)); } getOrDefault(k, d) { return this.containsKey(k) ? this.get(k) : d; } size() { return this.m.size; } keySet() { return arr([...this.m.values()].map(e => e[0])); } values() { return arr([...this.m.values()].map(e => e[1])); } entrySet() { return arr([...this.m.values()].map(e => ({ getKey: () => e[0], getValue: () => e[1] }))); } }
class TreeMap extends HashMap { keySet() { return arr([...this.m.values()].map(e => e[0]).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))); } entrySet() { return arr([...this.m.values()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(e => ({ getKey: () => e[0], getValue: () => e[1] }))); } }
const Collections = { sort: (l) => l.a.sort((a, b) => (a && a.compareTo ? a.compareTo(b) : a < b ? -1 : a > b ? 1 : 0)), reverse: (l) => l.a.reverse() };
function iter(a) { let i = 0; return { hasNext: () => i < a.length, next: () => a[i++] }; }
function arr(a) { const o = new ArrayList(); o.a = a; return o; }
function jarr(a) { return new Proxy(a, { get(t, p) { if (typeof p === 'string' && /^-?\d+$/.test(p)) { const i = +p; if (i < 0 || i >= t.length) throw new JavaException('java.lang.ArrayIndexOutOfBoundsException', `Index ${i} out of bounds for length ${t.length}`); } return t[p]; } }); }
function jsplit(s, re, limit) {
  let r; try { r = new RegExp(re); } catch (e) { r = new RegExp(re.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); }
  let parts = String(s).split(r);
  if (s === '') parts = [''];
  if (!limit) { while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop(); if (parts.length === 1 && parts[0] === '' && s !== '') parts = []; }
  return jarr(parts);
}
const JS_STR = {
  equals(o) { return o !== null && o !== undefined && String(this) === (o instanceof Writable ? null : String(o)); },
  equalsIgnoreCase(o) { return o !== null && o !== undefined && String(this).toLowerCase() === String(o).toLowerCase(); },
  contains(x) { return String(this).includes(String(x)); }, isEmpty() { return this.length === 0; },
  compareTo(o) { const a = String(this), b = String(o); return a < b ? -1 : a > b ? 1 : 0; },
  matches(re) { return new RegExp('^(?:' + re + ')$').test(String(this)); },
  __split(re, lim) { return jsplit(String(this), re, lim); },
  __replaceAll(re, rep) { return String(this).replace(new RegExp(re, 'g'), rep.replace(/\$(\d)/g, '$$$1')); },
  __jreplace(a, b) { return String(this).split(String(a)).join(String(b)); },
};
function installShims() { for (const k in JS_STR) if (!String.prototype[k]) Object.defineProperty(String.prototype, k, { value: JS_STR[k], configurable: true, writable: true }); if (!Number.prototype.equals) Object.defineProperty(Number.prototype, 'equals', { value: function (o) { return Number(o) === Number(this); }, configurable: true }); if (!Number.prototype.compareTo) Object.defineProperty(Number.prototype, 'compareTo', { value: function (o) { return this - o; }, configurable: true }); if (!Number.prototype.intValue) Object.defineProperty(Number.prototype, 'intValue', { value: function () { return toInt(this); }, configurable: true }); if (!Number.prototype.doubleValue) Object.defineProperty(Number.prototype, 'doubleValue', { value: function () { return Number(this); }, configurable: true }); }
installShims();
const SysOut = { println: () => {}, print: () => {}, printf: () => {} };
const System = { out: SysOut, err: SysOut, exit: () => {}, currentTimeMillis: () => Date.now() };
const MathJ = Object.assign(Object.create(Math), { round: (x) => Math.round(x) });

/* ---------- Java source analysis ---------- */
const PKG = { Text: 'org.apache.hadoop.io', IntWritable: 'org.apache.hadoop.io', LongWritable: 'org.apache.hadoop.io', DoubleWritable: 'org.apache.hadoop.io', FloatWritable: 'org.apache.hadoop.io', NullWritable: 'org.apache.hadoop.io', BooleanWritable: 'org.apache.hadoop.io', Mapper: 'org.apache.hadoop.mapreduce', Reducer: 'org.apache.hadoop.mapreduce', Job: 'org.apache.hadoop.mapreduce', Configuration: 'org.apache.hadoop.conf', Path: 'org.apache.hadoop.fs', FileInputFormat: 'org.apache.hadoop.mapreduce.lib.input', FileOutputFormat: 'org.apache.hadoop.mapreduce.lib.output', IOException: 'java.io', StringTokenizer: 'java.util', ArrayList: 'java.util', HashMap: 'java.util', TreeMap: 'java.util', List: 'java.util', Map: 'java.util', Iterator: 'java.util', Collections: 'java.util' };
function stripComments(src) { return src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length)); }
function matchBrace(s, i) { let d = 0, q = null; for (; i < s.length; i++) { const c = s[i]; if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; } if (c === '"' || c === "'") { q = c; continue; } if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return i; } } return -1; }
function lineOf(src, idx) { return src.slice(0, idx).split('\n').length; }

function analyzeFile(fileName, srcRaw, hasHadoopCp) {
  const src = stripComments(srcRaw);
  const errs = [];
  const pkg = (src.match(/^\s*package\s+([\w.]+)\s*;/m) || [])[1] || '';
  const imports = [...src.matchAll(/^\s*import\s+(static\s+)?([\w.]+(?:\.\*)?)\s*;/gm)].map(m => m[2]);
  // braces / parens balance
  let bal = 0, pbal = 0; { let q = null; for (let i = 0; i < src.length; i++) { const c = src[i]; if (q) { if (c === '\\') { i++; continue; } if (c === q || c === '\n') q = null; continue; } if (c === '"' || c === "'") q = c; else if (c === '{') bal++; else if (c === '}') bal--; else if (c === '(') pbal++; else if (c === ')') pbal--; } }
  if (bal > 0) errs.push(`${fileName}:${src.split('\n').length}: error: reached end of file while parsing`);
  if (bal < 0) errs.push(`${fileName}:${src.split('\n').length}: error: class, interface, enum, or record expected`);
  if (pbal !== 0) errs.push(`${fileName}: error: ')' expected`);
  // hadoop classpath
  if (!hasHadoopCp && imports.some(i => i.startsWith('org.apache.hadoop'))) {
    const pk = [...new Set(imports.filter(i => i.startsWith('org.apache.hadoop')).map(i => i.replace(/\.[A-Z*][\w*]*$/, '')))];
    pk.forEach(p => { const idx = srcRaw.indexOf(p); errs.push(`${fileName}:${lineOf(srcRaw, idx)}: error: package ${p} does not exist\nimport ${imports.find(i => i.startsWith(p))};\n       ${' '.repeat(p.length)}^`); });
  }
  // classes
  const classes = [];
  const re = /\b(public\s+|private\s+|protected\s+)?(static\s+)?(final\s+)?class\s+(\w+)(?:\s+extends\s+([\w.]+)\s*(?:<([^{]*)>)?)?[^{]*\{/g; let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf('{', m.index + m[0].length - 1); const close = matchBrace(src, open);
    classes.push({ name: m[4], isPublic: !!m[1] && m[1].trim() === 'public', nested: false, ext: m[5] ? m[5].split('.').pop() : null, generics: m[6] ? m[6].split(',').map(x => x.trim().split('.').pop()) : [], body: src.slice(open + 1, close), start: m.index });
  }
  classes.forEach(c => { c.nested = classes.some(o => o !== c && o.start < c.start && src.indexOf(o.body) <= c.start && c.start < src.indexOf(o.body) + o.body.length); });
  const top = classes.filter(c => !c.nested);
  const pub = top.filter(c => c.isPublic);
  const base = fileName.replace(/^.*\//, '').replace(/\.java$/, '');
  pub.forEach(c => { if (c.name !== base) { const ln = lineOf(srcRaw, srcRaw.indexOf('class ' + c.name)); const txt = srcRaw.split('\n')[ln - 1]; errs.push(`${fileName}:${ln}: error: class ${c.name} is public, should be declared in a file named ${c.name}.java\n${txt}\n${' '.repeat(Math.max(0, txt.indexOf('class')))}^`); } });
  if (!classes.length) errs.push(`${fileName}:1: error: class, interface, enum, or record expected`);
  // missing imports
  const used = new Set(); for (const k of Object.keys(PKG)) { if (new RegExp('\\b' + k + '\\b').test(src.replace(/^\s*import.*$/gm, '').replace(/"(?:\\.|[^"])*"/g, '""'))) used.add(k); }
  for (const k of used) {
    if (classes.some(c => c.name === k)) continue;
    const ok = imports.includes(PKG[k] + '.' + k) || imports.includes(PKG[k] + '.*') || (PKG[k] === 'java.lang');
    if (!ok) { const idx = src.search(new RegExp('\\b' + k + '\\b(?![^\\n]*import)')); errs.push(`${fileName}:${lineOf(srcRaw, idx)}: error: cannot find symbol\n  symbol:   class ${k}\n  location: class ${(classes.find(c => src.indexOf(c.body) <= idx && idx <= src.indexOf(c.body) + c.body.length) || classes[0] || { name: base }).name}`); }
  }
  // simple statement checks: missing semicolon on lines inside methods
  const srcLines = src.split('\n'); let depth = 0;
  srcLines.forEach((line, i) => {
    const t = line.trim();
    const startDepth = depth;
    for (const ch of line.replace(/"(?:\\.|[^"])*"/g, '""')) { if (ch === '(') depth++; else if (ch === ')') depth--; }
    if (startDepth > 0 || depth > 0) return;
    const nxt = srcLines.slice(i + 1).find(x => x.trim());
    if (nxt && /^\s*(throws|extends|implements)\b/.test(nxt)) return;
    if (!t || /[;{}]$/.test(t) || /^(@|import|package|public|private|protected|class|static|for|if|else|while|try|catch|finally|do|switch|case|default)/.test(t) || /[,(&|+\-*/=?:]$/.test(t) || /^[.)&|+\-*/?:]/.test(t)) return;
    const next = src.split('\n').slice(i + 1).find(x => x.trim());
    if (next && /^\s*[.)+\-*/&|?:{]/.test(next)) return;
    if (/^[\w\]\[<>.]+\s+\w+\s*(=.*)?$/.test(t) || /\)\s*$/.test(t) && !/^(if|for|while|catch)\b/.test(t) && !/\b(throws|class)\b/.test(t) && !/^\w[\w<>,\s]*\s+\w+\s*\([^)]*\)$/.test(t) || /^(return|break|continue)\b/.test(t) || /=\s*[^=].*[\w")\]]$/.test(t)) errs.push(`${fileName}:${i + 1}: error: ';' expected\n${line.replace(/^\s+/, '        ')}\n${' '.repeat(8 + t.length)}^`);
  });
  // compile each class's methods to JS to catch the rest
  const compiled = [];
  const before = errs.length;
  for (const c of classes) {
    const cc = compileClass(c, fileName);
    if (cc.error) { if (errs.length === before) errs.push(cc.error); } else compiled.push(cc);
  }
  return { errs, pkg, classes: compiled };
}

function extractMethods(body) {
  const methods = {}; const fields = []; let i = 0; let rest = '';
  const re = /(?:@\w+\s*)*(?:(?:public|protected|private|static|final|synchronized)\s+)*([\w<>\[\],.? ]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/g; let m;
  while ((m = re.exec(body))) {
    if (m.index < i) continue;
    if (/^(if|for|while|switch|catch|new|return|else)$/.test(m[2]) || /\b(new|return)\b/.test(m[1])) continue;
    const open = body.indexOf('{', m.index + m[0].length - 1); const close = matchBrace(body, open);
    if (close < 0) break;
    rest += body.slice(i, m.index);
    methods[m[2]] = { ret: m[1].trim(), params: m[3].split(',').map(p => p.trim()).filter(Boolean).map(p => { const parts = p.replace(/\bfinal\s+/, '').split(/\s+/); return { type: parts.slice(0, -1).join(' '), name: parts[parts.length - 1] }; }), body: body.slice(open + 1, close) };
    i = close + 1; re.lastIndex = close + 1;
  }
  rest += body.slice(i);
  // fields: statements left over (exclude nested class bodies)
  let r2 = rest; let cm; const cre = /\bclass\s+\w+[^{]*\{/g;
  while ((cm = cre.exec(r2))) { const open = r2.indexOf('{', cm.index + cm[0].length - 1); const close = matchBrace(r2, open); r2 = r2.slice(0, cm.index) + r2.slice(close + 1); cre.lastIndex = cm.index; }
  r2.split(';').map(s => s.replace(/@\w+/g, '').trim()).filter(s => s && !/^(public|private|protected|static|final)?\s*$/.test(s)).forEach(s => fields.push(s + ';'));
  return { methods, fields };
}
const PRIM_INT = /^(int|long|short|byte|Integer|Long)$/;
function transpile(code, intVars) {
  let s = code;
  s = s.replace(/@\w+/g, '');
  s = s.replace(/\bfinal\s+/g, '');
  // catch clauses
  s = s.replace(/catch\s*\(\s*[\w.]+(?:\s*\|\s*[\w.]+)*\s+(\w+)\s*\)/g, 'catch ($1)');
  // declarations (track int vars)
  s = s.replace(/(^|[;{}(]\s*|\n\s*)((?:[A-Z][\w.]*(?:\s*<[^;=()]*?>)?|int|long|double|float|boolean|char|short|byte|var)(?:\s*\[\s*\])*)\s+([a-zA-Z_]\w*)(\s*(?:=|;|:|,))/g, (mm, pre, type, name, after) => {
    if (/^(return|new|throw|else|case)$/.test(type)) return mm;
    if (PRIM_INT.test(type.trim())) intVars.add(name);
    return `${pre}let ${name}${after}`;
  });
  // for-each
  s = s.replace(/for\s*\(\s*let\s+(\w+)\s*:\s*([^)]+)\)/g, 'for (let $1 of $2)');
  // int division: a / b with both int vars or int literals, unless a cast precedes
  s = s.replace(/(\(\s*(?:double|float)\s*\)\s*)?\b([a-zA-Z_]\w*|\d+)\s*\/\s*([a-zA-Z_]\w*|\d+)\b(?!\s*\.)/g, (mm, cast, a, b) => {
    const isInt = (x) => /^\d+$/.test(x) || intVars.has(x);
    if (cast || !isInt(a) || !isInt(b)) return mm;
    return `__idiv(${a}, ${b})`;
  });
  // int assignments
  s = s.replace(/\blet\s+(\w+)\s*=\s*([^;]+);/g, (mm, n, e) => intVars.has(n) && /[/*+\-.]/.test(e) ? `let ${n} = __i(${e});` : mm);
  // casts
  s = s.replace(/\(\s*(int|long|short|byte)\s*\)\s*([\w.]+(?:\([^()]*\))?|\([^()]*\))/g, '__i($2)');
  s = s.replace(/\(\s*(double|float|String|Text|IntWritable)\s*\)\s*/g, '');
  // strings & arrays
  s = s.replace(/\.length\s*\(\s*\)/g, '.length');
  s = s.replace(/\.split\s*\(/g, '.__split(');
  s = s.replace(/\.replaceAll\s*\(/g, '.__replaceAll(');
  s = s.replace(/\.replace\s*\(/g, '.__jreplace(');
  s = s.replace(/\bString\.valueOf\b/g, 'JString.valueOf').replace(/\bString\.format\b/g, 'JString.format').replace(/\bString\.join\b/g, 'JString.join');
  s = s.replace(/\bMath\./g, 'MathJ.');
  s = s.replace(/new\s+(\w+)\s*<[^>]*>\s*\(/g, 'new $1(');
  s = s.replace(/new\s+(int|long|double|String)\s*\[\s*(\w+)\s*\]/g, 'new Array($2).fill(0)');
  s = s.replace(/\binstanceof\s+String\b/g, "=== 'string'");
  return s;
}
function compileClass(c, fileName) {
  const { methods, fields } = extractMethods(c.body);
  const out = { name: c.name, ext: c.ext, generics: c.generics, fields: [], methods: {}, isMain: !!(methods.main), file: fileName };
  const intVars = new Set();
  try {
    out.fieldJs = transpile(fields.join('\n').replace(/\b(public|private|protected|static)\s+/g, ''), intVars);
    new Function(...SCOPE_NAMES, out.fieldJs);
    for (const [name, mt] of Object.entries(methods)) {
      if (name === 'main') { out.mainSrc = mt.body; continue; }
      const iv = new Set(intVars); mt.params.forEach(p => { if (PRIM_INT.test(p.type)) iv.add(p.name); });
      const js = transpile(mt.body, iv);
      new Function(...SCOPE_NAMES, ...mt.params.map(p => p.name), js);
      out.methods[name] = { params: mt.params.map(p => p.name), ptypes: mt.params.map(p => p.type), js };
    }
  } catch (e) {
    const msg = String(e.message || e);
    return { error: `${fileName}: error: ${msg.includes('Unexpected') || msg.includes('missing') || msg.includes('Invalid') ? 'illegal start of expression or missing symbol (' + msg + ')' : msg}\n  in class ${c.name} — check brackets, semicolons and variable names.` };
  }
  return out;
}
const SCOPE_NAMES = ['Text', 'IntWritable', 'LongWritable', 'DoubleWritable', 'FloatWritable', 'BooleanWritable', 'NullWritable', 'Integer', 'Long', 'Double', 'Float', 'JString', 'StringTokenizer', 'ArrayList', 'HashMap', 'TreeMap', 'Collections', 'System', 'MathJ', '__i', '__idiv', 'NumberFormatException', 'Exception', '__ctx'];
const SCOPE_VALS = () => [Text, IntWritable, LongWritable, DoubleWritable, FloatWritable, BooleanWritable, NullWritable, Integer, Long, Double, Float, JString, StringTokenizer, ArrayList, HashMap, TreeMap, Collections, System, MathJ, toInt, (a, b) => { if (b === 0) throw new JavaException('java.lang.ArithmeticException', '/ by zero'); return toInt(a / b); }, JavaException, JavaException, null];

function instantiate(cls) {
  const inst = {};
  const fieldNames = [...cls.fieldJs.matchAll(/\blet\s+(\w+)/g)].map(m => m[1]);
  const vals = SCOPE_VALS();
  const init = new Function(...SCOPE_NAMES, cls.fieldJs + `\nreturn {${fieldNames.map(n => `get ${n}(){return ${n}}, set ${n}(v){${n}=v}`).join(',')}};`);
  const state = init(...vals);
  // methods share the field closure through a with-like proxy
  for (const [name, mt] of Object.entries(cls.methods)) {
    const fn = new Function('__state', ...SCOPE_NAMES, ...mt.params, `with (__state) {\n${mt.js}\n}`);
    inst[name] = (...args) => fn(state, ...vals, ...args);
  }
  return inst;
}

/* ---------- javac / jar ---------- */
function javac(m, args, io) {
  let cp = null, outDir = null; const files = [];
  for (let i = 0; i < args.length; i++) { const a = args[i]; if (a === '-classpath' || a === '-cp') cp = args[++i]; else if (a === '-d') outDir = args[++i]; else if (a === '-version') { io.print('javac 1.8.0_402'); return 0; } else if (a.startsWith('-')) {} else files.push(a); }
  if (!files.length) { io.error('error: no source files'); return 2; }
  if (outDir !== null && !m.local.isDir(m.local.norm(outDir, m.cwd))) { io.error(`javac: directory not found: ${outDir}\nUsage: javac <options> <source files>`); return 2; }
  const hasCp = !!cp && /hadoop/.test(cp);
  let errs = []; const allClasses = [];
  for (const f of files) {
    const p = m.local.norm(f, m.cwd); const src = m.local.read(p);
    if (src === null) { io.error(`error: file not found: ${f}\nUsage: javac <options> <source files>`); return 2; }
    if (!f.endsWith('.java')) { io.error(`error: Class names, '${f}', are only accepted if annotation processing is explicitly requested`); return 2; }
    const r = analyzeFile(f, src, hasCp);
    errs = errs.concat(r.errs);
    r.classes.forEach(c => allClasses.push(Object.assign(c, { pkg: r.pkg })));
  }
  // cross-file references (setMapperClass etc)
  const names = new Set(allClasses.map(c => c.name));
  for (const c of allClasses) if (c.mainSrc) { for (const mm of c.mainSrc.matchAll(/set(?:Mapper|Reducer|Combiner|JarBy)Class\s*\(\s*(\w+)\.class/g)) if (!names.has(mm[1]) && !existingClass(m, outDir, mm[1])) errs.push(`${c.file}: error: cannot find symbol\n  symbol:   class ${mm[1]}\n  location: class ${c.name}`); }
  if (errs.length) { io.error(errs.join('\n')); io.error(`${errs.length} error${errs.length > 1 ? 's' : ''}`); m.event({ kind: 'javac', ok: false }); return 1; }
  for (const c of allClasses) {
    const dir = m.local.norm((outDir || '.') + (c.pkg ? '/' + c.pkg.replace(/\./g, '/') : ''), m.cwd);
    m.local.mkdir(dir, true);
    m.local.write(dir + '/' + c.name + '.class', JSON.stringify({ javaClass: c }));
  }
  if (!hasCp && !allClasses.length) {}
  m.event({ kind: 'javac', ok: true, classes: allClasses.map(c => c.name) });
  return 0;
}
function existingClass(m, outDir, name) { const d = m.local.norm(outDir || '.', m.cwd); return m.local.exists(d + '/' + name + '.class'); }
function jar(m, args, io) {
  if (!args.length) { io.error('Usage: jar {ctxui}[vfmn0PMe] [jar-file] [manifest-file] [entry-point] [-C dir] files ...'); return 1; }
  const opts = args[0].replace(/^-/, ''); const rest = args.slice(1);
  if (opts.includes('t')) { const f = rest[0]; const d = m.local.read(m.local.norm(f, m.cwd)); if (d === null) { io.error(`java.io.FileNotFoundException: ${f} (No such file or directory)`); return 1; } if (d.startsWith('PK')) { io.print('META-INF/\nMETA-INF/MANIFEST.MF\norg/apache/hadoop/examples/WordCount.class\norg/apache/hadoop/examples/Grep.class\norg/apache/hadoop/examples/MultiFileWordCount.class\n...'); return 0; } const j = JSON.parse(d); io.print(['META-INF/', 'META-INF/MANIFEST.MF'].concat(Object.keys(j.classes).map(k => k + '.class')).join('\n')); return 0; }
  if (!opts.includes('c')) { io.error('jar: only the create (c) and list (t) modes are supported in this lab.'); return 1; }
  if (!opts.includes('f')) { io.error('jar: specify the jar file name with f, e.g.  jar -cvf MyJob.jar -C classes/ .'); return 1; }
  const jarName = rest[0]; if (!jarName || !jarName.endsWith('.jar')) { io.error(`jar: '${jarName || ''}' is not a .jar file name`); return 1; }
  const entries = []; // [display, absPath]
  for (let i = 1; i < rest.length; i++) {
    if (rest[i] === '-C') { const dir = m.local.norm(rest[i + 1], m.cwd); const what = rest[i + 2]; i += 2; if (!m.local.isDir(dir)) { io.error(`${rest[i - 1]} : no such file or directory`); return 1; } const base = what === '.' ? dir : m.local.norm(what, dir); const walk = (p, rel) => { if (m.local.isDir(p)) { for (const k of m.local.list(p)) walk(m.local.join(p, k), rel ? rel + '/' + k : k); } else entries.push([rel, p]); }; walk(base, what === '.' ? '' : what); continue; }
    const p = m.local.norm(rest[i], m.cwd);
    if (!m.local.exists(p)) { io.error(`${rest[i]} : no such file or directory`); return 1; }
    const walk = (pp, rel) => { if (m.local.isDir(pp)) { for (const k of m.local.list(pp)) walk(m.local.join(pp, k), rel + '/' + k); } else entries.push([rel, pp]); }; walk(p, rest[i]);
  }
  const classes = {}; const v = opts.includes('v');
  if (v) io.print('added manifest');
  for (const [rel, p] of entries) {
    const d = m.local.read(p) || ''; const size = byteLen(d);
    if (v) io.print(`adding: ${rel}(in = ${size}) (out= ${Math.round(size * 0.52)})(deflated 48%)`);
    if (rel.endsWith('.class')) { try { const c = JSON.parse(d).javaClass; classes[(c.pkg ? c.pkg + '.' : '') + c.name] = c; } catch (e) {} }
  }
  if (!Object.keys(classes).length) io.error('warning: the jar contains no compiled .class files. Compile with javac first.');
  m.local.write(m.local.norm(jarName, m.cwd), JSON.stringify({ jar: true, classes }));
  m.event({ kind: 'jar', name: jarName, classes: Object.keys(classes) });
  return 0;
}

/* ---------- job log ---------- */
function ts() { const d = new Date(); const t = (n, l = 2) => String(n).padStart(l, '0'); return `${d.getFullYear()}-${t(d.getMonth() + 1)}-${t(d.getDate())} ${t(d.getHours())}:${t(d.getMinutes())}:${t(d.getSeconds())},${t(d.getMilliseconds(), 3)}`; }
async function preflight(m, io, inputs, output) {
  if (!m.svc.dfs) { io.error(G.SIM.COMMANDS && `Exception in thread "main" java.net.ConnectException: Call From gls-university/127.0.1.1 to localhost:9000 failed on connection exception: java.net.ConnectException: Connection refused`); io.error('(HDFS is not running — start it with start-dfs.sh)'); return null; }
  io.print(`${ts()} INFO client.DefaultNoHARMFailoverProxyProvider: Connecting to ResourceManager at /0.0.0.0:8032`);
  if (!m.svc.yarn) {
    for (let i = 0; i < 3; i++) { await m.sleep(250); io.print(`${ts()} INFO ipc.Client: Retrying connect to server: 0.0.0.0/0.0.0.0:8032. Already tried ${i} time(s); retry policy is RetryUpToMaximumCountWithFixedSleep(maxRetries=10, sleepTime=1000 MILLISECONDS)`); }
    io.error('(YARN ResourceManager is not running — press Ctrl+C mentally, then run start-yarn.sh and check jps)'); return null;
  }
  const outAbs = m.hpath(output); if (outAbs.error) { io.error(`Exception in thread "main" java.lang.IllegalArgumentException: Wrong FS: ${output}, expected: ${NN}`); return null; }
  if (m.hdfs.exists(outAbs.path)) { io.error(`Exception in thread "main" org.apache.hadoop.mapred.FileAlreadyExistsException: Output directory ${NN}${outAbs.path} already exists\n\tat org.apache.hadoop.mapreduce.lib.output.FileOutputFormat.checkOutputSpecs(FileOutputFormat.java:164)\n\tat org.apache.hadoop.mapreduce.JobSubmitter.checkSpecs(JobSubmitter.java:277)`); io.error(`(Delete it first:  hdfs dfs -rm -r ${output}   or use a new output folder name)`, 'hint'); return null; }
  const files = [];
  for (const inp of inputs) {
    const r = m.hpath(inp); if (r.error) { io.error(`Exception in thread "main" java.lang.IllegalArgumentException: Wrong FS: ${inp}, expected: ${NN}`); return null; }
    const list = G.SIM.hasGlob(r.path) ? m.hdfs.glob(r.path, '/') : [r.path];
    if (!list.length || !m.hdfs.exists(list[0])) { io.error(`Exception in thread "main" org.apache.hadoop.mapreduce.lib.input.InvalidInputException: Input path does not exist: ${NN}${r.path}\n\tat org.apache.hadoop.mapreduce.lib.input.FileInputFormat.singleThreadedListStatus(FileInputFormat.java:340)`); return null; }
    for (const p of list) { if (m.hdfs.isDir(p)) m.hdfs.list(p).filter(k => !k.startsWith('_') && !k.startsWith('.') && m.hdfs.isFile(m.hdfs.join(p, k))).forEach(k => files.push(m.hdfs.join(p, k))); else files.push(p); }
  }
  const id = `${1760000000000 + (m.appSeq % 1000)}_${String(m.jobSeq).padStart(4, '0')}`; m.jobSeq++;
  io.print(`${ts()} INFO mapreduce.JobResourceUploader: Disabling Erasure Coding for path: /tmp/hadoop-yarn/staging/hadoop/.staging/job_${id}`);
  io.print(`${ts()} INFO input.FileInputFormat: Total input files to process : ${files.length}`);
  io.print(`${ts()} INFO mapreduce.JobSubmitter: number of splits:${Math.max(files.length, 1)}`);
  io.print(`${ts()} INFO mapreduce.JobSubmitter: Submitting tokens for job: job_${id}`);
  io.print(`${ts()} INFO impl.YarnClientImpl: Submitted application application_${id}`);
  io.print(`${ts()} INFO mapreduce.Job: The url to track the job: http://gls-university:8088/proxy/application_${id}/`);
  io.print(`${ts()} INFO mapreduce.Job: Running job: job_${id}`);
  await m.sleep(400);
  io.print(`${ts()} INFO mapreduce.Job: Job job_${id} running in uber mode : false`);
  io.print(`${ts()} INFO mapreduce.Job:  map 0% reduce 0%`);
  return { id, files, out: outAbs.path };
}
async function finish(m, io, job, res, reducers) {
  await m.sleep(450); io.print(`${ts()} INFO mapreduce.Job:  map 100% reduce 0%`);
  if (reducers) { await m.sleep(350); io.print(`${ts()} INFO mapreduce.Job:  map 100% reduce 100%`); }
  io.print(`${ts()} INFO mapreduce.Job: Job job_${job.id} completed successfully`);
  const c = res.counters;
  io.print(`${ts()} INFO mapreduce.Job: Counters: ${reducers ? 54 : 33}\n\tFile System Counters\n\t\tHDFS: Number of bytes read=${c.read + 118}\n\t\tHDFS: Number of bytes written=${c.written}\n\tJob Counters \n\t\tLaunched map tasks=${Math.max(job.files.length, 1)}\n${reducers ? '\t\tLaunched reduce tasks=' + reducers + '\n' : ''}\tMap-Reduce Framework\n\t\tMap input records=${c.mapIn}\n\t\tMap output records=${c.mapOut}${reducers ? `\n\t\tReduce input groups=${c.groups}\n\t\tReduce input records=${c.mapOut}\n\t\tReduce output records=${c.redOut}` : ''}\n\tFile Input Format Counters \n\t\tBytes Read=${c.read}\n\tFile Output Format Counters \n\t\tBytes Written=${c.written}`);
}
function writeOut(m, job, lines, suffix) { const text = lines.length ? lines.join('\n') + '\n' : ''; m.hdfs.mkdir(job.out, true); m.hdfs.write(job.out + '/_SUCCESS', ''); m.hdfs.write(job.out + '/part-' + suffix + '-00000', text); return byteLen(text); }
const jcmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/* ---------- built-in examples ---------- */
const EXAMPLES = `An example program must be given as the first argument.
Valid program names are:
  aggregatewordcount: An Aggregate based map/reduce program that counts the words in the input files.
  grep: A map/reduce program that counts the matches of a regex in the input.
  multifilewc: A job that counts words from several files.
  pi: A map/reduce program that estimates Pi using a quasi-Monte Carlo method.
  sort: A map/reduce program that sorts the data written by the random writer.
  wordcount: A map/reduce program that counts the words in the input files.
  wordmean: A map/reduce program that counts the average length of the words in the input files.`;
async function runExample(m, args, io) {
  const prog = args[0];
  if (!prog) { io.error(EXAMPLES); return 255; }
  const wcLike = async (label) => {
    if (args.length < 3) { io.error(label === 'wordcount' ? 'Usage: wordcount <in> [<in>...] <out>' : 'Usage: multifilewc <inputDir> <output>'); return 2; }
    const inputs = args.slice(1, -1), output = args[args.length - 1];
    const job = await preflight(m, io, inputs, output); if (!job) return 1;
    const counts = new Map(); let mapIn = 0, mapOut = 0, read = 0;
    for (const f of job.files) { const d = m.hdfs.read(f); read += byteLen(d); const lines = d.split('\n'); if (lines[lines.length - 1] === '') lines.pop(); mapIn += lines.length; for (const l of lines) for (const w of l.split(/[ \t\n\r\f]+/).filter(Boolean)) { counts.set(w, (counts.get(w) || 0) + 1); mapOut++; } }
    const keys = [...counts.keys()].sort(jcmp);
    const written = writeOut(m, job, keys.map(k => `${k}\t${counts.get(k)}`), 'r');
    await finish(m, io, job, { counters: { read, written, mapIn, mapOut, groups: keys.length, redOut: keys.length } }, 1);
    m.event({ kind: 'mr', prog: label, out: job.out });
    return 0;
  };
  if (prog === 'wordcount') return wcLike('wordcount');
  if (prog === 'multifilewc') return wcLike('multifilewc');
  if (prog === 'grep') {
    if (args.length < 4) { io.error('Grep <inDir> <outDir> <regex> [<group>]'); return 2; }
    const [, inp, output, regex, group] = args;
    const job = await preflight(m, io, [inp], output); if (!job) return 1;
    let re; try { re = new RegExp(regex, 'g'); } catch (e) { io.error(`Exception in thread "main" java.util.regex.PatternSyntaxException: ${e.message}`); return 1; }
    const counts = new Map(); let mapIn = 0, read = 0, mapOut = 0;
    for (const f of job.files) { const d = m.hdfs.read(f); read += byteLen(d); const lines = d.split('\n'); if (lines[lines.length - 1] === '') lines.pop(); mapIn += lines.length; for (const l of lines) { let mm; re.lastIndex = 0; while ((mm = re.exec(l))) { const k = mm[group ? +group : 0]; counts.set(k, (counts.get(k) || 0) + 1); mapOut++; if (mm[0] === '') re.lastIndex++; } } }
    const keys = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || jcmp(a, b));
    io.print(`${ts()} INFO mapreduce.Job: Job job_${job.id} completed successfully (grep-search)`);
    const written = writeOut(m, job, keys.map(k => `${counts.get(k)}\t${k}`), 'r');
    await finish(m, io, job, { counters: { read, written, mapIn, mapOut, groups: keys.length, redOut: keys.length } }, 1);
    m.event({ kind: 'mr', prog: 'grep', out: job.out });
    return 0;
  }
  if (prog === 'pi') {
    if (args.length < 3) { io.error('Usage: org.apache.hadoop.examples.QuasiMonteCarlo <nMaps> <nSamples>'); return 2; }
    if (!m.svc.dfs || !m.svc.yarn) { io.error('Start HDFS and YARN first (start-dfs.sh, start-yarn.sh).'); return 1; }
    io.print(`Number of Maps  = ${args[1]}\nSamples per Map = ${args[2]}\nStarting Job`); await m.sleep(600);
    const n = +args[1] * +args[2]; let inside = 0; for (let i = 1; i <= n; i++) { const x = halton(i, 2), y = halton(i, 3); if ((x - 0.5) ** 2 + (y - 0.5) ** 2 <= 0.25) inside++; }
    io.print(`Job Finished in 4.52 seconds\nEstimated value of Pi is ${(4 * inside / n).toFixed(20)}`); return 0;
  }
  io.error(`Unknown program '${prog}' chosen.\n${EXAMPLES}`); return 255;
}
function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

/* ---------- custom job runner ---------- */
async function runCustom(m, jarObj, args, io, jarPath) {
  const mainName = args[0];
  if (!mainName) { io.error('RunJar jarFile [mainClass] args...'); return 255; }
  const find = (n) => jarObj.classes[n] || Object.values(jarObj.classes).find(c => c.name === n || c.name === n.split('.').pop() && n.includes('.') === !!c.pkg);
  const main = find(mainName);
  if (!main) { io.error(`Exception in thread "main" java.lang.ClassNotFoundException: ${mainName}\n\tat java.net.URLClassLoader.findClass(URLClassLoader.java:387)\n\tat org.apache.hadoop.util.RunJar.run(RunJar.java:316)`); if (/^\//.test(mainName)) io.error('(The first argument after the jar must be the driver class name, e.g. EmployeeFilterDriver)'); return 1; }
  if (!main.isMain) { io.error(`Exception in thread "main" java.lang.NoSuchMethodException: ${mainName}.main([Ljava.lang.String;)\n(${mainName} has no main method — run the Driver class instead)`); return 1; }
  const src = main.mainSrc; const pargs = args.slice(1);
  const pick = (re) => { const mm = src.match(re); return mm ? mm[1] : null; };
  const pathOf = (expr) => { if (!expr) return null; let mm; if ((mm = expr.match(/args\s*\[\s*(\d+)\s*\]/))) { const i = +mm[1]; if (i >= pargs.length) throw new JavaException('java.lang.ArrayIndexOutOfBoundsException', `Index ${i} out of bounds for length ${pargs.length}`); return pargs[i]; } if ((mm = expr.match(/"([^"]*)"/))) return mm[1]; return null; };
  let inputs, output;
  try {
    inputs = [...src.matchAll(/FileInputFormat\s*\.\s*(?:add|set)InputPaths?\s*\(\s*\w+\s*,\s*([^;]+?)\)\s*;/g)].map(mm => pathOf(mm[1]));
    output = pathOf(pick(/FileOutputFormat\s*\.\s*setOutputPath\s*\(\s*\w+\s*,\s*([^;]+?)\)\s*;/));
  } catch (e) { io.error(`Exception in thread "main" ${e.jcls}: ${e.message}\n\tat ${main.name}.main(${main.name}.java)\n(Give the input and output paths: hadoop jar ${jarPath} ${mainName} <input> <output>)`); return 1; }
  if (!inputs.length || !output) { io.error('Exception in thread "main" java.io.IOException: No input paths specified in job / Output directory not set.'); return 1; }
  const mapperName = pick(/setMapperClass\s*\(\s*(\w+)\.class/), reducerName = pick(/setReducerClass\s*\(\s*(\w+)\.class/);
  const nRed = pick(/setNumReduceTasks\s*\(\s*(\d+)\s*\)/); const reducers = nRed === null ? 1 : +nRed;
  const outK = pick(/setOutputKeyClass\s*\(\s*(\w+)\.class/) || 'LongWritable', outV = pick(/setOutputValueClass\s*\(\s*(\w+)\.class/) || 'Text';
  const mapOutK = pick(/setMapOutputKeyClass\s*\(\s*(\w+)\.class/), mapOutV = pick(/setMapOutputValueClass\s*\(\s*(\w+)\.class/);
  const mapperCls = mapperName ? find(mapperName) : null; const reducerCls = reducerName ? find(reducerName) : null;
  if (mapperName && !mapperCls) { io.error(`Exception in thread "main" java.lang.NoClassDefFoundError: ${mapperName}\n(${mapperName}.class is not inside ${jarPath} — compile it and rebuild the jar)`); return 1; }
  if (reducerName && !reducerCls) { io.error(`Exception in thread "main" java.lang.NoClassDefFoundError: ${reducerName}\n(${reducerName}.class is not inside ${jarPath} — compile it and rebuild the jar)`); return 1; }
  if (mapperCls && mapperCls.ext !== 'Mapper') { io.error(`Exception in thread "main" java.lang.RuntimeException: class ${mapperName} not org.apache.hadoop.mapreduce.Mapper`); return 1; }
  if (reducerCls && reducerCls.ext !== 'Reducer') { io.error(`Exception in thread "main" java.lang.RuntimeException: class ${reducerName} not org.apache.hadoop.mapreduce.Reducer`); return 1; }
  const mkOut = mapOutK || (mapperCls && mapperCls.generics[2]) || outK, mvOut = mapOutV || (mapperCls && mapperCls.generics[3]) || outV;
  if (mapperCls && !mapOutK && mapperCls.generics[2] && mapperCls.generics[2] !== outK && reducers) {
    // Hadoop checks map output key type against job output key type
    io.print(`${ts()} INFO client.DefaultNoHARMFailoverProxyProvider: Connecting to ResourceManager at /0.0.0.0:8032`);
  }
  const job = await preflight(m, io, inputs, output); if (!job) return 1;
  const counters = { read: 0, written: 0, mapIn: 0, mapOut: 0, groups: 0, redOut: 0 };
  const emitted = [];
  const failTask = (e, phase) => {
    const cls = e instanceof JavaException ? e.jcls : e instanceof TypeError ? 'java.lang.NullPointerException' : 'java.lang.RuntimeException';
    let msg = e instanceof JavaException ? e.message : String(e.message || e);
    if (e instanceof TypeError) msg = msg.replace(/^Cannot read properties of (undefined|null).*$/, '').replace(/is not a function/, 'is not a method of this object');
    const where = phase === 'm' ? (mapperName || 'Mapper') + '.map' : (reducerName || 'Reducer') + '.reduce';
    for (let a = 0; a < 2; a++) io.print(`${ts()} INFO mapreduce.Job: Task Id : attempt_${job.id}_${phase}_000000_${a}, Status : FAILED\nError: ${cls}${msg ? ': ' + msg : ''}\n\tat ${where}(${where.split('.')[0]}.java)\n\tat org.apache.hadoop.mapred.${phase === 'm' ? 'MapTask.runNewMapper(MapTask.java:800)' : 'ReduceTask.runNewReducer(ReduceTask.java:628)'}`);
    io.print(`${ts()} INFO mapreduce.Job:  map ${phase === 'm' ? '100' : '100'}% reduce ${phase === 'm' ? '0' : '100'}%`);
    io.error(`${ts()} INFO mapreduce.Job: Job job_${job.id} failed with state FAILED due to: Task failed task_${job.id}_${phase}_000000\nJob failed as tasks failed. failedMaps:${phase === 'm' ? 1 : 0} failedReduces:${phase === 'r' ? 1 : 0} killedMaps:0 killedReduces: 0`);
    m.event({ kind: 'mr', prog: 'custom', failed: true });
    return 1;
  };
  const wrap = (cls, v) => { const C = WCLS[cls] || Text; if (C === NullWritableC) return NULLW; return new C(v); };
  const snap = (w) => (w === null || w === undefined || w === NULLW || w instanceof NullWritableC) ? { n: true } : w instanceof Writable ? { c: w.constructor.name, v: w.v } : typeof w === 'number' ? { c: Number.isInteger(w) ? 'IntWritable' : 'DoubleWritable', v: w } : { c: 'Text', v: String(w) };
  const ctxFor = (sink) => ({ write: (k, v) => { sink.push([snap(k), snap(v)]); }, getConfiguration: () => ({ get: () => null, getInt: (k, d) => d }), getCounter: () => ({ increment: () => {} }), progress: () => {}, setStatus: () => {} });
  /* map phase */
  try {
    const mapper = mapperCls ? instantiate(mapperCls) : null;
    const ctx = ctxFor(emitted);
    if (mapper && mapper.setup) mapper.setup(ctx);
    for (const f of job.files) {
      const d = m.hdfs.read(f); counters.read += byteLen(d);
      const lines = d.split('\n'); if (lines[lines.length - 1] === '') lines.pop();
      let off = 0;
      for (const line of lines) {
        counters.mapIn++;
        if (mapper && mapper.map) mapper.map(new LongWritable(off), new Text(line), ctx);
        else emitted.push([{ c: 'LongWritable', v: off }, { c: 'Text', v: line }]);
        off += byteLen(line) + 1;
      }
    }
    if (mapper && mapper.cleanup) mapper.cleanup(ctx);
  } catch (e) { if (G.__SIM_DEBUG) console.error(e); return failTask(e, 'm'); }
  counters.mapOut = emitted.length;
  // map output key type check
  const kc = emitted.find(e => !e[0].n);
  if (kc && reducers && mkOut && WCLS[mkOut] && kc[0].c !== mkOut && !(mkOut === 'LongWritable' && kc[0].c === 'IntWritable')) {
    io.print(`${ts()} INFO mapreduce.Job: Task Id : attempt_${job.id}_m_000000_0, Status : FAILED\nError: java.io.IOException: Type mismatch in key from map: expected org.apache.hadoop.io.${mkOut}, received org.apache.hadoop.io.${kc[0].c}`);
    io.error(`Job job_${job.id} failed with state FAILED due to: Task failed\n(Tell the Driver the mapper's output types: job.setMapOutputKeyClass(${kc[0].c}.class); job.setMapOutputValueClass(...);)`);
    return 1;
  }
  const vc = emitted.find(e => !e[1].n);
  if (vc && reducers && mvOut && WCLS[mvOut] && vc[1].c !== mvOut && !(mvOut === 'LongWritable' && vc[1].c === 'IntWritable') && !(mvOut === 'Text' && !mapOutV && !mapperCls)) {
    io.print(`${ts()} INFO mapreduce.Job: Task Id : attempt_${job.id}_m_000000_0, Status : FAILED\nError: java.io.IOException: Type mismatch in value from map: expected org.apache.hadoop.io.${mvOut}, received org.apache.hadoop.io.${vc[1].c}`);
    io.error(`Job job_${job.id} failed with state FAILED due to: Task failed\n(Tell the Driver the mapper's output value type: job.setMapOutputValueClass(${vc[1].c}.class);)`);
    return 1;
  }
  const fmt = (s) => s.n ? null : s.c === 'DoubleWritable' ? jd(s.v) : s.c === 'FloatWritable' ? jd(Math.fround(s.v)) : String(s.v);
  const line = (k, v) => { const a = fmt(k), b = fmt(v); if (a === null && b === null) return null; if (a === null) return b; if (b === null) return a; return a + '\t' + b; };
  let outLines = [];
  if (!reducers) {
    outLines = emitted.map(([k, v]) => line(k, v)).filter(x => x !== null);
    counters.written = writeOut(m, job, outLines, 'm');
    await finish(m, io, job, { counters }, 0);
    m.event({ kind: 'mr', prog: 'custom', out: job.out, ok: true });
    return 0;
  }
  /* shuffle & sort */
  const keyOf = (s) => s.n ? '\u0000null' : s.c + ':' + s.v;
  const groups = new Map();
  for (const [k, v] of emitted) { const kk = keyOf(k); if (!groups.has(kk)) groups.set(kk, { k, vs: [] }); groups.get(kk).vs.push(v); }
  const sorted = [...groups.values()].sort((a, b) => a.k.n ? 0 : (typeof a.k.v === 'number' ? a.k.v - b.k.v : jcmp(a.k.v, b.k.v)));
  counters.groups = sorted.length;
  /* reduce phase */
  const out = [];
  try {
    const reducer = reducerCls ? instantiate(reducerCls) : null;
    const ctx = ctxFor(out);
    if (reducer && reducer.setup) reducer.setup(ctx);
    for (const g of sorted) {
      const kObj = g.k.n ? NULLW : wrap(g.k.c, g.k.v);
      const vals = g.vs.map(v => v.n ? NULLW : wrap(v.c, v.v));
      const iterable = { [Symbol.iterator]: () => vals[Symbol.iterator](), iterator: () => iter(vals) };
      if (reducer && reducer.reduce) reducer.reduce(kObj, iterable, ctx);
      else for (const v of g.vs) out.push([g.k, v]);
    }
    if (reducer && reducer.cleanup) reducer.cleanup(ctx);
  } catch (e) { if (G.__SIM_DEBUG) console.error(e); return failTask(e, 'r'); }
  counters.redOut = out.length;
  outLines = out.map(([k, v]) => line(k, v)).filter(x => x !== null);
  counters.written = writeOut(m, job, outLines, 'r');
  await finish(m, io, job, { counters }, reducers);
  m.event({ kind: 'mr', prog: 'custom', out: job.out, ok: true });
  return 0;
}

async function hadoopJar(m, args, io) {
  if (!args.length) { io.error('RunJar jarFile [mainClass] args...'); return 255; }
  let jp = args[0];
  if (G.SIM.hasGlob(jp)) { const g = m.local.glob(jp, m.cwd).filter(p => m.local.exists(p)); if (g.length) jp = g[0]; }
  const abs = m.local.norm(jp, m.cwd);
  if (!m.local.isFile(abs)) { io.error(`JAR does not exist or is not a normal file: ${abs}`); return -1; }
  const d = m.local.read(abs);
  if (abs === EXAMPLES_JAR || d.startsWith('PK')) {
    if (!/examples/.test(abs)) { io.error('This jar has no main class this lab can run.'); return 1; }
    return runExample(m, args.slice(1), io);
  }
  let jarObj; try { jarObj = JSON.parse(d); } catch (e) { jarObj = null; }
  if (!jarObj || !jarObj.jar) { io.error(`Error opening job jar: ${jp}\njava.util.zip.ZipException: error in opening zip file`); return 1; }
  return runCustom(m, jarObj, args.slice(1), io, args[0]);
}

G.MR = { hadoopJar, javac, jar, analyzeFile, transpile };
})(typeof window !== 'undefined' ? window : globalThis);
