import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * AI requests go to the small server that holds the provider key (npm run server). When that
 * server is not running, the status check gets a plain "not available" answer instead of a proxy
 * error, so the editor can simply show its AI tools as unavailable.
 */
const aiProxy: Record<string, ProxyOptions> = {
  '/api': {
    target: process.env.PRYSM_AI_SERVER ?? 'http://127.0.0.1:8787',
    changeOrigin: false,
    configure: (proxy) => {
      proxy.on('error', (_err, req, res) => {
        if (!('writeHead' in res) || res.headersSent) return;
        const status = req.url === '/api/ai/status' ? 200 : 503;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'The AI server is not running. Start it with "npm run server".' }));
      });
    },
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: aiProxy },
  preview: { proxy: aiProxy },
  // ONNX Runtime is already a browser-ready ES module that locates its WebAssembly file relative
  // to itself; pre-bundling it is unnecessary and would trigger a page reload on first use in dev.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  worker: { format: 'es' },
});
