/*
 * scan.js — varre DOM e CSSOM atras de URLs e busca o que hooks.js
 * (mundo MAIN) registrou, por CustomEvent.
 *
 * Mundo ISOLATED: sem acesso ao JS da pagina, com acesso ao DOM e ao
 * chrome.runtime. Os arquivos de content/ sao injetados juntos, nesta ordem:
 * scan, scroll, design-tokens, design-patterns, bridge. Como content script
 * nao pode ser modulo ES, eles se enxergam pelo objeto window.__XTR__, que so
 * existe no mundo isolado da extensao.
 */
(function () {
  'use strict';
  var XTR = window.__XTR__ || (window.__XTR__ = {});
  if (XTR.scanDom) return;

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function absolutize(u) {
    try {
      if (!u) return null;
      var s = String(u).trim();
      if (!s || s.charAt(0) === '#') return null;
      if (/^(data|blob|javascript|about|mailto|tel|chrome-extension):/i.test(s)) return null;
      var a = new URL(s, document.baseURI).href;
      return /^https?:/i.test(a) ? a.split('#')[0] : null;
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ *
   * Varredura do DOM                                                    *
   * ------------------------------------------------------------------ */
  var URL_ATTRS = [
    'src', 'href', 'poster', 'data', 'action', 'background', 'xlink:href',
    'data-src', 'data-href', 'data-poster', 'data-bg', 'data-background',
    'data-background-image', 'data-image', 'data-lazy', 'data-lazy-src',
    'data-original', 'data-thumb', 'data-large', 'data-full', 'data-video',
    'data-model', 'data-gltf', 'data-texture', 'data-map', 'data-normal'
  ];
  var SRCSET_ATTRS = ['srcset', 'imagesrcset', 'data-srcset', 'data-lazy-srcset'];

  function parseSrcset(v) {
    var out = [];
    try {
      String(v).split(',').forEach(function (part) {
        var t = part.trim();
        if (!t) return;
        // "url 2x" / "url 800w" / "url"
        var sp = t.split(/\s+/);
        if (sp[0]) out.push(sp[0]);
      });
    } catch (e) {}
    return out;
  }

  function cssUrlsFrom(text, base, sink) {
    if (!text) return;
    var re = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, m;
    while ((m = re.exec(text)) !== null) {
      var raw = m[2].trim();
      if (!raw || raw.charAt(0) === '#') continue;
      try { var a = new URL(raw, base || document.baseURI).href; if (/^https?:/i.test(a)) sink.add(a.split('#')[0]); } catch (e) {}
    }
    var imp = /@import\s+(?:url\(\s*)?(['"])([^'"]+)\1/gi;
    while ((m = imp.exec(text)) !== null) {
      try { var b = new URL(m[2], base || document.baseURI).href; if (/^https?:/i.test(b)) sink.add(b.split('#')[0]); } catch (e) {}
    }
  }

  function scanDom() {
    var found = new Set();
    var links = new Set();

    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      for (var a = 0; a < URL_ATTRS.length; a++) {
        var name = URL_ATTRS[a];
        var v = null;
        try { v = name === 'xlink:href' ? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') : el.getAttribute(name); } catch (e) {}
        if (!v) continue;
        var abs = absolutize(v);
        if (!abs) continue;
        if (el.tagName === 'A' && name === 'href') links.add(abs); else found.add(abs);
      }
      for (var s = 0; s < SRCSET_ATTRS.length; s++) {
        var sv = null;
        try { sv = el.getAttribute(SRCSET_ATTRS[s]); } catch (e) {}
        if (!sv) continue;
        parseSrcset(sv).forEach(function (u) { var x = absolutize(u); if (x) found.add(x); });
      }
      // style inline
      try {
        var st = el.getAttribute && el.getAttribute('style');
        if (st && st.indexOf('url(') >= 0) cssUrlsFrom(st, document.baseURI, found);
      } catch (e) {}
      // meta og:image / twitter:image
      if (el.tagName === 'META') {
        try {
          var p = (el.getAttribute('property') || el.getAttribute('name') || '').toLowerCase();
          if (/image|video|audio/.test(p)) { var mv = absolutize(el.getAttribute('content')); if (mv) found.add(mv); }
        } catch (e) {}
      }
    }

    // CSSOM: pega regras de folhas mesmas-origem, inclusive as injetadas em runtime
    try {
      for (var k = 0; k < document.styleSheets.length; k++) {
        var sheet = document.styleSheets[k];
        var href = null;
        try { href = sheet.href; } catch (e) {}
        if (href) { var ha = absolutize(href); if (ha) found.add(ha); }
        var rules = null;
        try { rules = sheet.cssRules; } catch (e) { rules = null; } // cross-origin: buscamos depois
        if (!rules) continue;
        (function walk(list, base) {
          for (var r = 0; r < list.length; r++) {
            var rule = list[r];
            try {
              if (rule.cssText) cssUrlsFrom(rule.cssText, base, found);
              if (rule.cssRules) walk(rule.cssRules, base);
            } catch (e) {}
          }
        })(rules, href || document.baseURI);
      }
    } catch (e) {}

    return { found: Array.from(found), links: Array.from(links) };
  }

  /* ------------------------------------------------------------------ *
   * Dados do mundo MAIN                                                  *
   * ------------------------------------------------------------------ */
  function pullFromMain() {
    return new Promise(function (resolve) {
      var done = false;
      function onPush(ev) {
        if (done) return;
        done = true;
        document.removeEventListener('xtr:push', onPush);
        try { resolve(JSON.parse(ev.detail)); } catch (e) { resolve({ urls: [], workers: [], bodies: [], libs: [] }); }
      }
      document.addEventListener('xtr:push', onPush);
      try { document.dispatchEvent(new CustomEvent('xtr:pull')); } catch (e) {}
      setTimeout(function () {
        if (done) return;
        done = true;
        document.removeEventListener('xtr:push', onPush);
        resolve({ urls: [], workers: [], bodies: [], libs: [], missing: true });
      }, 4000);
    });
  }

  XTR.sleep = sleep;
  XTR.scanDom = scanDom;
  XTR.pullFromMain = pullFromMain;
})();
