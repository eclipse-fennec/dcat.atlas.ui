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
      // sax ist CommonJS und liegt unter den ausgenommenen Paketen. Ohne
      // Vorbündeln liefert es keinen default-Export und der Dev-Server bricht
      // beim Start ab — der Production-Build merkt das nicht, weil Rollup den
      // CJS-Interop selbst erledigt.
      include: ['sax'],
    },
    server: {
      proxy: {
        // Als Regex, nicht als Prefix: ein blankes '/dcat' würde auch
        // statische Dateien wie '/dcat.svg' an den Portal-Server schicken.
        '^/dcat/': { target, changeOrigin: true },
      },
    },
  };
});
