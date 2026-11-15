/*!
 * worker-runtime.js — mesma ideia do runtime principal, dentro de Web Workers.
 * Gerado por "Extrator de Sites".
 *
 * Workers tem seu proprio escopo global: os hooks da janela nao chegam aqui.
 * Decodificadores de Draco, Basis/KTX2 e malhas pesadas rodam em worker e
 * pedem .wasm/.bin por conta propria — sem isto, o site 3D carrega o modelo
 * pela metade e falha em silencio.
 */
(function () {
  'use strict';

  var CFG = /*__XTR_CONFIG__*/{ map: {}, paths: {}, origins: [] };

  var ROOT;
  try { ROOT = new URL('../', self.location.href).href; } catch (e) { ROOT = self.location.href; }

  function toLocal(input) {
    if (input === null || input === undefined) return null;
    var s = String(input);
    if (!s || /^(data|blob|javascript|about):/i.test(s)) return null;

    var url;
    try { url = new URL(s, self.location.href); } catch (e) { return null; }

    var href = url.href;
    var hash = url.hash || '';
    var noHash = href.slice(0, href.length - hash.length);

    var p = CFG.map[noHash];
    if (!p && url.search) p = CFG.map[url.origin + url.pathname];
    if (!p) {
      var known = url.origin === self.location.origin;
      for (var i = 0; !known && i < (CFG.origins || []).length; i++) {
        if (CFG.origins[i] === url.origin) known = true;
      }
      if (known) p = CFG.paths[url.pathname + url.search] || CFG.paths[url.pathname];
    }
    if (!p) return null;

    var out = ROOT + p + hash;
    return out === href ? null : out;
  }

  var _fetch = self.fetch;
  if (typeof _fetch === 'function') {
    self.fetch = function (input, init) {
      try {
        var href = (typeof input === 'string' || input instanceof URL) ? String(input) : (input && input.url) || '';
        var l = toLocal(href);
        if (l) {
          if (typeof input === 'string' || input instanceof URL) input = l;
          else { try { input = new Request(l, input); } catch (e) { input = l; } }
        }
      } catch (e) {}
      return _fetch.call(self, input, init);
    };
  }

  try {
    if (self.XMLHttpRequest) {
      var XO = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        try {
          var l = toLocal(url);
          if (l) { var a = [].slice.call(arguments); a[1] = l; return XO.apply(this, a); }
        } catch (e) {}
        return XO.apply(this, arguments);
      };
    }
  } catch (e) {}

  try {
    var _is = self.importScripts;
    if (typeof _is === 'function') {
      self.importScripts = function () {
        var args = [];
        for (var i = 0; i < arguments.length; i++) {
          var l = null;
          try { l = toLocal(arguments[i]); } catch (e) {}
          args.push(l || arguments[i]);
        }
        return _is.apply(self, args);
      };
    }
  } catch (e) {}

  self.__XTR_WORKER_OFFLINE__ = { root: ROOT, resolve: toLocal };
})();
