import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const app = express();                                  // Tạo ứng dụng Express

const httpServer = createServer(app);                   // Tạo server HTTP từ ứng dụng Express

/**
 * Gắn Socket.IO vào HTTP Server
 */
const io = new Server(httpServer, {
    cors: {
        origin: '*',                                    // Cho phép tất cả các nguồn truy cập (CORS)
    }
})
/**
 * Chọn cổng chạy Relay
 */
const PORT = Number(process.env.RELAY_PORT) || 4002;    // Mặc định là 4002 vì 4001 là cổng của Signaling Server

// Lưu ánh xạ Peer ID → Socket.IO socket
const peers = new Map();

/**
 * Endpoint kiểm tra server
 */
app.get("/health", (_, res) => {
    res.json({
        service: "relay",                               // Tên dịch vụ
        status: "ok",                                   // Trạng thái hoạt động
    });
});

/**
 * Lắng nghe peer kết nối
 */
io.on("connection", (socket) => {
    console.log(
        `[Relay] Socket connected: ${socket.id}`,           // ID của socket kết nối
    );

    // Khi client yêu cầu đăng ký peer ID
    socket.on("relay:register", (data, callback) => {
        const peerId = data?.peerId;

        if (
            typeof peerId !== "string" ||
            !/^[a-zA-Z0-9_-]{1,64}$/.test(peerId)           // Kiểm tra peerId có hợp lệ hay không (chỉ chứa ký tự a-z, A-Z, 0-9, _ và -, độ dài tối đa 64 ký tự)
        ) {
            callback?.({
                success: false,
                error: "INVALID_PEER_ID"
            });
            return;
        }

        if (socket.data.peerId && socket.data.peerId !== peerId) {      // Nếu socket đã đăng ký peerId khác, từ chối đăng ký mới
            callback?.({
                success: false,
                error: "ALREADY_REGISTERED"
            });
            return;
        }

        const existingSocket = peers.get(peerId);       // Kiểm tra xem peerId đã được đăng ký bởi socket khác hay chưa

        if (existingSocket && existingSocket.id !== socket.id) {        // Nếu peerId đã được đăng ký bởi socket khác, từ chối đăng ký
            callback?.({
                success: false,
                error: "PEER_ID_IN_USE"
            });
            return;
        }

        // Đăng ký peerId cho socket hiện tại
        peers.set(peerId, socket);
        socket.data.peerId = peerId;

        console.log(
            `[Relay] Registered: ${peerId} -> ${socket.id}`         // Hiển thị thông tin đăng ký peerId và socket ID
        );

        callback?.({
            success: true,
            peerId
        });
    });

    // Khi client ngắt kết nối
    socket.on('disconnect', (reason) => {
        const peerId = socket.data.peerId;

        if (peerId && peers.get(peerId)?.id === socket.id) {        // Nếu socket hiện tại là socket đã đăng ký peerId, xóa peerId khỏi danh sách peers
            peers.delete(peerId);
        }

        console.log(
            `[Relay] Socket disconnected: ${socket.id}`,
            reason
        );
    });
});

/**
 * Khởi động server
 */
httpServer.listen(PORT, () => {
    console.log(
        `[Relay] Server running at http://localhost:${PORT}`
    );
});