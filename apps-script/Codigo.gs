// BOCA GELADA — script único
// 1) CELULAR do operador (página no GitHub): toca no sabor e em "CAIU GELO" -> entra no estoque
// 2) VENDAS: vendedor digita as caixas e aperta Enter -> sai do estoque
// Tudo fica gravado na aba HISTÓRICO.

const PLANILHA_ID = '1XRadgrQiI6JKQEU4ubK0jzzfZVl21cxNRnnf_sksGyU';

// ---------- recebe o apontamento da página do celular (GitHub) ----------
function doPost(e) {
  const d = JSON.parse(e.postData.contents || '{}');
  let r = {};
  if (d.acao === 'caiu') r = caiuGelo(d.sabor, d.formas);
  r.hoje = totalHoje();
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
}

function planilha() { return SpreadsheetApp.openById(PLANILHA_ID); }

function hojeEHora() {
  const agora = new Date();
  const hoje = new Date(agora); hoje.setHours(0, 0, 0, 0);
  return [hoje, Utilities.formatDate(agora, Session.getScriptTimeZone(), 'HH:mm')];
}

function proximaLinha(sh, coluna) {
  const v = sh.getRange(4, coluna, 4997, 1).getValues();
  let ultima = -1;
  v.forEach((x, i) => { if (x[0] !== '') ultima = i; });
  return 4 + ultima + 1;
}

// o celular chama isto quando o operador toca em "CAIU GELO"
function caiuGelo(sabor, formas) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    formas = Number(formas) || 19;
    const caixas = Math.round(formas * 16 / 30);       // 19 formas = 10 caixas
    const [hoje, hora] = hojeEHora();
    const hist = planilha().getSheetByName('HISTÓRICO');
    hist.getRange(proximaLinha(hist, 9), 9, 1, 5).setValues([[hoje, hora, sabor, formas, caixas]]);
    SpreadsheetApp.flush();
    return { caixas: caixas, hora: hora };
  } finally { lock.releaseLock(); }
}

// caixas produzidas hoje, no total e por sabor (pra página mostrar as barras)
function totalHoje() {
  const [hoje] = hojeEHora();
  const v = planilha().getSheetByName('HISTÓRICO').getRange('I4:M5000').getValues();
  let cx = 0, ciclos = 0; const porSabor = {};
  v.forEach(r => {
    if (r[0] instanceof Date && r[0].setHours(0, 0, 0, 0) === hoje.getTime()) {
      const c = Number(r[4]) || 0;
      cx += c; ciclos++;
      porSabor[r[2]] = (porSabor[r[2]] || 0) + c;
    }
  });
  return { caixas: cx, ciclos: ciclos, porSabor: porSabor };
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

  const [hoje, hora] = hojeEHora();
  const dia = sh.getRange('G3').getValue();
  if (!(dia instanceof Date) || dia.getTime() !== hoje.getTime()) {
    sh.getRange('G5:G17').setValue(0);
    sh.getRange('G3').setValue(hoje);
  }
  const total = sh.getRange(r, 6), doDia = sh.getRange(r, 7);
  total.setValue((Number(total.getValue()) || 0) + qtd);
  doDia.setValue((Number(doDia.getValue()) || 0) + qtd);

  const sabor = sh.getRange(r, 1).getValue();
  const hist = SpreadsheetApp.getActive().getSheetByName('HISTÓRICO');
  hist.getRange(proximaLinha(hist, 1), 1, 1, 4).setValues([[hoje, hora, sabor, qtd]]);
  sh.getRange('A19').setValue('✔ ' + qtd + ' cx de ' + sabor + ' (' + hora + ')');
}
