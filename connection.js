const cyclist = require('cyclist');
const util = require('util');
const { Duplex } = require('stream');
const debug = require('debug')('utp');

const EXTENSION = 0;
const VERSION   = 1;
const UINT16    = 0xffff;
const ID_MASK   = 0xf << 4;
const MTU       = 1000;

const PACKET_DATA  = 0 << 4;
const PACKET_FIN   = 1 << 4;
const PACKET_STATE = 2 << 4;
const PACKET_RESET = 3 << 4;
const PACKET_SYN   = 4 << 4;

const MIN_PACKET_SIZE = 20;
const MAX_CONNECTION_ID = 2 << 16 - 1;
const DEFAULT_WINDOW_SIZE = 1 << 18;

const BUFFER_SIZE = 512;

const uint32 = function(n) {
    return n >>> 0;
};

const uint16 = function(n) {
    return n & UINT16;
};

const timestamp = function() {
    let offset = process.hrtime();
    let then = Date.now() * 1000;

    return function() {
        let diff = process.hrtime(offset);
        return uint32(then + 1000000 * diff[0] + ((diff[1] / 1000) | 0));
    };
}();

const bufferToPacket = function(buffer) {
    let packet = {};
    packet.id = buffer[0] & ID_MASK;
    packet.connection = buffer.readUInt16BE(2);
    packet.timestamp = buffer.readUInt32BE(4);
    packet.timediff = buffer.readUInt32BE(8);
    packet.window = buffer.readUInt32BE(12);
    packet.seq = buffer.readUInt16BE(16);
    packet.ack = buffer.readUInt16BE(18);
    packet.data = buffer.length > 20 ? buffer.slice(20) : null;
    return packet;
};

const packetToBuffer = function(packet) {
    let buffer = Buffer.alloc(20 + (packet.data ? packet.data.length : 0));
    buffer[0] = packet.id | VERSION;
    buffer[1] = EXTENSION;
    buffer.writeUInt16BE(packet.connection, 2);
    buffer.writeUInt32BE(packet.timestamp, 4);
    buffer.writeUInt32BE(packet.timediff, 8);
    buffer.writeUInt32BE(packet.window, 12);
    buffer.writeUInt16BE(packet.seq, 16);
    buffer.writeUInt16BE(packet.ack, 18);
    if (packet.data) packet.data.copy(buffer, 20);
    return buffer;
};

const createPacket = function(connection, id, data) {
    return {
        id: id,
        connection: connection._server ? uint16(connection.id + 1) : connection.id,
        seq: connection._seq,
        ack: connection._ack,
        timestamp: timestamp(),
        timediff: 0,
        window: DEFAULT_WINDOW_SIZE,
        data: data,
        sent: 0
    };
};

class Connection extends Duplex {
    constructor(id, port, host, socket, syn, options) {
        super();
        this.setMaxListeners(0);

        this.id = id;
        this.port = port;
        this.host = host;
        this.socket = socket;

        this._bufferSize = options.bufferSize || BUFFER_SIZE;
        this._outgoing = cyclist(this._bufferSize);
        this._incoming = cyclist(this._bufferSize);

        this._timeoutMax = options.timeout || 5000;
        this._timeoutSince = Date.now();

        this._mtu = options.mtu || MTU;
        this._inflightPackets = 0;
        this._closed = false;
        this._alive = false;

        if (syn) {
            this._server = true;
            this._connecting = false;
            this._seq = (Math.random() * UINT16) | 0;
            this._ack = syn.seq;
            this._synack = createPacket(this, PACKET_STATE, null);

            this._transmit(this._synack);
        } else {
            this._server = false;
            this._connecting = true;
            this._seq = (Math.random() * UINT16) | 0;
            this._ack = 0;
            this._synack = null;

            let onError = err => {
                this.emit('error', err);
            };
            socket.on('error', onError);
            this.once('close', () => {
                socket.removeListener('error', onError);
            });
        }

        let resend = setInterval(this._resend.bind(this), options.resend || 300);
        let keepAlive = setInterval(this._keepAlive.bind(this), options.keepAlive || 1000);
        let timeout = setInterval(this._timeout.bind(this), 500);
        let tick = 0;

        let closed = () => {
            if (++tick === 2) this._closing();
        };
        let noAnswer = () => {
            this.push(null);
            this._closing();
        };

        let connectingTimer;
        let sendFin = () => {
            if (this._connecting) {
                this.once('connect', sendFin);
                if (this._timeoutMax)
                    connectingTimer = setTimeout(noAnswer, this._timeoutMax);
                return;
            }

            if (connectingTimer) {
                clearTimeout(connectingTimer);
                connectingTimer = null;
            }

            this._sendOutgoing(createPacket(this, PACKET_FIN, null));
            this.once('flush', closed);
            if (this._timeoutMax)
                setTimeout(noAnswer, this._timeoutMax);
        };

        this.once('finish', sendFin);
        this.once('close', () => {
            clearInterval(resend);
            clearInterval(keepAlive);
            clearInterval(timeout);
        });
        this.once('end', () => {
            this.end();
            process.nextTick(closed);
        });
    }

