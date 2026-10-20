#!/usr/bin/env node
// Interface en ligne de commande du moteur d'avantage en nature véhicule.
// Aucune logique sociale ou fiscale ici : le fichier lit des options, appelle
// `calculerParc` ou `verifierBaremes`, et met le résultat en forme.
//
//   aen calcul --annee 2026 --mode achat --prix 25000 --attribution 2026-01-01
//   aen parc flotte.json
//   aen verifier

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  ANNEES,
  CARBURANTS,
  ENERGIES,
  METHODES,
  MODES,
  TRANCHES_AGE,
  USAGES_PRIVE,
  calculerParc,
  eur,
  normaliserVehicule,
  tsvParc,
  vehiculeVide,
  verifierBaremes,
  type Annee,
  type Evaluation,
  type ResultatParc,
  type Vehicule,
} from "./avantage-nature.ts";

// Sortie coupée par le lecteur (`cli … | head`) : on s'arrête proprement au lieu
// de lever une erreur EPIPE.
process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EPIPE") process.exit(0);
  throw e;
});

const VERSION_EN_LIGNE = "https://lexio.rent/outils/simulateur-avantage-en-nature-vehicule";

const ids = (t: ReadonlyArray<{ id: string }>): string => t.map((x) => x.id).join(" | ");
const ANNEES_IDS = ANNEES.map((a) => a.id) as readonly Annee[];

const AIDE = `Calcul de l'avantage en nature véhicule (salarié ou dirigeant assimilé salarié) :
forfait et réel, régimes avant et depuis le 1er février 2025, abattement électrique,
plafond « location », années ${ANNEES_IDS.join(" et ")}.

Usage
  aen calcul [options]          évalue un véhicule (ou N véhicules identiques)
  aen parc <fichier.json | ->   évalue un parc décrit en JSON (tableau de véhicules)
  aen verifier                  rejoue les barèmes et les cas de contrôle (BOSS, arrêtés)
  aen --help | --version

Options de « calcul »
  --annee <${ANNEES_IDS.join("|")}>           année évaluée (défaut : ${ANNEES_IDS[ANNEES_IDS.length - 1]})
  --attribution <AAAA-MM-JJ> date d'attribution au salarié (OBLIGATOIRE : elle fixe le régime)
  --restitution <AAAA-MM-JJ> date de restitution, si le véhicule a été rendu dans l'année
  --mode <m>                 ${ids(MODES)} (défaut : achat)
  --methode <m>              ${ids(METHODES)} (défaut : forfait)
  --energie <e>              ${ids(ENERGIES)} (défaut : thermique)
  --eco-score                véhicule électrique éligible à l'éco-score (abattement 70 % au forfait)
  --age <a>                  ${ids(TRANCHES_AGE)} (défaut : moins-5-ans)
  --usage <u>                ${ids(USAGES_PRIVE)}
  --prix <€>                 prix d'achat TTC (mode achat)
  --loyer <€>                loyer annuel TTC (mode location)
  --prix-loueur <€>          prix d'achat TTC communiqué par le loueur (plafond « location »)
  --entretien <€>            entretien annuel TTC (location)
  --assurance <€>            assurance annuelle TTC (location)
  --carburant <c>            ${ids(CARBURANTS)} (défaut : salarie)
  --carburant-prive <€>      carburant de l'usage privé payé par l'employeur, par an
  --carburant-total <€>      carburant total payé par l'employeur, par an
  --km-totaux <km>           kilomètres annuels (méthode réel)
  --km-prives <km>           dont kilomètres privés (méthode réel)
  --redevance <€>            participation mensuelle versée par le salarié
  --quantite <n>             nombre de véhicules identiques (défaut : 1)
  --libelle <texte>          libellé affiché

Options communes
  --json                     sortie JSON complète (résultat du moteur, trace comprise)
  --tsv                      sortie tabulée (calcul et parc), prête pour un tableur

Format JSON de « parc » : [{ "libelle": "Clio", "mode": "achat", "prixAchatTTC": 25000,
"dateAttribution": "2026-01-01" }, ...] ; champs du type Vehicule, valeurs absentes
remplacées par les valeurs par défaut, valeurs hors bornes ramenées dans les bornes.

Version en ligne, avec récapitulatif imprimable : ${VERSION_EN_LIGNE}
Code source (MIT) : https://github.com/lexio-rent-git/calcul-avantage-en-nature`;

