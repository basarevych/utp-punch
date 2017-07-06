const Node = require('../index');

let received1 = false, received2 = false;

let node1 = new Node(socket => {
    socket.on('data', data => {
        if (data.toString() === 'data1')
            socket.write('reply1');
    });
});
let node2 = new Node(socket => {
    socket.on('data', data => {
        if (data.toString() === 'data2')
            socket.write('reply2');
    });
});

let counter = 0;
let start = () => {
    if (++counter < 2) return;
    node1.connect(53453, socket => {
        socket.on('data', data => {
            if (data.toString() === 'reply2')
                received2 = true;
            if (received1 && received2)
                process.exit(0);
        });
        socket.write('data2');
    });
    node2.connect(53454, socket => {
        socket.on('data', data => {
            if (data.toString() === 'reply1')
                received1 = true;
            if (received1 && received2)
                process.exit(0);
        });
        socket.write('data1');
    });
};

node1.bind(53454);
node1.listen(start);

node2.bind(53453);
node2.listen(start);

setTimeout(process.exit.bind(process, 1), 5000);