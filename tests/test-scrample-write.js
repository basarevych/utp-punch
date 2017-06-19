require('./scrample');

const Node = require('../index');
const assert = require('assert');

let server = new Node(socket => {
	socket.on('data', data => {
		assert(data.toString() === 'client');
		socket.write('server');
	});
});
server.bind(53454);
server.listen();

let client = new Node();
client.bind();
client.connect(53454, socket => {
    socket.write('client');
    socket.on('data', data => {
        assert(data.toString() === 'server');
        process.exit(0);
    });
});

setTimeout(process.exit.bind(process, 1), 15000);