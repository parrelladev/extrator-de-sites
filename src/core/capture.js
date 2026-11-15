/*
 * capture.js — o pipeline completo.
 *
 * Fases:
 *   1. Visitar pagina(s): dirigir o scroll, deixar o site carregar de verdade,
 *      colher tudo que a rede viu.
 *   2. Baixar recursos, descobrindo novos recursivamente (CSS -> fontes,
 *      JS -> modelos, HTML de iframe -> mais assets).
 *   3. Reescrever HTML/CSS/JS.
 *   4. Gerar a camada __offline/ e os scripts de servidor.
 *   5. Gravar no destino escolhido.
 */

import {
  pool, kindOf, decodeText, encodeText, stripHash, safeUrl,
  isAnalytics, relativePath, formatBytes
} from './util.js';
import { UrlMap, OFFLINE_DIR } from './urlmap.js';
import { Fetcher } from './fetcher.js';
import { discoverCssUrls, rewriteCss } from './css.js';
import { discoverHtmlUrls, rewriteHtml } from './html.js';
import { rewriteModuleSpecifiers, discoverAssetsInJs, rewriteQuotedUrls } from './js.js';
import {
  mesclarColetas, analisarCssBaixado, construirDesignSystem,
  gerarTokensCss, extrairFontesLocais
} from './design.js';
import { gerarPaginaDesign } from './design-page.js';
import { gerarPaginaViva } from './design-live.js';

export const DEFAULTS = {
  depth: 0,
  maxPages: 25,
  maxResources: 4000,
  concurrency: 8,
  maxFileMB: 80,
  scroll: true,
  scrollPasses: 1,
  scrollDwell: 420,
  scrollStep: 0.7,
  repousoMs: 45000,      // teto da fase de repouso, depois da rolagem
  repousoQuietoMs: 4000, // quietude de rede exigida para dar a pagina por pronta
  hover: false,
  reload: true,
  deepScanJs: true,
  includeMedia: true,
  skipAnalytics: true,
  saveSnapshot: true,
  apiCache: true,
  blockServiceWorker: true,
  verboseRuntime: false,
  crossOriginAssets: true,
  designSystem: true,
  focarAba: true,       // traz a aba para frente enquanto rola (ver autoscroll)
  plataforma: 'unix'   // 'windows' | 'unix' — decide qual atalho e gerado
};

const MEDIA_KINDS = new Set(['video', 'audio']);

/* --------------------------- ponte com a aba --------------------------- */

function sendToTab(tabId, msg, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('a aba nao respondeu a tempo')), timeoutMs);
    chrome.tabs.sendMessage(tabId, { ns: 'xtr', ...msg }, (res) => {
      clearTimeout(timer);
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      resolve(res);
    });
  });
}

async function ensureInjected(tabId) {
  try {
    const r = await sendToTab(tabId, { type: 'ping' }, 2500);
    if (r && r.ok) return true;
  } catch { /* precisa injetar */ }
  await chrome.runtime.sendMessage({ ns: 'xtr-bg', type: 'inject', tabId });
  await sleep(400);
  try {
    const r = await sendToTab(tabId, { type: 'ping' }, 4000);
    return !!(r && r.ok);
  } catch { return false; }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function waitForLoad(tabId, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpd);
      resolve(false); // segue mesmo assim: sites 3D as vezes nunca ficam "complete"
    }, timeoutMs);

    function onUpd(id, info) {
      if (id !== tabId || info.status !== 'complete' || done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpd);
      resolve(true);
    }
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.get(tabId).then((t) => {
      if (!done && t && t.status === 'complete') {
        done = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpd);
        resolve(true);
      }
    }).catch(reject);
  });
}

async function navigate(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  await sleep(300);
  await waitForLoad(tabId);
  await sleep(500);
}

/* ------------------------------ pipeline ------------------------------- */

export async function runCapture(args) {
  // Os coletores so ficam registrados enquanto a captura roda (ver background.js).
  await chrome.runtime.sendMessage({ ns: 'xtr-bg', type: 'armar' }).catch(() => {});
  try {
    return await capturar(args);
  } finally {
    await chrome.runtime.sendMessage({ ns: 'xtr-bg', type: 'desarmar' }).catch(() => {});
  }
}

