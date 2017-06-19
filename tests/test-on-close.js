const Node = require('../index');
const assert = require('assert');

let closed = 0;
let onclose = () => {
	if (++closed === 2) process.exit(0);
};

let server = new Node(socket => {
	socket.on('close', onclose);
});
server.bind(53454);
server.listen();

let client = new Node();
client.bind();
client.connect(53454, socket => {
    socket.on('close', onclose);
    socket.end();
});

