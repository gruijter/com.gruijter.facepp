module.exports = {
	// retrieve logs
	async getLogs({ homey }) {
		const result = await homey.app.getLogs();
		return result;
	},
	// delete logs
	async deleteLogs({ homey }) {
		const result = await homey.app.deleteLogs();
		return result;
	},
	// Get Faces Set
	async getFaceSet({ homey, body }) {
		const result = await homey.app.getFaceSet(body);
		return result;
	},
	// Detect Faces
	async detectFaces({ homey, body }) {
		const result = await homey.app.detectFaces(body.img); // body.img
		return result;
	},
	// Save Faces
	async addFace({ homey, body }) {
		const result = await homey.app.addFace(body);
		return result;
	},
	// Delete Face
	async deleteFace({ homey, body }) {
		const result = await homey.app.deleteFace(body);
		return result;
	},
};
