/* =====================================================================
   BOCA GELADA — Produção, Estoque e Vendas
   Tudo é gravado na planilha (aba HISTÓRICO) pelo Apps Script.
   O celular só guarda: senha, nome do operador, turno, configurações
   e a fila de apontamentos feitos sem internet.
   ===================================================================== */
const CFG = window.APP_CONFIG;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const pad = n => String(n).padStart(2, '0');
const isoDe = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoje = () => isoDe(new Date());
const agoraHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const brData = iso => iso ? iso.split('-').reverse().join('/') : '';
const curto = s => String(s || '').replace(/^S\.\d+\s*-\s*/, '');
const cor = s => (CFG.cores || {})[curto(s)] || '#9AA8B8';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const hmMin = hm => { if (!hm) return null; const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const durMin = (a, b) => { const x = hmMin(a), y = hmMin(b); if (x == null || y == null) return null; let d = y - x; if (d < 0) d += 1440; return d; };
const un = formas => formas * CFG.unPorForma;
const cxDe = unidades => Math.round(unidades / CFG.unPorCaixa);

/* ---------- guardado no celular ---------- */
const local = {
  get(k, def) { try { const v = localStorage.getItem(CFG.storagePrefix + ':' + k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(CFG.storagePrefix + ':' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(CFG.storagePrefix + ':' + k); } catch {} }
};

/* ---------- estado ---------- */
const state = {
  senha: local.get('senha', ''),
  nivel: null,
  painel: null,
  dias: {},                                   // data → { ciclos, vendas, ajustes, perda }
  tab: 'estoque',
  p: { sabor: null, formas: CFG.formasPorCiclo },
  v: { sabor: null, cx: 1 },
  header: local.get('header', { operador: '', turno: '' }),
  cfg: Object.assign({ std: CFG.tempoCicloMin, meta: 18 }, local.get('cfg', {})),
  fila: local.get('fila', []),
  periodo: null
};

/* ---------- toast ---------- */
let toastTO;
function toast(msg, erro) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast on' + (erro ? ' err' : '');
  clearTimeout(toastTO); toastTO = setTimeout(() => t.classList.remove('on'), erro ? 3500 : 2000);
}

/* =====================================================================
   API (Apps Script)
   ===================================================================== */
function url(params) {
  const q = new URLSearchParams(Object.assign({ k: state.senha }, params || {}));
  return CFG.api + '?' + q.toString();
}
async function apiGet(action, params) {
  const r = await fetch(url(Object.assign({ action }, params)));
  return trata(await r.json());
}
async function apiPost(body) {
  // corpo em texto puro: o Apps Script não aceita o "preflight" do navegador
  const r = await fetch(url(), { method: 'POST', body: JSON.stringify(body) });
  return trata(await r.json());
}
function trata(j) {
  if (j && j.semAcesso) { sair(!!state.senha); throw new Error('senha'); }
  if (!j || !j.ok) { const e = new Error((j && j.erro) || 'Erro na planilha'); e.servidor = true; throw e; }
  status('✔ ' + agoraHM());
  return j;
}
function status(t) { $('#status').textContent = t; }

/** Resposta de gravação: traz o dia e o painel atualizados. */
function aplicar(j) {
  if (j.data) state.dias[j.data] = { ciclos: j.ciclos, vendas: j.vendas, ajustes: j.ajustes, perda: j.perda };
  if (j.painel) state.painel = j.painel;
  renderTudo();
}

/* ---------- fila offline (produção e desperdício) ---------- */
function salvarFila() { local.set('fila', state.fila); mostrarPendentes(); }
function mostrarPendentes() {
  const b = $('#pendentes'); const n = state.fila.length;
  b.hidden = !n; b.textContent = `⏳ ${n} pendente${n > 1 ? 's' : ''}`;
}
async function enviarOuGuardar(body) {
  try { aplicar(await apiPost(body)); return true; }
  catch (e) {
    if (e.servidor || e.message === 'senha') { toast('⚠ ' + e.message, true); return false; }
    state.fila.push(body); salvarFila();
    status('sem internet ⚠');
    toast('Sem internet: guardado no celular, envia sozinho depois.');
    return 'fila';
  }
}
let enviandoFila = false;
async function enviarFila() {
  if (enviandoFila || !state.fila.length) return;
  enviandoFila = true;
  try {
    while (state.fila.length) {
      const body = state.fila[0];
      try { aplicar(await apiPost(body)); }
      catch (e) { if (!e.servidor) break; }       // sem internet: tenta depois. Erro da planilha: descarta
      state.fila.shift(); salvarFila();
    }
  } finally { enviandoFila = false; }
}

/* =====================================================================
   ENTRADA: monitor (#tv), login ou app
   ===================================================================== */
async function iniciar() {
  if (location.hash === '#tv') return iniciarTV();
  $('#entrar').onclick = entrar;
  $('#senha').addEventListener('keydown', e => { if (e.key === 'Enter') entrar(); });
  $('#sair').onclick = () => { if (confirm('Sair deste aparelho? Vai pedir a senha de novo.')) sair(); };
  if (CFG.api.indexOf('http') !== 0) { $('#login').hidden = false; $('#login-erro').textContent = 'Falta colocar o link do Apps Script no config.js.'; return; }
  try {
    const j = await apiGet('nivel');
    state.nivel = j.nivel;
    abrirApp();
  } catch (e) {
    if (e.message === 'senha') return;
    if (state.senha) { state.nivel = local.get('nivel', 'operador'); abrirApp(); status('sem internet ⚠'); }
    else { $('#login').hidden = false; $('#login-erro').textContent = 'Sem conexão com a planilha.'; }
  }
}
async function entrar() {
  const s = $('#senha').value.trim();
  if (!s) return;
  $('#entrar').disabled = true; $('#login-erro').textContent = '';
  state.senha = s;
  try {
    const j = await apiGet('nivel');
    local.set('senha', s); local.set('nivel', j.nivel);
    state.nivel = j.nivel;
    $('#login').hidden = true;
    abrirApp();
  } catch (e) {
    state.senha = '';
    $('#login').hidden = false;
    $('#login-erro').textContent = e.message === 'senha' ? 'Senha errada.' : 'Sem conexão. Tente de novo.';
  }
  $('#entrar').disabled = false;
}
function sair(senhaRecusada) {
  state.senha = ''; local.del('senha'); local.del('nivel');
  $('#app').hidden = true; $('#login').hidden = false;
  $('#senha').value = '';
  $('#login-erro').textContent = senhaRecusada ? 'Senha não aceita. Digite de novo.' : '';
}

const escritorio = () => state.nivel === 'escritorio' || state.nivel === 'livre';

let aberto = false;
function abrirApp() {
  local.set('nivel', state.nivel);
  if (aberto) { $('#app').hidden = false; $$('[data-esc]').forEach(el => { el.hidden = !escritorio(); }); irPara(escritorio() ? state.tab : 'producao'); atualizar(); return; }
  aberto = true;
  $('#login').hidden = true; $('#app').hidden = false;
  $('#perfil').textContent = state.nivel === 'operador' ? '🏭 Operador' : state.nivel === 'livre' ? '🔓 Sem senha' : '🗂️ Escritório';
  $$('[data-esc]').forEach(el => { el.hidden = !escritorio(); });
  if (!escritorio()) state.tab = 'producao';
  montarProducao(); montarVendas(); montarHistorico(); montarAjuste();
  $$('#tabs button').forEach(b => b.onclick = () => irPara(b.dataset.tab));
  irPara(state.tab);
  mostrarPendentes();
  atualizar();
  setInterval(() => { if (!document.hidden) { enviarFila(); atualizar(true); } }, 30000);
  window.addEventListener('online', enviarFila);
}

function irPara(tab) {
  state.tab = tab;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $$('.tab').forEach(t => { t.hidden = t.id !== 'tab-' + tab; });
  if (tab === 'historico' && !state.periodo) verPeriodo();
  renderTudo();
}

/** Busca painel + dia da produção (+ hoje para as vendas). */
async function atualizar(silencioso) {
  try {
    const pedidos = [apiGet('painel'), apiGet('dia', { data: dataProducao() })];
    if (escritorio() && dataProducao() !== hoje()) pedidos.push(apiGet('dia', { data: hoje() }));
    const [p, ...dias] = await Promise.all(pedidos);
    state.painel = p;
    dias.forEach(d => { state.dias[d.data] = { ciclos: d.ciclos, vendas: d.vendas, ajustes: d.ajustes, perda: d.perda }; });
    renderTudo();
    enviarFila();
  } catch (e) { if (e.message !== 'senha') { status('sem internet ⚠'); if (!silencioso) renderTudo(); } }
}

function renderTudo() {
  if (!state.painel) return;
  renderEstoque();
  renderProducao();
  renderVendas();
}

/* =====================================================================
   ESTOQUE (também usado no monitor)
   ===================================================================== */
const SIT = { baixo: { c: '#E53935', t: '🔴 BAIXO' }, ok: { c: '#2ECC71', t: '🟢 OK' }, alto: { c: '#F39C12', t: '🟠 ACIMA' } };

function barrasHTML(p) {
  const max = Math.max(p.cheio * 1.25, ...p.sabores.map(s => s.estoque));
  return p.sabores.map(s => `
    <div class="sbar">
      <div class="nm"><span class="dot" style="background:${cor(s.nome)}"></span>${esc(curto(s.nome))}</div>
      <div class="bar"><div class="fill" style="width:${Math.min(100, s.estoque / max * 100)}%;background:${SIT[s.situacao].c}"></div>
        <div class="meta" style="left:${p.cheio / max * 100}%"></div></div>
      <div class="q num">${s.estoque} cx<small>${s.ciclos ? '▶ ' + s.ciclos + ' ciclo' + (s.ciclos > 1 ? 's' : '') : SIT[s.situacao].t}</small></div>
    </div>`).join('');
}
function produzirHTML(p) {
  const faltam = p.sabores.filter(s => s.ciclos > 0).sort((a, b) => a.estoque - b.estoque);
  const total = faltam.reduce((t, s) => t + s.ciclos, 0);
  if (!total) return { ok: true, html: '✅ Estoque cheio: não precisa produzir agora<small>Todos os sabores estão no nível cheio.</small>' };
  const horas = total * CFG.tempoCicloMin / 60;
  const ordem = faltam.map(s => `${curto(s.nome)} (${s.ciclos})`).join(' · ');
  return { ok: false, html: `🏭 Produzir ${total} ciclo${total > 1 ? 's' : ''} · ~${horas.toFixed(1).replace('.', ',')} h de máquina<small>Começar por: ${esc(ordem)}</small>` };
}
function totais(p) {
  const t = { estoque: 0, prod: 0, vend: 0, ciclos: 0, baixos: 0 };
  p.sabores.forEach(s => { t.estoque += s.estoque; t.prod += s.produzidoHoje; t.vend += s.vendidoHoje; t.ciclos += s.ciclosHoje; if (s.situacao === 'baixo') t.baixos++; });
  t.ocup = Math.round(t.estoque / CFG.capacidadeCaixas * 100);
  return t;
}
function renderEstoque() {
  const p = state.painel, t = totais(p), pr = produzirHTML(p);
  $('#produzir').innerHTML = pr.html; $('#produzir').classList.toggle('okb', pr.ok);
  $('#e-total').textContent = t.estoque + ' cx';
  $('#e-ocup').textContent = `${t.ocup}% dos freezers (${CFG.capacidadeCaixas} cx)`;
  $('#e-prod').textContent = t.prod + ' cx';
  $('#e-ciclos').textContent = `${t.ciclos} ciclo${t.ciclos === 1 ? '' : 's'}`;
  $('#e-vend').textContent = t.vend + ' cx';
  $('#e-baixos').textContent = t.baixos;
  $('#e-cheio').textContent = `cheio = ${p.cheio} cx por sabor`;
  $('#barras').innerHTML = barrasHTML(p);
  const sel = $('#aj-sabor');
  if (!sel.options.length) sel.innerHTML = p.sabores.map(s => `<option value="${esc(s.nome)}">${esc(curto(s.nome))}</option>`).join('');
}

function montarAjuste() {
  $('#aj-salvar').onclick = async () => {
    const cx = Math.round(Number($('#aj-cx').value));
    const motivo = $('#aj-motivo').value.trim();
    if (!cx) return toast('Digite as caixas (ex.: -3 ou 5).', true);
    if (!motivo) return toast('Escreva o motivo do ajuste.', true);
    if (!confirm(`Ajustar ${cx > 0 ? '+' : ''}${cx} cx de ${curto($('#aj-sabor').value)}?`)) return;
    const b = $('#aj-salvar'); b.disabled = true;
    try {
      aplicar(await apiPost({ kind: 'ajuste', data: hoje(), sabor: $('#aj-sabor').value, caixas: cx, motivo }));
      $('#aj-cx').value = ''; $('#aj-motivo').value = '';
      toast('✔ Ajuste lançado');
    } catch (e) { if (e.message !== 'senha') toast('⚠ Não foi: ' + e.message, true); }
    b.disabled = false;
  };
}

/* =====================================================================
   PRODUÇÃO (GD)
   ===================================================================== */
const dataProducao = () => $('#p-data').value || hoje();
const diaP = () => state.dias[dataProducao()] || { ciclos: [], vendas: [], ajustes: [], perda: { jarMl: 0, powderG: 0 } };

function chips(el, onPick, extra) {
  el.innerHTML = state.painel.sabores.map(s => `
    <button type="button" class="fchip" data-s="${esc(s.nome)}"><span class="dot" style="background:${cor(s.nome)}"></span>
      <span>${esc(curto(s.nome))}${extra ? `<small>${extra(s)}</small>` : ''}</span></button>`).join('');
  el.onclick = e => { const b = e.target.closest('.fchip'); if (b) onPick(b.dataset.s); };
}

function montarProducao() {
  $('#p-data').value = hoje();
  $('#p-data').onchange = () => { $('#p-inicio').value = ''; $('#p-fim').value = ''; atualizar(); };
  $('#p-operador').value = state.header.operador || '';
  $('#p-operador').onchange = () => { state.header.operador = $('#p-operador').value.trim(); local.set('header', state.header); };
  $('#p-turno').innerHTML = CFG.turnos.map(t => `<button data-t="${esc(t)}">${esc(t)}</button>`).join('');
  $('#p-turno').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    state.header.turno = state.header.turno === b.dataset.t ? '' : b.dataset.t;
    local.set('header', state.header); renderProducao();
  };
  $$('[data-formas]').forEach(b => b.onclick = () => {
    state.p.formas = Math.min(CFG.formasPorCiclo, Math.max(1, state.p.formas + Number(b.dataset.formas)));
    renderProducao();
  });
  $$('[data-now]').forEach(b => b.onclick = e => { e.preventDefault(); $('#' + b.dataset.now).value = agoraHM(); preview(); });
  $('#p-inicio').onchange = preview; $('#p-fim').onchange = preview;
  $('#p-salvar').onclick = salvarCiclo;
  let perdaTO;
  const perda = () => {
    const jar = Math.max(0, Math.min(2000, Number($('#w-jarra').value) || 0));
    const po = Math.max(0, Number($('#w-po').value) || 0);
    state.dias[dataProducao()] = Object.assign(diaP(), { perda: { jarMl: jar, powderG: po } });
    renderPerda(); renderResumo();
    clearTimeout(perdaTO);
    perdaTO = setTimeout(() => enviarOuGuardar({ kind: 'perda', data: dataProducao(), jarra: jar, po }), 1500);
  };
  $('#w-jarra').oninput = perda; $('#w-po').oninput = perda;
  $('#cfg-std').value = state.cfg.std; $('#cfg-meta').value = state.cfg.meta;
  $('#cfg-salvar').onclick = () => {
    state.cfg = { std: Math.max(1, Number($('#cfg-std').value) || CFG.tempoCicloMin), meta: Math.max(0, Number($('#cfg-meta').value) || 0) };
    local.set('cfg', state.cfg); renderProducao(); toast('Configuração salva');
  };
  $('#p-lista').onclick = async e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    if (!confirm('Excluir este ciclo? Ele sai do estoque também.')) return;
    const r = await enviarOuGuardar({ kind: 'excluir-producao', data: dataProducao(), id: b.dataset.del });
    if (r === true) toast('Ciclo excluído');
  };
}

