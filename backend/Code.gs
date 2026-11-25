/**
 * BOCA GELADA — Sistema de Produção, Estoque e Vendas
 * Apps Script da planilha "PRODUÇÃO BOCA GELADA" (Extensões › Apps Script),
 * publicado como App da Web. Contrato em docs/API.md.
 *
 * A aba HISTÓRICO é a fonte única dos dados:
 *   A:D   VENDAS      DATA | HORA | SABOR | CAIXAS (estorno = caixas negativas)
 *   I:S   PRODUÇÃO    DATA | HORA FIM | SABOR | QTD (un) | CAIXAS | MÁQUINA | INÍCIO | OPERADOR | TURNO | OBS | ID
 *   U:W   DESPERDÍCIO DATA | JARRA (ml) | PÓ (g)            (uma linha por dia)
 *   Y:AB  AJUSTES     DATA | SABOR | CAIXAS (±) | MOTIVO
 * As abas VENDAS e OPERADOR (monitor) calculam o estoque a partir dela.
 *
 * Cada ciclo também é copiado para a aba LANÇAR (como se o quadro fosse digitado),
 * e o fechamento do dia (realizado, pó, gelo perdido) é refeito a cada apontamento.
 * Assim Ciclos, Painel, Resumo Diário e as demais análises seguem atualizando.
 *
 * Estoque de cada sabor = cheio (VENDAS!D3) + produzido − vendido + ajustes.
 *
 * Senhas (menu "Boca Gelada" da planilha):
 *   Escritório → tudo.  Operador → só aponta produção e desperdício.
 *   O painel (estoque) abre sem senha: é o que aparece no monitor da fábrica.
 */

const VERSAO = '1.1.0';
const PLANILHA_ID = '1XRadgrQiI6JKQEU4ubK0jzzfZVl21cxNRnnf_sksGyU';
const UN_POR_CAIXA = 30;
const CAIXAS_POR_CICLO = 10;      // 19 formas × 16 un ≈ 304 un ≈ 10 cx
const LIMITE_BAIXO = 0.5;         // abaixo de 50% do cheio = BAIXO

const COL = { venda: 1, producao: 9, perda: 21, ajuste: 25 };   // A, I, U, Y
const LARG = { venda: 4, producao: 11, perda: 3, ajuste: 4 };

/* ======================= ACESSO ======================= */

const PUBLICO = { get: ['painel', 'versao'], post: [] };
const OPERADOR_PODE = { get: ['nivel', 'dia'], post: ['producao', 'excluir-producao', 'perda'] };

function props_() { return PropertiesService.getScriptProperties(); }

function hashSenha_(senha) {
  const p = props_();
  let sal = p.getProperty('SAL');
  if (!sal) { sal = Utilities.getUuid(); p.setProperty('SAL', sal); }
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sal + '|' + String(senha), Utilities.Charset.UTF_8);
  return Utilities.base64Encode(b);
}

/** 'livre' (sem senha definida), 'escritorio', 'operador' ou null (senha errada). */
function nivelDe_(senha) {
  const p = props_();
  const esc = p.getProperty('SENHA_ESCRITORIO'), op = p.getProperty('SENHA_OPERADOR');
  if (!esc && !op) return 'livre';
  if (!senha) return null;
  const h = hashSenha_(senha);
  if (esc && h === esc) return 'escritorio';
  if (op && h === op) return 'operador';
  return null;
}

function recusa_(e, metodo, acao) {
  if (PUBLICO[metodo].indexOf(acao) >= 0) return null;
  const nivel = nivelDe_(e && e.parameter && e.parameter.k);
  if (nivel === null) {
    Utilities.sleep(1500);
    return json({ ok: false, semAcesso: true, erro: 'Senha inválida.' });
  }
  if (nivel === 'operador' && OPERADOR_PODE[metodo].indexOf(acao) < 0) {
    return json({ ok: false, semPermissao: true, erro: 'A senha do operador só aponta produção.' });
  }
  return null;
}

