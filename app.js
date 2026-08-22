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

const Homey = require('homey');
const fs = require('fs');
const v8 = require('v8');
const { networkInterfaces } = require('os');
const Logger = require('./lib/captureLogs');
const FacePP = require('./lib/FacePP');
const {
  base64Decode, stripDataUrlPrefix, bufferToStream, streamToBuffer, decodeJpeg, scaleRegionToDecoded, cropDecoded,
} = require('./lib/ImageHelpers');

const getEmotion = (emotions) => {
  const emotionsArray = Object.keys(emotions).map((emotion) => ({ emotion, value: emotions[emotion] }));
  if (!emotionsArray || !emotionsArray[0]) return 'undefined';
  return emotionsArray.sort((a, b) => b.value - a.value)[0].emotion;
};

// Face++'s user_id constraint: max 255 chars, must not contain ^@,&=*'" - strip only
// those specific characters (not a broader whitelist) so accented/non-Latin names
// used as labels survive intact
const sanitizeUserId = (label) => String(label).replace(/[\^@,&=*'"]/g, '').slice(0, 255);

class FaceApp extends Homey.App {

  async onInit() {
    try {
      if (!this.logger) this.logger = new Logger({ name: 'log', length: 200, homey: this.homey });

      process.on('unhandledRejection', (error) => {
        this.error('unhandledRejection! ', error);
      });
      process.on('uncaughtException', (error) => {
        this.error('uncaughtException! ', error);
      });
      this.homey
        .on('unload', () => {
          this.log('app unload called');
          // save logs to persistant storage
          this.logger.saveLogs();
        })
        .on('cpuwarn', () => {
          this.log('cpuwarn!');
        })
        .on('memwarn', () => {
          this.log('memwarn!');
        });

      // first remove any settings-changed listener from a previous onInit() run
      if (this._onSettingsSet) {
        this.homey.settings.removeListener('set', this._onSettingsSet);
      }

      // only reload the app when the API key/secret or match threshold change; a
      // face_set change (adding/deleting a face from the settings UI) must NOT
      // trigger a full reload + Face++ re-sync
      this._onSettingsSet = (key) => {
        if (key !== 'settingsKey' && key !== 'settingsMatch') return;
        if (key === 'settingsMatch') this.log('Face Match settings changed:', JSON.stringify(this.homey.settings.get('settingsMatch')));
        if (key === 'settingsKey') this.log('API Key settings changed, reloading app now');
        this.logger.saveLogs();
        this.log('Re-initing app now');
        this.onInit();
      };
      this.homey.settings
        .on('set', this._onSettingsSet);

      this.matchSettings = this.homey.settings.get('settingsMatch') || { threshold: 75 }; // threshold
      const { apiKey, apiSecret } = this.homey.settings.get('settingsKey') || {}; // apiKey, apiSecret
      if (!apiKey || !apiSecret) {
        this.log('No API key entered in app settings');
        return;
      }

      const interfaces = networkInterfaces();
      let mac = null;

      if (interfaces.eth1 && interfaces.eth1[0].address) {
        mac = interfaces.eth1[0].mac;
      } else if (interfaces.wlan0 && interfaces.wlan0[0].address) {
        mac = interfaces.wlan0[0].mac;
      } else if (interfaces.eth0 && interfaces.eth0[0].address) {
        mac = interfaces.eth0[0].mac;
      }
      if (!mac) throw Error('No active network connection found.');

      this.outerID = `homey_${mac}`;
      this.log('Face++ outer_id for this Homey:', this.outerID);
      const options = {
        key: apiKey,
        secret: apiSecret,
      };
      this.FAPI = new FacePP(options);

      // register flows and tokens
      await this.registerFlowCards();
      await this.registerFlowTokens();

      // sync Face++ set and local .img files; not awaited so a slow/unreachable
      // Face++ API can never cause onInit() to overrun Homey's ready window
      this.syncFaceset().catch((error) => this.error(error));

      this.log('Face++ is running...');

    } catch (error) {
      this.error(error);
    }

  }

  //  stuff for frontend API
  deleteLogs() {
    return this.logger.deleteLogs();
  }

  // verify an API key/secret pair actually works against Face++, without
  // touching this.FAPI (the app's own live client, built from the already-saved key)
  async testApiKey(body) {
    const { apiKey, apiSecret } = body || {};
    if (!apiKey || !apiSecret) throw Error('Missing API key or secret');
    const testApi = new FacePP({ key: apiKey, secret: apiSecret });
    await testApi.getFaceSets();
    return true;
  }

  getLogs() {
    return this.logger.logArray;
  }

  // TEMP diagnostics for the memwarn/crash investigation - remove once resolved.
  // Sandbox-safe: process.memoryUsage() crashes inside Homey's V8 sandbox
  // (ENOENT: no such file or directory, uv_resident_set_memory).
  logHeapStats(label) {
    const heap = v8.getHeapStatistics();
    const mb = (bytes) => Math.round((bytes / 1024 / 1024) * 100) / 100;
    this.log(`[MEM] ${label} | used: ${mb(heap.used_heap_size)}MB, total: ${mb(heap.total_heap_size)}MB, external: ${mb(heap.external_memory || 0)}MB, limit: ${mb(heap.heap_size_limit)}MB`);
  }

  // returns an array of detected scenes and objects
  async detectObjects(imgBase64) {
    const options = {
      image_base64: imgBase64,
    };
    return this.FAPI.detectObjects(options);
  }

  // returns a formatted array of recognised objects, and triggers flowCards
  async searchObjects(imgBase64, origin) {
    try {
      const { scenes, objects } = await this.detectObjects(imgBase64);

      const scene = {
        value: 'undefined',
        confidence: 0,
      };
      if (scenes.length > 0) {
        const bestScene = scenes.sort((a, b) => b.confidence - a.confidence)[0];
        scene.value = bestScene.value;
        scene.confidence = bestScene.confidence;
      }
      const objectResult = await Promise.all(objects.map(async (obj) => {
        const tokens = {
          origin: origin || 'undefined',
          scene: scene.value,
          scene_confidence: scene.confidence,
          object: obj.value,
          object_confidence: obj.confidence,
        };
        this.log(tokens);
        return tokens;
      }));
      if (objectResult.length === 0) this.log(`no objects found in image ${origin}`);
      return objectResult;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  // returns an array of detected faces plus attributes. Accepts either a raw Buffer
  // (the flow-card camera-image path) or a base64/data-URL string (the settings-page
  // upload path, which can only reach us as base64 JSON over Homey.api) - either way
  // it's sent on to Face++ as a multipart "image_file" attachment, never re-encoded
  // back to base64.
  async detectFaces(img) {
    const imgBuffer = Buffer.isBuffer(img) ? img : base64Decode(stripDataUrlPrefix(img));
    const options = {
      image_file: imgBuffer,
    };
    return this.FAPI.detectFaces(options);
  }

  // get faceImageToken Stream. `bounds` (Face++'s face_rectangle) is in the original
  // photo's native pixel coordinates - decodedImage may be downscaled (see
  // ImageHelpers.decodeJpeg), so remap it onto the decoded raster first.
  async getFaceToken(decodedImage, bounds) {
    const scaledBounds = scaleRegionToDecoded(decodedImage, bounds);
    const croppedFace = cropDecoded(decodedImage, scaledBounds);
    const imgFunct = async (stream) => {
      const imgStream = bufferToStream(croppedFace);
      imgStream.pipe(stream);
    };
    const faceImage = await this.homey.images.createImage();
    faceImage.setStream(imgFunct);
    setTimeout(() => {
      faceImage.unregister();
    }, 1000 * 60 * 3); // image stream is available for 3 minutes
    return faceImage;
  }

  // face_image_token is a required "image"-type trigger token, so even with cropping
  // turned off (settings.tab3 "Face Crop") it needs a valid Image - a single static
  // placeholder, registered once and reused for every trigger, costs nothing per
  // detection (no decode, no per-face image creation).
  async getPlaceholderFaceImage() {
    if (!this.noCropImage) {
      const fileName = this.homey.platformVersion === 2 ? '/app/assets/images/no_crop.jpg' : `${__dirname}/assets/images/no_crop.jpg`;
      this.noCropImage = await this.homey.images.createImage();
      this.noCropImage.setPath(fileName);
    }
    return this.noCropImage;
  }

  // registers an unmatched, high-quality detected face as a new known face (settings.tab4
  // "Auto-add Faces", off by default). Reuses the already-decoded raster when available
  // (crop enabled) but decodes on demand otherwise - auto-add only fires for genuinely
  // new, unmatched faces, so this is rare enough that the extra decode is a non-issue even
  // with cropping turned off. Mirrors addFace()'s Face++ + local face_set bookkeeping, and
  // labels the face the same way fetchForeignFaces() labels an import with no real name.
  async autoAddFace(face, decodedImage, imgBuffer) {
    const homeySet = this.homey.settings.get('face_set') || {};
    const autoAddedCount = Object.values(homeySet).filter((entry) => entry.autoAdded).length;
    const settings = this.homey.settings.get('settingsAutoAdd') || {};
    const maxCount = Number(settings.maxCount) || 20;
    if (autoAddedCount >= maxCount) {
      this.log(`auto-add: skipped, max auto-added faces (${maxCount}) already reached`);
      return null;
    }

    const raster = decodedImage || decodeJpeg(imgBuffer);
    const scaledBounds = scaleRegionToDecoded(raster, face.face_rectangle);
    const croppedFace = cropDecoded(raster, scaledBounds);
    fs.writeFileSync(`/userdata/${face.face_token}.img`, croppedFace);

    await this.FAPI.fsAddFace({ outer_id: this.outerID, face_tokens: face.face_token });

    const glassesWord = this.homey.__('settings.tab4.unnamedFaceGlassesLabel');
    const label = `${this.homey.__('settings.tab4.unnamedFaceLabel')} ${face.attributes.gender.value} ${face.attributes.age.value} ${glassesWord}: ${face.attributes.glass.value}`;
    await this.FAPI.setFaceUserId({ face_token: face.face_token, user_id: sanitizeUserId(label) })
      .catch((error) => this.error('failed to tag auto-added face with its label:', error));

    const faceInfo = {
      ...face, label, autoAdded: true, addedAt: Date.now(),
    };
    const faceSet = this.homey.settings.get('face_set') || {};
    faceSet[face.face_token] = faceInfo;
    this.homey.settings.set('face_set', faceSet);
    this.log('auto-added face', label);
    await this.triggerFaceAdded(faceInfo, croppedFace);
    return faceInfo;
  }

  // fires the "New face added" trigger for a freshly added face_set entry - shared by
  // autoAddFace() and addFace(). Same createImage/setStream pattern as getFaceToken(),
  // rather than Image.setPath() on the /userdata/*.img file directly, since setStream is
  // the one already proven to work reliably in this app.
  async triggerFaceAdded(faceInfo, imgBuffer) {
    const attributes = faceInfo.attributes || {};
    const imgFunct = async (stream) => {
      const imgStream = bufferToStream(imgBuffer);
      imgStream.pipe(stream);
    };
    const faceImage = await this.homey.images.createImage();
    faceImage.setStream(imgFunct);
    setTimeout(() => {
      faceImage.unregister();
    }, 1000 * 60 * 3); // image stream is available for 3 minutes

    const tokens = {
      label: faceInfo.label,
      token: faceInfo.face_token,
      quality: attributes.facequality ? attributes.facequality.value : 0,
      gender: attributes.gender ? attributes.gender.value : 'undefined',
      age: attributes.age ? attributes.age.value : 0,
      normalglass: attributes.glass ? attributes.glass.value === 'Normal' : false,
      sunglass: attributes.glass ? attributes.glass.value === 'Dark' : false,
      autoAdded: !!faceInfo.autoAdded,
      face_image_token: faceImage,
    };
    const faceAddedTrigger = this.homey.flow.getTriggerCard('face_added');
    await faceAddedTrigger.trigger(tokens).catch((error) => this.error('face_added trigger failed:', error));
  }

  // returns a formatted array of recognised faces, and triggers flowCards.
  // Serialized across calls via _searchFaces so two trigger images arriving in quick
  // succession never process at the same time - extra safety margin on top of
  // ImageHelpers.decodeJpeg's own bounded (scaled) memory footprint.
  async searchFaces(imgStream, origin) {
    this.searchQueue = (this.searchQueue || Promise.resolve())
      .catch(() => {}) // don't let one failed run wedge the queue for the next
      .then(() => this._searchFaces(imgStream, origin));
    return this.searchQueue;
  }

  async _searchFaces(imgStream, origin) {
    try {
      const imgBuffer = await streamToBuffer(imgStream);
      const { faces } = await this.detectFaces(imgBuffer);
      // decode the JPEG once and reuse it for every face's crop, instead of each
      // getFaceToken() call redoing a full-image decode of its own - skipped entirely
      // when cropping is turned off (settings.tab3 "Face Crop"), not just left unused,
      // so no local image processing happens at all in that case
      const cropEnabled = this.homey.settings.get('cropEnabled') !== false;
      const decodedImage = (cropEnabled && faces.length > 0) ? decodeJpeg(imgBuffer) : null;
      // TEMP diagnostics for the memwarn/crash investigation - remove once resolved.
      // process.memoryUsage() is NOT safe here: it crashes inside Homey's V8 sandbox
      // (ENOENT: no such file or directory, uv_resident_set_memory) - v8.getHeapStatistics()
      // is the sandbox-safe alternative.
      if (decodedImage) {
        this.logHeapStats(`decoded ${origin}: ${decodedImage.width}x${decodedImage.height}, before gc`);
      }
      const homeySet = this.homey.settings.get('face_set') || {};
      const searchResult = await Promise.all(faces.map(async (face) => {
        try {
          const snapshot = decodedImage
            ? await this.getFaceToken(decodedImage, face.face_rectangle)
            : await this.getPlaceholderFaceImage();
          const tokens = {
            origin: origin || 'undefined',
            label: 'NOMATCH',
            confidence: 0,
            token: face.face_token,
            quality: face.attributes.facequality.value,
            gender: face.attributes.gender.value,
            age: face.attributes.age.value,
            emotion: getEmotion(face.attributes.emotion),
            normalglass: face.attributes.glass.value === 'Normal',
            sunglass: face.attributes.glass.value === 'Dark',
            mask: face.attributes.mouthstatus.surgical_mask_or_respirator.value > 50,
            face_image_token: snapshot,
          };
          if (Object.keys(homeySet).length > 0) {
            const options = {
              outer_id: this.outerID,
              face_token: face.face_token,
            };
            const result = await this.FAPI.searchFaces(options);
            const { threshold } = this.matchSettings;
            if (result.results) {
              const bestMatch = result.results.sort((a, b) => b.confidence - a.confidence)[0];
              if (bestMatch.confidence > threshold) {
                tokens.label = homeySet[bestMatch.face_token].label;
                tokens.confidence = bestMatch.confidence;
                tokens.token = homeySet[bestMatch.face_token].face_token;
              }
            }
          }

          if (tokens.label === 'NOMATCH') {
            const autoAddSettings = this.homey.settings.get('settingsAutoAdd') || {};
            const qualityThreshold = Number(autoAddSettings.threshold) || 80;
            if (autoAddSettings.enabled && face.attributes.facequality.value > qualityThreshold) {
              const added = await this.autoAddFace(face, decodedImage, imgBuffer)
                .catch((error) => {
                  this.error('auto-add face failed:', error); return null;
                });
              if (added) {
                tokens.label = added.label;
                tokens.confidence = 100;
                tokens.token = face.face_token;
              }
            }
          }

          const logTokens = { ...tokens };
          logTokens.face_image_token = tokens.face_image_token.cloudUrl;
          this.log(logTokens);

          const faceDetectedTrigger = this.homey.flow.getTriggerCard('face_detected');
          await faceDetectedTrigger.trigger(tokens);
          return tokens;
        } catch (error) {
          this.error(`skipping a face in image ${origin}:`, error);
          return null;
        }
      }));
      const found = searchResult.filter(Boolean);
      if (found.length === 0) this.log(`no faces found in image ${origin}`);
      return found;
    } catch (error) {
      this.error(error);
      return [];
    } finally {
      // the raster decode above is a large buffer outside V8's JS heap; force it
      // out of memory now instead of waiting on V8's heap-size-driven (not
      // RSS-driven) GC heuristics, which run too infrequently for Homey's budget
      const hasGc = typeof global.gc === 'function';
      if (hasGc) global.gc();
      // TEMP diagnostics for the memwarn/crash investigation - remove once resolved
      this.logHeapStats(`_searchFaces done for ${origin}, global.gc available: ${hasGc}, after gc`);
    }
  }

  async analyzeImage(args) {
    try {
      // get the contents of the image
      const image = args.droptoken;
      if (!image || !image.getStream) throw Error('no valid image stream');
      const imageStream = await image.getStream();
      this.log('analyzing image from face', args.origin);
      await this.searchFaces(imageStream, args.origin);
    } catch (error) {
      this.error(error);
    }
  }

  // sync the Homey set with Face++ set and userdata/*.img. Guarded against running twice
  // at once - it's called unawaited from onInit(), and can also now be triggered manually
  // via the Manage Cloud tab's "Rebuild" button (resyncOwnFaceset());
  // both hitting Face++ for the same outerID concurrently would race.
  async syncFaceset() {
    if (this._syncingFaceset) {
      this.log('syncFaceset already running, skipping this call');
      return;
    }
    this._syncingFaceset = true;
    try {
      const homeySet = this.homey.settings.get('face_set') || {};
      if (Object.keys(homeySet).length === 0) {
        // Nothing registered locally - do NOT wipe Face++'s faceset for this outerID.
        // A local face_set can be empty either genuinely (no faces added yet) or
        // because Homey reset the app's settings (e.g. a dev-session uninstall while
        // testing) while the Face++-side faceset for this outerID survived untouched.
        // Treating "empty locally" as "should be empty on Face++ too" would silently
        // delete real cloud data in the second case, so leave Face++ alone until a
        // real local face_set exists again.
        this.log('no local faces registered yet, skipping Face++ faceset sync');
        return;
      }
      // remove all face tokens in Face++ set
      const options = {
        outer_id: this.outerID,
        face_tokens: 'RemoveAllFaceTokens',
      };
      await this.FAPI.fsRemoveFace(options)
        .catch((error) => {
          if (error.message.includes('INVALID_OUTER_ID')) return;
          this.error(error);
        });

      // add all face tokens from Homey set to Face++ set, tagging each with its label
      // so any Homey sharing this Face++ account can later recover it (fetchForeignFaces)
      const ready = Object.keys(homeySet).map(async (face) => {
        const opts = {
          outer_id: this.outerID,
          face_tokens: face,
        };
        await this.FAPI.fsAddFace(opts);
        const { label } = homeySet[face] || {};
        if (!label) return;
        await this.FAPI.setFaceUserId({ face_token: face, user_id: sanitizeUserId(label) })
          .catch((error) => this.error(`failed to tag face ${face} with its label:`, error));
      });
      await Promise.all(ready);

      // purge all img files that are not in homeySet
      const files = fs.readdirSync('/userdata');
      files.forEach((file) => {
        if (file.includes('.img')) {
          const token = file.split('.')[0];
          if (!Object.keys(homeySet).includes(token)) {
            fs.unlinkSync(`/userdata/${file}`);
          }
        }
      });
      this.log('ready syncing face set with cloud');
    } catch (error) {
      this.error('CRITICAL: FACE SET CLOUD SYNC FAILED!');
      this.error(error);
    } finally {
      this._syncingFaceset = false;
    }
  }

  // Gatekeeper for the Manage Cloud tab's "Rebuild" button:
  // rebuilds this Homey's Face++ faceset FROM the local face_set (local -> cloud). Same
  // logic syncFaceset() already runs automatically on init - this just exposes it as an
  // explicit, user-facing action with its own confirmation, distinct from "Delete" (reserved
  // for other Homeys, since deleting your own actively-matched-against faceset with no
  // rebuild would break face recognition on this Homey until the next app restart).
  //
  // This is NOT the right tool after a reinstall (local face_set wiped, cloud still has
  // data) - syncFaceset() deliberately no-ops when local is empty, precisely so a wipe
  // doesn't happen accidentally. For that direction, see "Import faces from cloud"
  // (fetchForeignFaces() below, called with this Homey's own outerID), which pulls
  // cloud -> local instead.
  async resyncOwnFaceset() {
    if (this._syncingFaceset) throw Error(this.homey.__('settings.tab5.rebuildAlreadyRunning'));
    // not awaited - same timeout risk as fetchForeignFaces() for a large face_set
    this.syncFaceset().catch((error) => this.error('resyncOwnFaceset (background) failed:', error));
    return true;
  }

  // One-time, explicit import: pull known faces (label + token only, no photo) into this
  // Homey's own face set. Two sources use this same logic:
  // - another Homey's set ("Import faces" button, other-Homeys rows) - makes this Homey
  //   recognize people already known elsewhere on the account.
  // - THIS Homey's own cloud set ("Import faces from cloud" button, own row) - the
  //   recovery path after a reinstall wipes local settings while the cloud-side faceset
  //   survives untouched. Existing local faces and their locally stored photos are never
  //   touched either way, since only tokens NOT already known locally are ever processed.
  // Never runs automatically - only ever triggered by a settings-page button click. A
  // face with no user_id set (e.g. added by a version of this app that predates the
  // labeling feature) still gets imported, under a placeholder label the user can
  // rename from Manage Faces, rather than being silently dropped forever.
  //
  // For an OTHER Homey's set, two layers of de-duplication apply:
  // 1. face_token identity - a token already known locally (added here, or imported in
  //    an earlier run) is never reprocessed.
  // 2. facial similarity - Face++ assigns a NEW face_token every time a face is
  //    detected from a different photo, even of the same real person, so token identity
  //    alone can't catch "this is a person I already know, just registered elsewhere
  //    from a different photo". Each new candidate is searched against this Homey's own
  //    faceset (the same confidence threshold already configured for regular flow
  //    matching); a hit means it's the same person as an existing local entry - that
  //    local entry (its label, its own registration) is left completely untouched, and
  //    the duplicate candidate is fully ignored rather than merged in any way.
  // For THIS Homey's OWN set, the similarity search is skipped entirely - every
  // candidate is already a member of the very faceset being searched, so it would
  // trivially match itself and get skipped as a "duplicate" every time. Token identity
  // is the only dedup that's meaningful there, and no Face++ write calls are needed
  // either, since these tokens are already registered under this.outerID.
  //
  // Gatekeeper: refuses to start a second import while one is already running, and also
  // refuses to start a self-import while "Rebuild" is rewriting
  // the very faceset it would read. Returns as soon as the run has genuinely started -
  // the run itself (_runFetchForeignFaces) is not awaited here, since it can take well
  // over a minute and would otherwise trip Homey.api()'s own client-side timeout (see
  // api.js's fetchFaces handler).
  async fetchForeignFaces(body) {
    const { sourceOuterId } = body || {};
    if (!sourceOuterId) throw Error('Invalid source Homey');
    const isSelf = sourceOuterId === this.outerID;
    if (this._fetchingForeignFaces) throw Error(this.homey.__('settings.tab5.importAlreadyRunning'));
    if (isSelf && this._syncingFaceset) throw Error(this.homey.__('settings.tab5.rebuildAlreadyRunning'));
    this._fetchingForeignFaces = true;
    this._runFetchForeignFaces(sourceOuterId, isSelf)
      .catch((error) => this.error('fetchForeignFaces (background) failed:', error))
      .finally(() => {
        this._fetchingForeignFaces = false;
      });
    return true;
  }

  async _runFetchForeignFaces(sourceOuterId, isSelf) {
    let homeySet;
    let knownTokens;
    let candidateTokens;
    let attributesByToken;
    try {
      homeySet = this.homey.settings.get('face_set') || {};
      knownTokens = new Set(Object.keys(homeySet));

      const detail = await this.FAPI.getFacesetDetail({ outer_id: sourceOuterId });
      candidateTokens = (detail.face_tokens || []).filter((token) => !knownTokens.has(token));
      this.log(`fetchForeignFaces: importing from ${sourceOuterId}${isSelf ? ' (own cloud set)' : ''}, ${candidateTokens.length} candidate faces`);

      // face/getdetail (used per-candidate below, for user_id) never includes
      // gender/age/quality/glass/etc - only face/analyze does, and it batches up to 5
      // tokens per call, so this stays cheap even for a large import (e.g. 14 tokens is
      // just 3 calls) rather than one extra call per candidate
      attributesByToken = {};
      const batchSize = 5;
      for (let i = 0; i < candidateTokens.length; i += batchSize) {
        const batch = candidateTokens.slice(i, i + batchSize);
        try {
          // eslint-disable-next-line no-await-in-loop
          const analyzeResult = await this.FAPI.analyzeFaces({ face_tokens: batch.join(',') });
          (analyzeResult.faces || []).forEach((face) => {
            attributesByToken[face.face_token] = face.attributes;
          });
        } catch (error) {
          this.error('failed to analyze a batch of candidate faces:', error);
        }
      }
    } catch (error) {
      this.error('fetchForeignFaces failed while listing candidates:', error);
      throw error;
    }

    const { threshold } = this.matchSettings;
    let imported = 0;
    let unnamed = 0;
    let merged = 0;
    let skipped = 0;

    // sequential on purpose: each import must become searchable before the NEXT
    // candidate is checked, so the same person registered under two different
    // foreign tokens only ever ends up with one local entry, not two
    for (let i = 0; i < candidateTokens.length; i += 1) {
      const token = candidateTokens[i];
      try {
        const faceDetail = await this.FAPI.getFaceDetail({ face_token: token }); // eslint-disable-line no-await-in-loop
        const hasRealLabel = !!faceDetail.user_id;
        const attrs = attributesByToken[token];
        let label;
        if (hasRealLabel) {
          label = faceDetail.user_id;
        } else if (attrs && attrs.gender && attrs.age && attrs.glass) {
          // e.g. "Unnamed Male 52 glasses: Normal" - far more useful for telling several
          // placeholder entries apart at a glance than a meaningless token substring
          const glassesWord = this.homey.__('settings.tab4.unnamedFaceGlassesLabel');
          label = `${this.homey.__('settings.tab4.unnamedFaceLabel')} ${attrs.gender.value} ${attrs.age.value} ${glassesWord}: ${attrs.glass.value}`;
        } else {
          // face/analyze failed for this candidate's batch - fall back to a token
          // fragment rather than blocking the import on missing attribute data
          label = `${this.homey.__('settings.tab4.unnamedFaceLabel')} ${token.slice(0, 8)}`;
        }

        let existingMatch = null;
        if (!isSelf) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const searchResult = await this.FAPI.searchFaces({ outer_id: this.outerID, face_token: token });
            const bestMatch = (searchResult.results || []).sort((a, b) => b.confidence - a.confidence)[0];
            if (bestMatch && bestMatch.confidence > threshold) existingMatch = bestMatch;
          } catch (error) {
            const noLocalFacesYet = error.message.includes('INVALID_OUTER_ID') || error.message.includes('EMPTY_FACESET');
            if (!noLocalFacesYet) throw error;
          }
        }

        if (existingMatch) {
          // same person as an existing LOCAL profile - that local profile (its label,
          // its own token registration) is left completely untouched; this duplicate
          // candidate is fully ignored, nothing about it is registered anywhere
          merged += 1;
        } else {
          if (!isSelf) {
            await this.FAPI.fsAddFace({ outer_id: this.outerID, face_tokens: token }); // eslint-disable-line no-await-in-loop
            // only push a label back to Face++ if it already had a real one - never write
            // this Homey's local placeholder text there as if it were a real name
            if (hasRealLabel) {
              await this.FAPI.setFaceUserId({ face_token: token, user_id: label }) // eslint-disable-line no-await-in-loop
                .catch((error) => this.error(`failed to re-tag imported face ${token}:`, error));
            } else {
              unnamed += 1;
            }
          } else if (!hasRealLabel) {
            // already registered under this.outerID - no Face++ write needed, just count it
            unnamed += 1;
          }
          homeySet[token] = {
            face_token: token, label, imported: true, attributes: attributesByToken[token],
          };
          knownTokens.add(token);
          imported += 1;
        }
      } catch (error) {
        this.error(`failed to import face ${token}:`, error);
        skipped += 1;
      }
    }

    this.homey.settings.set('face_set', homeySet);
    this.log(`fetchForeignFaces: imported ${imported} (${unnamed} unnamed), merged ${merged}, skipped ${skipped}`);
    return {
      imported, unnamed, merged, skipped,
    };
  }

  // list every homey_* faceset on this account, including this Homey's own (flagged via
  // isOwn, sorted first) - read-only, used by the Manage Cloud tab. Deliberately just the
  // one getFaceSets() call and nothing more: an earlier version also fetched each entry's
  // face count via a getFacesetDetail() call per outer_id, and that fan-out (rate-limited,
  // one at a time) was slow enough - especially under real Face++-side throttling - to
  // blow past Homey's client-side API timeout, which silently looked like "no results" on
  // the frontend rather than a visible error. Face count is now lazy-loaded per row by the
  // frontend, one on-demand call each, after this list has already rendered (see
  // getFacesetFaceCount()).
  async listFacesets() {
    try {
      const allSets = await this.FAPI.getFaceSets();
      const outerIds = (allSets.facesets || [])
        .map((set) => set.outer_id)
        .filter((outerId) => outerId && outerId.startsWith('homey_'));
      // this Homey's own row must always show, even before it has ever had a faceset
      // created on Face++ (e.g. right after install, before any face is added) -
      // getFacesetFaceCount() already treats a missing faceset as 0 faces, so this
      // just makes sure the row itself is never silently dropped from the list
      if (!outerIds.includes(this.outerID)) outerIds.push(this.outerID);
      const list = outerIds
        .sort((a, b) => {
          if (a === this.outerID) return -1;
          if (b === this.outerID) return 1;
          return 0;
        })
        .map((outerId) => ({ outerId, isOwn: outerId === this.outerID }));
      this.log(`listFacesets: found ${list.length} Homeys`);
      return list;
    } catch (error) {
      this.error('listFacesets failed:', error);
      throw error;
    }
  }

  // face count for exactly one outer_id (including this Homey's own), fetched on-demand
  // by the frontend after the list has already rendered - not part of the bulk list, so
  // one slow/failed lookup can't hold up the others
  async getFacesetFaceCount(body) {
    const { outerId } = body || {};
    if (!outerId) throw Error('Invalid outer_id');
    try {
      const detail = await this.FAPI.getFacesetDetail({ outer_id: outerId });
      return { faceCount: detail.face_count };
    } catch (error) {
      // a Homey that has never had a face added yet (including possibly this one) has no
      // faceset on Face++ at all - that's a normal state, not an error, report 0 faces
      if (error.message.includes('INVALID_OUTER_ID')) return { faceCount: 0 };
      throw error;
    }
  }

  // permanently delete another Homey's faceset from Face++. Never touches this
  // Homey's own outer_id or local settings - only ever reachable from a settings-page
  // button behind an explicit, outer_id-naming confirmation, never from a flow.
  //
  // Verified live (2026-08-21): Face++'s faceset/delete only succeeds on an EMPTY
  // faceset - a non-empty one fails with FACESET_NOT_EMPTY. So this empties the
  // faceset first (RemoveAllFaceTokens, same call syncFaceset() already uses), then
  // deletes the now-empty container - one button click, two Face++ calls.
  async deleteForeignFaceset(body) {
    const { outerId } = body || {};
    if (!outerId || outerId === this.outerID) throw Error('Refusing to delete this Homey\'s own faceset');
    await this.FAPI.fsRemoveFace({ outer_id: outerId, face_tokens: 'RemoveAllFaceTokens' })
      .catch((error) => {
        if (error.message.includes('INVALID_OUTER_ID') || error.message.includes('EMPTY_FACESET')) return;
        throw error;
      });
    await this.FAPI.deleteFaceset({ outer_id: outerId });
    this.log('deleted foreign faceset', outerId);
    return true;
  }

  // add face to faceset
  async addFace(body) {
    if (!body.faceInfo || !body.faceInfo.face_token) throw Error('No Face Token; cannot add face');

    // save base64 file as jpeg/img
    const filename = `/userdata/${body.faceInfo.face_token}.img`;
    const file64 = stripDataUrlPrefix(body.img);
    const file = base64Decode(file64);
    fs.writeFileSync(filename, file);

    // add face to set in Face++, and tag it with its label so any Homey sharing this
    // Face++ account can later recover it via fetchForeignFaces()
    const options = {
      outer_id: this.outerID,
      face_tokens: body.faceInfo.face_token,
    };
    await this.FAPI.fsAddFace(options);
    if (body.faceInfo.label) {
      await this.FAPI.setFaceUserId({
        face_token: body.faceInfo.face_token,
        user_id: sanitizeUserId(body.faceInfo.label),
      }).catch((error) => this.error('failed to tag new face with its label:', error));
    }

    // store face persistent in Homey
    const faceSet = this.homey.settings.get('face_set') || {};
    const faceInfo = { ...body.faceInfo, addedAt: Date.now() };
    faceSet[body.faceInfo.face_token] = faceInfo;
    this.homey.settings.set('face_set', faceSet);
    this.log('added face', options);
    await this.triggerFaceAdded(faceInfo, file);
    return true;
  }

  // delete face from faceset
  async deleteFace(body) {
    // remove img file
    const filename = `/userdata/${body.faceInfo.face_token}.img`;
    if (fs.existsSync(filename)) fs.unlinkSync(filename);

    // remove face from in Homey
    const faceSet = this.homey.settings.get('face_set') || {};
    delete faceSet[body.faceInfo.face_token];
    this.homey.settings.set('face_set', faceSet);

    // delete face from set in Face++
    const options = {
      outer_id: this.outerID,
      face_tokens: body.faceInfo.face_token,
    };
    await this.FAPI.fsRemoveFace(options);
    this.log('deleted face', options);
    return true;
  }

  // register flow cards
  async registerFlowCards() {
    try {
      if (this.hasFlows) return;
      // action cards
      const analyzeImageAction = this.homey.flow.getActionCard('search_faces');
      analyzeImageAction.registerRunListener((args) => this.analyzeImage(args));
      this.hasFlows = true;
    } catch (error) {
      this.error(error);
    }
  }

  // register global flow tokens
  async registerFlowTokens() {
    try {
      // unregister tokens first
      if (!this.tokens) this.tokens = {};
      const ready = Object.keys(this.tokens).map((token) => this.homey.flow.unregisterToken(this.tokens[token]));
      await Promise.all(ready);

      // register the test image
      const fileName = this.homey.platformVersion === 2 ? '/app/assets/images/test.jpg' : '/assets/images/test.jpg';
      const testImage = await this.homey.images.createImage();
      testImage.setPath(fileName);

      // create a droptoken for test image
      this.tokens.testImageToken = await this.homey.flow.createToken('test_image_token', {
        type: 'image',
        title: 'Face++ Test Image',
      });
      await this.tokens.testImageToken.setValue(testImage);

      return this.tokens;
    } catch (error) {
      this.error(error);
      return this.tokens;
    }
  }

}

module.exports = FaceApp;
