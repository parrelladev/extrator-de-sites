/*
 * studio.js — interface e orquestração.
 *
 * A página do Estúdio é quem faz o trabalho pesado, e não o service worker:
 * ela roda na origem chrome-extension:// com host_permissions, então busca
 * qualquer recurso sem esbarrar em CORS, e sobrevive à captura inteira
 * (o service worker seria desligado no meio).
 *
 * A tela tem três estados — configurar, executar, concluir — e só um aparece
 * por vez. Durante a captura não há nada para ajustar, então o formulário sai
 * de cena e dá lugar ao progresso.
 */

import { runCapture, DEFAULTS } from '../capture/index.js';
import { DirectoryWriter, ZipWriterSink, supportsDirectoryPicker } from '../capture/writer.js';
import { formatBytes } from '../shared/util.js';

const $ = (id) => document.getElementById(id);

const tela = {
  form: $('tela-form'),
  progresso: $('tela-progresso'),
  fim: $('tela-fim')
};

const el = {
  alvo: $('alvo'),
  alvoInfo: $('alvo-info'),
  usarAba: $('usar-aba'),
  capturar: $('capturar'),
  nova: $('nova'),
  status: $('status'),
  topbarNote: $('topbar-note'),
  runTitle: $('run-title'),
  runPct: $('run-pct'),
  rail: $('rail'),
  steps: $('steps'),
  log: $('log'),
  resultado: $('resultado'),
  cPaginas: $('c-paginas'),
  cRecursos: $('c-recursos'),
  cBytes: $('c-bytes'),
  cFalhas: $('c-falhas'),
  statFalhas: $('stat-falhas'),
  numPaginas: $('num-paginas'),
  numRecursos: $('num-recursos'),
  numGravados: $('num-gravados'),
  destino: $('opt-destino'),
  destinoHint: $('destino-hint')
};

let alvoTabId = null;
let rodando = false;

// O atalho gerado depende do sistema de quem captura.
const NO_WINDOWS = /Win/i.test(navigator.userAgent);
const PLATAFORMA = NO_WINDOWS ? 'windows' : 'unix';
const ATALHO = NO_WINDOWS ? 'ABRIR SITE.cmd' : 'ABRIR SITE.command';

/* ─────────────────────────────── perfis ──────────────────────────────── */

const PERFIS = {
  fiel: {
    reload: true, scroll: true, scrollPasses: 1, scrollDwell: 420, hover: false,
    depth: 0, maxPages: 25, deepScanJs: true, crossOriginAssets: true,
    includeMedia: true, skipAnalytics: true, apiCache: true, saveSnapshot: true,
    designSystem: true, maxFileMB: 80, concurrency: 8
  },
  rapido: {
    reload: false, scroll: false, scrollPasses: 1, scrollDwell: 300, hover: false,
    depth: 0, maxPages: 1, deepScanJs: false, crossOriginAssets: true,
    includeMedia: false, skipAnalytics: true, apiCache: true, saveSnapshot: false,
    designSystem: false, maxFileMB: 40, concurrency: 12
  },
  site: {
    reload: true, scroll: true, scrollPasses: 1, scrollDwell: 380, hover: false,
    depth: 2, maxPages: 60, deepScanJs: true, crossOriginAssets: true,
    includeMedia: true, skipAnalytics: true, apiCache: true, saveSnapshot: false,
    designSystem: true, maxFileMB: 80, concurrency: 8
  }
};