function echec(message: string): never {
  process.stderr.write(`aen : ${message}\nAide : aen --help\n`);
  process.exit(2);
}

function enumeration<T extends string>(
  nom: string,
  brut: string | undefined,
  table: ReadonlyArray<{ id: T }>,
): T | undefined {
  if (brut === undefined) return undefined;
  if (!table.some((x) => x.id === brut)) echec(`--${nom} « ${brut} » inconnu (valeurs : ${ids(table)})`);
  return brut as T;
}

function nombre(nom: string, brut: string | undefined): number | undefined {
  if (brut === undefined) return undefined;
  const n = Number(brut.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) echec(`--${nom} attend un nombre positif, reçu « ${brut} »`);
  return n;
}

function date(nom: string, brut: string | undefined): string | undefined {
  if (brut === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(brut) || Number.isNaN(Date.parse(brut))) {
    echec(`--${nom} attend une date AAAA-MM-JJ, reçu « ${brut} »`);
  }
  return brut;
}

function annee(brut: string | undefined): Annee {
  if (brut === undefined) return ANNEES_IDS[ANNEES_IDS.length - 1];
  const a = Number(brut);
  if (!ANNEES_IDS.includes(a as Annee)) {
    echec(`--annee ${brut} non calculable (années couvertes : ${ANNEES_IDS.join(", ")})`);
  }
  return a as Annee;
}

function libelleEvaluation(e: Evaluation): string {
  const nom = e.methode === "reel" ? "réel" : `forfait${e.variante ? ` (${e.variante})` : ""}`;
  if (!e.disponible) return `${nom} : indisponible — ${e.motifIndisponible ?? "donnée manquante"}`;
  return `${nom} : ${eur(e.annuel)} sur la période, soit ${eur(e.mensuel)} par mois`;
}

function rendreParc(vehicules: readonly Vehicule[], parc: ResultatParc): string {
  const out: string[] = [];
  parc.lignes.forEach((l, i) => {
    const v = vehicules[i];
    const nom = v.libelle || `Véhicule ${i + 1}`;
    const statut =
      l.statut === "evalue" ? `évalué, régime ${l.regime}, ${l.mois} mois` :
      l.statut === "pas-d-avantage" ? "pas d'avantage en nature" : "non calculable";
    out.push(`${nom}${v.quantite > 1 ? ` × ${v.quantite}` : ""} : ${statut}`);
    if (l.motifStatut) out.push(`  ${l.motifStatut}`);
    for (const f of l.forfaits) out.push(`  ${libelleEvaluation(f)}`);
    if (l.reel) out.push(`  ${libelleEvaluation(l.reel)}`);
    if (l.retenu) out.push(`  → retenu : ${l.retenu.methode === "reel" ? "réel" : "forfait"}, ${eur(l.totalAnnuel)} (${eur(l.totalMensuel)} par mois)`);
    if (l.contrefactuel) out.push(`  (sous le régime ${l.contrefactuel.regime} : ${eur(l.contrefactuel.annuel)})`);
    for (const t of l.trace) out.push(`  · ${t.texte}`);
    for (const a of l.alertes) out.push(`  ⚠ ${a}`);
  });
  out.push("");
  out.push(`AVANTAGE EN NATURE DU PARC  ${eur(parc.totalAnnuel)} sur la période, ${eur(parc.totalMensuel)} par mois`);
  if (parc.economiePlafond > 0) out.push(`Plafond « location » appliqué : ${eur(parc.economiePlafond)} d'assiette évitée`);
  if (parc.nbPlafondsInverifiables > 0) {
    out.push(`⚠ ${parc.nbPlafondsInverifiables} plafond(s) invérifiable(s) : demandez au loueur le prix d'achat TTC du véhicule.`);
  }
  out.push("");
  out.push(`Récapitulatif imprimable et explications : ${VERSION_EN_LIGNE}`);
  return out.join("\n");
}

