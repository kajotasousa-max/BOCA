// Simula o Apps Script (SpreadsheetApp etc.) e serve o site + a API na mesma porta.
const fs = require('fs'), http = require('http'), path = require('path'), crypto = require('crypto'), vm = require('vm');
const SITE = process.argv[2], PORTA = Number(process.argv[3] || 8790);

function A1(a1) { // "J5:J34" ou "D3"
  const m = a1.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  const col = s => s.split('').reduce((t, c) => t * 26 + c.charCodeAt(0) - 64, 0);
  const r1 = +m[2], c1 = col(m[1]), r2 = m[4] ? +m[4] : r1, c2 = m[3] ? col(m[3]) : c1;
  return [r1, c1, r2 - r1 + 1, c2 - c1 + 1];
}
function Sheet(nome, linhas, colunas) {
  const g = Array.from({ length: linhas }, () => Array(colunas).fill(''));
  const notas = Array.from({ length: linhas }, () => Array(colunas).fill(''));
  const sh = {
    g, notas, getName: () => nome, getMaxRows: () => g.length,
    insertRowsAfter(_, n) { for (let i = 0; i < n; i++) g.push(Array(colunas).fill('')); },
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') [r, c, nr, nc] = A1(r);
      nr = nr || 1; nc = nc || 1;
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (g[r - 1 + i] || [])[c - 1 + j] ?? '')),
        getValue: () => g[r - 1][c - 1],
        getNotes: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (notas[r - 1 + i] || [])[c - 1 + j] ?? '')),
        setNote(t) { notas[r - 1][c - 1] = t; return this; },
        setNumberFormat() { return this; },
        setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { g[r - 1 + i][c - 1 + j] = typeof x === 'string' && x[0] === "'" ? x.slice(1) : x; })); },
        setValue(x) { g[r - 1][c - 1] = x; return this; },
        clearContent() { g[r - 1][c - 1] = ''; },
        deleteCells() { // sobe as células de baixo dentro das colunas c..c+nc-1
          for (let i = r - 1; i < g.length; i++) for (let j = c - 1; j < c - 1 + nc; j++) { g[i][j] = i + nr < g.length ? g[i + nr][j] : ''; notas[i][j] = i + nr < g.length ? notas[i + nr][j] : ''; }
        }
      };
    }
  };
  return sh;
}
const hist = Sheet('HISTÓRICO', 30, 28), cad = Sheet('Cadastros', 40, 26), vendas = Sheet('VENDAS', 20, 7);
['Água de coco', 'Morango', 'Maracujá', 'Maçã Verde', 'Bob', 'Melancia', 'Limão', 'Laranja', 'Limão com sal', 'Frutas cítricas', 'Frutas vermelhas', 'Abacaxi', 'Brasil']
  .forEach((s, i) => { cad.g[4 + i][9] = 'S.' + String(i + 1).padStart(2, '0') + ' - ' + s; });
vendas.g[2][3] = 39;
const lancar = Sheet('LANÇAR', 40, 20);
// histórico: 2 dias já lançados à mão
lancar.g[5][0] = new Date(2026, 10, 24); lancar.g[5][1] = 'S.04 - Maçã Verde'; lancar.g[5][2] = 0.33; lancar.g[5][3] = 0.36;
lancar.g[6][1] = 'S.03 - Maracujá'; lancar.g[6][2] = 0.4; lancar.g[6][3] = 0.43;
lancar.g[5][6] = new Date(2026, 10, 24); lancar.g[5][17] = 'anotado à mão';
const abas = { 'HISTÓRICO': hist, 'Cadastros': cad, 'VENDAS': vendas, 'LANÇAR': lancar };
const props = {};
const pad = n => String(n).padStart(2, '0');
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => abas[n] }), openById: () => null, flush() {}, Dimension: { ROWS: 1 } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { createTextOutput: t => ({ t, setMimeType() { return this; } }), MimeType: { JSON: 1 } },
  Session: { getScriptTimeZone: () => 'America/Sao_Paulo' },
  Utilities: {
    formatDate(d, tz, f) { return f.replace('yyyy', d.getFullYear()).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate())).replace('HH', pad(d.getHours())).replace('mm', pad(d.getMinutes())); },
    getUuid: () => crypto.randomUUID(), sleep() {},
    computeDigest: (a, s) => [...crypto.createHash('sha256').update(s).digest()], base64Encode: b => Buffer.from(b).toString('base64'),
    DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 }
  },
  Date, Math, JSON, Number, String, Object, Array, Error, isFinite
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(SITE, 'backend/Code.gs'), 'utf8'), ctx);
if (process.env.SENHA) { props.SENHA_ESCRITORIO = vm.runInContext(`hashSenha_(${JSON.stringify(process.env.SENHA)})`, ctx); props.SENHA_OPERADOR = vm.runInContext(`hashSenha_("1234")`, ctx); }
ctx.__hist = hist; ctx.__vendas = vendas;

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      if (process.env.OFFLINE && fs.existsSync('/tmp/offline')) { res.destroy(); return; }
      const e = { parameter: Object.fromEntries(u.searchParams), postData: req.method === 'POST' ? { contents: body } : undefined };
      const out = req.method === 'POST' ? ctx.doPost(e) : ctx.doGet(e);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(out.t);
    });
    return;
  }
  if (u.pathname === '/__lancar') { res.end(JSON.stringify(lancar.g.slice(5, 12).map((r, i) => [r.slice(0, 4).concat(r.slice(6, 10), [r[17]]).map(x => x instanceof Date ? x.toISOString().slice(0, 10) : x), lancar.notas[5 + i][1]]))); return; }
  if (u.pathname === '/__hist') { res.end(JSON.stringify(hist.g.slice(0, 14).map(r => r.map(x => x instanceof Date ? x.toISOString().slice(0, 10) : x)))); return; }
  let f = path.join(SITE, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  let txt = fs.readFileSync(f);
  if (f.endsWith('config.js')) txt = String(txt).replace(/api: '[^']*'/, "api: 'http://localhost:" + PORTA + "/api'");
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'text/plain' });
  res.end(txt);
}).listen(PORTA, () => console.log('ok ' + PORTA));
