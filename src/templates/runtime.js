/*!
 * runtime.js — camada de compatibilidade offline
 * Gerado por "Extrator de Sites".
 *
 * Este arquivo e o primeiro script a rodar na pagina. Ele reescreve, em tempo
 * de execucao, qualquer URL que ainda aponte para o servidor original para o
 * arquivo equivalente baixado aqui do lado.
 *
 * Por que isso e necessario: reescrever JS minificado com regex quebra sites.
 * Um bundle 3D monta caminhos por concatenacao ("/tex/" + nome + ".jpg"),
 * dentro de Workers, de import() e de loaders do Three.js. Nenhuma analise
 * estatica pega tudo. Interceptar a rede pega.
 *
 * Nao ha nenhuma dependencia externa e nada roda depois que a pagina carrega
 * alem dos hooks — o custo em runtime e uma consulta a um objeto por requisicao.
 */
(function () {
  'use strict';

  var CFG = /*__XTR_CONFIG__*/{ map: {}, paths: {}, origins: [], blockServiceWorker: true, silenceBeacons: true, verbose: false };

  /* ---------------------------------------------------------------- *
   * Base: descobrimos onde o site foi colocado a partir do proprio
   * <script src=".../__offline/runtime.js">. Assim funciona na raiz do
   * servidor, numa subpasta, ou aberto direto em file://.
   * ---------------------------------------------------------------- */
  var self_ = document.currentScript;
  var selfSrc = self_ ? self_.src : location.href;
  var ROOT;
  try { ROOT = new URL('../', selfSrc).href; } catch (e) { ROOT = location.href; }

  var IS_FILE = location.protocol === 'file:';
  var log = CFG.verbose
    ? function () { try { console.debug.apply(console, ['[offline]'].concat([].slice.call(arguments))); } catch (e) {} }
    : function () {};

  var stats = { hits: 0, misses: 0 };

  /* ---------------------------------------------------------------- *
   * Resolucao                                                          *
   * ---------------------------------------------------------------- */
  var SKIP_SCHEME = /^(data|blob|javascript|about|mailto|tel|sms|chrome-extension|moz-extension|#):/i;

  function toLocal(input) {
    if (input === null || input === undefined) return null;
    var s = String(input);
    if (!s || s.charAt(0) === '#') return null;
    if (SKIP_SCHEME.test(s)) return null;

    var url;
    try { url = new URL(s, document.baseURI); } catch (e) { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'file:') return null;

    var href = url.href;
    var hash = url.hash || '';
    var noHash = href.slice(0, href.length - hash.length);

    var p = CFG.map[noHash];
    if (!p && url.search) p = CFG.map[url.origin + url.pathname];
    if (!p) {
      // Caminho absoluto montado em runtime: "/models/a.glb" resolvido contra
      // a base local vira "http://localhost:8080/models/a.glb". Casamos pelo
      // pathname contra o mapa da origem original.
      //
      // Consultar o mapa ANTES de descartar o que ja parece local nao e
      // preciosismo: quando o nome do arquivo mudou na captura — dois
      // "app.js?v=" viraram "app~a1b2.js" e "app~c3d4.js" — a URL local
      // ingenua aponta para um arquivo que nao existe.
      var known = url.origin === location.origin || indexOf(CFG.origins, url.origin) >= 0;
      if (known) {
        p = CFG.paths[url.pathname + url.search] || CFG.paths[url.pathname];
      }
    }

    if (!p) {
      if (href.indexOf(ROOT) !== 0) { stats.misses++; log('sem mapa:', noHash); }
      return null;
    }

    var out = ROOT + p + hash;
    if (out === href) return null;   // ja estava correto
    stats.hits++;
    return out;
  }

  function indexOf(arr, v) {
    for (var i = 0; i < (arr || []).length; i++) if (arr[i] === v) return i;
    return -1;
  }

  function mapSrcset(value) {
    if (!value) return value;
    var parts = String(value).split(',');
    var changed = false;
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i].trim();
      if (!t) continue;
      var sp = t.split(/\s+/);
      var l = toLocal(sp[0]);
      if (l) { sp[0] = l; parts[i] = sp.join(' '); changed = true; }
    }
    return changed ? parts.join(', ') : value;
  }

  function mapCssText(text) {
    if (!text || String(text).indexOf('url(') < 0) return text;
    return String(text).replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, function (full, q, raw) {
      var l = toLocal(raw.trim());
      return l ? 'url(' + q + l + q + ')' : full;
    });
  }

  /* ---------------------------------------------------------------- *
   * 1. fetch                                                           *
   * ---------------------------------------------------------------- */
  var API = (typeof window.__XTR_API__ === 'object' && window.__XTR_API__) || null;

  function apiHit(method, url) {
    if (!API) return null;
    try {
      var abs = new URL(String(url), document.baseURI).href.split('#')[0];
      // A chave foi gravada com a URL original; tentamos os dois lados.
      var keys = [(method || 'GET').toUpperCase() + '|' + abs];
      for (var o = 0; o < (CFG.origins || []).length; o++) {
        var u = new URL(abs);
        keys.push((method || 'GET').toUpperCase() + '|' + CFG.origins[o] + u.pathname + u.search);
      }
      for (var i = 0; i < keys.length; i++) if (API[keys[i]]) return API[keys[i]];
    } catch (e) {}
    return null;
  }

  function b64ToBlob(b64, ct) {
    var bin = atob(b64);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: ct || 'application/octet-stream' });
  }

  var _fetch = window.fetch;
  if (typeof _fetch === 'function') {
    window.fetch = function (input, init) {
      try {
        var method = (init && init.method) || (input && input.method) || 'GET';
        var href = (typeof input === 'string' || input instanceof URL)
          ? String(input)
          : (input && input.url) || '';

        var cached = apiHit(method, href);
        if (cached) {
          log('cache de API:', href);
          return Promise.resolve(new Response(b64ToBlob(cached.b64, cached.ct), {
            status: 200, statusText: 'OK', headers: { 'Content-Type': cached.ct || 'application/octet-stream' }
          }));
        }

        var local = toLocal(href);
        if (local) {
          if (typeof input === 'string' || input instanceof URL) {
            input = local;
          } else {
            try { input = new Request(local, input); } catch (e) { input = local; }
          }
        }
      } catch (e) {}
      return _fetch.call(this, input, init);
    };
    try { window.fetch.toString = function () { return _fetch.toString(); }; } catch (e) {}
  }

  /* ---------------------------------------------------------------- *
   * 2. XMLHttpRequest                                                  *
   * ---------------------------------------------------------------- */
  try {
    var XO = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      try {
        var l = toLocal(url);
        if (l) {
          var args = [].slice.call(arguments);
          args[1] = l;
          return XO.apply(this, args);
        }
      } catch (e) {}
      return XO.apply(this, arguments);
    };
  } catch (e) {}

  /* ---------------------------------------------------------------- *
   * 3. Propriedades de elemento (src, href, srcset...)                 *
   * ---------------------------------------------------------------- */
  function patchProp(proto, prop, transform) {
    try {
      if (!proto) return;
      var d = Object.getOwnPropertyDescriptor(proto, prop);
      if (!d || !d.set || !d.configurable) return;
      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: d.enumerable,
        get: function () { return d.get.call(this); },
        set: function (v) {
          var next = v;
          try { var l = transform(v); if (l) next = l; } catch (e) {}
          d.set.call(this, next);
        }
      });
    } catch (e) {}
  }

  var W = window;
  [
    [W.HTMLImageElement, 'src'], [W.HTMLImageElement, 'srcset'],
    [W.HTMLScriptElement, 'src'],
    [W.HTMLLinkElement, 'href'],
    [W.HTMLMediaElement, 'src'],
    [W.HTMLSourceElement, 'src'], [W.HTMLSourceElement, 'srcset'],
    [W.HTMLTrackElement, 'src'],
    [W.HTMLIFrameElement, 'src'],
    [W.HTMLEmbedElement, 'src'],
    [W.HTMLObjectElement, 'data'],
    [W.HTMLInputElement, 'src']
  ].forEach(function (pair) {
    var proto = pair[0] && pair[0].prototype;
    var prop = pair[1];
    patchProp(proto, prop, prop === 'srcset' ? mapSrcset : toLocal);
  });

  /* ---------------------------------------------------------------- *
   * 4. setAttribute — cobre quem nao usa a propriedade                 *
   * ---------------------------------------------------------------- */
  var URL_ATTR = {
    src: 1, href: 1, poster: 1, data: 1, background: 1,
    'xlink:href': 1, 'data-src': 1, 'data-href': 1, 'data-poster': 1,
    'data-bg': 1, 'data-background': 1, 'data-image': 1, 'data-lazy': 1,
    'data-lazy-src': 1, 'data-original': 1
  };
  var SRCSET_ATTR = { srcset: 1, imagesrcset: 1, 'data-srcset': 1, 'data-lazy-srcset': 1 };

  try {
    var SA = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      try {
        var n = String(name).toLowerCase();
        if (IS_FILE && n === 'crossorigin') return;   // quebra carregamento local
        if (n === 'integrity') return;                 // SRI nao bate mais
        if (URL_ATTR[n]) { var l = toLocal(value); if (l) value = l; }
        else if (SRCSET_ATTR[n]) { value = mapSrcset(value); }
        else if (n === 'style') { value = mapCssText(value); }
      } catch (e) {}
      return SA.call(this, name, value);
    };

    var SANS = Element.prototype.setAttributeNS;
    Element.prototype.setAttributeNS = function (ns, name, value) {
      try {
        var n = String(name).toLowerCase();
        if (URL_ATTR[n] || n === 'href') { var l = toLocal(value); if (l) value = l; }
      } catch (e) {}
      return SANS.call(this, ns, name, value);
    };
  } catch (e) {}

  /* ---------------------------------------------------------------- *
   * 5. CSS via API (style.setProperty / cssText)                       *
   * ---------------------------------------------------------------- */
  try {
    var SP = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (prop, value, prio) {
      try { if (value && String(value).indexOf('url(') >= 0) value = mapCssText(value); } catch (e) {}
      return SP.call(this, prop, value, prio);
    };
    patchProp(CSSStyleDeclaration.prototype, 'cssText', mapCssText);
  } catch (e) {}

  try {
    var IR = CSSStyleSheet.prototype.insertRule;
    CSSStyleSheet.prototype.insertRule = function (rule, index) {
      try { rule = mapCssText(rule); } catch (e) {}
      return IR.call(this, rule, index);
    };
  } catch (e) {}

  /* ---------------------------------------------------------------- *
   * 6. Workers                                                         *
   * ---------------------------------------------------------------- */
  try {
    var _W = window.Worker;
    if (_W) {
      window.Worker = function (url, opts) {
        var l = null;
        try { l = toLocal(url); } catch (e) {}
        return new _W(l || url, opts);
      };
      window.Worker.prototype = _W.prototype;
    }
  } catch (e) {}

  /* ---------------------------------------------------------------- *
   * 7. Service Worker — desligado                                      *
   * Um SW do site tentaria cachear as URLs originais e serviria 404    *
   * para tudo. Devolvemos um registro falso para o codigo do site      *
   * seguir o fluxo de sucesso sem quebrar.                             *
   * ---------------------------------------------------------------- */
  if (CFG.blockServiceWorker !== false && navigator.serviceWorker) {
    try {
      var fakeReg = {
        scope: ROOT, installing: null, waiting: null, active: null, updateViaCache: 'none',
        update: function () { return Promise.resolve(); },
        unregister: function () { return Promise.resolve(true); },
        addEventListener: function () {}, removeEventListener: function () {},
        showNotification: function () { return Promise.resolve(); },
        getNotifications: function () { return Promise.resolve([]); }
      };
      navigator.serviceWorker.register = function () { return Promise.resolve(fakeReg); };
      Object.defineProperty(navigator.serviceWorker, 'ready', {
        configurable: true, get: function () { return new Promise(function () {}); }
      });
    } catch (e) {}
  }

  /* ---------------------------------------------------------------- *
   * 8. Telemetria: silencia beacons para nao poluir o console          *
   * ---------------------------------------------------------------- */
  if (CFG.silenceBeacons !== false) {
    try { navigator.sendBeacon = function () { return true; }; } catch (e) {}
  }

  /* ---------------------------------------------------------------- *
   * 9. Rede de seguranca: MutationObserver                             *
   * Pega no elemento o que escapou dos hooks (innerHTML, frameworks    *
   * que escrevem atributos por caminhos exoticos, SVG <use>).          *
   * ---------------------------------------------------------------- */
  var fixing = false;

  function fixElement(el) {
    if (!el || el.nodeType !== 1) return;
    try {
      if (IS_FILE && el.hasAttribute('crossorigin')) el.removeAttribute('crossorigin');

      for (var a in URL_ATTR) {
        if (!el.hasAttribute || !el.hasAttribute(a)) continue;
        var v = el.getAttribute(a);
        var l = toLocal(v);
        if (l && l !== v) el.setAttribute(a, l);
      }
      for (var s in SRCSET_ATTR) {
        if (!el.hasAttribute || !el.hasAttribute(s)) continue;
        var sv = el.getAttribute(s);
        var sl = mapSrcset(sv);
        if (sl !== sv) el.setAttribute(s, sl);
      }
      if (el.hasAttribute && el.hasAttribute('style')) {
        var st = el.getAttribute('style');
        if (st && st.indexOf('url(') >= 0) {
          var nst = mapCssText(st);
          if (nst !== st) el.setAttribute('style', nst);
        }
      }
      // SVG <use xlink:href> / <use href>
      if (el.namespaceURI === 'http://www.w3.org/2000/svg') {
        var xh = el.getAttributeNS && el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (xh) { var xl = toLocal(xh); if (xl) el.setAttributeNS('http://www.w3.org/1999/xlink', 'href', xl); }
      }
    } catch (e) {}
  }

  function sweep(root) {
    if (!root) return;
    fixElement(root);
    if (root.querySelectorAll) {
      var kids = root.querySelectorAll('[src],[href],[srcset],[poster],[data],[style*="url("],[data-src],[data-srcset]');
      for (var i = 0; i < kids.length; i++) fixElement(kids[i]);
    }
  }

  try {
    var mo = new MutationObserver(function (records) {
      if (fixing) return;
      fixing = true;
      try {
        for (var i = 0; i < records.length; i++) {
          var r = records[i];
          if (r.type === 'attributes') fixElement(r.target);
          else for (var j = 0; j < r.addedNodes.length; j++) sweep(r.addedNodes[j]);
        }
      } finally { fixing = false; }
    });
    mo.observe(document.documentElement || document, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['src', 'href', 'srcset', 'poster', 'data', 'style', 'crossorigin',
        'data-src', 'data-srcset', 'data-bg', 'data-lazy-src']
    });
  } catch (e) {}

  document.addEventListener('DOMContentLoaded', function () { try { sweep(document.documentElement); } catch (e) {} });
  window.addEventListener('load', function () {
    try { sweep(document.documentElement); } catch (e) {}
    if (IS_FILE) {
      console.warn(
        '%c[Extrator de Sites]%c Esta pagina esta aberta em file://.\n' +
        'Modulos ES, fetch(), texturas WebGL e fontes sofrem restricoes nesse modo.\n' +
        'Execute o arquivo "ABRIR SITE" que veio na pasta. Ele sobe o servidor ' +
        'local e abre o site funcionando 100%.',
        'color:#ff9f43;font-weight:bold', 'color:inherit'
      );
    }
    log('mapeamentos aplicados:', stats.hits, '| sem correspondencia:', stats.misses);
  });

  // Exposto para diagnostico manual no console.
  window.__XTR_OFFLINE__ = {
    root: ROOT,
    stats: stats,
    resolve: toLocal,
    entries: function () { return Object.keys(CFG.map).length; }
  };
})();
