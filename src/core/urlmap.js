/*
 * urlmap.js — decide o caminho local de cada URL e mantem o mapa reversivel.
 *
 * Layout gerado:
 *   index.html                    -> https://site.com/
 *   sobre/index.html              -> https://site.com/sobre
 *   assets/models/cena.glb        -> https://site.com/assets/models/cena.glb
 *   _ext/cdn.jsdelivr.net/x/y.js  -> https://cdn.jsdelivr.net/x/y.js
 *   __offline/runtime.js          -> gerado por nos
 *
 * Preservar a arvore de diretorios original nao e estetica: caminhos relativos
 * dentro de CSS e de ES modules continuam validos sem reescrita nenhuma.
 */

import { hash8, sanitizeSegment, extOf, extForKind, extForContentType, stripHash } from './util.js';

export const OFFLINE_DIR = '__offline';
export const EXT_DIR = '_ext';

// O que a propria captura grava na raiz. Nenhum arquivo do site pode ocupar
// esses nomes: um site que servisse /ABRIR%20SITE.cmd trocaria o atalho que o
// usuario vai executar por um script dele.
const NOMES_RESERVADOS = [
  OFFLINE_DIR, 'abrir site.command', 'abrir site.cmd', 'leia-me.txt',
  'design-system.html', 'design-system'
];

/*
 * Extensoes que o sistema executa com dois cliques (ou que o servidor local
 * tornaria executaveis). Um site nao precisa delas para funcionar, e salva-las
 * como vieram poria um executavel de terceiro, com nome convidativo, na pasta
 * do usuario. Ganham um ".txt" no fim: o conteudo continua la, inerte, e o
 * mapa de URLs segue apontando para ele.
 */
const EXT_EXECUTAVEIS = new Set([
  '.command', '.sh', '.bash', '.zsh', '.csh', '.ksh', '.fish', '.tool', '.terminal',
  '.app', '.pkg', '.mpkg', '.dmg', '.scpt', '.applescript', '.workflow', '.action',
  '.cmd', '.bat', '.exe', '.com', '.scr', '.pif', '.msi', '.msp', '.ps1', '.psm1',
  '.vbs', '.vbe', '.jse', '.wsf', '.wsh', '.hta', '.cpl', '.msc', '.lnk', '.reg',
  '.inf', '.url', '.jar', '.appimage', '.desktop', '.run', '.py', '.pyw', '.pyc',
  '.pl', '.rb', '.deb', '.rpm', '.apk', '.iso', '.img'
]);

/*
 * Parametros que frameworks anexam para pedir o payload de uma rota em vez do
 * HTML dela. Nao identificam uma pagina diferente — sao detalhe de transporte.
 *
 * Ignora-los importa mais do que parece: o Next.js faz prefetch de "/about"
 * como "/about?_rsc=19zvn", e sem isto a pagina seria salva como
 * "about~fb431ef4.html". Ai o link <a href="/about"> nao encontraria nada no
 * mapa, ficaria apontando para o site original, e a navegacao local quebraria.
 */
const FRAMEWORK_QS = new Set([
  '_rsc', 'rsc', '__flight__', '__nextdatareq', '__nextlocale',
  '_data', '_payload', '__nuxt_island', '_astro'
]);

export class UrlMap {
  /** @param {string} pageUrl URL da primeira pagina — define a origem "de casa". */
  constructor(pageUrl) {
    const u = new URL(pageUrl);
    this.origin = u.origin;
    this.host = u.host;
    this.byKey = new Map();       // key (url sem hash) -> localPath
    this.byPath = new Map();      // localPath (lower) -> key
    this.aliases = new Map();     // key extra (redirecionamentos) -> localPath
    // Reserva o que geramos, para o site nunca colidir com eles.
    for (const n of NOMES_RESERVADOS) this.byPath.set(n.toLowerCase(), '\0reserved');
  }

  static key(url) {
    return stripHash(String(url));
  }

  has(url) {
    const k = UrlMap.key(url);
    return this.byKey.has(k) || this.aliases.has(k);
  }

  /** Caminho local ja atribuido, ou null. */
  get(url) {
    const k = UrlMap.key(url);
    return this.byKey.get(k) || this.aliases.get(k) || null;
  }

  /** Registra que `url` (ex.: destino de redirecionamento) aponta ao mesmo arquivo. */
  alias(url, localPath) {
    const k = UrlMap.key(url);
    if (!this.byKey.has(k)) this.aliases.set(k, localPath);
  }