function preview() {
  const d = durMin($('#p-inicio').value, $('#p-fim').value || agoraHM());
  const std = state.cfg.std;
  $('#pv-dur').textContent = d == null ? '—' : d + ' min';
  $('#pv-std').textContent = std + ' min';
  const el = $('#pv-desv');
  if (d != null && std > 0) {
    const p = (d - std) / std * 100;
    el.textContent = (p > 0 ? '+' : '') + p.toFixed(0) + '%';
    el.className = p <= 5 ? 'ok-t' : p <= 20 ? 'warn-t' : 'err-t';
  } else { el.textContent = '—'; el.className = ''; }
}

async function salvarCiclo() {
  if (!state.p.sabor) return toast('Escolha o sabor.', true);
  const fim = $('#p-fim').value || agoraHM();
  const ultimo = diaP().ciclos.slice().sort((a, b) => (a.endTime || '').localeCompare(b.endTime || '')).pop();
  const inicio = $('#p-inicio').value || (ultimo ? ultimo.endTime : '');
  const ciclo = {
    id: uid(), flavor: state.p.sabor, qty: un(state.p.formas), formas: state.p.formas,
    startTime: inicio, endTime: fim, machine: 'Máquina',
    operator: state.header.operador || '', shift: state.header.turno || '', notes: $('#p-obs').value.trim()
  };
  const b = $('#p-salvar'); b.disabled = true; b.textContent = 'Salvando…';
  const r = await enviarOuGuardar({ kind: 'producao', data: dataProducao(), ciclo });
  if (r === 'fila') { const d = diaP(); d.ciclos = d.ciclos.concat([Object.assign({ pendente: true, caixas: cxDe(ciclo.qty) }, ciclo)]); state.dias[dataProducao()] = d; }
  if (r) {
    if (r === true) toast(`✔ +${cxDe(ciclo.qty)} cx de ${curto(ciclo.flavor)} no estoque`);
    if (navigator.vibrate) navigator.vibrate(100);
    state.p.sabor = null; state.p.formas = CFG.formasPorCiclo;
    $('#p-inicio').value = fim; $('#p-fim').value = ''; $('#p-obs').value = '';
  }
  b.disabled = false; b.textContent = '✔ Salvar ciclo';
  renderProducao();
}

