# DS01 — Chat P2P bằng JavaScript

Ứng dụng chat cá nhân 1–1 dùng React + Vite, Node.js + Express, Socket.IO và WebRTC DataChannel. Signaling quản lý peer và chuyển tiếp offer/answer/ICE. Nội dung chat ưu tiên đi trực tiếp; một relay Socket.IO độc lập được dùng khi DIRECT không khả dụng.

## Chạy trên máy

Yêu cầu Node.js >=22.12 (khuyến nghị Node.js 24), npm và Chrome/Edge để chạy kiểm thử trình duyệt.

```powershell
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run dev:all
```

Nếu đã có `.env`, giữ file hiện tại và bổ sung các biến còn thiếu từ `.env.example`. Chạy `Copy-Item` chỉ khi chưa có file.

Mở **http://localhost:5173**. Dùng hai tab/cửa sổ độc lập và đăng ký `peer-a`, `peer-b` với tên khác nhau. Chọn người nhận, bấm **Kết nối WebRTC** rồi gửi tin. Nút này thử DIRECT trước và tự chuyển RELAY nếu thất bại. Giao diện hiển thị chat cá nhân, trạng thái relay và lịch sử theo từng người nhận.

Có thể chạy riêng trong ba terminal:

```powershell
npm.cmd run dev:signaling
npm.cmd run dev:relay
npm.cmd run dev:web
```

- Signaling: http://localhost:4001/health
- Relay: http://localhost:4002/health — có bộ đếm `forwarded`, `rejected`, `bytes`.
- `npm.cmd run build`: build frontend vào `dist/`.
- `npm.cmd run preview`: xem bản build trên cổng 5173 (dừng Vite dev trước).

## Cấu trúc

```text
src/
  signaling/           Đăng ký, discovery, signaling WebRTC
  relay/               Relay server độc lập, xác thực và chuyển tiếp đúng đích
  server/common.js     Cấu hình server, vé HMAC, listen và origin
  shared/              Quy ước gói tin, kiểm tra dữ liệu, sự kiện
  web-peer/
    App.jsx             Giao diện chat cá nhân và trạng thái peer
    services/
      signaling.js      Socket.IO client tới signaling
      webrtc.js         Offer/answer/ICE, DataChannel, timeout, dọn phiên
      relay.js          Socket.IO client tới relay
      connection-manager.js  Chọn DIRECT/RELAY và fallback
      reliable.js       ACK, timeout, gửi lại có giới hạn
      history.js        Lưu/khôi phục localStorage và sắp thứ tự
      chat.js           Ghép discovery, truyền tin cá nhân, ACK và lịch sử
scripts/dev.js          Khởi chạy ba tiến trình, dừng cùng nhau
tests/                  Unit/integration và Chrome E2E (không cần Playwright)
deploy/                 Docker Compose, nginx, HTTPS Caddy và cấu hình mẫu
docs/                   Giải thích giao thức, demo và triển khai
```

## Quy tắc hoạt động

