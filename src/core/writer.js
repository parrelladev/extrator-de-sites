/*
 * writer.js — dois destinos de saida.
 *
 * DirectoryWriter: grava a arvore de arquivos direto numa pasta escolhida pelo
 * usuario (File System Access API). E o modo preferido — nao acumula nada em
 * memoria, entao um site 3D de 2 GB grava sem sufoco, e o resultado ja fica
 * pronto para abrir.
 *
 * ZipWriterSink: alternativa quando a API nao esta disponivel. Monta um .zip
 * e entrega pelo chrome.downloads.
 */

import { ZipWriter } from './zip.js';

export function supportsDirectoryPicker() {
  return typeof window.showDirectoryPicker === 'function';
}

export class DirectoryWriter {
  constructor(rootHandle) {
    this.root = rootHandle;
    this.dirCache = new Map([['', rootHandle]]);
    this.written = 0;
    this.bytes = 0;
  }

  static async pick() {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'xtr-saida' });
    return new DirectoryWriter(handle);
  }

  async #dir(path) {
    if (this.dirCache.has(path)) return this.dirCache.get(path);
    const parts = path.split('/');
    let cur = this.root;
    let acc = '';
    for (const p of parts) {
      acc = acc ? acc + '/' + p : p;
      if (this.dirCache.has(acc)) { cur = this.dirCache.get(acc); continue; }
      cur = await cur.getDirectoryHandle(p, { create: true });
      this.dirCache.set(acc, cur);
    }
    return cur;
  }

  /* O terceiro parametro (executavel) so tem efeito na saida .zip: a File
     System Access API nao expoe permissao de arquivo. */
  async write(path, data) {
    const idx = path.lastIndexOf('/');
    const dirPath = idx < 0 ? '' : path.slice(0, idx);
    const name = idx < 0 ? path : path.slice(idx + 1);
    const dir = await this.#dir(dirPath);
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    try {
      await w.write(data);
    } finally {
      await w.close();
    }
    this.written++;
    this.bytes += data.byteLength || data.size || 0;
  }

  async finish() {
    return { mode: 'pasta', files: this.written, bytes: this.bytes, name: this.root.name };
  }
}

export class ZipWriterSink {
  constructor(zipName) {
    this.zip = new ZipWriter();
    this.zipName = zipName;
    this.written = 0;
  }

  async write(path, data, executavel = false) {
    const u8 = data instanceof Uint8Array
      ? data
      : new Uint8Array(data instanceof ArrayBuffer ? data : await data.arrayBuffer());
    await this.zip.add(path, u8, executavel);
    this.written++;
  }

  get bytes() { return this.zip.bytesWritten; }

  async finish() {
    const blob = this.zip.finish('Gerado pelo Extrator de Sites');
    const url = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({ url, filename: this.zipName, saveAs: true });
    } finally {
      // O download le do blob de forma assincrona; soltar cedo demais aborta.
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    }
    return { mode: 'zip', files: this.written, bytes: blob.size, name: this.zipName };
  }
}
