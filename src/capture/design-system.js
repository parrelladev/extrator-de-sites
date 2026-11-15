/*
 * design-system.js — junta o que foi lido das paginas e do CSS baixado e
 * acrescenta os arquivos do design system a copia.
 */

import { encodeText } from '../shared/util.js';
import { rewriteHtml } from '../rewrite/html.js';
import {
  mesclarColetas, analisarCssBaixado, construirDesignSystem,
  gerarTokensCss, extrairFontesLocais
} from '../design/design.js';
import { gerarPaginaViva } from '../design/page.js';

/** @returns {object|null} resumo do que foi extraido, ou null se nada foi gerado */
export function gerarDesignSystem(ctx, { files, lookup, hasApiCache }) {
  const {
    startUrl, opts, ui, map, resources, pages, failures,
    coletasDesign, padroesRef, libsVistas
  } = ctx;

  let dsResumo = null;
  if (opts.designSystem && coletasDesign.length) {
    ui.stage('Extraindo design system', 'design');
    try {
      const cssBaixado = [...resources.values()]
        .filter((r) => r.kind === 'css' && r.text)
        .map((r) => ({ url: r.url, localPath: r.localPath, text: r.text }));

      const runtime = mesclarColetas(coletasDesign);
      const estatico = analisarCssBaixado(cssBaixado);
      const fontesLocais = extrairFontesLocais(cssBaixado, (u) => map.get(u));

      const ds = construirDesignSystem({
        runtime, estatico, fontesLocais,
        origem: startUrl,
        paginas: pages.map((p) => p.url),
        geradoEm: new Date().toLocaleString('pt-BR')
      });

      files.push({ path: 'design-system/tokens.css', data: encodeText(gerarTokensCss(ds)) });
      files.push({ path: 'design-system/tokens.json', data: encodeText(JSON.stringify(ds, null, 2)) });

      // A biblioteca viva mora na raiz, ao lado do index.html, e carrega o CSS
      // e as imagens do proprio site. Sai daqui com URLs absolutas da web e
      // passa pela mesma reescrita das paginas — so que pedindo caminho
      // relativo, porque este e o arquivo que o usuario abre com duplo clique.
      if (padroesRef) {
        try {
          const bruta = gerarPaginaViva({
            ds, padroes: padroesRef, origem: startUrl,
            libs: [...libsVistas],
            geradoEm: new Date().toLocaleString('pt-BR')
          });
          let viva;
          try {
            viva = rewriteHtml({
              html: bruta, docUrl: startUrl, docLocal: 'design-system.html',
              lookup,
              opts: { apiCache: hasApiCache, stripCrossOrigin: true, caminhos: 'relativo' }
            });
          } catch (e) {
            ui.log('warn', `Reescrita da biblioteca viva falhou (${e.message}); salvando com URLs originais.`);
            viva = bruta;
          }
          files.push({ path: 'design-system.html', data: encodeText(viva) });
          ui.log('ok', 'design-system.html gerado com o CSS do proprio site.');
        } catch (e) {
          ui.log('error', `Biblioteca viva falhou: ${e.message}`);
          failures.push({ url: 'design-system.html', error: e.message });
        }
      } else {
        ui.log('warn', 'Sem fragmentos da pagina: design-system.html nao foi gerado.');
      }

      dsResumo = {
        cores: ds.cores.length,
        estilosTexto: ds.tipografia.estilos.length,
        familias: ds.tipografia.familias.length,
        fontes: fontesLocais.length,
        variaveis: Object.keys(ds.variaveis).length,
        breakpoints: ds.breakpoints.length,
        tema: ds.resumo.tema,
        bibliotecaViva: !!padroesRef,
        hero: !!(padroesRef && padroesRef.hero),
        componentes: padroesRef
          ? Object.values(padroesRef.componentes || {}).reduce((t, x) => t + (x ? x.length : 0), 0)
          : 0,
        icones: padroesRef ? (padroesRef.icones || []).length : 0,
        sliders: padroesRef ? ((padroesRef.componentes || {}).sliders || []).length : 0,
        bibliotecas: [...libsVistas]
      };
      ui.log('ok', `Design system: ${dsResumo.cores} cores, ${dsResumo.estilosTexto} estilos de texto, ` +
                   `${dsResumo.variaveis} variáveis, ${dsResumo.fontes} fontes.`);
    } catch (e) {
      ui.log('error', `Extração do design system falhou: ${e.message}`);
      failures.push({ url: 'design-system', error: e.message });
    }
  }

  return dsResumo;
}