function renderProducao() {
  if (!state.painel) return;
  if (!$('#p-sabores').children.length) chips($('#p-sabores'), s => { state.p.sabor = s; renderProducao(); });
  $$('#p-sabores .fchip').forEach(b => b.classList.toggle('on', b.dataset.s === state.p.sabor));
  $$('#p-turno button').forEach(b => b.classList.toggle('on', b.dataset.t === state.header.turno));
  $('#p-formas').textContent = state.p.formas;
  $('#p-formas-sub').textContent = `${un(state.p.formas)} un ≈ ${cxDe(un(state.p.formas))} cx`;
  preview();

  const ciclos = diaP().ciclos.slice().sort((a, b) => (a.endTime || '').localeCompare(b.endTime || ''));
  $('#p-count').textContent = ciclos.length === 1 ? '1 ciclo' : ciclos.length + ' ciclos';
  $('#p-lista').innerHTML = !ciclos.length ? '<div class="empty">Nenhum ciclo apontado neste dia.</div>' : `
    <table class="t"><thead><tr><th>Horário</th><th>Sabor</th><th class="r">Un</th><th class="r">Cx</th><th class="r">Duração</th><th class="r">Desvio</th><th>Operador</th><th>Obs.</th><th></th></tr></thead><tbody>
    ${ciclos.map(c => {
      const d = durMin(c.startTime, c.endTime);
      const p = d != null && state.cfg.std ? (d - state.cfg.std) / state.cfg.std * 100 : null;
      return `<tr><td class="num">${esc(c.startTime || '—')}<br><small style="color:var(--ink-3)">→ ${esc(c.endTime)}</small></td>
        <td><span class="dot" style="background:${cor(c.flavor)}"></span> ${esc(curto(c.flavor))}</td>
        <td class="r num">${c.qty}</td><td class="r num"><b>${c.caixas}</b></td>
        <td class="r num">${d == null ? '—' : d + ' min'}</td>
        <td class="r num ${p == null ? '' : p <= 5 ? 'ok-t' : p <= 20 ? 'warn-t' : 'err-t'}">${p == null ? '—' : (p > 0 ? '+' : '') + p.toFixed(0) + '%'}</td>
        <td>${esc(c.operator || '')}</td><td><small style="color:var(--ink-3)">${esc(c.notes || '')}</small></td>
        <td>${c.pendente ? '<span class="badge">⏳</span>' : `<button class="link" data-del="${esc(c.id)}">excluir</button>`}</td></tr>`;
    }).join('')}</tbody></table>`;

  const pe = diaP().perda;
  if (document.activeElement !== $('#w-jarra')) $('#w-jarra').value = pe.jarMl || '';
  if (document.activeElement !== $('#w-po')) $('#w-po').value = pe.powderG || '';
  renderPerda(); renderResumo();
}

