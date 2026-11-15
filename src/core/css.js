/*
 * css.js — descoberta e reescrita de URLs em folhas de estilo.
 *
 * Cobre url(), @import, image-set()/-webkit-image-set() e src: de @font-face.
 * Caminhos relativos dentro do CSS ja funcionam localmente (a arvore e a mesma),
 * mas reescrevemos tudo mesmo assim para normalizar query strings e CDNs.
 */

import { safeUrl, relativePath, stripHash } from './util.js';

const URL_RE = /url\(\s*(?:(["'])((?:\\.|(?!\1)[^\\])*)\1|([^)"'\s][^)]*?))\s*\)/gi;
const IMPORT_RE = /@import\s+(?:url\(\s*(["']?)([^)"']+)\1\s*\)|(["'])([^"']+)\3)/gi;

/** Extrai todas as URLs absolutas referenciadas por um CSS. */
export function discoverCssUrls(cssText, cssUrl) {
  const out = new Set();
  if (!cssText) return out;

  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(cssText)) !== null) {
    const raw = (m[2] !== undefined ? m[2] : m[3] || '').trim();
    const u = safeUrl(unescapeCss(raw), cssUrl);
    if (u) out.add(stripHash(u.href));
  }

  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(cssText)) !== null) {
    const raw = (m[2] || m[4] || '').trim();
    const u = safeUrl(raw, cssUrl);
    if (u) out.add(stripHash(u.href));
  }

  return out;
}

function unescapeCss(s) {
  return String(s).replace(/\\(.)/g, '$1');
}

function quoteCssUrl(path) {
  // Aspas simples evitam problemas com parenteses e espacos em nomes.
  return `'${path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Reescreve um CSS para apontar aos arquivos locais.
 * @param {string} cssText
 * @param {string} cssUrl      URL original da folha (base de resolucao)
 * @param {string} cssLocal    caminho local da folha, relativo a raiz da saida
 * @param {(absUrl:string)=>string|null} lookup  URL absoluta -> caminho local
 * @param {boolean} absoluto  emitir "/caminho" em vez de relativo ao arquivo.
 *   Usado no CSS embutido no HTML, para casar com o resto do documento.
 */
export function rewriteCss(cssText, cssUrl, cssLocal, lookup, absoluto = false) {
  if (!cssText) return cssText;

  const toLocal = (raw) => {
    const u = safeUrl(unescapeCss(raw), cssUrl);
    if (!u) return null;
    const local = lookup(stripHash(u.href));
    if (!local) return null;
    const frag = u.hash || '';
    return (absoluto ? '/' + local : relativePath(cssLocal, local)) + frag;
  };

  let out = cssText.replace(URL_RE, (full, q, quoted, bare) => {
    const raw = (quoted !== undefined ? quoted : bare || '').trim();
    if (!raw || raw.startsWith('#') || /^data:/i.test(raw)) return full;
    const rel = toLocal(raw);
    return rel ? `url(${quoteCssUrl(rel)})` : full;
  });

  out = out.replace(IMPORT_RE, (full, q1, u1, q2, u2) => {
    const raw = (u1 || u2 || '').trim();
    if (!raw) return full;
    const rel = toLocal(raw);
    return rel ? `@import url(${quoteCssUrl(rel)})` : full;
  });

  return out;
}
