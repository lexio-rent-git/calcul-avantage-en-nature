# Avantage en nature véhicule : calcul en ligne de commande

Évalue l'avantage en nature d'un véhicule mis à disposition d'un salarié ou d'un dirigeant assimilé salarié, pour **2025 et 2026** : **forfait et réel**, véhicule **acheté ou loué**, carburant payé ou non par l'employeur.

- Les deux régimes : véhicules attribués avant le 1er février 2025, et grille de l'arrêté du 25 février 2025 (taux de 15 % au lieu de 9 % pour un véhicule acheté de moins de 5 ans, au forfait sans carburant)
- Abattement des véhicules électriques (70 % au forfait pour un véhicule éco-scoré, 50 % au réel), plafonds annuels revalorisés
- Plafond du forfait « location » au forfait « achat » équivalent, et alerte quand le prix d'achat du loueur manque pour le vérifier
- Prorata au mois de mise à disposition, participation du salarié, comparaison forfait / réel
- Aucune dépendance : Node 24 sur Alpine, exécuté en utilisateur non root ; tests et cas de contrôle rejoués à chaque build

Pour justifier les kilomètres professionnels et privés d'un véhicule de service ou de société, tenez un **[carnet de bord véhicule](https://lexio.rent/outils/carnet-de-bord-vehicule)** (registre des trajets, gratuit, PDF et Word).

## Utilisation

```bash
# Berline achetée 25 000 € TTC, attribuée le 1er janvier 2026, forfait sans carburant
docker run --rm lexiorent/calcul-avantage-en-nature calcul --annee 2026 --mode achat --prix 25000 --attribution 2026-01-01
# forfait (sans-carburant) : 3 750 € sur la période, soit 313 € par mois
# (sous le régime avant-2025-02-01 : 2 250 €)

# LLD avec carburant payé par l'employeur : le plafond « location » s'applique
docker run --rm lexiorent/calcul-avantage-en-nature calcul --mode location --carburant employeur-forfait \
  --loyer 9000 --entretien 500 --assurance 500 --carburant-total 2000 --prix-loueur 30000 --attribution 2026-01-01

# Électrique éco-scoré, méthode réel
docker run --rm lexiorent/calcul-avantage-en-nature calcul --energie electrique --eco-score --prix 45000 \
  --methode reel --km-totaux 20000 --km-prives 5000 --attribution 2026-01-01

# Un parc complet décrit en JSON, sortie JSON ou tabulée (--tsv)
docker run --rm -i lexiorent/calcul-avantage-en-nature parc - --json < flotte.json

# Toutes les options
docker run --rm lexiorent/calcul-avantage-en-nature --help
```

La date d'attribution au salarié est obligatoire : c'est elle, et non la date d'achat ou du contrat de location, qui fixe le régime applicable.

## Tags

- `latest`, `0.2.1` : barèmes 2025 et 2026

## Limites

Le résultat est une simulation à faire valider par votre gestionnaire de paie ou votre expert-comptable. Les cas non couverts (employeur concessionnaire au forfait, notamment) sont signalés par le moteur plutôt que calculés.

## Source et licence

Code source sous licence MIT : [github.com/lexio-rent-git/calcul-avantage-en-nature](https://github.com/lexio-rent-git/calcul-avantage-en-nature).

Développé et maintenu par [Lexio Rent](https://lexio.rent/logiciel-location-voiture), logiciel de location de voiture et d'utilitaire pour les loueurs professionnels.
