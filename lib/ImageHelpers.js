/*
Copyright 2020 - 2026, Robin de Gruijter (gruijter@hotmail.com)

This file is part of com.gruijter.facepp.

com.gruijter.facepp is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

com.gruijter.facepp is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with com.gruijter.facepp.  If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

const { Readable } = require('stream');
const fs = require('fs');
const jpeg = require('jpeg-js');

const JPEG_CROP_QUALITY = 90;

// decode a base64 string to a buffer (used only for the settings-page upload path,
// which arrives as base64 JSON over Homey.api - everything else moves raw Buffers)
const base64Decode = (base64) => Buffer.from(base64, 'base64');

// strip a "data:image/jpeg;base64,..." prefix, e.g. from a browser FileReader
// data URL, leaving just the raw base64 payload Face++'s API expects
const stripDataUrlPrefix = (base64) => base64.replace(/^data:image\/(\w+);base64,/, '');

const bufferToStream = (buffer) => Readable.from(buffer);

const streamToBuffer = (stream) => new Promise((resolve, reject) => {
  const buffers = [];
  stream.on('error', reject);
  stream.on('data', (data) => buffers.push(data));
  stream.on('end', () => resolve(Buffer.concat(buffers)));
});

// --- Full-image raster decode, via libjpeg-turbo compiled to WebAssembly -------------
//
// A plain JS JPEG decoder (jpeg-js) always expands to full-resolution RGBA, which for a
// typical camera snapshot (several MP) needs 50MB+ - far more than a Homey app's ~70-80MB
// total process budget survives (confirmed empirically: a real doorbell snapshot needed
// >54MB just for this step, and crashed the app with "Memory Warning Limit Reached").
//
// libjpeg-turbo supports genuine DCT-domain *scaled* decoding: it can decode directly at
// 1/2, 1/4, 1/8 etc. of the source resolution, so decode cost is bounded by the requested
// output size, not the source photo's resolution. @cwasm/jpeg-turbo ships libjpeg-turbo
// compiled to WASM (no native/per-architecture binary - verified live on a real Homey Pro
// that WebAssembly instantiates and runs fine inside Homey's V8 app sandbox). Its own
// high-level `decode()` always requests full resolution, so the scaled decode below talks
// to the same WASM exports directly instead.
const TJPF_RGBA = 7;
const wasmCode = fs.readFileSync(require.resolve('@cwasm/jpeg-turbo/jpeg-turbo.wasm'));
const wasmModule = new WebAssembly.Module(wasmCode);
const wasmInstance = new WebAssembly.Instance(wasmModule, {
  env: {
    setjmp: () => 0,
    longjmp: () => {
      throw Error('longjmp not implemented');
    },
  },
  wasi_snapshot_preview1: {
    environ_sizes_get: () => 0,
    environ_get: () => {
      throw Error('environ_get not implemented');
    },
    proc_exit: () => {
      throw Error('proc_exit not implemented');
    },
    fd_close: () => {
      throw Error('fd_close not implemented');
    },
    fd_seek: () => {
      throw Error('fd_seek not implemented');
    },
    fd_write: () => {
      throw Error('fd_write not implemented');
    },
  },
});

// cap the decoded raster's largest dimension - this is what actually bounds memory
// (output RGBA bytes = width * height * 4), regardless of the source photo's real
// resolution. 1200px is comfortably enough detail for a flow-trigger face thumbnail.
const MAX_DECODE_DIMENSION = 1200;

// TurboJPEG's scaled decode only supports these exact M/8 ratios (confirmed against the
// compiled WASM build: all 8 decoded correctly on a real test image, largest/best-quality
// first so the search below picks the least aggressive scale that still fits the cap)
const TJ_SCALE_NUMERATORS = [8, 7, 6, 5, 4, 3, 2, 1];

// libjpeg-turbo's own TJSCALED ceiling-division formula for a scaled dimension
const tjScaled = (dimension, num) => Math.floor((dimension * num + 7) / 8);

// decode a JPEG once and reuse the result for every face's crop, instead of each
// getFaceToken() call redoing a decode of its own. Returns the (possibly downscaled)
// RGBA raster plus the native (pre-scale) dimensions, so callers can remap
// native-pixel-space regions (e.g. Face++'s face_rectangle) onto this raster - see
// scaleRegionToDecoded() below.
const decodeJpeg = (imgBuffer) => {
  const inputPointer = wasmInstance.exports.malloc(imgBuffer.byteLength);
  new Uint8Array(wasmInstance.exports.memory.buffer, inputPointer, imgBuffer.byteLength).set(imgBuffer);

  const decompressorPointer = wasmInstance.exports.tjInitDecompress();
  if (decompressorPointer === 0) {
    wasmInstance.exports.free(inputPointer);
    throw Error('Failed to allocate JPEG decompressor');
  }

  const metadataPointer = wasmInstance.exports.malloc(16);
  const headerStatus = wasmInstance.exports.tjDecompressHeader3(
    decompressorPointer, inputPointer, imgBuffer.byteLength,
    metadataPointer, metadataPointer + 4, metadataPointer + 8, metadataPointer + 12,
  );
  if (headerStatus !== 0) {
    wasmInstance.exports.free(inputPointer);
    wasmInstance.exports.free(metadataPointer);
    wasmInstance.exports.tjDestroy(decompressorPointer);
    throw Error('Failed to decode JPEG header');
  }
  const [nativeWidth, nativeHeight] = new Uint32Array(wasmInstance.exports.memory.buffer, metadataPointer, 4);
  wasmInstance.exports.free(metadataPointer);

  const scaleNum = TJ_SCALE_NUMERATORS.find((num) => (
    tjScaled(nativeWidth, num) <= MAX_DECODE_DIMENSION && tjScaled(nativeHeight, num) <= MAX_DECODE_DIMENSION
  )) || 1;
  const width = tjScaled(nativeWidth, scaleNum);
  const height = tjScaled(nativeHeight, scaleNum);

  const outputSize = width * height * 4;
  const outputPointer = wasmInstance.exports.malloc(outputSize);
  const dataStatus = wasmInstance.exports.tjDecompress2(
    decompressorPointer, inputPointer, imgBuffer.byteLength,
    outputPointer, width, width * 4, height, TJPF_RGBA, 0,
  );
  wasmInstance.exports.free(inputPointer);
  wasmInstance.exports.tjDestroy(decompressorPointer);
  if (dataStatus !== 0) {
    wasmInstance.exports.free(outputPointer);
    throw Error(`Failed to decode JPEG data at scale ${scaleNum}/8`);
  }

  // copy out of WASM linear memory into a real Node Buffer before freeing the WASM
  // side - the WASM memory view is invalidated by any later malloc/free/grow
  const data = Buffer.alloc(outputSize);
  Buffer.from(wasmInstance.exports.memory.buffer, outputPointer, outputSize).copy(data);
  wasmInstance.exports.free(outputPointer);

  return {
    data, width, height, nativeWidth, nativeHeight,
  };
};

// remap a native-pixel-space region (e.g. Face++'s face_rectangle, always given in the
// original photo's coordinates) onto a decodeJpeg() result, which may be downscaled
const scaleRegionToDecoded = (decodedImage, region) => {
  const scaleX = decodedImage.width / decodedImage.nativeWidth;
  const scaleY = decodedImage.height / decodedImage.nativeHeight;
  const left = Math.max(0, Math.min(decodedImage.width - 1, Math.round(region.left * scaleX)));
  const top = Math.max(0, Math.min(decodedImage.height - 1, Math.round(region.top * scaleY)));
  const width = Math.max(1, Math.min(decodedImage.width - left, Math.round(region.width * scaleX)));
  const height = Math.max(1, Math.min(decodedImage.height - top, Math.round(region.height * scaleY)));
  return {
    left, top, width, height,
  };
};

// crop a rectangle out of an already-decoded raster, returns a JPEG buffer. The crop
// itself is always small (a single face) regardless of how big the source photo was, so
// encoding it back to JPEG with jpeg-js here is cheap - the expensive part was decoding
// the full-size source above, not this.
const cropDecoded = (decodedImage, region) => {
  const { data, width, height } = decodedImage;
  const {
    left, top, width: cropWidth, height: cropHeight,
  } = region;
  if (left < 0 || top < 0 || cropWidth <= 0 || cropHeight <= 0
  || left + cropWidth > width || top + cropHeight > height) {
    throw Error(`crop region ${JSON.stringify(region)} is out of bounds for a ${width}x${height} image`);
  }
  const channels = 4; // decoded as RGBA
  const cropped = Buffer.alloc(cropWidth * cropHeight * channels);
  for (let row = 0; row < cropHeight; row += 1) {
    const srcStart = ((top + row) * width + left) * channels;
    const srcEnd = srcStart + (cropWidth * channels);
    const destStart = row * cropWidth * channels;
    data.copy(cropped, destStart, srcStart, srcEnd);
  }
  const encoded = jpeg.encode({ data: cropped, width: cropWidth, height: cropHeight }, JPEG_CROP_QUALITY);
  return encoded.data;
};

module.exports = {
  base64Decode,
  stripDataUrlPrefix,
  bufferToStream,
  streamToBuffer,
  decodeJpeg,
  scaleRegionToDecoded,
  cropDecoded,
};
