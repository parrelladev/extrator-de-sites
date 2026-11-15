/*
 * design-tokens.js — le da pagina viva os valores que o site realmente usa:
 * cores, tipografia, espacamentos, variaveis e breakpoints.
 *
 * Ver scan.js para como os arquivos de content/ se enxergam.
 */
(function () {
  'use strict';
  var XTR = window.__XTR__ || (window.__XTR__ = {});
  if (XTR.coletarTokens) return;

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

  /* Apoio que design-patterns.js tambem usa. */

  function classeDe(el) {
    try { return (el.getAttribute('class') || '').trim(); } catch (e) { return ''; }
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

  function assinatura(el) {
    return el.tagName.toLowerCase() + '|' + classeDe(el).split(/\s+/).sort().join(' ');
  }

  XTR.normalizarCor = normalizarCor;
  XTR.somar = somar;
  XTR.classeDe = classeDe;
  XTR.contextoDe = contextoDe;
  XTR.assinatura = assinatura;
  XTR.coletarTokens = coletarTokens;
  XTR.coletarCssom = coletarCssom;
})();