/* ======================= ENTRADAS HTTP ======================= */

function doGet(e) {
  const p = (e && e.parameter) || {};
  const acao = p.action || 'painel';
  try {
    const r = recusa_(e, 'get', acao);
    if (r) return r;
    switch (acao) {
      case 'painel':  return json(Object.assign({ ok: true }, painel_()));
      case 'versao':  return json({ ok: true, versao: VERSAO });
      case 'nivel':   return json({ ok: true, nivel: nivelDe_(p.k), versao: VERSAO });
      case 'dia':     return json(Object.assign({ ok: true }, lerDia_(p.data || hojeIso_())));
      case 'periodo': return json(Object.assign({ ok: true }, periodo_(p.de, p.ate)));
      default:        return json({ ok: false, erro: 'Ação desconhecida: ' + acao });
    }
  } catch (err) { return json({ ok: false, erro: String(err && err.message || err) }); }
}

function doPost(e) {
  let b;
  try { b = JSON.parse((e && e.postData && e.postData.contents) || 'null') || {}; }
  catch (err) { return json({ ok: false, erro: 'JSON inválido.' }); }
  const r = recusa_(e, 'post', String(b.kind));
  if (r) return r;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const data = b.data || hojeIso_();
    avisoQuadro = '';
    switch (b.kind) {
      case 'producao':         salvarProducao_(data, b.ciclo || {}); quadro_(() => { lancarNoQuadro_(data, b.ciclo || {}); fecharDia_(data); }); break;
      case 'excluir-producao': excluirProducao_(b.id); quadro_(() => { excluirDoQuadro_(b.id); fecharDia_(data); }); break;
      case 'perda':            salvarPerda_(data, b.jarra, b.po); quadro_(() => fecharDia_(data)); break;
      case 'venda':            lancar_('venda', [paraData_(data), "'" + horaAgora_(), sabor_(b.sabor), inteiro_(b.caixas)]); break;
      case 'ajuste':           lancar_('ajuste', [paraData_(data), sabor_(b.sabor), inteiro_(b.caixas), String(b.motivo || '')]); break;
      default:                 return json({ ok: false, erro: 'kind desconhecido: ' + b.kind });
    }
    SpreadsheetApp.flush();
    return json(Object.assign({ ok: true }, lerDia_(data), { painel: painel_() }, avisoQuadro ? { aviso: avisoQuadro } : {}));
  } catch (err) {
    return json({ ok: false, erro: String(err && err.message || err) });
  } finally { lock.releaseLock(); }
}

/* ======================= GRAVAÇÕES ======================= */

function salvarProducao_(data, c) {
  const sh = hist_();
  const qtd = inteiro_(c.qty);
  if (qtd <= 0) throw new Error('Quantidade inválida.');
  if (!c.id) c.id = Utilities.getUuid();
  if (acharLinha_(sh, COL.producao + 10, c.id) > 0) return;   // reenvio do celular: já gravado
  lancar_('producao', [
    paraData_(data), "'" + (c.endTime || horaAgora_()), sabor_(c.flavor), qtd, Math.round(qtd / UN_POR_CAIXA),
    c.machine || 'Máquina', "'" + (c.startTime || ''), c.operator || '', c.shift || '', c.notes || '', c.id
  ]);
}

function excluirProducao_(id) {
  const sh = hist_();
  const linha = acharLinha_(sh, COL.producao + 10, id);
  if (linha > 0) sh.getRange(linha, COL.producao, 1, LARG.producao).deleteCells(SpreadsheetApp.Dimension.ROWS);
}

function salvarPerda_(data, jarra, po) {
  const sh = hist_();
  const datas = sh.getRange(4, COL.perda, sh.getMaxRows() - 3, 1).getValues();
  const i = datas.findIndex(r => r[0] instanceof Date && iso_(r[0]) === data);
  const linha = i >= 0 ? 4 + i : proximaLinha_(sh, COL.perda);
  sh.getRange(linha, COL.perda, 1, LARG.perda).setValues([[paraData_(data), Number(jarra) || 0, Number(po) || 0]]);
}