function renderPerda() {
  const pe = diaP().perda;
  $('#w-jar-fill').style.height = Math.min(100, pe.jarMl / 2000 * 100) + '%';
  $('#w-jar-lbl').textContent = (pe.jarMl || 0) + ' ml';
  $('#w-po-fill').style.width = Math.min(100, (pe.powderG || 0) / Math.max(2000, pe.powderG || 0) * 100) + '%';
  $('#w-po-lbl').textContent = (pe.powderG || 0) + ' g';
}

function renderResumo() {
  const d = diaP(), ciclos = d.ciclos;
  const cx = ciclos.reduce((t, c) => t + (c.caixas || 0), 0);
  const unid = ciclos.reduce((t, c) => t + (c.qty || 0), 0);
  $('#r-prod').textContent = cx + ' cx';
  $('#r-prod-sub').textContent = unid + ' gelos';
  $('#r-ciclos').textContent = ciclos.length;
  $('#r-ciclos-sub').textContent = state.cfg.meta ? `meta ${state.cfg.meta} · ${Math.round(ciclos.length / state.cfg.meta * 100)}%` : '—';
  $('#r-meta').textContent = state.cfg.meta ? `Meta: ${state.cfg.meta} ciclos` : '';
  const tempos = ciclos.map(c => durMin(c.startTime, c.endTime)).filter(x => x != null && x > 0);
  $('#r-tempo').textContent = tempos.length ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length) : '—';
  const quebrados = Math.round((d.perda.jarMl || 0) / CFG.gramasPorUnidade);
  const pct = unid + quebrados ? quebrados / (unid + quebrados) * 100 : 0;
  $('#r-perda').textContent = pct.toFixed(1).replace('.', ',') + '%';
  $('#r-perda-sub').textContent = `~${quebrados} gelos quebrados · ${d.perda.powderG || 0} g de pó`;
  const k = $('#r-perda-k'); k.className = 'kpi' + (pct >= 5 ? ' err' : pct >= 2 ? ' warn' : pct > 0 ? ' ok' : '');
  const por = {};
  ciclos.forEach(c => { por[c.flavor] = (por[c.flavor] || 0) + (c.caixas || 0); });
  const max = Math.max(1, ...Object.values(por));
  $('#r-sabores').innerHTML = Object.keys(por).sort((a, b) => por[b] - por[a]).map(s => `
    <div class="fbar"><div><span class="dot" style="background:${cor(s)}"></span> ${esc(curto(s))}</div>
      <div class="bar"><div style="width:${por[s] / max * 100}%;background:${cor(s)}"></div></div><div class="n num">${por[s]} cx</div></div>`).join('')
    || '<div class="empty">Nada produzido ainda.</div>';
}

