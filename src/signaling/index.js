import { createSignalingServer } from './server.js';
import { listen } from '../server/common.js';

// 4.1. Xử lý các sự kiện WebRTC từ client.
// 4.1.1. Xử lý sự kiện OFFER từ client.
// 4.1.2. Xử lý sự kiện ANSWER từ client.
// Các handler được tổ chức trong server.js để có thể kiểm thử độc lập.
const server = createSignalingServer({ groupFile: process.env.GROUP_FILE || 'data/groups.json' });
const port = await listen(server.httpServer, Number(process.env.SIGNAL_PORT || 4001));
console.log(`[signaling] http://localhost:${port}/health`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close().then(() => process.exit()));
