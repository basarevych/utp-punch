const Node = require('../index');
const assert = require('assert');

let client = new Node({ timeout: 1000 });
client.bind();
let socket = client.connect(53454);
socket.on('timeout', process.exit.bind(process, 0));

setTimeout(process.exit.bind(process, 1), 5000);