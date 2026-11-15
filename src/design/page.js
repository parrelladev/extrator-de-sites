/*
 * page.js — a pagina do design system: uma biblioteca viva.
 *
 * Em vez de documentar o site com uma linguagem visual nossa, este arquivo
 * monta o design system COM O CSS DO PROPRIO SITE, reaproveitando as classes, os keyframes, as transicoes e os fragmentos de
 * HTML que a pagina original usa.
 *
 * Regras que a geracao respeita, e o porque de cada uma:
 *
 *   - nada de estilo inventado. Todo exemplo e markup capturado da pagina viva,
 *     com as classes originais; o CSS que o pinta e o CSS do site;
 *   - cada exemplo carrega a cadeia de ancestrais em que vivia, senao seletores
 *     como ".escuro .cartao" nao alcancam ele e o padrao aparece pelado. Os
 *     ancestrais entram com display:contents, entao participam da cascata sem
 *     trazer o layout deles junto;
 *   - o hero e clonado inteiro, e so o TEXTO muda — para apresentar o design
 *     system em vez do produto. Estrutura, classes, animacao e imagens ficam.
 *     O texto novo e distribuido pelos mesmos nos de texto do original, o que
 *     mantem intacto o markup de animacao letra a letra;
 *   - a nossa camada de documentacao usa prefixo xtr- e !important nos pontos
 *     estruturais. CSS de site e global e agressivo — reset com *, seletor de
 *     tag, cursor customizado — e a documentacao nao pode virar refem dele.
 */

import { hexParaRgb, contraste } from './design.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const px = (v) => {
  const m = /^(-?[\d.]+)px$/.exec(String(v || '').trim());
  return m ? parseFloat(m[1]) : 0;
};

function rgba(hex, a) {
  const c = hexParaRgb(hex);
  return c ? `rgba(${c.r}, ${c.g}, ${c.b}, ${a})` : hex;
}

/* ───────────────────────── contexto dos exemplos ─────────────────────── */

// Tags que nao sobrevivem fora do pai certo: o parser descarta um <td> solto e
// leva o exemplo junto. Viram div e mantem a classe, que e o que a cascata usa.
const TAG_FRAGIL = new Set([
  'td', 'th', 'tr', 'tbody', 'thead', 'tfoot', 'caption', 'colgroup', 'col',
  'li', 'dt', 'dd', 'option', 'optgroup', 'source', 'track', 'param'
]);

function tagContainer(t) {
  const s = String(t || '').toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(s)) return 'div';
  if (s === 'html' || s === 'body' || s === 'head') return 'div';
  if (TAG_FRAGIL.has(s)) return 'div';
  return s;
}

/*
 * Duas formas de recriar o ancestral, porque as duas situacoes sao diferentes:
 *
 *   contents — para os componentes. O ancestral entra so na cascata; o box dele
 *     nao existe, entao um wrapper de tela cheia nao engole o palco.
 *   caixa    — para o hero. Ali o ancestral costuma PINTAR: e dele o fundo
 *     preto, o mix-blend-mode que inverte o texto sobre o video. Ele fica como
 *     caixa de verdade, so com o dimensionamento neutralizado — senao um
 *     wrapper de 400vh de scroll preso viraria um vao vazio na pagina.
 */
function abreCtx(contexto, caixa) {
  return (contexto || []).map((c) => {
    const cls = [c.cls || '', caixa ? 'xtr-ctx--caixa' : 'xtr-ctx'].filter(Boolean).join(' ');
    const id = c.id ? ` id="${esc(c.id)}"` : '';
    return `<${tagContainer(c.tag)} class="${esc(cls)}"${id}>`;
  }).join('');
}

function fechaCtx(contexto) {
  return (contexto || []).slice().reverse()
    .map((c) => `</${tagContainer(c.tag)}>`).join('');
}