function lancar_(bloco, valores) {
  const sh = hist_();
  sh.getRange(proximaLinha_(sh, COL[bloco]), COL[bloco], 1, LARG[bloco]).setValues([valores]);
}


/* ======================= ABA LANÇAR (o "quadro" digital) ======================= */
/*
 * Esquerda (A:D, da linha 6 em diante): uma linha por ciclo — Data (só na 1ª linha do dia), Sabor, HI, HF.
 *   A linha ganha uma nota escondida na coluna B com o id do ciclo, para poder ser excluída depois.
 * Direita (G:R): uma linha por dia — Data, Realizado (un), Pó descartado (kg), Gelo pronto (L).
 *   Embalagem perdida e os motivos (L:Q) continuam sendo digitados à mão; o sistema não mexe neles.
 *   A Observação (R) só é escrita pelo sistema se estiver vazia ou começar com [Sistema].
 */
const QUADRO = { aba: 'LANÇAR', primeira: 6, colG: 7 };
let avisoQuadro = '';

/** O estoque nunca para por causa do quadro: se a LANÇAR der erro, o ciclo fica salvo e volta um aviso. */
function quadro_(fn) {
  try { fn(); } catch (err) { avisoQuadro = 'Salvo no estoque, mas não foi para a aba LANÇAR: ' + (err && err.message || err); }
}
function lancarAba_() {
  const sh = planilha_().getSheetByName(QUADRO.aba);
  if (!sh) throw new Error('Aba LANÇAR não encontrada.');
  return sh;
}
function horaFracao_(hm) {
  const m = String(hm || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? (Number(m[1]) * 60 + Number(m[2])) / 1440 : '';
}
function marca_(id) { return 'id sistema: ' + id; }

function lancarNoQuadro_(data, c) {
  const sh = lancarAba_();
  const n = sh.getMaxRows() - QUADRO.primeira + 1;
  const notas = sh.getRange(QUADRO.primeira, 2, n, 1).getNotes();
  if (notas.some(r => r[0] === marca_(c.id))) return;                 // já está no quadro
  const v = sh.getRange(QUADRO.primeira, 1, n, 2).getValues();
  let ultima = -1, diaAtual = '', temDia = false;
  v.forEach((r, i) => {
    if (r[0] instanceof Date) diaAtual = iso_(r[0]);
    if (r[1] !== '' || r[0] !== '') { ultima = i; if (diaAtual === data) temDia = true; }
  });
  const linha = QUADRO.primeira + ultima + 1;
  if (linha > sh.getMaxRows()) throw new Error('A aba LANÇAR está cheia.');
  sh.getRange(linha, 1, 1, 4).setValues([[temDia ? '' : paraData_(data), sabor_(c.flavor), horaFracao_(c.startTime), horaFracao_(c.endTime)]]);
  sh.getRange(linha, 1).setNumberFormat('dd/mm/yyyy');
  sh.getRange(linha, 3, 1, 2).setNumberFormat('hh:mm');
  sh.getRange(linha, 2).setNote(marca_(c.id));
}

function excluirDoQuadro_(id) {
  const sh = lancarAba_();
  const n = sh.getMaxRows() - QUADRO.primeira + 1;
  const i = sh.getRange(QUADRO.primeira, 2, n, 1).getNotes().findIndex(r => r[0] === marca_(id));
  if (i < 0) return;
  const linha = QUADRO.primeira + i;
  const data = sh.getRange(linha, 1).getValue();
  const prox = sh.getRange(linha + 1, 1, 1, 2).getValues()[0];
  // a data fica só na 1ª linha do dia: se apagar essa, a data desce para a linha de baixo
  if (data instanceof Date && prox[0] === '' && prox[1] !== '') sh.getRange(linha + 1, 1).setValue(data).setNumberFormat('dd/mm/yyyy');
  sh.getRange(linha, 1, 1, 4).deleteCells(SpreadsheetApp.Dimension.ROWS);
}

/** Refaz o fechamento do dia (G:J e, se for do sistema, R) a partir do HISTÓRICO. */
function fecharDia_(data) {
  const d = lerDia_(data);
  const sh = lancarAba_();
  const n = sh.getMaxRows() - QUADRO.primeira + 1;
  const datas = sh.getRange(QUADRO.primeira, QUADRO.colG, n, 1).getValues();
  let i = datas.findIndex(r => r[0] instanceof Date && iso_(r[0]) === data);
  if (i < 0) {
    if (!d.ciclos.length && !d.perda.jarMl && !d.perda.powderG) return;
    let ultima = -1; datas.forEach((r, k) => { if (r[0] !== '') ultima = k; });
    i = ultima + 1;
  }
  const linha = QUADRO.primeira + i;
  const realizado = d.ciclos.reduce((t, c) => t + c.qty, 0);
  sh.getRange(linha, QUADRO.colG, 1, 4).setValues([[paraData_(data), realizado || '',
    d.perda.powderG ? d.perda.powderG / 1000 : '', d.perda.jarMl ? d.perda.jarMl / 1000 : '']]);
  sh.getRange(linha, QUADRO.colG).setNumberFormat('dd/mm/yyyy');
  const obs = sh.getRange(linha, 18);
  const atual = String(obs.getValue() || '');
  if (!atual || atual.indexOf('[Sistema]') === 0) {
    const parciais = d.ciclos.filter(c => c.qty < 19 * 16)
      .map(c => curto_(c.flavor) + ' ' + Math.round(c.qty / 16) + 'F ' + c.endTime);
    const notas = d.ciclos.filter(c => c.notes).map(c => c.endTime + ' ' + c.notes);
    obs.setValue('[Sistema] Apontado pelo celular.' +
      (parciais.length ? ' Formas parciais: ' + parciais.join(', ') + '.' : '') +
      (notas.length ? ' Obs.: ' + notas.join('; ') + '.' : ''));
  }
}
function curto_(s) { return String(s || '').replace(/^S\.\d+\s*-\s*/, ''); }

/* ======================= LEITURAS ======================= */

function sabores_() {
  return planilha_().getSheetByName('Cadastros').getRange('J5:J34').getValues()
    .map(r => String(r[0]).trim()).filter(String);
}
function sabor_(s) {
  s = String(s || '').trim();
  if (sabores_().indexOf(s) < 0) throw new Error('Sabor não cadastrado: ' + s);
  return s;
}

function bloco_(sh, bloco) {
  const n = sh.getMaxRows() - 3;
  return sh.getRange(4, COL[bloco], n, LARG[bloco]).getValues().filter(r => r[0] instanceof Date);
}

function lerDia_(data) {
  const sh = hist_();
  const doDia = r => iso_(r[0]) === data;
  const ciclos = bloco_(sh, 'producao').filter(doDia).map(r => ({
    endTime: hhmm_(r[1]), flavor: r[2], qty: Number(r[3]) || 0, caixas: Number(r[4]) || 0,
    machine: r[5], startTime: hhmm_(r[6]), operator: r[7], shift: r[8], notes: r[9], id: r[10]
  }));
  const vendas = bloco_(sh, 'venda').filter(doDia).map(r => ({ hora: hhmm_(r[1]), sabor: r[2], caixas: Number(r[3]) || 0 }));
  const ajustes = bloco_(sh, 'ajuste').filter(doDia).map(r => ({ sabor: r[1], caixas: Number(r[2]) || 0, motivo: r[3] }));
  const p = bloco_(sh, 'perda').find(doDia);
  return { data: data, ciclos: ciclos, vendas: vendas, ajustes: ajustes,
           perda: { jarMl: p ? Number(p[1]) || 0 : 0, powderG: p ? Number(p[2]) || 0 : 0 } };
}

/** Estoque de cada sabor e o que produzir — é o que o monitor mostra. */
function painel_() {
  const sh = hist_();
  const cheio = Number(planilha_().getSheetByName('VENDAS').getRange('D3').getValue()) || 39;
  const hoje = hojeIso_();
  const s = {};
  sabores_().forEach(n => { s[n] = { nome: n, estoque: cheio, produzidoHoje: 0, vendidoHoje: 0, ciclosHoje: 0 }; });
  bloco_(sh, 'producao').forEach(r => {
    const x = s[r[2]]; if (!x) return;
    const cx = Number(r[4]) || 0;
    x.estoque += cx;
    if (iso_(r[0]) === hoje) { x.produzidoHoje += cx; x.ciclosHoje++; }
  });
  bloco_(sh, 'venda').forEach(r => {
    const x = s[r[2]]; if (!x) return;
    const cx = Number(r[3]) || 0;
    x.estoque -= cx;
    if (iso_(r[0]) === hoje) x.vendidoHoje += cx;
  });
  bloco_(sh, 'ajuste').forEach(r => { const x = s[r[1]]; if (x) x.estoque += Number(r[2]) || 0; });
  const lista = Object.keys(s).map(k => {
    const x = s[k];
    x.estoque = Math.max(0, x.estoque);
    x.situacao = x.estoque < cheio * LIMITE_BAIXO ? 'baixo' : (x.estoque > cheio ? 'alto' : 'ok');
    x.ciclos = Math.ceil(Math.max(0, cheio - x.estoque) / CAIXAS_POR_CICLO);
    return x;
  });
  return { cheio: cheio, caixasPorCiclo: CAIXAS_POR_CICLO, sabores: lista, atualizado: Utilities.formatDate(new Date(), tz_(), 'HH:mm') };
}

/** Resumo dia a dia entre duas datas (yyyy-MM-dd). */
function periodo_(de, ate) {
  const sh = hist_();
  ate = ate || hojeIso_();
  if (!de) { const d = paraData_(ate); d.setDate(d.getDate() - 13); de = iso_(d); }
  const dias = {}, porSabor = {};
  const dia = k => dias[k] || (dias[k] = { data: k, produzido: 0, ciclos: 0, vendido: 0, jarMl: 0, powderG: 0 });
  const dentro = k => k >= de && k <= ate;
  bloco_(sh, 'producao').forEach(r => {
    const k = iso_(r[0]); if (!dentro(k)) return;
    const cx = Number(r[4]) || 0;
    dia(k).produzido += cx; dia(k).ciclos++;
    (porSabor[r[2]] = porSabor[r[2]] || { produzido: 0, vendido: 0 }).produzido += cx;
  });
  bloco_(sh, 'venda').forEach(r => {
    const k = iso_(r[0]); if (!dentro(k)) return;
    const cx = Number(r[3]) || 0;
    dia(k).vendido += cx;
    (porSabor[r[2]] = porSabor[r[2]] || { produzido: 0, vendido: 0 }).vendido += cx;
  });
  bloco_(sh, 'perda').forEach(r => {
    const k = iso_(r[0]); if (!dentro(k)) return;
    dia(k).jarMl += Number(r[1]) || 0; dia(k).powderG += Number(r[2]) || 0;
  });
  // dias sem movimento também aparecem (gráfico contínuo)
  for (let d = paraData_(de); iso_(d) <= ate; d.setDate(d.getDate() + 1)) dia(iso_(d));
  return { de: de, ate: ate, dias: Object.keys(dias).sort().map(k => dias[k]), porSabor: porSabor };
}

/* ======================= VENDAS NA PLANILHA ======================= */

/** Aba VENDAS: digitou em "VENDI AGORA" e apertou Enter → vai para o HISTÓRICO. */
function onEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  const r = e.range.getRow();
  if (sh.getName() !== 'VENDAS' || e.range.getColumn() !== 2 || r < 5 || r > 17) return;
  const qtd = Number(e.value);
  e.range.clearContent();
  if (!qtd) return;
  const sabor = sh.getRange(r, 1).getValue();
  const hora = horaAgora_();
  lancar_('venda', [paraData_(hojeIso_()), "'" + hora, sabor, qtd]);
  sh.getRange('A19').setValue('✔ ' + qtd + ' cx de ' + sabor + ' (' + hora + ')');
}

