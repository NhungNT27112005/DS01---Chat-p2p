import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { WEBRTC_EVENTS } from '../shared/webrtc-events.js';

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

  pingInterval: 5000,
  pingTimeout: 10000,
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

  socket.on(WEBRTC_EVENTS.OFFER, (data) => {
    const senderId = socket.data.peerId;

    const receiverId =
      typeof data?.receiverId === 'string'
        ? data.receiverId.trim()
        : '';

    const sessionId =
      typeof data?.sessionId === 'string'
        ? data.sessionId.trim()
        : '';

    const offer = data?.offer;

    // Người gửi phải có đăng ký gắn với socket hiện tại.
    if (!senderId || peers.get(senderId)?.socketId !== socket.id) {
      socket.emit(WEBRTC_EVENTS.ERROR, {
        code: 'NOT_REGISTERED',
        receiverId,
        sessionId,
        message: 'Bạn cần tham gia mạng trước khi kết nối.',
      });
      return;
    }

    // Kiểm tra người nhận, phiên và cấu trúc offer.
    if (
      !receiverId ||
      receiverId === senderId ||
      !sessionId ||
      offer?.type !== 'offer' ||
      typeof offer?.sdp !== 'string' ||
      !offer.sdp.trim()
    ) {
      socket.emit(WEBRTC_EVENTS.ERROR, {
        code: 'INVALID_OFFER',
        receiverId,
        sessionId,
        message: 'Thông tin offer không hợp lệ.',
      });
      return;
    }

    const receiver = peers.get(receiverId);

    if (!receiver) {
      socket.emit(WEBRTC_EVENTS.ERROR, {
        code: 'PEER_OFFLINE',
        receiverId,
        sessionId,
        message: 'Peer đích hiện không online.',
      });
      return;
    }

    io.to(receiver.socketId).emit(WEBRTC_EVENTS.OFFER, {
      senderId,
      receiverId,
      sessionId,
      offer: {
        type: 'offer',
        sdp: offer.sdp,
      },
    });
  });

  socket.on(WEBRTC_EVENTS.ANSWER, (data) => {
    const senderId = socket.data.peerId;

    const receiverId =
      typeof data?.receiverId === 'string'
        ? data.receiverId.trim()
        : '';

    const sessionId =
      typeof data?.sessionId === 'string'
        ? data.sessionId.trim()
        : '';

    const answer = data?.answer;

    // Người gửi phải có đăng ký gắn với socket hiện tại.
    if (!senderId || peers.get(senderId)?.socketId !== socket.id) {
      socket.emit(WEBRTC_EVENTS.ERROR, {
        code: 'NOT_REGISTERED',
        receiverId,
        sessionId,
        message: 'Bạn cần tham gia mạng trước khi kết nối.',
      });
      return;
    }

    // Kiểm tra người nhận, phiên và cấu trúc answer.
    if (
      !receiverId ||
      receiverId === senderId ||
      !sessionId ||
      answer?.type !== 'answer' ||
      typeof answer?.sdp !== 'string' ||
      !answer.sdp.trim()
    ) {
      socket.emit(WEBRTC_EVENTS.ERROR, {
        code: 'INVALID_ANSWER',
        receiverId,
        sessionId,
        message: 'Thông tin answer không hợp lệ.',
      });
      return;
    }

    const receiver = peers.get(receiverId);

    if (!receiver) {
      socket.emit(WEBRTC_EVENTS.ERROR, {
        code: 'PEER_OFFLINE',
        receiverId,
        sessionId,
        message: 'Peer đích hiện không online.',
      });
      return;
    }

    io.to(receiver.socketId).emit(WEBRTC_EVENTS.ANSWER, {
      senderId,
      receiverId,
      sessionId,
      answer: {
        type: 'answer',
        sdp: answer.sdp,
      },
    });
  });

  // 4.1.3. Xử lý sự kiện ICE_CANDIDATE từ client.
  socket.on(WEBRTC_EVENTS.ICE_CANDIDATE, (data) => {
    const senderId = socket.data.peerId;

    const receiverId =
      typeof data?.receiverId === 'string'
        ? data.receiverId.trim()
        : '';

    const sessionId =
      typeof data?.sessionId === 'string'
        ? data.sessionId.trim()
        : '';

    const candidate = data?.candidate;

    // Người gửi phải có đăng ký gắn với socket hiện tại.
    if (!senderId || peers.get(senderId)?.socketId !== socket.id) {
      socket.emit(WEBRTC_EVENTS.ERROR, {
        code: 'NOT_REGISTERED',
        receiverId,
        sessionId,
        message: 'Bạn cần tham gia mạng trước khi kết nối.',
      });
      return;
    }

    // Kiểm tra người nhận, phiên và cấu trúc cơ bản của candidate.
    if (
      !receiverId ||
      receiverId === senderId ||
      !sessionId ||
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate) ||
      typeof candidate.candidate !== 'string'
    ) {
      socket.emit(WEBRTC_EVENTS.ERROR, {
        code: 'INVALID_ICE_CANDIDATE',
        receiverId,
        sessionId,
        message: 'Thông tin ICE candidate không hợp lệ.',
      });
      return;
    }

    const receiver = peers.get(receiverId);

    if (!receiver) {
      socket.emit(WEBRTC_EVENTS.ERROR, {
        code: 'PEER_OFFLINE',
        receiverId,
        sessionId,
        message: 'Peer đích hiện không online.',
      });
      return;
    }

    io.to(receiver.socketId).emit(WEBRTC_EVENTS.ICE_CANDIDATE, {
      senderId,
      receiverId,
      sessionId,
      candidate,
    });
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