  /**
   * Atribui (ou devolve) o caminho local de uma URL.
   * @param {string} url
   * @param {string} kind  document|css|js|json|image|font|video|audio|wasm|model|other
   */
  assign(url, kind = 'other', contentType = '') {
    const k = UrlMap.key(url);
    const existing = this.byKey.get(k) || this.aliases.get(k);
    if (existing) return existing;

    let u = new URL(k);
    const isExternal = u.origin !== this.origin;

    // Documento pedido como payload de rota: nomeia pela rota limpa e deixa
    // a URL sem os parametros tambem apontando para o mesmo arquivo.
    let canonical = null;
    if (kind === 'document' && u.search) {
      const c = new URL(k);
      let mexeu = false;
      for (const p of [...c.searchParams.keys()]) {
        if (FRAMEWORK_QS.has(p.toLowerCase())) { c.searchParams.delete(p); mexeu = true; }
      }
      if (mexeu) {
        if (![...c.searchParams.keys()].length) c.search = '';
        // A rota limpa costuma estar em `aliases` (foi registrada por uma
        // captura anterior da mesma pagina com outro token), nao em `byKey`.
        const alvo = this.byKey.get(c.href) || this.aliases.get(c.href);
        if (alvo) { this.aliases.set(k, alvo); return alvo; }
        canonical = c.href;
        u = c;
      }
    }

    // --- diretorios ---
    const rawParts = u.pathname.split('/').filter((s) => s.length > 0);
    let dirs = rawParts.slice(0, -1).map(sanitizeSegment);
    let file = rawParts.length ? rawParts[rawParts.length - 1] : '';

    // "/sobre/" ou "/" -> vira <dir>/index
    if (u.pathname.endsWith('/') || file === '') {
      if (file) dirs.push(sanitizeSegment(file));
      file = 'index';
    } else {
      file = sanitizeSegment(file);
    }

    if (isExternal) {
      dirs = [EXT_DIR, sanitizeSegment(u.host), ...dirs];
    }

    // --- extensao ---
    let ext = extOf(file);
    if (kind === 'document') {
      // /produto.php, /rota sem extensao, /rota.aspx -> tudo vira .html
      if (ext !== '.html' && ext !== '.htm') {
        file += '.html';
        ext = '.html';
      }
    } else if (!ext) {
      // Sem extensao no caminho, o tipo declarado pelo servidor decide.
      // O /_next/image do Next.js e o caso classico: devolve um JPEG por uma
      // URL sem extensao nenhuma, e um arquivo assim vira octet-stream.
      const forced = extForContentType(contentType) || extForKind(kind);
      if (forced) { file += forced; ext = forced; }
    }
    if (EXT_EXECUTAVEIS.has(ext)) { file += '.txt'; ext = '.txt'; }

    // --- query string: dois recursos podem so diferir no ?v= ---
    if (u.search) {
      const base = ext ? file.slice(0, -ext.length) : file;
      file = `${base}~${hash8(u.search)}${ext}`;
    }

    let path = [...dirs, file].join('/');
    path = this.#dedupe(path, k, ext);

    this.byKey.set(k, path);
    this.byPath.set(path.toLowerCase(), k);
    // O link do menu aponta para a rota limpa; ela precisa achar este arquivo.
    if (canonical && !this.byKey.has(canonical)) this.aliases.set(canonical, path);
    return path;
  }

  /** Resolve colisao de nomes entre URLs distintas. */
  #dedupe(path, key, ext) {
    const lower = path.toLowerCase();
    const owner = this.byPath.get(lower);
    if (owner === undefined || owner === key) return path;

    // Um diretorio do site pode ter o mesmo nome de um arquivo (ex.: /a e /a/b).
    const base = ext ? path.slice(0, -ext.length) : path;
    for (let n = 1; n < 500; n++) {
      const candidate = `${base}~${n}${ext}`;
      if (!this.byPath.has(candidate.toLowerCase())) return candidate;
    }
    return `${base}~${hash8(key)}${ext}`;
  }

  /**
   * Corrige o caso "arquivo x diretorio": se existe /a (arquivo) e /a/b.js,
   * o sistema de arquivos nao aceita `a` como arquivo e pasta ao mesmo tempo.
   * Chamar depois de todos os assign().
   */
  resolveDirFileConflicts() {
    const dirs = new Set();
    for (const p of this.byPath.keys()) {
      const parts = p.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    }
    const renames = [];
    for (const [key, path] of this.byKey) {
      if (dirs.has(path.toLowerCase())) {
        const ext = extOf(path);
        const base = ext ? path.slice(0, -ext.length) : path;
        // /a vira /a/index.html (documento) ou /a~file.ext
        const next = ext === '.html'
          ? `${base}/index.html`
          : `${base}/index${ext || ''}`;
        renames.push([key, path, next]);
      }
    }
    for (const [key, oldPath, newPath] of renames) {
      this.byPath.delete(oldPath.toLowerCase());
      const fixed = this.#dedupe(newPath, key, extOf(newPath));
      this.byKey.set(key, fixed);
      this.byPath.set(fixed.toLowerCase(), key);
      for (const [ak, ap] of this.aliases) if (ap === oldPath) this.aliases.set(ak, fixed);
    }
    return renames.length;
  }

  /** Mapa que vai embutido no runtime: URL completa -> caminho local. */
  exportFullMap() {
    const out = {};
    for (const [k, p] of this.byKey) out[k] = p;
    for (const [k, p] of this.aliases) if (!out[k]) out[k] = p;
    return out;
  }

  /**
   * Mapa por pathname, so da origem de casa. Serve para o runtime resolver
   * caminhos absolutos ("/models/a.glb") construidos dinamicamente em JS.
   */
  exportPathMap() {
    const out = {};
    for (const [k, p] of this.byKey) {
      try {
        const u = new URL(k);
        if (u.origin !== this.origin) continue;
        const pn = u.pathname + (u.search || '');
        if (!out[pn]) out[pn] = p;
        if (u.search && !out[u.pathname]) out[u.pathname] = p;
      } catch { /* ignora */ }
    }
    return out;
  }

  get size() { return this.byKey.size; }
}
