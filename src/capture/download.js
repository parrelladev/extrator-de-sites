/*
 * download.js — fase 2: baixa os recursos da fila, descobrindo novos a cada
 * rodada (CSS -> fontes, JS -> modelos, HTML de iframe -> mais assets).
 */

import { pool, kindOf, decodeText, stripHash, formatBytes } from '../shared/util.js';
import { discoverCssUrls } from '../rewrite/css.js';
import { discoverHtmlUrls } from '../rewrite/html.js';
import { discoverAssetsInJs } from '../rewrite/js.js';

const MEDIA_KINDS = new Set(['video', 'audio']);

export async function baixarRecursos(ctx) {
  const { startUrl, opts, ui, map, fetcher, resources, failures, enqueue } = ctx;

  ui.stage('Baixando recursos', 'recursos');
  let round = 0;
  let fetched = 0;

  while (ctx.queue.size && round < 12) {
    round++;
    const batch = [...ctx.queue];
    ctx.queue = new Set();
    ui.log('info', `Rodada ${round}: ${batch.length} recursos.`);

    await pool(batch, opts.concurrency, async (url) => {
      if (resources.has(url)) return;
      const res = await fetcher.get(url, { referrer: startUrl });
      fetched++;

      if (!res.ok || !res.bytes) {
        failures.push({ url, error: res.error || 'falhou', status: res.status });
        ui.progress({ fetched, total: fetched + ctx.queue.size, failed: failures.length, bytes: fetcher.stats.bytes });
        return;
      }

      const kind = kindOf(res.contentType, new URL(url).pathname);
      if (!opts.includeMedia && MEDIA_KINDS.has(kind)) {
        failures.push({ url, error: 'midia ignorada por opcao', skipped: true });
        return;
      }

      const localPath = map.assign(url, kind, res.contentType);
      if (res.finalUrl && stripHash(res.finalUrl) !== url) map.alias(stripHash(res.finalUrl), localPath);

      const rec = { url, kind, contentType: res.contentType, bytes: res.bytes, localPath };
      resources.set(url, rec);

      // descoberta recursiva
      try {
        if (kind === 'css') {
          const text = decodeText(res.bytes, res.contentType);
          rec.text = text;
          for (const u of discoverCssUrls(text, url)) enqueue(u, url);
        } else if (kind === 'js') {
          const text = decodeText(res.bytes, res.contentType);
          rec.text = text;
          if (opts.deepScanJs) {
            for (const u of discoverAssetsInJs(text, url, startUrl)) enqueue(u, url);
          }
        } else if (kind === 'document') {
          const text = decodeText(res.bytes, res.contentType);
          rec.text = text;
          const d = discoverHtmlUrls(text, url);       // iframes
          for (const u of d.found) enqueue(u, url);
        } else if (/\.gltf(\?|$)/i.test(url)) {
          // (kindOf classifica .gltf como 'model' pela extensao, nunca 'json')
          // .gltf referencia .bin e texturas por caminho relativo
          const text = decodeText(res.bytes, res.contentType);
          rec.text = text;
          const re = /"uri"\s*:\s*"([^"]+)"/g;
          let m;
          while ((m = re.exec(text)) !== null) {
            if (!/^data:/i.test(m[1])) enqueue(m[1], url);
          }
        } else if (kind === 'json' && /manifest|webmanifest/i.test(url)) {
          const text = decodeText(res.bytes, res.contentType);
          rec.text = text;
          const re = /"src"\s*:\s*"([^"]+)"/g;
          let m;
          while ((m = re.exec(text)) !== null) enqueue(m[1], url);
        }
      } catch (e) {
        ui.log('warn', `Analise de ${url} falhou: ${e.message}`);
      }

      ui.progress({ fetched, total: fetched + ctx.queue.size, failed: failures.length, bytes: fetcher.stats.bytes });
    });
  }

  ui.log('ok', `${resources.size} recursos baixados (${formatBytes(fetcher.stats.bytes)}), ${failures.length} falhas.`);
}
