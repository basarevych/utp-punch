const Node = require('../index');

if (!process.argv[2]) {
  console.log('Usage: server.js x.x.x.x');
  console.log('Where x.x.x.x is the public address of the tracker');
  process.exit(2);
}

const trackerPort = 42000;
let server = new Node(socket => {
  console.log('server: UTP client is connected');
  const address = socket.address();
  socket.on('data', data => {
    const text = data.toString();
    console.log(
      `server: received '${text}' from ${address.address}:${address.port}`
    );

    if (text === 'PING') {
      setTimeout(() => {
        console.log('server: sending PONG...');
        socket.write('PONG');
      }, 3000);
    }
  });
  socket.on('end', () => {
    console.log('server: client disconnected');
    process.exit(1);
  });
});

const onListening = () => {
  console.log('server: UDP socket is ready');
  const udpSocket = server.getUdpSocket();

  const onMessage = (msg, rinfo) => {
    const text = msg.toString();
    if (rinfo.address === process.argv[2] && rinfo.port === trackerPort) {
      udpSocket.removeListener('message', onMessage);
      console.log(`server: tracker responded with ${text}`);

      let client;
      try {
        client = JSON.parse(text);
      } catch (error) {
        console.error(`server: invalid tracker reply: ${error.message}`);
        process.exit(1);
      }

      console.log(
        `server: punching a hole to ${client.address}:${client.port}...`
      );
      server.punch(10, client.port, client.address, success => {
        console.log(
          `server: punching result: ${success ? 'success' : 'failure'}`
        );
        if (!success) process.exit(1);
        console.log('server: waiting for the client to connect...');
      });
    }
  };

  udpSocket.on('message', onMessage);
  udpSocket.send(
    JSON.stringify({ name: 'SERVER' }),
    trackerPort,
    process.argv[2],
    () => console.log('server: registered with the tracker')
  );
};

server.bind(9000);
server.listen(onListening);
