require('./scrample');

const Node = require('../index');
const assert = require('assert');

let ended = false;
let dataed = false;

let server = new Node(socket => {
	socket.on('data', data => {
		assert(data.toString() === 'client');
		socket.write('server');
	});
	socket.on('end', () => {
		ended = true;
	});
});
server.bind(53454);
server.listen();

let client = new Node();
client.bind();
client.connect(53454, socket => {
    socket.on('data', data => {
        assert(data.toString() === 'server');
        dataed = true;
    });
    socket.on('end', () => {
        assert(ended);
        assert(dataed);
        process.exit(0);
    });
    socket.write('client');
    socket.end();
});

setTimeout(process.exit.bind(process, 1), 15000);