/* ======================= MENU E SENHAS ======================= */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Boca Gelada')
    .addItem('Definir senha do escritório', 'definirSenhaEscritorio')
    .addItem('Definir senha do operador', 'definirSenhaOperador')
    .addSeparator()
    .addItem('Ver situação das senhas', 'situacaoSenhas')
    .addItem('Remover todas as senhas', 'removerSenhas')
    .addToUi();
}

function definirSenhaEscritorio() { definirSenha_('SENHA_ESCRITORIO', 'do escritório (acesso a tudo)', 6); }
function definirSenhaOperador() {
  if (!props_().getProperty('SENHA_ESCRITORIO')) {
    SpreadsheetApp.getUi().alert('Defina primeiro a senha do escritório.');
    return;
  }
  definirSenha_('SENHA_OPERADOR', 'do operador (só aponta produção)', 4);
}

function definirSenha_(chave, descricao, minimo) {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Senha ' + descricao, 'Mínimo de ' + minimo + ' caracteres. Os aparelhos vão pedir a senha nova na próxima abertura.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const senha = r.getResponseText().trim();
  if (senha.length < minimo) { ui.alert('Senha curta demais. Use pelo menos ' + minimo + ' caracteres.'); return; }
  props_().setProperty(chave, hashSenha_(senha));
  ui.alert('Senha ' + descricao + ' salva.');
}

