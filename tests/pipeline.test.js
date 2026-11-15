/*
 * Captura de ponta a ponta, com o Chrome e a rede simulados.
 *
 * Não substitui testar no navegador: a reescrita de HTML (que depende de
 * DOMParser) é trocada por uma versão que devolve o HTML como veio. O que
 * este teste garante é que as fases da captura continuam ligadas umas às
 * outras e produzem o conjunto esperado de arquivos.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SITE = 'https://site.com/';
const b = (s) => new TextEncoder().encode(s);

const REDE = {
  'https://site.com/': ['text/html; charset=utf-8', '<!doctype html><title>Site</title><link rel="stylesheet" href="/css/site.css"><script src="/js/app.js"></script>'],
  'https://site.com/css/site.css': ['text/css', '@font-face{font-family:X;src:url(../fonts/x.woff2)} body{background:url("/img/fundo.png")}'],
  'https://site.com/fonts/x.woff2': ['font/woff2', 'WOFF'],
  'https://site.com/img/fundo.png': ['image/png', 'PNG'],
  'https://site.com/js/app.js': ['text/javascript', '"use strict";import "./util.js";new Worker("/js/worker.js");load("/models/cena.gltf");'],
  'https://site.com/js/util.js': ['text/javascript', 'export const x = 1;'],
  'https://site.com/js/worker.js': ['text/javascript', '"use strict";self.onmessage=()=>{};'],
  'https://site.com/models/cena.gltf': ['model/gltf+json', '{"buffers":[{"uri":"cena.bin"}]}'],
  'https://site.com/models/cena.bin': ['application/octet-stream', 'BIN'],
  'https://cdn.com/gsap.min.js': ['text/javascript', 'var gsap={};'],
  'https://site.com/video.mp4': ['video/mp4', 'MP4']
};

const COLETA = {
  ok: true, title: 'Site', snapshot: '<html><body>renderizado</body></html>',
  runtimeUrls: ['https://site.com/js/app.js', 'https://site.com/js/worker.js', 'https://cdn.com/gsap.min.js',
    'https://site.com/video.mp4', 'https://www.google-analytics.com/analytics.js', 'https://site.com/quebrado.png'],
  domUrls: ['https://site.com/css/site.css'],
  workers: ['https://site.com/js/worker.js'],
  bodies: [{ key: 'GET|https://site.com/api/dados', ct: 'application/json', b64: 'e30=' }],
  libs: ['gsap'], links: ['https://site.com/sobre']
};

function simularAmbiente() {
  globalThis.chrome = {
    runtime: {
      lastError: null,
      getURL: (p) => 'ext://' + p,
      sendMessage: async () => ({ ok: true })
    },
    tabs: {
      get: async () => ({ id: 1, url: SITE, status: 'complete', windowId: 1, active: true }),
      query: async () => [{ id: 1 }],
      update: async () => {},
      reload: async () => {},
      onUpdated: { addListener() {}, removeListener() {} },
      sendMessage(tabId, msg, cb) {
        const r = {
          ping: { ok: true },
          autoscroll: { ok: true, repouso: 2 },
          collect: COLETA,
          design: { ok: false }
        }[msg.type];
        queueMicrotask(() => cb(r));
      }
    }
  };
  globalThis.fetch = async (url) => {
    url = String(url);
    if (url.startsWith('ext://')) return new Response(await readFile(new URL('../' + url.slice(6), import.meta.url)));
    const r = REDE[url];
    if (!r) return new Response('nada', { status: 404, headers: { 'content-type': 'text/plain' } });
    return new Response(b(r[1]), { status: 200, headers: { 'content-type': r[0] } });
  };
}

test('captura de uma página gera a cópia completa', async () => {
  simularAmbiente();
  mock.module('../src/rewrite/html.js', {
    exports: {
      discoverHtmlUrls: (html) => ({
        found: [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => new URL(m[1], SITE).href),
        links: []
      }),
      rewriteHtml: ({ html }) => html
    }
  });
  const { runCapture } = await import('../src/capture/index.js');

  const arquivos = new Map();
  const logs = [];
  const etapas = [];
  const resultado = await runCapture({
    tabId: 1,
    startUrl: SITE,
    options: { reload: false, includeMedia: false, plataforma: 'windows' },
    sink: {
      write: async (path, data, exec) => { arquivos.set(path, { data, exec }); },
      finish: async () => ({ destino: 'teste' })
    },
    ui: {
      stage: (nome, chave) => etapas.push(chave),
      log: (nivel, texto) => logs.push(`${nivel}: ${texto}`),
      progress: () => {}
    }
  });

  const texto = (p) => new TextDecoder().decode(arquivos.get(p).data);
  const erros = logs.filter((l) => l.startsWith('error'));
  assert.deepEqual(erros, [], logs.join('\n'));

  assert.deepEqual(etapas, ['paginas', 'recursos', 'reescrita', 'runtime', 'gravacao']);
  assert.deepEqual([...arquivos.keys()].sort(), [
    'ABRIR SITE.cmd',
    'LEIA-ME.txt',
    '__offline/api-cache.js',
    '__offline/relatorio.json',
    '__offline/runtime.js',
    '__offline/servidor.py',
    '__offline/worker-runtime.js',
    '_ext/cdn.com/gsap.min.js',
    'css/site.css',
    'fonts/x.woff2',
    'img/fundo.png',
    'index.html',
    'index.snapshot.html',
    'js/app.js',
    'js/util.js',
    'js/worker.js',
    'models/cena.bin',
    'models/cena.gltf'
  ]);

  // reescrita de CSS e de módulos
  assert.ok(texto('css/site.css').includes("url('../fonts/x.woff2')"));
  assert.ok(texto('css/site.css').includes("url('../img/fundo.png')"));
  // o worker recebe a camada offline depois do "use strict"
  assert.match(texto('js/worker.js'), /^"use strict";\n\/\* injetado[^]*importScripts/);
  // o mapa de URLs vai embutido no runtime
  assert.ok(texto('__offline/runtime.js').includes('https://site.com/css/site.css'));
  assert.ok(texto('__offline/api-cache.js').includes('GET|https://site.com/api/dados'));

  const relatorio = JSON.parse(texto('__offline/relatorio.json'));
  assert.equal(relatorio.paginas.length, 1);
  assert.equal(relatorio.recursos, 9);
  // rastreador nem entra na fila; o 404 e o vídeo (mídia desligada) viram falha registrada
  assert.deepEqual(relatorio.falhas.map((f) => f.url), ['https://site.com/quebrado.png']);

  assert.equal(resultado.destino, 'teste');
  assert.equal(resultado.paginas, 1);
  assert.equal(resultado.arquivos, arquivos.size);
});
