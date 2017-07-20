const Node = require('../index');
const assert = require('assert');

let client = new Node({ timeout: 1000 });
client.bind(53453);
let socket = client.connect(53454);
socket.on('timeout', () => { socket.resume(); socket.end(); });
socket.on('close', process.exit.bind(process, 0));

setTimeout(process.exit.bind(process, 1), 5000);