async function capturar({ tabId, startUrl, options, sink, ui }) {
  const opts = { ...DEFAULTS, ...options };
  const t0 = Date.now();

  const map = new UrlMap(startUrl);
  const fetcher = new Fetcher({ maxBytes: opts.maxFileMB * 1024 * 1024, casa: startUrl });
  const resources = new Map();   // key -> record
  const pages = [];
  const failures = [];
  const workerUrls = new Set();
  const apiBodies = new Map();   // "GET|url" -> {ct,b64}
  const coletasDesign = [];
  let padroesRef = null;      // fragmentos da pagina de referencia (so a primeira)
  const libsVistas = new Set();   // bibliotecas que a pagina realmente carregou
  const homeOrigin = new URL(startUrl).origin;

  const seen = new Set();
  let queue = new Set();

  const enqueue = (raw, from) => {
    const u = safeUrl(raw, from || startUrl);
    if (!u) return;
    const key = stripHash(u.href);
    if (seen.has(key)) return;
    if (!fetcher.permitida(key)) return;
    if (opts.skipAnalytics && isAnalytics(key)) return;
    if (!opts.crossOriginAssets && u.origin !== homeOrigin) return;
    if (!opts.includeMedia && /\.(mp4|webm|mov|m4v|ogv|mp3|wav|m4a|aac|flac)(\?|$)/i.test(key)) return;
    if (seen.size >= opts.maxResources) return;
    seen.add(key);
    queue.add(key);
  };

  /* ---- FASE 1: paginas -------------------------------------------- */
  ui.stage('Visitando páginas', 'paginas');
  const pageQueue = [{ url: stripHash(startUrl), depth: 0 }];
  const visited = new Set();

  while (pageQueue.length && pages.length < opts.maxPages) {
    const { url, depth } = pageQueue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    ui.log('info', `Pagina ${pages.length + 1}: ${url}`);
    // A barra precisa andar durante a fase 1 tambem. Numa captura de site
    // inteiro esta fase leva minutos, e ficar em 0% ate o primeiro download
    // parece travamento.
    ui.progress({
      pages: pages.length,
      pagesTotal: Math.min(opts.maxPages, pages.length + 1 + pageQueue.length),
      emAndamento: 1,          // a pagina em curso conta como meia
      queued: queue.size
    });

    try {
      const tab = await chrome.tabs.get(tabId);
      const needNav = stripHash(tab.url || '') !== url || (opts.reload && pages.length === 0);
      if (needNav) await navigate(tabId, url);
      else if (opts.reload) { await chrome.tabs.reload(tabId); await sleep(300); await waitForLoad(tabId); await sleep(500); }
    } catch (e) {
      ui.log('warn', `Nao consegui navegar ate ${url}: ${e.message}`);
      continue;
    }

    const injected = await ensureInjected(tabId);
    if (!injected) {
      ui.log('error', 'Os scripts de coleta nao puderam ser injetados nesta pagina.');
      continue;
    }

    if (opts.scroll) {
      ui.log('info', 'Rolando a pagina para disparar lazy-load, ScrollTrigger e parallax...');
      const orcamento = 120000;
      /*
       * O repouso inteiro vale para a primeira pagina — e nela que moram as
       * sequencias pesadas de abertura. Nas seguintes ele encurta: numa
       * captura de site inteiro, 60 paginas x 45s de espera seriam 45 minutos
       * so parando, e o ganho por pagina interna e bem menor.
       */
      const tetoRepouso = opts.repousoMs ?? DEFAULTS.repousoMs;
      const repouso = pages.length === 0 ? tetoRepouso : Math.min(tetoRepouso, 15000);
      const marcaRolagem = Date.now();

      /*
       * O auto-scroll vive de setTimeout, e o Chrome estrangula timers de aba
       * oculta: depois de cinco minutos escondida, um timeout de 400ms passa a
       * disparar UMA VEZ POR MINUTO. Numa captura de varias paginas isso
       * aparece do jeito mais confuso possivel — as primeiras paginas voam, e
       * da quarta em diante cada uma queima os quatro minutos de espera e volta
       * sem ter rolado nada.
       *
       * Por isso a aba do site vem para frente enquanto rola. Ela so precisa
       * ficar ativa na PROPRIA janela: se o usuario estiver em outra janela,
       * nada e roubado dele. O Estudio volta a ser a aba ativa em seguida, o
       * que tambem zera o relogio de "escondida" dele a cada pagina.
       */
      let devolverPara = null;
      if (opts.focarAba) {
        try {
          const alvo = await chrome.tabs.get(tabId);
          const [ativa] = await chrome.tabs.query({ active: true, windowId: alvo.windowId });
          if (ativa && ativa.id !== tabId) devolverPara = ativa.id;
          if (!alvo.active) {
            await chrome.tabs.update(tabId, { active: true });
            await sleep(250);   // visibilitychange costuma religar animacoes
          }
        } catch (e) { devolverPara = null; }
      }

      try {
        const rolou = await sendToTab(tabId, {
          type: 'autoscroll',
          opts: {
            stepRatio: opts.scrollStep,
            dwell: opts.scrollDwell,
            passes: opts.scrollPasses,
            hover: opts.hover,
            budgetMs: orcamento,
            repousoMs: repouso,
            repousoQuietoMs: opts.repousoQuietoMs ?? DEFAULTS.repousoQuietoMs
          }
        }, orcamento + repouso + 60000);
        ui.log('info', `Rolagem concluida em ${Math.round((Date.now() - marcaRolagem) / 1000)}s.`);
        // Sequencias de imagem e pre-carregamentos agendados em idle so
        // aparecem depois que a pagina para. Vale dizer quantos vieram ai.
        if (rolou && rolou.repouso > 0) {
          ui.log('info', `Repouso: mais ${rolou.repouso} recursos pedidos depois que a pagina parou.`);
        }
      } catch (e) {
        ui.log('warn', `Auto-scroll interrompido apos ${Math.round((Date.now() - marcaRolagem) / 1000)}s: ${e.message}`);
      } finally {
        if (devolverPara != null) {
          try { await chrome.tabs.update(devolverPara, { active: true }); } catch (e) {}
        }
      }
    }

    let collected;
    try {
      collected = await sendToTab(tabId, { type: 'collect' }, 90000);
    } catch (e) {
      ui.log('error', `Falha ao coletar: ${e.message}`);
      continue;
    }
    if (!collected || !collected.ok) {
      ui.log('error', `Coleta invalida: ${collected && collected.error}`);
      continue;
    }
    if (collected.hooksMissing) {
      ui.log('warn', 'Os hooks de runtime nao responderam. Recarregue a pagina com a opcao "Recarregar antes de capturar" ligada para captura completa.');
    }

    // Tokens de design da pagina viva. Precisa vir antes de sair dela: o
    // computed style so existe enquanto a pagina esta montada.
    if (opts.designSystem) {
      try {
        // Os fragmentos (hero, botoes, cartoes) vem so da primeira pagina: a
        // biblioteca viva documenta UM site, e somar heros de varias paginas
        // so produziria ruido.
        const primeira = coletasDesign.length === 0;
        const d = await sendToTab(tabId, { type: 'design', padroes: primeira }, 90000);
        if (d && d.ok) {
          coletasDesign.push(d);
          if (!padroesRef && d.padroes) padroesRef = d.padroes;
          ui.log('info', `Design: ${d.tokens.elementosLidos} de ${d.tokens.elementosTotais} elementos analisados.`);
          if (primeira) {
            if (d.padroes) {
              const c = d.padroes.componentes || {};
              const n = Object.values(c).reduce((t, x) => t + (x ? x.length : 0), 0);
              const L = d.padroes.layout || {};
              ui.log('ok', `Padroes capturados: ${d.padroes.hero ? 'hero + ' : ''}${n} componentes, ` +
                           `${(d.padroes.icones || []).length} icones, ` +
                           `${(c.sliders || []).length} sliders, ` +
                           `${(d.padroes.folhas || []).length} folhas de estilo.`);
              if (L.container) {
                ui.log('info', `Layout: container ${L.container.maxLargura}, respiro ${L.container.padEsquerda}.`);
              }
            } else if (d.padroesErro) {
              ui.log('warn', `Captura de padroes falhou: ${d.padroesErro}`);
            }
          }
        }
      } catch (e) {
        ui.log('warn', `Coleta de design falhou nesta pagina: ${e.message}`);
      }
    }

    // HTML de origem (nao o DOM renderizado): e assim que o site boota igual.
    const docRes = await fetcher.get(url, { referrer: url });
    if (!docRes.ok || !docRes.bytes) {
      ui.log('error', `Nao consegui baixar o HTML de ${url} (${docRes.error})`);
      failures.push({ url, error: docRes.error, kind: 'document' });
      continue;
    }

    const docLocal = map.assign(url, 'document');
    if (docRes.finalUrl && docRes.finalUrl !== url) map.alias(stripHash(docRes.finalUrl), docLocal);
    seen.add(url);

    const htmlText = decodeText(docRes.bytes, docRes.contentType);
    const page = {
      url,
      localPath: docLocal,
      html: htmlText,
      snapshot: opts.saveSnapshot ? collected.snapshot : '',
      title: collected.title || ''
    };
    pages.push(page);

    for (const l of collected.libs || []) libsVistas.add(l);

    // tudo que a pagina realmente carregou
    for (const u of collected.runtimeUrls || []) enqueue(u, url);
    for (const u of collected.domUrls || []) enqueue(u, url);
    for (const w of collected.workers || []) { workerUrls.add(stripHash(w)); enqueue(w, url); }
    for (const b of collected.bodies || []) if (!apiBodies.has(b.key)) apiBodies.set(b.key, { ct: b.ct, b64: b.b64 });

    // e o que so aparece no HTML de origem (nao renderizado ainda)
    const fromSource = discoverHtmlUrls(htmlText, url);
    for (const u of fromSource.found) enqueue(u, url);

    ui.log('ok', `Coletadas ${(collected.runtimeUrls || []).length} URLs de runtime + ${(collected.domUrls || []).length} do DOM.`);

    if (depth < opts.depth) {
      const links = new Set([...(collected.links || []), ...fromSource.links]);
      for (const l of links) {
        const lu = safeUrl(l, url);
        if (!lu || lu.origin !== homeOrigin) continue;
        const lk = stripHash(lu.href);
        if (visited.has(lk)) continue;
        if (/\.(jpg|jpeg|png|webp|gif|svg|pdf|zip|mp4|mp3|glb|gltf)$/i.test(lu.pathname)) continue;
        pageQueue.push({ url: lk, depth: depth + 1 });
      }
    }
    ui.progress({
      pages: pages.length,
      pagesTotal: Math.min(opts.maxPages, pages.length + pageQueue.length),
      queued: queue.size
    });
  }

  if (!pages.length) throw new Error('Nenhuma pagina pode ser capturada.');

  /* ---- FASE 2: recursos ------------------------------------------- */
  ui.stage('Baixando recursos', 'recursos');
  let round = 0;
  let fetched = 0;

  while (queue.size && round < 12) {
    round++;
    const batch = [...queue];
    queue = new Set();
    ui.log('info', `Rodada ${round}: ${batch.length} recursos.`);

    await pool(batch, opts.concurrency, async (url) => {
      if (resources.has(url)) return;
      const res = await fetcher.get(url, { referrer: startUrl });
      fetched++;

      if (!res.ok || !res.bytes) {
        failures.push({ url, error: res.error || 'falhou', status: res.status });
        ui.progress({ fetched, total: fetched + queue.size, failed: failures.length, bytes: fetcher.stats.bytes });
        return;
      }

      const kind = kindOf(res.contentType, new URL(url).pathname);
      if (!opts.includeMedia && MEDIA_KINDS.has(kind)) {
        failures.push({ url, error: 'midia ignorada por opcao', skipped: true });
        return;
      }

      const localPath = map.assign(url, kind, res.contentType);
      if (res.finalUrl && stripHash(res.finalUrl) !== url) map.alias(stripHash(res.finalUrl), localPath);

      const rec = { url, kind, contentType: res.contentType, bytes: res.bytes, localPath };
      resources.set(url, rec);

      // descoberta recursiva
      try {
        if (kind === 'css') {
          const text = decodeText(res.bytes, res.contentType);
          rec.text = text;
          for (const u of discoverCssUrls(text, url)) enqueue(u, url);
        } else if (kind === 'js') {
          const text = decodeText(res.bytes, res.contentType);
          rec.text = text;
          if (opts.deepScanJs) {
            for (const u of discoverAssetsInJs(text, url, startUrl)) enqueue(u, url);
          }
        } else if (kind === 'document') {
          const text = decodeText(res.bytes, res.contentType);
          rec.text = text;
          const d = discoverHtmlUrls(text, url);       // iframes
          for (const u of d.found) enqueue(u, url);
        } else if (kind === 'json' && /\.gltf(\?|$)/i.test(url)) {
          // .gltf referencia .bin e texturas por caminho relativo
          const text = decodeText(res.bytes, res.contentType);
          rec.text = text;
          const re = /"uri"\s*:\s*"([^"]+)"/g;
          let m;
          while ((m = re.exec(text)) !== null) {
            if (!/^data:/i.test(m[1])) enqueue(m[1], url);
          }
        } else if (kind === 'json' && /manifest|webmanifest/i.test(url)) {
          const text = decodeText(res.bytes, res.contentType);
          rec.text = text;
          const re = /"src"\s*:\s*"([^"]+)"/g;
          let m;
          while ((m = re.exec(text)) !== null) enqueue(m[1], url);
        }
      } catch (e) {
        ui.log('warn', `Analise de ${url} falhou: ${e.message}`);
      }

      ui.progress({ fetched, total: fetched + queue.size, failed: failures.length, bytes: fetcher.stats.bytes });
    });
  }

  ui.log('ok', `${resources.size} recursos baixados (${formatBytes(fetcher.stats.bytes)}), ${failures.length} falhas.`);

  /* ---- FASE 3: normalizar caminhos e reescrever -------------------- */
  ui.stage('Reescrevendo referências', 'reescrita');
  const renamed = map.resolveDirFileConflicts();
  if (renamed) ui.log('info', `${renamed} caminho(s) ajustado(s) por conflito arquivo/pasta.`);

  // Os localPath guardados nos registros podem ter mudado no passo acima.
  for (const rec of resources.values()) rec.localPath = map.get(rec.url) || rec.localPath;
  for (const p of pages) p.localPath = map.get(p.url) || p.localPath;

  const lookup = (u) => map.get(u);
  const files = [];   // {path, data}

  const hasApiCache = opts.apiCache && apiBodies.size > 0;

  for (const page of pages) {
    let html;
    try {
      html = rewriteHtml({
        html: page.html,
        docUrl: page.url,
        docLocal: page.localPath,
        lookup,
        opts: { apiCache: hasApiCache, stripCrossOrigin: true }
      });
    } catch (e) {
      ui.log('error', `Reescrita de ${page.url} falhou (${e.message}); salvando original.`);
      html = page.html;
    }
    files.push({ path: page.localPath, data: encodeText(html) });

    if (opts.saveSnapshot && page.snapshot) {
      const snapPath = page.localPath.replace(/\.html?$/i, '') + '.snapshot.html';
      let snap;
      try {
        snap = rewriteHtml({
          html: page.snapshot,
          docUrl: page.url,
          docLocal: snapPath,
          lookup,
          opts: { apiCache: hasApiCache, stripCrossOrigin: true }
        });
      } catch { snap = page.snapshot; }
      files.push({ path: snapPath, data: encodeText(snap) });
    }
  }

  let rewrittenCss = 0, rewrittenJs = 0;
  for (const rec of resources.values()) {
    if (rec.kind === 'document') {
      // iframes e paginas auxiliares
      try {
        const html = rewriteHtml({
          html: rec.text || decodeText(rec.bytes, rec.contentType),
          docUrl: rec.url,
          docLocal: rec.localPath,
          lookup,
          opts: { apiCache: hasApiCache, stripCrossOrigin: true }
        });
        files.push({ path: rec.localPath, data: encodeText(html) });
      } catch {
        files.push({ path: rec.localPath, data: rec.bytes });
      }
      continue;
    }

    if (rec.kind === 'css') {
      const text = rec.text || decodeText(rec.bytes, rec.contentType);
      const out = rewriteCss(text, rec.url, rec.localPath, lookup);
      if (out !== text) rewrittenCss++;
      files.push({ path: rec.localPath, data: encodeText(out) });
      continue;
    }

    if (rec.kind === 'js') {
      let text = rec.text || decodeText(rec.bytes, rec.contentType);
      const r = rewriteModuleSpecifiers(text, rec.url, rec.localPath, lookup);
      text = r.code;
      if (r.changed) rewrittenJs++;

      if (workerUrls.has(rec.url)) {
        const rel = relativePath(rec.localPath, `${OFFLINE_DIR}/worker-runtime.js`);
        // O try/catch cobre worker de modulo (type:"module"), onde importScripts
        // nao existe; ali o shim simplesmente nao entra e o worker segue normal.
        const shim =
          `/* injetado por Extrator de Sites: compatibilidade offline dentro do worker */\n` +
          `try{importScripts(new URL(${JSON.stringify(rel)},self.location.href).href);}catch(e){}\n`;
        text = insertAfterPrologue(text, shim);
      }
      files.push({ path: rec.localPath, data: encodeText(text) });
      continue;
    }

    if (rec.kind === 'json' && rec.text) {
      const out = rewriteQuotedUrls(rec.text, rec.url, rec.localPath, lookup);
      files.push({ path: rec.localPath, data: encodeText(out) });
      continue;
    }

    files.push({ path: rec.localPath, data: rec.bytes });
  }
  ui.log('ok', `${rewrittenCss} CSS e ${rewrittenJs} JS reescritos.`);

  /* ---- FASE 4: camada offline + servidor --------------------------- */
  ui.stage('Camada de compatibilidade', 'runtime');

  const origins = [...new Set([...map.byKey.keys()].map((k) => {
    try { return new URL(k).origin; } catch { return null; }
  }).filter(Boolean))];

  const cfg = {
    map: map.exportFullMap(),
    paths: map.exportPathMap(),
    origins,
    blockServiceWorker: opts.blockServiceWorker,
    silenceBeacons: opts.skipAnalytics,
    verbose: opts.verboseRuntime,
    generatedAt: new Date().toISOString(),
    source: startUrl
  };

  const runtimeSrc = await loadTemplate('runtime.js');
  files.push({
    path: `${OFFLINE_DIR}/runtime.js`,
    data: encodeText(injectConfig(runtimeSrc, cfg))
  });

  const workerSrc = await loadTemplate('worker-runtime.js');
  files.push({
    path: `${OFFLINE_DIR}/worker-runtime.js`,
    data: encodeText(injectConfig(workerSrc, {
      map: cfg.map, paths: cfg.paths, origins: cfg.origins
    }))
  });

  if (hasApiCache) {
    const obj = {};
    for (const [k, v] of apiBodies) obj[k] = v;
    files.push({
      path: `${OFFLINE_DIR}/api-cache.js`,
      data: encodeText(
        '/* Respostas de API capturadas durante a navegacao, servidas offline. */\n' +
        'window.__XTR_API__ = ' + JSON.stringify(obj) + ';\n'
      )
    });
    ui.log('ok', `${apiBodies.size} respostas de API embutidas para funcionar offline.`);
  }

  const report = {
    origem: startUrl,
    geradoEm: new Date().toISOString(),
    paginas: pages.map((p) => ({ url: p.url, arquivo: p.localPath, titulo: p.title })),
    recursos: resources.size,
    bytes: fetcher.stats.bytes,
    falhas: failures,
    opcoes: opts
  };
  files.push({ path: `${OFFLINE_DIR}/relatorio.json`, data: encodeText(JSON.stringify(report, null, 2)) });

  /* ---- design system ------------------------------------------------ */
  let dsResumo = null;
  if (opts.designSystem && coletasDesign.length) {
    ui.stage('Extraindo design system', 'design');
    try {
      const cssBaixado = [...resources.values()]
        .filter((r) => r.kind === 'css' && r.text)
        .map((r) => ({ url: r.url, localPath: r.localPath, text: r.text }));

      const runtime = mesclarColetas(coletasDesign);
      const estatico = analisarCssBaixado(cssBaixado);
      const fontesLocais = extrairFontesLocais(cssBaixado, (u) => map.get(u));

      const ds = construirDesignSystem({
        runtime, estatico, fontesLocais,
        origem: startUrl,
        paginas: pages.map((p) => p.url),
        geradoEm: new Date().toLocaleString('pt-BR')
      });

      files.push({ path: 'design-system/index.html', data: encodeText(gerarPaginaDesign(ds)) });
      files.push({ path: 'design-system/tokens.css', data: encodeText(gerarTokensCss(ds)) });
      files.push({ path: 'design-system/tokens.json', data: encodeText(JSON.stringify(ds, null, 2)) });

      // A biblioteca viva mora na raiz, ao lado do index.html, e carrega o CSS
      // e as imagens do proprio site. Sai daqui com URLs absolutas da web e
      // passa pela mesma reescrita das paginas — so que pedindo caminho
      // relativo, porque este e o arquivo que o usuario abre com duplo clique.
      if (padroesRef) {
        try {
          const bruta = gerarPaginaViva({
            ds, padroes: padroesRef, origem: startUrl,
            libs: [...libsVistas],
            geradoEm: new Date().toLocaleString('pt-BR')
          });
          let viva;
          try {
            viva = rewriteHtml({
              html: bruta, docUrl: startUrl, docLocal: 'design-system.html',
              lookup,
              opts: { apiCache: hasApiCache, stripCrossOrigin: true, caminhos: 'relativo' }
            });
          } catch (e) {
            ui.log('warn', `Reescrita da biblioteca viva falhou (${e.message}); salvando com URLs originais.`);
            viva = bruta;
          }
          files.push({ path: 'design-system.html', data: encodeText(viva) });
          ui.log('ok', 'design-system.html gerado com o CSS do proprio site.');
        } catch (e) {
          ui.log('error', `Biblioteca viva falhou: ${e.message}`);
          failures.push({ url: 'design-system.html', error: e.message });
        }
      } else {
        ui.log('warn', 'Sem fragmentos da pagina: design-system.html nao foi gerado.');
      }

      dsResumo = {
        cores: ds.cores.length,
        estilosTexto: ds.tipografia.estilos.length,
        familias: ds.tipografia.familias.length,
        fontes: fontesLocais.length,
        variaveis: Object.keys(ds.variaveis).length,
        breakpoints: ds.breakpoints.length,
        tema: ds.resumo.tema,
        bibliotecaViva: !!padroesRef,
        hero: !!(padroesRef && padroesRef.hero),
        componentes: padroesRef
          ? Object.values(padroesRef.componentes || {}).reduce((t, x) => t + (x ? x.length : 0), 0)
          : 0,
        icones: padroesRef ? (padroesRef.icones || []).length : 0,
        sliders: padroesRef ? ((padroesRef.componentes || {}).sliders || []).length : 0,
        bibliotecas: [...libsVistas]
      };
      report.designSystem = dsResumo;
      ui.log('ok', `Design system: ${dsResumo.cores} cores, ${dsResumo.estilosTexto} estilos de texto, ` +
                   `${dsResumo.variaveis} variáveis, ${dsResumo.fontes} fontes.`);
    } catch (e) {
      ui.log('error', `Extração do design system falhou: ${e.message}`);
      failures.push({ url: 'design-system', error: e.message });
    }
  }

  // O motor do servidor vai para __offline/, junto com o resto da infraestrutura,
  // e a raiz recebe UM atalho — o do sistema em que a captura foi feita. Assim o
  // usuario abre a pasta e ve um unico arquivo para executar, em vez de escolher
  // entre tres e errar. (Os templates ficam com sufixo .tpl na extensao para
  // ninguem clicar no original em vez da copia gerada.)
  files.push({
    path: `${OFFLINE_DIR}/servidor.py`,
    data: encodeText(await loadTemplate('servidor.py.tpl'))
  });

  const noWindows = opts.plataforma === 'windows';
  files.push({
    path: noWindows ? 'ABRIR SITE.cmd' : 'ABRIR SITE.command',
    data: encodeText(await loadTemplate(noWindows ? 'abrir-site.cmd.tpl' : 'abrir-site.command.tpl')),
    // Só a saída .zip consegue carregar isto; numa pasta o navegador não deixa.
    executavel: !noWindows
  });

  const readme = buildReadme({ startUrl, pages, resources, failures, fetcher, opts, dsResumo });
  files.push({ path: 'LEIA-ME.txt', data: encodeText(readme) });

  /* ---- FASE 5: gravar ---------------------------------------------- */
  ui.stage('Gravando arquivos', 'gravacao');
  let written = 0;
  const seenPaths = new Set();
  for (const f of files) {
    if (seenPaths.has(f.path)) continue;    // pagina tambem listada como recurso
    seenPaths.add(f.path);
    try {
      await sink.write(f.path, f.data, f.executavel === true);
      written++;
      if (written % 25 === 0) ui.progress({ written, total: files.length });
    } catch (e) {
      ui.log('error', `Nao consegui gravar ${f.path}: ${e.message}`);
      failures.push({ url: f.path, error: 'gravacao: ' + e.message });
    }
  }
  ui.progress({ written, total: files.length });

  const result = await sink.finish();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  return {
    ...result,
    designSystem: dsResumo,
    paginas: pages.length,
    recursos: resources.size,
    arquivos: written,
    falhas: failures,
    segundos: secs,
    totalBytes: fetcher.stats.bytes
  };
}