function seletorDe(p) {
  const cls = String(p.classe || '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
  return (p.tag || 'div') + (cls.length ? '.' + cls.join('.') : '');
}

/*
 * O fragmento entra cru — e esse o ponto: sem o markup original nao ha padrao
 * para documentar. O bridge ja tira os <script> na origem; aqui a rede de
 * seguranca e repetida, porque um payload de framework reexecutado fora do
 * contexto dele consegue apagar a pagina inteira.
 */
const SEM_SCRIPT = [/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, /<script\b[^>]*\/?>/gi];

function limparFragmento(html) {
  let s = String(html || '');
  for (const re of SEM_SCRIPT) s = s.replace(re, '');
  return s;
}

/*
 * Largura util do palco: o container tem 1180px, menos a margem da pagina e o
 * respiro interno da moldura.
 */
const LARGURA_PALCO = 1090;

/*
 * O palco reproduz o fragmento no tamanho em que ele vive na pagina.
 *
 * Sem isso o preview mente das duas pontas. Um SVG de 288px que o CSS do site
 * manda ocupar 100% da largura vira um logo de mil pixels de altura, com barra
 * de rolagem; um cabecalho de 2485px estoura o palco e so aparece pela metade.
 * Fixar a largura medida resolve o primeiro caso, e reduzir em escala o que nao
 * cabe resolve o segundo — a proporcao e a mesma, o componente aparece inteiro.
 */
function palco(p, cheio) {
  const conteudo = abreCtx(p.contexto, cheio) + limparFragmento(p.html) + fechaCtx(p.contexto);
  const classe = `xtr-palco${cheio ? ' xtr-palco--cheio' : ''}`;
  const propria = Math.round(Number(p.largura) || 0);
  const A = Math.round(Number(p.altura) || 0);

  if (cheio) {
    // O hero entra em tela cheia, mas ainda dentro de um cercado: o pin do
    // ScrollTrigger deixa pedacos em position:fixed, e sem containing block
    // eles grudam no viewport e reaparecem por cima de todas as secoes
    // seguintes — o campo de imagens do hero escrito por cima dos sliders.
    const altura = A ? ` style="min-height:${A}px"` : '';
    return `<div class="${classe}"${altura}>${conteudo}</div>`;
  }
  if (!propria) return `<div class="${classe}">${conteudo}</div>`;

  /*
   * Quem manda na largura e o berco do componente, nao ele: um cartao de
   * width:41% precisa da caixa de 1424px do grid para voltar a medir os seus
   * 584px. Sem isso ele encolhe a 41% de si mesmo e o texto vira uma coluna
   * de palavra por linha.
   */
  const berco = Math.round(Number(p.larguraCtx) || 0);
  const L = berco > propria ? berco : propria;

  const escala = L > LARGURA_PALCO ? Math.round((LARGURA_PALCO / L) * 1000) / 1000 : 1;
  // A altura medida entra como piso: componente feito so de filhos absolutos
  // nao tem altura propria, e sem isso a moldura colapsaria para nada. Com
  // teto, porque o piso de um componente de mil pixels seria uma moldura
  // gigante para o leitor rolar.
  const piso = A ? `;min-height:${Math.min(Math.round(A * escala), 520)}px` : '';
  const medida = `<div class="xtr-medida" style="width:${L}px${piso}${
    escala < 1 ? `;transform:scale(${escala})` : ''}">${conteudo}</div>`;

  if (escala === 1) return `<div class="${classe}">${medida}</div>`;

  // A caixa externa fica com a altura ja reduzida: sem ela sobraria o buraco da
  // altura original embaixo do componente encolhido.
  const alturaVisivel = A ? `height:${Math.max(40, Math.round(A * escala))}px` : '';   // eslint-disable-line
  return `<div class="${classe}"><div class="xtr-escala" style="${alturaVisivel}">${medida}</div></div>`;
}

function item(p) {
  const dim = (p.largura && p.altura) ? `${p.largura}×${p.altura}` : '';
  return `<div class="xtr-item">
    <div class="xtr-linha-topo">
      <code class="xtr-chip">${esc(seletorDe(p))}</code>
      ${p.irmaos ? `<span class="xtr-nota">${p.irmaos}× na página</span>` : ''}
      ${dim ? `<span class="xtr-nota">${esc(dim)}</span>` : ''}
    </div>
    ${palco(p)}
  </div>`;
}

function grade(lista) {
  return `<div class="xtr-grade">${lista.map(item).join('')}</div>`;
}

/* ─────────────────────────── hero: só o texto ────────────────────────── */

const PROPOSTAS = {
  titulo: [
    'Design System',
    'O design system',
    'Design System do site',
    'Design System: a biblioteca viva',
    'Design System: tipografia, cor, componentes e movimento'
  ],
  sub: [
    'A biblioteca viva desta interface.',
    'Tipografia, cores, componentes e movimento desta interface.',
    'Todos os estilos desta interface, documentados na própria linguagem visual do site.',
    'Cada exemplo abaixo é markup real da página, pintado pelo CSS original. Nada aqui foi redesenhado ou aproximado.'
  ],
  acao1: ['Tipografia', 'Ver tipografia', 'Ir para tipografia'],
  acao2: ['Cores', 'Ver cores', 'Ir para a paleta']
};

/** Escolhe o texto de comprimento mais próximo do original: o layout do hero
 *  foi desenhado para aquela medida, e trocar 8 caracteres por 60 quebraria. */
function textoProximo(original, candidatos) {
  const alvo = (original || '').length || 18;
  return candidatos.slice().sort(
    (a, b) => Math.abs(a.length - alvo) - Math.abs(b.length - alvo)
  )[0];
}

/**
 * Reescreve o texto de um trecho preservando cada elemento.
 *
 * Sites com animação letra a letra transformam um título em dezenas de divs de
 * um caractere. Apagar tudo e escrever textContent levaria os elementos junto,
 * então o texto novo entra no primeiro nó e os outros ficam vazios: a estrutura
 * inteira sobrevive, e o hero continua com a mesma contagem de elementos.
 *
 * Espalhar um caractere por nó, que era o caminho óbvio, produz lixo: os nós de
 * espaço entre as palavras originais continuam lá, nas posições da frase ANTIGA,
 * e o resultado sai "DesignS ystem dos i".
 */
function porNos(doc, el, texto) {
  const nos = [];
  const w = doc.createTreeWalker(el, 4 /* SHOW_TEXT */);
  let n;
  while ((n = w.nextNode())) if (n.nodeValue && n.nodeValue.trim()) nos.push(n);
  if (!nos.length) return;
  nos[0].nodeValue = texto;
  for (let i = 1; i < nos.length; i++) nos[i].nodeValue = '';
}

/**
 * Botões com transição de rótulo guardam o texto duas vezes: uma cópia visível
 * e outra esperando o hover. Escrever só na primeira deixaria o hover revelando
 * um vazio.
 */
function copiasDoMesmoTexto(el) {
  const filhos = [...(el.children || [])].filter((c) => (c.textContent || '').trim());
  if (filhos.length < 2) return [];
  const primeiro = filhos[0].textContent.trim();
  const iguais = filhos.filter((c) => c.textContent.trim() === primeiro);
  return iguais.length === filhos.length ? iguais : [];
}

function distribuirTexto(doc, el, texto) {
  const copias = copiasDoMesmoTexto(el);
  if (copias.length > 1) { for (const c of copias) porNos(doc, c, texto); return; }
  porNos(doc, el, texto);
}

const ANCORA_DA_ACAO = { acao1: '#tipografia', acao2: '#cores' };
const PARTES_TITULO = ['titulo', 'titulo2', 'titulo3'];

/** Reparte o título novo entre os elementos que formavam o original, na mesma
 *  proporção — o hero foi diagramado com aquela quebra de linha. */
function fatiarEmPartes(texto, tamanhos) {
  const total = tamanhos.reduce((a, b) => a + b, 0) || 1;
  const palavras = String(texto).split(' ').filter(Boolean);
  const saida = [];
  let i = 0;
  for (let k = 0; k < tamanhos.length; k++) {
    if (k === tamanhos.length - 1) { saida.push(palavras.slice(i).join(' ')); break; }
    const cota = Math.max(1, Math.round(palavras.length * (tamanhos[k] / total)));
    saida.push(palavras.slice(i, i + cota).join(' '));
    i += cota;
  }
  return saida;
}

function adaptarHero(html, slots) {
  let doc;
  try { doc = new DOMParser().parseFromString(`<div id="xtr-raiz">${html}</div>`, 'text/html'); }
  catch { return html; }
  const raiz = doc.getElementById('xtr-raiz');
  if (!raiz) return html;

  // O título pode estar quebrado em vários elementos — um <h1> por linha.
  const partes = PARTES_TITULO
    .map((n) => ({ el: raiz.querySelector(`[data-xtr-slot="${n}"]`), orig: (slots || {})[n] || '' }))
    .filter((x) => x.el);

  if (partes.length) {
    const tamanhos = partes.map((x) => x.orig.length || 8);
    const cabem = PROPOSTAS.titulo.filter((t) => t.split(' ').length >= partes.length);
    const escolhido = textoProximo('x'.repeat(tamanhos.reduce((a, b) => a + b, 0)),
      cabem.length ? cabem : PROPOSTAS.titulo);
    const pedacos = fatiarEmPartes(escolhido, tamanhos);
    partes.forEach((x, i) => distribuirTexto(doc, x.el, pedacos[i] || ''));
  }

  for (const nome of ['sub', 'acao1', 'acao2']) {
    const alvo = raiz.querySelector(`[data-xtr-slot="${nome}"]`);
    if (!alvo) continue;
    distribuirTexto(doc, alvo, textoProximo((slots || {})[nome], PROPOSTAS[nome]));
    // O CTA continua sendo o mesmo elemento, com o mesmo estado de hover; só
    // passa a levar para a seção que ele agora anuncia.
    const ancora = ANCORA_DA_ACAO[nome];
    if (ancora && alvo.tagName === 'A') alvo.setAttribute('href', ancora);
  }
  return raiz.innerHTML;
}

/* ──────────────────────────── seções ─────────────────────────────────── */

function cabecalho(num, titulo, ajuda, contagem) {
  return `<div class="xtr-cab">
    <span class="xtr-num">${esc(num)}</span>
    <div>
      <div class="xtr-titulo" role="heading" aria-level="2">${esc(titulo)}${
        contagem ? `<span class="xtr-contagem">${contagem}</span>` : ''}</div>
      ${ajuda ? `<p class="xtr-ajuda">${ajuda}</p>` : ''}
    </div>
  </div>`;
}

function secao(id, num, titulo, ajuda, corpo, contagem) {
  if (!corpo) return '';
  return `<div class="xtr-secao" id="${esc(id)}">${cabecalho(num, titulo, ajuda, contagem)}${corpo}</div>`;
}

/* tipografia ------------------------------------------------------------ */

const nivelH = (t) => (/^h([1-6])$/.test(t) ? parseInt(t[1], 10) : 99);

/*
 * O style inline capturado e o que mantem a amostra visivel — foi o GSAP que
 * escreveu opacity:1 ali. Mas ele tambem carrega a POSICAO do elemento no
 * momento da captura: um titulo de marquee vem com translate3d(-495px), e fora
 * da esteira dele isso joga a amostra para fora da linha. Fica o que pinta,
 * sai o que posiciona.
 */
const PROP_POSICAO = /^(transform|translate|rotate|scale|position|top|left|right|bottom|inset|margin|will-change)/i;

function estiloSeguro(estilo) {
  return String(estilo || '').split(';')
    .map((d) => d.trim())
    .filter((d) => d && !PROP_POSICAO.test(d.split(':')[0].trim()))
    .join('; ');
}

function nomeEstilo(e) {
  if (/^h[1-6]$/.test(e.tag)) return 'Título ' + e.tag[1];
  const p = px(e.tamanho);
  const forte = parseInt(e.peso, 10) >= 600;
  const base = p >= 48 ? 'Display' : p >= 32 ? 'Destaque' : p >= 24 ? 'Subtítulo'
    : p >= 19 ? 'Corpo L' : p >= 15 ? 'Corpo M' : p >= 13 ? 'Corpo S' : 'Legenda';
  return forte && p < 32 ? base + ' forte' : base;
}

function secaoTipografia(ds) {
  const estilos = (ds.tipografia.estilos || []).slice()
    .sort((a, b) => (nivelH(a.tag) - nivelH(b.tag)) || (px(b.tamanho) - px(a.tamanho)));
  if (!estilos.length) return '';

  const usados = new Map();
  const linhas = estilos.map((e) => {
    let nome = nomeEstilo(e);
    const n = (usados.get(nome) || 0) + 1;
    usados.set(nome, n);
    if (n > 1) nome += ' ' + n;

    const grande = px(e.tamanho) >= 40;
    const amostra = (e.amostra || 'Grumpy wizards make toxic brew').slice(0, grande ? 46 : 90);
    const tag = tagContainer(e.tag);
    const cls = e.classe ? ` class="${esc(e.classe)}"` : '';
    const limpo = estiloSeguro(e.estilo);
    const est = limpo ? ` style="${esc(limpo)}"` : '';
    const alturaTxt = e.altura && e.altura !== 'normal' ? e.altura : 'normal';

    /*
     * Um estilo pode ser legitimamente quase invisivel sobre o fundo base — a
     * esteira que passa atras do conteudo, por exemplo. Sem dizer o contraste,
     * a linha parece um defeito da pagina em vez de uma informacao do site.
     */
    const razao = e.cor ? Math.round(contraste(e.cor, ds.resumo.fundoPrincipal) * 10) / 10 : null;
    const aviso = razao !== null && razao < 3
      ? `<span class="xtr-nota">${razao}:1 sobre o fundo</span>` : '';

    return `<div class="xtr-tipo-linha">
      <div class="xtr-tipo-nome">${esc(nome)}<code class="xtr-chip">${esc(e.tag)}</code></div>
      <div class="xtr-tipo-demo">${abreCtx(e.contexto)}<${tag}${cls}${est}>${esc(amostra)}</${tag}>${fechaCtx(e.contexto)}</div>
      <div class="xtr-tipo-spec">${esc(e.tamanho)} / ${esc(alturaTxt)}${aviso}</div>
    </div>`;
  }).join('');

  const familias = (ds.tipografia.familias || []).slice(0, 4).map((f) => `
    <div class="xtr-fam">
      <div class="xtr-fam-amostra" style="font-family:${esc(f.valor)}">Aa Bb Cc 0123</div>
      <code class="xtr-chip">${esc(f.primeira)}</code>
    </div>`).join('');

  return (familias ? `<div class="xtr-fams">${familias}</div>` : '') +
    `<div class="xtr-tipo">${linhas}</div>`;
}

/* cores ----------------------------------------------------------------- */

function secaoCores(ds) {
  const papeis = [
    ['fundo', 'Fundos'], ['texto', 'Textos'], ['acento', 'Acentos'], ['borda', 'Bordas']
  ];
  const base = ds.resumo.fundoPrincipal;
  const blocos = [];

  for (const [papel, titulo] of papeis) {
    let grupo = ds.cores.filter((c) => c.papel === papel);
    if (!grupo.length) continue;
    if (papel === 'fundo') {
      grupo = grupo.slice().sort((a, b) => (b.hex === base) - (a.hex === base));
    }
    const chips = grupo.slice(0, 12).map((c) => `
      <div class="xtr-cor${c.hex === base ? ' xtr-cor--base' : ''}">
        <div class="xtr-cor-amostra" style="background:${esc(c.hex)}"></div>
        <code>${esc(c.hex)}</code>
        <span class="xtr-nota">${c.hex === base ? 'fundo base' : c.contrasteNoFundo + ':1'}</span>
      </div>`).join('');
    blocos.push(`<div class="xtr-sub">${esc(titulo)}</div><div class="xtr-cores">${chips}</div>`);
  }
  return blocos.join('');
}

/* efeitos, movimento, espaçamento --------------------------------------- */

/* ícones ---------------------------------------------------------------- */

function secaoIcones(padroes) {
  const ic = (padroes.icones || []).slice(0, 48);
  if (!ic.length) return '';

  const svg = ic.filter((i) => i.tipo === 'svg').length;
  const fonte = ic.filter((i) => i.tipo === 'fonte');
  const herdam = ic.filter((i) => i.herdaCor).length;
  const familias = [...new Set(fonte.map((f) => f.familia).filter(Boolean))];
  const tracos = [...new Set(ic.map((i) => i.traco).filter((t) => t && t !== '0px'))];

  const nota = [
    `${ic.length} ícones distintos`,
    svg ? `${svg} em SVG inline` : '',
    herdam ? `${herdam} herdando a cor do contexto (<code class="xtr-chip">currentColor</code>)` : '',
    fonte.length ? `${fonte.length} vindos de fonte de ícone${familias.length ? ` (${esc(familias.join(', '))})` : ''}`
                 : 'nenhuma fonte de ícone',
    tracos.length ? `espessura de traço ${esc(tracos.slice(0, 3).join(', '))}` : ''
  ].filter(Boolean).join(' · ') + '.';

  const chips = ic.map((i) => `
    <div class="xtr-icone">
      <div class="xtr-icone-caixa">${abreCtx(i.contexto)}${limparFragmento(i.html)}${fechaCtx(i.contexto)}</div>
      <span class="xtr-nota">${i.largura}×${i.altura}${i.n > 1 ? ` · ${i.n}×` : ''}</span>
    </div>`).join('');

  return `<p class="xtr-ajuda">${nota} A cor abaixo é a do texto desta página. Assim dá para ver quais herdam o tema e quais têm cor própria.</p>
    <div class="xtr-icones">${chips}</div>`;
}

/* layout e grade -------------------------------------------------------- */

const maiores = (mapa, n) => Object.entries(mapa || {})
  .sort((a, b) => b[1] - a[1]).slice(0, n);

/*
 * grid-template-columns computado vem em pixels usados: doze colunas de 1fr
 * saem como "94.2031px" doze vezes. Despejar isso na página é ruído; o que
 * interessa é quantas colunas e se são iguais.
 */
function resumirModelo(tpl) {
  const partes = String(tpl).trim().split(/\s+/);
  if (partes.length < 2) return tpl;
  // Só px é comparável: "1fr 2fr" tem diferença 1 e passaria por "iguais".
  if (!partes.every((x) => /^-?[\d.]+px$/.test(x))) {
    return tpl.length > 60 ? partes.length + ' colunas' : tpl;
  }
  const nums = partes.map((x) => parseFloat(x));
  if (!nums.every((n) => isFinite(n) && n > 0)) return tpl.length > 60 ? partes.length + ' colunas' : tpl;
  const max = Math.max(...nums), min = Math.min(...nums);
  if (max - min < 1.5) return `${partes.length} × ${Math.round(max)}px · iguais`;
  return `${partes.length} colunas · ` + nums.map((n) => {
    const r = n / min;
    return (Math.abs(r - Math.round(r)) < 0.08 ? Math.round(r) : r.toFixed(1)) + 'fr';
  }).join(' ');
}

function secaoLayout(padroes) {
  const L = padroes.layout;
  if (!L) return '';
  const partes = [];
  const c = L.container;

  if (c) {
    partes.push(`<p class="xtr-ajuda">O conteúdo vive dentro de
      <code class="xtr-chip">${esc(c.classe || 'container')}</code>: largura máxima
      <b>${esc(c.maxLargura)}</b>, respiro lateral <b>${esc(c.padEsquerda)}</b>.
      Medido numa janela de ${L.viewport.largura}px.</p>`);
  }

  // Régua: a contagem de colunas mais usada, com o vão real entre elas.
  const colTop = maiores(L.colunas, 1)[0];
  const gapTop = maiores(L.gaps, 1)[0];
  const nCol = colTop ? parseInt(colTop[0], 10) : 0;
  if (nCol >= 2 && nCol <= 24) {
    const celulas = Array.from({ length: nCol }, () => '<div class="xtr-col"></div>').join('');
    partes.push(`<div class="xtr-sub">Grade dominante <span class="xtr-contagem">${nCol} colunas${
      gapTop ? ` · vão ${esc(gapTop[0])}` : ''}</span></div>
      <div class="xtr-regua" style="grid-template-columns:repeat(${nCol},minmax(0,1fr));${
        gapTop ? `gap:${esc(gapTop[0])}` : ''}">${celulas}</div>`);
  }

  const listar = (titulo, mapa, n, resumir) => {
    const itens = maiores(mapa, n);
    if (!itens.length) return;
    const vistos = new Set();
    const chips = [];
    for (const [v, peso] of itens) {
      const rotulo = resumir ? resumir(v) : v;
      if (vistos.has(rotulo)) continue;
      vistos.add(rotulo);
      chips.push(`<code class="xtr-chip">${esc(rotulo)}<span class="xtr-nota"> ${Math.round(peso)}×</span></code>`);
    }
    partes.push(`<div class="xtr-sub">${titulo}</div><div class="xtr-chips">${chips.join('')}</div>`);
  };
  listar('Larguras de container', L.containers, 6);
  listar('Vãos', L.gaps, 8);
  listar('Respiro vertical das seções', L.ritmo, 8);
  listar('Modelos de coluna', L.modelos, 8, resumirModelo);

  if (L.exemploGrade) {
    partes.push(`<div class="xtr-sub">Uma grade real da página <span class="xtr-contagem">${
      L.exemploGrade.colunas} colunas</span></div>${palco(L.exemploGrade)}`);
  }
  return partes.join('');
}

/* sliders --------------------------------------------------------------- */

function secaoSliders(comp) {
  const sl = comp.sliders || [];
  if (!sl.length) return '';
  const libs = [...new Set(sl.map((s2) => s2.biblioteca).filter(Boolean))];
  return `<p class="xtr-ajuda">${
    libs.length ? `Motor: ${esc(libs.join(', '))}. ` : ''
  }Sem o JavaScript do site eles aparecem parados no quadro em que a captura os pegou, mas a estrutura e o estilo são reais.</p>` +
    `<div class="xtr-grade">${sl.map((s2) => {
      const dim = (s2.largura && s2.altura) ? `${s2.largura}×${s2.altura}` : '';
      return `<div class="xtr-item">
        <div class="xtr-linha-topo">
          <code class="xtr-chip">${esc(seletorDe(s2))}</code>
          ${s2.biblioteca ? `<span class="xtr-nota">${esc(s2.biblioteca)}</span>` : ''}
          ${dim ? `<span class="xtr-nota">${esc(dim)}</span>` : ''}
        </div>${palco(s2)}
      </div>`;
    }).join('')}</div>`;
}

function secaoEfeitos(ds) {
  const partes = [];
  const raios = (ds.raios || []).slice(0, 8);
  if (raios.length) {
    partes.push('<div class="xtr-sub">Raios</div><div class="xtr-chips">' + raios.map((r) => `
      <div class="xtr-efeito">
        <div class="xtr-caixa" style="border-radius:${esc(r.valor)}"></div>
        <code>${esc(r.valor)}</code>
      </div>`).join('') + '</div>');
  }
  const sombras = (ds.sombras || []).slice(0, 6);
  if (sombras.length) {
    partes.push('<div class="xtr-sub">Sombras</div><div class="xtr-chips">' + sombras.map((s) => `
      <div class="xtr-efeito">
        <div class="xtr-caixa" style="box-shadow:${esc(s.valor)}"></div>
        <code class="xtr-quebra">${esc(s.valor)}</code>
      </div>`).join('') + '</div>');
  }
  const grads = (ds.gradientes || []).slice(0, 6);
  if (grads.length) {
    partes.push('<div class="xtr-sub">Gradientes</div><div class="xtr-chips">' + grads.map((g) => `
      <div class="xtr-efeito">
        <div class="xtr-caixa" style="background-image:${esc(g.valor)}"></div>
        <code class="xtr-quebra">${esc(g.valor.slice(0, 70))}</code>
      </div>`).join('') + '</div>');
  }
  return partes.join('');
}

function secaoMovimento(ds, libs) {
  const m = ds.movimento || {};
  const dur = (m.duracoes || []).slice(0, 6);
  const cur = (m.curvas || []).slice(0, 6);
  const trans = (m.transicoes || []).slice(0, 10);
  const anim = (m.animacoes || []).slice(0, 10);
  if (!dur.length && !cur.length && !trans.length && !anim.length) return '';

  const linhas = [];
  const n = Math.max(dur.length, cur.length);
  for (let i = 0; i < n; i++) {
    const d = (dur[i] || dur[0] || { valor: '0.3s' }).valor;
    const c = (cur[i] || cur[0] || { valor: 'ease' }).valor;
    linhas.push(`<div class="xtr-mov">
      <div class="xtr-trilho"><div class="xtr-bola" style="transition:left ${esc(d)} ${esc(c)}"></div></div>
      <code>${esc(d)}</code><code class="xtr-quebra">${esc(c)}</code>
    </div>`);
  }
  const kf = (m.keyframes || []).slice(0, 24);
  const partes = [];

  if (libs && libs.length) {
    // Metade do movimento de um site premium não está no CSS — está na
    // biblioteca que o dirige. Saber que é GSAP + ScrollTrigger + Lenis vale
    // mais do que a lista de durações.
    partes.push(`<div class="xtr-sub">O que dirige o movimento</div>
      <div class="xtr-chips">${libs.map((l) => `<code class="xtr-chip">${esc(l)}</code>`).join('')}</div>`);
  }

  partes.push(`<div class="xtr-sub">Durações e curvas</div>
    <p class="xtr-ajuda">Passe o mouse para ver a curva real do site.</p>
    <div class="xtr-movs">${linhas.join('')}</div>`);

  const receitas = (titulo, lista, ajuda) => {
    if (!lista.length) return;
    partes.push(`<div class="xtr-sub">${titulo} <span class="xtr-contagem">${lista.length}</span></div>` +
      (ajuda ? `<p class="xtr-ajuda">${ajuda}</p>` : '') +
      `<div class="xtr-receitas">${lista.map((t) => {
        const [prop, d, curva] = String(t.valor).split(' · ');
        return `<div class="xtr-receita">
          <code>${esc(prop || '')}</code>
          <span class="xtr-nota">${esc(d || '')}</span>
          <span class="xtr-nota xtr-quebra">${esc(curva || '')}</span>
        </div>`;
      }).join('')}</div>`);
  };
  receitas('Transições em uso', trans,
    'A receita inteira, do jeito que o site aplica: o que transiciona, em quanto tempo, com que curva.');
  receitas('Animações em uso', anim,
    'Cada @keyframes que estava rodando de verdade nos elementos visíveis.');

  if (kf.length) {
    partes.push(`<div class="xtr-sub">@keyframes declarados <span class="xtr-contagem">${kf.length}</span></div>
      <div class="xtr-chips">${kf.map((k) => `<code class="xtr-chip">${esc(k)}</code>`).join('')}</div>`);
  }
  return partes.join('');
}

function secaoEspacamento(ds) {
  const e = (ds.espacamento || []).slice(0, 12);
  if (!e.length) return '';
  const passo = ds.resumo.passoDeEspacamento;
  return (passo ? `<p class="xtr-ajuda">Escala de ${passo}px.</p>` : '') +
    '<div class="xtr-espacos">' + e.map((s) => `
      <div class="xtr-espaco">
        <div class="xtr-barra" style="width:${Math.min(px(s.valor), 220)}px"></div>
        <code>${esc(s.valor)}</code>
      </div>`).join('') + '</div>';
}

function secaoBreakpoints(ds) {
  const b = ds.breakpoints || [];
  if (!b.length) return '';
  return '<div class="xtr-chips">' + b.map((x) => `
    <div class="xtr-bp"><b>${x.px}px</b><code class="xtr-quebra">${esc(x.condicao)}</code></div>`).join('') + '</div>';
}

function secaoTokens(ds) {
  const vars = Object.entries(ds.variaveis || {}).slice(0, 120);
  if (!vars.length) return '';
  const linhas = vars.map(([nome, info]) => {
    const v = String(info.valor || '');
    const cor = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(v.trim())
      ? `<span class="xtr-ponto" style="background:${esc(v)}"></span>` : '';
    return `<div class="xtr-token"><code>${esc(nome)}</code>${cor}<span class="xtr-quebra">${esc(v.slice(0, 90))}</span></div>`;
  }).join('');
  return `<p class="xtr-ajuda">Custom properties declaradas pelo próprio site. Os nomes são dele.</p>
    <div class="xtr-tokens">${linhas}</div>`;
}

/* ────────────────────────── a folha da documentação ──────────────────── */

function chrome(ds) {
  const fundo = ds.resumo.fundoPrincipal;
  const texto = ds.resumo.textoPrincipal;
  const acento = (ds.cores.find((c) => c.papel === 'acento' && contraste(c.hex, fundo) >= 3) ||
    { hex: texto }).hex;
  const fonte = (ds.tipografia.familias[0] || {}).valor ||
    'ui-sans-serif, system-ui, -apple-system, sans-serif';

  return `
:root{
  --xtr-fundo:${fundo};
  --xtr-texto:${texto};
  --xtr-suave:${rgba(texto, 0.6)};
  --xtr-linha:${rgba(texto, 0.16)};
  --xtr-tenue:${rgba(texto, 0.05)};
  --xtr-acento:${acento};
  --xtr-fonte:${fonte};
}

/* O guia precisa rolar e ser clicável. Sites com scroll suave por JS travam o
   body (overflow hidden, altura fixa) e escondem o cursor porque desenham um
   próprio — sem o JS deles, isso deixaria a página inutilizável. */
html.xtr-ds, html.xtr-ds body{
  overflow:visible!important; height:auto!important; max-height:none!important;
  position:static!important; opacity:1!important; visibility:visible!important;
  cursor:auto!important; transform:none!important; filter:none!important;
}
html.xtr-ds{scroll-behavior:smooth; scroll-padding-top:72px;}
html.xtr-ds body{background-color:var(--xtr-fundo)!important; margin:0!important;}

/* Ancestral recriado só para a cascata: participa dos seletores, não do layout. */
.xtr-ctx{display:contents!important;}
.xtr-ctx--caixa{
  display:block!important; position:relative!important; float:none!important;
  height:auto!important; min-height:0!important; max-height:none!important;
  width:auto!important; min-width:0!important; max-width:none!important;
  margin:0!important; inset:auto!important; transform:none!important;
  overflow:visible!important; opacity:1!important; visibility:visible!important;
}
.xtr-desancorado{
  position:relative!important; inset:auto!important;
  top:auto!important; left:auto!important; right:auto!important; bottom:auto!important;
  transform:none!important; margin:0!important;
}

.xtr-nav{
  position:sticky!important; top:0!important; z-index:2147483000!important;
  display:flex!important; gap:4px!important; align-items:center!important;
  overflow-x:auto!important; padding:10px 20px!important; margin:0!important;
  background:var(--xtr-fundo)!important; border:0!important;
  border-bottom:1px solid var(--xtr-linha)!important;
  font-family:var(--xtr-fonte)!important; -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px);
}
.xtr-marca{
  font:600 11px/1 var(--xtr-fonte)!important; letter-spacing:.14em!important;
  text-transform:uppercase!important; color:var(--xtr-suave)!important;
  margin-right:14px!important; white-space:nowrap!important;
}
.xtr-nav a{
  display:block!important; padding:6px 11px!important; border-radius:99px!important;
  font:500 12px/1 var(--xtr-fonte)!important; letter-spacing:0!important;
  text-transform:none!important; text-decoration:none!important;
  color:var(--xtr-suave)!important; background:transparent!important;
  border:0!important; white-space:nowrap!important; transition:color .18s, background .18s;
}
.xtr-nav a:hover{color:var(--xtr-fundo)!important; background:var(--xtr-acento)!important;}
.xtr-nav a[data-xtr-ativo]{color:var(--xtr-texto)!important; background:var(--xtr-tenue)!important;}

.xtr-doc{
  display:block!important; max-width:1180px!important; margin:0 auto!important;
  overflow-x:clip!important;
  padding:0 20px 120px!important; font-family:var(--xtr-fonte)!important;
  color:var(--xtr-texto)!important;
}
.xtr-secao{padding:64px 0 0!important; margin:0!important; border:0!important;}
.xtr-secao#hero{padding:0!important;}
.xtr-cab{display:flex!important; gap:16px!important; align-items:baseline!important; margin:0 0 28px!important;}
.xtr-num{
  font:500 11px/1 var(--xtr-fonte)!important; color:var(--xtr-suave)!important;
  padding-top:6px!important; letter-spacing:.1em!important;
}
.xtr-titulo{
  font:600 24px/1.2 var(--xtr-fonte)!important; color:var(--xtr-texto)!important;
  letter-spacing:-.01em!important; text-transform:none!important; margin:0!important;
}
.xtr-contagem{
  font:500 11px/1 var(--xtr-fonte)!important; color:var(--xtr-suave)!important;
  margin-left:10px!important; vertical-align:middle!important;
}
.xtr-ajuda{
  font:400 13px/1.6 var(--xtr-fonte)!important; color:var(--xtr-suave)!important;
  margin:6px 0 0!important; max-width:70ch!important; text-transform:none!important;
}
.xtr-sub{
  font:500 11px/1 var(--xtr-fonte)!important; letter-spacing:.12em!important;
  text-transform:uppercase!important; color:var(--xtr-suave)!important;
  margin:34px 0 14px!important;
}
.xtr-chip{
  display:inline-block!important; padding:3px 8px!important; border-radius:5px!important;
  background:var(--xtr-tenue)!important; border:1px solid var(--xtr-linha)!important;
  font:400 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace!important;
  color:var(--xtr-suave)!important; text-transform:none!important; letter-spacing:0!important;
}
.xtr-nota{
  font:400 11px/1.4 var(--xtr-fonte)!important; color:var(--xtr-suave)!important;
  text-transform:none!important; letter-spacing:0!important;
}
.xtr-quebra{word-break:break-all!important;}

.xtr-palco{
  position:relative!important; padding:22px!important; margin:0!important;
  min-width:0!important; max-width:100%!important;
  border:1px solid var(--xtr-linha)!important; border-radius:10px!important;
  overflow:auto!important; max-height:560px!important; background:transparent!important;
}
/* O fragmento entra no palco com a largura que tinha na pagina — e nunca mais
   larga que o palco, para nao arrastar a pagina inteira para o lado.

   position + overflow + transform juntos formam o cercado: sem eles, um
   componente cujos filhos sao absolutos ou fixos se ancora no viewport e
   espalha as pecas por cima da pagina inteira — foi assim que o campo de
   imagens do hero apareceu escrito por cima da secao de sliders. O transform
   tambem serve de containing block para position:fixed, que nenhum overflow
   segura sozinho. */
.xtr-medida{
  display:block!important; max-width:100%!important;
  position:relative!important; overflow:hidden!important;
  transform:translateZ(0); transform-origin:top left!important;
}
.xtr-escala{display:block!important; overflow:hidden!important; max-width:100%!important;}
.xtr-palco--cheio{
  padding:0!important; border:0!important; border-radius:0!important;
  max-height:none!important; overflow:hidden!important; margin:0!important;
  /* prende o que o pin deixou em position:fixed (ver o comentario em palco) */
  position:relative!important; transform:translateZ(0);
}
/* minmax(0,1fr) e min-width:0: sem isso um componente largo — uma esteira de
   1699px — estica a trilha do grid e arrasta a pagina inteira para fora da
   janela, em vez de rolar dentro do proprio palco. */
.xtr-grade{display:grid!important; gap:22px!important; grid-template-columns:minmax(0,1fr)!important;}
.xtr-item{display:block!important; min-width:0!important; max-width:100%!important;}
.xtr-linha-topo{display:flex!important; gap:10px!important; align-items:center!important; margin:0 0 8px!important; flex-wrap:wrap!important;}

.xtr-fams{display:flex!important; flex-wrap:wrap!important; gap:22px!important; margin:0 0 28px!important;}
.xtr-fam{display:flex!important; flex-direction:column!important; gap:8px!important;}
.xtr-fam-amostra{font-size:30px!important; line-height:1.2!important; color:var(--xtr-texto)!important;}

.xtr-tipo{display:block!important; border-top:1px solid var(--xtr-linha)!important;}
.xtr-tipo-linha{
  display:grid!important; grid-template-columns:150px minmax(0,1fr) 172px!important;
  gap:20px!important; align-items:baseline!important; padding:20px 0!important;
  border-bottom:1px solid var(--xtr-linha)!important;
}
.xtr-tipo-nome{
  display:flex!important; flex-direction:column!important; gap:6px!important; align-items:flex-start!important;
  font:500 13px/1.4 var(--xtr-fonte)!important; color:var(--xtr-texto)!important;
}
.xtr-tipo-demo{min-width:0!important; overflow:hidden!important;}
.xtr-tipo-spec{
  text-align:right!important;
  font:400 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace!important;
  color:var(--xtr-suave)!important; white-space:nowrap!important;
}
.xtr-tipo-spec .xtr-nota{display:block!important; margin-top:4px!important; opacity:.75!important;}

.xtr-cores{display:grid!important; grid-template-columns:repeat(auto-fill,minmax(128px,1fr))!important; gap:14px!important;}
.xtr-cor{display:flex!important; flex-direction:column!important; gap:6px!important;}
.xtr-cor-amostra{
  height:66px!important; border-radius:8px!important;
  border:1px solid var(--xtr-linha)!important;
}
.xtr-cor--base .xtr-cor-amostra{box-shadow:0 0 0 2px var(--xtr-acento)!important;}
.xtr-cor code{
  font:400 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace!important;
  color:var(--xtr-texto)!important;
}

.xtr-chips{display:flex!important; flex-wrap:wrap!important; gap:16px!important;}

/* Ícones: a caixa dá a cor do texto, e é assim que se vê quais herdam o tema
   (currentColor) e quais trazem cor própria. */
.xtr-icones{display:grid!important; grid-template-columns:repeat(auto-fill,minmax(86px,1fr))!important; gap:12px!important;}
.xtr-icone{
  display:flex!important; flex-direction:column!important; align-items:center!important;
  gap:8px!important; padding:14px 6px!important; border:1px solid var(--xtr-linha)!important;
  border-radius:9px!important; color:var(--xtr-texto)!important;
}
.xtr-icone-caixa{
  display:flex!important; align-items:center!important; justify-content:center!important;
  min-height:34px!important; color:var(--xtr-texto)!important;
}
.xtr-icone-caixa svg{max-width:34px!important; max-height:34px!important;}

.xtr-regua{display:grid!important; margin:0 0 8px!important;}
.xtr-col{
  height:52px!important; border-radius:4px!important;
  background:var(--xtr-acento)!important; opacity:.22!important;
}

.xtr-receitas{display:grid!important; grid-template-columns:repeat(auto-fill,minmax(280px,1fr))!important; gap:8px!important;}
.xtr-receita{
  display:flex!important; gap:10px!important; align-items:baseline!important; flex-wrap:wrap!important;
  padding:9px 12px!important; border:1px solid var(--xtr-linha)!important; border-radius:7px!important;
}
.xtr-receita code{
  font:400 12px/1.4 ui-monospace,Menlo,monospace!important; color:var(--xtr-texto)!important;
}
.xtr-efeito{display:flex!important; flex-direction:column!important; gap:8px!important; max-width:190px!important;}
.xtr-caixa{
  width:110px!important; height:70px!important; background:var(--xtr-tenue)!important;
  border:1px solid var(--xtr-linha)!important;
}
.xtr-efeito code{font:400 11px/1.4 ui-monospace,Menlo,monospace!important; color:var(--xtr-suave)!important;}

.xtr-movs{display:grid!important; gap:12px!important;}
.xtr-mov{display:grid!important; grid-template-columns:1fr 70px minmax(0,220px)!important; gap:14px!important; align-items:center!important;}
.xtr-trilho{
  height:34px!important; border-radius:99px!important; background:var(--xtr-tenue)!important;
  border:1px solid var(--xtr-linha)!important; position:relative!important; overflow:hidden!important;
}
.xtr-bola{
  position:absolute!important; top:5px!important; left:5px!important;
  width:22px!important; height:22px!important; border-radius:50%!important;
  background:var(--xtr-acento)!important;
}
.xtr-trilho:hover .xtr-bola{left:calc(100% - 27px)!important;}
.xtr-mov code{font:400 11px/1.4 ui-monospace,Menlo,monospace!important; color:var(--xtr-suave)!important;}

.xtr-espacos{display:grid!important; gap:9px!important;}
.xtr-espaco{display:flex!important; gap:12px!important; align-items:center!important;}
.xtr-barra{height:12px!important; border-radius:3px!important; background:var(--xtr-acento)!important; opacity:.8!important;}
.xtr-espaco code{font:400 11px/1 ui-monospace,Menlo,monospace!important; color:var(--xtr-suave)!important;}

.xtr-bp{display:flex!important; flex-direction:column!important; gap:4px!important; max-width:230px!important;}
.xtr-bp b{font:600 15px/1 var(--xtr-fonte)!important; color:var(--xtr-texto)!important;}
.xtr-bp code{font:400 11px/1.4 ui-monospace,Menlo,monospace!important; color:var(--xtr-suave)!important;}

.xtr-tokens{display:grid!important; grid-template-columns:repeat(auto-fill,minmax(300px,1fr))!important; gap:8px!important;}
.xtr-token{
  display:flex!important; gap:8px!important; align-items:center!important;
  padding:7px 10px!important; border:1px solid var(--xtr-linha)!important; border-radius:7px!important;
  font:400 11px/1.4 ui-monospace,Menlo,monospace!important; color:var(--xtr-suave)!important;
}
.xtr-token code{color:var(--xtr-texto)!important; white-space:nowrap!important;}
.xtr-ponto{
  width:13px!important; height:13px!important; border-radius:4px!important;
  border:1px solid var(--xtr-linha)!important; flex:none!important;
}

.xtr-rodape{
  max-width:1180px!important; margin:80px auto 0!important; padding:22px 20px 60px!important;
  border-top:1px solid var(--xtr-linha)!important;
  font:400 12px/1.7 var(--xtr-fonte)!important; color:var(--xtr-suave)!important;
}
.xtr-rodape a{color:var(--xtr-acento)!important; text-decoration:none!important;}

@media (max-width:760px){
  .xtr-tipo-linha{grid-template-columns:1fr!important; gap:10px!important;}
  .xtr-tipo-spec{text-align:left!important;}
  .xtr-mov{grid-template-columns:1fr!important;}
}
`;
}

/* ────────────────────────────── a página ─────────────────────────────── */

const ESPIA = `(function(){
  var alvos=[].slice.call(document.querySelectorAll('.xtr-secao'));
  var links={};
  [].forEach.call(document.querySelectorAll('.xtr-nav a'),function(a){links[a.getAttribute('href').slice(1)]=a;});
  if(!alvos.length||!('IntersectionObserver' in window))return;
  var atual=null;
  var io=new IntersectionObserver(function(es){
    es.forEach(function(e){
      if(!e.isIntersecting)return;
      var l=links[e.target.id];
      if(!l||l===atual)return;
      if(atual)atual.removeAttribute('data-xtr-ativo');
      l.setAttribute('data-xtr-ativo','1');atual=l;
    });
  },{rootMargin:'-72px 0px -70% 0px'});
  alvos.forEach(function(s){io.observe(s);});
})();`;

/**
 * @param {object} o
 * @param {object} o.ds       design system consolidado (design.js)
 * @param {object} o.padroes  fragmentos capturados da página de referência
 * @returns {string} HTML com URLs ABSOLUTAS — quem chama passa por rewriteHtml.
 */
export function gerarPaginaViva({ ds, padroes, origem, geradoEm, libs = [] }) {
  const p = padroes || {};
  const doc = p.documento || {};
  const comp = p.componentes || {};

  const folhas = (p.folhas || []).map((f) => f.tipo === 'link'
    ? `<link rel="stylesheet" href="${esc(f.href)}"${f.media ? ` media="${esc(f.media)}"` : ''}>`
    : `<style>${String(f.css || '').replace(/<\/style/gi, '<\\/style')}</style>`
  ).join('\n');

  const scripts = (p.scripts || []).map((s) =>
    `<script src="${esc(s.src)}"${/module/i.test(s.tipo || '') ? ' type="module"' : ''} defer></script>`
  ).join('\n');

  /* ---- seções, na ordem em que a documentação se lê ---- */
  const secoes = [];
  const nav = [];
  let numero = 0;
  // A numeração é automática: seção que não tem conteúdo não é gerada, e uma
  // lista numerada à mão sairia com buracos.
  const add = (id, rotulo, titulo, ajuda, corpo, contagem) => {
    if (!corpo) return;
    numero++;
    secoes.push(secao(id, String(numero).padStart(2, '0'), titulo, ajuda, corpo, contagem));
    nav.push(`<a href="#${esc(id)}">${esc(rotulo)}</a>`);
  };

  // O hero vive fora do container com largura maxima: ele e uma copia da
  // primeira dobra do site e precisa da largura inteira da janela.
  let heroHtml = '';
  if (p.hero && p.hero.html) {
    const clonado = adaptarHero(p.hero.html, p.hero.slots);
    heroHtml = `<div class="xtr-secao" id="hero">${
      palco({ ...p.hero, html: clonado }, true)}</div>`;
    nav.push('<a href="#hero">Hero</a>');
  }

  add('tipografia', 'Tipografia', 'Tipografia',
    'Cada linha usa a tag e as classes originais do site. À direita, tamanho e entrelinha computados.',
    secaoTipografia(ds), (ds.tipografia.estilos || []).length);

  add('cores', 'Cores', 'Cores',
    'Agrupadas pelo papel que cumprem na página. O número é o contraste contra o fundo base.',
    secaoCores(ds), ds.cores.length);

  if ((comp.botoes || []).length) {
    add('botoes', 'Botões', 'Botões e chamadas',
      'Markup real da página. Passe o mouse: o estado de hover é o do site, não uma captura de tela.',
      grade(comp.botoes), comp.botoes.length);
  }
  if ((comp.links || []).length) {
    add('links', 'Links', 'Links', 'Links de texto, com o sublinhado e a transição originais.',
      grade(comp.links), comp.links.length);
  }
  const form = [...(comp.formularios || []), ...(comp.campos || [])];
  if (form.length) {
    add('formularios', 'Formulários', 'Campos e formulários',
      'Estados de foco e placeholder como o site define.', grade(form), form.length);
  }

  add('icones', 'Ícones', 'Ícones',
    '', secaoIcones(p), (p.icones || []).length);

  const cartoes = comp.cartoes || [];
  if (cartoes.length) {
    add('cartoes', 'Cartões', 'Cartões',
      'Superfícies com conteúdo composto, como imagem e texto ou título e descrição. Vêm com a cadeia de ancestrais que a cascata precisa.',
      grade(cartoes), cartoes.length);
  }

  const blocos = [
    ...(comp.navegacao || []), ...(comp.listas || []),
    ...(comp.tabelas || []), ...(comp.citacoes || []), ...(comp.midia || []), ...(comp.rodape || [])
  ];
  if (blocos.length) {
    add('componentes', 'Componentes', 'Componentes',
      'Navegação, listas, mídia e rodapé, no markup original.',
      grade(blocos), blocos.length);
  }

  add('sliders', 'Sliders', 'Sliders e esteiras',
    '', secaoSliders(comp), (comp.sliders || []).length);

  add('layout', 'Layout', 'Layout e grade',
    'A estrutura invisível: onde o conteúdo para, em quantas colunas ele se organiza e quanto ar cada seção respira.',
    secaoLayout(p));

  add('efeitos', 'Efeitos', 'Efeitos', 'Raios, sombras e gradientes com os valores do site.',
    secaoEfeitos(ds));
  add('movimento', 'Movimento', 'Movimento', '', secaoMovimento(ds, libs));
  add('espacamento', 'Espaçamento', 'Espaçamento', '', secaoEspacamento(ds));
  add('breakpoints', 'Breakpoints', 'Breakpoints',
    'Os pontos de virada declarados no CSS baixado.', secaoBreakpoints(ds), ds.breakpoints.length);
  add('tokens', 'Tokens', 'Tokens', '', secaoTokens(ds), Object.keys(ds.variaveis || {}).length);

  const htmlCls = [doc.htmlClasse || '', 'xtr-ds'].filter(Boolean).join(' ');
  const htmlAttrs = Object.entries(doc.htmlAtributos || {})
    .filter(([k]) => k !== 'lang' && k !== 'class')
    .map(([k, v]) => ` ${esc(k)}="${esc(v)}"`).join('');
  const bodyAttrs = Object.entries(doc.bodyAtributos || {})
    .map(([k, v]) => ` ${esc(k)}="${esc(v)}"`).join('');

  return `<!DOCTYPE html>
<html lang="${esc(doc.lang || 'pt-BR')}" class="${esc(htmlCls)}"${htmlAttrs}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Design System de ${esc(doc.titulo || origem)}</title>
<!--
  Gerado pelo Extrator de Sites.
  Os estilos abaixo são os do site capturado, na ordem original. O JavaScript de
  aplicação fica de fora de propósito: React/Next tentariam hidratar uma árvore
  que não é a que eles geraram e apagariam a página. Só bibliotecas de animação
  autônomas entram.
-->
${folhas}
<style>${chrome(ds)}</style>
</head>
<body class="${esc(doc.bodyClasse || '')}"${bodyAttrs}>
<div class="xtr-nav" role="navigation" aria-label="Seções do design system">
  <span class="xtr-marca">Design System</span>
  ${nav.join('\n  ')}
</div>
${heroHtml}
<div class="xtr-doc">
${secoes.join('\n')}
</div>
<div class="xtr-rodape">
  Extraído de <a href="${esc(origem)}">${esc(origem)}</a> em ${esc(geradoEm)}.
  Tema ${esc(ds.resumo.tema)}, contraste base ${esc(ds.resumo.contrastePrincipal)}:1.
  Os tokens em formato de arquivo estão em <a href="design-system/tokens.css">design-system/tokens.css</a>
  e <a href="design-system/tokens.json">tokens.json</a>.
</div>
${scripts}
<script>${ESPIA}</script>
</body>
</html>`;
}
