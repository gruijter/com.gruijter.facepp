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
		fn: async function fn(args, callback) {
			const result = await Homey.app.getFaceSet();
			callback(null, result);
		},
	},
	{
		description: 'Detect Face',
		method: 'POST',
		path: '/detectface/',
		requires_authorization: true,
		role: 'owner',
		fn: async function fn(args, callback) {
			await Homey.app.detect(args.body.img)
				.then((result) => callback(null, result))
				.catch((error) => callback(error, null));
		},
	},
	{
		description: 'Save Face',
		method: 'POST',
		path: '/addface/',
		requires_authorization: true,
		role: 'owner',
		fn: async function fn(args, callback) {
			await Homey.app.addFace(args.body)
				.then((result) => callback(null, result))
				.catch((error) => callback(error, null));
		},
	},
	{
		description: 'Delete Face',
		method: 'POST',
		path: '/deleteface/',
		requires_authorization: true,
		role: 'owner',
		fn: async function fn(args, callback) {
			await Homey.app.deleteFace(args.body)
				.then((result) => callback(null, result))
				.catch((error) => callback(error, null));
		},
	},
];
