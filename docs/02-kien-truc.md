# Kiến trúc và giao thức DS01

## Vai trò

Signaling giữ danh sách peer online, socket đăng ký và nhóm; chuyển offer/answer/ICE đúng peer đích. Không chuyển tiếp nội dung chat. Relay là một tiến trình độc lập, duy trì ánh xạ Peer ID → socket, chuyển gói chat/ACK đúng đích. Browser có thể vừa khởi tạo vừa nhận kết nối WebRTC.

```text
Browser A ─── Socket.IO metadata ─── Signaling ─── Browser B
    │                                               │
    └──────── WebRTC DataChannel (DIRECT) ───────────┘
    │                                               │
    └──────── Socket.IO ── Relay ── Socket.IO ───────┘
```

`connection-manager.js` chọn đường truyền. `reliable.js` theo dõi ACK độc lập với đường truyền. `chat.js` kiểm tra nguồn gửi, quản lý lịch sử, chống trùng và phân phối nhóm. `App.jsx`/`GroupChat.jsx` hiển thị trạng thái.

## Gói tin

```js
{
  version: 1,
  type: 'CHAT_MESSAGE', // hoặc GROUP_MESSAGE, ACK
  messageId: 'uuid',
  senderId: 'peer-a',
  receiverId: 'peer-b',
  groupId: null,       // GROUP_MESSAGE bắt buộc có Group ID
  sessionId: 'uuid',
  sequence: 1,
  timestamp: 1700000000000,
  content: 'Xin chào',
  deliveryMode: 'DIRECT'
}
```

ACK có Message ID riêng, `ackFor` trỏ tới Message ID gốc, cùng Session ID và Group ID, đảo sender/receiver, `sequence`/`content` bằng null. Không ACK một ACK. Relay xác nhận chuyển tiếp qua callback Socket.IO; callback này không thay cho ACK của người nhận.

Session ID của **gói chat** là phiên ứng dụng của người gửi. Session ID của **offer/answer/ICE** là phiên kết nối WebRTC. Hai lớp này tách nhau để tin chờ ACK giữ nguyên ID khi đổi DIRECT/RELAY hoặc tái tạo đường truyền. Bên nhận xác thực sender bằng danh tính transport đã ràng buộc, kiểm tra receiver và cấu trúc gói; ACK phải khớp đầy đủ sender/receiver/session/message/group.

Fan-out nhóm tạo một Message ID, sequence và timestamp, sau đó sao chép cho từng receiver. Bộ theo dõi ACK dùng khóa `[senderId, receiverId, sessionId, messageId]`; bộ chống hiển thị trùng dùng `[senderId, messageId]`.

## API giữa các phần

| API | Ý nghĩa |
| --- | --- |
| `webrtc.connect(peerId, sessionId)` | Chỉ resolve khi DataChannel mở; có timeout |
| `webrtc.send(peerId, packet)` | Trả `{deliveryMode:'DIRECT'}` sau khi đưa vào DataChannel |
| `webrtc.onMessage/onStateChange` | Subscribe, trả hàm unsubscribe |
| `webrtc.close/closeAll` | Dọn phiên/timer/callback và báo CLOSED có intentional |
| `manager.sendToPeer(packet, {preferRelay})` | Gửi qua transport, không chờ ACK đích |
| `reliable.sendReliable(packet, send, onFailed)` | Đăng ký trước khi gửi, chờ ACK, retry có giới hạn |
| `reliable.acknowledgeMessage(ack)` | Hủy retry đúng người nhận và đúng gói |
| `history.load/save(owner, ...)` | Lưu riêng từng chủ Peer ID |
| `chatClient.sendPrivate/sendGroup` | Giao diện gọi API ứng dụng, không thao tác transport trực tiếp |

## Trạng thái và lỗi

`CONNECTING → DIRECT_READY`; `DISCONNECTED` cho phép phục hồi 5 giây; `FAILED`/`CLOSED` không chủ ý chuyển sang `RELAY_READY` nếu relay sẵn sàng, hoặc `UNAVAILABLE`. Người dùng có thể bấm lại nút kết nối để thử DIRECT. Khi relay phục hồi, socket tự đăng ký lại bằng vé đang còn hiệu lực; vé được làm mới định kỳ.

Socket.IO heartbeat 5 giây, timeout 10 giây làm sạch peer chết. Nếu transport báo socket đóng, danh sách cập nhật sớm hơn khoảng chờ heartbeat. Mất signaling kết thúc phiên ứng dụng theo chính sách hiện tại, dọn các kết nối và hủy retry; khi reconnect tự đăng ký lại danh tính của tab. Mất relay riêng không làm đóng DIRECT.

Ngữ nghĩa: gửi lại có giới hạn kết hợp ACK ứng dụng và deduplication. Không cam kết mọi tin đều đến, không phải exactly-once toàn hệ thống. Lịch sử và bộ chống trùng có giới hạn; xóa localStorage sẽ xóa khả năng chống trùng đã lưu.

## Phân công và điểm tích hợp

- Người 1: WebRTC, chat cá nhân, gói tin, ACK/retry/dedup/order, history cá nhân/nhóm, kiểm thử liên quan.
- Người 2: signaling quản lý peer/nhóm, relay server/client, connection manager, chat nhóm, triển khai và kiểm thử liên mạng.
- Các phần đã được ghép trong workspace. Khi phát triển riêng, giữ API trên và giữ nguyên Message ID/Session ID ở mọi lần retry.

## NAT, STUN, TURN và giới hạn relay

STUN giúp tìm địa chỉ công khai; ICE thử các đường truyền. Một số NAT/tường lửa vẫn chặn DIRECT. Bản này dùng relay Socket.IO ở tầng ứng dụng qua kết nối outbound để xử lý trường hợp đó; không yêu cầu TURN. TURN là một loại relay ở tầng WebRTC, khác relay Socket.IO trong dự án. Tham khảo [giao thức WebRTC của MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols).

Relay là một điểm lỗi đơn và tăng băng thông/độ trễ do phải nhận rồi gửi mỗi gói. Bản hiện tại còn truy vấn signaling để xác thực phiên/nhóm nên signaling cũng là phụ thuộc của RELAY. DIRECT đang thiết lập không đi qua relay; nhưng chính sách kết thúc phiên khi signaling mất vẫn áp dụng. Mở rộng nhiều relay cần directory/chọn relay, đồng bộ danh tính và nhóm, rồi thử lại trên relay khác; chưa triển khai trong bản tối thiểu.
