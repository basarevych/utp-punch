const Node = require('../index');

if (!process.argv[2]) {
  console.log('Usage: client.js x.x.x.x');
  console.log('Where x.x.x.x is the public address of the tracker');
  process.exit(2);
}

const trackerPort = 42000;
let client = new Node();

const onConnected = socket => {
  console.log('client: UTP socket is connected to the server');
  const address = socket.address();

  socket.on('data', data => {
    const text = data.toString();
    console.log(
      `client: received '${text}' from ${address.address}:${address.port}`
    );

    if (text === 'PONG') {
      setTimeout(() => {
        console.log('client: sending PING...');
        socket.write('PING');
      }, 3000);
    }
  });
  socket.on('end', () => {
    console.log('client: socket disconnected');
  });

  console.log('client: sending first PING...');
  socket.write('PING');
};

const onReady = () => {
  console.log('client: UDP socket is ready');
  const udpSocket = client.getUdpSocket();

  const onMessage = (msg, rinfo) => {
    const text = msg.toString();
    if (rinfo.address === process.argv[2] && rinfo.port === trackerPort) {
      udpSocket.removeListener('message', onMessage);
      console.log(`client: tracker responded with ${text}`);

      let server;
      try {
        server = JSON.parse(text);
      } catch (error) {
        console.error(`client: invalid tracker reply: ${error.message}`);
        process.exit(1);
      }

      console.log(
        `client: punching a hole to ${server.address}:${server.port}...`
      );
      client.punch(10, server.port, server.address, success => {
        console.log(
          `client: punching result: ${success ? 'success' : 'failure'}`
        );
        if (!success) process.exit(1);

        client.on('timeout', () => {
          console.log('client: connect timeout');
          process.exit(1);
        });
        client.connect(server.port, server.address, onConnected);
      });
    }
  };

  udpSocket.on('message', onMessage);
  udpSocket.send(
    JSON.stringify({ name: 'CLIENT' }),
    trackerPort,
    process.argv[2],
    () => console.log('client: registered with the tracker')
  );
};

client.bind(9000, onReady);
