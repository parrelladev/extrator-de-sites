/*
 * zip.js — escritor de ZIP sem dependencia externa.
 *
 * Usa CompressionStream('deflate-raw') (nativo no Chromium) para os arquivos de
 * texto e armazena sem compressao o que ja vem comprimido (jpg, png, mp4, woff2),
 * onde deflate so gastaria CPU. Monta o arquivo como lista de Blobs, entao o
 * navegador pode manter os pedacos em disco em vez de tudo na memoria.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Formatos que ja chegam comprimidos: deflate so gastaria CPU sem ganhar bytes.
// .glb fica de fora de proposito — geometria e um mar de floats parecidos e
// costuma encolher bastante.
const STORE_EXT = /\.(jpe?g|png|gif|webp|avif|mp4|webm|mov|m4v|mp3|m4a|aac|ogg|oga|ogv|woff2?|zip|gz|br|ktx2|basis|jxl)$/i;

// Acima disso, comprimir um unico arquivo trava a interface por segundos.
const DEFLATE_LIMIT = 32 * 1024 * 1024;

async function deflateRaw(u8) {
  const cs = new CompressionStream('deflate-raw');
  const stream = new Blob([u8]).stream().pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function dosTime(d = new Date()) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

function u16(v) { return [v & 0xff, (v >>> 8) & 0xff]; }
function u32(v) { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }

export class ZipWriter {
  constructor() {
    this.parts = [];
    this.entries = [];
    this.offset = 0;
    this.encoder = new TextEncoder();
  }

  get bytesWritten() { return this.offset; }

  async add(path, data, executavel = false) {
    const nameBytes = this.encoder.encode(path);
    const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
    const crc = crc32(raw);

    let method = 0;
    let payload = raw;
    if (!STORE_EXT.test(path) && raw.length > 256 && raw.length <= DEFLATE_LIMIT) {
      try {
        const packed = await deflateRaw(raw);
        if (packed.length < raw.length) { payload = packed; method = 8; }
      } catch { /* mantem STORE */ }
    }

    const { time, date } = dosTime();
    const flags = 0x0800; // nome em UTF-8

    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(method),
      ...u16(time), ...u16(date), ...u32(crc),
      ...u32(payload.length), ...u32(raw.length),
      ...u16(nameBytes.length), ...u16(0)
    ]);

    this.parts.push(local, nameBytes, payload);
    this.entries.push({
      nameBytes, crc, method, time, date, flags, executavel,
      compressed: payload.length, size: raw.length, offset: this.offset
    });
    this.offset += local.length + nameBytes.length + payload.length;
  }

  /** @returns {Blob} */
  finish(comment = '') {
    const centralStart = this.offset;
    const central = [];

    for (const e of this.entries) {
      // "version made by": 0x03 no byte alto declara origem Unix, que e o que
      // faz os 16 bits altos de "external attributes" serem lidos como modo de
      // arquivo. Sem isso o bit de execucao viaja no ZIP e e descartado ao
      // descompactar — e o atalho do macOS chega sem permissao.
      const madeBy = 0x0314;
      const modo = e.executavel ? 0o100755 : 0o100644;
      const externalAttrs = (modo << 16) >>> 0;

      central.push(new Uint8Array([
        ...u32(0x02014b50), ...u16(madeBy), ...u16(20), ...u16(e.flags), ...u16(e.method),
        ...u16(e.time), ...u16(e.date), ...u32(e.crc),
        ...u32(e.compressed), ...u32(e.size),
        ...u16(e.nameBytes.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0), ...u32(externalAttrs), ...u32(e.offset)
      ]), e.nameBytes);
    }

    const centralSize = central.reduce((a, p) => a + p.length, 0);
    const commentBytes = this.encoder.encode(comment);
    const end = new Uint8Array([
      ...u32(0x06054b50), ...u16(0), ...u16(0),
      ...u16(this.entries.length), ...u16(this.entries.length),
      ...u32(centralSize), ...u32(centralStart),
      ...u16(commentBytes.length)
    ]);

    return new Blob([...this.parts, ...central, end, commentBytes], { type: 'application/zip' });
  }

  /** ZIP classico nao suporta mais que isso; o Estudio avisa antes de chegar la. */
  get overCapacity() {
    return this.entries.length >= 65535 || this.offset >= 0xfffffffe;
  }
}
