
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

const https = require('https');
const qs = require('querystring');
// const util = require('util');

// const sample = 'https://www.gannett-cdn.com/presto/2019/02/05/USAT/9a0923f6-7dc1-4eec-8513-a366ab28d426-148805_1608r1.jpg';
const APIHost = 'api-us.faceplusplus.com';
const detectEP = '/facepp/v3/detect';
// const compareEP = '/facepp/v3/compare';
const searchEP = '/facepp/v3/search';
// const fsGetSetsEP = '/facepp/v3/faceset/getfacesets';
const fsCreateEP = '/facepp/v3/faceset/create';
// const fsDeleteEP = '/facepp/v3/faceset/delete';
// const fsGetDetailEP = '/facepp/v3/faceset/getdetail';
// const fsAddFaceEP = '/facepp/v3/faceset/addface';
const fsRemoveFaceEP = '/facepp/v3/faceset/removeface';

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
	}

	// detect, compare and find

	// returns an array of detected fases with face_token and attributes
	async detect(opts) {
		try {
			const postData = {
				return_attributes: 'gender,age,smiling,facequality,eyestatus,emotion,beauty,mouthstatus,eyegaze,skinstatus',
				// headpose,ethnicity,blur
			};
			Object.assign(postData, opts);
			const result = await this._makeRequest(detectEP, postData);
			return Promise.resolve(result);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	// returns the confidence that two images contain the same person
	// async compare(opts) {
	// 	try {
	// 		const postData = {
	// 		};
	// 		Object.assign(postData, opts);
	// 		const result = await this._makeRequest(compareEP, postData);
	// 		return Promise.resolve(result);
	// 	} catch (error) {
	// 		return Promise.reject(error);
	// 	}
	// }

	// returns most similar faces from Faceset
	async search(opts) {
		try {
			const postData = {
			};
			Object.assign(postData, opts);
			const result = await this._makeRequest(searchEP, postData);
			return Promise.resolve(result);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	// face set related commands: fsGetSets, fsAddFace, fsRemoveFace, fsGetFaces, fsDelete

	// Returns all facesets for this user
	// async fsGetSets(opts) {
	// 	try {
	// 		const postData = {
	// 		};
	// 		Object.assign(postData, opts);
	// 		const result = await this._makeRequest(fsGetSetsEP, postData);
	// 		return Promise.resolve(result);
	// 	} catch (error) {
	// 		return Promise.reject(error);
	// 	}
	// }

	// Add face_tokens to a faceset, and create a new faseSet if needed. returns faceset_token
	async fsAddFace(opts) {
		try {
			const postData = {
				force_merge: 1,
			};
			Object.assign(postData, opts);
			const result = await this._makeRequest(fsCreateEP, postData);
			return Promise.resolve(result);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	// Remove face_tokens from a faceset. returns number of faces left
	async fsRemoveFace(opts) {
		try {
			const postData = {
			};
			Object.assign(postData, opts);
			const result = await this._makeRequest(fsRemoveFaceEP, postData);
			return Promise.resolve(result);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	// Returns face_tokens in a faceset
	// async fsGetDetail(opts) {
	// 	try {
	// 		const postData = {
	// 		};
	// 		Object.assign(postData, opts);
	// 		const result = await this._makeRequest(fsGetDetailEP, postData);
	// 		// console.log(util.inspect(result, true, 10, true));
	// 		return Promise.resolve(result);
	// 	} catch (error) {
	// 		return Promise.reject(error);
	// 	}
	// }

	async _makeRequest(path, msg) {
		try {
			const auth = {
				api_key: this.key,
				api_secret: this.secret,
			};
			const message = qs.stringify(Object.assign(msg, auth));
			const headers = {
				// 'cache-control': 'no-cache',
				'content-type': 'application/x-www-form-urlencoded',
				'content-length': Buffer.byteLength(message),
				connection: 'Keep-Alive',
			};
			const options = {
				hostname: this.host,
				port: this.port,
				path,
				headers,
				method: 'POST',
			};
			const result = await this._makeHttpsRequest(options, message);
			const body = parse(result.body);
			if (body.error_message) throw Error(body.error_message);
			if (result.statusCode !== 200) throw Error(result.statusCode);
			// all is good
			return Promise.resolve(body);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	_makeHttpsRequest(options, postData) {
		return new Promise((resolve, reject) => {
			const req = https.request(options, (res) => {
				let resBody = '';
				res.on('data', (chunk) => {
					resBody += chunk;
				});
				res.once('end', () => {
					if (!res.complete) {
						return reject(Error('The connection was terminated while the message was still being sent'));
					}
					res.body = resBody;
					return resolve(res); // resolve the request
				});
			});
			req.once('error', (e) => {
				req.abort();
				return reject(e);
			});
			req.setTimeout(this.timeout, () => {
				req.abort();
			});
			// req.write(postData);
			req.end(postData);
		});
	}

}

module.exports = FacePP;

/*

{
    "request_id": "1586788728,146ce533-5e34-4a80-83a2-20fcf5d8f47f",
    "time_used": 719,
    "faces": [
        {
            "face_token": "25fd502c0b1cdaf517a3bcaedcb5c8df",
            "face_rectangle": {
                "top": 509,
                "left": 641,
                "width": 254,
                "height": 254
            }
        },
        {
            "face_token": "616d1c9274c51261c36b78fe4d9723b5",
            "face_rectangle": {
                "top": 390,
                "left": 1197,
                "width": 241,
                "height": 241
            }
        },
        {
            "face_token": "2007efd886a898d4cdcc8f05adae5dde",
            "face_rectangle": {
                "top": 687,
                "left": 2203,
                "width": 230,
                "height": 230
            }
        },
        {
            "face_token": "ca150ca8fdfd5dbd4e56ed565fd8bdee",
            "face_rectangle": {
                "top": 785,
                "left": 963,
                "width": 225,
                "height": 225
            }
        },
        {
            "face_token": "719eabf256ab2a908789c1be3f6bfc7f",
            "face_rectangle": {
                "top": 577,
                "left": 1596,
                "width": 217,
                "height": 217
            }
        }
    ],
    "image_id": "0D4w+ulFAz+fFR5hqyjbHA==",
    "face_num": 5
}


{
  request_id: '1586793557,d5ebdf50-57ba-4a00-8be4-9e95356d542e',
  time_used: 1643,
  faces: [
    {
      face_token: 'ed853df1a5cac0598cf86a35b5527674',
      face_rectangle: { top: 509, left: 641, width: 254, height: 254 },
      attributes: {
        gender: { value: 'Male' },
        age: { value: 22 },
        smile: { value: 100, threshold: 50 },
        headpose: {
          pitch_angle: 12.482726,
          roll_angle: -1.3984164,
          yaw_angle: 1.1271058
        },
        blur: {
          blurness: { value: 0.588, threshold: 50 },
          motionblur: { value: 0.588, threshold: 50 },
          gaussianblur: { value: 0.588, threshold: 50 }
        },
        eyestatus: {
          left_eye_status: {
            no_glass_eye_open: 99.996,
            no_glass_eye_close: 0,
            normal_glass_eye_open: 0.004,
            normal_glass_eye_close: 0,
            dark_glasses: 0,
            occlusion: 0
          },
          right_eye_status: {
            no_glass_eye_open: 100,
            no_glass_eye_close: 0,
            normal_glass_eye_open: 0,
            normal_glass_eye_close: 0,
            dark_glasses: 0,
            occlusion: 0
          }
        },
        emotion: {
          anger: 0,
          disgust: 0,
          fear: 0,
          happiness: 99.984,
          neutral: 0.003,
          sadness: 0,
          surprise: 0.012
        },
        facequality: { value: 89.534, threshold: 70.1 },
        ethnicity: { value: '' },
        beauty: { male_score: 84.446, female_score: 90.574 },
        mouthstatus: {
          surgical_mask_or_respirator: 0,
          other_occlusion: 0,
          close: 0,
          open: 100
        },
        eyegaze: {
          left_eye_gaze: {
            position_x_coordinate: 0.457,
            position_y_coordinate: 0.429,
            vector_x_component: -0.113,
            vector_y_component: 0.158,
            vector_z_component: 0.981
          },
          right_eye_gaze: {
            position_x_coordinate: 0.499,
            position_y_coordinate: 0.428,
            vector_x_component: 0.078,
            vector_y_component: 0.115,
            vector_z_component: 0.99
          }
        },
        skinstatus: {
          health: 51.614,
          stain: 2.807,
          dark_circle: 4.018,
          acne: 0.805
        },
        glass: { value: 'None' }
      }
    },
    {
      face_token: '1a201d3e624684997f58c842d41def45',
      face_rectangle: { top: 390, left: 1197, width: 241, height: 241 },
      attributes: {
        gender: { value: 'Male' },
        age: { value: 62 },
        smile: { value: 100, threshold: 50 },
        headpose: {
          pitch_angle: 5.0419316,
          roll_angle: 10.655621,
          yaw_angle: 4.5546713
        },
        blur: {
          blurness: { value: 0.299, threshold: 50 },
          motionblur: { value: 0.299, threshold: 50 },
          gaussianblur: { value: 0.299, threshold: 50 }
        },
        eyestatus: {
          left_eye_status: {
            no_glass_eye_open: 99.994,
            no_glass_eye_close: 0,
            normal_glass_eye_open: 0.006,
            normal_glass_eye_close: 0,
            dark_glasses: 0,
            occlusion: 0
          },
          right_eye_status: {
            no_glass_eye_open: 99.999,
            no_glass_eye_close: 0,
            normal_glass_eye_open: 0,
            normal_glass_eye_close: 0,
            dark_glasses: 0,
            occlusion: 0
          }
        },
        emotion: {
          anger: 0,
          disgust: 0,
          fear: 0,
          happiness: 100,
          neutral: 0,
          sadness: 0,
          surprise: 0
        },
        facequality: { value: 90.6, threshold: 70.1 },
        ethnicity: { value: '' },
        beauty: { male_score: 82.257, female_score: 89.083 },
        mouthstatus: {
          surgical_mask_or_respirator: 0,
          other_occlusion: 0,
          close: 0,
          open: 100
        },
        eyegaze: {
          left_eye_gaze: {
            position_x_coordinate: 0.462,
            position_y_coordinate: 0.416,
            vector_x_component: 0.01,
            vector_y_component: -0.216,
            vector_z_component: 0.976
          },
          right_eye_gaze: {
            position_x_coordinate: 0.517,
            position_y_coordinate: 0.386,
            vector_x_component: 0.049,
            vector_y_component: -0.311,
            vector_z_component: 0.949
          }
        },
        skinstatus: {
          health: 2.139,
          stain: 39.847,
          dark_circle: 3.966,
          acne: 26.249
        },
        glass: { value: 'None' }
      }
    },
    {
      face_token: '13651ffbfc738d22c1ad4137ea558991',
      face_rectangle: { top: 687, left: 2203, width: 230, height: 230 },
      attributes: {
        gender: { value: 'Female' },
        age: { value: 35 },
        smile: { value: 100, threshold: 50 },
        headpose: {
          pitch_angle: -1.8608098,
          roll_angle: 14.51232,
          yaw_angle: 7.8295326
        },
        blur: {
          blurness: { value: 0.06, threshold: 50 },
          motionblur: { value: 0.06, threshold: 50 },
          gaussianblur: { value: 0.06, threshold: 50 }
        },
        eyestatus: {
          left_eye_status: {
            no_glass_eye_open: 99.998,
            no_glass_eye_close: 0,
            normal_glass_eye_open: 0.001,
            normal_glass_eye_close: 0,
            dark_glasses: 0.001,
            occlusion: 0.001
          },
          right_eye_status: {
            no_glass_eye_open: 99.998,
            no_glass_eye_close: 0,
            normal_glass_eye_open: 0.001,
            normal_glass_eye_close: 0,
            dark_glasses: 0,
            occlusion: 0
          }
        },
        emotion: {
          anger: 0,
          disgust: 0,
          fear: 0,
          happiness: 99.999,
          neutral: 0,
          sadness: 0,
          surprise: 0
        },
        facequality: { value: 87.064, threshold: 70.1 },
        ethnicity: { value: '' },
        beauty: { male_score: 64.664, female_score: 68.995 },
        mouthstatus: {
          surgical_mask_or_respirator: 0,
          other_occlusion: 0,
          close: 0.017,
          open: 99.983
        },
        eyegaze: {
          left_eye_gaze: {
            position_x_coordinate: 0.5,
            position_y_coordinate: 0.389,
            vector_x_component: 0.166,
            vector_y_component: -0.15,
            vector_z_component: 0.975
          },
          right_eye_gaze: {
            position_x_coordinate: 0.517,
            position_y_coordinate: 0.422,
            vector_x_component: 0.092,
            vector_y_component: -0.034,
            vector_z_component: 0.995
          }
        },
        skinstatus: {
          health: 20.908,
          stain: 15.36,
          dark_circle: 3.744,
          acne: 2.004
        },
        glass: { value: 'None' }
      }
    },
    {
      face_token: '347b46f60d4c10702edf42d7fcbe79c0',
      face_rectangle: { top: 785, left: 963, width: 225, height: 225 },
      attributes: {
        gender: { value: 'Female' },
        age: { value: 26 },
        smile: { value: 98.041, threshold: 50 },
        headpose: {
          pitch_angle: -0.5441722,
          roll_angle: 6.990161,
          yaw_angle: -7.63299
        },
        blur: {
          blurness: { value: 1.427, threshold: 50 },
          motionblur: { value: 1.427, threshold: 50 },
          gaussianblur: { value: 1.427, threshold: 50 }
        },
        eyestatus: {
          left_eye_status: {
            no_glass_eye_open: 0.3,
            no_glass_eye_close: 0,
            normal_glass_eye_open: 98.582,
            normal_glass_eye_close: 0.001,
            dark_glasses: 1.062,
            occlusion: 0.055
          },
          right_eye_status: {
            no_glass_eye_open: 0.313,
            no_glass_eye_close: 0,
            normal_glass_eye_open: 90.138,
            normal_glass_eye_close: 0,
            dark_glasses: 9.541,
            occlusion: 0.008
          }
        },
        emotion: {
          anger: 0.889,
          disgust: 0.121,
          fear: 0.02,
          happiness: 92.891,
          neutral: 0.839,
          sadness: 0.02,
          surprise: 5.22
        },
        facequality: { value: 87.27, threshold: 70.1 },
        ethnicity: { value: '' },
        beauty: { male_score: 73.828, female_score: 74.723 },
        mouthstatus: {
          surgical_mask_or_respirator: 0,
          other_occlusion: 0,
          close: 100,
          open: 0
        },
        eyegaze: {
          left_eye_gaze: {
            position_x_coordinate: 0.429,
            position_y_coordinate: 0.444,
            vector_x_component: -0.082,
            vector_y_component: -0.107,
            vector_z_component: 0.991
          },
          right_eye_gaze: {
            position_x_coordinate: 0.392,
            position_y_coordinate: 0.437,
            vector_x_component: -0.118,
            vector_y_component: -0.054,
            vector_z_component: 0.992
          }
        },
        skinstatus: {
          health: 66.982,
          stain: 8.087,
          dark_circle: 2.913,
          acne: 3.106
        },
        glass: { value: 'Normal' }
      }
    },
    {
      face_token: '3e317b26893590a0cd039c560ec49c84',
      face_rectangle: { top: 577, left: 1596, width: 217, height: 217 },
      attributes: {
        gender: { value: 'Female' },
        age: { value: 63 },
        smile: { value: 100, threshold: 50 },
        headpose: {
          pitch_angle: 3.6434827,
          roll_angle: -1.4149864,
          yaw_angle: 23.208593
        },
        blur: {
          blurness: { value: 0.314, threshold: 50 },
          motionblur: { value: 0.314, threshold: 50 },
          gaussianblur: { value: 0.314, threshold: 50 }
        },
        eyestatus: {
          left_eye_status: {
            no_glass_eye_open: 99.982,
            no_glass_eye_close: 0,
            normal_glass_eye_open: 0.018,
            normal_glass_eye_close: 0,
            dark_glasses: 0,
            occlusion: 0
          },
          right_eye_status: {
            no_glass_eye_open: 99.858,
            no_glass_eye_close: 0,
            normal_glass_eye_open: 0.063,
            normal_glass_eye_close: 0,
            dark_glasses: 0.079,
            occlusion: 0
          }
        },
        emotion: {
          anger: 0,
          disgust: 0.007,
          fear: 0.006,
          happiness: 99.984,
          neutral: 0.001,
          sadness: 0.001,
          surprise: 0
        },
        facequality: { value: 4.692, threshold: 70.1 },
        ethnicity: { value: '' },
        beauty: { male_score: 76.05, female_score: 79.158 },
        mouthstatus: {
          surgical_mask_or_respirator: 0,
          other_occlusion: 0,
          close: 0,
          open: 100
        },
        eyegaze: {
          left_eye_gaze: {
            position_x_coordinate: 0.552,
            position_y_coordinate: 0.402,
            vector_x_component: 0.136,
            vector_y_component: -0.176,
            vector_z_component: 0.975
          },
          right_eye_gaze: {
            position_x_coordinate: 0.536,
            position_y_coordinate: 0.429,
            vector_x_component: 0.11,
            vector_y_component: -0.205,
            vector_z_component: 0.972
          }
        },
        skinstatus: {
          health: 14.083,
          stain: 67.919,
          dark_circle: 1.956,
          acne: 78.747
        },
        glass: { value: 'None' }
      }
    },
    [length]: 5
  ],
  image_id: '0D4w+ulFAz+fFR5hqyjbHA==',
  face_num: 5
}

*/
