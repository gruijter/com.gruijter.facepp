const Homey = require('homey');

module.exports = [
	{
		description: 'Show loglines',
		method: 'GET',
		path: '/getlogs/',
		requires_authorization: true,
		role: 'owner',
		fn: function fn(args, callback) {
			const result = Homey.app.getLogs();
			callback(null, result);
		},
	},
	{
		description: 'Delete logs',
		method: 'GET',
		path: '/deletelogs/',
		requires_authorization: true,
		role: 'owner',
		fn: function fn(args, callback) {
			const result = Homey.app.deleteLogs();
			callback(null, result);
		},
	},
	{
		description: 'Get Faces Set',
		method: 'POST',
		path: '/getfaces/',
		requires_authorization: true,
		role: 'owner',
		fn: function fn(args, callback) {
			Homey.app.getFaceSet()
				.then((result) => callback(null, result))
				.catch((error) => {
					Homey.app.error(error);
					callback(error, null);
				});
		},
	},
	{
		description: 'Detect Face',
		method: 'POST',
		path: '/detectface/',
		requires_authorization: true,
		role: 'owner',
		fn: function fn(args, callback) {
			Homey.app.log('Analyzing new image from app settings');
			Homey.app.detectFaces(args.body.img)
				.then((result) => callback(null, result))
				.catch((error) => {
					Homey.app.error(error);
					callback(error, null);
				});
		},
	},
	{
		description: 'Save Face',
		method: 'POST',
		path: '/addface/',
		requires_authorization: true,
		role: 'owner',
		fn: async function fn(args, callback) {
			Homey.app.log('Adding new face from app settings');
			Homey.app.addFace(args.body)
				.then((result) => callback(null, result))
				.catch((error) => {
					Homey.app.error(error);
					callback(error, null);
				});
		},
	},
	{
		description: 'Delete Face',
		method: 'POST',
		path: '/deleteface/',
		requires_authorization: true,
		role: 'owner',
		fn: function fn(args, callback) {
			Homey.app.log('Deleting face from app settings');
			Homey.app.deleteFace(args.body)
				.then((result) => callback(null, result))
				.catch((error) => {
					Homey.app.error(error);
					callback(error, null);
				});
		},
	},
];
