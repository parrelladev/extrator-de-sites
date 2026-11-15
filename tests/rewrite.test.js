import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverCssUrls, rewriteCss } from '../src/rewrite/css.js';
import { rewriteModuleSpecifiers, discoverAssetsInJs, rewriteQuotedUrls } from '../src/rewrite/js.js';

// html.js fica de fora: depende de DOMParser, que só existe no navegador.

const MAPA = {
  'https://site.com/fonts/a.woff2': 'fonts/a.woff2',
  'https://site.com/img/fundo.png': 'img/fundo.png',
  'https://site.com/css/base.css': 'css/base.css',
  'https://cdn.com/lib/three.module.js': '_ext/cdn.com/lib/three.module.js',
  'https://site.com/js/util.js': 'js/util.js'
};
const lookup = (u) => MAPA[u] || null;

test('discoverCssUrls acha url(), @import e ignora data:', () => {
  const css = `
    @import "base.css";
    @font-face { src: url('../fonts/a.woff2') format('woff2'); }
    .a { background: url(/img/fundo.png#x); }
    .b { background: url(data:image/png;base64,AAAA); }`;
  const urls = discoverCssUrls(css, 'https://site.com/css/site.css');
  assert.deepEqual([...urls].sort(), [
    'https://site.com/css/base.css',
    'https://site.com/fonts/a.woff2',
    'https://site.com/img/fundo.png'
  ]);
});

test('rewriteCss aponta para o arquivo local e preserva o que não conhece', () => {
  const css = `.a{background:url("/img/fundo.png")}.b{background:url(/img/outra.png)}.c{background:url(data:image/gif;base64,AA)}`;
  const out = rewriteCss(css, 'https://site.com/css/site.css', 'css/site.css', lookup);
  assert.ok(out.includes("url('../img/fundo.png')"), out);
  assert.ok(out.includes('url(/img/outra.png)'), out);
  assert.ok(out.includes('url(data:image/gif;base64,AA)'), out);
});

test('rewriteCss em modo absoluto emite caminho a partir da raiz', () => {
  const out = rewriteCss('.a{background:url(/img/fundo.png)}', 'https://site.com/', 'index.html', lookup, true);
  assert.ok(out.includes("url('/img/fundo.png')"), out);
});

test('rewriteModuleSpecifiers troca imports conhecidos e deixa bare specifiers', () => {
  const code = `import * as THREE from "https://cdn.com/lib/three.module.js";\nimport { x } from './util.js';\nimport gsap from "gsap";\nconst m = import('./util.js');`;
  const r = rewriteModuleSpecifiers(code, 'https://site.com/js/app.js', 'js/app.js', lookup);
  assert.ok(r.changed >= 2, String(r.changed));
  assert.ok(r.code.includes('../_ext/cdn.com/lib/three.module.js'), r.code);
  assert.ok(r.code.includes('from "gsap"'), r.code);
  assert.ok(!r.code.includes('https://cdn.com'), r.code);
});

test('discoverAssetsInJs acha assets citados em strings', () => {
  const code = `loader.load("/models/cena.glb"); const t = "/img/textura.webp";`;
  const urls = [...discoverAssetsInJs(code, 'https://site.com/js/app.js', 'https://site.com/')];
  assert.ok(urls.includes('https://site.com/models/cena.glb'), urls.join());
  assert.ok(urls.includes('https://site.com/img/textura.webp'), urls.join());
});

test('rewriteQuotedUrls troca URLs conhecidas, inclusive com barras escapadas de JSON', () => {
  const json = `{"a":"https://site.com/img/fundo.png","b":"https:\\/\\/site.com\\/img\\/fundo.png","c":"https://site.com/nao-baixado.png"}`;
  const out = rewriteQuotedUrls(json, 'https://site.com/', 'index.html', lookup);
  assert.ok(!out.includes('"https://site.com/img/fundo.png"'), out);
  assert.ok(!out.includes('https:\\/\\/site.com\\/img'), out);
  assert.ok(out.includes('https://site.com/nao-baixado.png'), out);
  JSON.parse(out); // continua JSON válido
});
