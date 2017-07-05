const Node = require('../index');
const assert = require('assert');

let node1 = new Node();
node1.once('bound', () => {
    let node2 = new Node();
    node2.once('error', error => {
        assert(error.code === 'EADDRINUSE');
        process.exit(0);
    });
    node2.bind(53454);
});
node1.bind(53454);

setTimeout(process.exit.bind(process, 1), 5000);