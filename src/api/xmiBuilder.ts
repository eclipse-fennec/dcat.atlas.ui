/**
 * Baut Schreib-Nutzdaten im XMI-Format der DCAT.Atlas-API.
 *
 * **Warum von Hand und nicht über EMFTS?** Der XMI-Writer von EMFTS erzeugt für
 * diese Ecores die RDF/XML-artige Form (`<ns:title xml:lang="de">Text</ns:title>`,
 * `rdf:about`), der Server erwartet aber die flache EMF-Form
 * (`<title lang="de" value="Text"/>`, `about`). Gelesen wird beides korrekt,
 * geschrieben nur die flache — der Server quittiert die andere mit 500. Keine
 * der Save-Optionen ändert daran etwas (geprüft am 31.08.2026). Bis das in
 * emf.ts behoben ist, ist ein eigener Builder der ehrlichere Weg: er erzeugt
 * genau die Formen, die der User-Guide beschreibt, und nichts sonst.
 *
 * Die Regeln aus dem Guide, die er umsetzt:
 *   - Identität              -> `about`-Attribut auf dem Wurzelelement
 *   - Text mit Sprache       -> `<title lang="de" value="…"/>`
 *   - URI-wertig             -> `<theme>http://…</theme>`, wiederholt
 *   - einwertig URI-wertig   -> auch als Attribut erlaubt (`homepage`, `format`)
 *   - Datum                  -> `<issued value="…"/>`
 *   - verschachteltes Objekt -> Element mit eigenem `about`, ohne Wrapper
 * Property-Elemente sind **unpräfixiert**, nur die Wurzel trägt `dcat:`.
 */

/** Ein mehrsprachiger Text. `lang` weglassen für ein Literal ohne Sprache. */
export interface LangText {
  value: string;
  lang?: string;
}

export type XmiPart =
  /** `<title lang="de" value="…"/>`, einmal je Eintrag. */
  | { kind: 'literal'; name: string; values: LangText[] }
  /** `<theme>http://…</theme>`, einmal je Eintrag. */
  | { kind: 'iri'; name: string; values: string[] }
  /** `<issued value="2026-…"/>` */
  | { kind: 'date'; name: string; value: string }
  /** Attribut am umgebenden Element, für einwertige URI-Properties. */
  | { kind: 'attr'; name: string; value: string }
  /** Verschachteltes Objekt: `<publisher about="…"><name …/></publisher>` */
  | { kind: 'object'; name: string; about?: string; parts: XmiPart[] }
  /** Reines Textelement, etwa `<fn>Open-Data-Team</fn>` (vcard `fn` ist String). */
  | { kind: 'text'; name: string; values: string[] };

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};
const escape = (s: string) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Steuerzeichen entfernen — sie machen das Dokument sonst unparsbar. */
const clean = (s: string) =>
  String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

const attr = (name: string, value: string) => ` ${name}="${escape(clean(value))}"`;

/** Die `attr`-Teile einer Ebene, die ans umgebende Element gehören. */
function attrsOf(parts: XmiPart[]): string {
  return parts
    .filter((p): p is Extract<XmiPart, { kind: 'attr' }> => p.kind === 'attr')
    .filter((p) => p.value.trim())
    .map((p) => attr(p.name, p.value))
    .join('');
}

function renderParts(parts: XmiPart[], indent: string): string {
  const out: string[] = [];
  for (const part of parts) {
    switch (part.kind) {
      case 'attr':
        break; // gehört ans Elternelement, siehe attrsOf
      case 'literal':
        for (const t of part.values) {
          if (!t.value.trim()) continue;
          const lang = t.lang ? attr('lang', t.lang) : '';
          out.push(`${indent}<${part.name}${lang}${attr('value', t.value)}/>`);
        }
        break;
      case 'iri':
      case 'text':
        for (const v of part.values) {
          if (!v.trim()) continue;
          out.push(`${indent}<${part.name}>${escape(clean(v))}</${part.name}>`);
        }
        break;
      case 'date':
        if (part.value.trim()) out.push(`${indent}<${part.name}${attr('value', part.value)}/>`);
        break;
      case 'object': {
        const inner = renderParts(part.parts, indent + '  ');
        const about = part.about?.trim() ? attr('about', part.about) : '';
        const extra = attrsOf(part.parts);
        // Ein Objekt ohne Inhalt und ohne Identität sagt nichts — weglassen.
        if (!inner && !about && !extra) break;
        out.push(
          inner
            ? `${indent}<${part.name}${about}${extra}>\n${inner}\n${indent}</${part.name}>`
            : `${indent}<${part.name}${about}${extra}/>`
        );
        break;
      }
    }
  }
  return out.filter(Boolean).join('\n');
}

/**
 * Ein Schreib-Dokument. `about` weglassen, damit der Server eine Id vergibt —
 * eine mitgegebene muss unter der öffentlichen Basis oder unter der host-freien
 * Form `http://dcat.atlas/…` liegen, sonst antwortet die API mit 400.
 */
export function buildXmi(rootType: string, about: string | undefined, parts: XmiPart[]): string {
  const body = renderParts(parts, '  ');
  const rootAbout = about?.trim() ? attr('about', about) : '';
  const open =
    `<dcat:${rootType} xmlns:xmi="http://www.omg.org/XMI" xmlns:dcat="http://www.w3.org/ns/dcat#"\n` +
    `    xmi:version="2.0"${rootAbout}${attrsOf(parts)}>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${open}\n${body}\n</dcat:${rootType}>\n`;
}
