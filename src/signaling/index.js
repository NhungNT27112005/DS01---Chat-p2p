import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

// 1. Tạo ứng dụng Express để xử lý các yêu cầu HTTP.
const app = express();

// 2. Tạo đường dẫn kiểm tra trạng thái server.
app.get('/health', (req, res) => {
  res.json({
    service: 'signaling',
    status: 'ok',
  });
});

// 3. Express và Socket.IO cùng sử dụng một HTTP server.
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ],
  },
});
// 3.1. Tạo một Map để lưu trữ các peer đang kết nối.
const peers = new Map();

// 4. Tạm thời chỉ ghi log khi một client kết nối tới Socket.IO.
io.on('connection', (socket) => {
  console.log('[signaling] Client ket noi:', socket.id);

  socket.on('peer:register', (data) => {
    const peerId = data?.peerId;
    const displayName = data?.displayName;

    if (
      typeof peerId !== 'string' ||
      typeof displayName !== 'string'
    ) {
      console.log('[signaling] Dang ky that bai: ID va ten phai la chuoi');
      return;
    }

    if (!peerId.trim() || !displayName.trim()) {
      console.log('[signaling] Dang ky that bai: ID va ten khong duoc trong');
      return;
    }

    const normalizedPeerId = peerId.trim();
    const normalizedDisplayName = displayName.trim();

    if (socket.data.peerId) {
      console.log('[signaling] Dang ky that bai: ket noi nay da dang ky');
      return;
    }

    if (peers.has(normalizedPeerId)) {
      console.log('[signaling] Dang ky that bai: Peer ID da ton tai');
      return;
    }

    const peer = {
      peerId: normalizedPeerId,
      displayName: normalizedDisplayName,
      socketId: socket.id,
      status: 'ONLINE',
    };

    peers.set(normalizedPeerId, peer);
    socket.data.peerId = normalizedPeerId;

    console.log('[signaling] Dang ky peer thanh cong:', peer);
  });
});

// 5. Dùng SIGNAL_PORT nếu có cấu hình; mặc định là cổng 4001.
const PORT = Number(process.env.SIGNAL_PORT || 4001);

httpServer.listen(PORT, () => {
  console.log(`[signaling] Server dang chay: http://localhost:${PORT}`);
  console.log(`[signaling] Kiem tra: http://localhost:${PORT}/health`);
});