/* ------------------------------ apoio ---------------------------------- */

/**
 * Insere codigo logo depois do prologo de diretivas do arquivo.
 *
 * Colar o shim antes de um "use strict" inicial faria a diretiva deixar de ser
 * prologo — vira uma expressao string solta, e o arquivo inteiro passa a rodar
 * em modo permissivo. Em bundle minificado isso muda semantica de verdade.
 */
function insertAfterPrologue(code, snippet) {
  const m = /^(?:\s*(?:(['"])use (?:strict|asm)\1\s*;?)\s*)+/.exec(code);
  const at = m ? m[0].length : 0;
  return code.slice(0, at) + (at ? '\n' : '') + snippet + code.slice(at);
}

const templateCache = new Map();

async function loadTemplate(name) {
  if (templateCache.has(name)) return templateCache.get(name);
  const res = await fetch(chrome.runtime.getURL('src/templates/' + name));
  const text = await res.text();
  templateCache.set(name, text);
  return text;
}

function injectConfig(src, cfg) {
  const marker = '/*__XTR_CONFIG__*/{';
  const at = src.indexOf(marker);
  if (at < 0) throw new Error('template sem marcador de configuracao');
  const close = matchBrace(src, at + marker.length - 1);
  return src.slice(0, at) + JSON.stringify(cfg) + src.slice(close + 1);
}

function matchBrace(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return i; }
  }
  throw new Error('chave nao fechada no template');
}

function buildReadme({ startUrl, pages, resources, failures, fetcher, opts, dsResumo }) {
  const L = [];
  const ehWindows = opts.plataforma === 'windows';
  const atalho = ehWindows ? 'ABRIR SITE.cmd' : 'ABRIR SITE.command';
  L.push('SITE BAIXADO COM O "EXTRATOR DE SITES"');
  L.push('='.repeat(60));
  L.push('');
  L.push(`Origem : ${startUrl}`);
  L.push(`Data   : ${new Date().toLocaleString('pt-BR')}`);
  L.push(`Paginas: ${pages.length}`);
  L.push(`Assets : ${resources.size} (${formatBytes(fetcher.stats.bytes)})`);
  L.push(`Falhas : ${failures.length}`);
  L.push('');
  L.push('COMO ABRIR');
  L.push('-'.repeat(60));
  L.push('');
  L.push(`Execute o arquivo "${atalho}" que esta nesta pasta.`);
  L.push('');
  L.push('Ele encontra o Python, sobe o servidor na primeira porta livre e abre');
  L.push('o site no navegador sozinho. E o unico arquivo que voce precisa tocar.');
  L.push('');
  if (!ehWindows) {
    L.push('NA PRIMEIRA VEZ o macOS vai bloquear, com o aviso de que a Apple nao');
    L.push('pode verificar o arquivo. Nao e problema da captura: o sistema marca');
    L.push('como suspeito tudo que um navegador grava, e recusa executar script');
    L.push('sem assinatura. Contorne uma vez pelo Terminal, onde a trava nao vale:');
    L.push('');
    L.push('  1. Abra o Terminal');
    L.push('  2. Digite  bash  e um espaco');
    L.push(`  3. Arraste o "${atalho}" para dentro da janela`);
    L.push('  4. Enter');
    L.push('');
    L.push('O script desfaz o bloqueio em si mesmo. A partir da segunda vez o');
    L.push('duplo clique funciona normalmente.');
    L.push('');
  }
  L.push('Nao abra o index.html com dois cliques. O navegador bloqueia, em');
  L.push('paginas abertas direto do disco, exatamente o que um site 3D usa:');
  L.push('modulos ES, fetch() de modelos .glb, texturas WebGL e fontes.');
  L.push('');
  L.push('O servidor tambem cobre a navegacao de SPA: se o site usa Next.js,');
  L.push('Nuxt ou SvelteKit e o roteador pedir "/sobre" de volta ao servidor,');
  L.push('ele entrega o arquivo certo em vez de uma pagina de erro.');
  L.push('');
  L.push('ESTRUTURA');
  L.push('-'.repeat(60));
  L.push('');
  L.push(`  ${atalho}${' '.repeat(Math.max(1, 22 - atalho.length))}inicia o servidor e abre o site`);
  L.push('  index.html            pagina principal');
  L.push('  _ext/<dominio>/       arquivos que vinham de CDNs (GSAP, fontes...)');
  L.push('  __offline/runtime.js  camada que redireciona as URLs para os');
  L.push('                        arquivos locais em tempo de execucao');
  L.push('  __offline/servidor.py motor do servidor local');
  L.push('  __offline/relatorio.json  o que foi baixado e o que falhou');
  L.push('  design-system.html    o design system montado com o CSS do proprio site');
  L.push('  design-system/        a mesma leitura em folha neutra, mais os tokens');
  if (opts.saveSnapshot) {
    L.push('  *.snapshot.html       DOM ja renderizado (referencia; as animacoes');
    L.push('                        de verdade estao no index.html)');
  }
  L.push('');
  if (failures.length) {
    L.push('FALHAS');
    L.push('-'.repeat(60));
    L.push('');
    L.push('Estes recursos nao vieram. Em geral sao rastreadores, endpoints que');
    L.push('exigem login ou arquivos acima do limite de tamanho configurado.');
    L.push('O site costuma funcionar sem eles.');
    L.push('');
    for (const f of failures.slice(0, 60)) L.push(`  [${f.status || '-'}] ${f.url}: ${f.error}`);
    if (failures.length > 60) L.push(`  ... e mais ${failures.length - 60}.`);
    L.push('');
  }
  if (dsResumo) {
    L.push('DESIGN SYSTEM');
    L.push('-'.repeat(60));
    L.push('');
    L.push('  http://localhost:<porta>/design-system.html');
    L.push('');
    L.push('E uma biblioteca viva, nao um relatorio: o hero clonado do site com o');
    L.push('texto trocado para apresentar o proprio design system, a tipografia com');
    L.push('as tags e classes originais, e cada componente pintado pelo CSS do site.');
    L.push('Nada foi redesenhado nem aproximado.');
    L.push('');
    L.push('Abra pelo servidor, nao com dois cliques: a pagina carrega as folhas de');
    L.push('estilo do site por caminho absoluto.');
    L.push('');
    L.push('O JavaScript de aplicacao fica de fora de proposito. React e Next');
    L.push('tentariam hidratar uma arvore que nao e a que eles geraram e apagariam');
    L.push('a pagina. Por isso o que depende de script (canvas 3D, carrossel) aparece');
    L.push('parado, no estado em que estava na hora da captura.');
    L.push('');
    L.push('Em design-system/ ficam a mesma leitura em folha neutra (index.html),');
    L.push('tokens.css pronto para colar num projeto e tokens.json com tudo.');
    L.push('');
  }
  L.push('DIAGNOSTICO');
  L.push('-'.repeat(60));
  L.push('');
  L.push('Se algo nao aparecer, abra o console do navegador (F12) e rode:');
  L.push('');
  L.push('  __XTR_OFFLINE__.stats        // quantas URLs foram redirecionadas');
  L.push('  __XTR_OFFLINE__.resolve(u)   // para onde uma URL aponta agora');
  L.push('');
  L.push('Um numero alto em "misses" indica assets que nao chegaram a ser');
  L.push('baixados: capture de novo com mais passadas de rolagem.');
  L.push('');
  return L.join('\n');
}
