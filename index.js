require("dotenv").config();
const cluster = require("cluster");
const http = require("http");
const { Server } = require("socket.io");
const numCPUs = require("os").cpus().length;
const { setupMaster, setupWorker } = require("@socket.io/sticky");
const { createAdapter, setupPrimary } = require("@socket.io/cluster-adapter");

// Taken from https://socket.io/docs/v4/using-multiple-nodes/#using-nodejs-cluster
if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  const httpServer = http.createServer();

  // setup sticky sessions
  setupMaster(httpServer, {
    loadBalancingMethod: "least-connection",
  });

  // setup connections between the workers
  setupPrimary();

  cluster.setupMaster({
    serialization: "advanced",
  });

  const port = process.env.PORT;
  httpServer.listen(port, () => {
    console.log(`Help-desker chat server is listening on port ${port}`)
  });

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker) => {
    console.log(`Worker ${worker.process.pid} died`);
    cluster.fork();
  });
} else {
  console.log(`Worker ${process.pid} started`);

  const httpServer = http.createServer();
  const io = new Server(httpServer, {
    cors: {
      //origin: "http://localhost:3000",
      origin: "https://lush-agreement.surge.sh",
      methods: ["GET", "POST"],
      credentials: true
    },
  });

  // use the cluster adapter
  io.adapter(createAdapter());

  // setup connection with the primary process
  setupWorker(io);

  // Private messaging:   https://socket.io/get-started/private-messaging-part-1/
io.use((socket, next) => {
  const username = socket.handshake.auth.username;
  if (!username) {
    return next(new Error("invalid username"));
  }
  socket.username = username;
  next();
});

 // Get the list of all connected clients (users)
io.on("connection", (socket) => {
  console.log("Established chat connection")
  const users = [];
  for (let [id, socket] of io.of("/").sockets) {
    users.push({
      socketId: id,
      userId: socket.username, // username is ID of user in database
      role: socket.handshake.auth.role,
      nickname: socket.handshake.auth.nickname,
    });
  }
  console.log("Users connected to chat server >>>", users);
  
  // Emits event to all connected clients
  io.emit("connected_chat_users", users);

  // Check if a helper has connected. If "yes" inform about it the front-end
  // by emitting the event.
  const helper = users.find(el => el.role === 'helper');
  
  if (helper) {
    io.emit("helper_connected");
  }

  socket.on('join_room', (data) => {
    // recipient = room id
    socket.join(data.recipient);
    console.log(`${data.role} joined room ${data.recipient}`);

    // If the role is "helper" and Recipient is different from the one who is logged in
    // it means that "helper" joined the chat of "user".
    if (data.role === 'helper' && data.loggedInUserId !== data.recipient) {
      // recipient = room id
      socket.to(data.recipient).emit('helper_joined_your_chat', data);
      console.log(`${data.role} with id ${data.loggedInUserId} joined room ${data.recipient}`);
    }
  });

  // Send messages to specific room (private message)
  socket.on('send_msg', (message, room) => {
    socket.to(room).emit('receive_msg', message);
    console.log(`Message: ${message}, room: ${room}`);
  });

  socket.on('disconnect', () => {
    console.log('Socket.IO client disconnected.');
    // Emits event to all connected clients
    io.emit("logout", socket.id);
  });

});

}