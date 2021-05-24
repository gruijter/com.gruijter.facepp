
/*
Copyright 2020, Robin de Gruijter (gruijter@hotmail.com)

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
const { networkInterfaces } = require('os');
const { Duplex } = require('stream');
const Jimp = require('jimp');
// const util = require('util');
const Logger = require('./captureLogs.js');
const FacePP = require('./facepp.js');

// const setTimeoutPromise = util.promisify(setTimeout);

// convert buffer to/from base64 encoded string
const base64Encode = (img) => Buffer.from(img).toString('base64');
const base64Decode = (base64) => Buffer.from(base64, 'base64');

const bufferToStream = (buffer) => {
	const stream = new Duplex();
	stream.push(buffer);
	stream.push(null);
	return stream;
};

const streamToBuffer = (stream) => new Promise((resolve, reject) => {
	const buffers = [];
	stream.on('error', reject);
	stream.on('data', (data) => buffers.push(data));
	stream.on('end', () => resolve(Buffer.concat(buffers)));
});

// image crop
const crop = async (imgBuffer, region) => {	// returns image buffer
	try {
		const image = await Jimp.read(imgBuffer);
		image.crop(region.left, region.top, region.width, region.height);
		return image.getBufferAsync(image.getMIME());
	} catch (error) {
		return error;
	}
};

// get faceImageToken Stream
const getFaceToken = async (imgBuffer, bounds) => {
	try {
		const croppedFace = await crop(imgBuffer, bounds);

		const imgFunct = async (stream) => {
			const imgStream = await bufferToStream(croppedFace);
			imgStream.pipe(stream);
		};
		const faceImage = new Homey.Image();
		faceImage.setStream(imgFunct);
		await faceImage.register();
		setTimeout(() => { faceImage.unregister(); }, 1000 * 60 * 3); // image stream is available for 3 minutes
		return faceImage;
	} catch (error) {
		return error;
	}
};

const getEmotion = (emotions) => {
	const emotionsArray = Object.keys(emotions).map((emotion) => ({ emotion, value: emotions[emotion] }));
	if (!emotionsArray || !emotionsArray[0]) return 'undefined';
	return emotionsArray.sort((a, b) => b.value - a.value)[0].emotion;
};

class FaceApp extends Homey.App {

	async onInit() {
		try {
			if (!this.logger) this.logger = new Logger('log', 200);

			// first remove settings events listener
			if (this.listeners && this.listeners.set) {
				Homey.ManagerSettings.removeListener('set', this.listeners.set);
			}

			// listen to change settings events
			this.listeners.set = (key) => {
				if (key === 'settingsMatch') {
					this.log('Face Match settings changed:', JSON.stringify(Homey.ManagerSettings.get('settingsMatch')));
				}
				if (key === 'settingsKey') {
					this.log('API Key settings changed, reloading app now');
				}
				this.logger.saveLogs();
				this.log('Re-initing app now');
				this.onInit();
			};
			Homey.ManagerSettings
				.on('set', this.listeners.set);

			this.matchSettings = Homey.ManagerSettings.get('settingsMatch') || { threshold: 75 }; // threshold
			const { apiKey, apiSecret } = Homey.ManagerSettings.get('settingsKey') || {}; // apiKey, apiSecret
			if (!apiKey || !apiSecret) {
				this.log('No API key entered in app settings');
				return;
			}

			this.outerID = `homey_${networkInterfaces().wlan0[0].mac}`;
			const options = {
				key: apiKey,
				secret: apiSecret,
			};
			this.FAPI = new FacePP(options);

			// register some listeners
			process.on('unhandledRejection', (error) => {
				this.error('unhandledRejection! ', error);
			});
			process.on('uncaughtException', (error) => {
				this.error('uncaughtException! ', error);
			});
			Homey
				.on('unload', () => {
					this.log('app unload called');
					// save logs to persistant storage
					this.logger.saveLogs();
				})
				.on('memwarn', () => {
					this.log('memwarn!');
				});

			// register flows and tokens
			await this.registerFlowCards();
			await this.registerFlowTokens();

			// sync Face++ set and local .img files
			await this.syncFaceset();

			this.log('Face++ is running...');

			// do garbage collection every 10 minutes
			// this.intervalIdGc = setInterval(() => {	global.gc(); }, 1000 * 60 * 10);

		} catch (error) {
			this.error(error);
		}

	}


	//  stuff for frontend API
	deleteLogs() {
		return this.logger.deleteLogs();
	}

	getLogs() {
		return this.logger.logArray;
	}

	// returns an array of detected scenes and objects
	async detectObjects(imgBase64) {
		try {
			const options = {
				image_base64: imgBase64,
			};
			const result = await this.FAPI.detectObjects(options);
			return Promise.resolve(result);
		} catch (error) {
			return Promise.reject(error);
		}
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
			const objectResult = objects.map(async (obj) => {
				const tokens = {
					origin: origin || 'undefined',
					scene: scene.value,
					scene_confidence: scene.confidence,
					object: obj.value,
					object_confidence: obj.confidence,
				};
				this.log(tokens);
				// this.flows.objectDetectedTrigger.trigger(tokens);
				return tokens;
			});
			await Promise.all(objectResult);
			if (objectResult.length === 0) this.log(`no objects found in image ${origin}`);
			return objectResult;
		} catch (error) {
			return Promise.reject(error);
		}
	}

	// returns an array of detected faces plus attributes
	async detectFaces(imgBase64) {
		try {
			const options = {
				image_base64: imgBase64,
			};
			const result = await this.FAPI.detectFaces(options);
			return Promise.resolve(result);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	// returns a formatted array of recognised faces, and triggers flowCards
	async searchFaces(imgStream, origin) {
		try {
			const imgBuffer = await streamToBuffer(imgStream);
			const imgBase64 = base64Encode(imgBuffer);
			const { faces } = await this.detectFaces(imgBase64);
			const homeySet = Homey.ManagerSettings.get('face_set') || {};
			const searchResult = faces.map(async (face) => {
				const snapshot = await getFaceToken(imgBuffer, face.face_rectangle);
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
				this.flows.faceDetectedTrigger.trigger(tokens);
				tokens.face_image_token = tokens.face_image_token.cloudUrl;
				this.log(tokens);
				return tokens;
			});
			await Promise.all(searchResult);
			if (searchResult.length === 0) this.log(`no faces found in image ${origin}`);
		} catch (error) {
			this.error(error);
		}
	}

	// sync the Homey set with Face++ set and userdata/*.img
	async syncFaceset() {
		try {
			// migrating from old sceme
			if (this.migrating) {
				this.log('migrating Face++ face set to new scheme');
				const options = {
					outer_id: 'homey',
					face_tokens: 'RemoveAllFaceTokens',
				};
				await this.FAPI.fsRemoveFace(options)
					.catch((error) => {
						if (error.message.includes('INVALID_OUTER_ID')) return;
						this.error(error);
					});
				this.migrating = false;
			}

			const homeySet = Homey.ManagerSettings.get('face_set') || {};
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

			// add all face tokens from Homey set to Face++ set
			const ready = Object.keys(homeySet).map((face) => {
				const opts = {
					outer_id: this.outerID,
					face_tokens: face,
				};
				return this.FAPI.fsAddFace(opts);
			});
			await Promise.all(ready);

			// purge all img files that are not in homeySet
			const files = fs.readdirSync('./userdata');
			files.forEach((file) => {
				if (file.includes('.img')) {
					const token = file.split('.')[0];
					if (!Object.keys(homeySet).includes(token)) {
						fs.unlinkSync(`./userdata/${file}`);
					}
				}
			});
			this.log('ready syncing face set with cloud');
		} catch (error) {
			this.error('CRITICAL: FACE SET CLOUD SYNC FAILED!');
			this.error(error);
		}
	}

	// add face to faceset
	async addFace(body) {
		try {
			if (!body.faceInfo || !body.faceInfo.face_token) throw Error('No Face Token; cannot add face');

			// save base64 file as jpeg/img
			const filename = `./userdata/${body.faceInfo.face_token}.img`;
			const file64 = body.img.replace(/^data:image\/(\w+);base64,/, '');
			const file = base64Decode(file64);
			fs.writeFileSync(filename, file);

			// add face to set in Face++
			const options = {
				outer_id: this.outerID,
				face_tokens: body.faceInfo.face_token,
			};
			await this.FAPI.fsAddFace(options);

			// store face persistent in Homey
			const faceSet = Homey.ManagerSettings.get('face_set') || {};
			faceSet[body.faceInfo.face_token] = body.faceInfo;
			Homey.ManagerSettings.set('face_set', faceSet);

			return Promise.resolve(true);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	// delete face from faceset
	async deleteFace(body) {
		try {
			// remove img file
			const filename = `./userdata/${body.faceInfo.face_token}.img`;
			if (fs.existsSync(filename)) fs.unlinkSync(filename);

			// remove face from in Homey
			const faceSet = Homey.ManagerSettings.get('face_set') || {};
			delete faceSet[body.faceInfo.face_token];
			Homey.ManagerSettings.set('face_set', faceSet);

			// delete face from set in Face++
			const options = {
				outer_id: this.outerID,
				face_tokens: body.face_token,
			};
			await this.FAPI.fsRemoveFace(options);
			return Promise.resolve(true);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	// register flow cards
	async registerFlowCards() {
		try {
			// unregister cards first
			if (!this.flows) this.flows = {};
			const ready = Object.keys(this.flows).map((flow) => Promise.resolve(Homey.ManagerFlow.unregisterCard(this.flows[flow])));
			await Promise.all(ready);

			// add trigggers
			this.flows.faceDetectedTrigger = new Homey.FlowCardTrigger('face_detected')
				.register();

			// add actions
			this.flows.analyzeImageAction = new Homey.FlowCardAction('search_faces')
				.register()
				.registerRunListener(async (args) => {
					// get the contents of the image
					const image = args.droptoken;
					if (!image || !image.getStream) return false;
					const imgStream = await image.getStream();
					this.searchFaces(imgStream, args.origin);
					return true;
				});
			return Promise.resolve(this.flows);
		} catch (error) {
			return Promise.resolve(error);
		}
	}

	// register global flow tokens
	async registerFlowTokens() {
		try {
			// unregister tokens first
			if (!this.tokens) this.tokens = {};
			const ready = Object.keys(this.tokens).map((token) => Promise.resolve(Homey.ManagerFlow.unregisterToken(this.tokens[token])));
			await Promise.all(ready);

			// register the test image
			const testImage = new Homey.Image();
			testImage.setPath('/assets/images/test.jpg');
			await testImage.register();

			// register testImageToken and add testImage
			this.tokens.testImageToken = new Homey.FlowToken('test_image_token', {
				type: 'image',
				title: 'Test Image',
			});
			await this.tokens.testImageToken.register();
			this.tokens.testImageToken.setValue(testImage);

			// register the faceImageToken
			// this.tokens.faceImageToken = new Homey.FlowToken('face_image_token', {
			// 	type: 'image',
			// 	title: 'New face snapshot',
			// });
			// await this.tokens.faceImageToken.register();
			// this.tokens.faceImageToken.setValue(testImage);

			return Promise.resolve(this.tokens);
		} catch (error) {
			return Promise.resolve(error);
		}
	}

}

module.exports = FaceApp;


/*
  {
    face_token: '2485daa964b877b1a6c6b109f409b561',
    face_rectangle: { top: 173, left: 218, width: 87, height: 87 },
    attributes: {
      gender: [Object],
      age: [Object],
      smile: [Object],
      eyestatus: [Object],
      emotion: [Object],
      facequality: [Object],
      beauty: [Object],
      mouthstatus: [Object],
      eyegaze: [Object],
      skinstatus: [Object],
      glass: [Object]
    }
  },

  face_image_token: Image {
    id: '75aa0755-e6de-4868-a4dd-9d16feb259a4',
    __client: { emit: [Function: bound __onImageEmit] },
    _type: 'buffer',
    _source: <Buffer ff d8 ff e0 00 10 4a 46 49 46 00 01 01 00 00 01 00 01 00 00 ff db 00 84 00 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 ... 7556 more bytes>,
    cloudUrl: 'https://5c4968afb1b00f14323059f6.connect.athom.com/image/75aa0755-e6de-4868-a4dd-9d16feb259a4/image',
    localUrl: 'http://10.0.0.61/image/75aa0755-e6de-4868-a4dd-9d16feb259a4/image'
  }

  PassThrough {
  _readableState: ReadableState {
    objectMode: false,
    highWaterMark: 16384,
    buffer: BufferList { head: null, tail: null, length: 0 },
    length: 0,
    pipes: null,
    pipesCount: 0,
    flowing: null,
    ended: false,
    endEmitted: false,
    reading: false,
    sync: false,
    needReadable: false,
    emittedReadable: false,
    readableListening: false,
    resumeScheduled: false,
    emitClose: true,
    autoDestroy: false,
    destroyed: false,
    defaultEncoding: 'utf8',
    awaitDrain: 0,
    readingMore: false,
    decoder: null,
    encoding: null,
    [Symbol(kPaused)]: null
  },
  readable: true,
  _events: [Object: null prototype] {
    end: [Function: bound onceWrapper] { listener: [Function: onend] },
    prefinish: [Function: prefinish],
    finish: [ [Function], [Function] ],
    unpipe: [Function: onunpipe],
    error: [Function: onerror],
    close: [Function: bound onceWrapper] { listener: [Function: onclose] }
  },
  _eventsCount: 6,
  _maxListeners: undefined,
  _writableState: WritableState {
    objectMode: false,
    highWaterMark: 16384,
    finalCalled: false,
    needDrain: false,
    ending: false,
    ended: false,
    finished: false,
    destroyed: false,
    decodeStrings: true,
    defaultEncoding: 'utf8',
    length: 0,
    writing: false,
    corked: 0,
    sync: true,
    bufferProcessing: false,
    onwrite: [Function: bound onwrite],
    writecb: null,
    writelen: 0,
    afterWriteTickInfo: null,
    bufferedRequest: null,
    lastBufferedRequest: null,
    pendingcb: 0,
    prefinished: false,
    errorEmitted: false,
    emitClose: true,
    autoDestroy: false,
    bufferedRequestCount: 0,
    corkedRequestsFree: {
      next: null,
      entry: null,
      finish: [Function: bound onCorkedFinish]
    }
  },
  writable: true,
  allowHalfOpen: false,
  _transformState: {
    afterTransform: [Function: bound afterTransform],
    needTransform: false,
    transforming: false,
    writecb: null,
    writechunk: null,
    writeencoding: null
  },
  contentType: 'image/jpeg',
  filename: '14a8d90d-6149-408a-b6d3-1c32dec81d82.jpg',
  meta: {
    contentType: 'image/jpeg',
    filename: '14a8d90d-6149-408a-b6d3-1c32dec81d82.jpg'
  },
  [Symbol(kCapture)]: false
}

  */
