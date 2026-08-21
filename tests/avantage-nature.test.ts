// Tests du moteur de calcul de l'avantage en nature véhicule.
//
// Deux étages :
//  1. On rejoue l'autotest embarqué dans le module : `verifierBaremes()` vérifie
//     la cohérence structurelle des grilles, la revalorisation des plafonds et
//     rejoue les 37 cas de contrôle de `CAS_DE_CONTROLE` (dont les exemples
//     officiels du BOSS) avec les vraies fonctions de calcul.
//  2. Quatre scénarios réalistes indépendants, dont les montants ont été figés
//     après exécution sous Node v24 : chaque assertion est accompagnée du
//     calcul attendu, refaisable à la main.
//
// Le moteur n'arrondit jamais (voir CONVENTIONS.arrondi) : les comparaisons de
// montants passent par une égalité au centime près pour absorber le flottant
// IEEE 754 (ex. 0.67 × 12 000 = 8 040.000000000001).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CAS_DE_CONTROLE,
  evaluerCas,
  verifierBaremes,
  vehiculeVide,
  evaluerForfait,
  evaluerReel,
  abattementElectrique,
  regimeDe,
  PLAFONDS,
  type Vehicule,
} from "../src/index.ts";

/** Égalité au centime près : le moteur conserve les montants au centime et
    n'arrondit qu'à l'affichage. */
