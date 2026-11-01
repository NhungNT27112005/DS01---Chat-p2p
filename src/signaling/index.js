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

function getPeerList() {
  const peerList = Array.from(peers.values());

  return peerList.map((peer) => ({
    peerId: peer.peerId,
    displayName: peer.displayName,
    status: peer.status,
  }));
}

// 4. Tạm thời chỉ ghi log khi một client kết nối tới Socket.IO.
io.on('connection', (socket) => {
  console.log('[signaling] Client ket noi:', socket.id);
  socket.emit('peers:list', getPeerList());

  socket.on('peer:register', (data) => {
    const peerId = data?.peerId;
    const displayName = data?.displayName;

    if (
      typeof peerId !== 'string' ||
      typeof displayName !== 'string'
    ) {
      console.log('[signaling] Dang ky that bai: ID va ten phai la chuoi');
      socket.emit('peer:register:result', {
        ok: false,
        message: 'Peer ID và tên hiển thị phải là chuỗi.',
      });
      return;
    }

    if (!peerId.trim() || !displayName.trim()) {
      console.log('[signaling] Dang ky that bai: ID va ten khong duoc trong');
      socket.emit('peer:register:result', {
        ok: false,
        message: 'Peer ID và tên hiển thị không được để trống.',
      });
      return;
    }

    const normalizedPeerId = peerId.trim();
    const normalizedDisplayName = displayName.trim();

    if (socket.data.peerId) {
      console.log('[signaling] Dang ky that bai: ket noi nay da dang ky');
      socket.emit('peer:register:result', {
        ok: false,
        message: 'Kết nối này đã đăng ký một peer.',
      });
      return;
    }

    if (peers.has(normalizedPeerId)) {
      console.log('[signaling] Dang ky that bai: Peer ID da ton tai');
      socket.emit('peer:register:result', {
        ok: false,
        message: 'Peer ID đang được sử dụng. Vui lòng chọn ID khác.',
      });
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

    socket.emit('peer:register:result', {
      ok: true,
      message: 'Tham gia mạng thành công.',
      peer: {
        peerId: peer.peerId,
        displayName: peer.displayName,
        status: peer.status,
      },
    });
    io.emit('peers:list', getPeerList());

    console.log('[signaling] Dang ky peer thanh cong:', peer);
  });

  socket.on('disconnect', (reason) => {
    const peerId = socket.data.peerId;

    if (!peerId) {
      return;
    }

    const peer = peers.get(peerId);

    if (peer?.socketId === socket.id) {
      peers.delete(peerId);
      io.emit('peers:list', getPeerList());

      console.log('[signaling] Peer ngat ket noi:', peerId, reason);
    }
  });
});

// 5. Dùng SIGNAL_PORT nếu có cấu hình; mặc định là cổng 4001.
const PORT = Number(process.env.SIGNAL_PORT || 4001);

httpServer.listen(PORT, () => {
  console.log(`[signaling] Server dang chay: http://localhost:${PORT}`);
  console.log(`[signaling] Kiem tra: http://localhost:${PORT}/health`);
});
