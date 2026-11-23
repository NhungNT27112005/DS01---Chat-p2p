
import { io } from "socket.io-client";

const peerId = process.argv[2];

if (!peerId) {
  console.error("Thiếu Peer ID");
  process.exit(1);
}

const socket = io("http://localhost:4002", {
  reconnection: false,
  timeout: 5000
});

socket.on("connect", () => {
  console.log("Socket connected:", socket.id);

  socket.timeout(5000).emit(
    "relay:register",
    { peerId },
    (error, response) => {
      if (error) {
        console.error("Không nhận được phản hồi đăng ký");
        socket.disconnect();
        return;
      }

      console.log("Register response:", response);

      if (!response?.success) {
        socket.disconnect();
      }
    }
  );
});

socket.on("connect_error", (error) => {
  console.error("Connection error:", error.message);
});

socket.on("disconnect", (reason) => {
  console.log("Disconnected:", reason);
});
