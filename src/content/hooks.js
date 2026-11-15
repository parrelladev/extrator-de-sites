/*
 * hooks.js — roda no mundo MAIN (mesmo contexto JS da página), em document_start.
 *
 * Objetivo: registrar TODA URL que a pagina realmente carrega em tempo de execucao,
 * inclusive as que nenhum parser estatico acha (texturas de Three.js, .glb/.gltf,
 * .hdr, .wasm do Draco/Basis, sprites de GSAP, JSON de configuracao, fontes...).
 *
 * Regra de ouro: nunca alterar o comportamento da pagina. Todo hook e pass-through
 * e esta dentro de try/catch.
 */
(function () {
  'use strict';
  if (window.__XTR_HOOKS__) return;
  window.__XTR_HOOKS__ = true;

  var MAX_BODY = 2 * 1024 * 1024;      // por resposta
  var MAX_CACHE_TOTAL = 24 * 1024 * 1024; // total de corpos guardados
  var cacheBytes = 0;

  var urls = new Set();
  var workers = new Set();
  var bodies = new Map();  // "GET|url" -> { ct, b64 }

  function record(u, bag) {
    try {
      if (!u) return;
      var s = String(u);
      if (!s || s.charAt(0) === '#') return;
      if (/^(data|blob|javascript|about|chrome-extension|moz-extension):/i.test(s)) return;
      var a = new URL(s, document.baseURI).href;
      if (!/^https?:/i.test(a)) return;
      (bag || urls).add(a.split('#')[0]);
    } catch (e) { /* noop */ }
  }

  /* ---------------------------------------------------------------------
   * 1) Resource Timing — a rede completa, sem precisar interceptar nada.
   *    O buffer padrao e 250 entradas; um site 3D estoura isso facil.
   * ------------------------------------------------------------------- */
  try { performance.setResourceTimingBufferSize(1000000); } catch (e) {}
  try {
    var po = new PerformanceObserver(function (list) {
      var es = list.getEntries();
      for (var i = 0; i < es.length; i++) record(es[i].name);
    });
    po.observe({ type: 'resource', buffered: true });
  } catch (e) {}
  try {
    var pre = performance.getEntriesByType('resource');
    for (var i = 0; i < pre.length; i++) record(pre[i].name);
  } catch (e) {}

  /* ---------------------------------------------------------------------
   * 2) fetch — registra a URL e guarda o corpo de respostas pequenas.
   *    Isso salva APIs (inclusive POST) que nao dao para refazer offline.
   * ------------------------------------------------------------------- */
  function u8ToB64(u8) {
    var out = '', chunk = 0x8000;
    for (var i = 0; i < u8.length; i += chunk) {
      out += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return btoa(out);
  }

  function stash(method, url, ct, buf) {
    try {
      if (!buf || buf.byteLength > MAX_BODY) return;
      if (cacheBytes + buf.byteLength > MAX_CACHE_TOTAL) return;
      var key = (method || 'GET').toUpperCase() + '|' + url.split('#')[0];
      if (bodies.has(key)) return;
      bodies.set(key, { ct: ct || '', b64: u8ToB64(new Uint8Array(buf)) });
      cacheBytes += buf.byteLength;
    } catch (e) {}
  }

  try {
    var _fetch = window.fetch;
    if (typeof _fetch === 'function') {
      window.fetch = function (input, init) {
        var method = 'GET', href = '';
        try {
          if (typeof input === 'string' || input instanceof URL) href = String(input);
          else if (input && input.url) { href = input.url; method = input.method || 'GET'; }
          if (init && init.method) method = init.method;
          record(href);
        } catch (e) {}
        var p = _fetch.apply(this, arguments);
        try {
          return p.then(function (res) {
            try {
              record(res.url);
              var ct = res.headers.get('content-type') || '';
              // so guardamos o que e barato e util offline (config/API)
              if (/json|text|xml|javascript/i.test(ct) && res.status === 200) {
                var abs = new URL(href || res.url, document.baseURI).href;
                res.clone().arrayBuffer().then(function (b) { stash(method, abs, ct, b); }, function () {});
              }
            } catch (e) {}
            return res;
          });
        } catch (e) { return p; }
      };
      window.fetch.toString = function () { return _fetch.toString(); };
    }
  } catch (e) {}

  /* ------------------------------- 3) XHR ---------------------------- */
  try {
    var XO = XMLHttpRequest.prototype.open;
    var XS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) {
      try { this.__xtr = { m: String(m || 'GET'), u: new URL(String(u), document.baseURI).href }; record(u); } catch (e) {}
      return XO.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var self = this;
      try {
        self.addEventListener('load', function () {
          try {
            if (!self.__xtr || self.status !== 200) return;
            var ct = self.getResponseHeader('content-type') || '';
            if (!/json|text|xml|javascript/i.test(ct)) return;
            var r = self.response;
            if (typeof r === 'string') {
              stash(self.__xtr.m, self.__xtr.u, ct, new TextEncoder().encode(r).buffer);
            } else if (r instanceof ArrayBuffer) {
              stash(self.__xtr.m, self.__xtr.u, ct, r);
            }
          } catch (e) {}
        });
      } catch (e) {}
      return XS.apply(this, arguments);
    };
  } catch (e) {}

  /* --------------------- 4) Workers e importScripts ------------------- */
  try {
    var _W = window.Worker;
    if (_W) {
      window.Worker = function (u, o) {
        try { record(u); record(u, workers); } catch (e) {}
        return new _W(u, o);
      };
      window.Worker.prototype = _W.prototype;
    }
  } catch (e) {}
  try {
    var _SW = window.SharedWorker;
    if (_SW) {
      window.SharedWorker = function (u, o) { try { record(u); record(u, workers); } catch (e) {} return new _SW(u, o); };
      window.SharedWorker.prototype = _SW.prototype;
    }
  } catch (e) {}

  /* ------------- 5) createObjectURL: revela assets gerados ------------ */
  // Nao registra nada util, mas evita perder o rastro de blobs vindos de fetch.

  /* --------------------- 6) Canal com o mundo ISOLATED ---------------- */
  /*
   * Que bibliotecas a pagina realmente carregou.
   *
   * So daqui da para saber: o mundo ISOLATED nao enxerga o window do site, e
   * ler o nome do arquivo no <script> engana — bundle moderno junta tudo num
   * chunk com nome de hash. Saber que o site roda GSAP + ScrollTrigger + Lenis
   * explica metade do movimento dele, e e a informacao que um design system
   * precisa dar para alguem reproduzir aquilo.
   */
  function bibliotecas() {
    var achadas = [];
    var ver = function (v) { return v ? ' ' + String(v).slice(0, 12) : ''; };
    var tenta = function (fn) { try { fn(); } catch (e) {} };

    tenta(function () { if (window.gsap) achadas.push('GSAP' + ver(window.gsap.version)); });
    tenta(function () {
      if (window.ScrollTrigger || (window.gsap && window.gsap.core &&
          window.gsap.core.globals && window.gsap.core.globals().ScrollTrigger)) achadas.push('ScrollTrigger');
    });
    tenta(function () { if (window.ScrollSmoother) achadas.push('ScrollSmoother'); });
    tenta(function () { if (window.SplitText || window.SplitType || window.Splitting) achadas.push('Split text'); });
    tenta(function () { if (window.Lenis || window.lenis) achadas.push('Lenis'); });
    tenta(function () { if (window.LocomotiveScroll) achadas.push('Locomotive Scroll'); });
    tenta(function () { if (window.THREE) achadas.push('Three.js' + ver(window.THREE.REVISION)); });
    tenta(function () { if (window.Swiper) achadas.push('Swiper'); });
    tenta(function () { if (window.EmblaCarousel) achadas.push('Embla'); });
    tenta(function () { if (window.Splide) achadas.push('Splide'); });
    tenta(function () { if (window.Flickity) achadas.push('Flickity'); });
    tenta(function () { if (window.lottie || window.bodymovin) achadas.push('Lottie'); });
    tenta(function () { if (window.anime) achadas.push('Anime.js'); });
    tenta(function () { if (window.barba) achadas.push('Barba'); });
    tenta(function () { if (window.AOS) achadas.push('AOS'); });
    tenta(function () { if (window.matter || window.Matter) achadas.push('Matter.js'); });
    tenta(function () { if (window.PIXI) achadas.push('PixiJS'); });
    tenta(function () { if (window.jQuery) achadas.push('jQuery' + ver(window.jQuery.fn && window.jQuery.fn.jquery)); });
    tenta(function () { if (window.Webflow) achadas.push('Webflow'); });
    tenta(function () { if (window.__NEXT_DATA__ || window.next || window.__next_f) achadas.push('Next.js'); });
    tenta(function () { if (window.__NUXT__ || window.$nuxt) achadas.push('Nuxt'); });
    tenta(function () { if (window.__remixContext) achadas.push('Remix'); });
    tenta(function () { if (window.__sveltekit_dev || window.__SVELTEKIT_PAYLOAD__) achadas.push('SvelteKit'); });
    tenta(function () { if (window.Alpine) achadas.push('Alpine.js'); });
    tenta(function () { if (window.htmx) achadas.push('htmx'); });
    return achadas;
  }

  document.addEventListener('xtr:pull', function () {
    var payload;
    try {
      var extra = [];
      try {
        var es = performance.getEntriesByType('resource');
        for (var i = 0; i < es.length; i++) extra.push(es[i].name);
      } catch (e) {}
      for (var j = 0; j < extra.length; j++) record(extra[j]);

      var bodyArr = [];
      bodies.forEach(function (v, k) { bodyArr.push({ key: k, ct: v.ct, b64: v.b64 }); });

      payload = JSON.stringify({
        urls: Array.from(urls),
        workers: Array.from(workers),
        bodies: bodyArr,
        libs: bibliotecas()
      });
    } catch (e) {
      payload = JSON.stringify({ urls: [], workers: [], bodies: [], libs: [], error: String(e) });
    }
    try {
      document.dispatchEvent(new CustomEvent('xtr:push', { detail: payload }));
    } catch (e) {}
  }, false);
})();
