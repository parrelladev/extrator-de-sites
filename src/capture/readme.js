/* readme.js — o LEIA-ME.txt que acompanha cada copia. */

import { formatBytes } from '../shared/util.js';

export function buildReadme({ startUrl, pages, resources, failures, fetcher, opts, dsResumo }) {
  const L = [];
  const ehWindows = opts.plataforma === 'windows';
  const atalho = ehWindows ? 'ABRIR SITE.cmd' : 'ABRIR SITE.command';
  L.push('SITE BAIXADO COM O "EXTRATOR DE SITES"');
  L.push('='.repeat(60));
  L.push('');
  L.push(`Origem : ${startUrl}`);
  L.push(`Data   : ${new Date().toLocaleString('pt-BR')}`);
  L.push(`Paginas: ${pages.length}`);
  L.push(`Assets : ${resources.size} (${formatBytes(fetcher.stats.bytes)})`);
  L.push(`Falhas : ${failures.length}`);
  L.push('');
  L.push('COMO ABRIR');
  L.push('-'.repeat(60));
  L.push('');
  L.push(`Execute o arquivo "${atalho}" que esta nesta pasta.`);
  L.push('');
  L.push('Ele encontra o Python, sobe o servidor na primeira porta livre e abre');
  L.push('o site no navegador sozinho. E o unico arquivo que voce precisa tocar.');
  L.push('');
  if (!ehWindows) {
    L.push('NA PRIMEIRA VEZ o macOS vai bloquear, com o aviso de que a Apple nao');
    L.push('pode verificar o arquivo. Nao e problema da captura: o sistema marca');
    L.push('como suspeito tudo que um navegador grava, e recusa executar script');
    L.push('sem assinatura. Contorne uma vez pelo Terminal, onde a trava nao vale:');
    L.push('');
    L.push('  1. Abra o Terminal');
    L.push('  2. Digite  bash  e um espaco');
    L.push(`  3. Arraste o "${atalho}" para dentro da janela`);
    L.push('  4. Enter');
    L.push('');
    L.push('O script desfaz o bloqueio em si mesmo. A partir da segunda vez o');
    L.push('duplo clique funciona normalmente.');
    L.push('');
  }
  L.push('Nao abra o index.html com dois cliques. O navegador bloqueia, em');
  L.push('paginas abertas direto do disco, exatamente o que um site 3D usa:');
  L.push('modulos ES, fetch() de modelos .glb, texturas WebGL e fontes.');
  L.push('');
  L.push('O servidor tambem cobre a navegacao de SPA: se o site usa Next.js,');
  L.push('Nuxt ou SvelteKit e o roteador pedir "/sobre" de volta ao servidor,');
  L.push('ele entrega o arquivo certo em vez de uma pagina de erro.');
  L.push('');
  L.push('ESTRUTURA');
  L.push('-'.repeat(60));
  L.push('');
  L.push(`  ${atalho}${' '.repeat(Math.max(1, 22 - atalho.length))}inicia o servidor e abre o site`);
  L.push('  index.html            pagina principal');
  L.push('  _ext/<dominio>/       arquivos que vinham de CDNs (GSAP, fontes...)');
  L.push('  __offline/runtime.js  camada que redireciona as URLs para os');
  L.push('                        arquivos locais em tempo de execucao');
  L.push('  __offline/servidor.py motor do servidor local');
  L.push('  __offline/relatorio.json  o que foi baixado e o que falhou');
  L.push('  design-system.html    o design system montado com o CSS do proprio site');
  L.push('  design-system/        os tokens: tokens.css e tokens.json');
  if (opts.saveSnapshot) {
    L.push('  *.snapshot.html       DOM ja renderizado (referencia; as animacoes');
    L.push('                        de verdade estao no index.html)');
  }
  L.push('');
  if (failures.length) {
    L.push('FALHAS');
    L.push('-'.repeat(60));
    L.push('');
    L.push('Estes recursos nao vieram. Em geral sao rastreadores, endpoints que');
    L.push('exigem login ou arquivos acima do limite de tamanho configurado.');
    L.push('O site costuma funcionar sem eles.');
    L.push('');
    for (const f of failures.slice(0, 60)) L.push(`  [${f.status || '-'}] ${f.url}: ${f.error}`);
    if (failures.length > 60) L.push(`  ... e mais ${failures.length - 60}.`);
    L.push('');
  }
  if (dsResumo) {
    L.push('DESIGN SYSTEM');
    L.push('-'.repeat(60));
    L.push('');
    L.push('  http://localhost:<porta>/design-system.html');
    L.push('');
    L.push('E uma biblioteca viva, nao um relatorio: o hero clonado do site com o');
    L.push('texto trocado para apresentar o proprio design system, a tipografia com');
    L.push('as tags e classes originais, e cada componente pintado pelo CSS do site.');
    L.push('Nada foi redesenhado nem aproximado.');
    L.push('');
    L.push('Abra pelo servidor, nao com dois cliques: a pagina carrega as folhas de');
    L.push('estilo do site por caminho absoluto.');
    L.push('');
    L.push('O JavaScript de aplicacao fica de fora de proposito. React e Next');
    L.push('tentariam hidratar uma arvore que nao e a que eles geraram e apagariam');
    L.push('a pagina. Por isso o que depende de script (canvas 3D, carrossel) aparece');
    L.push('parado, no estado em que estava na hora da captura.');
    L.push('');
    L.push('Em design-system/ ficam tokens.css, pronto para colar num projeto, e');
    L.push('tokens.json com tudo.');
    L.push('');
  }
  L.push('DIAGNOSTICO');
  L.push('-'.repeat(60));
  L.push('');
  L.push('Se algo nao aparecer, abra o console do navegador (F12) e rode:');
  L.push('');
  L.push('  __XTR_OFFLINE__.stats        // quantas URLs foram redirecionadas');
  L.push('  __XTR_OFFLINE__.resolve(u)   // para onde uma URL aponta agora');
  L.push('');
  L.push('Um numero alto em "misses" indica assets que nao chegaram a ser');
  L.push('baixados: capture de novo com mais passadas de rolagem.');
  L.push('');
  return L.join('\n');
}