    static reset(socket, port, host, connection) {
        let obj;
        if (typeof connection === 'object') {
            obj = connection;
        } else {
            obj = {
                id: connection,
                _server: false,
                _seq: 0,
                _ack: 0,
            };
        }
        let message = packetToBuffer(createPacket(obj, PACKET_RESET, null));
        socket.send(message, 0, message.length, port, host);
    }

    setTimeout(timeout) {
        this._timeoutMax = timeout;
        this._timeoutSince = Date.now();
    }

    getTimeout() {
        return this._timeoutMax;
    }

    setMtu(mtu) {
        this._mtu = mtu;
    }

    getMtu() {
        return this._mtu;
    }

    destroy() {
        this.push(null);
        this.end();
        this._closing();
    }

    address() {
        return { port: this.port, address: this.host };
    }

    _connect() {
        this._sendOutgoing(createPacket(this, PACKET_SYN, null));
    }

    _read() {
        // do nothing...
    }

    _write(data, enc, callback) {
        if (this._connecting) return this._writeOnce('connect', data, enc, callback);

        while (this._writable()) {
            let payload = this._payload(data);

            this._sendOutgoing(createPacket(this, PACKET_DATA, payload));

            if (payload.length === data.length) return callback();
            data = data.slice(payload.length);
        }

        this._writeOnce('flush', data, enc, callback);
    }

    _writeOnce(event, data, enc, callback) {
        this.once(event, () => {
            this._write(data, enc, callback);
        });
    }

    _writable() {
        return this._inflightPackets < this._bufferSize - 1;
    }

    _payload(data) {
        if (data.length > this._mtu) return data.slice(0, this._mtu);
        return data;
    }

    _resend() {
        let offset = this._seq - this._inflightPackets;
        let first = this._outgoing.get(offset);
        if (!first) return;

        let timeout = 500000;
        let now = timestamp();

        if (uint32(first.sent - now) < timeout) return;

        debug(`${this.host}/${this.port}/${this._server ? this.id + 1 : this.id}: Packet loss since #${offset}`);
        for (let i = 0; i < this._inflightPackets; i++) {
            let packet = this._outgoing.get(offset+i);
            if (uint32(packet.sent - now) >= timeout) this._transmit(packet);
        }
    }

    _keepAlive() {
        if (this._alive) return this._alive = false;
        this._sendAck();
    }

    _timeout() {
        if (!this._timeoutMax || !this._timeoutSince)
            return;

        if (Date.now() - this._timeoutSince >= this._timeoutMax) {
            this._timeoutSince = 0;
            this.emit('timeout');
        }
    }

    _closing() {
        if (this._closed) return;
        this._closed = true;
        process.nextTick(this.emit.bind(this, 'close'));
    }

    _recvAck(ack) {
        let offset = this._seq - this._inflightPackets;
        let acked = uint16(ack - offset) + 1;

        if (acked >= this._bufferSize) return; // sanity check

        for (let i = 0; i < acked; i++) {
            this._outgoing.del(offset+i);
            this._inflightPackets--;
        }

        if (this._inflightPackets < 0) this._inflightPackets = 0;
        if (!this._inflightPackets) this.emit('flush');
    }

