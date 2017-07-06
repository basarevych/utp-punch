const Node = require('../index');
const assert = require('assert');

let server = new Node(socket => {
    socket.resume();
});
server.bind(53454);
server.listen();

let client = new Node();
client.bind();
client.connect(53454, socket => {
    let id1 = socket.id;
    socket.once('close', () => {
        client.connect(53454, socket => {
            let id2 = socket.id;
            socket.once('close', () => {
                client.connect(53454, socket => {
                    let id3 = socket.id;
                    assert(id2 !== id1);
                    assert(id3 !== id2);
                    process.exit(0);
                });
            });
            socket.resume();
            socket.end();
        })
    });
    socket.resume();
    socket.end();
});

setTimeout(process.exit.bind(process, 1), 5000);