- Thiết lập DIRECT tối đa **10 giây**, áp dụng cả bên tạo offer và nhận offer. Khi hai bên cùng gọi kết nối, hai phía giữ phiên có Session ID nhỏ hơn theo thứ tự chuỗi, dọn phiên thua và cùng chờ phiên thắng.
- PeerConnection `disconnected`: chờ phục hồi **5 giây**. `failed`, DataChannel đóng/lỗi hoặc hết timeout: dọn phiên và báo để connection manager chuyển relay.
- Relay luôn duy trì kết nối đi ra từ browser. Nếu relay bị ngắt, Socket.IO kết nối lại; kết nối DIRECT đang tốt tiếp tục hoạt động.
- ACK đích chờ **5 giây**, gửi lại tối đa **3 lần** (4 lần gửi tổng cộng). Mỗi lần gọi đường truyền cũng có timeout 16 giây, nên một Promise bị treo không chặn tin mãi. Thiết lập kết nối và chờ đường truyền có thể làm tổng thời gian dài hơn 20 giây.
- Từ lần gửi lại đầu tiên ưu tiên relay để xử lý trường hợp DIRECT nhận được tin nhưng mất ACK. Giữ nguyên Message ID, Session ID, nội dung, timestamp và sequence; chỉ Delivery Mode thay đổi.
- `SENT`: DataChannel đã nhận dữ liệu để gửi. `FORWARDED`: relay đã chuyển tới socket đích. **Chỉ ACK từ peer nhận mới là `RECEIVED`**. Hết retry là `FAILED`/“Chưa xác nhận được”; bên nhận có thể đã nhận nhưng ACK bị mất. ACK hợp lệ đến muộn có thể xác nhận lại tin.
- Chống trùng theo `(senderId, messageId)` trên cả hai đường truyền. Tin trùng vẫn được ACK lại. Lịch sử giữ 2.000 tin gần nhất/Peer ID, bộ chống trùng giữ 10.000 ID; đây là giới hạn lưu trữ có chủ đích.
- Sequence tăng theo người gửi/phiên/cuộc trò chuyện. Tin đến muộn được chèn theo sequence; thiếu một tin không làm chặn toàn bộ cuộc trò chuyện. Không cam kết tổng thứ tự thời gian tuyệt đối giữa hai người có đồng hồ khác nhau.
- Gửi cho peer offline được báo thất bại rõ ràng; bản này không có hàng đợi store-and-forward trên server.
- Lịch sử riêng theo Peer ID trong localStorage; danh tính để tự đăng ký lại nằm trong sessionStorage của tab. Tải lại tab khôi phục lịch sử, kết nối lại signaling/relay và tạo phiên ứng dụng mới. Tin phiên cũ đang chờ ACK được đánh dấu chưa xác nhận, không tự gửi lại khi mở lại.

## Kiểm thử

```powershell
npm.cmd test
npm.cmd run test:e2e
npm.cmd run build
```

E2E khởi chạy server tạm trên cổng ngẫu nhiên và ba browser context độc lập bằng Chrome headless. Nếu không tự tìm được trình duyệt:

```powershell
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm.cmd run test:e2e
```

Kết quả E2E gồm WebRTC thật, chat hai chiều đồng thời, relay không nhận nội dung DIRECT, mất ACK và gửi lại giữ ID, chuyển DIRECT → RELAY, cách ly tin nhắn giữa các cặp peer, hết retry, restart/lịch sử, offline và relay ngừng hoạt động. Báo cáo/log/screenshot được tạo tại `test-results/` (Git bỏ qua).

Đường DIRECT không truy cập được được mô phỏng trong browser bằng chặn khởi tạo PeerConnection. Đây là bằng chứng fallback ở local; không được mô tả là đã kiểm thử NAT/WAN thật.

Xem [12 kịch bản demo](docs/03-demo.md), [giao thức và phân công](docs/02-kien-truc.md) và [triển khai Internet](docs/04-trien-khai.md).

## Phạm vi và bảo vệ danh tính

Peer ID được server ràng buộc với socket đăng ký. Relay yêu cầu vé HMAC do signaling cấp và kiểm tra registration hiện tại để chặn giả mạo sender, dùng lại vé cũ sau restart và gửi đến sai phiên. Gói chat tối đa 32 KiB, nội dung tối đa 8.000 ký tự. Trên Internet phải đặt secret riêng và dùng HTTPS/WSS.

Đây là mô hình bài tập có quyền sở hữu ID trong một phiên online; chưa có tài khoản/mật khẩu để bảo lưu quyền sở hữu ID lâu dài sau khi offline. Relay đọc được nội dung chat; chưa có E2EE ở tầng ứng dụng. Các mục nâng cao như nhiều relay, DHT, gọi video, gửi file và store-and-forward nằm ngoài bản tối thiểu DS01.
