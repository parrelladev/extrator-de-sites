/* Utilitarios comuns. */

export function hash8(str) {
  // FNV-1a 32 bits — curto, deterministico, suficiente para desambiguar nomes.
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function stripHash(u) {
  const i = u.indexOf('#');
  return i >= 0 ? u.slice(0, i) : u;
}

/*
 * Rede privada: localhost, IPs internos e nomes que só existem na rede local.
 *
 * A lista de URLs a baixar vem da página capturada, e a página pode mentir —
 * basta disparar o evento que o coletor escuta. Sem esta trava, um site
 * malicioso faria a extensão buscar o painel do roteador ou um serviço em
 * localhost e gravar a resposta na pasta, onde o JavaScript do próprio site
 * a leria de volta assim que o usuário abrisse a cópia.
 */
export function ehRedePrivada(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || /\.(localhost|local|internal|intranet|lan|home\.arpa|corp)$/.test(h)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [+v4[1], +v4[2]];
    return a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(':')) {
    return h === '::' || h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) ||
      /^::ffff:/.test(h);
  }
  // Nome sem ponto ("intranet", "router") só resolve dentro da rede local.
  return !h.includes('.');
}

// Segundo nível que funciona como sufixo público: "loja.com.br" é o site, não "com.br".
const SUFIXOS_2 = /^(com|net|org|gov|edu|co|ac|art|blog|eco|app|dev|ind|inf|adv|eng|med|nom|tv|ltd|plc|or|ne|go)$/;

/** O "site" de um host (domínio registrável, por aproximação). */
function siteDe(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (/^[\d.]+$/.test(h) || h.includes(':')) return h;
  const p = h.split('.');
  if (p.length <= 2) return h;
  const n = p[p.length - 1].length === 2 && SUFIXOS_2.test(p[p.length - 2]) ? 3 : 2;
  return p.slice(-n).join('.');
}

export function mesmoSite(a, b) {
  try {
    return siteDe(new URL(a).hostname) === siteDe(new URL(b).hostname);
  } catch { return false; }
}

