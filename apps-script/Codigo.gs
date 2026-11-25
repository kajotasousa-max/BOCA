// BOCA GELADA — script único (Extensões › Apps Script da planilha)
// 1) GD no celular (GitHub): salva cada ciclo no HISTÓRICO -> o estoque sobe
// 2) VENDAS: vendedor digita as caixas e aperta Enter -> o estoque desce
//
// HISTÓRICO, colunas da produção:
//  I DATA | J HORA FIM | K SABOR | L QTD (un) | M CAIXAS | N MÁQUINA | O INÍCIO | P OPERADOR | Q TURNO | R OBS | S ID
// HISTÓRICO, desperdício (uma linha por dia):  U DATA | V JARRA (ml) | W PÓ (g)

const PLANILHA_ID = '1XRadgrQiI6JKQEU4ubK0jzzfZVl21cxNRnnf_sksGyU';
const UN_POR_CAIXA = 30;

// ---------- recebe os pedidos do GD ----------
function doPost(e) {
  const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    if (d.acao === 'salvar')  salvarCiclo(d.data, d.ciclo);
    if (d.acao === 'excluir') excluirCiclo(d.id);
    if (d.acao === 'perda')   salvarPerda(d.data, d.jarra, d.po);
    SpreadsheetApp.flush();
    return json(lerDia(d.data));
  } finally { lock.releaseLock(); }
}

function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function hist() { return SpreadsheetApp.openById(PLANILHA_ID).getSheetByName('HISTÓRICO'); }
function tz() { return Session.getScriptTimeZone(); }
function iso(d) { return Utilities.formatDate(d, tz(), 'yyyy-MM-dd'); }
function paraData(s) { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function hhmm(v) { return v instanceof Date ? Utilities.formatDate(v, tz(), 'HH:mm') : String(v || ''); }

function proximaLinha(sh, coluna) {
  const v = sh.getRange(4, coluna, sh.getMaxRows() - 3, 1).getValues();
  let ultima = -1;
  v.forEach((x, i) => { if (x[0] !== '') ultima = i; });
  return 4 + ultima + 1;
}

function salvarCiclo(data, c) {
  const sh = hist();
  const qtd = Number(c.qty) || 0;
  const caixas = Math.round(qtd / UN_POR_CAIXA);
  sh.getRange(proximaLinha(sh, 9), 9, 1, 11).setValues([[
    paraData(data), "'" + c.endTime, c.flavor, qtd, caixas, c.machine,
    "'" + c.startTime, c.operator || '', c.shift || '', c.notes || '', c.id
  ]]);
}

function excluirCiclo(id) {
  const sh = hist();
  const ids = sh.getRange(4, 19, sh.getMaxRows() - 3, 1).getValues();
  const i = ids.findIndex(r => r[0] === id);
  if (i >= 0) sh.getRange(4 + i, 9, 1, 11).deleteCells(SpreadsheetApp.Dimension.ROWS);
}

function salvarPerda(data, jarra, po) {
  const sh = hist();
  const datas = sh.getRange(4, 21, sh.getMaxRows() - 3, 1).getValues();
  let i = datas.findIndex(r => r[0] instanceof Date && iso(r[0]) === data);
  const linha = i >= 0 ? 4 + i : proximaLinha(sh, 21);
  sh.getRange(linha, 21, 1, 3).setValues([[paraData(data), Number(jarra) || 0, Number(po) || 0]]);
}

// devolve tudo do dia pro GD montar a tela
function lerDia(data) {
  const sh = hist();
  const n = sh.getMaxRows() - 3;
  const ciclos = sh.getRange(4, 9, n, 11).getValues()
    .filter(r => r[0] instanceof Date && iso(r[0]) === data)
    .map(r => ({
      endTime: hhmm(r[1]), flavor: r[2], qty: Number(r[3]) || 0, caixas: Number(r[4]) || 0,
      machine: r[5], startTime: hhmm(r[6]), operator: r[7], shift: r[8], notes: r[9], id: r[10]
    }));
  const p = sh.getRange(4, 21, n, 3).getValues().find(r => r[0] instanceof Date && iso(r[0]) === data);
  return { ok: true, ciclos: ciclos, perda: { jarMl: p ? Number(p[1]) || 0 : 0, powderG: p ? Number(p[2]) || 0 : 0 } };
}

// ---------- VENDAS: vendi agora ----------
function onEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  const r = e.range.getRow();
  if (sh.getName() !== 'VENDAS' || e.range.getColumn() !== 2 || r < 5 || r > 17) return;
  const qtd = Number(e.value);
  e.range.clearContent();
  if (!qtd) return;

  const agora = new Date();
  const hoje = new Date(agora); hoje.setHours(0, 0, 0, 0);
  const hora = Utilities.formatDate(agora, tz(), 'HH:mm');
  const dia = sh.getRange('G3').getValue();
  if (!(dia instanceof Date) || dia.getTime() !== hoje.getTime()) {
    sh.getRange('G5:G17').setValue(0);
    sh.getRange('G3').setValue(hoje);
  }
  const total = sh.getRange(r, 6), doDia = sh.getRange(r, 7);
  total.setValue((Number(total.getValue()) || 0) + qtd);
  doDia.setValue((Number(doDia.getValue()) || 0) + qtd);

  const sabor = sh.getRange(r, 1).getValue();
  const h = SpreadsheetApp.getActive().getSheetByName('HISTÓRICO');
  h.getRange(proximaLinha(h, 1), 1, 1, 4).setValues([[hoje, hora, sabor, qtd]]);
  sh.getRange('A19').setValue('✔ ' + qtd + ' cx de ' + sabor + ' (' + hora + ')');
}
