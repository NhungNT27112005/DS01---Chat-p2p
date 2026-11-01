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

// 4. Tạm thời chỉ ghi log khi một client kết nối tới Socket.IO.
io.on('connection', (socket) => {
  console.log('[signaling] Client ket noi:', socket.id);
});

// 5. Dùng SIGNAL_PORT nếu có cấu hình; mặc định là cổng 4001.
const PORT = Number(process.env.SIGNAL_PORT || 4001);

httpServer.listen(PORT, () => {
  console.log(`[signaling] Server dang chay: http://localhost:${PORT}`);
  console.log(`[signaling] Kiem tra: http://localhost:${PORT}/health`);
});