export function safeUrl(input, base) {
  try {
    if (!input) return null;
    const s = String(input).trim();
    if (!s || s.startsWith('#')) return null;
    if (/^(data|blob|javascript|about|mailto|tel|sms|ftp|file|chrome|chrome-extension|moz-extension|intent):/i.test(s)) return null;
    const u = new URL(s, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u;
  } catch { return null; }
}

const RESERVED_WIN = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

export function sanitizeSegment(seg) {
  let s = String(seg);
  try { s = decodeURIComponent(s); } catch { /* mantem cru se a decodificacao falhar */ }
  s = s.replace(CONTROL_CHARS, '');
  s = s.replace(/[<>:"|?*\\]/g, '_');
  s = s.replace(/\//g, '_');
  s = s.replace(/^\.+$/, '_');
  s = s.replace(/[. ]+$/, '');       // Windows nao aceita terminar com ponto/espaco
  if (!s) s = '_';
  if (RESERVED_WIN.test(s)) s = '_' + s;
  if (s.length > 100) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 12 ? s.slice(dot) : '';
    s = s.slice(0, 100 - ext.length) + ext;
  }
  return s;
}

export function extOf(name) {
  const m = /\.([A-Za-z0-9]{1,12})$/.exec(name);
  return m ? '.' + m[1].toLowerCase() : '';
}

/** Caminho relativo de `fromFile` para `toFile`, ambos relativos a raiz da saida. */
export function relativePath(fromFile, toFile) {
  const fromParts = fromFile.split('/').slice(0, -1);
  const toParts = toFile.split('/');
  const toName = toParts.pop();
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
  const up = new Array(fromParts.length - i).fill('..');
  const down = toParts.slice(i);
  const rel = [...up, ...down, toName].join('/');
  return rel === '' ? toName : rel;
}

/** Igual, mas garante prefixo ./ — obrigatorio para specifier de ES module. */
export function relativeSpecifier(fromFile, toFile) {
  const r = relativePath(fromFile, toFile);
  return r.startsWith('.') ? r : './' + r;
}

const MIME_KIND = [
  [/^text\/html|application\/xhtml/i, 'document'],
  [/^text\/css/i, 'css'],
  [/javascript|ecmascript|^text\/jsx/i, 'js'],
  [/^application\/json|\+json/i, 'json'],
  [/^image\/svg/i, 'svg'],
  [/^image\//i, 'image'],
  [/^font\/|application\/(x-)?font|application\/vnd\.ms-fontobject/i, 'font'],
  [/^video\//i, 'video'],
  [/^audio\//i, 'audio'],
  [/^application\/wasm/i, 'wasm'],
  [/^text\//i, 'text']
];

const EXT_KIND = {
  '.html': 'document', '.htm': 'document', '.xhtml': 'document',
  '.css': 'css',
  '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'js',
  '.json': 'json', '.map': 'json', '.geojson': 'json', '.topojson': 'json',
  '.svg': 'svg',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image',
  '.avif': 'image', '.bmp': 'image', '.ico': 'image', '.apng': 'image',
  '.hdr': 'image', '.exr': 'image', '.ktx': 'image', '.ktx2': 'image',
  '.basis': 'image', '.dds': 'image', '.tga': 'image',
  '.woff': 'font', '.woff2': 'font', '.ttf': 'font', '.otf': 'font', '.eot': 'font',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.m4v': 'video', '.ogv': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio', '.m4a': 'audio', '.aac': 'audio', '.flac': 'audio',
  '.wasm': 'wasm',
  '.glb': 'model', '.gltf': 'model', '.bin': 'model', '.drc': 'model',
  '.obj': 'model', '.mtl': 'model', '.fbx': 'model', '.ply': 'model', '.stl': 'model',
  '.usdz': 'model', '.splat': 'model', '.ksplat': 'model',
  '.txt': 'text', '.csv': 'text', '.vtt': 'text', '.srt': 'text',
  '.glsl': 'text', '.vert': 'text', '.frag': 'text', '.wgsl': 'text',
  '.xml': 'text', '.webmanifest': 'json'
};

export function kindOf(contentType, urlPath) {
  const ext = extOf(urlPath || '');
  // A extensao ganha para formatos que servidores costumam mandar como octet-stream.
  if (ext && (EXT_KIND[ext] === 'model' || EXT_KIND[ext] === 'wasm')) return EXT_KIND[ext];
  const ct = (contentType || '').split(';')[0].trim();
  if (ct) {
    for (const [re, kind] of MIME_KIND) if (re.test(ct)) return kind;
  }
  if (ext && EXT_KIND[ext]) return EXT_KIND[ext];
  return 'other';
}

export function extForKind(kind) {
  switch (kind) {
    case 'document': return '.html';
    case 'css': return '.css';
    case 'js': return '.js';
    case 'json': return '.json';
    case 'svg': return '.svg';
    case 'wasm': return '.wasm';
    default: return '';
  }
}

function charsetOf(contentType) {
  const m = /charset=["']?([\w-]+)/i.exec(contentType || '');
  return m ? m[1].toLowerCase() : null;
}

export function decodeText(bytes, contentType, sniff = true) {
  let cs = charsetOf(contentType);
  if (!cs && sniff) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      cs = 'utf-8';
    } else {
      const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
      const m = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
      if (m) cs = m[1].toLowerCase();
    }
  }
  try {
    return new TextDecoder(cs || 'utf-8', { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

export function encodeText(str) {
  return new TextEncoder().encode(str);
}

export function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

/** Executa `worker` sobre `items` com no maximo `limit` em paralelo. */
export async function pool(items, limit, worker) {
  const it = items[Symbol.iterator]();
  const runners = [];
  for (let i = 0; i < Math.max(1, limit); i++) {
    runners.push((async () => {
      for (;;) {
        const n = it.next();
        if (n.done) return;
        await worker(n.value);
      }
    })());
  }
  await Promise.all(runners);
}

const ANALYTICS_PATTERNS = [
  /google-analytics\.com/i, /googletagmanager\.com/i, /doubleclick\.net/i,
  /googlesyndication\.com/i, /googleads/i, /connect\.facebook\.net/i,
  /facebook\.com\/tr/i, /hotjar\.com/i, /segment\.(io|com)/i, /mixpanel\.com/i,
  /clarity\.ms/i, /amplitude\.com/i, /intercom\.io/i, /crisp\.chat/i,
  /sentry\.io|sentry-cdn/i, /bugsnag\.com/i, /newrelic\.com|nr-data\.net/i,
  /mouseflow\.com/i, /fullstory\.com/i, /matomo|piwik/i,
  /analytics\.tiktok/i, /linkedin\.com\/px|licdn\.com\/px/i,
  /snap\.licdn\.com/i, /bat\.bing\.com/i, /cloudflareinsights\.com/i,
  /plausible\.io/i, /usefathom\.com/i, /vitals\.vercel/i
];

export function isAnalytics(url) {
  return ANALYTICS_PATTERNS.some((re) => re.test(url));
}

const CT_EXT = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
  'image/webp': '.webp', 'image/avif': '.avif', 'image/gif': '.gif',
  'image/bmp': '.bmp', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico',
  'image/svg+xml': '.svg', 'image/tiff': '.tiff',
  'image/ktx2': '.ktx2', 'image/vnd.radiance': '.hdr', 'image/x-exr': '.exr',
  'font/woff2': '.woff2', 'font/woff': '.woff', 'font/ttf': '.ttf', 'font/otf': '.otf',
  'application/font-woff2': '.woff2', 'application/font-woff': '.woff',
  'application/x-font-ttf': '.ttf', 'application/vnd.ms-fontobject': '.eot',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/ogg': '.ogv',
  'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
  'audio/ogg': '.ogg', 'audio/aac': '.aac', 'audio/mp4': '.m4a', 'audio/flac': '.flac',
  'model/gltf-binary': '.glb', 'model/gltf+json': '.gltf',
  'application/wasm': '.wasm', 'application/pdf': '.pdf'
};

/**
 * Extensao a partir do Content-Type, para URLs que nao tem nenhuma.
 * Sem isso, /_next/image?url=...&w=640 — que devolve um JPEG — vira um arquivo
 * sem extensao, servido como octet-stream.
 */
export function extForContentType(contentType) {
  if (!contentType) return '';
  const ct = contentType.split(';')[0].trim().toLowerCase();
  return CT_EXT[ct] || '';
}
