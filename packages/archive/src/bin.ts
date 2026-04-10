import { ArchiveService } from './archive-service.js';
import { createArchiveServer } from './server.js';

const ARCHIVE_ROOT = process.env.ARCHIVE_ROOT || '/home/estelle/archive';
const PORT = parseInt(process.env.ARCHIVE_PORT || '3009');

const service = new ArchiveService(ARCHIVE_ROOT);
const server = createArchiveServer(service);

server.listen(PORT, () => {
  console.log(`[Archive Server] Listening on port ${PORT}`);
  console.log(`[Archive Server] Root: ${ARCHIVE_ROOT}`);
});

const shutdown = () => {
  console.log('[Archive Server] Shutting down...');
  server.close(() => {
    console.log('[Archive Server] Closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('[Archive Server] Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
