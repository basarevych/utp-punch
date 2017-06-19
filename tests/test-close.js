const Node = require('../index');
const assert = require('assert');

let onclose = () => {
	process.exit(0);
};

let server = new Node(socket => {
	server.close(onclose);
});

server.bind(53454);
server.listen(() => {
    let client = new Node();

    client.bind();
    client.connect(53454, socket => {
        client.close();
    });
});