function situacaoSenhas() {
  const p = props_();
  SpreadsheetApp.getUi().alert(
    'Escritório: ' + (p.getProperty('SENHA_ESCRITORIO') ? 'definida' : 'NÃO definida') + '\n' +
    'Operador: ' + (p.getProperty('SENHA_OPERADOR') ? 'definida' : 'NÃO definida') + '\n\n' +
    (p.getProperty('SENHA_ESCRITORIO') ? '' : 'Sem senha, qualquer pessoa com o link grava no sistema.'));
}

function removerSenhas() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Remover as senhas?', 'O sistema fica aberto para quem tiver o link.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  props_().deleteProperty('SENHA_ESCRITORIO');
  props_().deleteProperty('SENHA_OPERADOR');
  ui.alert('Senhas removidas.');
}

/* ======================= UTILITÁRIOS ======================= */

function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function planilha_() { return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(PLANILHA_ID); }
function hist_() { return planilha_().getSheetByName('HISTÓRICO'); }
function tz_() { return Session.getScriptTimeZone() || 'America/Sao_Paulo'; }
function iso_(d) { return d instanceof Date ? Utilities.formatDate(d, tz_(), 'yyyy-MM-dd') : ''; }
function hojeIso_() { return iso_(new Date()); }
function horaAgora_() { return Utilities.formatDate(new Date(), tz_(), 'HH:mm'); }
function paraData_(s) { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function hhmm_(v) { return v instanceof Date ? Utilities.formatDate(v, tz_(), 'HH:mm') : String(v || ''); }
function inteiro_(v) { const n = Math.round(Number(v)); if (!isFinite(n)) throw new Error('Número inválido.'); return n; }

function proximaLinha_(sh, coluna) {
  const v = sh.getRange(4, coluna, sh.getMaxRows() - 3, 1).getValues();
  let ultima = -1;
  v.forEach((x, i) => { if (x[0] !== '') ultima = i; });
  const linha = 4 + ultima + 1;
  if (linha > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 500);
  return linha;
}

function acharLinha_(sh, coluna, valor) {
  if (!valor) return -1;
  const v = sh.getRange(4, coluna, sh.getMaxRows() - 3, 1).getValues();
  const i = v.findIndex(r => r[0] === valor);
  return i >= 0 ? 4 + i : -1;
}
