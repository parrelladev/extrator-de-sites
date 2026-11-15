/*
 * assemble.js — fase 3: fecha os caminhos locais e reescreve HTML, CSS e JS
 * para apontarem aos arquivos baixados. Devolve a lista de arquivos a gravar.
 */

import { decodeText, encodeText, relativePath } from '../shared/util.js';
import { OFFLINE_DIR } from './urlmap.js';
import { rewriteCss } from '../rewrite/css.js';
import { rewriteHtml } from '../rewrite/html.js';
import { rewriteModuleSpecifiers, rewriteQuotedUrls } from '../rewrite/js.js';

export function reescreverArquivos(ctx) {
  const { opts, ui, map, resources, pages, apiBodies, workerUrls } = ctx;

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

  return { files, lookup, hasApiCache };
}

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