/* =====================================================================
   VENDAS
   ===================================================================== */
function montarVendas() {
  $$('[data-cx]').forEach(b => b.onclick = () => { state.v.cx = Math.max(1, state.v.cx + Number(b.dataset.cx)); renderVendas(); });
  $$('[data-cxset]').forEach(b => b.onclick = () => { state.v.cx = Number(b.dataset.cxset); renderVendas(); });
  $('#v-salvar').onclick = async () => {
    const s = state.v.sabor, cx = state.v.cx;
    const est = (state.painel.sabores.find(x => x.nome === s) || {}).estoque;
    if (est != null && cx > est && !confirm(`O sistema mostra só ${est} cx de ${curto(s)}. Lançar ${cx} cx mesmo assim?`)) return;
    const b = $('#v-salvar'); b.disabled = true; b.textContent = 'Lançando…';
    try {
      aplicar(await apiPost({ kind: 'venda', data: hoje(), sabor: s, caixas: cx }));
      toast(`✔ ${cx} cx de ${curto(s)} vendidas`);
      state.v = { sabor: null, cx: 1 };
    } catch (e) { if (e.message !== 'senha') toast('⚠ Não foi: ' + e.message, true); }
    b.textContent = 'Lançar venda';
    renderVendas();
  };
  $('#v-lista').onclick = async e => {
    const b = e.target.closest('[data-estorno]'); if (!b) return;
    const s = b.dataset.estorno, cx = Number(b.dataset.cx);
    if (!confirm(`Desfazer a venda de ${cx} cx de ${curto(s)}? As caixas voltam para o estoque.`)) return;
    try { aplicar(await apiPost({ kind: 'venda', data: hoje(), sabor: s, caixas: -cx })); toast('Venda desfeita'); }
    catch (er) { if (er.message !== 'senha') toast('⚠ Não foi: ' + er.message, true); }
  };
}

