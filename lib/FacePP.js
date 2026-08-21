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

const RequestQueue = require('./RequestQueue');

// const sample = 'https://www.gannett-cdn.com/presto/2019/02/05/USAT/9a0923f6-7dc1-4eec-8513-a366ab28d426-148805_1608r1.jpg';
// const APIHostCN = 'api-cn.faceplusplus.com';
// const detectLPlate = '/imagepp/v1/licenseplate';
const detectObjectEP = '/imagepp/beta/detectsceneandobject';
// const detectText = '/imagepp/v1/recognizetext';

const APIHost = 'api-us.faceplusplus.com';
const detectFaceEP = '/facepp/v3/detect';
const searchFaceEP = '/facepp/v3/search';
const fsCreateEP = '/facepp/v3/faceset/create';
const fsRemoveFaceEP = '/facepp/v3/faceset/removeface';
const fsGetSetsEP = '/facepp/v3/faceset/getfacesets';
const fsGetDetailEP = '/facepp/v3/faceset/getdetail';
const faceSetUserIdEP = '/facepp/v3/face/setuserid';
const faceGetDetailEP = '/facepp/v3/face/getdetail';
const faceAnalyzeEP = '/facepp/v3/face/analyze';
const fsDeleteEP = '/facepp/v3/faceset/delete';
// const compareEP = '/facepp/v3/compare';
// const fsAddFaceEP = '/facepp/v3/faceset/addface';

const MAX_THROTTLE_RETRIES = 5;

const parse = (data) => {
  try {
    const parsed = JSON.parse(data);
    return parsed;
  } catch (error) {
    return {};
  }
};

class FacePP {

  constructor(opts) {
    const options = opts || {};
    this.host = options.host || APIHost;
    this.port = options.port || 443;
    this.timeout = options.timeout || 10000;
    this.lastResponse = undefined;
    this.key = opts.key;
    this.secret = opts.secret;
    this.queue = new RequestQueue({
      common: { ratePerSecond: 3 },
      faceSet: { ratePerSecond: 2 },
    });
  }

  // queue stuff, with retry on Face++'s own concurrency throttling
  async queueMessage(path, msg, rule = 'common') {
    for (let attempt = 0; attempt <= MAX_THROTTLE_RETRIES; attempt += 1) {
      try {
        return await this.queue.enqueue(() => this._makeRequest(path, msg), rule); // eslint-disable-line no-await-in-loop
      } catch (error) {
        const isThrottled = error.message && error.message.includes('CONCURRENCY_LIMIT_EXCEEDED');
        if (!isThrottled || attempt === MAX_THROTTLE_RETRIES) throw error;
      }
    }
    return undefined; // unreachable
  }

  // object detection

  // returns an array of detected scenes and objects
  async detectObjects(opts) {
    const postData = {};
    Object.assign(postData, opts);
    // this.host = APIHostCN;
    return this.queueMessage(detectObjectEP, postData);
  }

  // Face detect and search

  // returns an array of detected faces with face_token and attributes
  async detectFaces(opts) {
    const postData = {
      return_attributes: 'gender,age,glass,smiling,facequality,eyestatus,emotion,beauty,mouthstatus,eyegaze,skinstatus',
      // headpose,ethnicity,blur
    };
    Object.assign(postData, opts);
    return this.queueMessage(detectFaceEP, postData);
  }

  // returns most similar faces from Faceset
  async searchFaces(opts) {
    const postData = {};
    Object.assign(postData, opts);
    return this.queueMessage(searchFaceEP, postData);
  }

  // face set related commands

  // Add face_tokens to a faceset, and create a new faseSet if needed. returns faceset_token
  async fsAddFace(opts) {
    const postData = {
      force_merge: 1,
    };
    Object.assign(postData, opts);
    return this.queueMessage(fsCreateEP, postData, 'faceSet');
  }

  // Remove face_tokens from a faceset. returns number of faces left
  async fsRemoveFace(opts) {
    const postData = {};
    Object.assign(postData, opts);
    return this.queueMessage(fsRemoveFaceEP, postData, 'faceSet');
  }

  // list FaceSets for this API key. Cheapest possible call (no image, no faceset
  // needed) - used to verify an API key/secret pair actually works.
  async getFaceSets() {
    return this.queueMessage(fsGetSetsEP, {}, 'faceSet');
  }

  // list the face_tokens (and other metadata) of one FaceSet by outer_id
  async getFacesetDetail(opts) {
    const postData = {};
    Object.assign(postData, opts);
    return this.queueMessage(fsGetDetailEP, postData, 'faceSet');
  }

  // tag a face_token with a custom user_id (here: the Homey label), so any Homey
  // sharing this Face++ account can later recover the label for a face_token it
  // didn't itself register - see FaceApp.fetchForeignFaces()
  async setFaceUserId(opts) {
    const postData = {};
    Object.assign(postData, opts);
    return this.queueMessage(faceSetUserIdEP, postData, 'faceSet');
  }

  // get a face_token's own metadata (notably its user_id, if set)
  async getFaceDetail(opts) {
    const postData = {};
    Object.assign(postData, opts);
    return this.queueMessage(faceGetDetailEP, postData, 'faceSet');
  }

  // re-analyze up to 5 already-detected face_tokens at once and return the same
  // landmarks/attributes shape detect() gives - face/getdetail does NOT include
  // attributes (gender/age/quality/glass/...), only face/analyze does
  async analyzeFaces(opts) {
    const postData = {
      return_attributes: 'gender,age,glass,smiling,facequality,eyestatus,emotion,beauty,mouthstatus,eyegaze,skinstatus',
    };
    Object.assign(postData, opts);
    return this.queueMessage(faceAnalyzeEP, postData, 'faceSet');
  }

  // permanently delete an entire FaceSet (container + all its face_token memberships).
  // Irreversible - only ever called on another Homey's outer_id, never this app's own.
  async deleteFaceset(opts) {
    const postData = {};
    Object.assign(postData, opts);
    return this.queueMessage(fsDeleteEP, postData, 'faceSet');
  }

  // HTTPS request

  async _makeRequest(path, msg) {
    // multipart/form-data instead of a urlencoded/base64 body: a Buffer field (e.g. the
    // image itself) is attached as a Blob, which fetch/undici streams directly rather
    // than first inflating it into one big base64 string plus another URLSearchParams
    // copy - the single biggest memory win available on this leg (verified: Face++'s
    // "image_file" accepts this directly, see zzz_apidocs/detect.txt).
    const form = new FormData();
    form.append('api_key', this.key);
    form.append('api_secret', this.secret);
    Object.entries(msg).forEach(([key, value]) => {
      if (Buffer.isBuffer(value)) {
        form.append(key, new Blob([value]), 'image.jpg');
      } else {
        form.append(key, String(value));
      }
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(`https://${this.host}:${this.port}${path}`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      const text = await res.text();
      const json = parse(text);
      if (json.error_message) throw Error(json.error_message);
      if (!res.ok) throw Error(res.status);
      return json;
    } catch (error) {
      if (error.name === 'AbortError') throw Error('Face++ request timed out');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

}

module.exports = FacePP;
