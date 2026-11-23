# Bộ triển khai cho VPS

Bộ cấu hình đã chuẩn bị cho bản local và triển khai sau này. Chưa có VPS/tên miền nên chưa triển khai hoặc xác nhận liên lạc WAN thật. Docker daemon của máy phát triển hiện chưa chạy: đã kiểm tra cú pháp Compose, chưa build/chạy container tại máy này.

## Thành phần

Docker Compose chạy signaling (4001 nội bộ), relay độc lập (4002 nội bộ), frontend nginx (8080), và tùy chọn Caddy HTTPS (80/443). Hai Socket.IO endpoint công khai là `/signal/socket.io` và `/relay/socket.io`; nginx ánh xạ chúng tới đúng server.

Secret chỉ cấp cho hai server, không có tiền tố `VITE_` và không được đóng gói vào frontend. Lịch sử chat cá nhân được lưu ở browser.

## Chạy Docker local khi Docker Desktop đã sẵn sàng

Tạo `deploy/.env` dựa trên `deploy/.env.example`:

```dotenv
PUBLIC_HOST=localhost
PUBLIC_ORIGIN=http://localhost:8080
RELAY_SECRET=thay-bang-chuoi-ngau-nhien-it-nhat-32-ky-tu
```

Tạo secret bằng:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Sau đó:

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
```

Mở http://localhost:8080. Không dùng HTTP qua IP LAN/public để thử WebRTC; dùng HTTPS cho các máy từ xa.

## Đưa lên VPS với tên miền

1. Có máy chủ chạy Docker/Compose, tên miền trỏ DNS A/AAAA tới máy chủ, cho phép truy cập cổng 80/443. Không cần công khai cổng nội bộ 4001/4002.
2. Chép project lên máy chủ; không chép `.env` local chứa URL localhost vào image. `.dockerignore` đã loại file này.
3. Tạo `deploy/.env` với `PUBLIC_HOST=chat.tenmiencuaban.vn`, `PUBLIC_ORIGIN=https://chat.tenmiencuaban.vn` và secret riêng.
4. Chạy:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml --profile internet up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yaml logs -f signaling relay
```

Caddy đọc tên miền trong cấu hình, tự xin và gia hạn chứng chỉ khi DNS/cổng công khai đáp ứng yêu cầu. Xem [hướng dẫn HTTPS chính thức](https://caddyserver.com/docs/quick-starts/https).

5. Mở `https://chat.tenmiencuaban.vn`, `/signal/health`, `/relay/health` từ mạng ngoài.
6. Thực hiện 12 kịch bản ở `03-demo.md`, đặc biệt hai máy dùng hai mạng Internet khác nhau. Không ghi nhận đạt WAN chỉ dựa trên ba tab localhost.

Nginx chuyển tiếp WebSocket Upgrade và đặt timeout 75 giây, lớn hơn chu kỳ heartbeat 5 + 10 giây. Cấu hình dựa trên [hướng dẫn reverse proxy Socket.IO](https://socket.io/docs/v4/reverse-proxy/).

## Cấu hình khi không dùng Docker

Chạy hai Node server bằng process manager, đặt `NODE_ENV=production`, `RELAY_SECRET`, `ALLOWED_ORIGINS` và `SIGNAL_INTERNAL_URL`. Frontend build với URL/path public đúng server. Bắt buộc dùng HTTPS/WSS ở reverse proxy.

STUN mặc định giúp thử DIRECT qua NAT. Không phải NAT nào cũng cho kết nối trực tiếp; relay Socket.IO giải quyết việc truyền chat khi DIRECT thất bại. Bản này không cần cài TURN và không đánh đồng relay Socket.IO với TURN.

## Vận hành và giới hạn

- Giám sát health/log relay và signaling. Dừng/khởi động lại bằng Compose; browser tự reconnect.
- Relay là điểm lỗi đơn; thiếu relay thì chỉ các đường DIRECT còn hoạt động. Chưa có nhiều relay/failover server.
- Signaling quản lý peer và xác thực phiên relay. Khi signaling ngừng, phiên ứng dụng kết thúc và tự đăng ký lại khi server phục hồi.
- Không lưu tin offline tại relay. Lịch sử thuộc browser và phụ thuộc dung lượng localStorage.
- HMAC chống giả sender trong phiên; đây chưa phải hệ thống tài khoản xác thực người dùng hoặc E2EE.
