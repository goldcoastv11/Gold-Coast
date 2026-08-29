/**
 * A tiny, dependency-free PNG reader/writer - just enough for the LPC import.
 *
 * The project has no image library (and shouldn't gain one for a script that
 * runs a few times a year), but the import genuinely needs pixels: it has to
 * VERIFY that a downloaded sheet is really 64x64 frames in the standard LPC
 * grid, and it has to palette-swap the art (every LPC sheet ships in one
 * neutral "base" ramp; the colour you actually see is applied afterwards).
 *
 * So this handles exactly the PNG subset the LPC repo publishes:
 *  - 8-bit RGB / RGBA / greyscale, and 1/2/4/8-bit palette images
 *  - the five standard scanline filters
 * and writes back 8-bit palette PNGs, which is the smallest honest encoding
 * for art with under 256 colours - the whole imported wardrobe is ~10 colours
 * a sheet, so this keeps each piece at a few KB rather than tens of KB.
 */

import zlib from "node:zlib";

/** Reads just the header. Cheap, and enough to reject a wrongly-sized sheet. */
export function readHeader(buf) {
  if (buf.length < 26 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error("not a PNG");
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25]
  };
}

/** Decodes to `{ width, height, data }` where data is RGBA, 4 bytes per pixel. */
export function decodePng(buf) {
  const hdr = readHeader(buf);
  const { width, height, bitDepth: bd, colorType: ct } = hdr;
  if (bd !== 8 && !(ct === 3 && (bd === 1 || bd === 2 || bd === 4))) {
    throw new Error(`unsupported PNG bit depth ${bd} (colour type ${ct})`);
  }

  const idat = [];
  let plte = null;
  let trns = null;
  for (let off = 8; off + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === "IDAT") idat.push(body);
    else if (type === "PLTE") plte = body;
    else if (type === "tRNS") trns = body;
    else if (type === "IEND") break;
    off += 12 + len;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  const stride = Math.ceil((width * channels * bd) / 8);
  // Filters work on whole bytes, on the byte `bpp` positions back.
  const bpp = Math.max(1, (channels * bd) >> 3);

  const data = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  let p = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    cur.set(raw.subarray(p, p + stride));
    p += stride;

    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = cur[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const est = a + b - c;
        const pa = Math.abs(est - a);
        const pb = Math.abs(est - b);
        const pc = Math.abs(est - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) {
        throw new Error(`unknown PNG filter ${filter}`);
      }
      cur[x] = v & 0xff;
    }

    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (ct === 6) {
        data[o] = cur[x * 4];
        data[o + 1] = cur[x * 4 + 1];
        data[o + 2] = cur[x * 4 + 2];
        data[o + 3] = cur[x * 4 + 3];
      } else if (ct === 2) {
        data[o] = cur[x * 3];
        data[o + 1] = cur[x * 3 + 1];
        data[o + 2] = cur[x * 3 + 2];
        data[o + 3] = 255;
      } else if (ct === 3) {
        let idx;
        if (bd === 8) {
          idx = cur[x];
        } else {
          const per = 8 / bd;
          const byte = cur[Math.floor(x / per)];
          idx = (byte >> (8 - bd * ((x % per) + 1))) & ((1 << bd) - 1);
        }
        data[o] = plte[idx * 3];
        data[o + 1] = plte[idx * 3 + 1];
        data[o + 2] = plte[idx * 3 + 2];
        data[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (ct === 4) {
        data[o] = data[o + 1] = data[o + 2] = cur[x * 2];
        data[o + 3] = cur[x * 2 + 1];
      } else {
        data[o] = data[o + 1] = data[o + 2] = cur[x];
        data[o + 3] = 255;
      }
    }

    const swap = prev;
    prev = cur;
    cur = swap;
  }

  return { width, height, data };
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, body) {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "ascii");
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/**
 * Encodes RGBA pixels as an 8-bit palette PNG.
 *
 * Throws above 256 distinct colours rather than quantising: silently
 * degrading pixel art would be far worse than failing the import loudly, and
 * nothing in the LPC wardrobe comes close to the limit.
 */
export function encodeIndexedPng({ width, height, data }) {
  const lookup = new Map();
  const palette = [];
  const indices = new Uint8Array(width * height);

  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    // Every fully-transparent pixel is the same pixel, whatever RGB the
    // source left under it - collapsing them keeps the palette small.
    const key =
      data[i + 3] === 0 ? -1 : (data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3];
    let idx = lookup.get(key);
    if (idx === undefined) {
      if (palette.length >= 256) throw new Error("more than 256 colours - not palette art");
      idx = palette.length;
      palette.push(key === -1 ? [0, 0, 0, 0] : [data[i], data[i + 1], data[i + 2], data[i + 3]]);
      lookup.set(key, idx);
    }
    indices[px] = idx;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // colour type: palette
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((c, i) => {
    plte[i * 3] = c[0];
    plte[i * 3 + 1] = c[1];
    plte[i * 3 + 2] = c[2];
  });
  // tRNS only has to cover the palette up to the last non-opaque entry.
  let lastAlpha = -1;
  palette.forEach((c, i) => {
    if (c[3] !== 255) lastAlpha = i;
  });
  const trns = Buffer.from(palette.slice(0, lastAlpha + 1).map((c) => c[3]));

  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width + 1)] = 0; // filter: none. Indexed rows don't gain from filtering.
    Buffer.from(indices.buffer, y * width, width).copy(rows, y * (width + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    ...(trns.length ? [chunk("tRNS", trns)] : []),
    chunk("IDAT", zlib.deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/** The distinct opaque-ish colours in an image, as `#rrggbb`, most common first. */
export function paletteOf({ data }) {
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue;
    const hex =
      "#" +
      [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
}
