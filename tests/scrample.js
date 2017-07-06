const on = require('dgram').Socket.prototype.on;

const LOSS_FACTOR = 5;
const SHUFFLE_INTERVAL = 50;

require('dgram').Socket.prototype.on = function(type, listener) {
	let fn = listener;

	if (type === 'message') {
		let i = 0;
		fn = function(message, rinfo) {
			let action = listener.bind(this, message, rinfo);

			if ((i++ % LOSS_FACTOR) === 0) return;
			setTimeout(action, (SHUFFLE_INTERVAL * Math.random()) | 0);
		};
	}

	return on.call(this, type, fn);
};
