// Point d'entrée pour `node --test tests/`.
//
// Sur Node 24, un argument-répertoire passé à `node --test` n'est pas parcouru
// à la recherche de fichiers *.test.ts : le chemin est exécuté tel quel comme
// module d'entrée, et la résolution de répertoire retombe sur ce index.js.
// Il charge donc explicitement la suite TypeScript, exécutée nativement par le
// type stripping de Node (aucune compilation, aucune dépendance).
import "./avantage-nature.test.ts";
