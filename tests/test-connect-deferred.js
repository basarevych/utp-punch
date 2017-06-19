const Node = require('../index');
const assert = require('assert');

let connected = false;

setTimeout(function() {
	let server = new Node(socket => {
		connected = true;
	});
	server.bind(53454);
	server.listen();
}, 100);

let client = new Node();
client.bind();
client.connect(53454, socket => {
    assert(connected);
    process.exit(0);
});

setTimeout(process.exit.bind(process, 1), 5000);