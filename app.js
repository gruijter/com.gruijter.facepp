
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
// const util = require('util');
const Logger = require('./captureLogs.js');
const FacePP = require('./facepp.js');

// const setTimeoutPromise = util.promisify(setTimeout);

// convert binary data to base64 encoded string
const base64Encode = (img) => Buffer.from(img).toString('base64');
const base64Decode = (base64) => Buffer.from(base64, 'base64');

const getEmotion = (emotions) => {
	const emotionsArray = Object.keys(emotions).map((emotion) => ({ emotion, value: emotions[emotion] }));
	if (!emotionsArray || !emotionsArray[0]) return 'undefined';
	return emotionsArray.sort((a, b) => b.value - a.value)[0].emotion;
};

class FaceApp extends Homey.App {

	async onInit() {
		try {
			if (!this.logger) this.logger = new Logger('log', 200);
			// migrate old setting (<1.1.3)
			const oldSettings = Homey.ManagerSettings.get('settings');
			if (oldSettings) {
				this.log('migrating old app settings to new scheme');
				this.migrating = true;
				Homey.ManagerSettings.set('settingsKey', { apiKey: oldSettings.apiKey, apiSecret: oldSettings.apiSecret });
				Homey.ManagerSettings.set('settingsMatch', { threshold: oldSettings.threshold });
				Homey.ManagerSettings.unset('settings');
			}
			this.keySettings = Homey.ManagerSettings.get('settingsKey') || {}; // apiKey, apiSecret
			this.matchSettings = Homey.ManagerSettings.get('settingsMatch') || {}; // threshold
			const { apiKey } = this.keySettings;
			const { apiSecret } = this.keySettings;
			const options = {
				key: apiKey,
				secret: apiSecret,
			};
			Homey.ManagerSettings
				.on('set', (key) => {
					if (key === 'settingsMatch') {
						this.log('Face Match settings changed');
						return;
					}
					if (key === 'settingsKey') {
						this.log('app Key settings changed, reloading app now');
						this.logger.saveLogs();
						this.onInit();
					}
				});
			if (!apiKey || !apiSecret) {
				this.log('No API key entered in app settings');
				return;
			}
			this.outerID = `homey_${networkInterfaces().wlan0[0].mac}`;
			this.FAPI = new FacePP(options);
			this.log('Face++ is running...');

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
			this.registerFlowCards();
			this.registerFlowTokens();

			// sync Face++ set and local .img files
			await this.syncFaceset();

			// do garbage collection every 10 minutes
			// this.intervalIdGc = setInterval(() => {
			// 	global.gc();
			// }, 1000 * 60 * 10);

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
				// image_url: 'https://www.touristserver.nl/img/100015-1501858701/B1200X1200/Parkeerplaats+Kloosterstraat+1.JPG',
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
	async searchFaces(imgBase64, origin) {
		try {
			const homeySet = Homey.ManagerSettings.get('face_set') || {};
			const { faces } = await this.detectFaces(imgBase64);
			const searchResult = faces.map(async (face) => {
				const tokens = {
					origin: origin || 'undefined',
					label: 'NO_MATCH',
					confidence: 0,
					token: face.face_token,
					quality: face.attributes.facequality.value,
					gender: face.attributes.gender.value,
					age: face.attributes.age.value,
					emotion: getEmotion(face.attributes.emotion),
					normalglass: face.attributes.glass.value === 'Normal',
					sunglass: face.attributes.glass.value === 'Dark',
					mask: face.attributes.mouthstatus.surgical_mask_or_respirator.value > 50,
				};
				const options = {
					outer_id: this.outerID,
					face_token: face.face_token,
				};
				const result = await this.FAPI.searchFaces(options);
				if (result.results) {
					const bestMatch = result.results.sort((a, b) => b.confidence - a.confidence)[0];
					if (bestMatch.confidence > (this.matchSettings.threshold || 65)) {
						tokens.label = homeySet[bestMatch.face_token].label;
						tokens.confidence = bestMatch.confidence;
						tokens.token = homeySet[bestMatch.face_token].face_token;
					}
				}
				this.log(tokens);
				this.flows.faceDetectedTrigger.trigger(tokens);
				return tokens;
			});
			await Promise.all(searchResult);
			if (searchResult.length === 0) this.log(`no faces found in image ${origin}`);
			return searchResult;
		} catch (error) {
			return Promise.reject(error);
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
						fs.unlinkSync(file);
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
	registerFlowCards() {
		// unregister cards first
		if (!this.flows) this.flows = {};
		Object.keys(this.flows).forEach((flow) => Homey.ManagerFlow.unregisterCard(this.flows[flow]));

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
				// if (typeof image === 'undefined' || image == null) return false;
				const imageStream = await image.getStream();

				// save the image to userdata
				// this.log('saving ', imageStream.contentType);
				// const targetFile = fs.createWriteStream('./userdata/incoming.img');
				// imageStream.pipe(targetFile);

				// load image in memory
				imageStream.once('error', (err) => {
					this.error(err);
				});
				const chunks = [];
				// File is done being read
				imageStream.once('end', () => {
					const imgBuffer = Buffer.concat(chunks);
					this.searchFaces(base64Encode(imgBuffer), args.origin);
				});
				imageStream.on('data', (chunk) => {
					chunks.push(chunk); // push data chunk to array
				});
				return true;
			});
	}

	// register global flow tokens
	registerFlowTokens() {
		// unregister tokens first
		if (!this.tokens) this.tokens = {};
		Object.keys(this.tokens).forEach((token) => Homey.ManagerFlow.unregisterToken(this.tokens[token]));

		// register the test image
		const testImage = new Homey.Image();
		testImage.setPath('/assets/images/test.jpg');
		testImage.register()
			.then(() => {
				// create a token & register it
				this.tokens.testImageToken = new Homey.FlowToken('test_image_token', {
					type: 'image',
					title: 'Test Image',
				});
				this.tokens.testImageToken
					.register()
					.then(() => {
						this.tokens.testImageToken.setValue(testImage)
							.catch(this.error);
					})
					.catch(this.error.bind(this, 'testImageToken.register'));
			})
			.catch(this.error);
	}

}

module.exports = FaceApp;
