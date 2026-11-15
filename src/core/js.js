/*
 * js.js — tratamento de JavaScript.
 *
 * Filosofia: reescrever o MINIMO possivel no JS. Mexer em codigo minificado com
 * regex e como fazer cirurgia com luva de boxe. Entao dividimos em dois casos:
 *
 *  1. O que o runtime NAO consegue interceptar depois -> reescrevemos aqui.
 *     Sao os specifiers de ES module (import/export from, import(), importScripts,
 *     new URL(x, import.meta.url)): quem resolve isso e o carregador de modulos,
 *     nao a rede, entao nenhum hook de fetch alcanca.
 *     Eles resolvem contra a URL DO PROPRIO SCRIPT — por isso o caminho relativo
 *     e calculado a partir do arquivo JS, nao da pagina.
 *
 *  2. Todo o resto (fetch, XHR, texturas, .glb montado por concatenacao...)
 *     fica intacto e e remapeado em tempo de execucao por __offline/runtime.js.
 *     Isso resolve inclusive caminhos que nao existem como string no arquivo.
 */

import { safeUrl, relativeSpecifier, stripHash, extOf } from './util.js';

/* --- 1. Specifiers de modulo ------------------------------------------- */

const PATTERNS = [
  // import x from '...'   |   export * from '...'
  { re: /(\b(?:import|export)\b[\s\S]{0,400}?\bfrom\s*)(["'])([^"'\n]+)\2/g, g: 3, q: 2 },
  // import '...'  (side-effect)
  { re: /(\bimport\s*)(["'])([^"'\n]+)\2/g, g: 3, q: 2 },
  // import('...')  dinamico
  { re: /(\bimport\s*\(\s*)(["'])([^"'\n]+)\2(\s*\))/g, g: 3, q: 2 },
  // new URL('...', import.meta.url)
  { re: /(new\s+URL\s*\(\s*)(["'])([^"'\n]+)\2(\s*,\s*import\.meta\.url)/g, g: 3, q: 2 },
  // importScripts('a','b',...)  — tratado a parte por aceitar varios argumentos
];

/**
 * @param {string} code
 * @param {string} scriptUrl   URL original do script (base de resolucao)
 * @param {string} scriptLocal caminho local do script
 * @param {(u:string)=>string|null} lookup
 * @returns {{code:string, changed:number}}
 */
export function rewriteModuleSpecifiers(code, scriptUrl, scriptLocal, lookup) {
  if (!code) return { code, changed: 0 };
  let changed = 0;

  const mapSpec = (spec) => {
    // Bare specifier ("three", "gsap") depende de import map — nao tocamos.
    if (!/^[./]|^https?:|^\/\//.test(spec)) return null;
    const u = safeUrl(spec, scriptUrl);
    if (!u) return null;
    const local = lookup(stripHash(u.href));
    if (!local) return null;
    return relativeSpecifier(scriptLocal, local);
  };

  let out = code;
  for (const { re, g, q } of PATTERNS) {
    out = out.replace(re, (full, ...args) => {
      const spec = args[g - 1];
      const quote = args[q - 1];
      const rel = mapSpec(spec);
      if (!rel) return full;
      changed++;
      return full.replace(quote + spec + quote, quote + rel + quote);
    });
  }

  // importScripts pode receber N argumentos
  out = out.replace(/\bimportScripts\s*\(([^)]*)\)/g, (full, argsRaw) => {
    let touched = false;
    const next = argsRaw.replace(/(["'])([^"'\n]+)\1/g, (a, qq, spec) => {
      const rel = mapSpec(spec);
      if (!rel) return a;
      touched = true;
      return qq + rel + qq;
    });
    if (!touched) return full;
    changed++;
    return `importScripts(${next})`;
  });

  return { code: out, changed };
}

/* --- 2. Varredura profunda: assets citados mas nunca carregados --------- */

const ASSET_EXT = [
  'js', 'mjs',
  'glb', 'gltf', 'bin', 'drc', 'obj', 'mtl', 'fbx', 'ply', 'stl', 'usdz', 'splat', 'ksplat',
  'hdr', 'exr', 'ktx', 'ktx2', 'basis', 'dds', 'tga',
  'jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'svg', 'ico',
  'mp4', 'webm', 'mov', 'ogv', 'mp3', 'wav', 'ogg', 'm4a', 'aac',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'json', 'wasm', 'css', 'txt', 'csv', 'vtt', 'srt',
  'glsl', 'vert', 'frag', 'wgsl'
];

const ASSET_RE = new RegExp(
  '(["\'`])((?:https?:)?(?:\\/\\/|\\/|\\.{0,2}\\/)?[\\w\\-./@%+~$()\\[\\]]{1,300}?\\.(?:' +
  ASSET_EXT.join('|') + '))(\\?[^"\'`\\s]{0,200})?\\1',
  'gi'
);

const CODE_RE = /\.m?js$/i;

/* Diretorio do script, com origem: e onde os chunks do bundle moram. */
function dirDe(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/[^/]*$/, '');
  } catch (e) { return ''; }
}

/*
 * A base que o empacotador usa para os proprios chunks — o publicPath.
 *
 * O Turbopack escreve "static/chunks/1233qowaitufq.js" dentro de um script que
 * mora em /_next/static/chunks/: quem resolve isso e o carregador dele, contra
 * /_next/, e nenhuma das duas bases obvias acerta — a pagina da
 * /static/chunks/... e o script da /_next/static/chunks/static/chunks/..., os
 * dois 404 que apareciam no relatorio de toda captura de site Next.
 *
 * O proprio caminho do script diz qual e a base: se ele termina com o mesmo
 * diretorio que o candidato cita, o que vem antes disso e o publicPath. Serve
 * igual para o Vite ("assets/x.js" dentro de /assets/index.js -> base "/").
 */
function baseDoEmpacotador(scriptUrl, raw) {
  try {
    const dir = raw.replace(/[^/]*$/, '');           // "static/chunks/"
    if (!dir) return null;
    const u = new URL(scriptUrl);
    const at = u.pathname.lastIndexOf('/' + dir);    // ".../_next" + "/static/chunks/"
    if (at < 0) return null;
    return u.origin + u.pathname.slice(0, at + 1);   // "https://site/_next/"
  } catch (e) { return null; }
}

/**
 * Encontra strings que parecem caminho de asset dentro de um bundle.
 * Serve para pegar o que nunca foi carregado na sessao (variantes de textura,
 * modelos de outra rota, LODs...). Resolve contra o script E contra a pagina,
 * porque o codigo pode usar qualquer uma das duas bases.
 *
 * Chunk de codigo entra aqui por um motivo especifico: num SPA com code
 * splitting (Vite, Next, webpack) a tabela de dependencias vive dentro do
 * bundle — "assets/pricing-cOot9ERn.js" e centenas de irmaos — e nada disso e
 * pedido enquanto a rota nao abre. Sem varrer o .js, o site salvo sobe, pede o
 * primeiro chunk da rota e morre em 404. Medido num SPA real: 285 chunks
 * citados, 0 baixados, e a pagina parava em "Something went wrong!".
 *
 * Para nao virar um aspirador de scripts de terceiros, chunk so e aceito se
 * mora no mesmo diretorio do bundle (/assets/, /_next/static/chunks/...) — que
 * e onde todo empacotador os coloca.
 */
export function discoverAssetsInJs(code, scriptUrl, pageUrl, limit = 1500) {
  const out = new Set();
  if (!code) return out;
  let m, n = 0;
  ASSET_RE.lastIndex = 0;
  while ((m = ASSET_RE.exec(code)) !== null && n < limit) {
    let raw = m[2] + (m[3] || '');
    raw = raw.replace(/\\\//g, '/');
    if (raw.length < 4) continue;
    if (/^\.{1,2}$/.test(raw)) continue;
    // Descarta ruido comum de minificacao (nomes de propriedade, mime types).
    if (/[<>{}\s]/.test(raw)) continue;
    if (!extOf(raw)) continue;

    const ehCodigo = CODE_RE.test(raw.split('?')[0]);
    /*
     * Resolver nas duas bases de uma vez e um chute que acerta uma e erra a
     * outra. Quando da para saber a base certa, usamos so ela: './' e '../'
     * resolvem contra o script, como manda o carregador de modulos, e um
     * caminho que repete um diretorio do script resolve contra o publicPath.
     */
    const doEmpacotador = /^[./]/.test(raw) ? null : baseDoEmpacotador(scriptUrl, raw);
    const bases = /^\.{1,2}\//.test(raw) ? [scriptUrl]
      : doEmpacotador ? [doEmpacotador]
      : ehCodigo ? [pageUrl]
      : [scriptUrl, pageUrl];

    for (const base of bases) {
      const u = safeUrl(raw, base);
      if (!u) continue;
      if (ehCodigo) {
        // Chunk mora junto do bundle; o resto e script de terceiro.
        const dir = dirDe(scriptUrl);
        const ok = (dir && u.href.startsWith(dir)) ||
                   (doEmpacotador && u.href.startsWith(doEmpacotador));
        if (!ok) continue;
      }
      out.add(stripHash(u.href));
      n++;
    }
  }
  return out;
}

/* --- 3. Reescrita de URLs absolutas em strings (HTML inline / JSON) ----- */

const QUOTED_URL_RE = /(["'`])((?:https?:)?\\?\/\\?\/[^"'`\s\\]{4,400}|\\?\/[^"'`\s]{2,400})\1/g;

/**
 * Troca URLs absolutas capturadas por caminhos locais dentro de strings.
 * Usado em <script> inline e em blobs JSON (__NEXT_DATA__, __NUXT__...),
 * onde a base de resolucao e sempre o documento.
 */
export function rewriteQuotedUrls(text, baseUrl, fromLocalFile, lookup) {
  if (!text) return text;
  return text.replace(QUOTED_URL_RE, (full, q, raw) => {
    // JSON escapa barras: "https:\/\/site.com\/a.png"
    const escaped = raw.includes('\\/');
    const clean = escaped ? raw.replace(/\\\//g, '/') : raw;
    const u = safeUrl(clean, baseUrl);
    if (!u) return full;
    const local = lookup(stripHash(u.href));
    if (!local) return full;
    let rel = relativeFrom(fromLocalFile, local);
    if (escaped) rel = rel.replace(/\//g, '\\/');
    return q + rel + q;
  });
}

function relativeFrom(fromFile, toFile) {
  // import local para evitar dependencia circular de nomes
  const fromParts = fromFile.split('/').slice(0, -1);
  const toParts = toFile.split('/');
  const name = toParts.pop();
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
  const up = new Array(fromParts.length - i).fill('..');
  return [...up, ...toParts.slice(i), name].join('/') || name;
}
