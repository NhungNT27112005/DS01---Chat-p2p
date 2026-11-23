# 12 kịch bản trình diễn DS01

Chạy `npm.cmd run dev:all`, mở ba tab độc lập. Mở Console của từng tab để thấy `[peer] SEND/RECEIVE DIRECT/RELAY`. Terminal relay ghi REGISTER/OFFLINE/FORWARD cùng loại gói và ID, không ghi nội dung chat.

| # | Kịch bản | Thực hiện và bằng chứng |
| --- | --- | --- |
| 1 | Triển khai Internet | Làm theo `04-trien-khai.md`; ghi URL HTTPS và ảnh health của hai server. Chưa thực hiện trên WAN vì chưa có VPS/tên miền. |
| 2 | Ba peer | Đăng ký peer-a, peer-b, peer-c; danh sách có ba peer. |
| 3 | Discovery | Theo dõi danh sách cập nhật khi tab mới đăng ký. ID trùng bị từ chối. |
| 4 | DIRECT | A chọn B, bấm kết nối, trạng thái DIRECT_READY; gửi hai chiều. |
| 5 | Chứng minh không qua relay | Ghi `forwarded` ở `/health` của relay trước/sau chat DIRECT; bộ đếm không tăng, peer log SEND/RECEIVE DIRECT. |
| 6 | Khác mạng/NAT | Khi có VPS: một máy dùng Wi-Fi, máy kia dùng mạng di động; nếu DIRECT không được, đợi tối đa 10 giây để chuyển RELAY. Local E2E chặn tạo PeerConnection để kiểm chứng fallback, không giả làm WAN thật. |
| 7 | Chứng minh đường relay | Log peer SEND/RECEIVE RELAY, log relay FORWARD, bộ đếm tăng cùng Message ID. |
| 8 | Cách ly chat cá nhân | A gửi riêng cho B rồi gửi riêng cho C; chỉ người nhận tương ứng thấy tin nhắn. Đổi người nhận để xem lịch sử từng cuộc trò chuyện. |
| 9 | Gửi đồng thời | A và B gửi gần cùng lúc; cả hai nhận đúng một bản và xác nhận. E2E còn thử hai phía tạo offer đồng thời. |
| 10 | Peer đột ngột dừng | Đóng hẳn tab C, quan sát C biến mất; nếu mất mạng không phát hiện đóng socket ngay, chờ chu kỳ heartbeat. Tin cá nhân gửi tới C khi offline không nhận được ACK và chuyển sang thất bại sau khi hết retry. |
| 11 | DIRECT → RELAY | Sau khi DIRECT_READY, ngắt kênh trực tiếp (trong E2E gọi close không chủ ý), quan sát trạng thái chuyển relay, tin mới nhận ACK. Mất mạng tạm được chờ 5 giây trước khi bỏ DIRECT. |
| 12 | Restart peer | Tải lại B. Danh tính của tab tự đăng ký lại, lịch sử cá nhân khôi phục từ localStorage, tin chưa có ACK của phiên cũ báo thất bại. |

## Test tự động và bằng chứng

`npm.cmd test`: giao thức chat cá nhân, history, retry, xác thực relay, stale ticket, thứ tự, timeout, backpressure và phục hồi 5 giây. Có server Socket.IO thật trên cổng tạm và mô phỏng đồng hồ cho các timeout.

`npm.cmd run test:e2e`: ba context Chrome độc lập, DataChannel và server thật. Các lỗi mất ACK/chặn DIRECT được tiêm từ mã kiểm thử, không thêm nút giả lập hay fault injection vào luồng sản phẩm.

Báo cáo tạo lại tại `test-results/browser-e2e.json`, ảnh `test-results/browser.png`. Kết quả này mô tả localhost và lỗi được tiêm; các kịch bản Internet cần bằng chứng chạy ở môi trường triển khai riêng.

## Kiểm thử bổ sung khi đưa lên VPS

1. Kiểm tra HTTPS, WSS và các URL health từ mạng bên ngoài.
2. Lặp lại gửi tin cá nhân giữa ít nhất hai kết nối Internet khác nhau.
3. Ghi Message ID, mode, thời gian gửi/ACK; không ghi secret/token vào báo cáo.
4. Ngắt relay: DIRECT vẫn gửi được; đường RELAY báo không sẵn sàng và retry kết thúc có giới hạn. Khởi động relay lại, socket browser tự đăng ký lại.
5. Restart signaling: peer đăng ký lại; lịch sử giữ ở browser.
