import { createRelayServer } from './server.js';
import { listen } from '../server/common.js';
const server = createRelayServer();
const port = await listen(server.httpServer, Number(process.env.RELAY_PORT || 4002));
console.log(`[relay] http://localhost:${port}/health`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close().then(() => process.exit()));
