const dgram = require('dgram');
const EventEmitter = require('events').EventEmitter;
const debug = require('debug')('utp');
const connection = require('./connection');

const PUNCH_SYN = "PUNCH";
const PUNCH_ACK = "PUNCHED";

const ID_LIFETIME = 5 * 1000; // ms

class Node extends EventEmitter {
    constructor(options, onconnection) {
        super();

        if (typeof options === 'function') {
            onconnection = options;
            options = undefined;
        }

        this._options = options || {};
        this._socket = dgram.createSocket('udp4');
        this._socket.setMaxListeners(0);
        this._bound = false;
        this._closing = false;
        this._closed = false;
        this._serverConnections = null;
        this._clientConnections = new Map();

        this._idStart = Math.floor(Math.random() * (connection.MAX_CONNECTION_ID + 1));
        if (this._idStart % 2)
            this._idStart--;

        this._socket.on('message', this.onMessage.bind(this));
        this._socket.on('error', error => { this.emit('error', error); });

        if (onconnection)
            this.on('connection', onconnection);
    }

    getUdpSocket() {
        return this._socket;
    }

    address() {
        return this._socket.address();
    }

    bind(port, host, onbound) {
        if (this._closing || this._closed)
            throw new Error('Node is closed');
        if (this._bound)
            throw new Error('Node is already bound');

        if (typeof host === 'function') {
            onbound = host;
            host = undefined;
        } else if (typeof port === 'function') {
            onbound = port;
            port = undefined;
            host = undefined;
        }

        if (onbound)
            this.once('bound', onbound);

        this._socket.once('listening', () => {
            this._bound = true;
            this.emit('bound');
        });
        this._socket.bind(port, host);
    }

    punch(attempts, port, host = '127.0.0.1', cb = undefined) {
        if (this._closing || this._closed)
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
        if (this._closing || this._closed)
            throw new Error('Node is closed');
        if (this._serverConnections)
            throw new Error('Node is already listening');

        this._serverConnections = new Map();

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
        if (this._closing || this._closed)
            throw new Error('Node is closed');

        if (typeof host === 'function') {
            onconnect = host;
            host = '127.0.0.1';
        }

        let id = this._generateId(host, port);
        let key = this._getKey(host, port, id);
        let socket = new connection.Connection(id, port, host, this._socket, null, this._options);
        this._clientConnections.set(key, socket);

        socket.once('close', () => {
            setTimeout(() => {
                this._clientConnections.delete(key);
            }, ID_LIFETIME);
        });

        socket.once('connect', function () {
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

    close(onclose) {
        if (this._closing || this._closed) return;
        this._closing = true;

        let openConnections = 0;

        let done = () => {
            if (this._socket) this._socket.close();
            this._closing = false;
            this._closed = true;
            this._clientConnections.clear();
            this._serverConnections.clear();
            this.emit('close');
        };
        let onClose = () => {
            if (--openConnections === 0)
                done();
        };

        if (onclose)
            this.once('close', onclose);

        let sockets = Array.from(this._clientConnections.values());
        if (this._serverConnections)
            sockets = sockets.concat(Array.from(this._serverConnections.values()));

        for (let socket of sockets) {
            if (socket._closed) continue;
            openConnections++;
            socket.once('close', onClose);
            socket.end();
        }

        if (openConnections === 0)
            done();
    }

    onMessage(message, rinfo) {
        if (message.length < connection.MIN_PACKET_SIZE) return;

        let packet = connection.bufferToPacket(message);
        let reply = false, id = packet.connection;
        if (id % 2) {
            reply = true;
            id--;
        }

        if (this._closed) {
            connection.Connection.reset(this._socket, rinfo.port, rinfo.address, reply ? packet.connection - 1 : packet.connection + 1);
            return;
        }

        let key = this._getKey(rinfo.address, rinfo.port, id);
        if (reply)
            this._handleClient(key, packet, rinfo);
        else if (this._serverConnections)
            this._handleServer(key, packet, rinfo);
        else
            connection.Connection.reset(this._socket, rinfo.port, rinfo.address, packet.connection + 1);
    }

    _handleServer(key, packet, rinfo) {
        if (this._serverConnections.has(key))
            return this._serverConnections.get(key)._recvIncoming(packet);

        if (packet.id !== connection.PACKET_SYN) {
            debug(`Invalid incoming packet ${key}`);
            connection.Connection.reset(this._socket, rinfo.port, rinfo.address, packet.connection + 1);
            return;
        }

        if (this._closing) {
            connection.Connection.reset(this._socket, rinfo.port, rinfo.address, packet.connection + 1);
            return;
        }

        debug(`Incoming connection ${key}`);
        let socket = new connection.Connection(packet.connection, rinfo.port, rinfo.address, this._socket, packet, this._options);
        this._serverConnections.set(key, socket);
        socket.once('close', () => {
            setTimeout(() => {
                this._serverConnections.delete(key);
            }, ID_LIFETIME);
        });

        this.emit('connection', socket);
    }

    _handleClient(key, packet, rinfo) {
        let socket = this._clientConnections.get(key);
        if (!socket) {
            debug(`Invalid reply packet ${key}`);
            connection.Connection.reset(this._socket, rinfo.port, rinfo.address, packet.connection - 1);
            return;
        }

        socket._recvIncoming(packet);
    }

    _generateId(host, port) {
        let range = 0;
        while (range <= connection.MAX_CONNECTION_ID) {
            let id = this._idStart + range;
            if (id > connection.MAX_CONNECTION_ID)
                id -= connection.MAX_CONNECTION_ID + 2;

            let key = this._getKey(host, port, id);
            if (!this._clientConnections.has(key))
                return id;

            range += 2;
        }

        throw new Error('Out of connections');
    }

    _getKey(host, port, id) {
        let key = host + '/' + port;
        if (id)
            key += '/' + id;
        return key;
    }
}

module.exports = Node;