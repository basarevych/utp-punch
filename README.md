# utp-punch

When you need to transmit data over UDP you face its limitations:
data must be transmitted in small chunks to fit in the MTU, packets
could be lost with no notification, come duplicated or in the wrong
order.

uTP (micro transport protocol) was invented by torrent people to
safely transmit files over UDP. Basically it adds TCP features to UDP:
lost packets are automatically retransmitted, order is guaranteed,
duplicates rejected.

This library implements uTP over UDP so when connected you receive a
**socket** object which behaves much like a Node.js tcp socket. It emits
'data' when receiving data, it has .write() method for you to send a
Buffer. Much like tcp socket this is a Node.js stream.

The library however might not be compatible with other uTP implementations
(so you need to use this very same library on both the peers) because
it adds the following feature: the same instance of a class can be used
both as a server and a client at the same time on the same port. So you
can create a Node, bind it to a port and at the same time start listening
for incoming connections and also make outgoing connections from it.

## UDP hole punching

Another technique which is used here is
[UDP hole punching](https://en.wikipedia.org/wiki/UDP_hole_punching).

When server and/or client are behind NAT they normally do not have an
Internet IP address to bind to in order to receive incoming connections.

UDP hole punching tricks firewalls into opening a temporarily hole for
its user, so a port on the NAT device becomes bound to the port of
the server/client inside the LAN.

In order for it to work both server and client must use a third-party
server to find out each other's NATed IP addresses and to coordinate
punching attempt (it must be done simultaneously on the server and on
the client).

But when the connection is established the third-party server is no
longer needed and it is never used as a relay, all the data is transmitted
directly between these NATed server and client.

## General usage example

```
npm install --save utp-punch
```

```
const Node = require('utp-punch');

let server = new Node(socket => {
    console.log('server: socket connected');
    socket.on('data', data => {
        console.log(`server: received '${data.toString()}'`);
        socket.write('world');
        socket.end();
    });
    socket.on('end', () => {
        console.log('server: socket disconnected');
        server.close();             // this is how you terminate node
    });
});
server.bind(20000, '127.0.0.1');    // bind to port 20000
server.listen(                      // run
    () => console.log('server: ready')
);

let client = new Node();
client.bind();                      // bind to any port
client.connect(20000, '127.0.0.1, socket => {
    console.log('client: socket connected');
    socket.on('data', data => console.log(`client: received '${data.toString()}'`));
    socket.on('end', () => {
        console.log('client: socket disconnected');
        client.close();             // this is how you terminate node
    });
    socket.write('hello');
});
```

## UDP hole punching example

```
const Node = require('utp-punch');

let server = new Node();
server.bind(20000);

let client = new Node();
client.bind(30000);         // client needs dedicated port
                            // just as the server

// the following two .punch() calls must happen simultaneously

server.punch(10, 30000, success => { // ten attempts
    // if success is true hole is punched from our side
    // nothing to do here as the client will try
    // to connect normally when he is also successful
});

client.punch(10, 20000, success => { // ten attempts
    if (success) {
        client.connect(20000, socket => {
            // if the server had also been successful in punching
            // this will succeed
        });
        client.on('timeout', () => {
            // if the server had failed in punching we won't be
            // able to connect
        });
    }
});
```

## Node class

The same class can be used as a server or as a client, the syntax is following:

### new Node([options,] [onConnection]);

**options** is the following:
```
{
    bufferSize: 64,         // number of packets
    mtu: 1000,              // bytes excluding uTP header
    timeout: 5000,          // ms
    resend: 100,            // ms
    keepAlive: 1000,        // ms
}
```
**onConnection** will be passed single argument - the socket.
This is server's incoming connections

### .maxConnections

Getter for maximum number of connections the Node can handle

### .serverConnections

Getter for the number of incoming connections

### .clientConnections

Getter for the number of outgoing connections

### .getUdpSocket()

Returns standard Node.js UDP socket which is used under the hood.

### .address()

Bound address of the socket (the same as in Node.js UDP .address())

### .bind([port,] [host,] [onBound])

Bind to host:port and execute onBound when done

### .punch(attempts, port, [host,] [callback])

Start punching attempts to the host:port and run callback when
either successful or no attempts are left. Success or failure is
passed to the callback as the first, boolean parameter

### .listen([onListening])

Turn this Node into a server and execute this callback when ready to
accept incoming connections

### .connect(port, [host,] [onConnect])

Connect to a server Node on host:port and execute callback with the
socket object as the single parameter

### .close([onClose])

Terminate all connections and the Node, run callback.

## Socket object

Socket object passed to Node constructor and .connect() callbacks is a stream
emitting 'data' when receiving data. It has the usual methods: .write(), .end(),
etc.

# Credits

Original 'utp' library was created by @mafintosh in https://github.com/mafintosh/utp.
This is a rewrite in modern JavaScript with bug fixing and additional features
including usage as a server and a client simultaneously on the same port and UDP
hole punching support.
