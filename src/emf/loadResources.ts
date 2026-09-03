/**
 * Bootstrap des EMF-Modellstands für den DCAT.Atlas-Client.
 *
 * Geladen werden nur noch die Metamodelle (Ecore) und das UIModel — die
 * Instanzdaten kommen zur Laufzeit aus der DCAT.Atlas-REST-API
 * (siehe `src/api/dcatAtlas.ts`) und nicht mehr aus einer statischen Datei.
 *
 * Die Ecore-Dateien sind bitgleiche Kopien aus
 * `org.eclipse.fennec.dcat.atlas.dcatap.de.model/model` — nur so passen die
 * EClasses zu dem XMI, das der Server ausliefert.
 */
import {
  BasicResourceSet,
  XMIResourceFactory,
  XMIResource,
  EPackageRegistry,
  registerEcorePackage,
  URI,
  OPTION_EXTENDED_META_DATA,
} from '@emfts/core';
import type { EObject, EPackage } from '@emfts/core';
import { UimodelPackage, UimodelFactory } from '@emfts/uimodel-composer';

export interface ModelContext {
  /** ResourceSet mit allen registrierten EPackages — Basis für API-Antworten. */
  resourceSet: BasicResourceSet;
  /** XMI-Ladeoptionen (ExtendedMetaData), auch von der API-Schicht genutzt. */
  loadOptions: Map<string, any>;
  /**
   * Die UIModel-Wurzeln als EObject. Nicht als `UIModel` typisiert: der
   * Composer bringt eine eigene Kopie von `@emfts/core` mit, deren Typen mit
   * denen hier nicht identisch sind — zur Laufzeit ist es dasselbe Modell.
   */
  uiModels: EObject[];
}

async function fetchXml(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status} beim Laden von ${path}`);
  return res.text();
}

/**
 * Ecore-Dateien mit ihren nsURIs, Abhängigkeiten zuerst.
 *
 * Jede Resource wird unter ihrem Dateinamen angelegt, damit Cross-Referenzen
 * wie `rdf.ecore#//PlainLiteral` aufgelöst werden, und das EPackage zusätzlich
 * unter seiner nsURI registriert.
 */
const ECORE_MODELS: Array<{ file: string; nsURI: string }> = [
  { file: 'rdf.ecore',    nsURI: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#' },
  { file: 'rdfs.ecore',   nsURI: 'http://www.w3.org/2000/01/rdf-schema#' },
  { file: 'locn.ecore',   nsURI: 'http://www.w3.org/ns/locn#' },
  { file: 'odrl.ecore',   nsURI: 'http://www.w3.org/ns/odrl/2/' },
  { file: 'owl.ecore',    nsURI: 'http://www.w3.org/2002/07/owl#' },
  { file: 'prov.ecore',   nsURI: 'http://www.w3.org/ns/prov#' },
  { file: 'schema.ecore', nsURI: 'http://schema.org/' },
  { file: 'adms.ecore',   nsURI: 'http://www.w3.org/ns/adms#' },
  { file: 'foaf.ecore',   nsURI: 'http://xmlns.com/foaf/0.1/' },
  { file: 'spdx.ecore',   nsURI: 'http://spdx.org/rdf/terms#' },
  { file: 'terms.ecore',  nsURI: 'http://purl.org/dc/terms/' },
  { file: 'vcard.ecore',  nsURI: 'http://www.w3.org/2006/vcard/ns#' },
  { file: 'dcatap.ecore', nsURI: 'http://www.w3.org/ns/dcat#' },
  // Der Umschlag, in dem Sammlungsantworten kommen — siehe `unwrapResponse`
  // in `src/api/dcatAtlas.ts`.
  { file: 'utilities.ecore', nsURI: 'https://org.eclipse/fennec/utils/1.0' },
];

export async function loadModels(): Promise<ModelContext> {
  // 1. Ecore- und XMLType-Basis registrieren
  registerEcorePackage();

  // 2. UIModel-Package registrieren
  const uimodelPkg = UimodelPackage.eINSTANCE;
  uimodelPkg.setEFactoryInstance(UimodelFactory.eINSTANCE);
  EPackageRegistry.INSTANCE.set(uimodelPkg.getNsURI()!, uimodelPkg as unknown as EPackage);

  // 3. ResourceSet + XMI-Factory.
  //    Die Factory hängt zusätzlich an den Protokollen http/https, weil
  //    API-Antworten unter ihrer Request-URL als Resource abgelegt werden und
  //    die keine `.xmi`-Endung trägt.
  const rs = new BasicResourceSet();
  const xmiFactory = new XMIResourceFactory();
  const factories = rs.getResourceFactoryRegistry();
  factories.getExtensionToFactoryMap().set('xmi', xmiFactory);
  factories.getExtensionToFactoryMap().set('ecore', xmiFactory);
  factories.getProtocolToFactoryMap().set('http', xmiFactory);
  factories.getProtocolToFactoryMap().set('https', xmiFactory);

  const options = new Map<string, any>();
  options.set(OPTION_EXTENDED_META_DATA, true);

  // 4. Ecore-Dateien parallel holen, sequentiell laden (Abhängigkeitsreihenfolge)
  const ecoreXmls = await Promise.all(
    ECORE_MODELS.map((m) => fetchXml(`/model/${m.file}`))
  );

  for (let i = 0; i < ECORE_MODELS.length; i++) {
    const { file, nsURI } = ECORE_MODELS[i];
    const resource = rs.createResource(URI.createURI(file)) as XMIResource;
    resource.loadFromString(ecoreXmls[i], options);

    if (resource.getErrors().length > 0) {
      console.warn(`Warnungen beim Laden von ${file}:`, resource.getErrors());
    }

    for (const content of resource.getContents()) {
      const pkg = content as EPackage;
      const pkgNsURI = pkg.getNsURI?.() ?? nsURI;
      EPackageRegistry.INSTANCE.set(pkgNsURI, pkg);
      rs.getPackageRegistry().set(pkgNsURI, pkg);
    }
  }

  // 5. UIModel laden
  const uimodelXml = await fetchXml('/model/dcatap-uimodel.xmi');
  const uimodelResource = rs.createResource(
    URI.createURI('/model/dcatap-uimodel.xmi')
  ) as XMIResource;
  uimodelResource.loadFromString(uimodelXml);

  if (uimodelResource.getErrors().length > 0) {
    console.warn('Fehler beim Laden des UIModels:', uimodelResource.getErrors());
  }

  const uiModels = Array.from(uimodelResource.getContents());

  return { resourceSet: rs, loadOptions: options, uiModels };
}
