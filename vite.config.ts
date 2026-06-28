import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev-only stand-in for the production proxy.php: lets the podcast feature
// fetch cross-origin RSS/audio while developing locally. In production the real
// proxy.php (PHP + cURL) serves the same `./proxy.php?url=` endpoint.
function devPodcastProxy(): PluginOption {
  return {
    name: 'dev-podcast-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/proxy.php')) return next()
        const target = new URL(req.url, 'http://localhost').searchParams.get('url')
        if (!target) {
          res.statusCode = 400
          res.end('Missing url parameter')
          return
        }
        fetch(target, {
          redirect: 'follow',
          headers: { Accept: '*/*', 'User-Agent': 'WhisperBrowser-dev-proxy/1.0' },
        })
          .then(async (upstream) => {
            res.statusCode = upstream.status
            const ct = upstream.headers.get('content-type')
            if (ct) res.setHeader('Content-Type', ct)
            res.setHeader('Access-Control-Allow-Origin', '*')
            const buf = Buffer.from(await upstream.arrayBuffer())
            res.end(buf)
          })
          .catch((err) => {
            res.statusCode = 502
            res.end('Dev proxy error: ' + (err?.message ?? String(err)))
          })
      })
    },
  }
}

// Relative base ('./') so the static build can be dropped into ANY folder on the
// Apache/LAMP web root (root or a subfolder) without rewriting asset URLs.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), devPodcastProxy()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // onnxruntime-web (pulled in by transformers.js) ships its own wasm and does
    // not pre-bundle cleanly; let Vite load it as-is.
    exclude: ['@huggingface/transformers'],
  },
  server: {
    headers: {
      // Enable cross-origin isolation in dev so multi-threaded WASM (SharedArrayBuffer)
      // is available. 'credentialless' still allows no-cors fetches of model weights
      // from the Hugging Face CDN.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
})
