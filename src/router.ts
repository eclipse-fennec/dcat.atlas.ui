import { createRouter, createWebHistory } from 'vue-router';

/**
 * Adressen des Viewers.
 *
 * Die Routen tragen nur den Zustand, keine Komponenten: `App.vue` rendert
 * weiterhin selbst und liest Tab, Datensatz und Filter aus der Route. Darum
 * zeigt jede Route auf dieselbe leere Komponente — vue-router verlangt eine.
 *
 *   /                      Datensätze
 *   /datasets/:id          ein Datensatz
 *   /services              Dienste
 *   /catalogs              Kataloge
 *   /sparql                SPARQL
 *   /verwalten             Verwaltung (Schreibseite)
 *
 * Die Filter der Datensatzliste stehen in der Query (`q`, `catalog`, `theme`),
 * damit eine gefilterte Ansicht verlinkbar ist und „Zurück“ sie wiederherstellt.
 *
 * Keine Route darf unter `/dcat/`, `/model/` oder `/assets/` liegen: dort
 * liefern Dev-Proxy und nginx die API bzw. statische Dateien aus.
 */
const Empty = { render: () => null };

export type Tab = 'datasets' | 'services' | 'catalogs' | 'sparql';

declare module 'vue-router' {
  interface RouteMeta {
    tab?: Tab;
  }
}

// Alte Hash-Adressen (`#/verwalten`) auf den Pfad umschreiben, bevor der
// Router die Adresse liest — gespeicherte Links bleiben so gültig. Muss hier
// stehen und nicht in main.ts: Imports laufen zuerst, der Router entstünde
// sonst schon mit der alten Adresse.
if (window.location.hash.startsWith('#/')) {
  window.history.replaceState(null, '', window.location.hash.slice(1) || '/');
}

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'datasets', component: Empty, meta: { tab: 'datasets' } },
    { path: '/datasets', redirect: (to) => ({ name: 'datasets', query: to.query }) },
    { path: '/datasets/:id', name: 'dataset', component: Empty, meta: { tab: 'datasets' } },
    { path: '/services', name: 'services', component: Empty, meta: { tab: 'services' } },
    { path: '/catalogs', name: 'catalogs', component: Empty, meta: { tab: 'catalogs' } },
    { path: '/sparql', name: 'sparql', component: Empty, meta: { tab: 'sparql' } },
    { path: '/verwalten', name: 'admin', component: Empty },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  // Zurück/Vor landet wieder an der alten Stelle; ein neuer Pfad oben. Ändert
  // sich nur die Query — ein Filter —, bleibt die Seite, wo sie ist.
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition;
    if (to.path !== from.path) return { top: 0 };
    return false;
  },
});
