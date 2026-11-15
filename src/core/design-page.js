/*
 * design-page.js — a folha de estilo visual do design system extraído.
 *
 * O JSON é para máquinas e o CSS é para colar no projeto; esta página é para
 * olhar. Ela usa as fontes reais capturadas do site, então as amostras de
 * tipografia aparecem como no original, e cada cor vem com o contraste que ela
 * faz contra o fundo principal — que é a informação que decide se dá para usar.
 */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function selo(razao) {
  if (razao >= 7) return '<span class="selo bom">AAA</span>';
  if (razao >= 4.5) return '<span class="selo ok">AA</span>';
  if (razao >= 3) return '<span class="selo fraco">AA grande</span>';
  return '<span class="selo ruim">baixo</span>';
}

function blocoFontes(fontes) {
  // @font-face apontando para os arquivos que a captura trouxe, para as
  // amostras aparecerem na fonte de verdade.
  const out = [];
  for (const f of fontes || []) {
    if (!f.caminhos || !f.caminhos.length) continue;
    const src = f.caminhos
      // esta pagina mora em design-system/, um nivel abaixo dos arquivos
      .map((c) => `url("../${esc(c.caminho)}") format("${esc(c.formato || 'woff2')}")`)
      .join(', ');
    out.push(`@font-face{font-family:"${esc(f.familia)}";src:${src};` +
      (f.peso ? `font-weight:${esc(f.peso)};` : '') +
      (f.estilo ? `font-style:${esc(f.estilo)};` : '') +
      'font-display:swap;}');
  }
  return out.join('\n');
}

/* ───────────────────────────── seções ───────────────────────────────── */

function secaoCores(ds) {
  const papeis = [
    ['fundo', 'Fundos', 'As superfícies do site. A marcada como <b>base</b> é a do &lt;body&gt;: foi a escolha de quem fez o site, não um palpite estatístico.'],
    ['texto', 'Textos', 'Cores aplicadas sobre conteúdo textual. O selo mede o contraste contra o fundo base.'],
    ['acento', 'Acentos', 'Cores saturadas: botões, links, destaques e estados.'],
    ['borda', 'Bordas', 'Divisórias e contornos.']
  ];
  const partes = [];
  const base = ds.resumo.fundoPrincipal;

  for (const [papel, titulo, ajuda] of papeis) {
    let grupo = ds.cores.filter((c) => c.papel === papel);
    if (!grupo.length) continue;

    // a cor base vem primeiro entre os fundos, por mais que outra tenha peso maior
    if (papel === 'fundo') {
      grupo = [...grupo].sort((a, b) => (b.hex === base) - (a.hex === base));
    }

    partes.push(`<h3>${titulo} <em>${grupo.length}</em></h3><p class="ajuda">${ajuda}</p>`);
    partes.push('<div class="grade-cores">');
    for (const c of grupo.slice(0, 16)) {
      const ehBase = c.hex === base;
      // Julgar contraste só faz sentido onde o texto vai ficar por cima. Para
      // uma superfície, o número é informação; selo ali seria ruído com cara
      // de erro.
      const legibilidade = (papel === 'texto' || papel === 'acento')
        ? `<span title="contraste contra o fundo base">${c.contrasteNoFundo}:1 ${selo(c.contrasteNoFundo)}</span>`
        : (ehBase ? '<span class="base">fundo base</span>'
                  : `<span title="contraste contra o fundo base">${c.contrasteNoFundo}:1</span>`);
      partes.push(`
        <div class="cor${ehBase ? ' destacada' : ''}">
          <div class="amostra" style="background:${esc(c.hex)}"></div>
          <code>${esc(c.hex)}</code>
          <div class="meta">
            <span>hsl ${c.hsl.h} ${c.hsl.s}% ${c.hsl.l}%</span>
            ${legibilidade}
          </div>
        </div>`);
    }
    partes.push('</div>');
  }

  if (!ds.cores.some((c) => c.papel === 'acento')) {
    partes.push('<p class="ajuda">Nenhuma cor de acento saturada apareceu. O site trabalha em escala de cinza, ou os destaques estão dentro de imagens e canvas, fora do alcance do CSS.</p>');
  }
  return partes.join('');
}

