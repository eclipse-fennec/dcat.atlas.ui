import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

/**
 * Der DCAT.Atlas-Server schickt keine CORS-Header — die Leseendpunkte sind
 * offen, aber nur für Aufrufer, die keine Same-Origin-Policy einhalten müssen.
 * Im Dev-Server läuft die API deshalb über einen Proxy unter `/dcat`, was
 * nebenbei die Paging-Header (`X-Total-Count`, `Link`) lesbar hält, die bei
 * einem Cross-Origin-Zugriff ohne `Access-Control-Expose-Headers` verborgen
 * blieben.
 *
 * Ziel per `DCAT_ATLAS_URL` umstellbar; Standard ist der lokale bndrun-Lauf
 * (`org.eclipse.fennec.dcat.atlas.runtime/local.bndrun`) auf Port 8085.
 * Für ein Deployment gegen eine andere Basis: `VITE_DCAT_API` setzen.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.DCAT_ATLAS_URL || 'http://localhost:8085';

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    optimizeDeps: {
      // Die EMFTs-Pakete nicht vorbündeln — Vites Tree-Shaking bricht deren
      // interne Imports. Galt schon für die früheren file:-Verweise und bleibt
      // konservativ auch für die npm-Pakete.
      exclude: ['@emfts/core', '@emfts/vue-registry', '@emfts/uimodel-composer'],
    },
    server: {
      proxy: {
        '/dcat': { target, changeOrigin: true },
      },
    },
  };
});
