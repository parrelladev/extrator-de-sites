import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { UrlMap, OFFLINE_DIR } from '../src/capture/urlmap.js';
import { ZipWriter } from '../src/capture/zip.js';

test('UrlMap: a página inicial vira index.html e CDNs vão para uma pasta separada', () => {
  const map = new UrlMap('https://site.com/');
  assert.equal(map.assign('https://site.com/', 'document'), 'index.html');
  const css = map.assign('https://site.com/css/site.css?v=3', 'css');
  assert.match(css, /^css\/site.*\.css$/);
  const cdn = map.assign('https://cdn.com/lib/gsap.min.js', 'js');
  assert.ok(cdn.includes('cdn.com') && !cdn.startsWith('lib/'), cdn);
});

test('UrlMap: assign é idempotente, get ignora o fragmento, alias aponta para o mesmo arquivo', () => {
  const map = new UrlMap('https://site.com/');
  const a = map.assign('https://site.com/img/a.png', 'image');
  assert.equal(map.assign('https://site.com/img/a.png', 'image'), a);
  assert.equal(map.get('https://site.com/img/a.png#x'), a);
  assert.equal(map.get('https://site.com/nao-existe.png'), null);
  map.alias('https://site.com/redirecionado.png', a);
  assert.equal(map.get('https://site.com/redirecionado.png'), a);
  assert.equal(map.has('https://site.com/redirecionado.png'), true);
});

test('UrlMap: URLs diferentes nunca recebem o mesmo caminho', () => {
  const map = new UrlMap('https://site.com/');
  const urls = [
    'https://site.com/a.js', 'https://site.com/a.js?v=1', 'https://site.com/a.js?v=2',
    'https://site.com/A.js', 'https://site.com/sobre', 'https://site.com/sobre/',
    `https://site.com/${OFFLINE_DIR}/runtime.js`
  ];
  const paths = urls.map((u) => map.assign(u, 'js').toLowerCase());
  assert.equal(new Set(paths).size, urls.length, paths.join(' | '));
  // o site não pode sobrescrever a camada offline que geramos
  assert.ok(!paths[paths.length - 1].startsWith(`${OFFLINE_DIR}/`.toLowerCase()));
});

test('UrlMap: resolveDirFileConflicts não deixa um caminho ser arquivo e pasta ao mesmo tempo', () => {
  const map = new UrlMap('https://site.com/');
  map.assign('https://site.com/docs', 'other');
  map.assign('https://site.com/docs/guia.pdf', 'other');
  map.resolveDirFileConflicts();
  const paths = [...map.byKey.values()];
  for (const p of paths) {
    assert.ok(!paths.some((q) => q !== p && q.startsWith(p + '/')), `${p} é arquivo e pasta`);
  }
});

test('ZipWriter gera um .zip que descompacta de volta para os mesmos bytes', async () => {
  const zip = new ZipWriter();
  const texto = 'olá, mundo\n'.repeat(200);
  await zip.add('pasta/arquivo.txt', new TextEncoder().encode(texto));
  await zip.add('vazio.txt', new Uint8Array(0));
  const buf = Buffer.from(await zip.finish().arrayBuffer());

  // fim do diretório central
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0);
  assert.equal(buf.readUInt16LE(eocd + 10), 2);

  // primeiro arquivo: cabeçalho local
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  const metodo = buf.readUInt16LE(8);
  const tamComp = buf.readUInt32LE(18);
  const tamNome = buf.readUInt16LE(26);
  const tamExtra = buf.readUInt16LE(28);
  assert.equal(buf.subarray(30, 30 + tamNome).toString('utf8'), 'pasta/arquivo.txt');
  const dados = buf.subarray(30 + tamNome + tamExtra, 30 + tamNome + tamExtra + tamComp);
  const original = metodo === 8 ? inflateRawSync(dados) : dados;
  assert.equal(original.toString('utf8'), texto);
});