function secaoTipografia(ds) {
  const t = ds.tipografia;
  const partes = [];

  if (t.familias.length) {
    partes.push('<h3>Famílias</h3>');
    partes.push('<div class="lista">');
    for (const f of t.familias) {
      partes.push(`<div class="linha">
        <div class="amostra-fonte" style="font-family:${esc(f.valor)}">Aa Bb Cc 123</div>
        <div><code>${esc(f.primeira)}</code><span class="sub">${esc(f.valor)}</span></div>
      </div>`);
    }
    partes.push('</div>');
  }

  if (t.estilos.length) {
    partes.push('<h3>Estilos de texto <em>' + t.estilos.length + '</em></h3>');
    partes.push('<p class="ajuda">Combinações de família, tamanho, peso e entrelinha que se repetem no site. A amostra é texto real da página.</p>');
    partes.push('<div class="estilos">');
    for (const e of t.estilos) {
      const amostra = e.amostra || 'Grumpy wizards make toxic brew';
      partes.push(`<div class="estilo">
        <div class="rotulo"><b>${esc(e.escala)}</b><code>${esc(e.tag)}</code><span>${e.n}×</span></div>
        <div class="demo" style="font-family:${esc(e.familia)};font-size:${esc(e.tamanho)};font-weight:${esc(e.peso)};line-height:${esc(e.altura)};letter-spacing:${esc(e.espacamento)};text-transform:${esc(e.transformacao)}">${esc(amostra)}</div>
        <div class="specs">
          <span>${esc(e.tamanho)}</span><span>peso ${esc(e.peso)}</span>
          <span>linha ${esc(e.altura)}</span>${e.espacamento && e.espacamento !== 'normal' ? `<span>tracking ${esc(e.espacamento)}</span>` : ''}
        </div>
      </div>`);
    }
    partes.push('</div>');
  }

  if (t.fontesLocais && t.fontesLocais.length) {
    partes.push('<h3>Arquivos de fonte capturados <em>' + t.fontesLocais.length + '</em></h3>');
    partes.push('<div class="tabela">');
    for (const f of t.fontesLocais.slice(0, 30)) {
      partes.push(`<div><code>${esc(f.familia)}</code><span>${esc(f.peso || '')} ${esc(f.estilo || '')}</span>
        <span class="sub">${esc((f.caminhos || []).map((c) => c.caminho).join(', ').slice(0, 90))}</span></div>`);
    }
    partes.push('</div>');
  }
  return partes.join('');
}

function secaoEspacamento(ds) {
  if (!ds.espacamento.length) return '';
  const maior = Math.max(...ds.espacamento.map((s) => parseFloat(s.valor) || 0), 1);
  const passo = ds.resumo.passoDeEspacamento;
  return `
    ${passo ? `<p class="ajuda">Os valores encaixam numa escala de <b>${passo}px</b>.</p>`
            : '<p class="ajuda">Não deu para deduzir uma escala regular. O site parece usar valores livres.</p>'}
    <div class="escala">
      ${ds.espacamento.map((s) => `
        <div class="passo">
          <div class="barra" style="width:${Math.max(2, (parseFloat(s.valor) / maior) * 100)}%"></div>
          <code>${esc(s.valor)}</code>
        </div>`).join('')}
    </div>`;
}

function secaoFormas(ds) {
  const partes = [];
  if (ds.raios.length) {
    partes.push('<h3>Raios de borda</h3><div class="formas">');
    for (const r of ds.raios.slice(0, 10)) {
      partes.push(`<div class="forma"><div class="quad" style="border-radius:${esc(r.valor)}"></div><code>${esc(r.valor)}</code></div>`);
    }
    partes.push('</div>');
  }
  if (ds.sombras.length) {
    partes.push('<h3>Sombras</h3><div class="formas">');
    for (const s of ds.sombras.slice(0, 8)) {
      partes.push(`<div class="forma"><div class="quad clara" style="box-shadow:${esc(s.valor)}"></div><code class="quebra">${esc(s.valor.slice(0, 46))}</code></div>`);
    }
    partes.push('</div>');
  }
  if (ds.gradientes.length) {
    partes.push('<h3>Gradientes</h3><div class="formas">');
    for (const g of ds.gradientes.slice(0, 6)) {
      partes.push(`<div class="forma"><div class="quad" style="background:${esc(g.valor)}"></div><code class="quebra">${esc(g.valor.slice(0, 46))}</code></div>`);
    }
    partes.push('</div>');
  }
  return partes.join('');
}

