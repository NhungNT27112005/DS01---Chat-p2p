# DS01 - Chat P2P bằng JavaScript

Dự án học theo từng giai đoạn. Hiện đã khởi tạo thư mục, cài thư viện và tạo trang React tối thiểu để kiểm tra môi trường.

## Chạy giao diện

Mở terminal PowerShell tại `D:\DS01`:

```powershell
npm.cmd run dev
```

Mở địa chỉ Vite hiển thị, mặc định `http://localhost:5173`.

`npm.cmd` gọi npm trên Windows và tránh lỗi PowerShell chặn `npm.ps1`.

## Cấu trúc thư mục

```text
DS01/
├── public/              Tài nguyên tĩnh như ảnh, biểu tượng
├── src/                 Giao diện React
│   ├── components/      Các phần giao diện dùng lại
│   ├── services/        Kết nối Socket.IO, WebRTC ở các bước sau
│   ├── App.jsx          Trang khởi đầu
│   ├── main.jsx         Điểm khởi động React
│   └── styles.css       Kiểu hiển thị
├── server/              Signaling và relay, chưa viết chức năng
├── shared/              Quy ước dữ liệu dùng chung, chưa triển khai
├── tests/               Kiểm thử sẽ bổ sung sau
├── docs/                Hướng dẫn học từng giai đoạn
├── .env.example         Mẫu cấu hình cho các bước sau
├── .gitignore           Những file không đưa lên Git
├── index.html           Trang HTML chứa ứng dụng React
├── package.json         Thư viện và lệnh npm
├── package-lock.json    Phiên bản thư viện đã cài
└── vite.config.js       Cấu hình Vite
```

File `.gitkeep` giữ lại các thư mục rỗng khi đưa dự án lên Git, không phải code chức năng.

## Các lệnh hiện có

| Lệnh | Tác dụng |
| --- | --- |
| `npm.cmd run dev` | Chạy giao diện khi phát triển |
| `npm.cmd run dev:web` | Cũng chạy giao diện, tên rõ để phân biệt với server sau này |
| `npm.cmd run build` | Đóng gói giao diện vào `dist/` |
| `npm.cmd run preview` | Xem bản đã build tại máy local |

Chưa có lệnh `dev:signaling` và `dev:relay`: hai server sẽ được viết sau khi duyệt giai đoạn tiếp theo.

Đọc [hướng dẫn khởi tạo](docs/01-khoi-tao.md) để hiểu từng bước.
