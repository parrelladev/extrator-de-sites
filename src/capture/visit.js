/*
 * visit.js — fase 1: visita cada pagina, dirige a rolagem, deixa o site
 * carregar de verdade e colhe tudo que a rede e o DOM mostraram.
 */

import { stripHash, safeUrl, decodeText } from '../shared/util.js';
import { discoverHtmlUrls } from '../rewrite/html.js';
import { DEFAULTS } from './options.js';
import { sendToTab, ensureInjected, sleep, waitForLoad, navigate } from './tab.js';

export async function visitarPaginas(ctx) {
  const {
    tabId, startUrl, opts, ui, map, fetcher, pages, failures, seen,
    workerUrls, apiBodies, coletasDesign, libsVistas, homeOrigin, enqueue
  } = ctx;

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
      queued: ctx.queue.size
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
          if (!ctx.padroesRef && d.padroes) ctx.padroesRef = d.padroes;
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
      queued: ctx.queue.size
    });
  }

  if (!pages.length) throw new Error('Nenhuma pagina pode ser capturada.');
}
