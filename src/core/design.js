/*
 * design.js — extração do design system do site capturado.
 *
 * Duas leituras se completam:
 *
 *   1. Runtime (vem do bridge.js): computed styles das páginas visitadas. Diz o
 *      que o site REALMENTE usa — variáveis resolvidas, cascata aplicada, media
 *      query da viewport valendo. É a fonte da verdade sobre o que se vê.
 *
 *   2. Estática (aqui): varre todo o CSS baixado. Pega o que foi DECLARADO,
 *      inclusive tokens que não aparecem na home — a paleta inteira, e não só o
 *      pedaço que a primeira página usa.
 *
 * O peso de cada valor é a área que ele ocupa na tela, não a contagem de
 * elementos: um fundo de seção define a identidade do site muito mais do que
 * trinta bordas de 1px.
 */

/* ─────────────────────────── cor: utilidades ─────────────────────────── */

export function hexParaRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function luminancia(hex) {
  const c = hexParaRgb(hex);
  if (!c) return 0;
  const f = [c.r, c.g, c.b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}

export function contraste(a, b) {
  const la = luminancia(a), lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function paraHsl(hex) {
  const c = hexParaRgb(hex);
  if (!c) return { h: 0, s: 0, l: 0 };
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/* ────────────────────────── apoio de contagem ────────────────────────── */

function somarMapas(destino, origem) {
  for (const [k, v] of Object.entries(origem || {})) {
    destino[k] = (destino[k] || 0) + v;
  }
  return destino;
}

function ordenar(mapa, limite = 30) {
  return Object.entries(mapa || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limite)
    .map(([valor, peso]) => ({ valor, peso: Math.round(peso * 10) / 10 }));
}

function px(v) {
  const m = /^(-?[\d.]+)px$/.exec(String(v).trim());
  return m ? parseFloat(m[1]) : null;
}

/* ───────────────────────── mescla das páginas ────────────────────────── */

/** Junta as coletas de runtime de todas as páginas visitadas. */
export function mesclarColetas(coletas) {
  const soma = {
    cores: {}, corTexto: {}, corFundo: {}, corBorda: {},
    familias: {}, tamanhos: {}, pesos: {}, alturas: {}, espacamentoLetra: {},
    raios: {}, sombras: {}, gradientes: {}, espacos: {}, duracoes: {}, curvas: {},
    transicoes: {}, animacoes: {}
  };
  const estilosTexto = {};
  const variaveis = {}, breakpoints = {}, keyframes = {}, fontFaces = [];
  let lidos = 0, totais = 0;
  let ancoras = {};

  for (const c of coletas) {
    if (!c) continue;
    const t = c.tokens || {};
    if (t.ancoras && t.ancoras.fundo && !ancoras.fundo) ancoras = t.ancoras;
    for (const chave of Object.keys(soma)) somarMapas(soma[chave], t[chave]);
    lidos += t.elementosLidos || 0;
    totais += t.elementosTotais || 0;

    for (const [k, v] of Object.entries(t.estilosTexto || {})) {
      if (!estilosTexto[k]) estilosTexto[k] = { ...v };
      else {
        estilosTexto[k].n += v.n;
        if (!estilosTexto[k].amostra) estilosTexto[k].amostra = v.amostra;
      }
    }

    const cs = c.cssom || {};
    for (const [k, v] of Object.entries(cs.variaveis || {})) if (!variaveis[k]) variaveis[k] = v;
    somarMapas(breakpoints, cs.breakpoints);
    somarMapas(keyframes, cs.keyframes);
    for (const f of cs.fontFaces || []) {
      if (!fontFaces.some((x) => x.familia === f.familia && x.peso === f.peso && x.estilo === f.estilo)) {
        fontFaces.push(f);
      }
    }
  }

  return { ...soma, ancoras, estilosTexto, variaveis, breakpoints, keyframes, fontFaces, lidos, totais };
}

/* ──────────────────── leitura estática do CSS baixado ────────────────── */

const RE_VAR = /(--[\w-]+)\s*:\s*([^;{}]+)[;}]/g;
const RE_MEDIA = /@media\s+([^{]+)\{/g;
const RE_KEYFRAMES = /@keyframes\s+([\w-]+)/g;
const RE_FONTFACE = /@font-face\s*\{([^}]+)\}/g;
const RE_HEX = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;

/**
 * Varre os CSS baixados atrás do que foi declarado mas talvez não usado na
 * página inicial — o resto da paleta, breakpoints, animações.
 * @param {{localPath:string,text:string}[]} arquivos
 */
export function analisarCssBaixado(arquivos) {
  const variaveis = {}, breakpoints = {}, keyframes = {}, hexDeclarados = {};
  const fontFaces = [];
  let bytes = 0;

  for (const a of arquivos) {
    const t = a.text || '';
    bytes += t.length;
    let m;

    RE_VAR.lastIndex = 0;
    while ((m = RE_VAR.exec(t)) !== null) {
      const nome = m[1], valor = m[2].trim();
      if (!variaveis[nome] && valor && valor.length < 200) {
        variaveis[nome] = { valor, arquivo: a.localPath };
      }
    }

    RE_MEDIA.lastIndex = 0;
    while ((m = RE_MEDIA.exec(t)) !== null) {
      const cond = m[1].trim();
      if (/\d/.test(cond) && cond.length < 120) breakpoints[cond] = (breakpoints[cond] || 0) + 1;
    }

    RE_KEYFRAMES.lastIndex = 0;
    while ((m = RE_KEYFRAMES.exec(t)) !== null) keyframes[m[1]] = (keyframes[m[1]] || 0) + 1;

    RE_HEX.lastIndex = 0;
    while ((m = RE_HEX.exec(t)) !== null) {
      let h = m[1].toLowerCase();
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      hexDeclarados['#' + h] = (hexDeclarados['#' + h] || 0) + 1;
    }

    RE_FONTFACE.lastIndex = 0;
    while ((m = RE_FONTFACE.exec(t)) !== null) {
      const bloco = m[1];
      const pega = (p) => {
        const r = new RegExp(p + '\\s*:\\s*([^;]+)').exec(bloco);
        return r ? r[1].trim().replace(/["']/g, '') : '';
      };
      const familia = pega('font-family');
      if (familia && !fontFaces.some((x) => x.familia === familia && x.peso === pega('font-weight'))) {
        fontFaces.push({
          familia, peso: pega('font-weight'), estilo: pega('font-style'),
          display: pega('font-display'), arquivo: a.localPath
        });
      }
    }
  }

  return { variaveis, breakpoints, keyframes, hexDeclarados, fontFaces, arquivos: arquivos.length, bytes };
}

/* ─────────────────────────── consolidação ────────────────────────────── */

/** Classifica uma cor pelo papel que ela cumpre na página. */
function papelDaCor(hex, fundo, texto, borda) {
  const pf = fundo[hex] || 0, pt = texto[hex] || 0, pb = borda[hex] || 0;
  const hsl = paraHsl(hex);
  if (pt > pf && pt > pb) return 'texto';
  if (pb > pf && pb > pt) return 'borda';
  if (hsl.s >= 35 && hsl.l > 12 && hsl.l < 92) return 'acento';
  return 'fundo';
}

function nomearEscalaTexto(tamanhoPx) {
  if (tamanhoPx >= 48) return 'Display';
  if (tamanhoPx >= 32) return 'Título 1';
  if (tamanhoPx >= 24) return 'Título 2';
  if (tamanhoPx >= 19) return 'Título 3';
  if (tamanhoPx >= 15) return 'Corpo';
  if (tamanhoPx >= 13) return 'Corpo pequeno';
  return 'Legenda';
}

/** Deduz o passo da escala de espaçamento (4px, 8px…). */
function passoDaEscala(valores) {
  const nums = valores.map((v) => px(v.valor)).filter((n) => n && n > 0 && n <= 200);
  if (nums.length < 4) return null;
  for (const base of [8, 4, 6, 5, 10, 3]) {
    const encaixam = nums.filter((n) => Math.abs(n % base) < 0.51 || Math.abs((n % base) - base) < 0.51);
    if (encaixam.length / nums.length >= 0.7) return base;
  }
  return null;
}

/**
 * @param {object} o
 * @param {object} o.runtime  resultado de mesclarColetas
 * @param {object} o.estatico resultado de analisarCssBaixado
 * @param {{familia:string,caminho:string}[]} o.fontesLocais
 */
export function construirDesignSystem({ runtime, estatico, fontesLocais = [], origem, paginas = [], geradoEm }) {
  const coresOrdenadas = ordenar(runtime.cores, 40);

  const cores = coresOrdenadas.map(({ valor, peso }) => {
    const hsl = paraHsl(valor);
    return {
      hex: valor, peso, hsl,
      papel: papelDaCor(valor, runtime.corFundo, runtime.corTexto, runtime.corBorda),
      luminancia: Math.round(luminancia(valor) * 1000) / 1000
    };
  });

  /*
   * O fundo do <body> vale mais que qualquer estatistica: e a decisao que o
   * autor do site tomou. Estatistica sozinha se deixa enganar por um overlay
   * grande, e ai um site escuro passa por claro.
   */
  const anc = runtime.ancoras || {};
  const fundoPrincipal = anc.fundo ||
    (cores.find((c) => c.papel === 'fundo') || cores[0] || { hex: '#ffffff' }).hex;

  // o texto principal e o mais usado que ainda da para ler sobre esse fundo
  const candidatosTexto = cores
    .filter((c) => c.papel === 'texto' && contraste(c.hex, fundoPrincipal) >= 3)
    .sort((a, b) => b.peso - a.peso);
  const textoPrincipal = (candidatosTexto[0] || { hex: anc.texto || '#000000' }).hex;
  const escuro = luminancia(fundoPrincipal) < 0.2;

  // contraste de cada cor contra o fundo principal — util para saber o que se
  // pode usar como texto sem reprovar em acessibilidade
  for (const c of cores) {
    c.contrasteNoFundo = Math.round(contraste(c.hex, fundoPrincipal) * 100) / 100;
  }

  const estilos = Object.values(runtime.estilosTexto || {})
    .filter((e) => e.n >= 1 && px(e.tamanho))
    .sort((a, b) => (px(b.tamanho) || 0) - (px(a.tamanho) || 0))
    .slice(0, 18)
    .map((e) => ({ ...e, escala: nomearEscalaTexto(px(e.tamanho) || 0) }));

  const espacos = ordenar(runtime.espacos, 24)
    .filter((s) => px(s.valor) !== null && px(s.valor) > 0)
    .sort((a, b) => px(a.valor) - px(b.valor));

  const familias = ordenar(runtime.familias, 8).map((f) => ({
    ...f,
    primeira: f.valor.split(',')[0].replace(/["']/g, '').trim()
  }));

  // variáveis: as do CSS baixado cobrem mais do que as vistas na home
  const variaveis = { ...estatico.variaveis };
  for (const [k, v] of Object.entries(runtime.variaveis || {})) {
    variaveis[k] = { valor: v.valor, seletor: v.seletor, resolvida: true };
  }

  const breakpoints = Object.entries({ ...estatico.breakpoints })
    .map(([cond, n]) => {
      const m = /(\d+(?:\.\d+)?)px/.exec(cond);
      return { condicao: cond, px: m ? parseFloat(m[1]) : null, ocorrencias: n };
    })
    .filter((b) => b.px)
    .sort((a, b) => a.px - b.px);

  const bpUnicos = [];
  for (const b of breakpoints) {
    if (!bpUnicos.some((x) => x.px === b.px)) bpUnicos.push(b);
  }

  return {
    origem, geradoEm, paginas,
    resumo: {
      tema: escuro ? 'escuro' : 'claro',
      fundoPrincipal, textoPrincipal,
      fundoAncorado: !!anc.fundo,
      contrastePrincipal: Math.round(contraste(fundoPrincipal, textoPrincipal) * 100) / 100,
      elementosAnalisados: runtime.lidos,
      elementosNaPagina: runtime.totais,
      arquivosCss: estatico.arquivos,
      passoDeEspacamento: passoDaEscala(espacos)
    },
    cores,
    tipografia: {
      familias,
      estilos,
      tamanhos: ordenar(runtime.tamanhos, 16).filter((t) => px(t.valor)),
      pesos: ordenar(runtime.pesos, 10),
      alturas: ordenar(runtime.alturas, 10),
      espacamentoLetra: ordenar(runtime.espacamentoLetra, 8),
      fontesLocais,
      fontFaces: [...(runtime.fontFaces || []), ...(estatico.fontFaces || [])].slice(0, 40)
    },
    espacamento: espacos,
    raios: ordenar(runtime.raios, 12),
    sombras: ordenar(runtime.sombras, 10),
    gradientes: ordenar(runtime.gradientes, 8),
    movimento: {
      duracoes: ordenar(runtime.duracoes, 10),
      curvas: ordenar(runtime.curvas, 10),
      // A receita inteira: o que transiciona, em quanto tempo, com que curva.
      transicoes: ordenar(runtime.transicoes, 14),
      animacoes: ordenar(runtime.animacoes, 14),
      keyframes: Object.keys({ ...estatico.keyframes, ...runtime.keyframes }).slice(0, 60)
    },
    breakpoints: bpUnicos,
    variaveis
  };
}

/* ───────────────────────────── saída: CSS ────────────────────────────── */

/*
 * Um valor com parenteses abertos e sem fechar arrasta a declaracao seguinte
 * para dentro dele e o resto do arquivo vira lixo silencioso. Melhor perder um
 * token do que entregar um tokens.css que nao parseia.
 */
function cssBalanceado(v) {
  const s = String(v || '');
  let n = 0;
  for (const c of s) {
    if (c === '(') n++;
    else if (c === ')') n--;
    if (n < 0) return false;
  }
  return n === 0 && !s.includes(';') && !s.includes('}');
}

export function gerarTokensCss(ds) {
  const L = [];
  L.push('/*');
  L.push(' * Tokens extraídos de ' + ds.origem);
  L.push(' * Gerado pelo Extrator de Sites em ' + ds.geradoEm);
  L.push(' *');
  L.push(' * Os nomes são nossos: o site original não os expõe. A ordem segue o');
  L.push(' * peso visual de cada valor, ou seja, quanto de tela ele ocupa.');
  L.push(' */');
  L.push('');
  L.push(':root {');

  const grupos = [['fundo', 'fundo'], ['texto', 'texto'], ['acento', 'acento'], ['borda', 'borda']];
  for (const [papel, prefixo] of grupos) {
    let doGrupo = ds.cores.filter((c) => c.papel === papel);
    // --ds-fundo-1 tem que ser a cor base do site, e nao a de maior area: quem
    // cola estes tokens espera que o primeiro seja o fundo principal.
    if (papel === 'fundo') {
      doGrupo = [...doGrupo].sort((a, b) =>
        (b.hex === ds.resumo.fundoPrincipal) - (a.hex === ds.resumo.fundoPrincipal));
    }
    doGrupo = doGrupo.slice(0, 8);
    if (!doGrupo.length) continue;
    L.push(`  /* ${papel} */`);
    doGrupo.forEach((c, i) => L.push(`  --ds-${prefixo}-${i + 1}: ${c.hex};`));
    L.push('');
  }

  if (ds.tipografia.familias.length) {
    L.push('  /* tipografia */');
    ds.tipografia.familias.slice(0, 4).forEach((f, i) => {
      L.push(`  --ds-fonte-${i + 1}: ${f.valor};`);
    });
    // "--ds-texto-N" ja e a cor do texto; tamanho precisa de nome proprio,
    // senao a segunda declaracao sobrescreve a primeira em silencio.
    ds.tipografia.tamanhos.slice(0, 10).forEach((t, i) => {
      L.push(`  --ds-tamanho-${i + 1}: ${t.valor};`);
    });
    L.push('');
  }

  if (ds.espacamento.length) {
    L.push('  /* espaçamento */');
    ds.espacamento.slice(0, 12).forEach((s, i) => L.push(`  --ds-espaco-${i + 1}: ${s.valor};`));
    L.push('');
  }

  if (ds.raios.length) {
    L.push('  /* raios */');
    ds.raios.slice(0, 6).forEach((r, i) => L.push(`  --ds-raio-${i + 1}: ${r.valor};`));
    L.push('');
  }

  if (ds.sombras.length) {
    L.push('  /* sombras */');
    ds.sombras.filter((s) => cssBalanceado(s.valor)).slice(0, 5)
      .forEach((s, i) => L.push(`  --ds-sombra-${i + 1}: ${s.valor};`));
    L.push('');
  }

  if (ds.movimento.duracoes.length) {
    L.push('  /* movimento */');
    ds.movimento.duracoes.filter((d) => cssBalanceado(d.valor)).slice(0, 5)
      .forEach((d, i) => L.push(`  --ds-duracao-${i + 1}: ${d.valor};`));
    ds.movimento.curvas.filter((c) => cssBalanceado(c.valor)).slice(0, 5)
      .forEach((c, i) => L.push(`  --ds-curva-${i + 1}: ${c.valor};`));
    L.push('');
  }
  L.push('}');
  L.push('');

  const proprias = Object.entries(ds.variaveis).slice(0, 300);
  if (proprias.length) {
    L.push('/* ------------------------------------------------------------------ */');
    L.push('/* Custom properties declaradas pelo próprio site. Os nomes aqui são   */');
    L.push('/* dele, não nossos. Costumam ser o design system real do projeto.     */');
    L.push('/* ------------------------------------------------------------------ */');
    L.push('');
    L.push(':root {');
    for (const [nome, info] of proprias) {
      if (cssBalanceado(info.valor)) L.push(`  ${nome}: ${info.valor};`);
    }
    L.push('}');
  }

  if (ds.breakpoints.length) {
    L.push('');
    L.push('/* breakpoints encontrados */');
    for (const b of ds.breakpoints) L.push(`/* @media ${b.condicao}  (${b.ocorrencias}x) */`);
  }

  return L.join('\n') + '\n';
}

/* ─────────────────── fontes: família → arquivo no disco ──────────────── */

const RE_SRC_URL = /url\(\s*(['"]?)([^)'"]+)\1\s*\)(?:\s*format\(\s*(['"]?)([^)'"]+)\3\s*\))?/gi;

/**
 * Casa cada @font-face com os arquivos de fonte que a captura trouxe.
 *
 * Sem isso a página do design system mostraria as amostras numa fonte
 * substituta, e a tipografia — que é metade da identidade de um site — ficaria
 * irreconhecível. Como resolvemos contra a URL do próprio CSS, funciona mesmo
 * quando o @font-face usa caminho relativo.
 *
 * @param {{url:string,text:string}[]} arquivosCss  texto ORIGINAL das folhas
 * @param {(absUrl:string)=>string|null} resolver   URL absoluta -> caminho local
 */
export function extrairFontesLocais(arquivosCss, resolver) {
  const achadas = [];

  for (const a of arquivosCss) {
    const texto = a.text || '';
    RE_FONTFACE.lastIndex = 0;
    let bloco;
    while ((bloco = RE_FONTFACE.exec(texto)) !== null) {
      const corpo = bloco[1];
      const campo = (nome) => {
        const m = new RegExp(nome + '\\s*:\\s*([^;]+)').exec(corpo);
        return m ? m[1].trim().replace(/["']/g, '') : '';
      };
      const familia = campo('font-family');
      if (!familia) continue;

      const caminhos = [];
      RE_SRC_URL.lastIndex = 0;
      let u;
      while ((u = RE_SRC_URL.exec(corpo)) !== null) {
        const bruto = u[2].trim();
        if (!bruto || /^data:/i.test(bruto)) continue;
        let abs;
        try { abs = new URL(bruto, a.url).href.split('#')[0]; } catch { continue; }
        const local = resolver(abs);
        if (!local) continue;
        const fmt = (u[4] || '').toLowerCase() ||
          (/\.woff2$/i.test(local) ? 'woff2' : /\.woff$/i.test(local) ? 'woff' :
           /\.otf$/i.test(local) ? 'opentype' : 'truetype');
        // Caminho local puro: a folha neutra mora em design-system/ e a viva na
        // raiz, entao o prefixo e decidido por quem monta a pagina.
        caminhos.push({ caminho: local, formato: fmt });
      }
      if (!caminhos.length) continue;

      const peso = campo('font-weight');
      const estilo = campo('font-style');
      const jaTem = achadas.some((f) => f.familia === familia && f.peso === peso && f.estilo === estilo);
      if (!jaTem) achadas.push({ familia, peso, estilo, caminhos });
    }
  }
  return achadas.slice(0, 60);
}
