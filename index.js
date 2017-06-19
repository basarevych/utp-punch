const dgram = require('dgram');
const EventEmitter = require('events').EventEmitter;
const debug = require('debug')('utp');
const connection = require('./connection');

const PUNCH_SYN = "PUNCH";
const PUNCH_ACK = "PUNCHED";

class Node extends EventEmitter {
    constructor(onconnection) {
        super();
        this._options = {};
        this._socket = dgram.createSocket('udp4');
        this._socket.setMaxListeners(0);
        this._bound = false;
        this._closed = false;
        this._mode = null;
        this._server = null;
        this._clients = new Map();

        this._socket.on('message', this.onMessage.bind(this));

        if (onconnection)
            this.on('connection', onconnection);
    }

    getUdpSocket() {
        return this._socket;
    }

    address() {
        return this._socket.address();
    }

    bind(port, host) {
        if (this._closed)
            throw new Error('Node is closed');
        if (this._bound)
            throw new Error('Node is already bound');

        this._socket.once('listening', () => {
            this._bound = true;
            this.emit('bound');
        });
        this._socket.bind(port, host);
    }

    punch(attempts, port, host = '127.0.0.1', cb = undefined) {
        if (this._closed)
            throw new Error('Node is closed');

        if (typeof host === 'function') {
            cb = host;
            host = '127.0.0.1';
        }

        port = parseInt(port);
        let synBuffer = Buffer.from(PUNCH_SYN);
        let ackBuffer = Buffer.from(PUNCH_ACK);
        let ackSent = false, ackReceived = false, done = false;
        let punchCounter = 0;

        let onMessage = (data, rinfo) => {
            if (rinfo.address !== host || String(rinfo.port) !== String(port))
                return;

            if (data.equals(synBuffer)) {
                debug('Received PUNCH SYN');
                this._socket.send(ackBuffer, port, host, () => {
                    ackSent = true;
                    this._socket.send(ackBuffer, port, host);
                });
            } else if (data.equals(ackBuffer)) {
                debug('Received PUNCH ACK');
                ackReceived = true;
            }
        };

        let sendPunch = () => {
            if (done)
                return;

            if (ackSent && ackReceived) {
                done = true;
                this._socket.removeListener('message', onMessage);
                if (cb)
                    cb(true);
                return;
            }
            if (++punchCounter > attempts) {
                done = true;
                this._socket.removeListener('message', onMessage);
                if (cb)
                    cb(false);
                return;
            }

            this._socket.send(synBuffer, port, host, () => {
                setTimeout(sendPunch, 500);
            });
        };

        this._socket.on('message', onMessage);
        if (this._bound)
            sendPunch();
        else
            this.once('bound', sendPunch);
    }

    listen(onlistening) {
        if (this._closed)
            throw new Error('Node is closed');
        if (this._server)
            throw new Error('Node is already listening');

        this._server = new Map();

        if (onlistening)
            this.once('listening', onlistening);

        if (this._bound) {
            this.emit('listening');
        } else {
            this.once('bound', function () {
                this.emit('listening');
            });
        }
    }

    connect(port, host = '127.0.0.1', onconnect = undefined) {
        if (this._closed)
            throw new Error('Node is closed');

        if (typeof host === 'function') {
            onconnect = host;
            host = '127.0.0.1';
        }

        let key = this._getKey(host, port);
        if (this._clients.has(key))
            throw new Error('Node is already connected to this peer');

        let socket = new connection.Connection(port, host, this._socket, null, this._options);
        this._clients.set(key, socket);

        socket.once('close', () => {
            this._clients.delete(key);
        });

        socket.once('connect', function () {
            socket.resume();
            this.emit('connect', socket);
            if (onconnect)
                onconnect(socket);
        });

        if (this._bound) {
            socket._connect();
        } else {
            this.once('bound', function () {
                socket._connect();
            });
        }

        return socket;
    }

    close(cb) {
        let openConnections = 0;
        this._closed = true;

        let onClose = () => {
            if (--openConnections === 0) {
                if (this._socket) this._socket.close();
                if (cb) cb();
            }
        };

        let clients = Array.from(this._clients.values());
        if (this._server)
            clients = clients.concat(Array.from(this._server.values()))

        for (let client of clients) {
            if (client._closed) continue;
            openConnections++;
            client.once('close', onClose);
            client.end();
        }

        if (openConnections === 0) {
            if (this._socket) this._socket.close();
            if (cb) cb();
        }
    }

    onMessage(message, rinfo) {
        let client = this._clients.get(this._getKey(rinfo.address, rinfo.port));
        if (client)
            this._handleClient(client, message);
        else if (this._server)
            this._handleServer(message, rinfo);
    }

    _handleServer(message, rinfo) {
        if (message.length < connection.MIN_PACKET_SIZE) return;
        let packet = connection.bufferToPacket(message);
        let id = rinfo.address+':'+(packet.id === connection.PACKET_SYN ? connection.uint16(packet.connection+1) : packet.connection);

        if (this._server.has(id)) return this._server.get(id)._recvIncoming(packet);
        if (packet.id !== connection.PACKET_SYN || this._closed) return;

        let socket = new connection.Connection(rinfo.port, rinfo.address, this._socket, packet, this._options);
        this._server.set(id, socket);
        socket.once('close', () => {
            this._server.delete(id);
        });

        socket.resume();
        this.emit('connection', socket);
    }

    _handleClient(socket, message) {
        if (message.length < connection.MIN_PACKET_SIZE) return;
        let packet = connection.bufferToPacket(message);

        if (packet.id === connection.PACKET_SYN) return;
        if (packet.connection !== socket._recvId) return;

        socket._recvIncoming(packet);
    }

    _getKey(host, port) {
        return host + '/' + port;
    }
}

module.exports = Node;