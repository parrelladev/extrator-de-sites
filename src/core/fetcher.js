/*
 * fetcher.js — busca recursos a partir da pagina do Estudio.
 *
 * Por que daqui e nao do content script: a pagina do Estudio roda na origem
 * chrome-extension:// e, com host_permissions ["<all_urls>"], suas requisicoes
 * nao passam por CORS. Um content script herdaria a politica da pagina e
 * falharia em metade dos CDNs.
 */

import { ehRedePrivada, mesmoSite } from './util.js';

const DEFAULT_TIMEOUT = 45000;

export class Fetcher {
  /*
   * `casa` é a URL da página capturada. Ela define duas travas:
   *   - cookies só vão para o mesmo site dela. CDN não precisa de sessão, e
   *     mandar os cookies do usuário para qualquer URL que a página citar
   *     deixaria um site malicioso baixar, com a sessão do usuário, a caixa de
   *     e-mail dele em outra aba — e gravar isso na cópia.
   *   - nada em rede privada, a não ser que a própria página capturada esteja
   *     nela (quem captura o próprio projeto em localhost).
   */
  constructor(opts = {}) {
    this.timeout = opts.timeout || DEFAULT_TIMEOUT;
    this.maxBytes = opts.maxBytes || 80 * 1024 * 1024;
    this.credentials = opts.credentials === false ? 'omit' : 'include';
    this.casa = opts.casa || null;
    this.casaPrivada = this.casa ? ehRedePrivada(new URL(this.casa).hostname) : false;
    this.stats = { ok: 0, fail: 0, bytes: 0, skipped: 0 };
  }

  /** A URL pode ser buscada? (Usado também para filtrar a fila.) */
  permitida(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      if (u.username || u.password) return false;
      return this.casaPrivada || !ehRedePrivada(u.hostname);
    } catch { return false; }
  }

  #bloqueio(url) {
    this.stats.skipped++;
    return { url, finalUrl: url, ok: false, status: 0, contentType: '', bytes: null, bloqueado: true, error: 'endereço de rede privada bloqueado' };
  }

  /**
   * @returns {Promise<{url,finalUrl,ok,status,contentType,bytes,error,tooBig}>}
   */
  async get(url, { referrer, accept, credentials } = {}) {
    if (!this.permitida(url)) return this.#bloqueio(url);

    const attempt = async (creds) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeout);
      try {
        const headers = {};
        if (accept) headers['Accept'] = accept;

        const res = await fetch(url, {
          method: 'GET',
          credentials: creds,
          redirect: 'follow',
          cache: 'force-cache',
          signal: ac.signal,
          headers,
          // Manter o Referer da origem original evita bloqueio anti-hotlink.
          referrer: referrer || undefined,
          referrerPolicy: referrer ? 'unsafe-url' : 'no-referrer-when-downgrade'
        });

        const finalUrl = res.url || url;
        // Um redirect pode levar para fora do site (cookies já foram) ou para
        // a rede interna. Nos dois casos a resposta não entra na cópia.
        if (finalUrl !== url && !this.permitida(finalUrl)) {
          try { await res.body?.cancel(); } catch { /* nada */ }
          return { ...this.#bloqueio(url), finalUrl };
        }
        if (creds === 'include' && this.casa && !mesmoSite(finalUrl, this.casa)) {
          try { await res.body?.cancel(); } catch { /* nada */ }
          return { refazerSemCookies: true };
        }

        const contentType = res.headers.get('content-type') || '';
        const declared = parseInt(res.headers.get('content-length') || '0', 10);
        const grande = (n) => ({
          url, finalUrl, ok: false, status: res.status,
          contentType, bytes: null, tooBig: true,
          error: `acima do limite (${n} bytes)`
        });
        if (declared && declared > this.maxBytes) {
          try { await res.body?.cancel(); } catch { /* nada */ }
          return grande(declared);
        }

        // Lê em pedaços e desiste ao passar do teto: sem Content-Length, um
        // arquivo gigante (ou infinito) seria carregado inteiro na memória
        // antes de qualquer checagem.
        const bytes = await this.#lerComTeto(res);
        if (!bytes) return grande(`> ${this.maxBytes}`);

        return {
          url,
          finalUrl,
          ok: res.ok,
          status: res.status,
          contentType,
          bytes,
          error: res.ok ? null : `HTTP ${res.status}`
        };
      } finally {
        clearTimeout(timer);
      }
    };

    let creds = credentials || this.credentials;
    if (creds === 'include' && this.casa && !mesmoSite(url, this.casa)) creds = 'omit';
    try {
      let r = await attempt(creds);
      if (r.refazerSemCookies) { creds = 'omit'; r = await attempt('omit'); }
      if (r.ok) { this.stats.ok++; this.stats.bytes += r.bytes.length; }
      else if (r.tooBig) this.stats.skipped++;
      else if (r.bloqueado) { /* já contado */ }
      else this.stats.fail++;
      return r;
    } catch (e) {
      // Alguns servidores rejeitam requisicao com cookie de terceiros; tenta limpo.
      if (creds !== 'omit') {
        try {
          const r2 = await attempt('omit');
          if (r2.refazerSemCookies) throw new Error('redirect inesperado');
          if (r2.ok) { this.stats.ok++; this.stats.bytes += r2.bytes.length; }
          else if (!r2.bloqueado) this.stats.fail++;
          return r2;
        } catch (e2) {
          this.stats.fail++;
          return { url, finalUrl: url, ok: false, status: 0, contentType: '', bytes: null, error: String(e2.message || e2) };
        }
      }
      this.stats.fail++;
      return { url, finalUrl: url, ok: false, status: 0, contentType: '', bytes: null, error: String(e.message || e) };
    }
  }

  async #lerComTeto(res) {
    if (!res.body) return new Uint8Array(await res.arrayBuffer());
    const leitor = res.body.getReader();
    const partes = [];
    let total = 0;
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.maxBytes) {
        try { await leitor.cancel(); } catch { /* nada */ }
        return null;
      }
      partes.push(value);
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of partes) { out.set(p, o); o += p.byteLength; }
    return out;
  }
}