    _recvIncoming(packet) {
        if (this._closed) return this.constructor.reset(this.socket, this.port, this.host, this);

        this._timeoutSince = Date.now();

        switch (packet.id) {
            case PACKET_DATA:
                debug(`${this.host}/${this.port}/${this._server ? this.id + 1 : this.id}: Received ${packet.data ? packet.data.length : 0} of DATA #${packet.seq}, ACK #${packet.ack}`);
                break;
            case PACKET_FIN:
                debug(`${this.host}/${this.port}/${this._server ? this.id + 1 : this.id}: Received FIN #${packet.seq}, ACK #${packet.ack}`);
                break;
            case PACKET_STATE:
                debug(`${this.host}/${this.port}/${this._server ? this.id + 1 : this.id}: Received STATE #${packet.seq}, ACK #${packet.ack}`);
                break;
            case PACKET_RESET:
                debug(`${this.host}/${this.port}/${this._server ? this.id + 1 : this.id}: Received RESET #${packet.seq}, ACK #${packet.ack}`);
                break;
            case PACKET_SYN:
                debug(`${this.host}/${this.port}/${this._server ? this.id + 1 : this.id}: Received SYN #${packet.seq}, ACK #${packet.ack}`);
                break;
        }

        if (packet.id === PACKET_RESET) {
            this.destroy();
            return;
        }
        if (packet.id === PACKET_SYN && this._connecting) {
            this._transmit(this._synack);
            return;
        }
        if (this._connecting) {
            if (packet.id !== PACKET_STATE) return this._incoming.put(packet.seq, packet);

            this._ack = uint16(packet.seq-1);
            this._recvAck(packet.ack);
            this._connecting = false;
            this.emit('connect');

            packet = this._incoming.del(packet.seq);
            if (!packet) return;
        }

        if (uint16(packet.seq - this._ack) >= this._bufferSize || packet.seq < uint16(this._ack + 1)) return this._sendAck(); // old packet

        this._recvAck(packet.ack); // TODO: other calcs as well

        if (packet.id === PACKET_STATE) return;
        this._incoming.put(packet.seq, packet);

        while (packet = this._incoming.del(this._ack+1)) {
            this._ack = uint16(this._ack+1);

            if (packet.id === PACKET_DATA && packet.data) this.push(packet.data);
            if (packet.id === PACKET_FIN)  this.push(null);
        }

        this._sendAck();
    }

    _sendAck() {
        this._transmit(createPacket(this, PACKET_STATE, null)); // TODO: make this delayed
    }

    _sendOutgoing(packet) {
        this._outgoing.put(packet.seq, packet);
        this._seq = uint16(this._seq + 1);
        this._inflightPackets++;
        this._transmit(packet);
    }

    _transmit(packet) {
        switch (packet.id) {
            case PACKET_DATA:
                debug(`${this.host}/${this.port}/${this._server ? this.id + 1 : this.id}: Sent ${packet.data ? packet.data.length : 0} of DATA #${packet.seq}, ACK #${packet.ack}`);
                break;
            case PACKET_FIN:
                debug(`${this.host}/${this.port}/${this._server ? this.id + 1 : this.id}: Sent FIN #${packet.seq}, ACK #${packet.ack}`);
                break;
            case PACKET_STATE:
                debug(`${this.host}/${this.port}/${this._server ? this.id + 1 : this.id}: Sent STATE #${packet.seq}, ACK #${packet.ack}`);
                break;
            case PACKET_RESET:
                debug(`${this.host}/${this.port}/${this._server ? this.id + 1 : this.id}: Sent RESET #${packet.seq}, ACK #${packet.ack}`);
                break;
            case PACKET_SYN:
                debug(`${this.host}/${this.port}/${this._server ? this.id + 1 : this.id}: Sent SYN #${packet.seq}, ACK #${packet.ack}`);
                break;
        }

        packet.sent = packet.sent === 0 ? packet.timestamp : timestamp();

        let message = packetToBuffer(packet);
        this._alive = true;
        this.socket.send(message, 0, message.length, this.port, this.host);
    };
}

module.exports = {
    PACKET_DATA,
    PACKET_FIN,
    PACKET_STATE,
    PACKET_RESET,
    PACKET_SYN,
    MIN_PACKET_SIZE,
    MAX_CONNECTION_ID,
    uint16,
    uint32,
    packetToBuffer,
    bufferToPacket,
    Connection
};
