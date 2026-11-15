/*
 * capture/index.js — o pipeline completo, uma fase por arquivo:
 *
 *   1. visit.js     visita a(s) pagina(s): dirige o scroll, deixa o site
 *                   carregar de verdade e colhe tudo que a rede viu.
 *   2. download.js  baixa os recursos, descobrindo novos recursivamente.
 *   3. assemble.js  reescreve HTML/CSS/JS para os caminhos locais.
 *   4. package.js   gera a camada __offline/, o servidor e o atalho
 *                   (design-system.js acrescenta o design system).
 *   5. aqui         grava tudo no destino escolhido.
 *
 * As fases compartilham um unico objeto de contexto (ver criarContexto).
 */

import { stripHash, safeUrl, isAnalytics } from '../shared/util.js';
import { UrlMap } from './urlmap.js';
import { Fetcher } from './fetcher.js';
import { DEFAULTS } from './options.js';
import { visitarPaginas } from './visit.js';
import { baixarRecursos } from './download.js';
import { reescreverArquivos } from './assemble.js';
import { gerarDesignSystem } from './design-system.js';
import { gerarCamadaOffline, gerarApoio } from './package.js';

export { DEFAULTS };

export async function runCapture(args) {
  // Os coletores so ficam registrados enquanto a captura roda (ver background.js).
  await chrome.runtime.sendMessage({ ns: 'xtr-bg', type: 'armar' }).catch(() => {});
  try {
    return await capturar(args);
  } finally {
    await chrome.runtime.sendMessage({ ns: 'xtr-bg', type: 'desarmar' }).catch(() => {});
  }
}

/** O estado que atravessa as fases. */
function criarContexto({ tabId, startUrl, opts, ui }) {
  const ctx = {
    tabId, startUrl, opts, ui,
    homeOrigin: new URL(startUrl).origin,
    map: new UrlMap(startUrl),
    fetcher: new Fetcher({ maxBytes: opts.maxFileMB * 1024 * 1024, casa: startUrl }),
    resources: new Map(),      // key -> record
    pages: [],
    failures: [],
    workerUrls: new Set(),
    apiBodies: new Map(),      // "GET|url" -> {ct,b64}
    coletasDesign: [],
    padroesRef: null,          // fragmentos da pagina de referencia (so a primeira)
    libsVistas: new Set(),     // bibliotecas que a pagina realmente carregou
    seen: new Set(),
    queue: new Set()           // trocada por uma nova a cada rodada de download
  };

  ctx.enqueue = (raw, from) => {
    const u = safeUrl(raw, from || startUrl);
    if (!u) return;
    const key = stripHash(u.href);
    if (ctx.seen.has(key)) return;
    if (!ctx.fetcher.permitida(key)) return;
    if (opts.skipAnalytics && isAnalytics(key)) return;
    if (!opts.crossOriginAssets && u.origin !== ctx.homeOrigin) return;
    if (!opts.includeMedia && /\.(mp4|webm|mov|m4v|ogv|mp3|wav|m4a|aac|flac)(\?|$)/i.test(key)) return;
    if (ctx.seen.size >= opts.maxResources) return;
    ctx.seen.add(key);
    ctx.queue.add(key);
  };

  return ctx;
}

async function capturar({ tabId, startUrl, options, sink, ui }) {
  const opts = { ...DEFAULTS, ...options };
  const t0 = Date.now();
  const ctx = criarContexto({ tabId, startUrl, opts, ui });

  await visitarPaginas(ctx);
  await baixarRecursos(ctx);
  const saida = reescreverArquivos(ctx);        // { files, lookup, hasApiCache }
  await gerarCamadaOffline(ctx, saida);
  const dsResumo = gerarDesignSystem(ctx, saida);
  await gerarApoio(ctx, saida, dsResumo);

  /* ---- FASE 5: gravar ---------------------------------------------- */
  const { files } = saida;
  const { failures } = ctx;
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
    paginas: ctx.pages.length,
    recursos: ctx.resources.size,
    arquivos: written,
    falhas: failures,
    segundos: secs,
    totalBytes: ctx.fetcher.stats.bytes
  };
}
