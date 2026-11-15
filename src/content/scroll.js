/*
 * scroll.js — dirige a pagina (auto-scroll, hover e repouso) para forcar
 * lazy-load e animacoes de rolagem antes da coleta.
 *
 * Ver scan.js para como os arquivos de content/ se enxergam.
 */
(function () {
  'use strict';
  var XTR = window.__XTR__ || (window.__XTR__ = {});
  if (XTR.autoscroll) return;

  var sleep = XTR.sleep;

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

  XTR.docHeight = docHeight;
  XTR.repousar = repousar;
  XTR.autoscroll = autoscroll;
  XTR.hoverSweep = hoverSweep;
})();
