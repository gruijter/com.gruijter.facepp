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

// decode a JPEG buffer to its raw RGBA raster once, so a multi-face image only pays
// the (comparatively expensive) full-image JPEG decode a single time, not once per face
const decodeJpeg = (imgBuffer) => jpeg.decode(imgBuffer);

// crop a rectangle out of an already-decoded raster, returns a JPEG buffer
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
  cropDecoded,
};
