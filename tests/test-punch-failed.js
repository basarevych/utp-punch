const Node = require('../index');
const assert = require('assert');

let serverPunched = null;
let clientPunched = null;
let counter = 0;

let punched = () => {
    if (++counter === 2) {
        assert(serverPunched === false);
        assert(clientPunched === false);
        process.exit(0);
    }
}

let server = new Node();
server.bind(53454);

let client = new Node();
client.bind(53453);

server.punch(4, 53450, success => {
    serverPunched = success;
    punched();
});
client.punch(4, 53450, success => {
    clientPunched = success;
    punched();
});

setTimeout(process.exit.bind(process, 1), 10000);