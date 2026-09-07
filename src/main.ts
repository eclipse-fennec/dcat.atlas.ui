import { createApp } from 'vue';
import App from './App.vue';
import { EmftsRendererPlugin, componentRegistry } from '@emfts/vue-registry';
import StringFieldWidget from './components/StringFieldWidget.vue';

// EString-Features → eigenes Widget
componentRegistry.registerForDataType('EString', StringFieldWidget);

// Die App wird sofort gemountet und lädt Metamodelle und Katalogdaten selbst —
// so bekommen Lade- und Fehlerzustand eine Oberfläche statt eines leeren Fensters.
const app = createApp(App);
// Cast: die Registry bringt eine eigene Vue-Kopie mit, deren `Plugin`-Typ
// strukturell nicht mit dem hier verwendeten übereinstimmt.
app.use(EmftsRendererPlugin as never, { registerDefaults: false, registry: componentRegistry });
app.mount('#app');