function memeMontant(obtenu: number, attendu: number, message: string): void {
  assert.ok(
    Math.abs(obtenu - attendu) <= 0.005,
    `${message} — attendu ${attendu}, obtenu ${obtenu}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Autotest embarqué du module
// ─────────────────────────────────────────────────────────────────────────────

test("verifierBaremes() ne signale aucune divergence", () => {
  assert.deepEqual(verifierBaremes(), []);
});

test("les 37 cas de contrôle embarqués (dont les exemples officiels du BOSS) sont rejoués un par un", () => {
  assert.equal(CAS_DE_CONTROLE.length, 37);
  for (const cas of CAS_DE_CONTROLE) {
    const obtenu = evaluerCas(cas);
    const tolerance = cas.tolerance ?? 0.005;
    assert.ok(
      Math.abs(obtenu - cas.attendu) <= tolerance,
      `${cas.intitule} : attendu ${cas.attendu}, obtenu ${obtenu} (${cas.source})`,
    );
  }
});

test("au moins quatre cas de contrôle sont des exemples officiels publiés par le BOSS", () => {
  assert.ok(CAS_DE_CONTROLE.filter((c) => c.officiel).length >= 4);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Scénarios réalistes
// ─────────────────────────────────────────────────────────────────────────────

/** Véhicule de base : les champs non précisés restent ceux du modèle vide. */
function vehicule(patch: Partial<Omit<Vehicule, "id">>): Vehicule {
  return { ...vehiculeVide(2026, "test"), ...patch };
}

test("scénario 1 — thermique acheté 25 000 €, moins de 5 ans, forfait : l'écart entre les deux régimes vaut 1 500 €/an", () => {
  const v = vehicule({
    mode: "achat",
    methode: "forfait",
    energie: "thermique",
    age: "moins-5-ans",
    prixAchatTTC: 25000,
    dateAttribution: "2026-01-01",
  });

  // Ancienne grille (véhicule attribué au salarié avant le 1er février 2025,
  // rejouée ici en contrefactuel) : 9 % × 25 000 = 2 250 €/an, 187,50 €/mois.
  const avant = evaluerForfait(v, 2026, "avant-2025-02-01", "sans-carburant");
  assert.ok(avant.disponible);
  assert.equal(avant.taux, 0.09);
  memeMontant(avant.annuel, 2250, "annuel ancienne grille");
  memeMontant(avant.mensuel, 187.5, "mensuel ancienne grille");

  // Nouvelle grille (arrêté du 25 février 2025, attribution à compter du
  // 1er février 2025) : 15 % × 25 000 = 3 750 €/an, 312,50 €/mois.
  const depuis = evaluerForfait(v, 2026, "depuis-2025-02-01", "sans-carburant");
  assert.ok(depuis.disponible);
  assert.equal(depuis.taux, 0.15);
  memeMontant(depuis.annuel, 3750, "annuel nouvelle grille");
  memeMontant(depuis.mensuel, 312.5, "mensuel nouvelle grille");

  // L'arrêté du 25 février 2025 renchérit ce dossier de 1 500 € d'assiette/an.
  memeMontant(depuis.annuel - avant.annuel, 1500, "écart entre régimes");

  // Le régime se déduit de la SEULE date d'attribution au salarié (BOSS §770).
  assert.equal(regimeDe("2025-01-31"), "avant-2025-02-01");
  assert.equal(regimeDe("2025-02-01"), "depuis-2025-02-01");
  assert.equal(regimeDe(""), null);
});

test("scénario 2 — LLD avec carburant (forfait global majoré 67 %) : le plafond « achat » du BOSS §890 mord", () => {
  // Coût global annuel : loyer 9 000 + entretien 500 + assurance 500
  // + carburant pro et perso 2 000 = 12 000 €.
  const v = vehicule({
    mode: "location",
    methode: "forfait",
    carburant: "employeur-forfait",
    loyerAnnuel: 9000,
    entretienAnnuel: 500,
    assuranceAnnuelle: 500,
    carburantTotalAnnuel: 2000,
    prixAchatLoueurTTC: 30000,
    age: "moins-5-ans",
    dateAttribution: "2026-01-01",
  });

  const e = evaluerForfait(v, 2026, "depuis-2025-02-01", "carburant-forfait-global");
  assert.ok(e.disponible);

  // Forfait global majoré : 67 % × 12 000 = 8 040 €.
  memeMontant(e.assiette, 12000, "coût global annuel");
  assert.equal(e.taux, 0.67);
  memeMontant(e.base, 8040, "base forfaitaire avant plafond");

  // Plafond : montant qui aurait été retenu à l'achat, sur la base du prix
  // d'achat TTC payé par le loueur (30 000 €), au taux « achat » de la même
  // configuration carburant : 20 % × 30 000 = 6 000 €. Il mord.
  memeMontant(e.plafond ?? NaN, 6000, "plafond BOSS §890");
  assert.equal(e.plafondApplique, true);
  memeMontant(e.annuel, 6000, "avantage annuel plafonné");
  memeMontant(e.mensuel, 500, "avantage mensuel");
  // Assiette réellement évitée grâce à l'information du loueur : 2 040 €/an.
  memeMontant(e.economiePlafond, 2040, "assiette évitée par le plafonnement");

  // Sans le prix d'achat du loueur, le plafonnement est invérifiable et
  // l'employeur déclarerait 8 040 € : c'est le trou que ce moteur documente.
  const muet = evaluerForfait(
    { ...v, prixAchatLoueurTTC: 0 },
    2026,
    "depuis-2025-02-01",
    "carburant-forfait-global",
  );
  assert.equal(muet.plafond, null);
  memeMontant(muet.annuel, 8040, "avantage sans plafond vérifiable");
});

test("scénario 3 — électrique 45 000 € éco-scoré au forfait : abattement de 70 % ramené au plafond 2026 de 4 641,60 €", () => {
  const v = vehicule({
    mode: "achat",
    methode: "forfait",
    energie: "electrique",
    ecoScore: true,
    age: "moins-5-ans",
    prixAchatTTC: 45000,
    dateAttribution: "2026-01-01",
  });

  const e = evaluerForfait(v, 2026, "depuis-2025-02-01", "sans-carburant");
  assert.ok(e.disponible);

  // 15 % × 45 000 = 6 750 € ; abattement théorique 70 % = 4 725 €, ramené au
  // plafond annuel 2026 de 4 641,60 € ; avantage = 6 750 − 4 641,60 = 2 108,40 €.
  memeMontant(e.base, 6750, "base forfaitaire");
  assert.equal(e.abattementTaux, 0.7);
  assert.equal(e.abattementPlafond, PLAFONDS[2026].abattement70);
  memeMontant(e.abattement, 4641.6, "abattement plafonné");
  memeMontant(e.annuel, 2108.4, "avantage annuel");

  // Appel direct d'abattementElectrique sur la même base : 70 % de 6 750
  // = 4 725 > 4 641,60, donc le plafond s'applique.
  const abat = abattementElectrique(v, "depuis-2025-02-01", "forfait", 6750, 2026);
  assert.equal(abat.taux, 0.7);
  assert.equal(abat.plafond, 4641.6);
  memeMontant(abat.montant, 4641.6, "abattement direct");
});

test("scénario 4 — le même électrique évalué au réel ne garde qu'un abattement de 50 % : le piège n° 1 de la réforme", () => {
  const v = vehicule({
    mode: "achat",
    methode: "reel",
    energie: "electrique",
    ecoScore: true,
    age: "moins-5-ans",
    prixAchatTTC: 45000,
    kmTotaux: 20000,
    kmPrives: 5000,
    dateAttribution: "2026-01-01",
  });

  const e = evaluerReel(v, 2026, "depuis-2025-02-01");
  assert.ok(e.disponible);

  // Dépenses réelles : amortissement 20 % × 45 000 = 9 000 € (ni assurance ni
  // entretien saisis) ; quote-part privée 5 000 / 20 000 = 25 % → 2 250 € ;
  // abattement de 50 % AU RÉEL (et non 70 %) = 1 125 €, sous le plafond de
  // 2 026,30 € ; avantage = 1 125 €.
  memeMontant(e.assiette, 9000, "dépenses réelles annuelles");
  assert.equal(e.taux, 0.25);
  memeMontant(e.base, 2250, "quote-part privée");
  assert.equal(e.abattementTaux, 0.5);
  assert.equal(e.abattementPlafond, PLAFONDS[2026].abattement50);
  memeMontant(e.abattement, 1125, "abattement 50 % non plafonné");
  memeMontant(e.annuel, 1125, "avantage annuel au réel");

  // Vérification directe du couple taux/plafond au réel.
  const abat = abattementElectrique(v, "depuis-2025-02-01", "reel", 2250, 2026);
  assert.equal(abat.taux, 0.5);
  assert.equal(abat.plafond, 2026.3);
  memeMontant(abat.montant, 1125, "abattement direct au réel");
});
