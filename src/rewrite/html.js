/*
 * html.js — descoberta e reescrita do documento.
 *
 * Usamos DOMParser em vez de regex: atributos de URL aparecem em dezenas de
 * formas e um parser real acerta srcset, entidades e aninhamento sem drama.
 * A pagina do Estudio pode parsear com seguranca — DOMParser nao executa script
 * nem dispara requisicao.
 */

import { safeUrl, relativePath, stripHash } from '../shared/util.js';
import { discoverCssUrls, rewriteCss } from './css.js';
import { rewriteQuotedUrls } from './js.js';
import { OFFLINE_DIR } from '../capture/urlmap.js';

const URL_ATTRS = [
  ['src', '*'], ['href', '*'], ['poster', 'video'], ['data', 'object'],
  ['background', '*'], ['action', 'form'], ['formaction', '*'],
  ['data-src', '*'], ['data-href', '*'], ['data-poster', '*'],
  ['data-bg', '*'], ['data-background', '*'], ['data-background-image', '*'],
  ['data-image', '*'], ['data-lazy', '*'], ['data-lazy-src', '*'],
  ['data-original', '*'], ['data-thumb', '*'], ['data-large', '*'],
  ['data-full', '*'], ['data-video', '*'], ['data-model', '*'],
  ['data-gltf', '*'], ['data-texture', '*'], ['data-map', '*'], ['data-normal', '*']
];

const SRCSET_ATTRS = ['srcset', 'imagesrcset', 'data-srcset', 'data-lazy-srcset'];

/* --------------------------- srcset ----------------------------------- */

function parseSrcset(value) {
  // Formato: "url [descritor], url [descritor], ..."
  const out = [];
  let i = 0, s = String(value);
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
    if (i >= s.length) break;
    const start = i;
    while (i < s.length && !/\s/.test(s[i])) {
      if (s[i] === ',' && !s.slice(start, i).startsWith('data:')) break;
      i++;
    }
    const url = s.slice(start, i);
    // descritor ate a virgula
    while (i < s.length && s[i] !== ',') i++;
    const desc = s.slice(start + url.length, i).trim();
    if (url) out.push({ url, desc });
    i++;
  }
  return out;
}

function buildSrcset(items) {
  return items.map(({ url, desc }) => (desc ? `${url} ${desc}` : url)).join(', ');
}

/* --------------------------- descoberta -------------------------------- */

/** URLs referenciadas por um documento HTML (sem executar nada). */
export function discoverHtmlUrls(htmlText, docUrl) {
  const found = new Set();
  const links = new Set();
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const base = baseOf(doc, docUrl);

  for (const el of doc.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();

    for (const [attr] of URL_ATTRS) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      const u = safeUrl(v, base);
      if (!u) continue;
      if (tag === 'a' && attr === 'href') links.add(stripHash(u.href));
      else if (tag === 'form') { /* endpoints nao sao assets */ }
      else found.add(stripHash(u.href));
    }

    for (const attr of SRCSET_ATTRS) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      for (const { url } of parseSrcset(v)) {
        const u = safeUrl(url, base);
        if (u) found.add(stripHash(u.href));
      }
    }

    const xl = el.getAttributeNS && el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (xl) { const u = safeUrl(xl, base); if (u) found.add(stripHash(u.href)); }

    const style = el.getAttribute('style');
    if (style && style.includes('url(')) for (const u of discoverCssUrls(style, base)) found.add(u);

    if (tag === 'style') for (const u of discoverCssUrls(el.textContent, base)) found.add(u);

    if (tag === 'meta' && isMediaMeta(el)) {
      const u = safeUrl(el.getAttribute('content'), base);
      if (u) found.add(stripHash(u.href));
    }

    if (tag === 'script') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'importmap') {
        try {
          const map = JSON.parse(el.textContent);
          for (const section of [map.imports, ...Object.values(map.scopes || {})]) {
            for (const target of Object.values(section || {})) {
              const u = safeUrl(target, base);
              if (u) found.add(stripHash(u.href));
            }
          }
        } catch { /* import map invalido: ignora */ }
      }
    }
  }

  return { found: [...found], links: [...links] };
}

