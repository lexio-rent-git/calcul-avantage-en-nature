# Calcul de l'avantage en nature véhicule

Développé et maintenu par [Lexio](https://lexio.rent), le logiciel de location de voiture et d'utilitaire pour loueurs professionnels.

Moteur de calcul TypeScript **pur et sans dépendance** de l'avantage en nature « véhicule » : l'évaluation de l'usage privé d'un véhicule mis à disposition d'un salarié, pour l'assiette des cotisations de sécurité sociale (URSSAF / DSN).

## Ce que fait cette bibliothèque

- **Évaluation forfaitaire et évaluation au réel** (dépenses réellement engagées, quote-part kilométrique privée), avec la trace de calcul complète, ligne par ligne, sourcée article par article (BOSS, arrêtés).
- **Les deux régimes de barème issus de l'arrêté du 25 février 2025**, qui coexistent durablement : le régime applicable dépend de la **date d'attribution du véhicule au salarié** (BOSS §770), pas de l'année de calcul ni de la date d'achat. Véhicule attribué jusqu'au 31 janvier 2025 : 9 % / 6 % à l'achat, 30 % / 40 % en location. Attribué à compter du 1er février 2025 : 15 % / 10 % à l'achat, 50 % / 67 % en location.
- **Achat et location (LLD / LOA)**, y compris la règle la plus mal traitée par les simulateurs en ligne : le **plafonnement du forfait du véhicule loué** au montant qui aurait été retenu à l'achat, sur la base du prix d'achat TTC payé par le loueur (BOSS §890) — information que le BOSS met à la charge du loueur.
- **Abattement du véhicule 100 % électrique**, plafonné en euros : 50 % dans le régime antérieur ; 50 % au réel mais 70 % au forfait dans le régime postérieur, sous condition d'éco-score.
- **Bornes de recharge** (avantage distinct, BOSS §930) : avantage négligé, exclusions de 50 % ou 75 % plafonnées, selon la situation.
- **Prorata mensuel** (tout mois commencé compte pour un mois entier), tolérance congés en semaines, redevance versée par le salarié, employeur du secteur automobile (rabais écrêté à 30 %), calcul d'un parc entier avec agrégats et export tableur (TSV).
- **Années couvertes** : les plafonds en euros sont publiés pour **2025 et 2026** (constante `ANNEES`). Les taux ne sont pas indexés ; seuls les montants en euros sont revalorisés chaque 1er janvier. L'année 2027 est volontairement absente : ses plafonds ne sont pas publiés, et le typage rend une année non publiée structurellement incalculable.
- **Autotest embarqué** : `verifierBaremes()` rejoue 37 cas de contrôle (`CAS_DE_CONTROLE`), dont des exemples chiffrés officiels du BOSS, avec les vraies fonctions de calcul.

Le moteur produit une **assiette sociale**. Il ne produit délibérément aucun montant d'impôt sur le revenu (voir [Limites](#limites)).

## ⚡ Version en ligne

> Le simulateur complet, avec interface de saisie, comparaison forfait / réel, contrefactuel avant / après réforme et récapitulatif imprimable, est utilisable gratuitement ici :
> **<https://lexio.rent/outils/simulateur-avantage-en-nature-vehicule>**

## Installation

Nécessite Node ≥ 22.18 (exécution native du TypeScript par type stripping — aucune étape de compilation).

```bash
npm install github:lexio-rent-git/calcul-avantage-en-nature
# ou en local :
git clone https://github.com/lexio-rent-git/calcul-avantage-en-nature
```

## Exemple d'usage

```ts
import {
  vehiculeVide,
  evaluerForfait,
  evaluerReel,
  regimeDe,
} from "@lexio/calcul-avantage-en-nature";

// ── 1. Berline thermique achetée 25 000 € TTC, moins de 5 ans, forfait ──
const berline = {
  ...vehiculeVide(2026, "berline"),
  mode: "achat" as const,
  methode: "forfait" as const,
  prixAchatTTC: 25000,
  dateAttribution: "2026-01-01",
};

// Le régime se déduit de la SEULE date d'attribution au salarié :
regimeDe("2025-01-31"); // "avant-2025-02-01"
regimeDe("2025-02-01"); // "depuis-2025-02-01"

// L'effet de l'arrêté du 25 février 2025 sur ce dossier :
const ancien = evaluerForfait(berline, 2026, "avant-2025-02-01", "sans-carburant");
const nouveau = evaluerForfait(berline, 2026, "depuis-2025-02-01", "sans-carburant");
ancien.annuel;  // 2 250 €  (9 % × 25 000)
nouveau.annuel; // 3 750 €  (15 % × 25 000)
// → la réforme renchérit ce véhicule de 1 500 € d'assiette par an.

// ── 2. LLD avec carburant payé par l'employeur (forfait global majoré) ──
const lld = {
  ...vehiculeVide(2026, "lld"),
  mode: "location" as const,
  methode: "forfait" as const,
  carburant: "employeur-forfait" as const,
  loyerAnnuel: 9000,
  entretienAnnuel: 500,
  assuranceAnnuelle: 500,
  carburantTotalAnnuel: 2000,
  prixAchatLoueurTTC: 30000, // communiqué par le loueur (BOSS §890)
  dateAttribution: "2026-01-01",
};
const evalLld = evaluerForfait(lld, 2026, "depuis-2025-02-01", "carburant-forfait-global");
evalLld.base;    // 8 040 €  (67 % × 12 000 de coût global)
evalLld.plafond; // 6 000 €  (20 % × 30 000 : forfait « achat » équivalent)
evalLld.annuel;  // 6 000 €  → le plafond mord : 2 040 € d'assiette évités
// Sans le prix d'achat du loueur, le plafond est invérifiable
// et l'employeur déclarerait 8 040 €.

// ── 3. Électrique éco-scoré 45 000 € : 70 % d'abattement au forfait… ──
const ev = {
  ...vehiculeVide(2026, "ev"),
  mode: "achat" as const,
  methode: "forfait" as const,
  energie: "electrique" as const,
  ecoScore: true,
  prixAchatTTC: 45000,
  dateAttribution: "2026-01-01",
};
evaluerForfait(ev, 2026, "depuis-2025-02-01", "sans-carburant").annuel;
// 2 108,40 €  (15 % × 45 000 = 6 750, abattement 70 % plafonné à 4 641,60)

// ── …mais seulement 50 % au réel : le piège n° 1 de la réforme ──
const evReel = { ...ev, methode: "reel" as const, kmTotaux: 20000, kmPrives: 5000 };
evaluerReel(evReel, 2026, "depuis-2025-02-01").annuel;
// 1 125 €  (amortissement 20 % × 45 000 = 9 000, quote-part 25 % = 2 250,
//           abattement 50 % — et non 70 % — sous le plafond de 2 026,30)
```

Toutes les fonctions sont **pures** : mêmes entrées, mêmes sorties, aucun accès au DOM ni à un stockage. Chaque `Evaluation` retournée porte sa trace de calcul (`trace`), rejouables telles quelles sur un document de contrôle.

## API

Fonctions principales (la totalité des barèmes, énumérations, notes éditoriales et types est également exportée) :

| Fonction | Rôle |
|---|---|
| `evaluerForfait(vehicule, annee, regime, variante)` | Évaluation forfaitaire d'une variante (sans carburant, frais réels, forfait global majoré), plafonnement location compris. |
| `evaluerReel(vehicule, annee, regime)` | Évaluation sur les dépenses réellement engagées (amortissement ou coût de location, quote-part kilométrique privée). |
| `abattementElectrique(vehicule, regime, methode, montant, annee)` | Abattement du véhicule 100 % électrique : taux, plafond en euros et montant retenu. |
| `regimeDe(dateAttribution)` | Régime de barème déduit de la date d'attribution au salarié (`null` si la date est illisible : aucun repli). |
| `coutAchatRetenu(vehicule)` | Coût d'achat servant d'assiette : prix TTC moins reprise, ou prix public moins rabais écrêté à 30 % (secteur automobile). |
| `plafondForfaitLocation(vehicule, regime, variante)` | Plafond du forfait d'un véhicule loué : forfait « achat » équivalent sur le prix payé par le loueur (BOSS §890). |
| `prixReferencePlafond(vehicule)` | Prix de référence du plafonnement : prix loueur, à défaut prix conseillé constructeur, à défaut « inconnu ». |
| `calculerVehicule(vehicule, annee)` | Une ligne complète : statut, forfaits, réel, écart forfait / réel, contrefactuel sous l'autre grille, alertes de saisie. |
| `calculerParc(vehicules, annee)` | Agrégats d'un parc : totaux, assiette évitée par le plafonnement, plafonds invérifiables, lignes comparables. |
| `evaluerBorne(borne, annee)` | Avantage distinct des bornes de recharge (BOSS §930) : négligé, exclusion 50 % / 75 % plafonnée, ou intégral. |
| `moisMisADisposition(attribution, restitution, annee)` | Mois retenus dans l'année, tout mois commencé comptant pour un mois entier (BOSS §750). |
| `trancheAgeSuggeree(origine, reference)` / `dateSeuilAge(origine)` | Seuil des cinq ans : tranche suggérée par une date, et date de franchissement. |
| `vehiculeVide(annee, id)` / `normaliserVehicule(brut, annee, id)` | Modèle de saisie vide, et relecture défensive d'une saisie non fiable. |
| `verifierBaremes()` | Autotest complet : cohérence des grilles, revalorisation des plafonds, rejeu des 37 `CAS_DE_CONTROLE`. Retourne la liste des divergences (vide si tout passe). |
| `tsvParc(vehicules, parc, annee)` | Export tableur (TSV, montants en nombres bruts, séparateur décimal virgule). |

Données exportées notables : `TAUX_FORFAIT_ACHAT`, `TAUX_FORFAIT_LOCATION`, `AMORTISSEMENT_REEL`, `PLAFONDS`, `ELECTRIQUE`, `REGLES_BORNE`, `ANNEES`, `BASCULE_REGIME`, `CONVENTIONS`, `POINTS_A_LEVER`, `CAS_DE_CONTROLE`, `META`.

## Sources officielles

Chaque taux, plafond et règle du module porte sa source (`SourceRef`), son article et son statut (« vérifié » ou « déduit ») :

- **Arrêté du 25 février 2025** relatif à l'évaluation des avantages en nature pour le calcul des cotisations de sécurité sociale — <https://www.legifrance.gouv.fr/loda/id/JORFTEXT000051254024>
- **BOSS** — Bulletin officiel de la Sécurité sociale, rubrique « Avantages en nature », chapitre 4 (véhicule) — <https://boss.gouv.fr/portail/accueil/autres-elements-de-remuneration/avantages-en-nature.html>
- **Arrêté du 14 décembre 2023** fixant la liste des versions de voitures particulières électriques ayant atteint le score environnemental minimal (condition d'éco-score) — <https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000048567223>
- **BOSS** — rubrique « Assiette générale » (abattement d'assiette CSG de 1,75 %) — <https://boss.gouv.fr/portail/accueil/regles-dassujettissement/assiette-generale.html>
- **BOFiP**, BOI-RSA-BASE-20-20 (évaluation des avantages en nature pour l'impôt sur le revenu), version du 16 avril 2024 — <https://bofip.impots.gouv.fr/bofip/2398-PGP.html>
- **BOFiP**, BOI-ANNX-000056 (tableau récapitulatif véhicule), version du 1er juin 2023 — <https://bofip.impots.gouv.fr/bofip/2469-PGP.html>

L'ancien barème (9 / 6 / 30 / 40 %) reste par ailleurs celui de l'arrêté du 10 décembre 2002, que l'arrêté du 25 février 2025 reprend et modifie (art. 3, III, A et B).

## Limites

- **Assiette sociale uniquement.** La doctrine fiscale publiée (BOFiP) n'a pas été actualisée de l'arrêté du 25 février 2025 : elle énonce encore les anciens taux et un plafond d'abattement électrique de 1 800 €. Aucun montant étiqueté « impôt sur le revenu » n'est produit, et aucune cotisation n'est calculée : le moteur produit une assiette.
- **La liste éco-score n'est pas embarquée.** Elle est révisée par arrêtés modificatifs publiés au Journal officiel ; la figer ici la rendrait périmée dès la publication suivante. La question est posée à l'appelant, l'arrêté fondateur est cité en source.
- **Plafonds publiés pour 2025 et 2026 seulement.** L'année 2027 est structurellement incalculable tant que ses montants revalorisés ne sont pas publiés. Le régime électrique renforcé et le régime des bornes sont bornés au 31 décembre 2027, sans prorogation publiée à ce jour.
- **Les points que le BOSS ne tranche pas sont déclarés, pas devinés.** Les conventions retenues (ordre plafonnement → prorata → abattement → redevance, non-proratisation du plafond d'abattement, taux « achat » de référence du plafonnement, référence du seuil des cinq ans…) sont exportées dans `CONVENTIONS` et `POINTS_A_LEVER`, avec leur justification. Le forfait de l'employeur du secteur automobile est volontairement refusé (BOSS §760 non actualisé) ; seule son évaluation au réel est produite.
- **Cas non couverts** : réintégration des frais d'électricité d'un hybride rechargeable (signalée, non calculée), moyenne des prix pour plusieurs véhicules mis à disposition d'un même salarié (saisir directement les valeurs moyennes), découpage de l'année lorsqu'un véhicule intègre la liste éco-score en cours de période (saisir deux lignes).
- Cet outil ne constitue pas un conseil juridique : les montants sont estimatifs et à reporter sous la responsabilité du déclarant.

## À propos de Lexio

[Lexio](https://lexio.rent) est un logiciel de location de voiture et d'utilitaire pour les loueurs professionnels : planning, contrats, état des lieux photo, facturation. Essai gratuit de 14 jours, sans carte bancaire.