function secaoMovimento(ds) {
  const m = ds.movimento;
  if (!m.duracoes.length && !m.curvas.length && !m.keyframes.length) return '';
  const partes = [];

  if (m.duracoes.length || m.curvas.length) {
    partes.push('<p class="ajuda">Passe o mouse nas barras para ver a curva em movimento.</p>');
    partes.push('<div class="mov">');
    const curvas = m.curvas.length ? m.curvas : [{ valor: 'ease' }];
    m.duracoes.slice(0, 6).forEach((d, i) => {
      const c = (curvas[i % curvas.length] || {}).valor || 'ease';
      partes.push(`<div class="trilho" style="--d:${esc(d.valor)};--c:${esc(c)}">
        <div class="bolinha"></div>
        <div class="rot"><code>${esc(d.valor)}</code><span>${esc(c)}</span></div>
      </div>`);
    });
    partes.push('</div>');
  }

  if (m.keyframes.length) {
    partes.push(`<h3>Animações declaradas <em>${m.keyframes.length}</em></h3>`);
    partes.push('<div class="pastilhas">' +
      m.keyframes.slice(0, 40).map((k) => `<code>${esc(k)}</code>`).join('') + '</div>');
  }
  return partes.join('');
}

function secaoBreakpoints(ds) {
  if (!ds.breakpoints.length) return '';
  const maior = Math.max(...ds.breakpoints.map((b) => b.px), 1);
  return `<div class="bps">${ds.breakpoints.map((b) => `
    <div class="bp">
      <div class="regua"><span style="width:${(b.px / maior) * 100}%"></span></div>
      <code>${b.px}px</code><span class="sub">${esc(b.condicao)}</span>
    </div>`).join('')}</div>`;
}

function secaoVariaveis(ds) {
  const entradas = Object.entries(ds.variaveis);
  if (!entradas.length) return '';
  const cor = (v) => /^#|^rgb|^hsl/i.test(String(v).trim());
  return `
    <p class="ajuda">Custom properties declaradas pelo próprio site. Quando existem, costumam ser o design system oficial do projeto, com os nomes que a equipe usa.</p>
    <div class="vars">${entradas.slice(0, 200).map(([n, info]) => `
      <div class="var">
        ${cor(info.valor) ? `<i style="background:${esc(info.valor)}"></i>` : '<i class="vazio"></i>'}
        <code>${esc(n)}</code><span>${esc(String(info.valor).slice(0, 60))}</span>
      </div>`).join('')}</div>
    ${entradas.length > 200 ? `<p class="ajuda">…e mais ${entradas.length - 200}. A lista completa está em <code>tokens.json</code>.</p>` : ''}`;
}

/* ───────────────────────────── página ───────────────────────────────── */

export function gerarPaginaDesign(ds) {
  const nav = [
    ['cores', 'Cores'], ['tipografia', 'Tipografia'], ['espacamento', 'Espaçamento'],
    ['formas', 'Formas'], ['movimento', 'Movimento'], ['breakpoints', 'Breakpoints'],
    ['variaveis', 'Variáveis do site']
  ];

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Design system de ${esc(ds.origem)}</title>
<style>
${blocoFontes(ds.tipografia.fontesLocais)}

:root{
  color-scheme:dark;
  --bg:#0a0a0b; --sup:#121214; --sup2:#18181c;
  --linha:rgba(255,255,255,.07); --linha2:rgba(255,255,255,.13);
  --fg:#f4f4f5; --dim:#a1a1aa; --mute:#83838f;
  --ac:#ff8a3d; --ok:#5ee39b; --warn:#fbbf24; --err:#fb7185;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
  font:400 13.5px/1.6 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;
  -webkit-font-smoothing:antialiased}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}

