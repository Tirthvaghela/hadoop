/* ===== Hive CLI simulator ===== */
(function (G) {
'use strict';
const { NN, padR, byteLen } = G.SIM;
const alasql = G.alasql;
const WH = '/user/hive/warehouse';

/* ---------- shared formatting ---------- */
function javaDouble(v) {
  if (v === null || v === undefined) return 'NULL';
  if (!isFinite(v)) return isNaN(v) ? 'NaN' : (v > 0 ? 'Infinity' : '-Infinity');
  const a = Math.abs(v);
  if (a === 0) return Object.is(v, -0) ? '-0.0' : '0.0';
  if (a >= 1e-3 && a < 1e7) { const s = String(v); return /[.e]/.test(s) ? s : s + '.0'; }
  let [mant, exp] = v.toExponential().split('e');
  if (!mant.includes('.')) mant += '.0';
  return mant + 'E' + String(parseInt(exp, 10));
}
function javaHashBytes(s) { let h = 1; const b = unescape(encodeURIComponent(s)); for (let i = 0; i < b.length; i++) { let c = b.charCodeAt(i); if (c > 127) c -= 256; h = (Math.imul(31, h) + c) | 0; } return h; }

/* ---------- SQL text utilities ---------- */
function normalize(sql) {
  // lowercase outside string literals; convert "..." strings to '...'; drop -- comments
  let out = '', i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === '-' && sql[i + 1] === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (ch === "'" || ch === '"') {
      let j = i + 1, s = '';
      while (j < sql.length && sql[j] !== ch) { if (sql[j] === '\\' && j + 1 < sql.length) { s += sql[j] + sql[j + 1]; j += 2; continue; } s += sql[j]; j++; }
      out += "'" + s.replace(/'/g, "\\'") + "'"; i = j + 1; continue;
    }
    if (ch === '`') { let j = sql.indexOf('`', i + 1); if (j < 0) j = sql.length; out += '`' + sql.slice(i + 1, j).toLowerCase() + '`'; i = j + 1; continue; }
    out += ch.toLowerCase(); i++;
  }
  return out.replace(/\s+/g, ' ').trim();
}
function unq(s) { if (s === undefined || s === null) return s; s = s.trim(); if (/^'.*'$/.test(s)) s = s.slice(1, -1); return s.replace(/\\'/g, "'"); }
function unescapeDelim(d) {
  d = unq(d);
  if (d === '\\t') return '\t'; if (d === '\\n') return '\n';
  if (/^\\0*\d+$/.test(d)) return String.fromCharCode(parseInt(d.slice(1), 8));
  if (/^\\u[0-9a-f]{4}$/i.test(d)) return String.fromCharCode(parseInt(d.slice(2), 16));
  return d;
}
function splitTop(s, sep) {
  const out = []; let depth = 0, cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\') { cur += s[++i]; continue; } if (c === "'") q = false; continue; }
    if (c === "'") { q = true; cur += c; continue; }
    if (c === '(' || c === '<') depth++; else if (c === ')' || c === '>') depth = Math.max(0, depth - 1);
    if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map(x => x.trim());
}
function matchParen(s, start) { let d = 0, q = false; for (let i = start; i < s.length; i++) { const c = s[i]; if (q) { if (c === '\\') { i++; continue; } if (c === "'") q = false; continue; } if (c === "'") q = true; else if (c === '(') d++; else if (c === ')') { d--; if (d === 0) return i; } } return -1; }
// find depth-0 occurrences of clause keywords
function topClauses(s, kws) {
  const pos = []; let d = 0, q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === "'") q = false; continue; }
    if (c === "'") { q = true; continue; }
    if (c === '(') { d++; continue; } if (c === ')') { d--; continue; }
    if (d !== 0) continue;
    if (i > 0 && /[\w`.]/.test(s[i - 1])) continue;
    for (const k of kws) { if (s.startsWith(k, i) && !/[\w]/.test(s[i + k.length] || '')) { pos.push({ k, i }); i += k.length - 1; break; } }
  }
  return pos;
}

const TYPES = /^(tinyint|smallint|int|integer|bigint|float|double|double precision|decimal(\(\s*\d+\s*(,\s*\d+\s*)?\))?|numeric|string|varchar\(\s*\d+\s*\)|char\(\s*\d+\s*\)|boolean|date|timestamp|binary|array<.+>|map<.+>|struct<.+>)$/;
const KW = new Set('select from where group by having order sort distribute cluster limit asc desc and or not in between is null like rlike as on join inner left right full outer cross semi distinct case when then else end true false all union exists interval cast date timestamp'.split(' '));

class HiveError extends Error {}
const fail = (msg) => { throw new HiveError(msg); };

/* ---------- metastore ---------- */
function ms(m) {
  if (!m.hive) m.hive = { dbs: { default: { tables: {}, created: Date.now() } } };
  return m.hive;
}
function dbDir(db) { return db === 'default' ? WH : `${WH}/${db}.db`; }
function getTable(m, sess, ref, pos) {
  const H = ms(m); let db = sess.db, name = ref;
  if (ref.includes('.')) [db, name] = ref.split('.');
  name = name.replace(/`/g, '');
  const d = H.dbs[db];
  if (!d || !d.tables[name]) fail(`FAILED: SemanticException [Error 10001]: Line 1:${pos || 14} Table not found '${ref}'`);
  return d.tables[name];
}
function findTable(m, sess, ref) { try { return getTable(m, sess, ref); } catch (e) { return null; } }

function parseField(raw, type) {
  if (raw === undefined || raw === '\\N') return null;
  const t = type.replace(/\(.*$/, '');
  if (/^(tinyint|smallint|int|integer|bigint)$/.test(t)) return /^[-+]?\d+$/.test(raw) ? parseInt(raw, 10) : null;
  if (/^(float|double|decimal|numeric)/.test(t)) return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(raw) ? parseFloat(raw) : null;
  if (t === 'boolean') { const l = raw.toLowerCase(); return l === 'true' ? true : l === 'false' ? false : null; }
  return raw;
}
function fmtVal(v, type) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') {
    if (/^(float|double|decimal)/.test(type || '')) return javaDouble(v);
    if (/int/.test(type || '') && Number.isInteger(v)) return String(v);
    return Number.isInteger(v) && !/^(float|double)/.test(type || '') ? String(v) : javaDouble(v);
  }
  return String(v);
}
function serVal(v, type) { return v === null || v === undefined ? '\\N' : fmtVal(v, type); }
function dataFiles(m, loc) { const H = m.hdfs; if (!H.isDir(loc)) return []; return H.list(loc).filter(k => !k.startsWith('_') && !k.startsWith('.') && H.isFile(H.join(loc, k))).map(k => H.join(loc, k)); }
function readTable(m, t) {
  const rows = [];
  for (const f of dataFiles(m, t.location)) {
    let lines = m.hdfs.read(f).split('\n'); if (lines[lines.length - 1] === '') lines.pop();
    lines = lines.slice(t.skipHeader || 0);
    for (const line of lines) {
      const parts = line.split(t.delim);
      const r = {}; t.cols.forEach((c, i) => { r[c.name] = parseField(parts[i], c.type); });
      rows.push(r);
    }
  }
  return rows;
}
function nextName(m, loc, base) { let n = base, k = 1; while (m.hdfs.exists(m.hdfs.join(loc, n))) n = `${base}_copy_${k++}`; return n; }
function writeRows(m, t, rows, overwrite) {
  const H = m.hdfs; H.mkdir(t.location, true);
  if (overwrite) for (const f of H.list(t.location)) H.rm(H.join(t.location, f));
  if (!rows.length) return;
  const text = rows.map(r => r.map((v, i) => serVal(coerce(v, t.cols[i] && t.cols[i].type), t.cols[i] && t.cols[i].type)).join(t.delim)).join('\n') + '\n';
  H.write(H.join(t.location, nextName(m, t.location, '000000_0')), text);
}
function coerce(v, type) {
  if (v === null || v === undefined || !type) return v;
  const t = type.replace(/\(.*$/, '');
  if (/int/.test(t)) { if (typeof v === 'number') return Math.trunc(v); const p = parseField(String(v).trim(), 'int'); if (p !== null) return p; const f = parseField(String(v).trim(), 'double'); return f === null ? null : Math.trunc(f); }
  if (/^(float|double|decimal|numeric)/.test(t)) { if (typeof v === 'number') return v; return parseField(String(v).trim(), 'double'); }
  if (t === 'boolean') return typeof v === 'boolean' ? v : parseField(String(v), 'boolean');
  if (typeof v === 'number') return fmtVal(v, Number.isInteger(v) ? 'int' : 'double');
  return String(v);
}

/* ---------- SELECT engine ---------- */
function exprType(e, lookup, colsTyped) {
  e = e.trim();
  let m1;
  if (/^'.*'$/.test(e)) return 'string';
  if (/^-?\d+$/.test(e)) return 'int';
  if (/^-?\d*\.\d+$/.test(e)) return 'double';
  if (/^(true|false)$/.test(e)) return 'boolean';
  if (/^count\s*\(/.test(e)) return 'bigint';
  if (/^(avg|stddev|stddev_pop|stddev_samp|variance|var_pop|var_samp)\s*\(/.test(e)) return 'double';
  if ((m1 = e.match(/^sum\s*\((.*)\)$/))) { const t = exprType(m1[1], lookup); return /int/.test(t) ? 'bigint' : 'double'; }
  if ((m1 = e.match(/^(max|min)\s*\((.*)\)$/))) return exprType(m1[2], lookup);
  if ((m1 = e.match(/^round\s*\((.*?)(,\s*\d+)?\)$/))) return exprType(m1[1], lookup);
  if ((m1 = e.match(/^cast\s*\(.* as (\w+)\)$/))) return m1[1];
  if (/^(upper|lower|concat|concat_ws|substr|substring|trim|ltrim|rtrim|lpad|rpad|reverse)\s*\(/.test(e)) return 'string';
  if (/^length\s*\(/.test(e)) return 'int';
  if ((m1 = e.match(/^`?([a-z_]\w*)`?\.`?([a-z_]\w*)`?$/)) || (m1 = e.match(/^`?([a-z_]\w*)`?$/))) { const t = lookup(m1[2] ? m1[1] : null, m1[2] || m1[1]); if (t) return t; }
  if ((m1 = e.match(/^case\b.*?\bthen\s+('[^']*'|-?\d+(\.\d+)?)/))) return /^'/.test(m1[1]) ? 'string' : /\./.test(m1[1]) ? 'double' : 'int';
  if (/[^/]\/[^/]/.test(e.replace(/'[^']*'/g, ''))) return 'double';
  if (/\d\.\d/.test(e.replace(/'[^']*'/g, ''))) return 'double';
  if (/[<>=]|\b(and|or|not|like|in|between|is)\b/.test(e.replace(/'[^']*'/g, ''))) return 'boolean';
  return null;
}
function translateFns(s) {
  return s
    .replace(/\bnvl\s*\(/g, 'COALESCE(')
    .replace(/\bif\s*\(([^,()]+(?:\([^()]*\))?[^,()]*),([^,()]+),([^,()]+)\)/g, 'CASE WHEN $1 THEN $2 ELSE $3 END')
    .replace(/\bsubstring\s*\(/g, 'SUBSTR(')
    .replace(/\bstddev_samp\s*\(/g, 'STDEV(').replace(/\bstddev\s*\(/g, 'STDEV(')
    .replace(/\brlike\b/g, 'REGEXP_LIKE');
}

function runSelect(m, sess, sql, opts) {
  opts = opts || {};
  const clauses = topClauses(sql, ['select', 'from', 'where', 'group by', 'having', 'order by', 'sort by', 'distribute by', 'cluster by', 'limit', 'union all', 'union']);
  if (!clauses.length || clauses[0].k !== 'select') fail(`FAILED: ParseException line 1:0 cannot recognize input near '${sql.split(' ').slice(0, 3).join("' '")}'`);
  if (clauses.some(c => c.k.startsWith('union'))) fail('FAILED: SemanticException UNION is not supported in this lab simulator. Run the two SELECTs separately.');
  const part = {};
  clauses.forEach((c, i) => { const end = i + 1 < clauses.length ? clauses[i + 1].i : sql.length; if (part[c.k] !== undefined) fail(`FAILED: ParseException line 1:${c.i} missing EOF at '${c.k}'`); part[c.k] = sql.slice(c.i + c.k.length, end).trim(); });
  let selectText = part.select; let distinct = false;
  if (/^distinct\b/.test(selectText)) { distinct = true; selectText = selectText.slice(8).trim(); }
  if (/^all\b/.test(selectText)) selectText = selectText.slice(3).trim();

  /* sources */
  const sources = []; const params = []; let fromSql = '';
  if (part.from !== undefined) {
    const f = part.from;
    const joinRe = /\b(left\s+semi\s+join|(?:left|right|full)(?:\s+outer)?\s+join|(?:inner\s+)?join|cross\s+join)\b/g;
    const pieces = []; let last = 0, mm, lastJoin = null;
    // only split on depth-0 joins
    const depthAt = (idx) => { let d = 0, q = false; for (let i = 0; i < idx; i++) { const c = f[i]; if (q) { if (c === "'") q = false; continue; } if (c === "'") q = true; else if (c === '(') d++; else if (c === ')') d--; } return d; };
    while ((mm = joinRe.exec(f))) { if (depthAt(mm.index)) continue; pieces.push({ text: f.slice(last, mm.index).trim(), join: lastJoin }); lastJoin = mm[1]; last = mm.index + mm[0].length; }
    pieces.push({ text: f.slice(last).trim(), join: lastJoin });
    pieces.forEach((p, idx) => {
      let ref = p.text, on = null;
      const onm = topClauses(ref, ['on']); if (onm.length) { on = ref.slice(onm[0].i + 2).trim(); ref = ref.slice(0, onm[0].i).trim(); }
      let alias, cols, rows;
      if (ref.startsWith('(')) {
        const close = matchParen(ref, 0); const sub = ref.slice(1, close); const rest = ref.slice(close + 1).trim().replace(/^as\s+/, '');
        const r = runSelect(m, sess, sub, { inner: true, resolve: opts.resolve }); alias = rest || '_u1';
        cols = r.cols.map((c, i) => ({ name: c, type: r.types[i] || 'string' })); rows = r.rows.map(row => { const o = {}; cols.forEach((c, i) => o[c.name] = row[i]); return o; });
      } else {
        const mt = ref.match(/^([a-z_`][\w`]*(?:\.[a-z_`][\w`]*)?)(?:\s+(?:as\s+)?([a-z_]\w*))?$/);
        if (!mt) fail(`FAILED: ParseException line 1:${sql.indexOf(ref)} cannot recognize input near '${ref.split(' ').slice(0, 3).join("' '")}'`);
        const t = opts.resolve ? opts.resolve(mt[1].replace(/`/g, '')) : getTable(m, sess, mt[1].replace(/`/g, ''), sql.indexOf(mt[1]));
        alias = mt[2] || t.name; cols = t.cols.map(c => ({ name: c.name, type: c.type })); rows = opts.resolve ? t.rows : readTable(m, t);
      }
      sources.push({ alias, cols, rows, on, join: p.join });
      params.push(rows);
      const jt = p.join ? ({ 'join': 'INNER JOIN', 'inner join': 'INNER JOIN', 'left join': 'LEFT JOIN', 'left outer join': 'LEFT JOIN', 'right join': 'RIGHT JOIN', 'right outer join': 'RIGHT JOIN', 'full join': 'OUTER JOIN', 'full outer join': 'OUTER JOIN', 'cross join': 'CROSS JOIN', 'left semi join': 'SEMI' })[p.join.replace(/\s+/g, ' ')] : null;
      if (jt === 'SEMI') fail('FAILED: LEFT SEMI JOIN is not supported in this lab simulator; use an INNER JOIN.');
      if (jt && jt !== 'CROSS JOIN' && !on) fail(`FAILED: SemanticException Join condition missing for ${p.join.toUpperCase()}`);
      fromSql += (idx ? ` ${jt} ` : '') + `? AS \`${alias}\`` + (on ? ` ON ${on}` : '');
    });
  }
  const lookup = (alias, col) => { for (const s of sources) { if (alias && s.alias !== alias) continue; const c = s.cols.find(c => c.name === col); if (c) return c.type; } return null; };

  /* select list */
  const items = splitTop(selectText, ',');
  const outCols = []; // {key, name, expr}
  items.forEach((it) => {
    if (it === '*') { sources.forEach(s => s.cols.forEach(c => outCols.push({ expr: `\`${s.alias}\`.\`${c.name}\``, name: c.name, type: c.type }))); return; }
    const st = it.match(/^([a-z_]\w*)\.\*$/);
    if (st) { const s = sources.find(s => s.alias === st[1]); if (!s) fail(`FAILED: SemanticException [Error 10004]: Line 1:7 Invalid table alias '${st[1]}'`); s.cols.forEach(c => outCols.push({ expr: `\`${s.alias}\`.\`${c.name}\``, name: c.name, type: c.type })); return; }
    let expr = it, alias = null, am;
    if ((am = it.match(/^(.*\S)\s+as\s+`?([a-z_]\w*)`?$/))) { expr = am[1]; alias = am[2]; }
    else if ((am = it.match(/^(.*[\w)`'])\s+`?([a-z_]\w*)`?$/)) && !KW.has(am[2]) && !/\b(case)\b/.test(am[1]) || (am && /\bend$/.test(am[1]) && !KW.has(am[2]))) { expr = am[1]; alias = am[2]; }
    const plain = expr.match(/^(?:`?[a-z_]\w*`?\.)?`?([a-z_]\w*)`?$/);
    outCols.push({ expr, name: alias || (plain ? plain[1] : null), userAlias: alias });
  });
  outCols.forEach((c, i) => { c.key = 'c' + i; if (!c.name) c.name = '_c' + i; });

  /* column validation */
  const known = new Set(); sources.forEach(s => { known.add(s.alias); s.cols.forEach(c => known.add(c.name)); });
  const aliases = new Set(outCols.filter(c => c.userAlias).map(c => c.userAlias));
  const allCols = sources.length === 1 ? sources[0].cols.map(c => c.name) : sources.flatMap(s => s.cols.map(c => s.alias + '.' + c.name));
  const check = (txt, allowAlias) => {
    if (!txt) return;
    const clean = txt.replace(/'(?:\\.|[^'])*'/g, "''");
    const re = /(`?[a-z_]\w*`?)(\s*\.\s*`?[a-z_]\w*`?)?(\s*\()?/g; let t;
    while ((t = re.exec(clean))) {
      if (t[3]) continue; // function call
      const a = t[1].replace(/`/g, ''); const b = t[2] ? t[2].replace(/[\s.`]/g, '') : null;
      const prev = clean.slice(0, t.index).trimEnd();
      if (/\bas$/.test(prev) && !b) continue;
      if (/\b(cast\s*\(.*\bas)$/.test(prev)) continue;
      if (b) { const s = sources.find(s => s.alias === a); if (!s) fail(`FAILED: SemanticException [Error 10004]: Line 1:${sql.indexOf(a)} Invalid table alias or column reference '${a}': (possible column names are: ${allCols.join(', ')})`); if (!s.cols.find(c => c.name === b)) fail(`FAILED: SemanticException [Error 10002]: Line 1:${sql.indexOf(a + '.' + b)} Invalid column reference '${b}'`); continue; }
      if (KW.has(a) || /^\d/.test(a) || ['int', 'string', 'double', 'bigint', 'float', 'boolean', 'null', 'decimal'].includes(a)) continue;
      if (known.has(a) || (allowAlias && aliases.has(a))) continue;
      fail(`FAILED: SemanticException [Error 10004]: Line 1:${Math.max(0, sql.indexOf(a))} Invalid table alias or column reference '${a}': (possible column names are: ${allCols.join(', ')})`);
    }
  };
  outCols.forEach(c => check(c.expr, false));
  sources.forEach(s => check(s.on, false));
  check(part.where, false); check(part['group by'], false); check(part.having, true);
  ['order by', 'sort by', 'distribute by', 'cluster by'].forEach(k => check(part[k] && part[k].replace(/\b(asc|desc)\b/g, ''), true));
  if (part.where && /\b(sum|avg|count|max|min)\s*\(/.test(part.where)) fail('FAILED: SemanticException [Error 10128]: Line 1:' + sql.indexOf(part.where) + ' Not yet supported place for UDAF \'' + part.where.match(/\b(sum|avg|count|max|min)\s*\(/)[1] + "'");
  // group by validation: non-aggregated select columns must be grouped
  const hasAgg = outCols.some(c => /\b(count|sum|avg|max|min|stddev|variance)\s*\(/.test(c.expr));
  if (part['group by'] !== undefined || hasAgg) {
    const groups = part['group by'] ? splitTop(part['group by'], ',').map(g => g.replace(/`/g, '').replace(/^\w+\./, '')) : [];
    for (const c of outCols) {
      if (/\b(count|sum|avg|max|min|stddev|variance)\s*\(/.test(c.expr)) continue;
      const bare = c.expr.replace(/`/g, '').replace(/^\w+\./, '');
      if (/^'.*'$/.test(bare) || /^-?\d+(\.\d+)?$/.test(bare)) continue;
      if (!groups.includes(bare) && !groups.includes(c.expr)) fail(`FAILED: SemanticException [Error 10025]: Line 1:${sql.indexOf(c.expr)} Expression not in GROUP BY key '${bare}'`);
    }
  }

  /* types */
  outCols.forEach(c => { if (!c.type) c.type = exprType(c.expr.replace(/`/g, ''), lookup); });

  /* sort / distribute handling */
  let order = part['order by'];
  let sortBy = part['sort by'], dist = part['distribute by'];
  if (part['cluster by']) { dist = part['cluster by']; sortBy = part['cluster by']; }
  const reducers = parseInt(sess.conf['mapreduce.job.reduces'] || sess.conf['mapred.reduce.tasks'] || '-1', 10);
  let custom = null;
  if (sortBy !== undefined || dist !== undefined) {
    if (dist !== undefined && reducers > 1) custom = { dist, sortBy, n: reducers };
    else if (sortBy !== undefined) order = sortBy;
  }
  const subAlias = (txt) => txt && txt.replace(/(^|[^.\w`])`?([a-z_]\w*)`?(?![\w(.])/g, (mm, p, w) => { const c = outCols.find(c => c.userAlias === w); return c && !known.has(w) ? p + '(' + c.expr + ')' : mm; });
  if (!order && part['group by'] !== undefined && !custom) order = part['group by'];
  const extra = [];
  if (custom) {
    extra.push(`${custom.dist} AS \`__d\``);
    if (custom.sortBy) splitTop(custom.sortBy, ',').forEach((s, i) => { const mm = s.match(/^(.*?)(\s+(asc|desc))?$/); extra.push(`${subAlias(mm[1])} AS \`__s${i}\``); custom['dir' + i] = (mm[3] || 'asc'); custom.ns = i + 1; });
  }
  let q = 'SELECT ' + (distinct ? 'DISTINCT ' : '') + outCols.map(c => `${translateFns(c.expr)} AS \`${c.key}\``).concat(extra).join(', ');
  if (fromSql) q += ' FROM ' + fromSql;
  if (part.where) q += ' WHERE ' + translateFns(part.where);
  if (part['group by']) q += ' GROUP BY ' + part['group by'];
  if (part.having) q += ' HAVING ' + translateFns(subAlias(part.having));
  if (order && !custom) q += ' ORDER BY ' + splitTop(order, ',').map(o => { const mm = o.match(/^(.*?)(\s+(asc|desc))?$/); const ref = outCols.find(c => c.userAlias === mm[1].trim() || c.name === mm[1].trim().replace(/^\w+\./, '') && c.expr.replace(/`/g, '').replace(/^\w+\./, '') === mm[1].trim().replace(/^\w+\./, '')); return (ref ? '`' + ref.key + '`' : mm[1]) + (mm[3] ? ' ' + mm[3].toUpperCase() : ''); }).join(', ');
  let limit = null;
  if (part.limit !== undefined) { limit = parseInt(part.limit, 10); if (isNaN(limit)) fail(`FAILED: ParseException line 1:${sql.indexOf('limit') + 6} extraneous input '${part.limit}'`); if (!custom) q += ' LIMIT ' + limit; }
  let res;
  try { res = alasql(q, params); }
  catch (e) { fail(`FAILED: SemanticException ${String(e.message || e).split('\n')[0]}`); }
  let rows = res;
  if (custom) {
    const buckets = Array.from({ length: custom.n }, () => []);
    rows.forEach(r => { const k = r.__d; const h = typeof k === 'number' ? (Number.isInteger(k) ? k | 0 : javaHashBytes(String(k))) : k === null ? 0 : javaHashBytes(String(k)); buckets[(h & 0x7fffffff) % custom.n].push(r); });
    rows = [];
    buckets.forEach(b => { if (custom.ns) b.sort((x, y) => { for (let i = 0; i < custom.ns; i++) { const a = x['__s' + i], c = y['__s' + i]; if (a === c) continue; const d = a === null ? -1 : c === null ? 1 : a < c ? -1 : 1; return custom['dir' + i] === 'desc' ? -d : d; } return 0; }); rows.push(...b); });
    if (limit !== null) rows = rows.slice(0, limit);
  }
  const out = rows.map(r => outCols.map(c => (r[c.key] === undefined ? null : r[c.key])));
  // infer missing types from values
  outCols.forEach((c, i) => { if (!c.type) { const vals = out.map(r => r[i]).filter(v => v !== null); c.type = vals.length && vals.every(v => typeof v === 'number') ? (vals.every(Number.isInteger) ? 'int' : 'double') : vals.every(v => typeof v === 'boolean') && vals.length ? 'boolean' : 'string'; } });
  const mr = !!(part['group by'] !== undefined || order || sortBy || dist || distinct || hasAgg || sources.length > 1 || custom);
  return { cols: outCols.map(c => c.name), types: outCols.map(c => c.type), rows: out, mr, reducers: custom ? custom.n : 1 };
}

/* ---------- MapReduce log for queries ---------- */
function stamp() { const d = new Date(); const t = (n, l = 2) => String(n).padStart(l, '0'); return `${d.getFullYear()}-${t(d.getMonth() + 1)}-${t(d.getDate())} ${t(d.getHours())}:${t(d.getMinutes())}:${t(d.getSeconds())},${t(d.getMilliseconds(), 3)}`; }
async function mrLog(m, out, opts) {
  const d = new Date(); const t = (n) => String(n).padStart(2, '0');
  const qid = `hadoop_${d.getFullYear()}${t(d.getMonth() + 1)}${t(d.getDate())}${t(d.getHours())}${t(d.getMinutes())}${t(d.getSeconds())}_${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 6)}`;
  out(`Query ID = ${qid}`, 'dim'); out('Total jobs = 1', 'dim'); out('Launching Job 1 out of 1', 'dim');
  if (!m.svc.yarn) {
    await m.sleep(300);
    out('java.net.ConnectException: Call From gls-university/127.0.1.1 to 0.0.0.0:8032 failed on connection exception: java.net.ConnectException: Connection refused', 'err');
    out(`Job Submission failed with exception 'java.net.ConnectException(Call From gls-university/127.0.1.1 to 0.0.0.0:8032 failed on connection exception: java.net.ConnectException: Connection refused)'`, 'err');
    out('FAILED: Execution Error, return code 1 from org.apache.hadoop.hive.ql.exec.mr.MapRedTask', 'err');
    out('(YARN is not running. Exit Hive with  quit;  then run  start-yarn.sh)', 'hint');
    return false;
  }
  const red = opts.reducers === undefined ? 1 : opts.reducers;
  if (red) { out(`Number of reduce tasks ${opts.fixed ? 'determined at compile time' : 'not specified. Estimated from input data size'}: ${red}`, 'dim'); out('In order to change the average load for a reducer (in bytes):\n  set hive.exec.reducers.bytes.per.reducer=<number>\nIn order to limit the maximum number of reducers:\n  set hive.exec.reducers.max=<number>\nIn order to set a constant number of reducers:\n  set mapreduce.job.reduces=<number>', 'dim'); }
  else out('Number of reduce tasks is set to 0 since there\'s no reduce operator', 'dim');
  const app = `${1760000000000 + (m.appSeq % 1000)}_${String(m.jobSeq).padStart(4, '0')}`; m.jobSeq++;
  out(`Starting Job = job_${app}, Tracking URL = http://gls-university:8088/proxy/application_${app}/`, 'dim');
  out(`Kill Command = /usr/local/hadoop/bin/mapred job  -kill job_${app}`, 'dim');
  out(`Hadoop job information for Stage-1: number of mappers: 1; number of reducers: ${red}`, 'dim');
  await m.sleep(250); out(`${stamp()} Stage-1 map = 0%,  reduce = 0%`, 'dim');
  await m.sleep(450); out(`${stamp()} Stage-1 map = 100%,  reduce = 0%, Cumulative CPU 1.92 sec`, 'dim');
  if (red) { await m.sleep(350); out(`${stamp()} Stage-1 map = 100%,  reduce = 100%, Cumulative CPU 3.84 sec`, 'dim'); }
  out(`MapReduce Total cumulative CPU time: 3 seconds 840 msec\nEnded Job = job_${app}`, 'dim');
  if (opts.loading) out(opts.loading, 'dim');
  out(`MapReduce Jobs Launched: \nStage-Stage-1: Map: 1 ${red ? ' Reduce: ' + red + ' ' : ''}  Cumulative CPU: 3.84 sec   HDFS Read: ${opts.read || 9812} HDFS Write: ${opts.write || 412} SUCCESS\nTotal MapReduce CPU Time Spent: 3 seconds 840 msec`, 'dim');
  return true;
}

/* ---------- DDL helpers ---------- */
function parseCols(text) {
  return splitTop(text, ',').map(def => {
    const mm = def.match(/^`?([a-z_]\w*)`?\s+(.+?)(?:\s+comment\s+'(.*)')?$/);
    if (!mm) fail(`FAILED: ParseException line 1:0 cannot recognize input near '${def}'`);
    const type = mm[2].replace(/\binteger\b/, 'int').replace(/\s+/g, '');
    if (!TYPES.test(mm[2].trim())) fail(`FAILED: ParseException line 1:0 cannot recognize input near '${mm[1]}' '${mm[2].split(' ')[0]}' ',' in column type`);
    return { name: mm[1], type, comment: mm[3] || '' };
  });
}
function parseStorage(rest) {
  const o = { delim: '\u0001', location: null, skipHeader: 0, comment: '', format: 'textfile' };
  let mm;
  if (/\bpartitioned by\b/.test(rest)) fail('FAILED: Partitioned tables are not part of this practical and are not supported by the simulator.');
  if ((mm = rest.match(/fields terminated by ('(?:\\.|[^'])*')/))) o.delim = unescapeDelim(mm[1]);
  if ((mm = rest.match(/\blocation ('(?:\\.|[^'])*')/))) o.location = unq(mm[1]);
  if ((mm = rest.match(/skip\.header\.line\.count'\s*=\s*'(\d+)'/))) o.skipHeader = +mm[1];
  if ((mm = rest.match(/stored as (\w+)/))) o.format = mm[1];
  if ((mm = rest.match(/^\s*comment ('(?:\\.|[^'])*')/))) o.comment = unq(mm[1]);
  return o;
}
function hdfsAbs(m, p) { const r = m.hpath(p); if (r.error) fail(`FAILED: SemanticException Wrong FS: ${p}, expected: ${NN}`); return r.path; }

/* ---------- statement executor ---------- */
async function execStmt(m, sess, raw, out) {
  const s = normalize(raw).replace(/;$/, '').trim();
  if (!s) return;
  const t0 = Date.now();
  const ok = (extra) => { out('OK'); if (extra) extra(); out(`Time taken: ${((Date.now() - t0) / 1000 + 0.05 + Math.random() * 0.2).toFixed(3)} seconds`, 'dim'); };
  const okRows = (n) => out(`Time taken: ${((Date.now() - t0) / 1000 + 0.08 + Math.random() * 0.3).toFixed(3)} seconds, Fetched: ${n} row(s)`, 'dim');
  const header = () => String(sess.conf['hive.cli.print.header']).toLowerCase() === 'true';
  const H = m.hdfs; const meta = ms(m);
  let mm;
  const ev = (o) => m.event(Object.assign({ kind: 'hive', sql: s, db: sess.db }, o));

  if ((mm = s.match(/^(quit|exit)$/))) { sess.quit = true; return; }
  if (/^set$/.test(s)) { Object.keys(sess.conf).forEach(k => out(`${k}=${sess.conf[k]}`)); return; }
  if ((mm = raw.trim().replace(/;$/, '').match(/^set\s+([\w.]+)\s*=\s*(.*)$/i))) { sess.conf[mm[1].toLowerCase()] = mm[2].trim(); ev({ type: 'set' }); return; }
  if ((mm = s.match(/^set ([\w.]+)$/))) { out(`${mm[1]}=${sess.conf[mm[1]] !== undefined ? sess.conf[mm[1]] : (mm[1] === 'hive.cli.print.header' ? 'false' : 'Undefined')}`); return; }
  if (/^dfs\s/i.test(raw.trim())) { const args = raw.trim().replace(/;$/, '').split(/\s+/).slice(1); const io = { print: (x) => out(x), error: (x) => out(x, 'err'), stdin: null }; const code = await G.SIM.COMMANDS.hdfs.call(m, ['dfs', ...args], io); if (code) out(`Command -${args[0].replace(/^-/, '')} failed with exit code = ${code}`, 'err'); return; }
  if (/^!/.test(raw.trim())) { await m.runLine(raw.trim().slice(1).replace(/;$/, ''), null); return; }

  if ((mm = s.match(/^create (database|schema) (if not exists )?(\w+)(.*)$/))) {
    const name = mm[3];
    if (meta.dbs[name]) { if (mm[2]) { ok(); return; } fail(`FAILED: Execution Error, return code 1 from org.apache.hadoop.hive.ql.exec.DDLTask. Database ${name} already exists`); }
    meta.dbs[name] = { tables: {}, created: Date.now(), comment: (mm[4].match(/comment '(.*?)'/) || [])[1] || '' };
    H.mkdir(dbDir(name), true); ev({ type: 'create_db', name }); ok(); return;
  }
  if ((mm = s.match(/^drop (database|schema) (if exists )?(\w+)( cascade| restrict)?$/))) {
    const name = mm[3];
    if (!meta.dbs[name]) { if (mm[2]) { ok(); return; } fail(`FAILED: SemanticException [Error 10072]: Database does not exist: ${name}`); }
    if (name === 'default') fail('FAILED: Execution Error, return code 1 from org.apache.hadoop.hive.ql.exec.DDLTask. MetaException(message:Can not drop default database)');
    if (Object.keys(meta.dbs[name].tables).length && mm[4] !== ' cascade') fail(`FAILED: Execution Error, return code 1 from org.apache.hadoop.hive.ql.exec.DDLTask. InvalidOperationException(message:Database ${name} is not empty. One or more tables exist.)`);
    delete meta.dbs[name]; H.rm(dbDir(name)); if (sess.db === name) sess.db = 'default'; ev({ type: 'drop_db', name }); ok(); return;
  }
  if ((mm = s.match(/^use (\w+)$/))) { if (!meta.dbs[mm[1]]) fail(`FAILED: SemanticException [Error 10072]: Database does not exist: ${mm[1]}`); sess.db = mm[1]; ev({ type: 'use', name: mm[1] }); ok(); return; }
  if ((mm = s.match(/^show (databases|schemas)( like '(.*)')?$/))) {
    let list = Object.keys(meta.dbs).sort(); if (mm[3]) { const re = new RegExp('^' + mm[3].replace(/\*/g, '.*') + '$'); list = list.filter(x => re.test(x)); }
    out('OK');
    if (header()) out('database_name'); list.forEach(d => out(d)); ev({ type: 'show_db', rows: list.map(x => [x]) }); okRows(list.length); return;
  }
  if ((mm = s.match(/^show tables( (?:in|from) (\w+))?( (?:like )?'(.*)')?$/))) {
    const db = mm[2] || sess.db; if (!meta.dbs[db]) fail(`FAILED: SemanticException [Error 10072]: Database does not exist: ${db}`);
    let list = Object.keys(meta.dbs[db].tables).sort(); if (mm[4]) { const re = new RegExp('^' + mm[4].replace(/\*/g, '.*') + '$'); list = list.filter(x => re.test(x)); }
    out('OK'); if (header()) out('tab_name'); list.forEach(x => out(x)); ev({ type: 'show_tables', rows: list.map(x => [x]) }); okRows(list.length); return;
  }
  if ((mm = s.match(/^show create table ([\w.]+)$/))) {
    const t = getTable(m, sess, mm[1]);
    out('OK');
    out(`CREATE ${t.external ? 'EXTERNAL ' : ''}TABLE \`${t.db}.${t.name}\`(\n${t.cols.map(c => `  \`${c.name}\` ${c.type}`).join(', \n')})\nROW FORMAT SERDE \n  'org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe' \nWITH SERDEPROPERTIES ( \n  'field.delim'='${t.delim === '\u0001' ? '\\u0001' : t.delim}', \n  'serialization.format'='${t.delim === '\u0001' ? '\\u0001' : t.delim}') \nSTORED AS INPUTFORMAT \n  'org.apache.hadoop.mapred.TextInputFormat' \nOUTPUTFORMAT \n  'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat'\nLOCATION\n  '${NN}${t.location}'`);
    okRows(1); return;
  }
  if ((mm = s.match(/^(?:describe|desc) (database|schema) (\w+)$/))) { const d = meta.dbs[mm[2]]; if (!d) fail(`FAILED: SemanticException [Error 10072]: Database does not exist: ${mm[2]}`); out('OK'); out(`${mm[2]}\t${d.comment || ''}\t${NN}${dbDir(mm[2])}\thadoop\tUSER\t`); okRows(1); return; }
  if ((mm = s.match(/^(?:describe|desc) (formatted |extended )?([\w.`]+)( \w+)?$/))) {
    const t = getTable(m, sess, mm[2].replace(/`/g, ''), 9);
    if (mm[3]) { const c = t.cols.find(c => c.name === mm[3].trim()); if (!c) fail(`FAILED: SemanticException [Error 10002]: Invalid column reference ${mm[3].trim()}`); out('OK'); out(`${padR(c.name, 20)}\t${padR(c.type, 20)}\tfrom deserializer   `); okRows(1); return; }
    out('OK');
    const rows = t.cols.map(c => [c.name, c.type, c.comment]);
    if (mm[1] === 'formatted ') {
      out(`# col_name            \tdata_type           \tcomment             `);
      rows.forEach(r => out(`${padR(r[0], 20)}\t${padR(r[1], 20)}\t${padR(r[2], 20)}`));
      const files = dataFiles(m, t.location); const size = files.reduce((a, f) => a + byteLen(H.read(f)), 0);
      out(`\t \t \n# Detailed Table Information\t \t \nDatabase:           \t${padR(t.db, 20)}\t \nOwnerType:          \tUSER                \t \nOwner:              \thadoop              \t \nCreateTime:         \t${new Date(t.created).toString().replace(/ GMT.*/, ' IST')}\t \nRetention:          \t0                   \t \nLocation:           \t${NN}${t.location}\t \nTable Type:         \t${t.external ? 'EXTERNAL_TABLE' : 'MANAGED_TABLE'}       \t \nTable Parameters:\t \t \n\tnumFiles            \t${padR(files.length, 20)}\n\ttotalSize           \t${padR(size, 20)}\n\ttransient_lastDdlTime\t${Math.floor(t.created / 1000)}          \n\t \t \n# Storage Information\t \t \nSerDe Library:      \torg.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe\t \nInputFormat:        \torg.apache.hadoop.mapred.TextInputFormat\t \nOutputFormat:       \torg.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat\t \nCompressed:         \tNo                  \t \nNum Buckets:        \t-1                  \t \nStorage Desc Params:\t \t \n\tfield.delim         \t${padR(t.delim === '\u0001' ? '\\u0001' : t.delim === '\t' ? '\\t' : t.delim, 20)}\n\tserialization.format\t${padR(t.delim === '\u0001' ? '\\u0001' : t.delim === '\t' ? '\\t' : t.delim, 20)}`);
      okRows(rows.length + 30);
    } else {
      if (header()) out(`col_name\tdata_type\tcomment`);
      rows.forEach(r => out(`${padR(r[0], 20)}\t${padR(r[1], 20)}\t${padR(r[2], 20)}`));
      if (mm[1] === 'extended ') out(`\t \t \nDetailed Table Information\tTable(tableName:${t.name}, dbName:${t.db}, owner:hadoop, sd:StorageDescriptor(location:${NN}${t.location}, inputFormat:org.apache.hadoop.mapred.TextInputFormat), tableType:${t.external ? 'EXTERNAL_TABLE' : 'MANAGED_TABLE'})`);
      okRows(rows.length);
    }
    ev({ type: 'describe', table: t.name, rows: rows.map(r => [r[0], r[1]]) }); return;
  }
  /* CREATE TABLE ... */
  if ((mm = s.match(/^create (external )?table (if not exists )?([\w.`]+)\s*(.*)$/))) {
    let [, ext, ine, ref, rest] = mm; ref = ref.replace(/`/g, '');
    let db = sess.db, name = ref; if (ref.includes('.')) [db, name] = ref.split('.');
    if (!meta.dbs[db]) fail(`FAILED: SemanticException [Error 10072]: Database does not exist: ${db}`);
    if (meta.dbs[db].tables[name]) { if (ine) { ok(); return; } fail(`FAILED: Execution Error, return code 1 from org.apache.hadoop.hive.ql.exec.DDLTask. AlreadyExistsException(message:Table hive.${db}.${name} already exists)`); }
    const base = { name, db, external: !!ext, created: Date.now() };
    let lk;
    if ((lk = rest.match(/^like ([\w.`]+)(.*)$/))) {
      const src = getTable(m, sess, lk[1].replace(/`/g, ''));
      const st = parseStorage(lk[2]);
      const t = Object.assign(base, { cols: src.cols.map(c => Object.assign({}, c)), delim: src.delim, skipHeader: src.skipHeader, location: st.location ? hdfsAbs(m, st.location) : `${dbDir(db)}/${name}` });
      meta.dbs[db].tables[name] = t; H.mkdir(t.location, true); ev({ type: 'create_table', name }); ok(); return;
    }
    const asIdx = topClauses(rest, ['as select', 'as with']);
    if (asIdx.length) {
      const st = parseStorage(rest.slice(0, asIdx[0].i));
      const sel = rest.slice(asIdx[0].i + 3);
      const r = runSelect(m, sess, sel);
      const t = Object.assign(base, { cols: r.cols.map((c, i) => ({ name: c.startsWith('_c') ? c : c, type: r.types[i] === 'bigint' ? 'bigint' : r.types[i] || 'string', comment: '' })), delim: st.delim, skipHeader: 0, location: `${dbDir(db)}/${name}` });
      if (!(await mrLog(m, out, { reducers: r.mr && r.cols && (/group by|order by|join|distinct/.test(sel)) ? 1 : 0, loading: `Moving data to directory ${NN}${t.location}` }))) return;
      meta.dbs[db].tables[name] = t; writeRows(m, t, r.rows, true);
      ev({ type: 'create_table', name, ctas: true });
      out(`Table ${db}.${name} stats: [numFiles=1, numRows=${r.rows.length}, totalSize=${dataFiles(m, t.location).reduce((a, f) => a + byteLen(H.read(f)), 0)}, rawDataSize=0]`, 'dim');
      ok(); return;
    }
    if (!rest.startsWith('(')) fail(`FAILED: ParseException line 1:${s.indexOf(rest)} cannot recognize input near '${rest.split(' ').slice(0, 3).join("' '")}' in create table statement`);
    const close = matchParen(rest, 0); if (close < 0) fail("FAILED: ParseException line 1:0 missing ) at '<EOF>'");
    const cols = parseCols(rest.slice(1, close));
    const dup = cols.find((c, i) => cols.findIndex(x => x.name === c.name) !== i); if (dup) fail(`FAILED: SemanticException [Error 10036]: Duplicate column name: ${dup.name}`);
    const st = parseStorage(rest.slice(close + 1));
    const t = Object.assign(base, { cols, delim: st.delim, skipHeader: st.skipHeader, comment: st.comment, location: st.location ? hdfsAbs(m, st.location) : `${dbDir(db)}/${name}` });
    meta.dbs[db].tables[name] = t; H.mkdir(t.location, true);
    ev({ type: 'create_table', name, cols: cols.map(c => c.name), delim: st.delim }); ok(); return;
  }
  /* ALTER TABLE */
  if ((mm = s.match(/^alter table ([\w.`]+) (.*)$/))) {
    const t = getTable(m, sess, mm[1].replace(/`/g, ''), 12); const a = mm[2]; let x;
    if ((x = a.match(/^add columns \((.*)\)$/))) { const cols = parseCols(x[1]); for (const c of cols) if (t.cols.find(o => o.name === c.name)) fail(`FAILED: Execution Error, return code 1 from org.apache.hadoop.hive.ql.exec.DDLTask. Duplicate column name: ${c.name}`); t.cols.push(...cols); ev({ type: 'alter', op: 'add', table: t.name }); ok(); return; }
    if ((x = a.match(/^replace columns \((.*)\)$/))) { t.cols = parseCols(x[1]); ev({ type: 'alter', op: 'replace', table: t.name }); ok(); return; }
    if ((x = a.match(/^change (?:column )?`?(\w+)`? `?(\w+)`? ([\w<>(), ]+?)(?: comment '(.*?)')?( first| after (\w+))?$/))) {
      const i = t.cols.findIndex(c => c.name === x[1]); if (i < 0) fail(`FAILED: Execution Error, return code 1 from org.apache.hadoop.hive.ql.exec.DDLTask. Invalid column reference ${x[1]}`);
      if (x[2] !== x[1] && t.cols.find(c => c.name === x[2])) fail(`FAILED: Execution Error, return code 1 from org.apache.hadoop.hive.ql.exec.DDLTask. Duplicate column name: ${x[2]}`);
      if (!TYPES.test(x[3].trim())) fail(`FAILED: ParseException line 1:${s.indexOf(x[3])} cannot recognize input near '${x[3]}'`);
      const col = { name: x[2], type: x[3].trim().replace(/\binteger\b/, 'int'), comment: x[4] || t.cols[i].comment };
      t.cols.splice(i, 1);
      if (x[5] === ' first') t.cols.unshift(col); else if (x[6]) { const j = t.cols.findIndex(c => c.name === x[6]); t.cols.splice(j + 1, 0, col); } else t.cols.splice(i, 0, col);
      ev({ type: 'alter', op: 'change', table: t.name, from: x[1], to: x[2] }); ok(); return;
    }
    if ((x = a.match(/^rename to ([\w.`]+)$/))) {
      const nn = x[1].replace(/`/g, '').split('.').pop(); if (meta.dbs[t.db].tables[nn]) fail(`FAILED: Execution Error, return code 1 from org.apache.hadoop.hive.ql.exec.DDLTask. Unable to alter table. New table ${t.db}.${nn} already exists`);
      delete meta.dbs[t.db].tables[t.name];
      if (!t.external) { const nl = `${dbDir(t.db)}/${nn}`; if (H.exists(t.location)) { H.copy(t.location, nl); H.rm(t.location); } t.location = nl; }
      t.name = nn; meta.dbs[t.db].tables[nn] = t; ev({ type: 'alter', op: 'rename', table: nn }); ok(); return;
    }
    if (/^drop column/.test(a)) fail(`FAILED: ParseException line 1:${12 + mm[1].length + 1} cannot recognize input near 'drop' 'column' in alter table statement\n(Hive has no DROP COLUMN. Use ALTER TABLE ${t.name} REPLACE COLUMNS (...) with the columns you want to keep.)`);
    if (/^set tblproperties/.test(a)) { ok(); return; }
    fail(`FAILED: ParseException line 1:${12 + mm[1].length + 1} cannot recognize input near '${a.split(' ').slice(0, 2).join("' '")}' in alter table statement`);
  }
  if ((mm = s.match(/^drop table (if exists )?([\w.`]+)( purge)?$/))) {
    const t = findTable(m, sess, mm[2].replace(/`/g, ''));
    if (!t) { ok(); return; }
    delete meta.dbs[t.db].tables[t.name]; if (!t.external) H.rm(t.location);
    ev({ type: 'drop_table', name: t.name }); ok(); return;
  }
  if ((mm = s.match(/^truncate table ([\w.`]+)$/))) { const t = getTable(m, sess, mm[1].replace(/`/g, '')); if (t.external) fail(`FAILED: SemanticException [Error 10146]: Cannot truncate non-managed table ${t.name}.`); for (const f of H.list(t.location)) H.rm(H.join(t.location, f)); ev({ type: 'truncate', name: t.name }); ok(); return; }
  /* LOAD DATA */
  if ((mm = s.match(/^load data (local )?inpath ('(?:\\.|[^'])*') (overwrite )?into table ([\w.`]+)(?: partition.*)?$/))) {
    const local = !!mm[1]; const p = unq(mm[2]); const t = getTable(m, sess, mm[4].replace(/`/g, ''), s.indexOf(mm[4]));
    let srcFiles = [];
    if (local) {
      const abs = m.local.norm(p.replace(/^file:\/\//, ''), sess.cwd);
      if (!m.local.exists(abs)) fail(`FAILED: SemanticException Line 1:23 Invalid path ''${p}'': No files matching path file:${abs}`);
      srcFiles = m.local.isDir(abs) ? m.local.list(abs).map(k => ({ name: k, data: m.local.read(m.local.join(abs, k)) })) : [{ name: abs.split('/').pop(), data: m.local.read(abs) }];
    } else {
      const abs = hdfsAbs(m, p);
      const list = G.SIM.hasGlob(abs) ? H.glob(abs, '/') : [abs];
      if (!list.length || !H.exists(list[0])) fail(`FAILED: SemanticException Line 1:17 Invalid path ''${p}'': No files matching path ${NN}${abs}`);
      for (const f of list) { if (H.isDir(f)) { for (const k of H.list(f)) if (H.isFile(H.join(f, k))) { srcFiles.push({ name: k, data: H.read(H.join(f, k)), path: H.join(f, k) }); } } else srcFiles.push({ name: f.split('/').pop(), data: H.read(f), path: f }); }
    }
    out(`Loading data to table ${t.db}.${t.name}`);
    H.mkdir(t.location, true);
    if (mm[3]) for (const f of H.list(t.location)) H.rm(H.join(t.location, f));
    for (const f of srcFiles) { H.write(H.join(t.location, nextName(m, t.location, f.name)), f.data); if (f.path) H.rm(f.path); }
    ev({ type: 'load', table: t.name, local, overwrite: !!mm[3], src: p });
    ok(); return;
  }
  /* INSERT OVERWRITE DIRECTORY */
  if ((mm = s.match(/^insert overwrite (local )?directory ('(?:\\.|[^'])*')\s*(.*?)\s*(select .*)$/))) {
    const st = parseStorage(mm[3]); const r = runSelect(m, sess, mm[4]);
    if (!(await mrLog(m, out, { reducers: r.mr ? 1 : 0, loading: `Moving data to: ${mm[1] ? '' : NN}${unq(mm[2])}` }))) return;
    const text = r.rows.length ? r.rows.map(row => row.map((v, i) => serVal(v, r.types[i])).join(st.delim)).join('\n') + '\n' : '';
    if (mm[1]) { const abs = m.local.norm(unq(mm[2]), sess.cwd); m.local.rm(abs); m.local.mkdir(abs, true); m.local.write(abs + '/000000_0', text); }
    else { const abs = hdfsAbs(m, unq(mm[2])); H.rm(abs); H.mkdir(abs, true); H.write(abs + '/000000_0', text); }
    ev({ type: 'insert_dir', path: unq(mm[2]), rows: r.rows });
    ok(); return;
  }
  /* INSERT INTO / OVERWRITE TABLE */
  if ((mm = s.match(/^insert (into|overwrite) (?:table )?([\w.`]+)(?: partition\s*\([^)]*\))?\s*(\(([^)]*)\))?\s*(values .*|select .*|from .*)$/))) {
    const t = getTable(m, sess, mm[2].replace(/`/g, ''), s.indexOf(mm[2])); const overwrite = mm[1] === 'overwrite';
    const body = mm[5]; let rows;
    if (body.startsWith('values')) {
      if (overwrite && false) fail('');
      const tuples = []; let i = body.indexOf('(');
      while (i >= 0) { const j = matchParen(body, i); if (j < 0) fail("FAILED: ParseException line 1:0 missing ) at '<EOF>'"); tuples.push(body.slice(i + 1, j)); i = body.indexOf('(', j); }
      rows = tuples.map(tp => splitTop(tp, ',').map(v => { v = v.trim(); if (/^'.*'$/.test(v)) return unq(v); if (v === 'null') return null; if (v === 'true' || v === 'false') return v === 'true'; if (/^[-+]?\d+(\.\d+)?$/.test(v)) return Number(v); fail(`FAILED: SemanticException [Error 10293]: Unable to create temp file for insert values Expression of type TOK_TABLE_OR_COL not supported in insert/values`); }));
    } else {
      const r = runSelect(m, sess, body);
      rows = r.rows;
      if (r.cols.length !== t.cols.length) fail(`FAILED: SemanticException [Error 10044]: Line 1:${s.indexOf(mm[2])} Cannot insert into target table because column number/types are different '${t.name}': Table insclause-0 has ${t.cols.length} columns, but query has ${r.cols.length} columns.`);
      var sel = r;
    }
    const bad = rows.find(r => r.length !== t.cols.length);
    if (bad) fail(`FAILED: SemanticException [Error 10044]: Line 1:${s.indexOf(mm[2])} Cannot insert into target table because column number/types are different '${t.name}': Table insclause-0 has ${t.cols.length} columns, but query has ${bad.length} columns.`);
    if (!(await mrLog(m, out, { reducers: sel && sel.mr ? 1 : 0, loading: `Loading data to table ${t.db}.${t.name}` }))) return;
    writeRows(m, t, rows, overwrite);
    ev({ type: 'insert', table: t.name, overwrite, count: rows.length });
    ok(); return;
  }
  /* EXPORT / IMPORT */
  if ((mm = s.match(/^export table ([\w.`]+) to ('(?:\\.|[^'])*')$/))) {
    const t = getTable(m, sess, mm[1].replace(/`/g, ''), 13); const abs = hdfsAbs(m, unq(mm[2]));
    if (H.exists(abs) && (!H.isDir(abs) || H.list(abs).length)) fail(`FAILED: SemanticException [Error 10106]: Line 1:${s.indexOf(mm[2])} Invalid path ${mm[2]}: Target is not an empty directory : ${NN}${abs}`);
    H.mkdir(abs + '/data', true);
    H.write(abs + '/_metadata', JSON.stringify({ version: '0.2', fcversion: '0.1', table: { tableName: t.name, dbName: t.db, tableType: t.external ? 'EXTERNAL_TABLE' : 'MANAGED_TABLE', cols: t.cols.map(c => ({ name: c.name, type: c.type })), fieldDelim: t.delim, skipHeader: t.skipHeader || 0 }, partitions: [] }, null, 1));
    for (const f of dataFiles(m, t.location)) H.write(abs + '/data/' + f.split('/').pop(), H.read(f));
    ev({ type: 'export', table: t.name, path: abs }); ok(); return;
  }
  if ((mm = s.match(/^import (external )?(?:table ([\w.`]+) )?from ('(?:\\.|[^'])*')(?: location ('(?:\\.|[^'])*'))?$/))) {
    const abs = hdfsAbs(m, unq(mm[3]));
    if (!H.exists(abs + '/_metadata')) fail(`FAILED: SemanticException [Error 10027]: Line 1:${s.indexOf(mm[3])} Invalid path ${mm[3]}: No _metadata file found at ${NN}${abs}`);
    const md = JSON.parse(H.read(abs + '/_metadata')).table;
    let ref = (mm[2] || md.tableName).replace(/`/g, ''); let db = sess.db, name = ref; if (ref.includes('.')) [db, name] = ref.split('.');
    let t = meta.dbs[db].tables[name];
    if (t && dataFiles(m, t.location).length) fail(`FAILED: SemanticException [Error 10119]: Table exists and contains data files`);
    out(`Copying data from ${NN}${abs}/data`);
    for (const k of H.list(abs + '/data')) out(`Copying file: ${NN}${abs}/data/${k}`);
    if (!t) { t = { name, db, external: !!mm[1], created: Date.now(), cols: md.cols.map(c => ({ name: c.name, type: c.type, comment: '' })), delim: md.fieldDelim, skipHeader: md.skipHeader || 0, location: mm[4] ? hdfsAbs(m, unq(mm[4])) : `${dbDir(db)}/${name}` }; meta.dbs[db].tables[name] = t; }
    H.mkdir(t.location, true);
    for (const k of H.list(abs + '/data')) H.write(H.join(t.location, k), H.read(abs + '/data/' + k));
    out(`Loading data to table ${db}.${name}`);
    ev({ type: 'import', table: name, path: abs }); ok(); return;
  }
  if (/^show functions/.test(s)) { out('OK'); ['abs', 'avg', 'concat', 'count', 'lower', 'max', 'min', 'round', 'sum', 'upper'].forEach(f => out(f)); okRows(10); return; }
  if (/^show partitions/.test(s)) fail('FAILED: Execution Error, return code 1 from org.apache.hadoop.hive.ql.exec.DDLTask. Table is not a partitioned table');
  /* SELECT */
  if (/^(select|with)\b/.test(s) || /^\(select/.test(s)) {
    const r = runSelect(m, sess, s.replace(/^\((.*)\)$/, '$1'));
    if (r.mr) { if (!(await mrLog(m, out, { reducers: r.reducers, fixed: r.reducers > 1 }))) return; }
    out('OK');
    if (header()) out(r.cols.map(c => r.multi ? c : c).join('\t'));
    r.rows.forEach(row => out(row.map((v, i) => fmtVal(v, r.types[i])).join('\t')));
    ev({ type: 'select', cols: r.cols, rows: r.rows.map(row => row.map((v, i) => fmtVal(v, r.types[i]))) });
    okRows(r.rows.length); return;
  }
  const first = s.split(' ').slice(0, 3);
  fail(`FAILED: ParseException line 1:0 cannot recognize input near '${first.join("' '")}'`);
}

/* ---------- Hive shell mode ---------- */
async function start(m, args, io) {
  if (!m.svc.dfs) {
    io.print('Hive Session ID = ' + uuid());
    io.error(`Exception in thread "main" java.lang.RuntimeException: java.net.ConnectException: Call From gls-university/127.0.1.1 to localhost:9000 failed on connection exception: java.net.ConnectException: Connection refused\n\tat org.apache.hadoop.hive.ql.session.SessionState.start(SessionState.java:651)\n\tat org.apache.hadoop.hive.cli.CliDriver.run(CliDriver.java:683)`);
    io.error('(HDFS is not running. Start it with  start-dfs.sh  and check with  jps)');
    return 1;
  }
  ms(m);
  const sess = { db: 'default', conf: {}, cwd: m.cwd, buf: [] };
  const say = (t, c) => m.out(t, c);
  const ei = args.indexOf('-e'), fi = args.indexOf('-f');
  if (ei >= 0 || fi >= 0) {
    let text = ei >= 0 ? args[ei + 1] : m.local.read(m.local.norm(args[fi + 1], m.cwd));
    if (text === null) { io.error(`Could not open input file for reading. (${args[fi + 1]} (No such file or directory))`); return 1; }
    say('Hive Session ID = ' + uuid(), 'dim');
    for (const st of splitStatements(text)) { try { await execStmt(m, sess, st, say); } catch (e) { if (e instanceof HiveError) { say(e.message, 'err'); return 1; } throw e; } }
    return 0;
  }
  say('Hive Session ID = ' + uuid(), 'dim');
  say('\nLogging initialized using configuration in jar:file:/usr/local/hive/lib/hive-common-3.1.3.jar!/hive-log4j2.properties Async: true', 'dim');
  say('Hive-on-MR is deprecated in Hive 2 and may not be available in the future versions. Consider using a different execution engine (i.e. spark, tez) or using Hive 1.X releases.', 'dim');
  const mode = {
    name: 'hive', sess,
    cancel() { sess.buf = []; },
    eof() { m.modes.pop(); m.event({ kind: 'hive', type: 'quit' }); },
    prompt: () => sess.buf.length ? { sym: '    > ' } : { sym: 'hive> ' },
    async feed(line) {
      if (!sess.buf.length && !line.trim()) return;
      sess.buf.push(line);
      const text = sess.buf.join('\n');
      if (!endsStatement(text)) return;
      sess.buf = [];
      m.history.push(text.replace(/\n/g, ' '));
      for (const st of splitStatements(text)) {
        try { await execStmt(m, sess, st, say); }
        catch (e) { if (e instanceof HiveError) { say(e.message, 'err'); m.event({ kind: 'hive', sql: normalize(st), error: e.message }); } else { say('FAILED: ' + (e && e.message || e), 'err'); if (G.__SIM_DEBUG) console.error(e); } }
        if (sess.quit) { m.modes.pop(); m.event({ kind: 'hive', type: 'quit' }); return; }
      }
    },
  };
  m.modes.push(mode);
  m.event({ kind: 'hive', type: 'start' });
  return 0;
}
function endsStatement(text) { let q = null; let lastNon = ''; const clean = text.replace(/--[^\n]*/g, ''); for (let i = 0; i < clean.length; i++) { const c = clean[i]; if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; } if (c === "'" || c === '"') q = c; if (!/\s/.test(c)) lastNon = c; } return !q && lastNon === ';'; }
function splitStatements(text) { const out = []; let cur = '', q = null; const clean = text.split('\n').map(l => l.replace(/^\s*--.*$/, '')).join('\n'); for (let i = 0; i < clean.length; i++) { const c = clean[i]; if (q) { cur += c; if (c === '\\') { cur += clean[++i]; continue; } if (c === q) q = null; continue; } if (c === "'" || c === '"') q = c; if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; } cur += c; } if (cur.trim()) out.push(cur.trim()); return out; }
function uuid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); }
function names(m) { if (!m.hive) return []; const mode = m.modes.find(x => x.name === 'hive'); const db = mode ? mode.sess.db : 'default'; return Object.keys((m.hive.dbs[db] || { tables: {} }).tables).concat(Object.keys(m.hive.dbs)); }

G.HIVE = { start, execStmt, runSelect, normalize, names, javaDouble, readTable, HiveError, splitStatements };
G.javaDouble = javaDouble;
})(typeof window !== 'undefined' ? window : globalThis);
