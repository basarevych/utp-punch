require('./scrample');

const Node = require('../index');
const assert = require('assert');

let big = new Buffer(10*1024);
big.fill(1);

let server = new Node(socket => {
	socket.on('data', data => {
		socket.write(data);
	});
});
server.bind(53454);
server.listen();

let recv = 0;

let client = new Node();
client.bind();
client.connect(53454, socket => {
    socket.write(big);
    socket.end();

    socket.on('data', data => {
        recv += data.length;
        console.log(recv);
    });
    socket.on('end', () => {
        assert(recv === big.length);
        process.exit(0);
    });

});

setTimeout(process.exit.bind(process, 1), 15000);