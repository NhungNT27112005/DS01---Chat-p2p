# Giai đoạn 1: Khởi tạo dự án

## 1. Mục tiêu

Có một dự án JavaScript cài được thư viện, chạy được trang React và có chỗ để viết các phần còn lại. Giai đoạn này chưa có chat, đăng ký peer, WebRTC hay relay.

## 2. Kiểm tra công cụ

```powershell
node --version
npm.cmd --version
```

Node.js chạy JavaScript ở phía server. npm tải và quản lý thư viện. Môi trường lúc khởi tạo có Node.js `v24.14.0` và npm `11.9.0`.

## 3. Tạo package.json

```powershell
cd D:\DS01
npm.cmd init -y
```

`package.json` giống danh sách vật dụng và các lệnh của dự án. Sau khi khởi tạo, cấu hình `"type": "module"` cho phép dùng cú pháp `import` trong file JavaScript chạy bằng Node.js.

Các bước này đã được thực hiện. Không cần chạy lại `npm init -y` trên dự án hiện tại.

## 4. Cài thư viện

```powershell
npm.cmd install react react-dom express socket.io socket.io-client
npm.cmd install -D vite @vitejs/plugin-react
```

| Thư viện | Vai trò |
| --- | --- |
| `react` | Xây giao diện từ các component |
| `react-dom` | Gắn giao diện React vào trang HTML |
| `express` | Xây HTTP server ở giai đoạn tiếp theo |
| `socket.io` | Nhận kết nối thời gian thực ở server |
| `socket.io-client` | Kết nối trình duyệt tới server |
| `vite` | Chạy và đóng gói frontend |
| `@vitejs/plugin-react` | Hỗ trợ React trong Vite |

`-D` lưu vào nhóm công cụ phát triển (`devDependencies`). WebRTC là API của trình duyệt; hiện chưa cần cài thư viện WebRTC.

Sau khi cài, npm tạo `node_modules/` và `package-lock.json`. Khi lấy dự án ở máy khác, dùng `npm.cmd ci` để cài theo lockfile.

## 5. Hiểu đường chạy giao diện

```text
index.html → src/main.jsx → src/App.jsx
```

- `index.html` có một phần tử mang ID `root`.
- `main.jsx` gắn component `App` vào phần tử đó.
- `App.jsx` trả về nội dung giao diện. Đuôi `.jsx` cho phép viết cú pháp giống HTML bên trong JavaScript; đây vẫn là JavaScript, không phải TypeScript.
- `styles.css` quy định màu, chữ và khoảng cách.

## 6. Tự chạy kiểm tra

```powershell
npm.cmd run dev
```

Mở `http://localhost:5173`. Kết quả mong đợi là trang “Chat P2P bằng JavaScript” và dòng “Khởi tạo React + Vite thành công.”

Dừng bằng `Ctrl+C`. Nếu cổng 5173 đang được dùng, dừng terminal Vite cũ trước khi chạy lại.

Kiểm tra đóng gói:

```powershell
npm.cmd run build
```

## 7. Điều kiện hoàn thành

- Cài thư viện thành công.
- Trang React mở được.
- Lệnh build thành công.
- Bạn hiểu vai trò các thư mục trước khi chuyển bước.

Tiếp theo sẽ đề xuất các bước xây signaling server và chờ duyệt trước khi viết chức năng.

Tài liệu chính thức: [Vite](https://vite.dev/guide/), [Express](https://expressjs.com/en/starter/installing/), [Socket.IO](https://socket.io/docs/v4/server-installation/).
