import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hash8, stripHash, ehRedePrivada, mesmoSite, safeUrl, sanitizeSegment, extOf,
  relativePath, relativeSpecifier, kindOf, decodeText, encodeText,
  formatBytes, pool, isAnalytics
} from '../src/shared/util.js';

test('hash8 é determinístico e tem 8 caracteres', () => {
  assert.equal(hash8('abc'), hash8('abc'));
  assert.notEqual(hash8('abc'), hash8('abd'));
  assert.match(hash8('abc'), /^[0-9a-z]{8}$/);
});

test('stripHash tira só o fragmento', () => {
  assert.equal(stripHash('https://a.com/x?y=1#topo'), 'https://a.com/x?y=1');
  assert.equal(stripHash('https://a.com/x'), 'https://a.com/x');
});

test('ehRedePrivada reconhece localhost e faixas internas', () => {
  for (const h of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.1', 'nas.local', '']) {
    assert.equal(ehRedePrivada(h), true, h);
  }
  for (const h of ['example.com', '8.8.8.8']) assert.equal(ehRedePrivada(h), false, h);
});

test('mesmoSite compara pelo domínio registrável', () => {
  assert.equal(mesmoSite('https://www.site.com/a', 'https://cdn.site.com/b'), true);
  assert.equal(mesmoSite('https://loja.site.com.br/', 'https://site.com.br/'), true);
  assert.equal(mesmoSite('https://site.com/', 'https://outro.com/'), false);
  assert.equal(mesmoSite('nao é url', 'https://site.com/'), false);
});

test('safeUrl resolve relativas e recusa esquemas que não são da web', () => {
  assert.equal(safeUrl('img/a.png', 'https://a.com/dir/pagina.html').href, 'https://a.com/dir/img/a.png');
  for (const s of ['', '#ancora', 'data:image/png;base64,AAAA', 'javascript:void(0)', 'mailto:a@b.c', 'blob:x']) {
    assert.equal(safeUrl(s, 'https://a.com/'), null, s);
  }
});

test('sanitizeSegment devolve um nome de arquivo válido no Windows', () => {
  const s = sanitizeSegment('a<b>:c"|?*\\d/e');
  assert.doesNotMatch(s, /[<>:"|?*\\/]/);
  assert.notEqual(sanitizeSegment('..'), '..');
});

test('extOf', () => {
  assert.equal(extOf('foto.JPG'), '.jpg');
  assert.equal(extOf('semextensao'), '');
});

test('relativePath e relativeSpecifier', () => {
  assert.equal(relativePath('css/site.css', 'fonts/a.woff2'), '../fonts/a.woff2');
  assert.equal(relativePath('index.html', 'css/site.css'), 'css/site.css');
  assert.equal(relativePath('a/b/c.js', 'a/b/d.js'), 'd.js');
  assert.equal(relativeSpecifier('a/b/c.js', 'a/b/d.js'), './d.js');
  assert.equal(relativeSpecifier('a/b/c.js', 'a/d.js'), '../d.js');
});

test('kindOf decide pelo content-type e, na falta, pela extensão', () => {
  assert.equal(kindOf('text/html; charset=utf-8', '/'), 'document');
  assert.equal(kindOf('text/css', '/a'), 'css');
  assert.equal(kindOf('', '/a.css'), 'css');
  // servidores mandam modelos 3D como octet-stream: a extensão ganha
  assert.equal(kindOf('application/octet-stream', '/cena.glb'), 'model');
});

test('decodeText respeita o charset e encodeText gera UTF-8', () => {
  const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café"
  assert.equal(decodeText(latin1, 'text/html; charset=iso-8859-1'), 'café');
  assert.equal(decodeText(encodeText('ação'), 'text/css'), 'ação');
});

test('formatBytes', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1048576), '5.0 MB');
});

test('pool processa tudo sem passar do limite de concorrência', async () => {
  let ativos = 0, pico = 0;
  const feitos = [];
  await pool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    ativos++; pico = Math.max(pico, ativos);
    await new Promise((r) => setTimeout(r, 5));
    feitos.push(n); ativos--;
  });
  assert.equal(feitos.length, 7);
  assert.ok(pico <= 3, `pico ${pico}`);
});

test('isAnalytics separa rastreadores de arquivos do site', () => {
  assert.equal(isAnalytics('https://www.google-analytics.com/analytics.js'), true);
  assert.equal(isAnalytics('https://www.googletagmanager.com/gtm.js?id=X'), true);
  assert.equal(isAnalytics('https://site.com/assets/app.js'), false);
});
