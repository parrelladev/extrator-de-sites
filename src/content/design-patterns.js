/*
 * design-patterns.js — captura pedacos reais da pagina (hero, componentes,
 * icones, layout) para a pagina de design system.
 *
 * Ver scan.js para como os arquivos de content/ se enxergam.
 */
(function () {
  'use strict';
  var XTR = window.__XTR__ || (window.__XTR__ = {});
  if (XTR.coletarPadroes) return;

  var normalizarCor = XTR.normalizarCor;
  var somar = XTR.somar;
  var classeDe = XTR.classeDe;
  var contextoDe = XTR.contextoDe;
  var assinatura = XTR.assinatura;

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

  function juntarClasse(el, extra) {
    // className nao serve: em SVG ele e um SVGAnimatedString e a atribuicao falha.
    try {
      var atual = el.getAttribute('class') || '';
      el.setAttribute('class', (atual + ' ' + extra).trim());
    } catch (e) {}
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

  XTR.assentarNoTopo = assentarNoTopo;
  XTR.coletarPadroes = coletarPadroes;
})();
