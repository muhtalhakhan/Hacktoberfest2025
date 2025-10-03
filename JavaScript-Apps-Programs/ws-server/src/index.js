const { WebSocketServer } = require("ws");
const { nanoid } = require("nanoid");

const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;
const wss = new WebSocketServer({ port }, () => {
  console.log("Server listening on port 8080");
});

const rooms = new Map();
const users = new Map();

wss.on("connection", (ws) => {
  console.log("user connected");

  ws.on("message", (message) => {
    const parsedMessage = JSON.parse(message.toString());
    const type = parsedMessage.type;
    const payload = parsedMessage.payload;

    if (type === "create-room") {
      createRoom(payload, ws);
    } else if (type === "join-room") {
      joinRoom(payload, ws);
    } else if (type === "broadcast") {
      broadcastToRoom(parsedMessage, ws);
    } else if (type === "leave-room") {
      const message = leaveRoom(payload, ws);
      ws.send(JSON.stringify(message));
    }
  });

  ws.on("close", () => {
    handleDisconnet(ws);
  });
});

function createRoom(payload, ws) {
  try {
    const roomId = generateRoomId();
    const roomName = payload.roomName;
    const createdBy = payload.createdBy;

    rooms.set(roomId, {
      roomName,
      createdBy,
      participants: new Set([ws]),
      lastActive: Date.now(),
    });

    const existingUser = users.get(ws);
    const userId = existingUser?.userId ?? generateUserId();
    users.set(ws, { userId, userName: createdBy });

    console.log(`creating room for user with id: ${userId} and name: ${createdBy} room id: ${roomId}`);

    ws.send(
      JSON.stringify({
        type: "room-created",
        payload: {
          userId,
          roomId,
          roomName,
          userCount: 1,
          message: `Room "${roomName}" created successfully.`,
        },
      })
    );
  } catch (e) {
    console.log("Create Room error: " + e);
    ws.send(
      JSON.stringify({
        type: "error-home",
        payload: {
          error: "Failed to create room. Please try again.",
          context: "create-room",
        },
      })
    );
  }
}

function joinRoom(payload, ws) {
  try {
    const { roomId, userName } = payload;
    const room = rooms.get(roomId);

    if (room) {
      const existingUser = users.get(ws);
      const userId = existingUser?.userId ?? generateUserId();
      users.set(ws, { userId, userName });

      room.participants.add(ws);
      room.lastActive = Date.now();

      broadcastToRoom(
        {
          type: "system",
          payload: {
            roomId,
            userId,
            message: `${userName} has joined the room.`,
          },
        },
        ws
      );

      ws.send(
        JSON.stringify({
          type: "room-joined",
          payload: {
            userId,
            roomId,
            roomName: room.roomName,
            createdBy: room.createdBy,
            userCount: room.participants.size,
            message: `Room "${room.roomName}" joined successfully.`,
          },
        })
      );
    } else {
      ws.send(
        JSON.stringify({
          type: "error-home",
          payload: {
            error: "Room not found.",
            context: "join-room",
          },
        })
      );
    }
  } catch (e) {
    console.log("Join Room error: " + e);
    ws.send(
      JSON.stringify({
        type: "error-home",
        payload: {
          error: "Failed to join room. Please try again.",
          context: "join-room",
        },
      })
    );
  }
}

function broadcastToRoom(parsedMsg, ws) {
  try {
    const { roomId, message: msg } = parsedMsg.payload;
    const room = rooms.get(roomId);

    if (!room) {
      ws.send(
        JSON.stringify({
          type: "error",
          payload: {
            error: "There is no room with this Room Id.",
            context: "broadcast",
          },
        })
      );
      return;
    }

    const sender = users.get(ws);
    if (!sender) throw new Error("Sender not found");

    const message =
      parsedMsg.type === "system"
        ? {
            type: "system",
            payload: {
              message: msg,
              senderId: sender.userId,
              userCount: room.participants.size,
              timestamp: new Date().toISOString(),
            },
          }
        : {
            type: "message",
            payload: {
              id: nanoid(6),
              content: msg,
              senderId: sender.userId,
              senderName: sender.userName,
              timestamp: new Date().toISOString(),
            },
          };

    room.lastActive = Date.now();

    room.participants.forEach((participant) => {
      participant.send(JSON.stringify(message));
    });
  } catch (e) {
    console.log("Broadcast to Room error: " + e);
    ws.send(
      JSON.stringify({
        type: "error",
        payload: {
          error: "Error occurred",
          context: "broadcast",
        },
      })
    );
  }
}

function leaveRoom(payload, ws) {
  const { roomId } = payload;
  const user = users.get(ws);
  const room = rooms.get(roomId);

  if (!user || !room) {
    return {
      type: "error",
      payload: {
        error: "Invalid user or room ID.",
        context: "leave-room",
      },
    };
  }

  room.participants.delete(ws);
  room.lastActive = Date.now();

  const leaveNotice = {
    type: "system",
    payload: {
      roomId,
      senderId: user.userId,
      senderName: user.userName,
      userCount: room.participants.size,
      message: `${user.userName} has left the room.`,
      timestamp: new Date().toISOString(),
    },
  };

  room.participants.forEach((participant) => {
    participant.send(JSON.stringify(leaveNotice));
  });

  if (room.participants.size === 0) {
    rooms.delete(roomId);
    console.log(`deleting room with id ${roomId}. Remaining rooms: ${rooms.size}`);
  }

  return {
    type: "leave-success",
    payload: {
      message: `You left the room "${room.roomName}".`,
      roomId,
    },
  };
}

function handleDisconnet(ws) {
  const user = users.get(ws);
  if (!user) return;

  users.delete(ws);

  rooms.forEach((room, roomId) => {
    if (room.participants.has(ws)) {
      const disconnectMessage = {
        type: "system",
        payload: {
          roomId,
          senderId: user.userId,
          senderName: user.userName,
          message: `${user.userName} has disconnected.`,
          userCount: room.participants.size - 1,
          timestamp: new Date().toISOString(),
        },
      };

      room.participants.forEach((userWs) => {
        userWs.send(JSON.stringify(disconnectMessage));
      });

      room.participants.delete(ws);
      room.lastActive = Date.now();
    }

    if (room.participants.size === 0) {
      rooms.delete(roomId);
      console.log(`deleting room with id: ${roomId}. Remaining rooms: ${rooms.size}`);
    }
  });
}

setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, roomCode) => {
    if (room.participants.size === 0 && now - room.lastActive > 3600000) {
      rooms.delete(roomCode);
      console.log(`Cleaning up inactive room: ${roomCode}. Remaining rooms: ${rooms.size}`);
    }
  });
}, 3600000);

function generateRoomId() {
  let id;
  do {
    id = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms.has(id));
  return id;
}

function generateUserId() {
  return nanoid(7);
}
