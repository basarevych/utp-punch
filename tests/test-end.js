const Node = require('../index');
const assert = require('assert');

let ended = false;

let server = new Node(socket => {
	socket.on('end', () => {
		ended = true;
	});
});
server.bind(53454);
server.listen();

let client = new Node();
client.bind();
client.connect(53454, socket => {
    socket.on('end', function() {
        assert(ended);
        process.exit(0);
    });
    socket.end();
});

setTimeout(process.exit.bind(process, 1), 5000);