function renderVendas() {
  if (!state.painel || !escritorio()) return;
  chips($('#v-sabores'), s => { state.v.sabor = s; renderVendas(); }, s => s.estoque + ' cx');
  $$('#v-sabores .fchip').forEach(b => b.classList.toggle('on', b.dataset.s === state.v.sabor));
  $('#v-cx').textContent = state.v.cx;
  $('#v-cx-sub').textContent = state.v.cx === 1 ? 'caixa' : `caixas · ${state.v.cx * CFG.unPorCaixa} gelos`;
  $('#v-salvar').disabled = !state.v.sabor;
  if (state.v.sabor) $('#v-salvar').textContent = `Lançar ${state.v.cx} cx de ${curto(state.v.sabor)}`;
  const vendas = (state.dias[hoje()] || { vendas: [] }).vendas.slice().reverse();
  const total = vendas.reduce((t, v) => t + v.caixas, 0);
  $('#v-total').textContent = total + ' cx';
  // vendas desfeitas (negativas) não podem ser desfeitas de novo
  $('#v-lista').innerHTML = !vendas.length ? '<div class="empty">Nenhuma venda lançada hoje.</div>' : `
    <table class="t"><thead><tr><th>Hora</th><th>Sabor</th><th class="r">Caixas</th><th></th></tr></thead><tbody>
    ${vendas.map(v => `<tr><td class="num">${esc(v.hora)}</td><td><span class="dot" style="background:${cor(v.sabor)}"></span> ${esc(curto(v.sabor))}</td>
      <td class="r num ${v.caixas < 0 ? 'err-t' : ''}"><b>${v.caixas}</b>${v.caixas < 0 ? ' <small>(desfeita)</small>' : ''}</td>
      <td>${v.caixas > 0 ? `<button class="link" data-estorno="${esc(v.sabor)}" data-cx="${v.caixas}">desfazer</button>` : ''}</td></tr>`).join('')}
    </tbody></table>`;
}

