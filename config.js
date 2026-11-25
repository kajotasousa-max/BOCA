/* ============================================================
   CONFIGURAÇÃO — Boca Gelada
   ============================================================ */
window.APP_CONFIG = {
  empresa: { nome: 'Boca Gelada', subtitulo: 'Produção · Estoque · Vendas' },

  /* URL do App da Web do Apps Script (backend/Code.gs), termina em /exec */
  api: 'COLE_AQUI_O_LINK_DO_APP_DA_WEB',

  /* Prefixo das chaves guardadas no celular. Não mude depois de começar a usar. */
  storagePrefix: 'bocagelada',

  /* Máquina */
  formasPorCiclo: 19,
  unPorForma: 16,
  unPorCaixa: 30,
  tempoCicloMin: 30,          // cai gelo a cada 30 min

  /* Capacidade total de estocagem (caixas de 30 un) — freezers + câmara */
  capacidadeCaixas: 510,

  /* Gelo de 200 mL — usado para converter a jarra de quebrados em unidades */
  gramasPorUnidade: 200,

  turnos: ['1º turno', '2º turno'],

  /* Cores dos sabores (o nome da esquerda é o da aba Cadastros, sem o "S.01 - ") */
  cores: {
    'Água de coco': '#E8DCC4', 'Morango': '#E74C3C', 'Maracujá': '#F4C724', 'Maçã Verde': '#8BC34A',
    'Bob': '#9B59B6', 'Melancia': '#EC7B93', 'Limão': '#B8D95A', 'Laranja': '#F39C12',
    'Limão com sal': '#A8C88F', 'Frutas cítricas': '#F1C40F', 'Frutas vermelhas': '#8E1E3B',
    'Abacaxi': '#F5D547', 'Brasil': '#1E9E4A'
  }
};
