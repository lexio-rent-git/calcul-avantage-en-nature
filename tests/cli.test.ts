// Tests de l'interface en ligne de commande : on lance le vrai binaire et on
// vérifie la sortie sur les montants du README (eux-mêmes figés par les tests
// du moteur).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

const aen = (args: string[], entree?: string) =>
  spawnSync(process.execPath, [CLI, ...args], { input: entree, encoding: "utf8" });

const json = (args: string[]) => {
  const r = aen([...args, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test("calcul : berline achetée 25 000 € en 2026 = 3 750 € (15 %), 2 250 € sous l'ancien régime", () => {
  const r = aen(["calcul", "--annee", "2026", "--prix", "25000", "--attribution", "2026-01-01"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /AVANTAGE EN NATURE DU PARC\s+3\s750\s€/);
  assert.match(r.stdout, /avant-2025-02-01 : 2\s250\s€/);
});

test("calcul : LLD avec carburant, le plafond « location » ramène 8 040 € à 6 000 €", () => {
  const d = json(["calcul", "--mode", "location", "--carburant", "employeur-forfait", "--loyer", "9000",
    "--entretien", "500", "--assurance", "500", "--carburant-total", "2000", "--prix-loueur", "30000",
    "--attribution", "2026-01-01"]);
  assert.equal(d.totalAnnuel, 6000);
  assert.equal(Math.round(d.economiePlafond), 2040);
});

test("calcul : électrique éco-scoré 45 000 €, abattement au forfait puis au réel", () => {
  const forfait = json(["calcul", "--energie", "electrique", "--eco-score", "--prix", "45000", "--attribution", "2026-01-01"]);
  assert.equal(Math.round(forfait.totalAnnuel * 100) / 100, 2108.4);
  const reel = json(["calcul", "--energie", "electrique", "--eco-score", "--prix", "45000", "--methode", "reel",
    "--km-totaux", "20000", "--km-prives", "5000", "--attribution", "2026-01-01"]);
  assert.equal(reel.totalAnnuel, 1125);
});

test("parc : lecture JSON sur l'entrée standard", () => {
  const parc = JSON.stringify([
    { libelle: "Berline", mode: "achat", prixAchatTTC: 25000, dateAttribution: "2026-01-01" },
    { libelle: "Berline bis", mode: "achat", prixAchatTTC: 25000, dateAttribution: "2026-01-01" },
  ]);
  const r = aen(["parc", "-", "--annee", "2026", "--json"], parc);
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).totalAnnuel, 7500);
});

test("verifier : barèmes et cas de contrôle OK", () => {
  const r = aen(["verifier"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /aucune divergence/);
});

test("date d'attribution absente : refus, pas de régime deviné", () => {
  const r = aen(["calcul", "--prix", "25000"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--attribution est obligatoire/);
});

test("option invalide : code 2 et message explicite", () => {
  const r = aen(["calcul", "--attribution", "2026-01-01", "--mode", "leasing"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--mode « leasing » inconnu/);
});