/* =====================================================================
   HISTÓRICO
   ===================================================================== */
function montarHistorico() {
  const d = new Date(); $('#h-ate').value = isoDe(d);
  d.setDate(d.getDate() - 13); $('#h-de').value = isoDe(d);
  $('#h-ver').onclick = verPeriodo;
  $('#h-dias').onclick = e => { const tr = e.target.closest('[data-dia]'); if (tr) verDia(tr.dataset.dia); };
  $('#h-csv').onclick = csv;
}

async function verPeriodo() {
  $('#h-ver').disabled = true;
  try { state.periodo = await apiGet('periodo', { de: $('#h-de').value, ate: $('#h-ate').value }); renderHistorico(); }
  catch (e) { if (e.message !== 'senha') toast('⚠ Não carregou: ' + e.message, true); }
  $('#h-ver').disabled = false;
}

function renderHistorico() {
  const p = state.periodo; if (!p) return;
  const dias = p.dias;
  const tp = dias.reduce((t, d) => t + d.produzido, 0), tv = dias.reduce((t, d) => t + d.vendido, 0);
  $('#h-tot').textContent = `produzido ${tp} cx · vendido ${tv} cx`;
  // gráfico de barras agrupadas (SVG)
  const W = 720, H = 220, pl = 34, pb = 26, max = Math.max(10, ...dias.map(d => Math.max(d.produzido, d.vendido)));
  const bw = (W - pl) / dias.length, y = v => H - pb - v / max * (H - pb - 10);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Produzido e vendido por dia">`;
  [0, .5, 1].forEach(f => { const v = Math.round(max * f); svg += `<line x1="${pl}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#E1E7ED"/><text x="${pl - 4}" y="${y(v) + 4}" font-size="10" text-anchor="end" fill="#7A8899">${v}</text>`; });
  dias.forEach((d, i) => {
    const x = pl + i * bw, w = Math.max(2, bw * .36);
    svg += `<rect x="${x + bw * .12}" y="${y(d.produzido)}" width="${w}" height="${H - pb - y(d.produzido)}" fill="#177245" rx="2"><title>${brData(d.data)}: produzido ${d.produzido} cx</title></rect>`;
    svg += `<rect x="${x + bw * .12 + w + 2}" y="${y(d.vendido)}" width="${w}" height="${H - pb - y(d.vendido)}" fill="#0B6E8C" rx="2"><title>${brData(d.data)}: vendido ${d.vendido} cx</title></rect>`;
    if (dias.length <= 16 || i % Math.ceil(dias.length / 16) === 0) svg += `<text x="${x + bw / 2}" y="${H - 8}" font-size="10" text-anchor="middle" fill="#7A8899">${d.data.slice(8)}/${d.data.slice(5, 7)}</text>`;
  });
  $('#h-grafico').innerHTML = svg + '</svg>';
  $('#h-dias').innerHTML = `<table class="t"><thead><tr><th>Data</th><th class="r">Produzido</th><th class="r">Ciclos</th><th class="r">Vendido</th><th class="r">Saldo</th><th class="r">Jarra</th><th class="r">Pó</th></tr></thead><tbody>
    ${dias.slice().reverse().map(d => { const s = d.produzido - d.vendido; return `<tr class="click" data-dia="${d.data}"><td>${brData(d.data)}</td><td class="r num">${d.produzido} cx</td><td class="r num">${d.ciclos}</td>
      <td class="r num">${d.vendido} cx</td><td class="r num ${s < 0 ? 'err-t' : s > 0 ? 'ok-t' : ''}">${s > 0 ? '+' : ''}${s}</td><td class="r num">${d.jarMl || 0} ml</td><td class="r num">${d.powderG || 0} g</td></tr>`; }).join('')}
    </tbody></table>`;
  const ps = p.porSabor, nomes = Object.keys(ps).sort((a, b) => ps[b].vendido - ps[a].vendido);
  $('#h-sabores').innerHTML = !nomes.length ? '<div class="empty">Sem movimento no período.</div>' : `<table class="t"><thead><tr><th>Sabor</th><th class="r">Produzido</th><th class="r">Vendido</th><th class="r">Diferença</th></tr></thead><tbody>
    ${nomes.map(n => { const s = ps[n], d = s.produzido - s.vendido; return `<tr><td><span class="dot" style="background:${cor(n)}"></span> ${esc(curto(n))}</td><td class="r num">${s.produzido} cx</td><td class="r num">${s.vendido} cx</td><td class="r num ${d < 0 ? 'err-t' : ''}">${d > 0 ? '+' : ''}${d}</td></tr>`; }).join('')}</tbody></table>`;
}