/*
 * Nem toda meta com "image" no nome carrega uma URL. "og:image:alt" traz texto
 * alternativo, "og:image:width" traz um numero — tratar isso como caminho gera
 * pedidos absurdos ao servidor (foi assim que apareceu um GET para o texto
 * alternativo da imagem, como se fosse um arquivo).
 */
function isMediaMeta(el) {
  const key = (el.getAttribute('property') || el.getAttribute('name') || '').toLowerCase();
  return /(^|:)(image|video|audio|url)(:(secure_)?url)?$/.test(key);
}

function baseOf(doc, docUrl) {
  const b = doc.querySelector('base[href]');
  if (b) {
    try { return new URL(b.getAttribute('href'), docUrl).href; } catch { /* usa docUrl */ }
  }
  return docUrl;
}

/* --------------------------- reescrita --------------------------------- */

/**
 * @param {object} o
 * @param {string} o.html         HTML original
 * @param {string} o.docUrl       URL original do documento
 * @param {string} o.docLocal     caminho local do documento
 * @param {Function} o.lookup     absUrl -> caminho local | null
 * @param {object} o.opts
 */
export function rewriteHtml({ html, docUrl, docLocal, lookup, opts = {} }) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = baseOf(doc, docUrl);

  /*
   * Caminho absoluto a partir da raiz, e nao relativo ao documento.
   *
   * Parece detalhe, e nao e. Bundlers modernos registram cada chunk pelo
   * caminho com que ele foi pedido: o payload do Next.js/Turbopack embutido na
   * pagina referencia "/_next/static/chunks/x.js", e o <script src> precisa
   * casar exatamente com isso. Reescrever para "_next/static/chunks/x.js"
   * quebra o casamento — e o pior e que quebra em silencio: nenhum erro no
   * console, nenhuma requisicao falhando, o React simplesmente nunca hidrata e
   * a pagina fica presa no preloader.
   *
   * Como a arvore local espelha a do site, o caminho absoluto e identico ao
   * original para recursos de mesma origem: nada muda, e tudo continua batendo.
   * Em troca, o site precisa ser servido a partir da raiz — que e exatamente o
   * que o servidor incluido faz.
   */
  /*
   * A biblioteca viva e a excecao: ela nao e uma pagina do site, e o usuario
   * abre o arquivo direto — inclusive com duplo clique, em file://, onde
   * "/images/logo.svg" aponta para a raiz do disco e nada carrega. Como ela
   * nao tem manifesto de bundler para casar, o caminho relativo ao proprio
   * documento serve nos dois mundos.
   */
  const relativoAoDoc = opts.caminhos === 'relativo';
  const rel = (local) => (relativoAoDoc ? relativePath(docLocal, local) : '/' + local);

  const toLocal = (raw) => {
    const u = safeUrl(raw, base);
    if (!u) return null;
    const local = lookup(stripHash(u.href));
    if (!local) return null;
    return rel(local) + (u.hash || '');
  };

  // <base href> deixaria todos os caminhos relativos apontando para o servidor.
  for (const b of doc.querySelectorAll('base[href]')) b.removeAttribute('href');

  // CSP em <meta> bloquearia o runtime injetado.
  for (const m of doc.querySelectorAll('meta[http-equiv]')) {
    const eq = (m.getAttribute('http-equiv') || '').toLowerCase();
    if (eq === 'content-security-policy' || eq === 'content-security-policy-report-only') m.remove();
    if (eq === 'refresh') {
      const c = m.getAttribute('content') || '';
      if (/url=/i.test(c)) m.remove();     // redirecionamento automatico quebra a navegacao local
    }
  }

  for (const el of doc.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();

    for (const [attr] of URL_ATTRS) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      if (tag === 'form' && (attr === 'action' || attr === 'formaction')) continue;
      const next = toLocal(v);
      if (next !== null) el.setAttribute(attr, next);
      else if (attr === 'href' || attr === 'src') {
        // Nao capturado: deixa absoluto para pelo menos funcionar com internet.
        const u = safeUrl(v, base);
        if (u) el.setAttribute(attr, u.href);
      }
    }

    for (const attr of SRCSET_ATTRS) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      const items = parseSrcset(v).map(({ url, desc }) => {
        const next = toLocal(url);
        return { url: next !== null ? next : url, desc };
      });
      el.setAttribute(attr, buildSrcset(items));
    }

    const xl = el.getAttributeNS && el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (xl) {
      const next = toLocal(xl);
      if (next !== null) el.setAttributeNS('http://www.w3.org/1999/xlink', 'href', next);
    }

    const style = el.getAttribute('style');
    if (style && style.includes('url(')) {
      el.setAttribute('style', rewriteCss(style, base, docLocal, (u) => lookup(u), true));
    }

    if (tag === 'style') {
      el.textContent = rewriteCss(el.textContent, base, docLocal, (u) => lookup(u), true);
    }

    if (tag === 'meta' && isMediaMeta(el)) {
      const next = toLocal(el.getAttribute('content'));
      if (next !== null) el.setAttribute('content', next);
    }

    // SRI passa a falhar depois da reescrita; crossorigin quebra em file://
    if (el.hasAttribute('integrity')) el.removeAttribute('integrity');
    if (el.hasAttribute('crossorigin') && opts.stripCrossOrigin !== false) el.removeAttribute('crossorigin');
    if (el.hasAttribute('nonce')) el.removeAttribute('nonce');

    if (tag === 'script') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'importmap') {
        try {
          const map = JSON.parse(el.textContent);
          const fix = (section) => {
            for (const k of Object.keys(section || {})) {
              const next = toLocal(section[k]);
              // Ja e caminho da raiz; prefixar './' produziria './/...'
              if (next !== null) section[k] = /^[./]/.test(next) ? next : './' + next;
            }
          };
          fix(map.imports);
          for (const s of Object.values(map.scopes || {})) fix(s);
          el.textContent = JSON.stringify(map, null, 2);
        } catch { /* deixa como esta */ }
      } else if (!el.getAttribute('src') && el.textContent) {
        const isData = type && !/javascript|module|ecmascript|^$/.test(type);
        // Vale tanto para JS inline quanto para blobs JSON (__NEXT_DATA__ etc.)
        el.textContent = rewriteQuotedUrls(el.textContent, base, docLocal, (u) => lookup(u));
        void isData;
      }
    }
  }

  // Charset: reescrevemos tudo em UTF-8, entao o documento precisa dizer isso.
  // O <meta charset> tem que estar nos primeiros bytes do documento para valer.
  const head = doc.head || doc.documentElement;
  let meta = doc.querySelector('meta[charset]');
  if (!meta) {
    meta = doc.createElement('meta');
    head.insertBefore(meta, head.firstChild);
  }
  meta.setAttribute('charset', 'utf-8');

  // O runtime precisa ser o PRIMEIRO script a rodar: ele instala os hooks de
  // rede antes de qualquer codigo do site pedir um asset. E o api-cache vem
  // antes dele, porque o runtime le window.__XTR_API__ ao inicializar.
  const runtimeRel = rel(`${OFFLINE_DIR}/runtime.js`);
  const anchor = meta.parentNode === head ? meta.nextSibling : head.firstChild;

  if (opts.apiCache) {
    const api = doc.createElement('script');
    api.setAttribute('src', rel(`${OFFLINE_DIR}/api-cache.js`));
    head.insertBefore(api, anchor);
  }
  const rt = doc.createElement('script');
  rt.setAttribute('src', runtimeRel);
  rt.setAttribute('data-xtr', 'runtime');
  head.insertBefore(rt, anchor);

  const doctype = doc.doctype
    ? `<!DOCTYPE ${doc.doctype.name}${doc.doctype.publicId ? ` PUBLIC "${doc.doctype.publicId}"` : ''}${doc.doctype.systemId ? ` "${doc.doctype.systemId}"` : ''}>\n`
    : '<!DOCTYPE html>\n';

  return doctype + doc.documentElement.outerHTML;
}
