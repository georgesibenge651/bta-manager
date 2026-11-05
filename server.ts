import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import { INITIAL_PRODUCTS, INITIAL_SETTINGS, INITIAL_CUSTOMERS, INITIAL_SALES } from './src/db/initialData.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory backend database state (with fallback persistence)
let backendProducts = [...INITIAL_PRODUCTS];
let backendSales = [...INITIAL_SALES];
let backendCustomers = [...INITIAL_CUSTOMERS];
let backendSettings = { ...INITIAL_SETTINGS };

/**
 * Recursively creates a ZIP archive of all project source files,
 * excluding build artifacts and node_modules.
 */
async function generateFullProjectZip(): Promise<Buffer> {
  const zip = new JSZip();
  const rootDir = process.cwd();

  const ignoreList = new Set([
    '.env',
    '.env.local',
    '.env.production',
    'keystore.properties',
    'node_modules',
    'dist',
    '.git',
    '.cache',
    '.next',
    'dist-ssr',
    'bta-business-transform-africa.zip',
    'bta-project.zip',
  ]);

  function crawl(currentDir: string, zipFolder: JSZip) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignoreList.has(entry.name)) continue;
      // never ship secrets / signing keys
      if (/^\.env/.test(entry.name) && entry.name !== '.env.example') continue;
      if (/\.(jks|keystore|p12|pem|key)$/i.test(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const subFolder = zipFolder.folder(entry.name);
        if (subFolder) {
          crawl(fullPath, subFolder);
        }
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.zip') || entry.name.endsWith('.tar.gz')) continue;
        const fileContent = fs.readFileSync(fullPath);
        zipFolder.file(entry.name, fileContent);
      }
    }
  }

  crawl(rootDir, zip);

  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  // CORS: only the Android app (Capacitor origins) and the configured web origin(s) may call the API.
  const allowedOrigins = new Set<string>([
    'https://localhost', // Capacitor Android (androidScheme: https)
    'http://localhost',
    'capacitor://localhost',
    ...(process.env.ALLOWED_ORIGINS || process.env.APP_URL || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  ]);
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(origin && allowedOrigins.has(origin) ? 204 : 403);
      return;
    }
    next();
  });

  // Optional shared secret for every /api route except the health check.
  // Set SYNC_API_KEY on the server and send it as "Authorization: Bearer <key>".
  const apiKey = process.env.SYNC_API_KEY;
  if (!apiKey && process.env.NODE_ENV === 'production') {
    console.warn('⚠️  SYNC_API_KEY is not set: the data API is open to anyone who can reach this server.');
  }
  app.use('/api', (req, res, next) => {
    if (!apiKey || req.path === '/health') return next();
    if (req.headers.authorization === `Bearer ${apiKey}`) return next();
    res.status(401).json({ success: false, error: 'Non autorisé' });
  });

  // ==========================================
  // BACKEND REST API ROUTES
  // ==========================================

  // 1. Health check
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      app: 'BTA Business Transform Africa',
      version: '1.0.0',
      timezone: 'Africa/Lubumbashi',
      timestamp: new Date().toISOString(),
    });
  });

  // 2. Settings
  app.get('/api/settings', (req: Request, res: Response) => {
    res.json(backendSettings);
  });

  app.post('/api/settings', (req: Request, res: Response) => {
    const rate = Number(req.body?.exchangeRate);
    if (!Number.isFinite(rate) || rate < 100 || rate > 100000) {
      res.status(400).json({ success: false, error: 'Taux de change invalide' });
      return;
    }
    backendSettings = { ...backendSettings, exchangeRate: rate };
    res.json({ success: true, settings: backendSettings });
  });

  // 3. Products
  app.get('/api/products', (req: Request, res: Response) => {
    res.json(backendProducts);
  });

  app.post('/api/products', (req: Request, res: Response) => {
    const newProduct = req.body;
    if (!newProduct || typeof newProduct.id !== 'string' || typeof newProduct.name !== 'string') {
      res.status(400).json({ success: false, error: 'Produit invalide' });
      return;
    }
    backendProducts = [newProduct, ...backendProducts];
    res.json({ success: true, product: newProduct });
  });

  // 4. Sales
  app.get('/api/sales', (req: Request, res: Response) => {
    res.json(backendSales);
  });

  app.post('/api/sales', (req: Request, res: Response) => {
    const newSale = req.body;
    if (!newSale || typeof newSale.id !== 'string' || !Array.isArray(newSale.items)) {
      res.status(400).json({ success: false, error: 'Vente invalide' });
      return;
    }
    backendSales = [newSale, ...backendSales];
    res.json({ success: true, sale: newSale });
  });

  // 5. Offline Sync Endpoint (Robust Multi-Entity Sync with Idempotency)
  app.post('/api/sync', (req: Request, res: Response) => {
    try {
      const { queue } = req.body || {};
      const syncedIds: string[] = [];
      let syncedCount = 0;

      if (Array.isArray(queue) && queue.length > 500) {
        res.status(413).json({ success: false, error: 'File de synchronisation trop volumineuse (max 500)' });
        return;
      }
      if (Array.isArray(queue)) {
        for (const item of queue) {
          if (!item || typeof item !== 'object') continue;
          const payload = item.payload;
          if (!payload || typeof payload.id !== 'string') continue;

          switch (item.type) {
            case 'SALE_CREATE': {
              const existingIdx = backendSales.findIndex((s) => s.id === payload.id);
              if (existingIdx >= 0) {
                backendSales[existingIdx] = { ...payload, syncStatus: 'SYNCED' };
              } else {
                backendSales.unshift({ ...payload, syncStatus: 'SYNCED' });
              }
              syncedIds.push(item.id || payload.id);
              syncedCount++;
              break;
            }
            case 'PURCHASE_CREATE': {
              syncedIds.push(item.id || payload.id);
              syncedCount++;
              break;
            }
            case 'EXPENSE_CREATE': {
              syncedIds.push(item.id || payload.id);
              syncedCount++;
              break;
            }
            case 'CUSTOMER_CREATE':
            case 'CUSTOMER_UPDATE': {
              const custIdx = backendCustomers.findIndex((c) => c.id === payload.id);
              if (custIdx >= 0) {
                backendCustomers[custIdx] = payload;
              } else {
                backendCustomers.unshift(payload);
              }
              syncedIds.push(item.id || payload.id);
              syncedCount++;
              break;
            }
            case 'PRODUCT_UPDATE': {
              const prodIdx = backendProducts.findIndex((p) => p.id === payload.id);
              if (prodIdx >= 0) {
                backendProducts[prodIdx] = payload;
              } else {
                backendProducts.unshift(payload);
              }
              syncedIds.push(item.id || payload.id);
              syncedCount++;
              break;
            }
            default: {
              // Unknown record type: do NOT confirm it, so the client keeps it in its queue.
              break;
            }
          }
        }
      }

      res.json({
        success: true,
        syncedCount,
        syncedIds,
        serverTime: new Date().toISOString(),
        message: `${syncedCount} transaction(s) confirmée(s) et synchronisée(s) sur le serveur BTA`,
      });
    } catch (err: unknown) {
      console.error('Sync processing error:', err);
      res.status(500).json({
        success: false,
        error: 'Erreur lors du traitement de la synchronisation serveur',
      });
    }
  });

  // 6. Direct Full Project ZIP Download Endpoint
  app.get(['/api/download-zip', '/download-zip', '/bta-project.zip'], async (req: Request, res: Response) => {
    // Source download is a development convenience only: never expose it in production.
    if (process.env.NODE_ENV === 'production') {
      res.status(404).end();
      return;
    }
    try {
      console.log('Generating full project ZIP archive...');
      const zipBuffer = await generateFullProjectZip();
      
      const fileName = 'bta-business-transform-africa.zip';
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Length', zipBuffer.length.toString());
      res.setHeader('Cache-Control', 'no-cache');
      res.end(zipBuffer);
    } catch (error) {
      console.error('Failed to generate project ZIP:', error);
      res.status(500).json({ error: 'Échec de la génération du fichier ZIP' });
    }
  });

  // ==========================================
  // VITE DEV MIDDLEWARE / STATIC ASSETS
  // ==========================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req: Request, res: Response) => {
        res.sendFile(path.resolve(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 BTA Full-Stack Server running at http://0.0.0.0:${PORT}`);
    console.log(`📦 Project ZIP download available at http://0.0.0.0:${PORT}/api/download-zip`);
  });
}

startServer();
