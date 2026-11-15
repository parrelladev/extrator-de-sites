/*
 * bridge.js — recebe os comandos do Estudio (ping, autoscroll, design,
 * collect) e responde com o que os outros arquivos de content/ coletam.
 *
 * Ver scan.js para como os arquivos de content/ se enxergam.
 */
(function () {
  'use strict';
  if (window.__XTR_BRIDGE__) return;
  window.__XTR_BRIDGE__ = true;

  var XTR = window.__XTR__;

  var scanDom = XTR.scanDom;
  var pullFromMain = XTR.pullFromMain;
  var docHeight = XTR.docHeight;
  var repousar = XTR.repousar;
  var autoscroll = XTR.autoscroll;
  var hoverSweep = XTR.hoverSweep;
  var coletarTokens = XTR.coletarTokens;
  var coletarCssom = XTR.coletarCssom;
  var assentarNoTopo = XTR.assentarNoTopo;
  var coletarPadroes = XTR.coletarPadroes;

  /* ------------------------------------------------------------------ *
   * Protocolo de mensagens                                               *
   * ------------------------------------------------------------------ */
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.ns !== 'xtr') return false;

    (async function () {
      try {
        if (msg.type === 'ping') {
          return sendResponse({ ok: true, url: location.href, title: document.title, ready: document.readyState });
        }

        if (msg.type === 'autoscroll') {
          var rolagem = await autoscroll(msg.opts || {});
          if (msg.opts && msg.opts.hover) {
            await hoverSweep(msg.opts.hoverLimit);
            // o hover tambem pede rede; deixa assentar antes de coletar
            await repousar(Math.min(msg.opts.repousoMs || 45000, 15000), msg.opts.repousoQuietoMs);
          }
          return sendResponse({ ok: true, repouso: (rolagem && rolagem.repouso) || 0 });
        }

        if (msg.type === 'design') {
          var resposta = {
            ok: true,
            url: location.href,
            largura: window.innerWidth,
            tokens: coletarTokens(),
            cssom: coletarCssom()
          };
          // So a pagina de referencia entrega os fragmentos: a biblioteca viva
          // documenta UM site, e somar heros de varias paginas so faria ruido.
          if (msg.padroes) {
            await assentarNoTopo();
            try { resposta.padroes = coletarPadroes(); }
            catch (e) { resposta.padroesErro = String(e && e.message || e); }
          }
          return sendResponse(resposta);
        }

        if (msg.type === 'collect') {
          var dom = scanDom();
          var main = await pullFromMain();
          var html = '';
          try {
            html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
          } catch (e) { html = ''; }
          return sendResponse({
            ok: true,
            url: location.href,
            baseURI: document.baseURI,
            title: document.title || '',
            charset: document.characterSet || 'UTF-8',
            domUrls: dom.found,
            links: dom.links,
            runtimeUrls: main.urls || [],
            workers: main.workers || [],
            bodies: main.bodies || [],
            libs: main.libs || [],
            hooksMissing: !!main.missing,
            snapshot: html,
            height: docHeight()
          });
        }

        sendResponse({ ok: false, error: 'tipo desconhecido: ' + msg.type });
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.stack || err) });
      }
    })();

    return true; // resposta assincrona
  });
})();
