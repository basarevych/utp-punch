const dgram = require('dgram');
const tracker = dgram.createSocket('udp4');

let server = null;
let client = null;

tracker.on('error', err => {
  console.log(`tracker error:\n${err.stack}`);
  tracker.close();
});

tracker.on('message', (msg, rinfo) => {
  let message;
  try {
    message = JSON.parse(msg.toString());
  } catch (error) {
    return; // ignore garbage
  }

  console.log(`tracker got: ${message} from ${rinfo.address}:${rinfo.port}`);

  if (message.name === 'SERVER') {
    server = {
      address: rinfo.address,
      port: rinfo.port
    };
    console.log('server is online');
  } else if (message.name === 'CLIENT') {
    client = {
      address: rinfo.address,
      port: rinfo.port
    };
    console.log('client is online');
  }

  if (server && client) {
    console.log('both peers are ready, exchanging the addresses');
    tracker.send(JSON.stringify(client), server.port, server.address);
    tracker.send(JSON.stringify(server), client.port, client.address);
    server = null;
    client = null;
  }
});

tracker.on('listening', () => {
  const address = tracker.address();
  console.log(`tracker listening ${address.address}:${address.port}`);
});

if (!process.argv[2]) {
  console.log('Usage: tracker.js x.x.x.x');
  console.log('Where x.x.x.x is the public address of this server');
  process.exit(2);
}

tracker.bind(42000, process.argv[2]);