function aplicarPerfil(nome) {
  const p = PERFIS[nome];
  if (!p) return;
  $('opt-reload').checked = p.reload;
  $('opt-scroll').checked = p.scroll;
  $('opt-hover').checked = p.hover;
  $('opt-passes').value = p.scrollPasses;
  $('opt-dwell').value = p.scrollDwell;
  $('opt-depth').value = String(p.depth);
  $('opt-maxpages').value = p.maxPages;
  $('opt-deep').checked = p.deepScanJs;
  $('opt-cdn').checked = p.crossOriginAssets;
  $('opt-media').checked = p.includeMedia;
  $('opt-analytics').checked = p.skipAnalytics;
  $('opt-api').checked = p.apiCache;
  $('opt-snapshot').checked = p.saveSnapshot;
  $('opt-design').checked = p.designSystem !== false;
  $('opt-focar').checked = p.focarAba !== false;
  $('opt-maxfile').value = p.maxFileMB;
  $('opt-conc').value = p.concurrency;
  salvarPrefs();
}

function perfilAtivo() {
  const r = document.querySelector('input[name="perfil"]:checked');
  return r ? r.value : 'fiel';
}

function lerOpcoes() {
  return {
    ...DEFAULTS,
    reload: $('opt-reload').checked,
    scroll: $('opt-scroll').checked,
    hover: $('opt-hover').checked,
    scrollPasses: clamp(+$('opt-passes').value, 1, 5),
    scrollDwell: clamp(+$('opt-dwell').value, 100, 3000),
    depth: +$('opt-depth').value,
    maxPages: clamp(+$('opt-maxpages').value, 1, 300),
    deepScanJs: $('opt-deep').checked,
    crossOriginAssets: $('opt-cdn').checked,
    includeMedia: $('opt-media').checked,
    skipAnalytics: $('opt-analytics').checked,
    apiCache: $('opt-api').checked,
    saveSnapshot: $('opt-snapshot').checked,
    designSystem: $('opt-design').checked,
    focarAba: $('opt-focar').checked,
    blockServiceWorker: $('opt-blocksw').checked,
    verboseRuntime: $('opt-verbose').checked,
    maxFileMB: clamp(+$('opt-maxfile').value, 1, 2000),
    concurrency: clamp(+$('opt-conc').value, 1, 24)
  };
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

/* ──────────────────────────── preferências ───────────────────────────── */

async function salvarPrefs() {
  try {
    await chrome.storage.local.set({
      prefs: lerOpcoes(),
      destino: el.destino.value,
      perfil: perfilAtivo()
    });
  } catch { /* sem persistência é apenas inconveniente */ }
}

async function carregarPrefs() {
  try {
    const { prefs, destino, perfil } = await chrome.storage.local.get(['prefs', 'destino', 'perfil']);
    if (perfil) {
      const r = document.querySelector(`input[name="perfil"][value="${perfil}"]`);
      if (r) r.checked = true;
    }
    if (destino) el.destino.value = destino;
    if (!prefs) return;
    $('opt-reload').checked = prefs.reload !== false;
    $('opt-scroll').checked = prefs.scroll !== false;
    $('opt-hover').checked = !!prefs.hover;
    $('opt-passes').value = prefs.scrollPasses ?? 1;
    $('opt-dwell').value = prefs.scrollDwell ?? 420;
    $('opt-depth').value = String(prefs.depth ?? 0);
    $('opt-maxpages').value = prefs.maxPages ?? 25;
    $('opt-deep').checked = prefs.deepScanJs !== false;
    $('opt-cdn').checked = prefs.crossOriginAssets !== false;
    $('opt-media').checked = prefs.includeMedia !== false;
    $('opt-analytics').checked = prefs.skipAnalytics !== false;
    $('opt-api').checked = prefs.apiCache !== false;
    $('opt-snapshot').checked = prefs.saveSnapshot !== false;
    $('opt-design').checked = prefs.designSystem !== false;
    $('opt-focar').checked = prefs.focarAba !== false;
    $('opt-blocksw').checked = prefs.blockServiceWorker !== false;
    $('opt-verbose').checked = !!prefs.verboseRuntime;
    $('opt-maxfile').value = prefs.maxFileMB ?? 80;
    $('opt-conc').value = prefs.concurrency ?? 8;
  } catch { /* ignora */ }
}

/* ─────────────────────────────── alvo ────────────────────────────────── */

async function detectarAba() {
  const params = new URLSearchParams(location.search);
  const fromParam = params.get('tab');

  let tab = null;
  if (fromParam) {
    try { tab = await chrome.tabs.get(+fromParam); } catch { tab = null; }
  }
  if (!tab || !/^https?:/.test(tab.url || '')) {
    const [ativa] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (ativa && /^https?:/.test(ativa.url || '')) tab = ativa;
    else {
      const todas = await chrome.tabs.query({});
      tab = todas.find((t) => /^https?:/.test(t.url || '')) || null;
    }
  }

  if (tab) {
    alvoTabId = tab.id;
    el.alvo.value = tab.url;
    el.alvoInfo.textContent = (tab.title || '').slice(0, 110) || 'Aba selecionada';
  } else {
    el.alvoInfo.textContent = 'Abra o site numa aba e clique em "Aba atual".';
  }
}

/* ──────────────────────────── telas e passos ─────────────────────────── */

function mostrar(qual) {
  for (const [nome, t] of Object.entries(tela)) t.hidden = nome !== qual;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const ORDEM = ['paginas', 'recursos', 'reescrita', 'runtime', 'design', 'gravacao'];
let faseAtual = -1;

/*
 * Peso de cada fase na barra. Numa captura de uma página só, quase todo o tempo
 * real está em baixar. Numa de site inteiro não: visitar seis páginas — navegar,
 * rolar cada uma até o fim, esperar o lazy-load — leva minutos, e reservar 10%
 * para isso deixa a barra praticamente parada justo na parte mais demorada.
 */
const PESO_PAGINA_UNICA = [0.1, 0.52, 0.11, 0.04, 0.06, 0.17];
const PESO_SITE_INTEIRO = [0.3, 0.38, 0.09, 0.03, 0.05, 0.15];
let pesos = PESO_PAGINA_UNICA;

function acenderFase(chave) {
  const i = ORDEM.indexOf(chave);
  if (i < 0) return;
  faseAtual = i;
  for (const linha of el.steps.querySelectorAll('.stepline')) {
    const pos = ORDEM.indexOf(linha.dataset.fase);
    linha.dataset.state = pos < i ? 'feito' : pos === i ? 'ativo' : '';
  }
  const base = pesos.slice(0, i).reduce((a, b) => a + b, 0);
  definirProgresso(base * 100);
}

function concluirFases() {
  for (const linha of el.steps.querySelectorAll('.stepline')) linha.dataset.state = 'feito';
  definirProgresso(100);
}

let pctMostrado = 0;
function definirProgresso(pct) {
  // Só avança: recuar a barra passa a impressão de que algo deu errado.
  pctMostrado = Math.max(pctMostrado, Math.min(100, pct));
  el.rail.style.width = pctMostrado.toFixed(1) + '%';
  el.runPct.textContent = Math.round(pctMostrado) + '%';
}

/* ─────────────────────────────── log ─────────────────────────────────── */

function log(nivel, msg) {
  const d = document.createElement('div');
  d.className = nivel;
  const hora = new Date().toLocaleTimeString('pt-BR', { hour12: false });
  d.textContent = `${hora}  ${msg}`;
  el.log.appendChild(d);
  el.log.scrollTop = el.log.scrollHeight;
  while (el.log.childElementCount > 600) el.log.removeChild(el.log.firstChild);
}

const ui = {
  log,
  stage(nome, chave) {
    el.runTitle.textContent = nome;
    if (chave) acenderFase(chave);
    log('info', `[ ${nome} ]`);
  },
  progress(p) {
    if (p.pages != null) {
      el.cPaginas.textContent = p.pages;
      el.numPaginas.textContent = p.pagesTotal && p.pagesTotal > p.pages
        ? `${p.pages} / ${p.pagesTotal}` : p.pages;
    }
    if (p.fetched != null) {
      el.cRecursos.textContent = p.fetched;
      el.numRecursos.textContent = p.total ? `${p.fetched} / ${p.total}` : p.fetched;
    }
    if (p.failed != null) {
      el.cFalhas.textContent = p.failed;
      el.statFalhas.classList.toggle('alert', p.failed > 0);
    }
    if (p.bytes != null) el.cBytes.textContent = formatBytes(p.bytes);
    if (p.written != null) el.numGravados.textContent = `${p.written} / ${p.total}`;

    // Progresso dentro da fase corrente, sem passar do início da próxima.
    //
    // A fase de páginas não tem total conhecido — a fila cresce enquanto os
    // links aparecem. Usar "visitadas / (visitadas + na fila)" resolve: a razão
    // tende a 1 conforme a fila esvazia, e como a barra só avança, uma fila que
    // cresce faz ela parar em vez de voltar.
    const i = Math.max(0, faseAtual);
    const base = pesos.slice(0, i).reduce((a, b) => a + b, 0);

    let feito = null;
    if (p.total) feito = (p.written ?? p.fetched ?? 0) / p.total;
    else if (p.pagesTotal) feito = (p.pages + (p.emAndamento || 0) * 0.5) / p.pagesTotal;

    if (feito != null) definirProgresso((base + pesos[i] * Math.min(1, feito)) * 100);
  }
};

/* ────────────────────────────── captura ──────────────────────────────── */

async function capturar() {
  if (rodando) return;

  const url = el.alvo.value.trim();
  if (!/^https?:\/\//i.test(url)) {
    erro('Informe um endereço começando com http:// ou https://');
    return;
  }
  if (!alvoTabId) {
    erro('Nenhuma aba alvo. Clique em "Aba atual".');
    return;
  }

  const opts = { ...lerOpcoes(), plataforma: PLATAFORMA };

  await salvarPrefs();

  // O seletor de pasta exige gesto do usuário — precisa vir antes de tudo.
  let sink;
  let modo = el.destino.value;
  try {
    if (modo === 'pasta' && !supportsDirectoryPicker()) {
      modo = 'zip';
      el.status.textContent = 'Seletor de pastas indisponível; saindo em .zip.';
    }
    sink = modo === 'pasta'
      ? await DirectoryWriter.pick()
      : new ZipWriterSink(nomeArquivo(url) + '.zip');
  } catch (e) {
    if (e.name === 'AbortError') erro('Seleção de pasta cancelada.');
    else erro(e.message);
    return;
  }

  rodando = true;
  el.capturar.disabled = true;
  el.status.textContent = '';
  el.status.classList.remove('err');
  el.log.textContent = '';
  pctMostrado = 0;
  faseAtual = -1;
  // Sem profundidade só a página inicial é visitada, por mais alto que esteja o
  // limite de páginas — quem decide é o depth.
  pesos = opts.depth > 0 ? PESO_SITE_INTEIRO : PESO_PAGINA_UNICA;
  definirProgresso(0);
  el.cPaginas.textContent = '0';
  el.cRecursos.textContent = '0';
  el.cBytes.textContent = '0 B';
  el.cFalhas.textContent = '0';
  el.statFalhas.classList.remove('alert');
  el.numPaginas.textContent = el.numRecursos.textContent = el.numGravados.textContent = '';
  el.topbarNote.textContent = 'Capturando…';
  mostrar('progresso');

  log('info', `Alvo: ${url}`);
  log('info', `Destino: ${modo === 'pasta' ? 'pasta ' + sink.root.name : 'arquivo .zip'}`);

  try {
    const r = await runCapture({ tabId: alvoTabId, startUrl: url, options: opts, sink, ui });
    concluirFases();
    mostrarResultado(r, modo);
    el.topbarNote.textContent = 'Concluído';
    mostrar('fim');
  } catch (e) {
    log('error', `Captura interrompida: ${e.message}`);
    el.runTitle.textContent = 'A captura falhou';
    el.topbarNote.textContent = 'Falhou';
    mostrarFalha(e);
    console.error(e);
  } finally {
    rodando = false;
    el.capturar.disabled = false;
  }
}

function erro(msg) {
  el.status.textContent = msg;
  el.status.classList.add('err');
}

function nomeArquivo(url) {
  try {
    const u = new URL(url);
    const base = u.host.replace(/^www\./, '').replace(/[^\w.-]/g, '_');
    return `${base}-${new Date().toISOString().slice(0, 10)}`;
  } catch { return 'site-baixado'; }
}

/* ───────────────────────────── resultado ─────────────────────────────── */

const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';
const ICON_TERM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7l4 4-4 4M12 15h7"/></svg>';
const ICON_PALETA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.5 0-.4-.2-.8-.5-1.1-.3-.3-.4-.6-.4-1 0-.8.7-1.4 1.5-1.4H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="8.5" r="1.2" fill="currentColor" stroke="none"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M8 5.5v13l11-6.5z"/></svg>';
const ICON_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

function mostrarResultado(r, modo) {
  const falhasReais = r.falhas.filter((f) => !f.skipped);
  const p = [];

  p.push(`<div class="done-badge">${ICON_CHECK} Captura concluída</div>`);
  p.push(`<h2 style="margin:0 0 10px;font-size:32px;font-weight:500;letter-spacing:-.035em">
    ${r.arquivos} arquivos salvos</h2>`);
  p.push(`<p class="done-line">
    <b>${r.paginas}</b> página${r.paginas > 1 ? 's' : ''} ·
    <b>${r.recursos}</b> recursos ·
    <b>${formatBytes(r.totalBytes)}</b> ·
    <b>${r.segundos}s</b></p>`);

  p.push(`<div class="card">
    <p class="card-title">${ICON_FOLDER} Onde ficou</p>
    <p>${modo === 'pasta'
      ? `Na pasta <code>${escapar(r.name)}</code> que você escolheu.`
      : `No arquivo <code>${escapar(r.name)}</code>, nos seus downloads. Descompacte antes de abrir.`}</p>
  </div>`);

  const zip = modo !== 'pasta';
  p.push(`<div class="card">
    <p class="card-title">${ICON_PLAY} Como abrir</p>
    <p>${zip ? 'Descompacte a pasta e execute' : 'Execute'} <code>${ATALHO}</code>.
       Ele sobe o servidor e abre o site no navegador sozinho.</p>
    ${NO_WINDOWS ? '' : `
    <p><b>Na primeira vez o macOS vai bloquear</b>, com o aviso de que a Apple não
       pode verificar o arquivo. Não é problema da captura: o sistema marca como
       suspeito tudo que um navegador grava, e recusa executar script sem assinatura.
       Contorne uma vez pelo Terminal, onde essa trava não se aplica:</p>
    <ol class="steps-num">
      <li>Abra o Terminal</li>
      <li>Digite <code>bash</code> e um espaço</li>
      <li>Arraste o <code>${ATALHO}</code> para dentro da janela</li>
      <li>Enter</li>
    </ol>
    <p class="note">O script desfaz o bloqueio em si mesmo. A partir da segunda vez,
       o duplo clique funciona normalmente.</p>`}
    <p style="margin-top:16px">Não abra o <code>index.html</code> com dois cliques. Quando a página é
       aberta direto do disco, o navegador bloqueia justamente o que um site 3D
       precisa: módulos ES, <code>fetch()</code> de modelos e texturas WebGL.</p>
  </div>`);

  if (r.designSystem) {
    const d = r.designSystem;
    p.push(`<div class="card">
      <p class="card-title">${ICON_PALETA} Design system extraído</p>
      <p>Abra <code>design-system.html</code>, na raiz da pasta: o hero clonado do
         site, a tipografia com as classes originais e cada componente pintado pelo
         CSS do próprio site. Nada foi redesenhado.</p>
      <div class="ds-chips">
        <span><b>${d.cores}</b> cores</span>
        <span><b>${d.estilosTexto}</b> estilos de texto</span>
        <span><b>${d.familias}</b> famílias</span>
        <span><b>${d.fontes}</b> fontes</span>
        <span><b>${d.variaveis}</b> variáveis</span>
        <span><b>${d.breakpoints}</b> breakpoints</span>
        <span>tema <b>${escapar(d.tema)}</b></span>
        ${d.componentes ? `<span><b>${d.componentes}</b> componentes</span>` : ''}
        ${d.icones ? `<span><b>${d.icones}</b> ícones</span>` : ''}
        ${d.sliders ? `<span><b>${d.sliders}</b> sliders</span>` : ''}
        ${d.hero ? '<span>hero clonado</span>' : ''}
        ${(d.bibliotecas || []).length ? `<span>${escapar(d.bibliotecas.slice(0, 3).join(' · '))}</span>` : ''}
      </div>
      <p style="margin-top:14px">Em <code>design-system/</code> vão a mesma leitura em
         folha neutra, <code>tokens.css</code> pronto para colar no seu projeto e
         <code>tokens.json</code> com os dados completos.</p>
    </div>`);
  }

  if (falhasReais.length) {
    const itens = falhasReais.slice(0, 100)
      .map((f) => `<li>[${f.status || '?'}] ${escapar(f.url)}</li>`).join('');
    p.push(`<details class="fails">
      <summary>${falhasReais.length} recurso${falhasReais.length > 1 ? 's' : ''} não veio${falhasReais.length > 1 ? 'ram' : ''}. Quase sempre é rastreador ou arquivo que exige login</summary>
      <ul>${itens}</ul>
    </details>`);
  }

  el.resultado.innerHTML = p.join('');
}

function mostrarFalha(e) {
  el.resultado.innerHTML = `
    <h2 style="margin:0 0 10px;font-size:30px;font-weight:500;letter-spacing:-.035em">A captura falhou</h2>
    <p class="done-line">${escapar(e.message)}</p>
    <div class="card">
      <p class="card-title">${ICON_TERM} O que tentar</p>
      <ol class="steps-num">
        <li>Confira se a aba do site continua aberta e carregada</li>
        <li>Recarregue a página e capture de novo</li>
        <li>Abra "Detalhes técnicos" no passo anterior para ver onde parou</li>
      </ol>
    </div>`;
  mostrar('fim');
}

function escapar(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ──────────────────────────────── ligação ────────────────────────────── */

el.capturar.addEventListener('click', capturar);
el.usarAba.addEventListener('click', detectarAba);
el.nova.addEventListener('click', () => {
  el.topbarNote.textContent = '';
  mostrar('form');
});

for (const r of document.querySelectorAll('input[name="perfil"]')) {
  r.addEventListener('change', () => aplicarPerfil(r.value));
}

for (const input of document.querySelectorAll('.tuning-body input, .tuning-body select')) {
  input.addEventListener('change', salvarPrefs);
}

el.destino.addEventListener('change', () => {
  el.destinoHint.textContent = el.destino.value === 'pasta'
    ? 'Grava direto na pasta escolhida'
    : 'Junta tudo num .zip; evite acima de 1 GB';
});

el.alvo.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') capturar();
});

window.addEventListener('beforeunload', (e) => {
  if (rodando) { e.preventDefault(); e.returnValue = ''; }
});

(async function iniciar() {
  await carregarPrefs();
  mostrar('form');
  await detectarAba();
  if (!supportsDirectoryPicker()) {
    el.destino.value = 'zip';
    el.destinoHint.textContent = 'Seletor de pastas indisponível neste navegador';
  }
})();