header{padding:44px 40px 32px;border-bottom:1px solid var(--linha)}
h1{margin:0 0 8px;font-size:32px;font-weight:500;letter-spacing:-.035em}
.origem{color:var(--dim);font-size:14px;margin:0 0 24px}
.origem a{color:var(--ac);text-decoration:none}
.resumo{display:flex;flex-wrap:wrap;gap:10px}
.chip{background:var(--sup);border:1px solid var(--linha);border-radius:99px;
  padding:6px 14px;font-size:12px;color:var(--dim)}
.chip b{color:var(--fg);font-weight:550}

nav{position:sticky;top:0;z-index:10;display:flex;gap:4px;flex-wrap:wrap;
  padding:12px 40px;background:rgba(10,10,11,.92);backdrop-filter:blur(12px);
  border-bottom:1px solid var(--linha)}
nav a{color:var(--mute);text-decoration:none;font-size:12.5px;padding:6px 12px;border-radius:99px}
nav a:hover{color:var(--fg);background:var(--sup2)}

main{max-width:1180px;margin:0 auto;padding:8px 40px 80px}
section{padding:44px 0;border-bottom:1px solid var(--linha)}
section:last-child{border-bottom:0}
h2{margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:.16em;
  text-transform:uppercase;color:var(--mute)}
h3{margin:32px 0 6px;font-size:15px;font-weight:550;letter-spacing:-.01em}
h3:first-of-type{margin-top:20px}
h3 em{font-style:normal;color:var(--mute);font-weight:400;font-size:12px;margin-left:6px}
.ajuda{margin:0 0 18px;color:var(--mute);font-size:12.5px;max-width:70ch;line-height:1.65}

.grade-cores{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:12px;margin-bottom:8px}
.cor .amostra{height:76px;border-radius:10px;border:1px solid var(--linha2);margin-bottom:8px}
.cor code{display:block;margin-bottom:3px}
.cor .meta{display:flex;flex-direction:column;gap:2px;font-size:10.5px;color:var(--mute)}
.cor.destacada .amostra{border-color:var(--ac);box-shadow:0 0 0 1px var(--ac)}
.base{color:var(--ac);font-weight:600}
.selo{display:inline-block;padding:1px 5px;border-radius:4px;font-size:9.5px;font-weight:600;margin-left:3px}
.selo.bom{background:rgba(94,227,155,.15);color:var(--ok)}
.selo.ok{background:rgba(255,138,61,.15);color:var(--ac)}
.selo.fraco{background:rgba(251,191,36,.15);color:var(--warn)}
.selo.ruim{background:rgba(251,113,133,.15);color:var(--err)}

.lista .linha{display:flex;align-items:center;gap:20px;padding:14px 0;border-bottom:1px solid var(--linha)}
.amostra-fonte{font-size:26px;min-width:190px;letter-spacing:-.01em}
.sub{display:block;color:var(--mute);font-size:11.5px;margin-top:2px;word-break:break-all}

.estilos{display:grid;gap:2px}
.estilo{padding:18px 20px;background:var(--sup);border-radius:10px}
.rotulo{display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:11.5px;color:var(--mute)}
.rotulo b{color:var(--fg);font-size:12.5px}
.demo{margin-bottom:10px;color:var(--fg);overflow-wrap:anywhere}
.specs{display:flex;flex-wrap:wrap;gap:8px}
.specs span{font-size:10.5px;color:var(--mute);background:var(--sup2);padding:2px 8px;border-radius:99px}

.tabela{display:grid;gap:1px;background:var(--linha);border:1px solid var(--linha);border-radius:10px;overflow:hidden}
.tabela>div{background:var(--sup);padding:11px 16px;display:flex;gap:14px;align-items:baseline;flex-wrap:wrap}
.tabela span{font-size:11.5px;color:var(--mute)}

.escala{display:grid;gap:7px}
.passo{display:flex;align-items:center;gap:14px}
.passo .barra{height:14px;background:var(--ac);border-radius:3px;min-width:3px;opacity:.8}
.passo code{color:var(--mute);white-space:nowrap}

