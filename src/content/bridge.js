/*
 * bridge.js — mundo ISOLATED. Falta de acesso ao JS da pagina, sobra acesso ao
 * DOM e ao chrome.runtime. Faz tres coisas:
 *   1. dirige a pagina (auto-scroll) para forcar lazy-load e ScrollTrigger;
 *   2. varre DOM + CSSOM atras de URLs;
 *   3. conversa com hooks.js (mundo MAIN) por CustomEvent.
 */
(function () {
  'use strict';
  if (window.__XTR_BRIDGE__) return;
  window.__XTR_BRIDGE__ = true;

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

    // fontes realmente usadas
    try {
      document.fonts.forEach(function (f) { if (f && f.family) { /* src nao exposto; ja vem do CSS */ } });
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

  /* ------------------------------------------------------------------ *
   * Auto-scroll: o motor que faz o site "se revelar"                     *
   * ------------------------------------------------------------------ */
  function docHeight() {
    var b = document.body, e = document.documentElement;
    return Math.max(
      b ? b.scrollHeight : 0, b ? b.offsetHeight : 0,
      e ? e.scrollHeight : 0, e ? e.offsetHeight : 0, e ? e.clientHeight : 0
    );
  }

  function scrollContainers() {
    var out = [];
    try {
      var all = document.querySelectorAll('*');
      for (var i = 0; i < all.length && out.length < 12; i++) {
        var el = all[i];
        if (el === document.body || el === document.documentElement) continue;
        var cs;
        try { cs = getComputedStyle(el); } catch (e) { continue; }
        if (!cs) continue;
        var oy = cs.overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 80) out.push(el);
      }
    } catch (e) {}
    return out;
  }

  function fireWheel(target, dy) {
    try {
      var ev = new WheelEvent('wheel', {
        deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true, composed: true
      });
      (target || window).dispatchEvent(ev);
    } catch (e) {}
  }

  function resourceCount() {
    try { return performance.getEntriesByType('resource').length; } catch (e) { return 0; }
  }

  async function waitIdle(maxMs, quietMs) {
    var last = resourceCount();
    var stable = 0;
    var t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      await sleep(200);
      var n = resourceCount();
      if (n === last) { stable += 200; if (stable >= quietMs) return; }
      else { stable = 0; last = n; }
    }
  }

  /*
   * ociosa() — true quando o navegador entrega uma janela ociosa de verdade.
   *
   * E o unico sinal confiavel de que a pagina parou de agendar trabalho. Sem
   * ele, "a rede ficou quieta por 1,5s" mente: entre dois lotes de um preload
   * agendado em requestIdleCallback pode haver muito mais que isso.
   */
  function ociosa() {
    return new Promise(function (r) {
      if (typeof requestIdleCallback !== 'function') return r(true);
      var respondeu = false;
      try {
        requestIdleCallback(function (d) {
          respondeu = true;
          r(d.timeRemaining() > 8);   // sobra de quadro = nada na fila
        }, { timeout: 1200 });
      } catch (e) { return r(true); }
      setTimeout(function () { if (!respondeu) r(false); }, 1400);
    });
  }

  /*
   * repousar() — a fase que faltava: parar e deixar o site terminar.
   *
   * A rede de um site moderno nao acaba quando a rolagem acaba. Sequencias de
   * imagem (o canvas quadro a quadro), decodificadores e pre-carregamentos
   * ficam agendados em requestIdleCallback — e enquanto a captura rola, com
   * GSAP e WebGL ocupando o quadro, o navegador nunca entrega janela ociosa.
   * Parada a rolagem, o site despacha tudo isso em lotes, com pausas maiores
   * que o quietMs curto do waitIdle.
   *
   * Medido num site real, sequencia de 371 frames em lotes de 20 por
   * requestIdleCallback: fim da rolagem 180 frames, +1,5s parado 200,
   * +10s parados 371. Por isso esta fase e paciente e so desiste quando a
   * contagem de recursos para de crescer E a pagina fica ociosa.
   */
  async function repousar(maxMs, quietMs) {
    maxMs = maxMs || 45000;
    quietMs = quietMs || 4000;

    /*
     * O sinal de "chegou coisa nova" nao pode ser o tamanho do buffer de
     * resource timing: ele tem teto, e quando enche a contagem congela — a
     * pagina parece quieta justamente quando esta baixando mais. Um observer
     * proprio conta entradas conforme chegam, sem depender do buffer.
     */
    var novos = 0;
    var po = null;
    try {
      po = new PerformanceObserver(function (l) { novos += l.getEntries().length; });
      po.observe({ type: 'resource', buffered: false });
    } catch (e) { po = null; }

    var t0 = Date.now();
    var last = po ? 0 : resourceCount();
    var stable = 0;
    var total = 0;
    try {
      while (Date.now() - t0 < maxMs) {
        await sleep(250);
        var n = po ? novos : resourceCount();
        if (n !== last) { total += (n - last); stable = 0; last = n; continue; }
        stable += 250;
        if (stable >= quietMs && await ociosa()) break;
      }
    } finally {
      if (po) { try { po.disconnect(); } catch (e) {} }
    }
    return po ? novos : total;
  }

  async function autoscroll(opts) {
    opts = opts || {};
    var stepRatio = opts.stepRatio || 0.7;
    var dwell = opts.dwell != null ? opts.dwell : 420;
    var passes = opts.passes || 1;
    var budgetMs = opts.budgetMs || 90000;
    var wheelToo = opts.wheel !== false;
    var t0 = Date.now();
    var containers = scrollContainers();

    for (var pass = 0; pass < passes; pass++) {
      var y = 0;
      var guard = 0;
      while (guard++ < 400) {
        if (Date.now() - t0 > budgetMs) break;
        var vh = window.innerHeight || 800;
        var step = Math.max(120, Math.floor(vh * stepRatio));
        y += step;
        var max = docHeight();

        try { window.scrollTo({ top: Math.min(y, max), behavior: 'auto' }); } catch (e) { try { window.scrollTo(0, Math.min(y, max)); } catch (e2) {} }
        if (wheelToo) { fireWheel(window, step); fireWheel(document.body || window, step); }
        for (var c = 0; c < containers.length; c++) {
          try { containers[c].scrollTop = Math.min(containers[c].scrollTop + step, containers[c].scrollHeight); } catch (e) {}
          if (wheelToo) fireWheel(containers[c], step);
        }
        try { window.dispatchEvent(new Event('scroll')); document.dispatchEvent(new Event('scroll')); } catch (e) {}

        await sleep(dwell);

        var reached = (window.scrollY || window.pageYOffset || 0) + (window.innerHeight || 0);
        var newMax = docHeight();
        if (y >= newMax && reached >= newMax - 4) break;   // fim real
        if (y > newMax + (window.innerHeight || 800) * 2) break; // trava de seguranca
      }

      await waitIdle(8000, 1200);

      // volta ao topo devagar: muitos sites carregam coisas na subida tambem
      var back = docHeight();
      while (back > 0 && Date.now() - t0 < budgetMs) {
        back -= Math.max(200, (window.innerHeight || 800));
        try { window.scrollTo(0, Math.max(0, back)); } catch (e) {}
        if (wheelToo) fireWheel(window, -(window.innerHeight || 800));
        await sleep(90);
      }
      try { window.scrollTo(0, 0); } catch (e) {}
      await sleep(200);
    }

    // eventos que costumam destravar recalculos de layout/animacao
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}
    try { window.dispatchEvent(new Event('load')); } catch (e) {}
    return { ok: true, repouso: await repousar(opts.repousoMs, opts.repousoQuietoMs) };
  }

  async function hoverSweep(limit) {
    var els = document.querySelectorAll('a, button, [data-hover], [class*="hover"]');
    var n = Math.min(els.length, limit || 40);
    for (var i = 0; i < n; i++) {
      try {
        var el = els[i];
        ['pointerover', 'mouseover', 'mouseenter'].forEach(function (t) {
          el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
        });
      } catch (e) {}
      if (i % 8 === 0) await sleep(60);
    }
    await sleep(400);
  }


  /* ------------------------------------------------------------------ *
   * Extracao de design system                                           *
   *                                                                     *
   * Ler o CSS do arquivo diz o que foi DECLARADO. Ler o computed style  *
   * diz o que o site REALMENTE usa: variaveis ja resolvidas, cascata    *
   * aplicada, media query da viewport atual valendo. Por isso a coleta  *
   * acontece aqui, na pagina viva, e nao so no CSS baixado.             *
   *                                                                     *
   * O peso de cada valor e a area que ele ocupa na tela, nao a contagem *
   * de elementos: um fundo de secao importa mais para a identidade do   *
   * site do que trinta bordinhas de 1px.                                *
   * ------------------------------------------------------------------ */

  var LIMITE_ELEMENTOS = 4000;

  // Involucros que nao definem estilo proprio: quando o texto esta neles, o
  // dono do estilo costuma estar acima.
  var GENERICO = /^(span|div|em|strong|i|b|u|small|mark|font)$/;

  function normalizarCor(valor) {
    if (!valor) return null;
    var v = String(valor).trim();
    if (!v || v === 'none' || v === 'currentcolor') return null;
    if (v === 'transparent' || v === 'rgba(0, 0, 0, 0)') return null;
    var m = /^rgba?\(([^)]+)\)$/i.exec(v);
    if (!m) return null;
    var p = m[1].split(/[,\s\/]+/).filter(function (x) { return x !== ''; });
    var r = Math.round(parseFloat(p[0])), g = Math.round(parseFloat(p[1])), b = Math.round(parseFloat(p[2]));
    var a = p.length > 3 ? parseFloat(p[3]) : 1;
    if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return null;
    var hex = '#' + [r, g, b].map(function (n) {
      return ('0' + Math.max(0, Math.min(255, n)).toString(16)).slice(-2);
    }).join('');
    return { hex: hex, alpha: Math.round(a * 100) / 100 };
  }

  /*
   * Primeiro item de uma lista separada por virgula, respeitando parenteses.
   * split(',')[0] parece resolver ate encontrar transition-timing-function:
   * "cubic-bezier(0.4, 0, 0.2, 1)" vira "cubic-bezier(0.4" e o token gerado
   * nao e nem CSS valido.
   */
  function primeiroDaLista(valor) {
    var s = String(valor || ''), nivel = 0, saida = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '(') nivel++;
      else if (c === ')') nivel--;
      else if (c === ',' && nivel === 0) break;
      saida += c;
    }
    return saida.trim();
  }

  function somar(mapa, chave, peso) {
    if (chave === null || chave === undefined || chave === '') return;
    var k = String(chave);
    if (k === 'none' || k === 'normal' || k === 'auto' || k === '0px') return;
    mapa[k] = (mapa[k] || 0) + (peso || 1);
  }

  function coletarTokens() {
    var cores = {}, corTexto = {}, corFundo = {}, corBorda = {};
    var familias = {}, tamanhos = {}, pesos = {}, alturas = {}, espacamentoLetra = {};
    var raios = {}, sombras = {}, espacos = {}, duracoes = {}, curvas = {}, gradientes = {};
    var transicoes = {}, animacoes = {};
    var estilosTexto = {};

    var donosVistos = new WeakSet();
    var todos = document.querySelectorAll('body *');
    var passo = todos.length > LIMITE_ELEMENTOS ? Math.ceil(todos.length / LIMITE_ELEMENTOS) : 1;

    for (var i = 0; i < todos.length; i += passo) {
      var el = todos[i];
      var cs, r;
      try { cs = getComputedStyle(el); r = el.getBoundingClientRect(); } catch (e) { continue; }
      if (!cs || cs.display === 'none' || cs.visibility === 'hidden') continue;

      // checkVisibility leva a opacidade dos ancestrais em conta, e e isso que
      // importa aqui: um preloader de tela cheia com opacity 0 continua tendo
      // computed style, e sem este filtro a cor dele domina a analise inteira —
      // um overlay branco esquecido faria um site escuro ser lido como claro.
      try {
        if (el.checkVisibility && !el.checkVisibility({
          opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true
        })) continue;
      } catch (e) {
        if (parseFloat(cs.opacity) < 0.1) continue;
      }
      if (parseFloat(cs.opacity) < 0.1) continue;

      var area = Math.max(0, r.width) * Math.max(0, r.height);
      var pesoArea = area > 0 ? Math.min(40, 1 + Math.sqrt(area) / 24) : 0.4;

      var cf = normalizarCor(cs.backgroundColor);
      if (cf && cf.alpha > 0.05) { somar(cores, cf.hex, pesoArea); somar(corFundo, cf.hex, pesoArea); }

      var temTexto = false;
      try {
        for (var n = 0; n < el.childNodes.length; n++) {
          if (el.childNodes[n].nodeType === 3 && el.childNodes[n].nodeValue.trim()) { temTexto = true; break; }
        }
      } catch (e) {}

      if (temTexto) {
        /*
         * Quem "tem" o texto nem sempre e quem o mostra. SplitText e amigos
         * quebram um titulo em uma <div class="chars"> por caractere, e sem
         * subir ate o dono a tabela de tipografia sairia com uma linha para a
         * letra D e outra para a letra e — o <h1> em si nunca aparece, porque
         * ele nao tem texto direto nenhum. Subimos enquanto a assinatura de
         * fonte for a mesma e o elemento ainda for um invólucro generico.
         */
        var dono = el;
        try {
          var subidas = 0;
          while (subidas++ < 6 && GENERICO.test(dono.tagName.toLowerCase())) {
            var pai = dono.parentElement;
            if (!pai || pai === document.body) break;
            var cp = getComputedStyle(pai);
            if (cp.fontSize !== cs.fontSize || cp.fontWeight !== cs.fontWeight ||
                cp.fontFamily !== cs.fontFamily || cp.lineHeight !== cs.lineHeight) break;
            var tp = (pai.textContent || '').trim();
            if (!tp || tp.length > 160) break;
            dono = pai;
          }
        } catch (e) {}
        // Contar as outras 20 letras do mesmo titulo inflaria a estatistica; o
        // resto da varredura (bordas, raios, espacos) continua valendo para elas.
        var novoDono = !donosVistos.has(dono);
        try { if (novoDono) donosVistos.add(dono); } catch (e) {}
        if (novoDono) {
          var ct = normalizarCor(cs.color);
          if (ct) { somar(cores, ct.hex, pesoArea * 0.6); somar(corTexto, ct.hex, pesoArea * 0.6); }
          somar(familias, cs.fontFamily, pesoArea);
          somar(tamanhos, cs.fontSize, pesoArea);
          somar(pesos, cs.fontWeight, pesoArea);
          somar(alturas, cs.lineHeight, pesoArea);
          somar(espacamentoLetra, cs.letterSpacing, pesoArea);

          // assinatura de estilo de texto: o que se repete vira "estilo"
          var chave = [dono.tagName.toLowerCase(), cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
            cs.fontSize, cs.fontWeight, cs.lineHeight, cs.letterSpacing, cs.textTransform].join('|');
          if (!estilosTexto[chave]) {
            estilosTexto[chave] = {
              tag: dono.tagName.toLowerCase(),
              familia: cs.fontFamily, tamanho: cs.fontSize, peso: cs.fontWeight,
              altura: cs.lineHeight, espacamento: cs.letterSpacing,
              transformacao: cs.textTransform, cor: (normalizarCor(cs.color) || {}).hex || null,
              n: 0, amostra: '', classe: '', contexto: [], estilo: ''
            };
          }
          estilosTexto[chave].n++;
          // Sites com animacao letra a letra enchem o DOM de spans de um
          // caractere. A primeira amostra costuma ser uma dessas — entao ficamos
          // com a mais longa que aparecer, ate um limite util.
          try {
            var txt = (dono.textContent || '').trim().replace(/\s+/g, ' ');
            if (txt && txt.length > estilosTexto[chave].amostra.length) {
              // A amostra e o elemento andam juntos: a pagina viva reconstroi o
              // exemplo com a MESMA tag e as MESMAS classes desta ocorrencia.
              estilosTexto[chave].amostra = txt.slice(0, 90);
              estilosTexto[chave].classe = (dono.getAttribute('class') || '').slice(0, 160);
              estilosTexto[chave].contexto = contextoDe(dono);
              estilosTexto[chave].estilo = (dono.getAttribute('style') || '').slice(0, 240);
            }
          } catch (e) {}
        }
      }

      if (cs.borderTopWidth !== '0px' || cs.borderBottomWidth !== '0px') {
        var cb = normalizarCor(cs.borderTopColor);
        if (cb && cb.alpha > 0.03) somar(corBorda, cb.hex, pesoArea * 0.3);
      }

      somar(raios, cs.borderRadius, pesoArea);
      if (cs.boxShadow && cs.boxShadow !== 'none') somar(sombras, cs.boxShadow, pesoArea);
      if (/gradient/i.test(cs.backgroundImage)) somar(gradientes, cs.backgroundImage, pesoArea);

      ['paddingTop', 'paddingLeft', 'marginTop', 'marginLeft', 'gap', 'rowGap'].forEach(function (prop) {
        somar(espacos, cs[prop], 1);
      });

      if (cs.transitionDuration && cs.transitionDuration !== '0s') {
        somar(duracoes, primeiroDaLista(cs.transitionDuration), 1);
        somar(curvas, primeiroDaLista(cs.transitionTimingFunction), 1);
        // A receita completa vale mais que os pedacos: "opacity 0.4s ease" diz
        // o que o site faz; "0.4s" sozinho nao diz nada.
        somar(transicoes, primeiroDaLista(cs.transitionProperty) + ' · ' +
          primeiroDaLista(cs.transitionDuration) + ' · ' +
          primeiroDaLista(cs.transitionTimingFunction), 1);
      }

      if (cs.animationName && cs.animationName !== 'none') {
        somar(animacoes, primeiroDaLista(cs.animationName) + ' · ' +
          primeiroDaLista(cs.animationDuration) + ' · ' +
          primeiroDaLista(cs.animationTimingFunction) +
          (cs.animationIterationCount && primeiroDaLista(cs.animationIterationCount) !== '1'
            ? ' · ' + primeiroDaLista(cs.animationIterationCount) + '×' : ''), pesoArea);
      }
    }

    // Ancoras do documento. Estatistica erra; o background do body, nao.
    var ancoras = {};
    try {
      var csBody = getComputedStyle(document.body);
      var csHtml = getComputedStyle(document.documentElement);
      var fb = normalizarCor(csBody.backgroundColor) || normalizarCor(csHtml.backgroundColor);
      var ft = normalizarCor(csBody.color);
      ancoras = {
        fundo: fb ? fb.hex : null,
        texto: ft ? ft.hex : null,
        familia: csBody.fontFamily || '',
        tamanhoBase: csBody.fontSize || ''
      };
    } catch (e) {}

    return {
      ancoras: ancoras,
      cores: cores, corTexto: corTexto, corFundo: corFundo, corBorda: corBorda,
      familias: familias, tamanhos: tamanhos, pesos: pesos, alturas: alturas,
      espacamentoLetra: espacamentoLetra, raios: raios, sombras: sombras,
      gradientes: gradientes, espacos: espacos, duracoes: duracoes, curvas: curvas,
      transicoes: transicoes, animacoes: animacoes,
      estilosTexto: estilosTexto,
      elementosLidos: Math.ceil(todos.length / passo),
      elementosTotais: todos.length
    };
  }

  /** Custom properties e @media declarados nas folhas de mesma origem. */
  function coletarCssom() {
    var variaveis = {}, breakpoints = {}, keyframes = {}, fontFaces = [];
    var raiz = null;
    try { raiz = getComputedStyle(document.documentElement); } catch (e) {}

    function percorrer(regras) {
      for (var i = 0; i < regras.length; i++) {
        var r = regras[i];
        try {
          if (r.type === 1 && r.style) {                    // CSSStyleRule
            for (var j = 0; j < r.style.length; j++) {
              var nome = r.style[j];
              if (nome.indexOf('--') !== 0) continue;
              var bruto = r.style.getPropertyValue(nome).trim();
              var resolvido = bruto;
              if (raiz && /^(:root|html|body)/.test(r.selectorText || '')) {
                try { resolvido = raiz.getPropertyValue(nome).trim() || bruto; } catch (e) {}
              }
              if (!variaveis[nome]) variaveis[nome] = { valor: resolvido, seletor: (r.selectorText || '').slice(0, 60) };
            }
          } else if (r.type === 4) {                        // CSSMediaRule
            var cond = r.conditionText || (r.media && r.media.mediaText) || '';
            if (/\d/.test(cond)) breakpoints[cond] = (breakpoints[cond] || 0) + 1;
            if (r.cssRules) percorrer(r.cssRules);
          } else if (r.type === 7) {                        // CSSKeyframesRule
            keyframes[r.name] = (r.cssRules && r.cssRules.length) || 0;
          } else if (r.type === 5) {                        // CSSFontFaceRule
            fontFaces.push({
              familia: (r.style.getPropertyValue('font-family') || '').replace(/["']/g, ''),
              peso: r.style.getPropertyValue('font-weight') || '',
              estilo: r.style.getPropertyValue('font-style') || '',
              display: r.style.getPropertyValue('font-display') || ''
            });
          } else if (r.cssRules) {
            percorrer(r.cssRules);
          }
        } catch (e) { /* regra inacessivel */ }
      }
    }

    try {
      for (var k = 0; k < document.styleSheets.length; k++) {
        var folha = document.styleSheets[k];
        var regras = null;
        try { regras = folha.cssRules; } catch (e) { regras = null; }
        if (regras) percorrer(regras);
      }
    } catch (e) {}

    return { variaveis: variaveis, breakpoints: breakpoints, keyframes: keyframes, fontFaces: fontFaces };
  }

  /* ------------------------------------------------------------------ *
   * Biblioteca viva: pedacos reais da pagina                             *
   *                                                                     *
   * Tokens dizem QUAIS valores o site usa. Isso aqui traz o site em si:  *
   * o hero, os botoes, os cartoes — com as classes originais, para que a *
   * pagina de design system possa carregar o CSS do proprio site e       *
   * mostrar cada padrao exatamente como ele e, e nao uma aproximacao.    *
   *                                                                     *
   * Capturamos o DOM VIVO, depois do auto-scroll: o que o GSAP escreveu  *
   * em style inline ja esta la, entao o clone nasce no estado final da   *
   * animacao em vez de nascer invisivel esperando um script que nao vai  *
   * rodar.                                                              *
   * ------------------------------------------------------------------ */

  var MAX_FRAGMENTO = 16000;
  var MAX_HERO = 260000;
  var MAX_CSS_EMBUTIDO = 420000;
  var MAX_CANVAS = 900000;

  var ATTR_URL_FRAG = [
    'src', 'href', 'poster', 'data', 'background', 'data-src', 'data-href',
    'data-bg', 'data-background', 'data-background-image', 'data-image',
    'data-lazy', 'data-lazy-src', 'data-original', 'data-poster', 'data-video'
  ];
  var ATTR_SRCSET_FRAG = ['srcset', 'imagesrcset', 'data-srcset', 'data-lazy-srcset'];

  /* Bibliotecas que sao seguras de reexecutar numa pagina que nao e a delas.
   * O bundle de aplicacao fica de fora de proposito: React/Next tentariam
   * hidratar uma arvore que nao e a que eles geraram, e o resultado tipico e
   * a pagina inteira sendo apagada.
   *
   * O teste e no NOME DO ARQUIVO, nao na URL inteira. Casar em qualquer lugar
   * da URL parece inofensivo ate "ogl" bater dentro de "google" e o guia de
   * estilo sair carregando gtag e reCAPTCHA — um documento offline nao tem por
   * que falar com a internet. */
  var JS_SEGURO = new RegExp('^(gsap|scrolltrigger|scrollsmoother|scrolltoplugin|splittext|' +
    'lenis|locomotive-scroll|locomotive|three|lottie[\\w.-]*|swiper[\\w.-]*|splitting|' +
    'split-type|barba|aos|anime|animejs|jquery[\\w.-]*|bootstrap[\\w.-]*|alpine[\\w.-]*|' +
    'htmx|matter|pixi[\\w.-]*|curtains|ogl|rellax|simpleparallax)' +
    '([._-][\\w.-]*)?\\.m?js$', 'i');
  var JS_PROIBIDO = /(google|gtag|gtm\.|analytics|recaptcha|facebook|hotjar|clarity|segment|intercom|tiktok|linkedin|doubleclick|cookiebot|onetrust|hubspot|mixpanel|sentry)/i;

  function absDoc(v) {
    try {
      if (!v) return null;
      var s = String(v).trim();
      if (!s || s.charAt(0) === '#') return null;
      if (/^(data|blob|javascript|about|mailto|tel|chrome-extension):/i.test(s)) return null;
      return new URL(s, document.baseURI).href;
    } catch (e) { return null; }
  }

  function ehVisivel(el) {
    try {
      var cs = getComputedStyle(el);
      if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (parseFloat(cs.opacity) < 0.05) return false;
      if (el.checkVisibility && !el.checkVisibility({
        opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true
      })) return false;
      return true;
    } catch (e) { return false; }
  }

  function classeDe(el) {
    try { return (el.getAttribute('class') || '').trim(); } catch (e) { return ''; }
  }

  function juntarClasse(el, extra) {
    // className nao serve: em SVG ele e um SVGAnimatedString e a atribuicao falha.
    try {
      var atual = el.getAttribute('class') || '';
      el.setAttribute('class', (atual + ' ' + extra).trim());
    } catch (e) {}
  }

  /**
   * Cadeia de ancestrais ate o body. Sem ela, seletores como ".escuro .cartao"
   * ou ".hero h1" nao alcancam o exemplo, e o padrao aparece sem estilo.
   */
  function contextoDe(el) {
    var cadeia = [];
    var no = el.parentElement, guarda = 0;
    while (no && no !== document.body && no !== document.documentElement && guarda++ < 12) {
      cadeia.push({
        tag: no.tagName.toLowerCase(),
        cls: classeDe(no).slice(0, 160),
        id: (no.getAttribute('id') || '').slice(0, 80)
      });
      no = no.parentElement;
    }
    return cadeia.slice(0, 5).reverse();
  }

  function limparComentarios(no) {
    try {
      for (var i = no.childNodes.length - 1; i >= 0; i--) {
        var f = no.childNodes[i];
        if (f.nodeType === 8) no.removeChild(f);
        else if (f.nodeType === 1) limparComentarios(f);
      }
    } catch (e) {}
  }

  /**
   * Clona um elemento vivo e devolve HTML pronto para outro documento:
   * URLs absolutas, imagem que de fato carregou, scripts fora.
   * @param {Function} [antes] recebe o clone antes da limpeza (para marcar slots)
   */
  function serializar(orig, limite, antes) {
    var clone;
    try { clone = orig.cloneNode(true); } catch (e) { return null; }

    var origens = [orig], clones = [clone];
    try {
      var oa = orig.querySelectorAll('*'), ca = clone.querySelectorAll('*');
      if (oa.length === ca.length) {
        for (var i = 0; i < oa.length; i++) { origens.push(oa[i]); clones.push(ca[i]); }
      }
    } catch (e) {}

    for (var n = 0; n < clones.length; n++) {
      var eo = origens[n], ec = clones[n];
      var tag = ec.tagName ? ec.tagName.toLowerCase() : '';

      if (tag === 'img') {
        var real = '';
        try { real = eo.currentSrc || eo.src || ''; } catch (e) {}
        if (real && /^https?:/i.test(real)) {
          ec.setAttribute('src', real);              // o que o lazy-load resolveu
          ec.removeAttribute('srcset');
          ec.removeAttribute('data-srcset');
        }
        ec.removeAttribute('loading');               // no guia, tudo aparece de uma vez
      }

      for (var a = 0; a < ATTR_URL_FRAG.length; a++) {
        var nome = ATTR_URL_FRAG[a], v = null;
        try { v = ec.getAttribute(nome); } catch (e) {}
        if (!v) continue;
        var abs = absDoc(v);
        if (abs) ec.setAttribute(nome, abs);
      }

      for (var s = 0; s < ATTR_SRCSET_FRAG.length; s++) {
        var sv = null;
        try { sv = ec.getAttribute(ATTR_SRCSET_FRAG[s]); } catch (e) {}
        if (!sv) continue;
        var partes = String(sv).split(',').map(function (p) {
          var t = p.trim(); if (!t) return '';
          var sp = t.split(/\s+/), u = absDoc(sp[0]);
          return (u || sp[0]) + (sp.length > 1 ? ' ' + sp.slice(1).join(' ') : '');
        }).filter(Boolean);
        ec.setAttribute(ATTR_SRCSET_FRAG[s], partes.join(', '));
      }

      try {
        var st = ec.getAttribute('style');
        if (st && st.indexOf('url(') >= 0) {
          ec.setAttribute('style', st.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, function (m, q, u) {
            var x = absDoc(u);
            return x ? 'url("' + x + '")' : m;
          }));
        }
      } catch (e) {}

      try {
        var xl = ec.getAttributeNS && ec.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (xl) { var xa = absDoc(xl); if (xa) ec.setAttributeNS('http://www.w3.org/1999/xlink', 'href', xa); }
      } catch (e) {}

      // Canvas clonado nasce em branco. Congelar o quadro como imagem de fundo
      // preserva o visual sem trocar o elemento por outro. Em WebGL sem
      // preserveDrawingBuffer costuma vir vazio — dai o teste de tamanho.
      if (tag === 'canvas') {
        try {
          var dados = eo.toDataURL('image/png');
          if (dados && dados.length > 4000 && dados.length < MAX_CANVAS) {
            ec.setAttribute('style', (ec.getAttribute('style') || '') +
              ';background-image:url(' + dados + ');background-size:contain;' +
              'background-repeat:no-repeat;background-position:center');
          }
        } catch (e) { /* canvas contaminado por imagem de outra origem */ }
      }
    }

    // Elemento tirado de um contexto posicionado voaria para fora do palco.
    try {
      var csr = getComputedStyle(orig);
      if (csr && /^(absolute|fixed|sticky)$/.test(csr.position)) juntarClasse(clone, 'xtr-desancorado');
    } catch (e) {}

    /*
     * Midia que a animacao de entrada ainda nao revelou.
     *
     * GSAP e afins escrevem "visibility:hidden" ou "opacity:0" no atributo
     * style e so limpam quando a secao entra na tela. Se a captura pegou o
     * elemento antes disso, o design system mostra um cartao com um buraco no
     * lugar da imagem. Como o alvo aqui e documentar o componente pronto,
     * apagamos essas duas declaracoes — do clone, e so em midia.
     */
    try {
      var revelar = function (el) {
        var st = el && el.getAttribute && el.getAttribute('style');
        if (!st || !/visibility\s*:\s*hidden|opacity\s*:\s*0(?!\.)/i.test(st)) return;
        var limpo = st
          .replace(/visibility\s*:\s*hidden\s*;?/ig, '')
          .replace(/opacity\s*:\s*0(?!\.)\s*;?/ig, '')
          .trim();
        if (limpo) el.setAttribute('style', limpo);
        else el.removeAttribute('style');
      };
      var midia = clone.querySelectorAll('img, video, picture, svg');
      for (var m = 0; m < midia.length; m++) {
        revelar(midia[m]);
        // O estado de entrada costuma morar na moldura, nao na imagem: e o
        // <div class="ft"> com opacity:0 que segura a foto do projeto.
        var no = midia[m].parentNode, subiu = 0;
        while (no && no !== clone && subiu++ < 2) { revelar(no); no = no.parentNode; }
      }
    } catch (e) {}

    if (typeof antes === 'function') { try { antes(clone); } catch (e) {} }

    try {
      var lixo = clone.querySelectorAll('script, noscript, template, link[rel="import"]');
      for (var k = 0; k < lixo.length; k++) {
        if (lixo[k].parentNode) lixo[k].parentNode.removeChild(lixo[k]);
      }
    } catch (e) {}
    limparComentarios(clone);

    var html = '';
    try { html = clone.outerHTML; } catch (e) { return null; }

    if (html.length > limite) {
      // Ultima tentativa: sprites de SVG costumam responder por quase todo o peso.
      try {
        var svgs = clone.querySelectorAll('svg');
        for (var g = 0; g < svgs.length; g++) {
          if (svgs[g].outerHTML.length > 3000 && svgs[g].parentNode) svgs[g].innerHTML = '';
        }
        html = clone.outerHTML;
      } catch (e) {}
      if (html.length > limite) return null;
    }
    return html;
  }

  /*
   * Antes de clonar os fragmentos: devolver a pagina ao topo e deixar assentar.
   *
   * A captura termina depois de percorrer o site inteiro, e o ScrollTrigger
   * deixa rastro disso: o hero fica com o transform do pin — "translate(0,
   * 1000px)" — e os elementos que entram por animacao continuam em opacity 0.
   * Clonado assim, o hero da pagina de design e um retangulo preto.
   *
   * Voltar ao topo, avisar scroll e resize e esperar dois quadros faz o GSAP
   * reverter o pin e rodar a entrada, que e o estado que documenta o design.
   */
  async function assentarNoTopo() {
    try { window.scrollTo(0, 0); } catch (e) {}
    try {
      window.dispatchEvent(new Event('scroll'));
      document.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
    } catch (e) {}
    /*
     * Dois quadros para o layout recalcular — com relogio ao lado, porque
     * requestAnimationFrame NAO dispara em aba oculta, e a aba do site volta
     * para segundo plano assim que a rolagem termina. Sem esse limite a espera
     * ficava presa ali, a coleta de design estourava o timeout e a captura
     * inteira saia sem design system.
     */
    try {
      await new Promise(function (r) {
        var pronto = false;
        var fim = function () { if (!pronto) { pronto = true; r(); } };
        try { requestAnimationFrame(function () { requestAnimationFrame(fim); }); } catch (e) {}
        setTimeout(fim, 400);
      });
    } catch (e) {}
    // a animacao de entrada costuma durar bem menos que isso
    await new Promise(function (r) { setTimeout(r, 900); });
  }

  function pacote(el, html) {
    var r = { width: 0, height: 0 };
    try { r = el.getBoundingClientRect(); } catch (e) {}
    /*
     * A largura do pai vai junto porque muito componente e dimensionado em
     * porcentagem dele: um cartao com width:41% recriado numa caixa do tamanho
     * do proprio cartao encolhe para 41% disso e aparece espremido. Com a
     * medida do espaco onde ele vive, a pagina de design reproduz o berco e
     * reduz o conjunto em escala.
     */
    var larguraCtx = 0;
    try {
      var pai = el.parentElement;
      if (pai) larguraCtx = Math.round(pai.getBoundingClientRect().width);
    } catch (e) {}
    return {
      html: html,
      contexto: contextoDe(el),
      tag: el.tagName.toLowerCase(),
      classe: classeDe(el).slice(0, 200),
      texto: ((el.textContent || '').trim().replace(/\s+/g, ' ')).slice(0, 80),
      largura: Math.round(r.width),
      altura: Math.round(r.height),
      larguraCtx: larguraCtx
    };
  }

  /* ----------------------------- o hero ------------------------------ */

  function filhosUteis(no) {
    var out = [];
    try {
      for (var i = 0; i < no.children.length; i++) {
        var f = no.children[i], t = f.tagName.toLowerCase();
        if (t === 'script' || t === 'style' || t === 'link' || t === 'noscript' || t === 'template') continue;
        if (!ehVisivel(f)) continue;
        out.push(f);
      }
    } catch (e) {}
    return out;
  }

  /**
   * Desce pelos empacotadores (#__next, .wrapper, main) ate achar o primeiro
   * bloco do tamanho de uma secao encostado no topo da pagina.
   */
  function acharHero() {
    var vh = window.innerHeight || 800, vw = window.innerWidth || 1200;
    var no = document.body, escolhido = null, guarda = 0;

    while (no && guarda++ < 14) {
      var prox = null, fs = filhosUteis(no);
      for (var i = 0; i < fs.length; i++) {
        var f = fs[i], r, cs;
        try { r = f.getBoundingClientRect(); cs = getComputedStyle(f); } catch (e) { continue; }
        if (cs.position === 'fixed') continue;              // barra presa na tela, nao secao
        if (r.top > vh * 0.55) continue;                    // ja passou da primeira dobra
        if (r.height < vh * 0.3 || r.width < vw * 0.55) continue;
        prox = f; break;
      }
      if (!prox) break;
      no = prox;
      var rp = prox.getBoundingClientRect();
      if (rp.height <= vh * 1.7) { escolhido = prox; break; }
    }

    // Sem candidato do tamanho certo, so vale a pena usar o ultimo no se ele
    // ainda for uma secao — clonar a pagina inteira nao seria um hero.
    if (!escolhido && no && no !== document.body) {
      var rf = no.getBoundingClientRect();
      if (rf.height <= vh * 2.5) escolhido = no;
    }
    if (!escolhido) return null;

    var txt = '';
    try { txt = (escolhido.textContent || '').trim(); } catch (e) {}
    var temMidia = false;
    try { temMidia = !!escolhido.querySelector('img,video,canvas,svg,picture'); } catch (e) {}
    if (txt.length < 4 && !temMidia) return null;
    return escolhido;
  }

  function caminhoAte(raiz, el) {
    var p = [], no = el, guarda = 0;
    while (no && no !== raiz && guarda++ < 60) {
      var pai = no.parentNode;
      if (!pai) return null;
      p.unshift(Array.prototype.indexOf.call(pai.childNodes, no));
      no = pai;
    }
    return no === raiz ? p : null;
  }

  function resolverCaminho(raiz, p) {
    var no = raiz;
    for (var i = 0; i < p.length; i++) {
      if (!no || !no.childNodes) return null;
      no = no.childNodes[p[i]];
    }
    return no;
  }

  /** Escolhe titulo, subtitulo e ate duas acoes do hero. */
  function escolherSlots(hero) {
    var cands = [];
    var todos;
    try { todos = hero.querySelectorAll('*'); } catch (e) { return []; }

    for (var i = 0; i < todos.length && i < 3000; i++) {
      var el = todos[i];
      var texto = '';
      try { texto = (el.textContent || '').trim().replace(/\s+/g, ' '); } catch (e) {}
      if (!texto) continue;
      if (!ehVisivel(el)) continue;
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      var emNav = false;
      try { emNav = !!(el.closest && el.closest('nav, header, [role="navigation"]')); } catch (e) {}
      cands.push({
        el: el, texto: texto, tam: parseFloat(cs.fontSize) || 0,
        peso: parseFloat(cs.fontWeight) || 400, nav: emNav
      });
    }

    var slots = [];
    var uteis = cands.filter(function (c) { return !c.nav; });
    uteis.sort(function (a, b) { return (b.tam - a.tam) || (b.texto.length - a.texto.length); });

    var titulo = null;
    for (var t = 0; t < uteis.length; t++) {
      if (uteis[t].texto.length >= 2 && uteis[t].texto.length <= 160) { titulo = uteis[t]; break; }
    }
    if (titulo) {
      /*
       * Titulo quebrado em varios elementos irmaos — um <h1> por linha — e o
       * padrao em hero animado. Pegar so um deles trocaria metade da frase e
       * deixaria a outra metade falando do produto.
       */
      var partes = [];
      for (var q = 0; q < uteis.length; q++) {
        var u = uteis[q];
        if (u.el.tagName !== titulo.el.tagName) continue;
        if (Math.abs(u.tam - titulo.tam) > 0.5) continue;
        if (!u.texto || u.texto.length > 160) continue;
        var choca = false;
        for (var z = 0; z < partes.length; z++) {
          if (partes[z].el.contains(u.el) || u.el.contains(partes[z].el)) { choca = true; break; }
        }
        if (choca) continue;
        partes.push(u);
      }
      partes.sort(function (a, b) {
        var rel = a.el.compareDocumentPosition(b.el);
        return (rel & 4 /* DOCUMENT_POSITION_FOLLOWING */) ? -1 : 1;
      });
      partes = partes.slice(0, 3);
      for (var w = 0; w < partes.length; w++) {
        slots.push({
          slot: w === 0 ? 'titulo' : 'titulo' + (w + 1),
          el: partes[w].el, texto: partes[w].texto
        });
      }
    }

    if (titulo) {
      for (var s = 0; s < uteis.length; s++) {
        var c = uteis[s];
        if (c.tam >= titulo.tam * 0.75) continue;
        if (c.texto.length < 15 || c.texto.length > 300) continue;
        if (c.el === titulo.el || c.el.contains(titulo.el) || titulo.el.contains(c.el)) continue;
        slots.push({ slot: 'sub', el: c.el, texto: c.texto });
        break;
      }
    }

    var acoes = [];
    try {
      var botoes = hero.querySelectorAll('a, button');
      for (var b = 0; b < botoes.length && acoes.length < 2; b++) {
        var el2 = botoes[b];
        var tx = (el2.textContent || '').trim().replace(/\s+/g, ' ');
        if (tx.length < 2 || tx.length > 28) continue;
        if (!ehVisivel(el2)) continue;
        if (el2.closest && el2.closest('nav, header, [role="navigation"]')) continue;
        var conflita = slots.some(function (x) { return x.el === el2 || x.el.contains(el2) || el2.contains(x.el); });
        if (conflita) continue;
        acoes.push(el2);
        slots.push({ slot: 'acao' + acoes.length, el: el2, texto: tx });
      }
    } catch (e) {}

    return slots;
  }

  function capturarHero() {
    var el = acharHero();
    if (!el) return null;

    var slots = escolherSlots(el);
    var caminhos = [];
    for (var i = 0; i < slots.length; i++) {
      var p = caminhoAte(el, slots[i].el);
      if (p) caminhos.push({ slot: slots[i].slot, p: p, texto: slots[i].texto });
    }

    var html = serializar(el, MAX_HERO, function (clone) {
      for (var j = 0; j < caminhos.length; j++) {
        var alvo = resolverCaminho(clone, caminhos[j].p);
        if (alvo && alvo.setAttribute) alvo.setAttribute('data-xtr-slot', caminhos[j].slot);
      }
    });
    if (!html) return null;

    var textos = {};
    for (var k = 0; k < caminhos.length; k++) textos[caminhos[k].slot] = caminhos[k].texto;

    var info = pacote(el, html);
    info.slots = textos;
    return info;
  }

  /* -------------------------- os componentes ------------------------- */

  /** As duas fontes de cartao podem achar o mesmo elemento. */
  function semRepetidos(lista) {
    var vistos = {}, out = [];
    for (var i = 0; i < lista.length; i++) {
      var k = lista[i].tag + '|' + lista[i].classe;
      if (vistos[k]) continue;
      vistos[k] = 1;
      out.push(lista[i]);
    }
    return out;
  }

  function assinatura(el) {
    return el.tagName.toLowerCase() + '|' + classeDe(el).split(/\s+/).sort().join(' ');
  }

  function coletarGrupo(seletor, limite, filtro, enriquecer) {
    var vistos = {}, escolhidos = [], els;
    try { els = document.querySelectorAll(seletor); } catch (e) { return []; }

    for (var i = 0; i < els.length && escolhidos.length < limite; i++) {
      var el = els[i];
      if (!ehVisivel(el)) continue;
      if (filtro && !filtro(el)) continue;
      var chave = assinatura(el);
      if (vistos[chave]) continue;

      var aninhado = false;
      for (var j = 0; j < escolhidos.length; j++) {
        if (escolhidos[j].el.contains(el) || el.contains(escolhidos[j].el)) { aninhado = true; break; }
      }
      if (aninhado) continue;

      var html = serializar(el, MAX_FRAGMENTO);
      if (!html) continue;
      vistos[chave] = 1;
      escolhidos.push({ el: el, html: html });
    }

    return escolhidos.map(function (x) {
      var d = pacote(x.el, x.html);
      if (typeof enriquecer === 'function') { try { enriquecer(x.el, d); } catch (e) {} }
      return d;
    });
  }

  /** Estruturas que se repetem: o irmao que aparece tres vezes e um padrao. */
  function coletarRepetidos(limite) {
    var vistos = {}, escolhidos = [], pais;
    try { pais = document.querySelectorAll('body *'); } catch (e) { return []; }

    for (var i = 0; i < pais.length && i < 8000 && escolhidos.length < limite; i++) {
      var p = pais[i], fs = p.children;
      if (!fs || fs.length < 3) continue;

      var contagem = {}, campeao = null;
      for (var j = 0; j < fs.length; j++) {
        var k = assinatura(fs[j]);
        contagem[k] = (contagem[k] || 0) + 1;
        if (!campeao && contagem[k] >= 3) campeao = k;
      }
      if (!campeao || vistos[campeao]) continue;

      var alvo = null;
      for (var m = 0; m < fs.length; m++) if (assinatura(fs[m]) === campeao) { alvo = fs[m]; break; }
      if (!alvo || !ehVisivel(alvo)) continue;

      var r = alvo.getBoundingClientRect();
      if (r.height < 56 || r.width < 56) continue;

      var texto = (alvo.textContent || '').trim();
      var midia = null;
      try { midia = alvo.querySelector('img,svg,video,picture,canvas'); } catch (e) {}
      if (texto.length < 8 && !midia) continue;     // spans de uma letra so nao sao padrao
      // Sem classe nao ha o que documentar: e estrutura de animacao (as dezenas
      // de <span> de um titulo quebrado letra a letra), nao um componente.
      if (!classeDe(alvo)) continue;

      var aninhado = false;
      for (var q = 0; q < escolhidos.length; q++) {
        if (escolhidos[q].el.contains(alvo) || alvo.contains(escolhidos[q].el)) { aninhado = true; break; }
      }
      if (aninhado) continue;

      var html = serializar(alvo, MAX_FRAGMENTO);
      if (!html) continue;
      vistos[campeao] = 1;
      escolhidos.push({ el: alvo, html: html, irmaos: contagem[campeao] });
    }

    return escolhidos.map(function (x) {
      var d = pacote(x.el, x.html);
      d.irmaos = x.irmaos;
      return d;
    });
  }

  /* ----------------------------- icones ------------------------------ */

  var MAX_ICONE = 88;      // acima disso e ilustracao, nao icone

  /**
   * Assinatura pela GEOMETRIA, nao pela classe.
   *
   * O mesmo icone aparece com classes diferentes em lugares diferentes — no
   * botao ele e .btn-icon, no menu e .nav-icon. O que nao muda e o desenho.
   * Sem isso a secao de icones sairia com a mesma seta sete vezes.
   */
  function assinaturaIcone(el) {
    var partes = [];
    try {
      partes.push((el.getAttribute('viewBox') || '').trim());
      var nos = el.querySelectorAll('path, circle, rect, line, polyline, polygon, ellipse, use');
      for (var i = 0; i < nos.length && i < 10; i++) {
        var n = nos[i];
        var chave = n.getAttribute('d') || n.getAttribute('points') || n.getAttribute('href') ||
          (n.getAttributeNS ? n.getAttributeNS('http://www.w3.org/1999/xlink', 'href') : '') ||
          [n.getAttribute('cx'), n.getAttribute('cy'), n.getAttribute('r'),
           n.getAttribute('x'), n.getAttribute('y'),
           n.getAttribute('width'), n.getAttribute('height')].join(',');
        partes.push(n.tagName.toLowerCase() + ':' + String(chave || '').slice(0, 160));
      }
      if (nos.length === 0) return null;                 // svg sem desenho
    } catch (e) { return null; }
    return partes.join('|');
  }

  function coletarIcones(limite) {
    var vistos = {}, out = [];

    function guardar(chave, fabricar) {
      if (!chave) return;
      if (vistos[chave]) { vistos[chave].n++; return; }
      if (out.length >= limite) return;
      var item = fabricar();
      if (!item) return;
      vistos[chave] = item;
      out.push(item);
    }

    // 1. SVG inline — o formato dominante hoje
    var svgs;
    try { svgs = document.querySelectorAll('svg'); } catch (e) { svgs = []; }
    for (var i = 0; i < svgs.length && i < 2000; i++) {
      (function (el) {
        var r;
        try { r = el.getBoundingClientRect(); } catch (e) { return; }
        if (r.width < 7 || r.height < 7) return;
        if (r.width > MAX_ICONE || r.height > MAX_ICONE) return;
        var razao = r.width / Math.max(1, r.height);
        if (razao < 0.3 || razao > 3.4) return;          // faixa, divisoria, grafico
        if (!ehVisivel(el)) return;
        guardar(assinaturaIcone(el), function () {
          var html = serializar(el, 9000);
          if (!html) return null;
          var cs = {};
          try { cs = getComputedStyle(el); } catch (e) {}
          return {
            tipo: 'svg', html: html, contexto: contextoDe(el),
            classe: classeDe(el).slice(0, 120),
            largura: Math.round(r.width), altura: Math.round(r.height),
            viewBox: el.getAttribute('viewBox') || '',
            traco: cs.strokeWidth || '', cor: cs.color || '',
            herdaCor: /currentcolor/i.test(html), n: 1
          };
        });
      })(svgs[i]);
    }

    // 2. imagem pequena apontando para .svg
    var imgs;
    try { imgs = document.querySelectorAll('img'); } catch (e) { imgs = []; }
    for (var j = 0; j < imgs.length && j < 800; j++) {
      (function (el) {
        var src = '';
        try { src = el.currentSrc || el.src || ''; } catch (e) {}
        if (!/\.svg(\?|#|$)/i.test(src)) return;
        var r;
        try { r = el.getBoundingClientRect(); } catch (e) { return; }
        if (r.width < 7 || r.width > MAX_ICONE || r.height > MAX_ICONE) return;
        if (!ehVisivel(el)) return;
        guardar('img|' + src, function () {
          var html = serializar(el, 3000);
          if (!html) return null;
          return {
            tipo: 'imagem', html: html, contexto: contextoDe(el),
            classe: classeDe(el).slice(0, 120),
            largura: Math.round(r.width), altura: Math.round(r.height),
            viewBox: '', traco: '', cor: '', herdaCor: false, n: 1
          };
        });
      })(imgs[j]);
    }

    // 3. fonte de icone: um unico glifo da area de uso privado
    var candidatos;
    try {
      candidatos = document.querySelectorAll('i, span, [class*="icon"], [class*="Icon"], [class*="material"]');
    } catch (e) { candidatos = []; }
    for (var k = 0; k < candidatos.length && k < 3000; k++) {
      (function (el) {
        var t = '';
        try { t = (el.textContent || '').trim(); } catch (e) {}
        if (t.length !== 1) return;
        var cp = t.charCodeAt(0);
        // Unicode Private Use Area: e ali que as fontes de icone guardam os glifos
        if (!(cp >= 0xE000 && cp <= 0xF8FF)) return;
        if (!ehVisivel(el)) return;
        var cs = {};
        try { cs = getComputedStyle(el); } catch (e) {}
        var r;
        try { r = el.getBoundingClientRect(); } catch (e) { return; }
        guardar('fonte|' + (cs.fontFamily || '') + '|' + cp, function () {
          var html = serializar(el, 2000);
          if (!html) return null;
          return {
            tipo: 'fonte', html: html, contexto: contextoDe(el),
            classe: classeDe(el).slice(0, 120),
            largura: Math.round(r.width), altura: Math.round(r.height),
            viewBox: '', traco: '', cor: cs.color || '',
            familia: (cs.fontFamily || '').split(',')[0].replace(/["']/g, ''),
            herdaCor: true, n: 1
          };
        });
      })(candidatos[k]);
    }

    out.sort(function (a, b) { return b.n - a.n; });
    return out;
  }

  /* -------------------------- layout e grade -------------------------- */

  /**
   * A estrutura invisivel: onde o conteudo para, quantas colunas ele usa, qual
   * o vao entre elas e quanto ar cada secao respira. E o que faz uma pagina
   * nova "parecer do mesmo site" mesmo com componentes diferentes.
   */
  function coletarLayout() {
    var containers = {}, colunas = {}, gaps = {}, modelos = {}, ritmo = {};
    var exemploGrade = null, porLargura = {};
    var vw = window.innerWidth || 1440, vh = window.innerHeight || 900;

    var todos;
    try { todos = document.querySelectorAll('body *'); } catch (e) { return null; }
    var passo = todos.length > 5000 ? Math.ceil(todos.length / 5000) : 1;

    for (var i = 0; i < todos.length; i += passo) {
      var el = todos[i], cs, r;
      try { cs = getComputedStyle(el); r = el.getBoundingClientRect(); } catch (e) { continue; }
      if (!cs || cs.display === 'none' || r.width < 40) continue;

      /*
       * Container e o que centraliza o conteudo da pagina, nao qualquer caixa
       * com max-width. Sem o teste de centralizacao, um painel de 720px numa
       * pagina de duas colunas ganha do container de verdade so por aparecer
       * mais vezes.
       */
      var mw = cs.maxWidth;
      var centrado = Math.abs(r.left - (vw - r.right)) <= 2;
      if (mw && mw !== 'none' && parseFloat(mw) > 320 && r.width > vw * 0.55 && centrado) {
        somar(containers, mw, 1);
        // O primeiro elemento com max-width raramente e O container do site —
        // costuma ser um wrapper de tela cheia. Guarda um exemplo por largura,
        // preferindo o que tem respiro lateral, e escolhe no fim pelo mais
        // usado.
        var atual = porLargura[mw];
        if (!atual || (parseFloat(atual.padEsquerda) === 0 && parseFloat(cs.paddingLeft) > 0)) {
          porLargura[mw] = {
            classe: classeDe(el).slice(0, 120),
            maxLargura: mw,
            padEsquerda: cs.paddingLeft, padDireita: cs.paddingRight,
            largura: Math.round(r.width),
            margem: Math.round(Math.max(0, r.left))
          };
        }
      }

      var ehGrade = cs.display === 'grid' || cs.display === 'inline-grid';
      if (ehGrade) {
        var tpl = (cs.gridTemplateColumns || '').trim();
        if (tpl && tpl !== 'none') {
          var n = tpl.split(/\s+/).length;
          if (n >= 1 && n <= 24) somar(colunas, String(n), 1);
          somar(modelos, tpl.length <= 140 ? tpl : n + ' colunas', 1);
          if (!exemploGrade && n >= 2 && r.width > vw * 0.4 && r.height > 80) {
            var html = serializar(el, MAX_FRAGMENTO);
            if (html) { exemploGrade = pacote(el, html); exemploGrade.modelo = tpl; exemploGrade.colunas = n; }
          }
        }
      }

      if (ehGrade || cs.display === 'flex' || cs.display === 'inline-flex') {
        var g = cs.gap || cs.columnGap;
        if (g && g !== 'normal' && g !== '0px') somar(gaps, g.split(' ')[0], 1);
      }

      // ar vertical das secoes grandes
      if (r.width > vw * 0.6 && r.height > 200) {
        if (cs.paddingTop && cs.paddingTop !== '0px') somar(ritmo, cs.paddingTop, 1);
        if (cs.paddingBottom && cs.paddingBottom !== '0px') somar(ritmo, cs.paddingBottom, 1);
      }
    }

    var maisUsada = null, pico = -1;
    for (var mwk in containers) {
      if (containers[mwk] > pico) { pico = containers[mwk]; maisUsada = mwk; }
    }

    return {
      viewport: { largura: vw, altura: vh },
      container: maisUsada ? porLargura[maisUsada] : null,
      containers: containers, colunas: colunas, gaps: gaps,
      modelos: modelos, ritmo: ritmo,
      exemploGrade: exemploGrade
    };
  }

  /* --------------------------- sliders -------------------------------- */

  var SEL_SLIDER = '.swiper, [class*="swiper-container"], .embla, [class*="embla__viewport"],' +
    ' .keen-slider, .glide, .flickity-enabled, .splide, [class*="slider"], [class*="Slider"],' +
    ' [class*="carousel"], [class*="Carousel"], [class*="marquee"], [class*="Marquee"],' +
    ' [data-slider], [data-carousel], [data-swiper]';

  /**
   * Esteira por COMPORTAMENTO. Detectar so pela classe erra sempre que o site
   * escreve o nome do proprio jeito — num dos sites testados a esteira se chama
   * ".mrquee-text", sem o "a". O que nao mente e a geometria: filhos iguais em
   * linha, somando mais largura do que o pai comporta.
   */
  function pareceEsteira(el, cs, r) {
    if (r.width < 240 || r.height < 48) return false;
    // Overlay decorativo — listras, ruido, gradiente — tambem tem filhos iguais
    // em linha. O que separa e ter conteudo: uma esteira carrega alguma coisa.
    var conteudo = false;
    try {
      conteudo = (el.textContent || '').trim().length >= 4 ||
        !!el.querySelector('img, svg, video, picture');
    } catch (e) {}
    if (!conteudo) return false;
    var emLinha = /flex|grid/.test(cs.display) || /auto|scroll|hidden/.test(cs.overflowX);
    if (!emLinha) return false;
    var filhos = el.children;
    if (!filhos || filhos.length < 2 || filhos.length > 60) return false;

    var soma = 0, iguais = 0, prim = null, soltos = 0;
    try {
      for (var i = 0; i < filhos.length; i++) {
        var fr = filhos[i].getBoundingClientRect();
        if (fr.height < 12) return false;
        soma += fr.width;
        var k = assinatura(filhos[i]);
        if (prim === null) prim = k;
        if (k === prim) iguais++;
        var fcs = null;
        try { fcs = getComputedStyle(filhos[i]); } catch (e2) {}
        if (fcs && /^(absolute|fixed)$/.test(fcs.position)) soltos++;
      }
    } catch (e) { return false; }
    /*
     * Esteira tem os itens EM FLUXO, um depois do outro. Quando quase todos os
     * filhos estao posicionados no absoluto, o que existe ali e um campo
     * decorativo — num dos sites testados, as fotos que flutuam pelo hero passavam nos
     * outros testes (mesma assinatura, largura somada maior que o pai, imagem
     * dentro) e entravam na pagina como se fossem um carrossel, num quadro
     * vazio de mil pixels.
     */
    if (soltos * 2 >= filhos.length) return false;
    return soma > r.width * 1.15 && iguais >= 2;
  }

  function bibliotecaDoSlider(el) {
    var c = (classeDe(el) + ' ' + (el.className && el.className.baseVal ? el.className.baseVal : '')).toLowerCase();
    try {
      for (var i = 0; i < el.attributes.length; i++) c += ' ' + el.attributes[i].name;
    } catch (e) {}
    if (/swiper/.test(c)) return 'Swiper';
    if (/embla/.test(c)) return 'Embla';
    if (/keen/.test(c)) return 'Keen Slider';
    if (/glide/.test(c)) return 'Glide';
    if (/flickity/.test(c)) return 'Flickity';
    if (/splide/.test(c)) return 'Splide';
    if (/marquee/.test(c)) return 'esteira própria';
    return 'próprio';
  }

  /* --------------------------- cartoes -------------------------------- */

  /**
   * Cartao nao e uma tag, e um arranjo: uma superficie com conteudo composto.
   * Detectar so por classe erra nos dois sentidos — um .card pode ser um
   * wrapper vazio, e um cartao de verdade pode se chamar .w-dyn-item.
   */
  /*
   * "item" solto casa com items-center do Tailwind, e ai o cabecalho do site
   * vira cartao. O nome so conta como palavra inteira, entre limites.
   */
  var NOME_DE_CARTAO = /(^|[-_ ])(card|tile|item|cell|panel|thumb|entry|post|product|project)([-_ ]|$)/i;

  function pareceCartao(el, cs, r) {
    var vw = window.innerWidth || 1440, vh = window.innerHeight || 900;
    if (r.width < 120 || r.height < 100) return false;

    var nomeDiz = NOME_DE_CARTAO.test(classeDe(el));

    // Uma faixa que ocupa a tela inteira e secao, nao cartao — a menos que o
    // proprio site a chame de cartao.
    if (!nomeDiz && (r.width > vw * 0.92 || r.height > vh * 1.2)) return false;

    /*
     * Superficie e o que DESTACA do que esta atras. Aceitar qualquer
     * background-color faz todo <div> herdar a condicao de cartao; o que
     * importa e ser diferente do pai.
     */
    var fundo = normalizarCor(cs.backgroundColor);
    var fundoPai = null;
    try {
      if (el.parentElement) fundoPai = normalizarCor(getComputedStyle(el.parentElement).backgroundColor);
    } catch (e) {}
    var pinturaDeTexto = /text/i.test(cs.webkitBackgroundClip || cs.backgroundClip || '');
    var destaca = (fundo && (!fundoPai || fundo.hex !== fundoPai.hex)) ||
      (!pinturaDeTexto && /gradient|url\(/i.test(cs.backgroundImage || '')) ||
      parseFloat(cs.borderTopWidth) > 0 ||
      (cs.boxShadow && cs.boxShadow !== 'none');
    if (!destaca && !nomeDiz) return false;

    var texto = '', midia = null, titulo = null;
    try {
      texto = (el.textContent || '').trim();
      midia = el.querySelector('img, svg, video, picture, canvas');
      titulo = el.querySelector('h1,h2,h3,h4,h5,h6,[class*="title"],[class*="heading"],[class*="Title"]');
    } catch (e) {}
    if (!((midia && texto.length >= 4) || (titulo && texto.length >= 20))) return false;

    // Uma LISTA de cartoes nao e um cartao. Se dois filhos ja tem a mesma
    // composicao — midia ou titulo mais texto — o cartao esta dentro, nao aqui.
    var compostos = 0;
    try {
      for (var i = 0; i < el.children.length && compostos < 2; i++) {
        var f = el.children[i];
        if ((f.textContent || '').trim().length >= 8 &&
            f.querySelector('img,svg,video,picture,canvas,h1,h2,h3,h4,h5,h6')) compostos++;
      }
    } catch (e) {}
    return compostos < 2;
  }

  /* ------------------------ folhas e scripts ------------------------- */

  function coletarFolhas() {
    var out = [], total = 0;
    var nos;
    try { nos = document.querySelectorAll('link[rel~="stylesheet"], style'); } catch (e) { return out; }

    for (var i = 0; i < nos.length; i++) {
      var el = nos[i];
      if (el.tagName === 'LINK') {
        var href = absDoc(el.getAttribute('href'));
        if (!href) continue;
        out.push({ tipo: 'link', href: href, media: el.getAttribute('media') || '' });
        continue;
      }
      // <style> de CSS-in-JS costuma vir vazio: as regras foram inseridas por
      // insertRule e so existem no CSSOM.
      var css = '';
      try { css = el.textContent || ''; } catch (e) {}
      if (!css.trim()) {
        try {
          var regras = el.sheet && el.sheet.cssRules;
          if (regras) {
            var buf = [];
            for (var r = 0; r < regras.length; r++) buf.push(regras[r].cssText);
            css = buf.join('\n');
          }
        } catch (e) { css = ''; }
      }
      if (!css.trim()) continue;
      if (total + css.length > MAX_CSS_EMBUTIDO) continue;
      total += css.length;
      out.push({ tipo: 'inline', css: css });
    }
    return out;
  }

  function coletarScripts() {
    var out = [];
    try {
      var els = document.querySelectorAll('script[src]');
      for (var i = 0; i < els.length && out.length < 12; i++) {
        var src = absDoc(els[i].getAttribute('src'));
        if (!src || JS_PROIBIDO.test(src)) continue;
        var arquivo = '';
        try { arquivo = new URL(src).pathname.split('/').pop() || ''; } catch (e) { arquivo = ''; }
        if (!JS_SEGURO.test(arquivo)) continue;
        out.push({ src: src, tipo: els[i].getAttribute('type') || '' });
      }
    } catch (e) {}
    return out;
  }

  function coletarPadroes() {
    var docEl = document.documentElement, body = document.body;
    var atributos = {};
    try {
      for (var i = 0; i < docEl.attributes.length; i++) {
        var at = docEl.attributes[i];
        if (at.name === 'class') continue;
        if (/^(data-|lang$|dir$)/.test(at.name)) atributos[at.name] = at.value.slice(0, 120);
      }
    } catch (e) {}

    var atributosBody = {};
    try {
      for (var j = 0; j < body.attributes.length; j++) {
        var ab = body.attributes[j];
        if (ab.name === 'class' || ab.name === 'style') continue;
        if (/^data-/.test(ab.name)) atributosBody[ab.name] = ab.value.slice(0, 120);
      }
    } catch (e) {}

    return {
      documento: {
        lang: docEl.getAttribute('lang') || '',
        htmlClasse: classeDe(docEl).slice(0, 300),
        htmlAtributos: atributos,
        bodyClasse: classeDe(body).slice(0, 300),
        bodyAtributos: atributosBody,
        bodyEstilo: (body.getAttribute('style') || '').slice(0, 300),
        titulo: document.title || '',
        largura: window.innerWidth,
        altura: window.innerHeight
      },
      folhas: coletarFolhas(),
      scripts: coletarScripts(),
      hero: capturarHero(),
      componentes: {
        navegacao: coletarGrupo('header, nav, [role="banner"], [role="navigation"]', 2),
        botoes: coletarGrupo(
          'button, a[class*="btn"], a[class*="button"], a[class*="cta"], [role="button"],' +
          ' input[type="submit"], input[type="button"], [class*="Button"]', 10),
        links: coletarGrupo('p a, li a, article a, main a[href]:not([class*="btn"]):not([class*="button"])', 6),
        campos: coletarGrupo(
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select', 8),
        formularios: coletarGrupo('form', 2),
        listas: coletarGrupo('ul, ol', 4, function (el) {
          try { return el.querySelectorAll(':scope > li').length >= 2; } catch (e) { return false; }
        }),
        tabelas: coletarGrupo('table', 2),
        citacoes: coletarGrupo('blockquote, figcaption', 3),
        midia: coletarGrupo('figure, picture, video, img[class], svg[class]', 6, function (el) {
          try {
            var r = el.getBoundingClientRect();
            return r.width >= 24 && r.height >= 24;
          } catch (e) { return false; }
        }),
        // Duas fontes se completam: o arranjo (superficie + conteudo composto)
        // e a repeticao (o irmao que aparece tres vezes). Uma pega o cartao
        // solto, a outra pega a grade de itens sem classe descritiva.
        cartoes: semRepetidos(coletarGrupo('*', 8, function (el) {
          var cs, r;
          try { cs = getComputedStyle(el); r = el.getBoundingClientRect(); } catch (e) { return false; }
          return pareceCartao(el, cs, r);
        })),
        repetidos: coletarRepetidos(6),
        sliders: semRepetidos(
          coletarGrupo(SEL_SLIDER, 4, function (el) {
            try {
              var r = el.getBoundingClientRect();
              return r.width > 200 && r.height > 60 && el.children.length >= 2;
            } catch (e) { return false; }
          }, function (el, d) { d.biblioteca = bibliotecaDoSlider(el); })
          .concat(coletarGrupo('*', 4, function (el) {
            var cs, r;
            try { cs = getComputedStyle(el); r = el.getBoundingClientRect(); } catch (e) { return false; }
            return pareceEsteira(el, cs, r);
          }, function (el, d) { d.biblioteca = bibliotecaDoSlider(el); }))
        ),
        rodape: coletarGrupo('footer, [role="contentinfo"]', 1)
      },
      icones: coletarIcones(48),
      layout: coletarLayout()
    };
  }

  /* ------------------------------------------------------------------ *
   * Protocolo de mensagens                                               *
   * ------------------------------------------------------------------ */
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.ns !== 'xtr') return false;

    (async function () {
      try {
        if (msg.type === 'ping') {
          return sendResponse({ ok: true, url: location.href, title: document.title, ready: document.readyState });
        }

        if (msg.type === 'autoscroll') {
          var rolagem = await autoscroll(msg.opts || {});
          if (msg.opts && msg.opts.hover) {
            await hoverSweep(msg.opts.hoverLimit);
            // o hover tambem pede rede; deixa assentar antes de coletar
            await repousar(Math.min(msg.opts.repousoMs || 45000, 15000), msg.opts.repousoQuietoMs);
          }
          return sendResponse({ ok: true, repouso: (rolagem && rolagem.repouso) || 0 });
        }

        if (msg.type === 'design') {
          var resposta = {
            ok: true,
            url: location.href,
            largura: window.innerWidth,
            tokens: coletarTokens(),
            cssom: coletarCssom()
          };
          // So a pagina de referencia entrega os fragmentos: a biblioteca viva
          // documenta UM site, e somar heros de varias paginas so faria ruido.
          if (msg.padroes) {
            await assentarNoTopo();
            try { resposta.padroes = coletarPadroes(); }
            catch (e) { resposta.padroesErro = String(e && e.message || e); }
          }
          return sendResponse(resposta);
        }

        if (msg.type === 'collect') {
          var dom = scanDom();
          var main = await pullFromMain();
          var html = '';
          try {
            html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
          } catch (e) { html = ''; }
          return sendResponse({
            ok: true,
            url: location.href,
            baseURI: document.baseURI,
            title: document.title || '',
            charset: document.characterSet || 'UTF-8',
            domUrls: dom.found,
            links: dom.links,
            runtimeUrls: main.urls || [],
            workers: main.workers || [],
            bodies: main.bodies || [],
            libs: main.libs || [],
            hooksMissing: !!main.missing,
            snapshot: html,
            height: docHeight()
          });
        }

        sendResponse({ ok: false, error: 'tipo desconhecido: ' + msg.type });
      } catch (err) {
        sendResponse({ ok: false, error: String(err && err.stack || err) });
      }
    })();

    return true; // resposta assincrona
  });
})();