function sortie(vehicules: Vehicule[], an: Annee, json: boolean, tsv: boolean): void {
  const parc = calculerParc(vehicules, an);
  if (json) process.stdout.write(JSON.stringify({ annee: an, ...parc }, null, 2) + "\n");
  else if (tsv) process.stdout.write(tsvParc(vehicules, parc, an) + "\n");
  else process.stdout.write(rendreParc(vehicules, parc) + "\n");
}

function main(argv: string[]): void {
  const s = { type: "string" } as const;
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      json: { type: "boolean" },
      tsv: { type: "boolean" },
      "eco-score": { type: "boolean" },
      annee: s, attribution: s, restitution: s, mode: s, methode: s, energie: s, age: s,
      usage: s, prix: s, loyer: s, "prix-loueur": s, entretien: s, assurance: s,
      carburant: s, "carburant-prive": s, "carburant-total": s, "km-totaux": s,
      "km-prives": s, redevance: s, quantite: s, libelle: s,
    },
  });

  const [commande, ...reste] = positionals;
  if (values.version) {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    process.stdout.write(`${pkg.version}\n`);
    return;
  }
  if (values.help || commande === undefined || commande === "aide") {
    process.stdout.write(AIDE + "\n");
    return;
  }

  const an = annee(values.annee);

  if (commande === "verifier") {
    const divergences = verifierBaremes();
    if (divergences.length) {
      process.stderr.write(`${divergences.length} divergence(s) :\n${divergences.join("\n")}\n`);
      process.exit(1);
    }
    process.stdout.write("Barèmes et cas de contrôle : OK, aucune divergence.\n");
    return;
  }

  if (commande === "calcul") {
    if (values.attribution === undefined) {
      echec("--attribution est obligatoire : la date d'attribution au salarié fixe le régime applicable");
    }
    const brut: Record<string, unknown> = {
      ...vehiculeVide(an, "1"),
      libelle: values.libelle ?? "",
      dateAttribution: date("attribution", values.attribution),
      dateRestitution: date("restitution", values.restitution),
      mode: enumeration("mode", values.mode, MODES),
      methode: enumeration("methode", values.methode, METHODES),
      energie: enumeration("energie", values.energie, ENERGIES),
      ecoScore: values["eco-score"] ?? false,
      age: enumeration("age", values.age, TRANCHES_AGE),
      usagePrive: enumeration("usage", values.usage, USAGES_PRIVE),
      prixAchatTTC: nombre("prix", values.prix),
      loyerAnnuel: nombre("loyer", values.loyer),
      prixAchatLoueurTTC: nombre("prix-loueur", values["prix-loueur"]),
      entretienAnnuel: nombre("entretien", values.entretien),
      assuranceAnnuelle: nombre("assurance", values.assurance),
      carburant: enumeration("carburant", values.carburant, CARBURANTS),
      carburantPriveAnnuel: nombre("carburant-prive", values["carburant-prive"]),
      carburantTotalAnnuel: nombre("carburant-total", values["carburant-total"]),
      kmTotaux: nombre("km-totaux", values["km-totaux"]),
      kmPrives: nombre("km-prives", values["km-prives"]),
      redevanceMensuelle: nombre("redevance", values.redevance),
      quantite: nombre("quantite", values.quantite),
    };
    for (const k of Object.keys(brut)) if (brut[k] === undefined) delete brut[k];
    sortie([normaliserVehicule(brut, an, "1")], an, !!values.json, !!values.tsv);
    return;
  }

  if (commande === "parc") {
    const source = reste[0];
    if (!source) echec("« parc » attend un fichier JSON (ou « - » pour l'entrée standard)");
    let donnees: unknown;
    try {
      donnees = JSON.parse(readFileSync(source === "-" ? 0 : source, "utf8"));
    } catch (e) {
      echec(`lecture de « ${source} » impossible : ${(e as Error).message}`);
    }
    if (!Array.isArray(donnees) || donnees.length === 0) echec("le JSON doit être un tableau non vide de véhicules");
    const vehicules = donnees.map((u, i) => normaliserVehicule(u, an, String(i + 1)));
    sortie(vehicules, an, !!values.json, !!values.tsv);
    return;
  }

  echec(`commande « ${commande} » inconnue`);
}

try {
  main(process.argv.slice(2));
} catch (e) {
  echec((e as Error).message);
}
