const Node = require('../index');
const assert = require('assert');

let connected1 = false, connected2 = false;
let counter = 0;
let end = () => {
    if (++counter === 2) {
        assert(connected1);
        assert(connected2);
        process.exit(0);
    }
};

let server = new Node(socket => {
	socket.on('data', data => {
	    if (data.toString() === 'multi') {
	        connected1 = true;
	        end();
        }
    })
});
server.bind(53454);
server.listen();

let multi = new Node(socket => {
    socket.on('data', data => {
        if (data.toString() === 'client') {
            connected2 = true;
            end();
        }
    })
});
multi.bind(53453);
multi.listen();
multi.connect(53454, socket => {
    socket.write('multi');
});

let client = new Node();
client.bind();
client.connect(53453, socket => {
    socket.write('client');
});

setTimeout(process.exit.bind(process, 1), 5000);