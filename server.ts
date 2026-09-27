import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import cookieParser from 'cookie-parser';
import { createServer as createViteServer } from 'vite';
import { initDatabase } from './src/server/db/index.js';
import { apiRouter } from './src/server/routes/api.js';
import { getUploadsPath } from './src/server/storage/upload.js';
import { setupSocketServer } from './src/server/realtime/socket.js';

async function startServer() {
  await initDatabase();

  const app = express();
  const server = http.createServer(app);

  // Attach Socket.io real-time server on the same HTTP server (port 3000)
  setupSocketServer(server);

  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Serve uploaded files from disk storage
  app.use('/uploads', express.static(getUploadsPath()));

  // API Routes
  app.use('/api', apiRouter);

  // Error handler for Multer / API errors
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'خطأ في معالجة الطلب' });
    }
    next();
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Nabd Social Hub] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