.formas{display:flex;flex-wrap:wrap;gap:18px;margin-bottom:8px}
.forma{text-align:center}
.forma .quad{width:84px;height:84px;background:var(--sup2);border:1px solid var(--linha2);margin-bottom:7px}
.forma .quad.clara{background:#e8e8ea;border:0}
.forma code{color:var(--mute);font-size:10.5px}
.quebra{display:block;max-width:110px;word-break:break-all;line-height:1.4}

.mov{display:grid;gap:14px;margin-bottom:8px}
.trilho{position:relative;height:38px;background:var(--sup);border-radius:8px;padding:0 12px;
  display:flex;align-items:center;cursor:pointer}
.bolinha{width:14px;height:14px;border-radius:50%;background:var(--ac);
  transition:transform var(--d) var(--c)}
.trilho:hover .bolinha{transform:translateX(calc(100% + 34vw))}
.rot{margin-left:auto;display:flex;gap:12px;align-items:baseline}
.rot span{font-size:11px;color:var(--mute)}

.pastilhas{display:flex;flex-wrap:wrap;gap:6px}
.pastilhas code{background:var(--sup2);padding:4px 10px;border-radius:99px;color:var(--dim)}

.bps{display:grid;gap:12px}
.bp .regua{height:5px;background:var(--sup2);border-radius:99px;margin-bottom:6px;overflow:hidden}
.bp .regua span{display:block;height:100%;background:var(--ac);opacity:.75}
.bp code{margin-right:10px}

.vars{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1px;
  background:var(--linha);border:1px solid var(--linha);border-radius:10px;overflow:hidden}
.var{background:var(--sup);padding:9px 14px;display:flex;align-items:center;gap:10px}
.var i{width:15px;height:15px;border-radius:4px;border:1px solid var(--linha2);flex:none}
.var i.vazio{background:var(--sup2)}
.var code{color:var(--ac);white-space:nowrap}
.var span{color:var(--mute);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

footer{padding:32px 40px 60px;color:var(--mute);font-size:12px;max-width:1180px;margin:0 auto;line-height:1.7}
footer code{color:var(--dim)}
@media (max-width:700px){header,nav,main,footer{padding-left:20px;padding-right:20px}}
@media (prefers-reduced-motion:reduce){*{transition-duration:.01ms!important}}
</style>
</head>
<body>

<header>
  <h1>Design system</h1>
  <p class="origem">extraído de <a href="${esc(ds.origem)}">${esc(ds.origem)}</a></p>
  <div class="resumo">
    <span class="chip">tema <b>${esc(ds.resumo.tema)}</b></span>
    <span class="chip">contraste base <b>${ds.resumo.contrastePrincipal}:1</b></span>
    <span class="chip"><b>${ds.cores.length}</b> cores</span>
    <span class="chip"><b>${ds.tipografia.estilos.length}</b> estilos de texto</span>
    <span class="chip"><b>${Object.keys(ds.variaveis).length}</b> variáveis</span>
    <span class="chip"><b>${ds.resumo.elementosAnalisados}</b> elementos analisados</span>
    <span class="chip"><b>${ds.paginas.length}</b> página(s)</span>
  </div>
</header>

<nav>${nav.map(([id, t]) => `<a href="#${id}">${t}</a>`).join('')}</nav>

<main>
  <section id="cores"><h2>Cores</h2>${secaoCores(ds)}</section>
  <section id="tipografia"><h2>Tipografia</h2>${secaoTipografia(ds)}</section>
  <section id="espacamento"><h2>Espaçamento</h2>${secaoEspacamento(ds)}</section>
  <section id="formas"><h2>Formas</h2>${secaoFormas(ds)}</section>
  <section id="movimento"><h2>Movimento</h2>${secaoMovimento(ds)}</section>
  <section id="breakpoints"><h2>Breakpoints</h2>${secaoBreakpoints(ds)}</section>
  <section id="variaveis"><h2>Variáveis do site</h2>${secaoVariaveis(ds)}</section>
</main>

<footer>
  Gerado pelo <b>Extrator de Sites</b> em ${esc(ds.geradoEm)}.<br>
  Os valores vêm dos estilos computados das páginas visitadas somados à leitura de
  ${ds.resumo.arquivosCss} arquivo(s) de CSS baixado. O peso de cada token é a área
  que ele ocupa na tela, não a contagem de elementos.<br><br>
  Ao lado deste arquivo: <code>tokens.css</code> para colar no projeto e
  <code>tokens.json</code> com os dados completos.
</footer>

</body>
</html>
`;
}
