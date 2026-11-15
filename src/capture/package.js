/*
 * package.js — fase 4: o que a captura acrescenta a copia para ela abrir
 * offline: a camada __offline/, o servidor local, o atalho e o leia-me.
 */

import { encodeText } from '../shared/util.js';
import { OFFLINE_DIR } from './urlmap.js';
import { buildReadme } from './readme.js';

/** A camada que redireciona, dentro da copia, cada URL para o arquivo local. */
export async function gerarCamadaOffline(ctx, { files, hasApiCache }) {
  const { startUrl, opts, ui, map, apiBodies } = ctx;

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
}

/** Relatorio, servidor local, atalho do sistema e leia-me. */
export async function gerarApoio(ctx, { files }, dsResumo) {
  const { startUrl, opts, pages, resources, failures, fetcher } = ctx;

  const report = {
    origem: startUrl,
    geradoEm: new Date().toISOString(),
    paginas: pages.map((p) => ({ url: p.url, arquivo: p.localPath, titulo: p.title })),
    recursos: resources.size,
    bytes: fetcher.stats.bytes,
    falhas: failures,
    opcoes: opts
  };
  if (dsResumo) report.designSystem = dsResumo;
  files.push({ path: `${OFFLINE_DIR}/relatorio.json`, data: encodeText(JSON.stringify(report, null, 2)) });

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