async function verDia(data) {
  $('#h-detalhe-sec').hidden = false;
  $('#h-detalhe-tit').textContent = 'Detalhes de ' + brData(data);
  $('#h-detalhe').innerHTML = '<div class="empty">Carregando…</div>';
  try {
    const d = await apiGet('dia', { data });
    const linhas = [
      ...d.ciclos.map(c => ({ h: c.endTime, t: '🏭 Produção', s: c.flavor, cx: '+' + c.caixas, o: [c.operator, c.notes].filter(Boolean).join(' · ') })),
      ...d.vendas.map(v => ({ h: v.hora, t: v.caixas < 0 ? '↩️ Venda desfeita' : '💰 Venda', s: v.sabor, cx: String(-v.caixas).replace(/^(\d)/, '+$1'), o: '' })),
      ...d.ajustes.map(a => ({ h: '', t: '🔧 Ajuste', s: a.sabor, cx: (a.caixas > 0 ? '+' : '') + a.caixas, o: a.motivo }))
    ].sort((a, b) => (a.h || '99').localeCompare(b.h || '99'));
    $('#h-detalhe').innerHTML = (!linhas.length ? '<div class="empty">Nada lançado neste dia.</div>' : `<table class="t"><thead><tr><th>Hora</th><th>O quê</th><th>Sabor</th><th class="r">Estoque</th><th>Obs.</th></tr></thead><tbody>
      ${linhas.map(l => `<tr><td class="num">${esc(l.h || '—')}</td><td>${l.t}</td><td><span class="dot" style="background:${cor(l.s)}"></span> ${esc(curto(l.s))}</td>
        <td class="r num ${l.cx.startsWith('-') ? 'err-t' : 'ok-t'}"><b>${l.cx} cx</b></td><td><small>${esc(l.o)}</small></td></tr>`).join('')}</tbody></table>`)
      + `<div class="cycle-preview">Desperdício: <b>${d.perda.jarMl} ml</b> na jarra · <b>${d.perda.powderG} g</b> de pó</div>`;
    $('#h-detalhe-sec').scrollIntoView({ behavior: 'smooth' });
  } catch (e) { $('#h-detalhe').innerHTML = '<div class="empty">Não carregou.</div>'; }
}

function csv() {
  const p = state.periodo; if (!p) return;
  const l = ['Data;Produzido (cx);Ciclos;Vendido (cx);Saldo;Jarra (ml);Pó (g)'];
  p.dias.forEach(d => l.push([brData(d.data), d.produzido, d.ciclos, d.vendido, d.produzido - d.vendido, d.jarMl, d.powderG].join(';')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + l.join('\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = `boca-gelada_${p.de}_a_${p.ate}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}

/* =====================================================================
   MONITOR DA FÁBRICA (#tv) — sem senha, atualiza a cada 30 s
   ===================================================================== */
function iniciarTV() {
  document.body.classList.add('tv');
  $('#tv').hidden = false;
  const relogio = () => { $('#tv-hora').firstChild.textContent = agoraHM(); };
  relogio(); setInterval(relogio, 10000);
  const carregar = async () => {
    try {
      const r = await fetch(CFG.api + '?action=painel');
      const p = await r.json(); if (!p.ok) throw 0;
      const t = totais(p), pr = produzirHTML(p);
      $('#tv-produzir').innerHTML = pr.html; $('#tv-produzir').classList.toggle('okb', pr.ok);
      $('#tv-total').textContent = t.estoque + ' cx';
      $('#tv-prod').textContent = t.prod + ' cx';
      $('#tv-vend').textContent = t.vend + ' cx';
      $('#tv-ocup').textContent = t.ocup + '%';
      $('#tv-barras').innerHTML = barrasHTML(p);
      $('#tv-atual').textContent = 'atualizado ' + p.atualizado;
    } catch { $('#tv-atual').textContent = 'sem conexão ⚠'; }
  };
  carregar(); setInterval(carregar, 30000);
}

window.addEventListener('hashchange', () => location.reload());
iniciar();
