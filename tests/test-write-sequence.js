const Node = require('../index');
const assert = require('assert');
let max = 1000;

let server = new Node(socket => {
	let prev = 0;
	socket.on('data', data => {
		assert(''+(prev++) === data.toString());
		socket.write(data);
		if (prev === max) socket.end();
	});
});
server.bind(53454);
server.listen();

let prev = 0;

let client = new Node();
client.bind();
client.connect(53454, socket => {
    for (let i = 0; i < max; i++)
        socket.write(''+i);

    socket.on('data', data => {
        assert(''+(prev++) === data.toString());
    });
    socket.on('end', () => {
        process.exit(0);
    });
});

setTimeout(process.exit.bind(process, 1), 50000);