// ─────────────────────────────────────────────────────────────────────────────
// src/data/avantage-nature.ts
// Baremes, regles et moteur de calcul de l'AVANTAGE EN NATURE « vehicule » :
// evaluation forfaitaire ou au reel de l'usage prive d'un vehicule mis a
// disposition d'un salarie, pour l'assiette des cotisations de securite sociale.
//
// Pourquoi du TypeScript et pas un JSON (contrairement a parc-*.ts, zfe.ts...) :
// un bareme n'est pas une donnee inerte. Il est consomme par des fonctions de
// calcul dont on veut la verification A LA COMPILATION, et chaque taux doit
// porter sa source, son article et son statut de verification. Un JSON aurait
// perdu les trois : les unions litterales (2025 | 2026 pour les plafonds
// revalorises), l'impossibilite structurelle de calculer sur un plafond non
// publie, et le typage des regimes.
//
// Pourquoi ce module est le SEUL endroit ou l'on calcule : un avantage en nature
// faux produit une DSN fausse, donc un redressement. On veut donc pouvoir
// rejouer chaque regle sans monter React — d'ou des fonctions PURES, sans acces
// au DOM, sans etat, rejouees une par une (voir CAS_DE_CONTROLE plus bas).
//
// TROIS AVERTISSEMENTS DE FOND, a repercuter partout dans l'interface :
//
//  1. Le bareme applicable ne depend NI de l'annee de calcul, NI de la date
//     d'achat du vehicule, NI de sa date de premiere mise en circulation : il
//     depend de la DATE D'ATTRIBUTION DU VEHICULE AU SALARIE (BOSS §770).
//     L'arrete du 25 fevrier 2025 a cree deux grilles qui coexistent
//     durablement : un vehicule attribue le 15 janvier 2025 reste a 9 % / 30 %
//     tant qu'il n'est pas reattribue a un autre salarie. C'est la raison pour
//     laquelle le slug de la page ne porte AUCUN millesime.
//
//  2. Pour un vehicule LOUE (LLD, LOA), l'evaluation forfaitaire est PLAFONNEE
//     au montant qui aurait ete retenu si l'employeur avait achete le vehicule,
//     sur la base du prix d'achat TTC paye par LE LOUEUR. Le BOSS §890 met a la
//     charge du loueur l'obligation de communiquer cette donnee au locataire.
//     Sans elle, l'employeur sur-declare. C'est le trou que cet outil comble.
//
//  3. On calcule l'ASSIETTE SOCIALE. La doctrine fiscale publiee (BOFiP
//     BOI-RSA-BASE-20-20, version du 16/04/2024, et BOI-ANNX-000056, version du
//     01/06/2023) n'a PAS ete actualisee de l'arrete du 25 fevrier 2025 : elle
//     enonce encore 9 / 6 / 30 / 40 % et un plafond d'abattement electrique de
//     1 800 EUR. Ce module ne produit donc AUCUN montant etiquete « impot sur le
//     revenu » — voir POINTS_A_LEVER, point « ir-bofip-non-actualise ».
// ─────────────────────────────────────────────────────────────────────────────

export type SourceRef = { nom: string; url: string };

/**
 * Statut de fiabilite porte par la DONNEE elle-meme, jamais par un commentaire.
 * - "verifie" : adosse au texte de l'arrete, au BOSS ou au BOFiP, cite ci-dessous.
 * - "deduit"  : application d'un texte a un cas que l'administration n'a pas
 *               documente. La `note` est rendue a l'ecran ET sur le document
 *               imprime, jamais masquee.
 * Le statut "non-verifie" n'existe PAS dans cette union : une valeur non verifiee
 * n'a pas sa place dans une structure que le moteur sait lire.
 */
export type Statut = "verifie" | "deduit";

/** Libelle d'affichage d'un statut. Les valeurs de l'union restent des
    identifiants sans accent — elles sont comparees dans le code ; leur rendu,
    lui, est du francais. */
export const LIBELLE_STATUT: Readonly<Record<Statut, string>> = {
  verifie: "vérifié",
  deduit: "déduit",
};

// ─────────────────────────────────────────────────────────────────────────────
// META
// ─────────────────────────────────────────────────────────────────────────────

const SRC_BOSS_AN: SourceRef = {
  nom: "BOSS — Bulletin officiel de la Sécurité sociale, rubrique « Avantages en nature », chapitre 4 (véhicule), version en vigueur au 1er juin 2026",
  url: "https://boss.gouv.fr/portail/accueil/autres-elements-de-remuneration/avantages-en-nature.html",
};
const SRC_BOSS_ASSIETTE: SourceRef = {
  nom: "BOSS — rubrique « Assiette générale » (abattement d'assiette CSG de 1,75 %)",
  url: "https://boss.gouv.fr/portail/accueil/regles-dassujettissement/assiette-generale.html",
};
const SRC_ARRETE_2025: SourceRef = {
  nom: "Arrêté du 25 février 2025 relatif à l'évaluation des avantages en nature pour le calcul des cotisations de sécurité sociale",
  url: "https://www.legifrance.gouv.fr/loda/id/JORFTEXT000051254024",
};
const SRC_BOFIP_RSA: SourceRef = {
  nom: "BOFiP, BOI-RSA-BASE-20-20 (évaluation des avantages en nature pour l'impôt sur le revenu), version du 16 avril 2024",
  url: "https://bofip.impots.gouv.fr/bofip/2398-PGP.html",
};
const SRC_BOFIP_ANNEXE: SourceRef = {
  nom: "BOFiP, BOI-ANNX-000056 (tableau récapitulatif véhicule), version du 1er juin 2023",
  url: "https://bofip.impots.gouv.fr/bofip/2469-PGP.html",
};
/**
 * Texte fondateur de la condition d'éco-score. L'URL a ete ouverte et le titre
 * verifie mot pour mot le 4 aout 2026. La liste elle-meme n'est PAS embarquee
 * dans cet outil : elle est revisee par arretes MODIFICATIFS publies au Journal
 * officiel, et une liste figee dans un module de donnees serait perimee des la
 * publication suivante. L'outil pose donc la question a l'utilisateur et lui
 * donne le texte a consulter, ce qui est verifiable ; il ne repond pas a sa
 * place, ce qui ne le serait pas.
 */
const SRC_ARRETE_ECO_SCORE: SourceRef = {
  nom: "Arrêté du 14 décembre 2023 fixant la liste des versions de voitures particulières électriques ayant atteint le score environnemental minimal conditionnant l'éligibilité à certaines aides à l'achat ou à la location de véhicules peu polluants",
  url: "https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000048567223",
};

export const META = {
  miseAJour: "2026-08-03",
  version: "1.0.0",
  /** Annee de reference chargee par defaut : elle ne pilote PAS la grille de
      taux (c'est la date d'attribution qui le fait), uniquement les PLAFONDS en
      euros, revalorises chaque 1er janvier par l'art. 8 de l'arrete. */
  anneeParDefaut: 2026 as const,
  /**
   * Sources citees en pied de page ET dans le JSON-LD (`citation[]`).
   * Regle du repo : aucun chiffre, aucun article, aucune reference n'est ecrit
   * en dur dans la prose de la page — tout est derive d'ici.
   *
   * Toutes ces URL ont ete ouvertes dans un navigateur reel le 3 aout 2026, et
   * les paragraphes du seuil des cinq ans (§630, §770 et §810) reconfrontes au
   * verbatim sur boss.gouv.fr le 5 aout 2026. Pour toute reverification :
   * boss.gouv.fr repond a un simple curl muni d'un User-Agent de navigateur (la
   * premisse « refuse les requetes automatisees », consignee ici auparavant,
   * etait fausse) ; legifrance.gouv.fr, lui, sert un challenge Cloudflare a
   * curl. Ne pas re-verifier ces liens en integration continue : un echec de
   * fetch n'y signifierait rien. L'ancienne racine BOSS
   * « .../avantages-en-nature-et-frais-profession/... » est morte (404).
   *
   * L'arrete du 14 decembre 2023 (éco-score) EST cite : son URL Legifrance a ete
   * ouverte et son titre verifie mot pour mot. Ce qui n'est pas embarque, c'est
   * la LISTE des versions eligibles — revisee par arretes modificatifs publies
   * au Journal officiel, elle serait perimee des la publication suivante.
   */
  sources: [
    SRC_BOSS_AN,
    SRC_ARRETE_2025,
    SRC_ARRETE_ECO_SCORE,
    SRC_BOSS_ASSIETTE,
    SRC_BOFIP_RSA,
    SRC_BOFIP_ANNEXE,
  ],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Enumerations du domaine
//
// Toutes en `ReadonlyArray<{ id; label; aide? }>` : c'est la forme exacte
// qu'attend la primitive `Liste<T>` du composant client, donc une enumeration se
// branche sur un `<select>` accessible sans adaptateur.
//
// Les unions fermees sont DERIVEES de leur table via `as const satisfies`, et
// jamais recopiees : une annotation `ReadonlyArray<{ id: Energie }>` verifie la
// validite des identifiants mais jamais leur exhaustivite, c'est elle qui rend
// une union recopiable a trois endroits.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ANNEES DE PLAFONDS CALCULABLES, et elles seules.
 *
 * Ce n'est PAS le millesime du bareme : les taux (%) ne sont pas indexes, seuls
 * les montants en euros le sont (arrete du 25 fevrier 2025, art. 8 : revalorises
 * chaque 1er janvier sur le taux previsionnel d'evolution des prix hors tabac,
 * arrondis a la dizaine de centimes la plus proche).
 *
 * 2027 est volontairement absente : les montants revalorises au 1er janvier 2027
 * ne seront publies que vers janvier 2027. `Readonly<Record<Annee, Plafonds>>`
 * rend l'annee non publiee structurellement incalculable — ajouter 2027 au
 * selecteur produit une erreur TypeScript, pas un plafond invente.
 */
export type Annee = (typeof ANNEES)[number]["id"];

export const ANNEES = [
  {
    id: 2025,
    label: "Année 2025 — plafonds au 1er janvier 2025",
    aide: "Abattement électrique plafonné à 2 000,30 € (50 %) et 4 582,00 € (70 %) ; bornes de recharge à 1 043,50 € et 1 565,20 €.",
  },
  {
    id: 2026,
    label: "Année 2026 — plafonds au 1er janvier 2026",
    aide: "Revalorisation de 1,3 % : abattement électrique plafonné à 2 026,30 € (50 %) et 4 641,60 € (70 %) ; bornes à 1 057,10 € et 1 585,50 €.",
  },
] as const satisfies ReadonlyArray<{ id: number; label: string; aide: string }>;

/** Derniere annee dont les plafonds sont publies. Sert a l'avertissement de
    peremption rendu par la page : au-dela, l'outil ne calcule plus. */
export const DERNIERE_ANNEE_PUBLIEE: Annee = ANNEES[ANNEES.length - 1].id;

export type UsagePrive = (typeof USAGES_PRIVE)[number]["id"];

/**
 * Les cinq situations du BOSS §550 a §570. Quatre d'entre elles ne produisent
 * AUCUN avantage en nature : le confondre avec « avantage nul » serait une faute
 * de qualification sur le bulletin de paie, on separe donc explicitement les deux.
 */
export const USAGES_PRIVE = [
  {
    id: "permanent",
    label: "Mise à disposition permanente : le salarié garde le véhicule hors temps de travail",
    aide: "Le salarié n'est pas tenu de restituer le véhicule pendant ses repos hebdomadaires ni pendant ses congés. C'est le seul cas qui produit un avantage en nature.",
    avantage: true,
    article: "BOSS §550",
  },
  {
    id: "restitution-hebdo-conges",
    label: "Restitution imposée à chaque repos hebdomadaire ET pendant les congés",
    aide: "Les deux conditions sont cumulatives. Si le véhicule reste au salarié pendant ses congés, l'avantage en nature est dû.",
    avantage: false,
    article: "BOSS §560",
  },
  {
    id: "interdiction-ecrite",
    label: "Usage privé interdit par écrit (règlement intérieur, circulaire, courrier ou courriel)",
    aide: "L'interdiction doit être notifiée par écrit et couvre alors aussi la carte carburant. Une consigne orale ne suffit pas.",
    avantage: false,
    article: "BOSS §560",
  },
  {
    id: "domicile-travail-necessaire",
    label: "Trajet domicile-travail seul, usage du véhicule nécessaire à l'activité",
    aide: "L'employeur doit démontrer que le salarié ne peut pas utiliser les transports en commun, soit qu'il n'y en ait pas, soit que les horaires de travail l'empêchent.",
    avantage: false,
    article: "BOSS §570",
  },
  {
    id: "professionnel-exclusif",
    label: "Véhicule partagé entre plusieurs salariés, usage exclusivement professionnel attesté",
    aide: "Un document doit attester de l'usage uniquement professionnel. Même règle pour la carte carburant de l'entreprise.",
    avantage: false,
    article: "BOSS §570",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  aide: string;
  avantage: boolean;
  article: string;
}>;

export type ModeAcquisition = (typeof MODES)[number]["id"];

export const MODES = [
  {
    id: "achat",
    label: "Véhicule acheté par l'employeur",
    aide: "Y compris un véhicule d'occasion, et y compris un véhicule racheté en fin de LOA ou de LLD — la valeur retenue est alors le prix d'achat réglé par le loueur ou le crédit-bailleur.",
  },
  {
    id: "location",
    label: "Véhicule loué, en LLD ou en location avec option d'achat (LOA)",
    aide: "C'est le cas le plus mal traité par les simulateurs en ligne : l'évaluation forfaitaire y est plafonnée par référence au prix d'achat du véhicule PAR LE LOUEUR.",
  },
] as const satisfies ReadonlyArray<{ id: string; label: string; aide: string }>;

export type MethodeEvaluation = (typeof METHODES)[number]["id"];

export const METHODES = [
  {
    id: "forfait",
    label: "Évaluation forfaitaire",
    aide: "Un pourcentage du coût d'achat ou du coût global annuel de location. C'est une évaluation MINIMALE d'ordre public : une convention collective ne peut pas retenir moins.",
  },
  {
    id: "reel",
    label: "Évaluation sur les dépenses réellement engagées",
    aide: "Option de l'employeur, exercée au plus tard lors de la dernière déclaration de l'exercice, salarié par salarié. Elle suppose un carnet de bord justifiant le kilométrage. Le montant réel PEUT être inférieur au forfait.",
  },
] as const satisfies ReadonlyArray<{ id: string; label: string; aide: string }>;

export type Energie = (typeof ENERGIES)[number]["id"];

export const ENERGIES = [
  {
    id: "thermique",
    label: "Thermique, hybride non rechargeable, gaz",
    aide: "Aucun abattement. Le carburant payé par l'employeur pour l'usage privé entre dans le calcul.",
  },
  {
    id: "hybride-rechargeable",
    label: "Hybride rechargeable",
    aide: "Traité comme un véhicule thermique : aucun abattement, et l'électricité prise en charge par l'employeur pour la recharge privée doit être réintégrée dans l'assiette.",
  },
  {
    id: "electrique",
    // Le texte vise le vehicule « fonctionnant EXCLUSIVEMENT au moyen de
    // l'energie electrique ». Le cas de l'hydrogene (pile a combustible) n'est
    // traite ni par l'arrete ni par le BOSS : il n'est donc pas annonce ici
    // comme couvert. L'assimiler serait une deduction, et une deduction qui
    // minore une assiette sociale n'a pas sa place dans un libelle de champ.
    label: "100 % électrique",
    aide: "Véhicule fonctionnant exclusivement au moyen de l'énergie électrique. Les frais d'électricité engagés par l'employeur pour la recharge ne sont jamais comptés, même si le véhicule ne satisfait pas la condition d'éco-score. Un abattement s'applique en plus si les conditions sont réunies.",
  },
] as const satisfies ReadonlyArray<{ id: string; label: string; aide: string }>;

export type TrancheAge = (typeof TRANCHES_AGE)[number]["id"];

export const TRANCHES_AGE = [
  {
    id: "moins-5-ans",
    label: "Cinq ans ou moins",
    aide: "Au forfait, le BOSS écrit « acheté depuis plus de cinq ans » (§770 et §810) : la référence est la date d'ACHAT par l'employeur. Au réel, pour un véhicule d'occasion, l'âge s'apprécie « par rapport à la date de première mise en circulation » (§630). Renseignez les deux dates : l'outil signale la divergence.",
  },
  {
    id: "plus-5-ans",
    label: "Plus de cinq ans",
    aide: "Le taux forfaitaire et le taux d'amortissement sont abaissés. Cette distinction n'existe PAS pour un véhicule loué.",
  },
] as const satisfies ReadonlyArray<{ id: string; label: string; aide: string }>;

export type PriseEnChargeCarburant = (typeof CARBURANTS)[number]["id"];

export const CARBURANTS = [
  {
    id: "salarie",
    label: "Le salarié paie son carburant",
    aide: "La preuve de la non-prise en charge se fait par tout moyen. Attention : le blocage de la carte essence le week-end ne suffit pas à lui seul.",
  },
  {
    id: "employeur-frais-reels",
    label: "L'employeur paie le carburant — forfait de base plus les frais réels d'usage privé",
    aide: "Le forfait de base s'ajoute aux dépenses de carburant à usage personnel justifiées par factures.",
  },
  {
    id: "employeur-forfait",
    label: "L'employeur paie le carburant — forfait global majoré",
    aide: "Option alternative : un pourcentage plus élevé, appliqué à une assiette qui intègre le carburant professionnel ET personnel. Les deux options sont au choix de l'employeur, l'outil calcule les deux.",
  },
] as const satisfies ReadonlyArray<{ id: string; label: string; aide: string }>;

/** Regime de bareme. La cle n'est PAS une annee civile : c'est le regime de la
    date d'attribution du vehicule au salarie. */
export type Regime = "avant-2025-02-01" | "depuis-2025-02-01";

/** Premier jour du regime issu de l'arrete du 25 fevrier 2025. L'arrete est
    applicable aux cotisations dues au titre des periodes d'activite courant a
    compter du 1er fevrier 2025 (art. 10) ; le BOSS §770 precise que la date qui
    fait basculer un vehicule d'une grille a l'autre est la date d'attribution
    au salarie, y compris en cas de reattribution a un second salarie. */
export const BASCULE_REGIME = "2025-02-01";

export const REGIMES: ReadonlyArray<{ id: Regime; label: string; aide: string }> = [
  {
    id: "avant-2025-02-01",
    label: "Véhicule attribué au salarié jusqu'au 31 janvier 2025",
    aide: "Anciennes grilles : 9 % / 6 % à l'achat, 30 % en location. Elles restent applicables tant que le véhicule n'est pas réattribué à un autre salarié.",
  },
  {
    id: "depuis-2025-02-01",
    label: "Véhicule attribué au salarié à compter du 1er février 2025",
    aide: "Nouvelles grilles : 15 % / 10 % à l'achat, 50 % en location. Un véhicule acheté avant cette date mais attribué après en relève, y compris s'il avait déjà été attribué à un premier salarié.",
  },
];

/** Les trois formes que peut prendre l'evaluation forfaitaire. La correspondance
    avec la prise en charge du carburant est TOTALE (voir `varianteDe`) : c'est ce
    qui garantit qu'aucune configuration de saisie ne retombe en silence sur la
    mauvaise grille. */
export type VarianteForfait =
  | "sans-carburant"
  | "carburant-frais-reels"
  | "carburant-forfait-global";

export const VARIANTES_FORFAIT: ReadonlyArray<{ id: VarianteForfait; label: string }> = [
  { id: "sans-carburant", label: "Forfait sans prise en charge du carburant" },
  {
    id: "carburant-frais-reels",
    label: "Forfait de base, plus les frais réels de carburant à usage personnel",
  },
  { id: "carburant-forfait-global", label: "Forfait global majoré, carburant compris" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Baremes
// ─────────────────────────────────────────────────────────────────────────────

/** Couple de taux d'une grille forfaitaire : sans carburant, et forfait global
    majore quand l'employeur prend le carburant a sa charge. */
export type CoupleTaux = { sansCarburant: number; forfaitGlobal: number };

export type GrilleAchat = {
  regime: Regime;
  statut: Statut;
  article: string;
  source: SourceRef;
  moins5ans: CoupleTaux;
  plus5ans: CoupleTaux;
};

export type GrilleLocation = {
  regime: Regime;
  statut: Statut;
  article: string;
  source: SourceRef;
  taux: CoupleTaux;
};

/**
 * GRILLES FORFAITAIRES — VEHICULE ACHETE.
 *
 * `Readonly<Record<Regime, GrilleAchat>>` : ajouter un troisieme regime sans
 * fournir sa grille produit une erreur de compilation, jamais un taux implicite.
 */
export const TAUX_FORFAIT_ACHAT: Readonly<Record<Regime, GrilleAchat>> = {
  "avant-2025-02-01": {
    regime: "avant-2025-02-01",
    statut: "verifie",
    article: "BOSS §770, §780 et tableau §790 ; arrêté du 25 février 2025, art. 3, III, A",
    source: SRC_BOSS_AN,
    moins5ans: { sansCarburant: 0.09, forfaitGlobal: 0.12 },
    plus5ans: { sansCarburant: 0.06, forfaitGlobal: 0.09 },
  },
  "depuis-2025-02-01": {
    regime: "depuis-2025-02-01",
    statut: "verifie",
    article: "BOSS §810, §820 et tableau §830 ; arrêté du 25 février 2025, art. 3, III, B",
    source: SRC_BOSS_AN,
    moins5ans: { sansCarburant: 0.15, forfaitGlobal: 0.2 },
    plus5ans: { sansCarburant: 0.1, forfaitGlobal: 0.15 },
  },
};

/**
 * GRILLES FORFAITAIRES — VEHICULE LOUE, LLD OU LOA.
 * Il n'existe AUCUNE distinction d'age pour un vehicule loue : le seuil des cinq
 * ans ne figure ni au §850 ni au §870. L'absence de champ `plus5ans` dans
 * `GrilleLocation` est deliberee — un simulateur qui proposerait ce choix
 * laisserait croire a une regle qui n'existe pas.
 */
export const TAUX_FORFAIT_LOCATION: Readonly<Record<Regime, GrilleLocation>> = {
  "avant-2025-02-01": {
    regime: "avant-2025-02-01",
    statut: "verifie",
    article: "BOSS §850 et §860 ; arrêté du 25 février 2025, art. 3, III, A",
    source: SRC_BOSS_AN,
    taux: { sansCarburant: 0.3, forfaitGlobal: 0.4 },
  },
  "depuis-2025-02-01": {
    regime: "depuis-2025-02-01",
    statut: "verifie",
    article: "BOSS §870, §880 et §890 ; arrêté du 25 février 2025, art. 3, III, B",
    source: SRC_BOSS_AN,
    taux: { sansCarburant: 0.5, forfaitGlobal: 0.67 },
  },
};

/**
 * TAUX D'AMORTISSEMENT de l'evaluation au reel d'un vehicule ACHETE
 * (BOSS §620, §630, tableau §710). Ils ne dependent pas du regime de date : la
 * reforme du 25 fevrier 2025 n'a pas touche a l'evaluation au reel.
 */
export const AMORTISSEMENT_REEL = {
  moins5ans: 0.2,
  plus5ans: 0.1,
  statut: "verifie" as Statut,
  article: "BOSS §620, §630 et tableau §710",
  source: SRC_BOSS_AN,
} as const;

/**
 * PLAFOND DU RABAIS retenu dans deux situations distinctes, et une seule valeur.
 *
 *  a) Constructeur, concessionnaire ou agent de marque qui met SES PROPRES
 *     vehicules a disposition de ses salaries : on deduit du prix public TTC le
 *     rabais consenti, dans la limite de 30 % (BOSS §730 au reel, §760 au forfait).
 *
 *  b) Prix de reference du vehicule LOUE pour le calcul du plafond : prix d'achat
 *     TTC du vehicule par le loueur, apres prise en compte du rabais consenti,
 *     dans la limite de 30 % du prix conseille par le constructeur au jour du
 *     debut du contrat (BOSS §860 et §890).
 *
 * ATTENTION AU CONTRESENS, a repeter dans la prose : cette limite de 30 % ne
 * concerne PAS la remise commerciale ordinaire obtenue par un employeur lambda
 * chez son concessionnaire. Celle-ci se deduit integralement (BOSS §630).
 */
/**
 * DEUX CITATIONS DISTINCTES, ET NON UNE SEULE EMPAQUETANT LES DEUX USAGES.
 *
 * Le champ unique `article` valait « BOSS §730 et §760 … ; §860 et §890 … » et
 * etait recopie EN BLOC par les deux chemins de calcul. Une ligne « vehicule
 * ACHETE chez un employeur du secteur automobile » citait donc §860 et §890,
 * qui ne traitent que du vehicule LOUE — une reference fausse sur une piece
 * produite a l'URSSAF, parentheses imbriquees en prime. Chaque chemin cite
 * desormais le sien.
 */
export const RABAIS_MAX = {
  part: 0.3,
  statut: "verifie" as Statut,
  /** Employeur du secteur automobile mettant SES PROPRES vehicules a
      disposition : §730 au reel, §760 au forfait. */
  articleConcessionnaire: "BOSS §730 et §760",
  /** Prix de reference du vehicule LOUE, pour le seul calcul du plafonnement. */
  articlePrixReferenceLocation: "BOSS §860 et §890",
  source: SRC_BOSS_AN,
} as const;

/** Clefs des plafonds annuels en euros. Utilisees comme discriminant pour lier
    un abattement a la ligne du bareme qui porte son plafond. */
export type ClePlafond = "abattement50" | "abattement70" | "borne50" | "borne75";

export type Plafonds = Readonly<Record<ClePlafond, number>>;

/**
 * PLAFONDS EN EUROS, revalorises chaque 1er janvier (arrete du 25 fevrier 2025,
 * art. 8 : taux previsionnel d'evolution en moyenne annuelle des prix a la
 * consommation de tous les menages hors tabac, arrondis a la dizaine de centimes
 * d'euro la plus proche).
 *
 * La revalorisation 2026 est de +1,3 %, ce que `verifierBaremes()` recalcule
 * ligne a ligne : 2 000,30 x 1,013 = 2 026,30 ; 4 582,00 x 1,013 = 4 641,60 ;
 * 1 043,50 x 1,013 = 1 057,10 ; 1 565,20 x 1,013 = 1 585,50. Une faute de frappe
 * dans l'un de ces huit nombres fait donc echouer le build, et non une DSN.
 *
 * Les TAUX (%) ne sont PAS indexes : seuls ces montants le sont.
 */
export const PLAFONDS: Readonly<Record<Annee, Plafonds>> = {
  2025: {
    abattement50: 2000.3,
    abattement70: 4582,
    borne50: 1043.5,
    borne75: 1565.2,
  },
  2026: {
    abattement50: 2026.3,
    abattement70: 4641.6,
    borne50: 1057.1,
    borne75: 1585.5,
  },
};

export const SOURCE_PLAFONDS = {
  statut: "verifie" as Statut,
  article:
    "Arrêté du 25 février 2025, art. 8 (revalorisation annuelle) ; valeurs au 1er janvier 2026 publiées par le BOSS §900, §910 et §930",
  source: SRC_ARRETE_2025,
} as const;

/**
 * REGIME DU VEHICULE 100 % ELECTRIQUE.
 *
 * Le fait generateur est, la encore, la date d'attribution au salarie.
 *
 * Regime « avant » (BOSS §900) : abattement de 50 % plafonne, AU REEL COMME AU
 * FORFAIT, sans aucune condition d'éco-score. La fenetre d'ouverture commence le
 * 1er janvier 2020 : un vehicule attribue avant cette date n'a droit a rien.
 *
 * Regime « depuis » (BOSS §910) : deux abattements distincts selon la METHODE
 * d'evaluation — 50 % au reel, 70 % au forfait — et une condition d'éco-score.
 * C'est le piege numero un de la reforme : opter pour le reel fait perdre
 * vingt points d'abattement sur un vehicule electrique.
 *
 * Sur la date de fin du regime « avant », le BOSS §900 ecrit « entre le
 * 1er janvier 2020 et le 31 janvier 2026 » alors que son propre titre vise les
 * vehicules mis a disposition AVANT le 1er fevrier 2025, et que l'arrete
 * (art. 3, III, C) ecrit « entre le 1er janvier 2020 et le 31 janvier 2025 ».
 * On retient 31/01/2025 : norme superieure et titre de section concordent, la
 * mention « 2026 » est une coquille. Elle n'est reproduite nulle part dans
 * l'interface. Voir POINTS_A_LEVER, point « boss-900-date ».
 */
export type RegimeElectrique = {
  regime: Regime;
  /** Premier jour d'attribution ouvrant droit a l'abattement, inclus. */
  debut: string;
  /** Dernier jour d'attribution couvert par ce regime, inclus. Valeur
      EDITORIALE : elle est affichee, elle n'est pas opposee au calcul. */
  fin: string;
  /**
   * Dernier jour d'attribution OPPOSE PAR LE MOTEUR, ou null.
   *
   * Pourquoi ce champ n'est pas simplement `fin` : pour le regime anterieur, la
   * fin du regime EST la bascule de grille, deja garantie par `regimeDe`. La
   * controler une seconde fois ne changerait rien au calcul reel, mais casserait
   * le contrefactuel — la simulation « ce meme vehicule sous l'autre grille »,
   * qui force volontairement un regime que la date ne donne pas, et qui doit
   * alors montrer l'abattement de cette grille-la.
   *
   * Pour le regime posterieur au 1er fevrier 2025, en revanche, le 31 decembre
   * 2027 est une vraie borne de fond : au-dela, rien n'est publie. La controler
   * evite qu'un futur ajout de l'annee 2028 au selecteur ne fasse tranquillement
   * survivre un abattement de 70 % que plus aucun texte ne porte.
   */
  finOpposable: string | null;
  tauxReel: number;
  tauxForfait: number;
  clePlafondReel: ClePlafond;
  clePlafondForfait: ClePlafond;
  ecoScoreRequis: boolean;
  statut: Statut;
  article: string;
  source: SourceRef;
};

export const ELECTRIQUE: Readonly<Record<Regime, RegimeElectrique>> = {
  "avant-2025-02-01": {
    regime: "avant-2025-02-01",
    debut: "2020-01-01",
    fin: "2025-01-31",
    finOpposable: null,
    tauxReel: 0.5,
    tauxForfait: 0.5,
    clePlafondReel: "abattement50",
    clePlafondForfait: "abattement50",
    ecoScoreRequis: false,
    statut: "verifie",
    article: "BOSS §900",
    source: SRC_BOSS_AN,
  },
  "depuis-2025-02-01": {
    regime: "depuis-2025-02-01",
    debut: "2025-02-01",
    fin: "2027-12-31",
    finOpposable: "2027-12-31",
    tauxReel: 0.5,
    tauxForfait: 0.7,
    clePlafondReel: "abattement50",
    clePlafondForfait: "abattement70",
    ecoScoreRequis: true,
    statut: "verifie",
    article: "BOSS §910 ; code de l'énergie, art. D. 251-1, I, 6, c pour l'éco-score",
    source: SRC_BOSS_AN,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Bornes de recharge (BOSS §930, arrete du 25 fevrier 2025, art. 4)
//
// C'est un avantage DISTINCT de l'avantage vehicule : il se calcule a part et
// s'ajoute, il ne se substitue pas. Regime applicable jusqu'au 31 decembre 2027.
// ─────────────────────────────────────────────────────────────────────────────

export type SituationBorne = (typeof SITUATIONS_BORNE)[number]["id"];

export const SITUATIONS_BORNE = [
  {
    id: "lieu-travail",
    label: "Borne installée sur le lieu de travail",
    aide: "L'avantage est négligé, y compris pour la recharge d'un véhicule appartenant personnellement au salarié.",
  },
  {
    id: "hors-restituee",
    label: "Borne hors du lieu de travail, restituée à la fin du contrat de travail",
    aide: "La prise en charge des frais d'achat et d'installation est négligée.",
  },
  {
    id: "hors-non-restituee-5ans-ou-moins",
    label: "Borne hors du lieu de travail, non restituée, borne de cinq ans ou moins",
    aide: "Exclusion d'assiette dans la limite de 50 % des dépenses réelles ET d'un plafond annuel en euros.",
  },
  {
    id: "hors-non-restituee-plus-5ans",
    label: "Borne hors du lieu de travail, non restituée, borne de plus de cinq ans",
    aide: "Exclusion d'assiette dans la limite de 75 % des dépenses réelles ET d'un plafond annuel plus élevé.",
  },
  {
    id: "autres-frais",
    label: "Autres frais : entretien, maintenance, surcoût d'abonnement, location de borne, abonnement à des bornes en libre-service",
    aide: "Exclusion dans la limite de 50 % des dépenses réelles, sans plafond en euros.",
  },
  {
    id: "forfait-non-isolable",
    label: "Forfait d'électricité non isolable dans le coût de location ou d'abonnement",
    aide: "Aucune exclusion possible : la totalité des dépenses entre dans le calcul de l'avantage en nature.",
  },
] as const satisfies ReadonlyArray<{ id: string; label: string; aide: string }>;

export type RegleBorne = {
  /** Vrai quand l'avantage est purement et simplement neglige. */
  neglige: boolean;
  /** Part des depenses reelles exclue de l'assiette, ou null si aucune. */
  tauxExclusion: number | null;
  /** Plafond en euros de l'exclusion, ou null si l'exclusion n'en a pas. */
  clePlafond: ClePlafond | null;
  statut: Statut;
  article: string;
  source: SourceRef;
};

export const REGLES_BORNE: Readonly<Record<SituationBorne, RegleBorne>> = {
  "lieu-travail": {
    neglige: true,
    tauxExclusion: null,
    clePlafond: null,
    statut: "verifie",
    article: "BOSS §930 ; arrêté du 25 février 2025, art. 4",
    source: SRC_BOSS_AN,
  },
  "hors-restituee": {
    neglige: true,
    tauxExclusion: null,
    clePlafond: null,
    statut: "verifie",
    article: "BOSS §930 ; arrêté du 25 février 2025, art. 4",
    source: SRC_BOSS_AN,
  },
  "hors-non-restituee-5ans-ou-moins": {
    neglige: false,
    tauxExclusion: 0.5,
    clePlafond: "borne50",
    statut: "verifie",
    article: "BOSS §930 ; arrêté du 25 février 2025, art. 4",
    source: SRC_BOSS_AN,
  },
  "hors-non-restituee-plus-5ans": {
    neglige: false,
    tauxExclusion: 0.75,
    clePlafond: "borne75",
    statut: "verifie",
    article: "BOSS §930 ; arrêté du 25 février 2025, art. 4",
    source: SRC_BOSS_AN,
  },
  "autres-frais": {
    neglige: false,
    tauxExclusion: 0.5,
    clePlafond: null,
    statut: "verifie",
    article: "BOSS §930 ; arrêté du 25 février 2025, art. 4",
    source: SRC_BOSS_AN,
  },
  "forfait-non-isolable": {
    neglige: false,
    tauxExclusion: null,
    clePlafond: null,
    statut: "verifie",
    article: "BOSS §930",
    source: SRC_BOSS_AN,
  },
};

/** Dernier jour du regime de faveur des bornes de recharge. Au-dela, le BOSS
    n'a rien publie : l'outil affiche la date de peremption plutot que de laisser
    croire a une regle perenne. */
export const FIN_REGIME_BORNES = "2027-12-31";

// ─────────────────────────────────────────────────────────────────────────────
// Perimetres : ce qui entre, ce qui n'entre pas, ce qui n'est pas tranche
//
// Tables rendues telles quelles dans la prose de la page ET dans les notes de
// bas de tableau du recapitulatif imprime. Un poste « non tranche » est affiche
// comme tel : c'est exactement le genre de detail qui fait la difference entre
// une page qui informe et une page qui se contente d'un resultat.
// ─────────────────────────────────────────────────────────────────────────────

export type Inclusion = "inclus" | "exclu" | "non-tranche";

export type PostePerimetre = {
  poste: string;
  inclusion: Inclusion;
  motif: string;
  statut: Statut;
  article: string;
};

/** Composition du « cout d'achat » servant d'assiette au forfait comme a
    l'amortissement du reel. */
export const PERIMETRE_COUT_ACHAT: ReadonlyArray<PostePerimetre> = [
  {
    poste: "Prix TTC effectivement réglé par l'entreprise",
    inclusion: "inclus",
    motif: "Le coût d'achat s'entend du prix toutes taxes comprises réglé par l'entreprise.",
    statut: "verifie",
    article: "BOSS §710 et §810",
  },
  {
    poste: "Remise commerciale obtenue par l'employeur",
    inclusion: "exclu",
    motif:
      "On retient le prix après remise. Cette remise ordinaire se déduit intégralement : la limite de 30 % ne vise que les employeurs du secteur automobile qui vendent leurs propres véhicules.",
    statut: "verifie",
    article: "BOSS §630, §770 et §810",
  },
  {
    poste: "Reprise de l'ancien véhicule",
    inclusion: "exclu",
    motif:
      "Le montant de la reprise vient en diminution : un véhicule payé 20 000 € avec une reprise de 2 000 € à un prix de référence de 18 000 €.",
    statut: "verifie",
    article: "BOSS §630",
  },
  {
    poste: "Bonus écologique et sa majoration",
    inclusion: "exclu",
    motif:
      "Le bonus n'est pas une remise du vendeur mais une aide de l'État : il ne diminue PAS le prix de référence. C'est l'erreur la plus fréquente.",
    statut: "verifie",
    article: "BOSS §600",
  },
  {
    poste: "Malus écologique",
    inclusion: "exclu",
    motif:
      "Symétriquement, le malus est un frais d'immatriculation : il ne majore PAS le prix de référence.",
    statut: "verifie",
    article: "BOSS §600",
  },
  {
    poste: "Dépôt de garantie d'une LOA ou d'une LLD rachetée",
    inclusion: "exclu",
    motif:
      "Pour un véhicule racheté en fin de contrat, la valeur retenue est le prix d'achat réglé par le loueur ou le crédit-bailleur ; le dépôt de garantie n'entre pas dans le calcul.",
    statut: "verifie",
    article: "BOSS §610, §800 et §840",
  },
  {
    poste: "Véhicule prêté par un constructeur (partenariat, sponsoring)",
    inclusion: "inclus",
    motif:
      "Le prix de référence est le prix TTC conseillé par le constructeur au jour du prêt.",
    statut: "verifie",
    article: "BOSS §940",
  },
];

/** Composition du « cout global annuel » servant d'assiette au forfait du
    vehicule loue. Le texte est limitatif : « la location, l'entretien et
    l'assurance ». L'exclusion des autres postes n'est pour autant PAS sourcee,
    et c'est dit. */
export const PERIMETRE_COUT_LOCATION: ReadonlyArray<PostePerimetre> = [
  {
    poste: "Loyer de location, de LLD ou de LOA, taxes comprises",
    inclusion: "inclus",
    motif: "Évalué d'après les factures, taxes comprises.",
    statut: "verifie",
    article: "BOSS §850 et §870",
  },
  {
    poste: "Entretien",
    inclusion: "inclus",
    motif: "Frais courants : révisions, pneumatiques, vidanges, lavages.",
    statut: "verifie",
    article: "BOSS §850 et §870",
  },
  {
    poste: "Assurance",
    inclusion: "inclus",
    motif:
      "Coût réellement supporté, franchises exclues. Pour une flotte, on retient le coût moyen des primes.",
    statut: "verifie",
    article: "BOSS §650 et §670",
  },
  {
    poste: "Carburant à usage professionnel et personnel",
    inclusion: "inclus",
    motif:
      "Uniquement dans l'assiette du forfait global majoré. L'option « forfait de base plus frais réels » retient, elle, une assiette SANS carburant.",
    statut: "verifie",
    article: "BOSS §880 ; arrêté du 25 février 2025, art. 3",
  },
  {
    poste: "Dépôt de garantie",
    inclusion: "exclu",
    motif: "Exclu par analogie explicite avec le rachat de fin de contrat.",
    statut: "verifie",
    article: "BOSS §610, §800 et §840",
  },
  {
    poste: "Remise en état consécutive à un sinistre",
    inclusion: "exclu",
    motif:
      "Exclu côté dépenses réelles ; le coût global de la location n'inclut que l'entretien courant.",
    statut: "verifie",
    article: "BOSS §660 et §680",
  },
  {
    poste: "Frais de dossier, carte grise, pénalités de restitution, véhicule de remplacement, télématique",
    inclusion: "non-tranche",
    motif:
      "Le BOSS ne les énumère pas. Le texte est limitatif, ce qui plaide pour l'exclusion, mais cette exclusion n'est pas écrite. L'outil ne les intègre pas et le déclare.",
    statut: "deduit",
    article: "Aucune doctrine publiée",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Notes editoriales exportees
//
// Tout texte reutilise par la page ET par le document imprime vit ici : deux
// affichages de la meme regle ne doivent pas pouvoir diverger d'un feuillet a
// l'autre.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Date ISO vers date francaise en toutes lettres. Chaine vide ou date invalide
 * donne un tiret cadratin, jamais « Invalid Date ».
 *
 * POURQUOI ce formateur est declare ICI, en avance sur le reste des utilitaires
 * d'affichage : `NOTE_IMPOT_REVENU` ci-dessous doit dater sa propre reserve a
 * partir de `META.miseAJour` et non d'une date retapee. Une constante de niveau
 * module ne peut pas appeler une fonction declaree plus bas en `const` (zone
 * morte temporelle), et une date recopiee dans une note qui est rendue a
 * l'ecran, dans la FAQ, dans le JSON-LD et sur le document imprime aurait
 * diverge de `META.miseAJour` a la premiere revision.
 */
export const dateFr = (iso: string | undefined): string => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "—";
  const s = d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  // « 1er janvier » et non « 1 janvier » : la date part sur un document destine
  // a etre produit a un controleur URSSAF. Intl ne fait pas l'ordinal en fr-FR.
  return s.startsWith("1 ") ? `1er ${s.slice(2)}` : s;
};

/** Le passage du BOSS qui fonde toute la valeur de cet outil pour un loueur.
    Cite mot pour mot : c'est l'obligation qui pese sur le loueur, et c'est
    exactement ce qu'un logiciel de gestion de flotte doit savoir sortir. */
export const NOTE_OBLIGATION_LOUEUR =
  "BOSS §890 : « Il appartient aux loueurs et crédit-bailleurs de communiquer aux entreprises locataires les éléments nécessaires à l'application des règles mentionnées ci-dessus. En l'absence d'une telle information, le prix retenu sera le prix conseillé d'achat du véhicule par le constructeur au jour du début du contrat de location. » Sans le prix d'achat TTC payé par le loueur, l'employeur ne peut pas vérifier le plafonnement et sur-déclare mécaniquement.";

export const NOTE_BONUS_MALUS =
  "Ni le bonus écologique et sa majoration, ni le malus ne doivent être pris en compte pour déterminer le prix d'achat ou le prix de location (BOSS §600). Le bonus est une aide de l'État et non une remise du vendeur ; le malus est un frais d'immatriculation. Déduire le bonus du prix d'achat est l'erreur la plus répandue.";

/** La question la plus lourde de l'outil : sur un vehicule electrique de
    30 000 EUR au forfait, la reponse fait varier l'assiette de 4 500 a 1 350 EUR.
    Elle doit donc renvoyer a un texte que l'utilisateur peut ouvrir. L'URL est
    portee par SRC_ARRETE_ECO_SCORE et rendue avec les autres sources. */
export const NOTE_ECO_SCORE =
  "La condition d'éco-score est vérifiée au jour de la mise à disposition du véhicule au salarié : la version du véhicule doit figurer dans la classification établie par l'arrêté du 14 décembre 2023 fixant la liste des versions de voitures particulières électriques ayant atteint le score environnemental minimal. Cette liste n'est pas figée : elle est révisée par arrêtés modificatifs publiés au Journal officiel. Elle n'est donc volontairement PAS embarquée dans cet outil, qui vous pose la question plutôt que de répondre à votre place avec une liste périmée — mais l'arrêté fondateur est cité en source et la version applicable est celle en vigueur au jour de la mise à disposition. Un véhicule qui intègre la liste après sa mise à disposition ouvre droit à l'abattement de 70 % à compter de sa date d'intégration, sans nouvelle mise à disposition ; la période antérieure reste évaluée sans abattement.";

/** Source de l'arrete éco-score, exportee pour que l'interface puisse lier la
    question a son texte sans retaper l'URL. */
export const SOURCE_ECO_SCORE: SourceRef = SRC_ARRETE_ECO_SCORE;

export const NOTE_HYBRIDE_RECHARGEABLE =
  "Un hybride rechargeable n'a droit à rien : ni abattement, ni exclusion des frais d'électricité. Pire, la prise en charge par l'employeur des frais d'électricité engagés par le salarié à des fins personnelles doit être réintégrée dans l'assiette (BOSS §930). Cet outil ne calcule pas cette réintégration : ajoutez-la à la main.";

export const NOTE_VELO =
  "Le vélo mis à disposition d'un salarié, acheté ou loué, ne donne lieu à aucun avantage en nature par tolérance (BOSS §945), sans condition de participation ni de renonciation à un autre avantage, et cumulable avec le forfait mobilités durables et la prise en charge de l'abonnement de transport.";

export const NOTE_FLOTTE_SALARIE =
  "Lorsque plusieurs véhicules sont mis à disposition permanente d'un même salarié, le BOSS retient la valeur moyenne des prix d'achat et la valeur moyenne des primes d'assurance (BOSS §640 et §650). Cet outil calcule véhicule par véhicule et ne fait pas cette moyenne : saisissez directement les valeurs moyennes si vous êtes dans ce cas.";

export const NOTE_OPTION_ANNUELLE =
  "Le choix entre forfait et dépenses réelles appartient à l'employeur. Il peut en changer en fin d'exercice annuel, pour l'année entière écoulée et salarié par salarié, au plus tard lors de la dernière déclaration afférente à l'exercice. Il ne peut en revanche pas revendiquer rétroactivement le bénéfice d'une option pour les années antérieures (BOSS §580).";

export const NOTE_PLANCHER_FORFAIT =
  "L'évaluation forfaitaire est une évaluation MINIMALE d'ordre public : une convention collective ou un usage ne peut pas retenir moins. En revanche, une évaluation sur base réelle PEUT être inférieure au forfait, sous réserve de produire les justificatifs — carnet de bord, carnets de visite, agendas de rendez-vous (BOSS §60, §690 et §700).";

export const NOTE_REDEVANCE =
  "Quelle que soit l'évaluation retenue, forfaitaire ou réelle, lorsque le salarié verse une redevance d'un montant inférieur à cette évaluation, l'avantage en nature est évalué par différence. Si la redevance est supérieure ou égale, il n'y a pas d'avantage en nature (BOSS §950).";

export const NOTE_PAIE =
  "La valeur de l'avantage en nature figure sur le bulletin de paie pour sa valeur brute (BOSS §20) : elle est ajoutée au brut soumis à cotisations, puis déduite du net à payer, puisqu'elle n'est pas versée en espèces. La mécanique de déduction du net relève de la norme de paie et non du BOSS.";

export const NOTE_CHAMP_ASSIMILES =
  "Le champ ne se limite pas aux salariés : il couvre aussi les gérants minoritaires ou égalitaires de SARL et de SELARL, les présidents-directeurs et directeurs généraux de SA, les présidents et dirigeants de SAS, ainsi que, dans la fonction publique, les fonctionnaires pour la CSG et la CRDS et les contractuels pour l'ensemble des cotisations (BOSS §40 et §90). Un salarié rémunéré exclusivement en avantages en nature ne supporte que les cotisations patronales (BOSS §80).";

/** Deduction assumee et signalee comme telle : le BOSS ne l'ecrit nulle part. */
export const NOTE_CSG =
  "L'assiette de la CSG sur revenus d'activité est réduite d'un abattement forfaitaire de 1,75 %, plafonné à quatre fois le plafond annuel de la sécurité sociale. Les avantages en nature ne figurent pas dans la liste des exclusions du BOSS, ce dont on déduit qu'ils entrent dans le champ de cet abattement — mais le BOSS ne l'écrit pas expressément. Cet outil ne calcule aucune cotisation : il produit une assiette.";

/** Interdiction ferme, adossee a une verification de date : le BOFiP n'a pas
    suivi l'arrete du 25 fevrier 2025. */
export const NOTE_IMPOT_REVENU =
  `L'avantage en nature véhicule est imposable à l'impôt sur le revenu comme un salaire. Mais au ${dateFr(META.miseAJour)}, la doctrine fiscale publiée n'a pas été actualisée de l'arrêté du 25 février 2025 : le BOI-RSA-BASE-20-20, dans sa version du 16 avril 2024, énonce encore 9 %, 6 %, 30 % et 40 %, et un abattement électrique de 50 % plafonné à 1 800 € ; le tableau BOI-ANNX-000056, version du 1er juin 2023, dit la même chose. Cet outil calcule l'ASSIETTE SOCIALE et ne produit délibérément aucun montant étiqueté « impôt sur le revenu ».`;

/**
 * CONVENTIONS DE CALCUL assumees, exposees pour etre contestables. On prefere
 * ecrire ce qu'on a decide plutot que de le cacher dans le code : chacune de ces
 * lignes correspond a un point que le BOSS ne tranche pas.
 */
export const CONVENTIONS = {
  ordreCanonique:
    "Ordre d'application retenu : base forfaitaire ou réelle, puis plafonnement du véhicule loué, puis prorata mensuel, puis ajout des frais réels de carburant privé le cas échéant, puis abattement du véhicule électrique plafonné, puis déduction de la redevance versée par le salarié, le résultat ne pouvant pas être négatif.",
  prorataMensuel:
    "En cas de mise à disposition en cours d'année, l'évaluation forfaitaire est proportionnée au nombre de mois de mise à disposition, tout mois commencé comptant pour un mois entier (BOSS §750).",
  prorataReel:
    "Au réel, aucun prorata mensuel n'est appliqué : le prorata y est intrinsèque, le rapport des kilomètres privés aux kilomètres totaux portant sur la même période. Saisissez donc des coûts correspondant à la période réellement considérée — loyer, entretien et assurance compris. Corollaire assumé : l'évaluation forfaitaire, elle, part de montants ANNUELS qu'elle proratise. Les deux conventions ne se comparent donc que sur une année pleine, et l'outil refuse de produire l'écart forfait / réel dès que la période est plus courte.",
  redevanceMensualisee:
    "La redevance versée par le salarié est comptée sur le nombre de mois de mise à disposition, au forfait comme au réel : on ne déduit que des mensualités réellement versées.",
  electriqueForfaitNonMajore:
    "Pour un véhicule 100 % électrique, l'évaluation ne tient pas compte des frais d'électricité engagés par l'employeur pour la recharge (BOSS §900, §910 et §920). L'outil en tire deux conséquences : les montants de carburant saisis sont ignorés, et le forfait retenu est celui SANS prise en charge du carburant. Le BOSS n'écrit pas expressément la seconde.",
  carburantReelNonProratise:
    "Les frais réels de carburant à usage personnel ne sont pas proratisés : ce sont des dépenses constatées, à saisir pour la période de mise à disposition et non pour une année pleine.",
  arrondi:
    "Ni l'arrêté ni le BOSS ne fixent de règle d'arrondi pour le montant de l'avantage en nature. Le moteur n'arrondit donc rien : les montants sont conservés au centime et l'arrondi n'intervient qu'à l'affichage. Un exemple officiel du BOSS affiche « 1 933 € » pour une valeur exacte de 1 933,33 €. Corollaire sur le montant mensuel : c'est le quotient exact du montant de la période par le nombre de mois retenus, affiché arrondi au centime — son produit par le nombre de mois peut donc s'écarter de quelques centimes du montant de la période, qui seul fait foi.",
  plafondAbattementNonProratise:
    "Le plafond de l'abattement du véhicule électrique est exprimé « par an » sans règle de prorata. Il n'est donc pas proratisé ici, même pour une mise à disposition en cours d'année.",
  plafondLocationSymetrique:
    "Pour plafonner le forfait d'un véhicule loué, on retient le taux « achat » de la même configuration de carburant que le forfait de location retenu, et l'âge du véhicule au jour de la mise à disposition. Le BOSS ne le dit pas : c'est une application du souci de neutralité affiché par le BOFiP.",
  ageReference:
    "Le seuil des cinq ans est apprécié au premier jour de la période évaluée, c'est-à-dire à la date d'attribution ou au 1er janvier de l'année de calcul si l'attribution lui est antérieure. Aucun texte opposable (arrêtés, BOSS) ne fixe cette date d'appréciation : c'est une convention déclarée de l'outil.",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// POINTS A LEVER
//
// Traites comme des defauts de livraison, pas comme des details. `bloquant: true`
// signifie : la page ne se publie pas tant que le point n'est pas leve — et ce
// n'est pas qu'une intention, la page leve une erreur au niveau module et fait
// echouer le build tant qu'un point bloquant subsiste. La liste est exportee
// pour etre rendue telle quelle dans la methodologie : un point ouvert affiche
// vaut mieux qu'un point ouvert oublie.
// ─────────────────────────────────────────────────────────────────────────────

export const POINTS_A_LEVER: ReadonlyArray<{
  id: string;
  intitule: string;
  detail: string;
  bloquant: boolean;
}> = [
  {
    id: "plafond-location-taux-carburant",
    intitule: "Taux « achat » retenu pour plafonner un véhicule loué quand l'employeur paie le carburant",
    detail:
      "Le BOSS n'écrit pas quelle grille « achat » sert de référence au plafonnement lorsque l'employeur prend le carburant à sa charge. L'outil compare des configurations identiques : taux majoré si le forfait de location retenu est le forfait global carburant compris, taux de base sinon. C'est une application du souci de neutralité invoqué par le BOFiP, pas une règle publiée.",
    bloquant: false,
  },
  {
    id: "plafond-location-age",
    intitule: "Âge du véhicule retenu pour le plafonnement du véhicule loué",
    detail:
      "Le plafond suppose de choisir entre le taux « cinq ans ou moins » et le taux « plus de cinq ans », alors que la distinction d'âge n'existe pas pour un véhicule loué. L'outil retient l'âge du véhicule au premier jour de la période évaluée. Non source.",
    bloquant: false,
  },
  {
    id: "ordre-plafond-prorata-abattement",
    intitule: "Ordre d'enchaînement plafonnement, prorata, abattement électrique et redevance",
    detail:
      "Aucun texte ne fixe cet ordre. L'outil applique : plafonnement, prorata, abattement, redevance. Le plafonnement précède le prorata parce que le plafond dérive d'un forfait annuel lui-même proratisé ; l'abattement précède la redevance parce que le BOSS §950 raisonne sur « la valeur du forfait », qui inclut l'abattement.",
    bloquant: false,
  },
  {
    id: "plafond-abattement-prorata",
    intitule: "Proratisation du plafond de l'abattement du véhicule électrique",
    detail:
      "Le BOSS écrit « par an » sans préciser si le plafond suit le prorata d'une mise à disposition en cours d'année. L'outil ne le proratise pas. Une lecture inverse majorerait l'avantage des véhicules électriques attribués en cours d'année.",
    bloquant: false,
  },
  {
    id: "seuil-cinq-ans-reference",
    intitule: "Référence divergente du seuil des cinq ans entre le forfait et le réel",
    detail:
      "L'arrêté du 25 février 2025 (art. 3), comme l'arrêté du 10 décembre 2002 avant lui, écrit uniformément « lorsque le véhicule a plus de cinq ans », sans date de référence. Le BOSS, confronté au texte original (boss.gouv.fr consulté le 5 août 2026, recoupé avec la capture archive.org du 7 février 2025), glose différemment selon la méthode : « acheté depuis plus de cinq ans » au forfait (§770 et §810), donc la date d'achat par l'employeur, et au réel pour un véhicule d'occasion un âge apprécié « par rapport à la date de première mise en circulation telle qu'elle figure sur la carte grise » (§630). La divergence est donc textuelle, pas une incertitude de lecture. Aucune source opposable ne tranche le véhicule d'occasion évalué au forfait — la lettre du BOSS le rattache à la date d'achat mais s'écarte alors de la lettre de l'arrêté — ni la date à laquelle les cinq ans s'apprécient. L'outil demande les deux dates, laisse l'utilisateur déclarer la tranche et signale la divergence quand les deux dates ne placent pas le véhicule du même côté du seuil — il ne choisit pas.",
    bloquant: false,
  },
  {
    id: "renouvellement-lld",
    intitule: "Renouvellement ou prolongation d'un contrat de location sur le même véhicule et le même salarié",
    detail:
      "Le BOSS ne traite que la réattribution à un AUTRE salarié, qui emporte application des nouvelles grilles (§770). Il ne dit pas si la prolongation d'un contrat de LLD sur le même véhicule et le même salarié vaut nouvelle mise à disposition. L'outil laisse l'utilisateur saisir la date d'attribution qu'il estime opposable.",
    bloquant: false,
  },
  {
    id: "perimetre-cout-global-location",
    intitule: "Périmètre exact du coût global annuel de la location",
    detail:
      "Frais de dossier, carte grise, pénalités de restitution, prestation de véhicule de remplacement, télématique : le BOSS ne les énumère pas. Le texte est limitatif, mais l'exclusion de ces postes n'est pas écrite. L'outil ne les intègre pas.",
    bloquant: false,
  },
  {
    id: "boss-900-date",
    intitule: "Incohérence de date dans le BOSS §900",
    detail:
      "Le §900 écrit « entre le 1er janvier 2020 et le 31 janvier 2026 » alors que son titre vise les véhicules mis à disposition avant le 1er février 2025 et que l'arrêté du 25 février 2025 écrit « 31 janvier 2025 ». L'outil retient le 31 janvier 2025 : la norme supérieure et le titre de section concordent. La mention « 2026 » n'est affichée nulle part. Le même §900 porte en outre un exemple ou un véhicule attribué le 1er octobre 2025 se voit appliquer les ANCIENNES règles, ce qui contredit son propre §770 : cet exemple n'est reproduit nulle part dans cet outil, dont seul le principe de réattribution a été retenu.",
    bloquant: false,
  },
  {
    id: "boss-760-concessionnaire-forfait",
    intitule: "Forfait des constructeurs, concessionnaires et agents de marque non actualisé",
    detail:
      "Le BOSS §760 énonce encore 9 % et 6 % du prix consenti aux salariés, sans bloc « à compter du 1er février 2025 ». On ignore s'il s'agit d'un oubli de mise à jour ou d'une règle spécifique maintenue. L'outil REFUSE donc de produire une évaluation forfaitaire dans ce cas et renvoie à l'URSSAF ; il calcule en revanche l'évaluation au réel, dont le §730 est sans ambiguïté.",
    bloquant: false,
  },
  {
    id: "liste-eco-score-versions",
    intitule: "Version applicable de la liste des voitures éco-scorées",
    detail:
      "L'arrêté du 14 décembre 2023 est cité en source et son URL a été ouverte et vérifiée. Ce qui reste ouvert n'est pas le lien mais la LISTE : elle est modifiée par arrêtés publiés au Journal officiel, et l'outil n'embarque aucune de ses versions. Il vous demande donc si votre véhicule y figurait au jour de la mise à disposition, ce qui suppose de consulter la version alors en vigueur. Une réponse erronée fait varier l'assiette d'un facteur supérieur à trois.",
    bloquant: false,
  },
  {
    id: "prorata-semaines-vs-mois",
    intitule: "Cumul du prorata mensuel et de la tolérance en semaines",
    detail:
      "Sur une mise à disposition partielle, l'outil applique le prorata mensuel (mois / 12) PUIS la tolérance congés rapportée à 52 semaines. Les semaines de restitution sont donc rapportées à l'année civile et non à la période réellement considérée : sur six mois avec quatre semaines de congés, l'assiette retenue est supérieure à celle qu'on obtiendrait en rapportant ces quatre semaines aux vingt-six semaines de la période. L'écart majore l'assiette, donc il ne fait courir aucun risque de sous-déclaration, mais il n'est fondé par aucun texte : le BOSS §750 énonce les deux proratisations sans dire comment elles se combinent.",
    bloquant: false,
  },
  {
    id: "references-boss-non-verifiables",
    intitule: "Numéros de paragraphe du BOSS non revérifiés un par un",
    detail:
      "Tous les taux, plafonds et dates de ce module ont été vérifiés à la source (arrêté du 25 février 2025 sur Légifrance, BOFiP, URSSAF), et les paragraphes du seuil des cinq ans (§630, §770 et §810) l'ont été au verbatim sur boss.gouv.fr le 5 août 2026. Les autres ancrages « BOSS §XXX » cités dans les traces de calcul et les notes n'ont pas été revérifiés un par un : ils identifient un passage, ils ne fondent aucun chiffre à eux seuls.",
    bloquant: false,
  },
  {
    id: "plafonds-2027",
    intitule: "Plafonds en euros au 1er janvier 2027",
    detail:
      "Les montants revalorisés au 1er janvier 2027 ne seront publiés que vers janvier 2027. L'année 2027 est structurellement absente du sélecteur : l'ajouter sans fournir ses plafonds produit une erreur de compilation, pas un montant faux.",
    bloquant: false,
  },
  {
    id: "ir-bofip-non-actualise",
    intitule: "Doctrine fiscale non actualisée de l'arrêté du 25 février 2025",
    detail:
      "Le BOFiP publie encore les taux 9, 6, 30 et 40 % et un plafond d'abattement électrique de 1 800 €. Cet outil ne produit aucun montant d'impôt sur le revenu. Ce point deviendrait BLOQUANT si la page prétendait calculer l'impôt sur le revenu.",
    bloquant: false,
  },
  {
    id: "electrique-forfait-majore",
    intitule: "Forfait majoré « avec prise en charge du carburant » appliqué à un véhicule électrique",
    detail:
      "Le BOSS écrit que l'évaluation d'un véhicule 100 % électrique ne tient pas compte des frais d'électricité engagés par l'employeur pour la recharge (§900, §910 et §920). Il n'en tire pas explicitement la conséquence sur le choix du taux. L'outil retient le forfait SANS carburant : appliquer 20 % au lieu de 15 %, ou 67 % au lieu de 50 %, reviendrait à facturer le taux du carburant sur une assiette dont on vient de retirer l'électricité. Lecture, non citation.",
    bloquant: false,
  },
  {
    id: "eco-score-entree-tardive",
    intitule: "Véhicule qui intègre la liste éco-score après sa mise à disposition",
    detail:
      "Le BOSS §910 prévoit que l'abattement de 70 % s'applique à compter de la date d'intégration à la liste, sans nouvelle mise à disposition, la période antérieure restant évaluée sans abattement. Cet outil ne découpe pas l'année en deux périodes : saisissez deux lignes, l'une jusqu'à la date d'intégration sans éco-score, l'autre à compter de cette date avec éco-score. La règle est énoncée dans la note éco-score de la page.",
    bloquant: false,
  },
  {
    id: "csg-abattement-175",
    intitule: "Application de l'abattement d'assiette CSG de 1,75 % à l'avantage en nature véhicule",
    detail:
      "Le BOSS énumère les revenus exclus de l'abattement de 1,75 % sans y mentionner les avantages en nature, ce dont on déduit qu'ils entrent dans son champ. Il ne l'affirme jamais. Cet outil ne calcule aucune cotisation et ne fait donc aucun usage de cette déduction : elle n'est signalée que pour situer l'assiette produite.",
    bloquant: false,
  },
  {
    id: "fin-regimes-2027",
    intitule: "Clôture au 31 décembre 2027 du régime électrique et du régime des bornes",
    detail:
      "L'abattement renforcé du véhicule électrique et le régime de faveur des bornes de recharge sont bornés au 31 décembre 2027, sans qu'aucune prorogation ne soit publiée. Le moteur oppose cette clôture au véhicule électrique attribué au-delà : il retire l'abattement plutôt que de le prolonger de son propre chef. À revoir dès qu'un texte de prorogation paraît.",
    bloquant: false,
  },
  {
    id: "tolerance-conges-semaines",
    intitule: "Diviseur de la tolérance de proratisation en semaines",
    detail:
      "Le BOSS admet que l'avantage annuel soit proratisé pour tenir compte du nombre de semaines durant lesquelles le salarié ne dispose pas du véhicule, sans fixer le diviseur. L'outil retient 52 semaines. C'est une tolérance : elle doit être documentée dans le dossier de paie, pas appliquée par défaut.",
    bloquant: false,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Garde d'exhaustivite et utilitaires de formatage
//
// Redeclares localement, jamais importes d'un autre module de src/data/ : deux
// modules de donnees ne doivent pas se rendre dependants l'un de l'autre pour
// trois lignes de mise en forme.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Appelee avec une valeur que le typage rend impossible, elle ne compile que si
 * TOUS les membres de l'union ont ete traites en amont : le parametre `never`
 * deplace l'erreur a la COMPILATION, la ou un `else` ou un `default` silencieux
 * la deplacait sur un bulletin de paie.
 */
function jamais(valeur: never, contexte: string): never {
  throw new Error(`${contexte} : valeur non couverte « ${String(valeur)} »`);
}

/** Montant arrondi a l'euro : reserve aux chiffres de tete et aux comparaisons
    de synthese. */
export const eur = (v: number): string =>
  `${Math.round(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;

/** Montant au centime. C'est la forme PAR DEFAUT de cet outil : le BOSS ne fixe
    aucune regle d'arrondi de l'avantage en nature, masquer les centimes rendrait
    la trace de calcul incontrolable. */
export const eurPrecis = (v: number): string =>
  `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export const pct = (v: number): string =>
  `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;

/**
 * Vrai quand l'affichage au centime du montant MENSUEL ne se re-multiplie pas
 * exactement sur le montant de la periode affiche a cote de lui : 0,09 EUR sur
 * douze mois donnent un mensuel exact de 0,0075 EUR, affiche « 0,01 € », et
 * 0,01 x 12 ne refait pas 0,09. Le moteur est juste (il n'arrondit rien, voir
 * CONVENTIONS.arrondi) mais les deux nombres poses cote a cote semblent se
 * contredire : quand ce cas se presente, l'interface affiche la convention au
 * lieu de laisser le lecteur refaire une multiplication qui ne retombe pas.
 */
export const arrondiMensuelDivergent = (
  mensuel: number,
  annuel: number,
  mois: number,
): boolean => {
  if (mois <= 0) return false;
  const m = Math.round(mensuel * 100) / 100;
  const a = Math.round(annuel * 100) / 100;
  return Math.abs(m * mois - a) > 0.005;
};

/** Convention d'affichage du mensuel, rendue quand `arrondiMensuelDivergent`
    est vrai. Extraite de CONVENTIONS.arrondi pour etre montrable seule, au plus
    pres des deux chiffres concernes. */
export const NOTE_ARRONDI_MENSUEL =
  "Arrondi d'affichage : le montant mensuel est le quotient exact du montant de la période par le nombre de mois retenus, arrondi au centime pour l'affichage. Multiplié par le nombre de mois, il peut s'écarter de quelques centimes du montant de la période, qui seul fait foi (le moteur n'arrondit rien, voir la convention d'arrondi).";

/** Libelle d'une valeur d'enumeration. Repli sur l'identifiant : un libelle
    manquant doit se VOIR, pas disparaitre. */
export const libelleDe = <T extends string>(
  table: ReadonlyArray<{ id: T; label: string }>,
  id: T,
): string => table.find((x) => x.id === id)?.label ?? String(id);

export const libelleUsage = (u: UsagePrive): string => libelleDe(USAGES_PRIVE, u);
export const libelleMode = (m: ModeAcquisition): string => libelleDe(MODES, m);
export const libelleMethode = (m: MethodeEvaluation): string => libelleDe(METHODES, m);
export const libelleEnergie = (e: Energie): string => libelleDe(ENERGIES, e);
export const libelleAge = (a: TrancheAge): string => libelleDe(TRANCHES_AGE, a);
export const libelleRegime = (r: Regime): string => libelleDe(REGIMES, r);
export const libelleVariante = (v: VarianteForfait): string => libelleDe(VARIANTES_FORFAIT, v);
export const libelleSituationBorne = (s: SituationBorne): string =>
  libelleDe(SITUATIONS_BORNE, s);

/**
 * PHRASE DE TRAITEMENT d'une situation de borne de recharge, RENDUE TELLE
 * QUELLE par la page.
 *
 * Elle vit ici et non dans le JSX pour une raison precise : la meme regle etait
 * reconstruite a deux endroits — la trace de calcul d'`evaluerBorne` et la
 * colonne « Traitement » du tableau de la page — dans deux redactions
 * differentes, l'une portant le taux et le plafond, l'autre les retapant. Une
 * exclusion corrigee dans `REGLES_BORNE` corrige desormais les deux.
 *
 * Le plafond depend de l'ANNEE (il est revalorise chaque 1er janvier), d'ou le
 * parametre : un champ `traitement: string` fige dans la donnee aurait publie le
 * plafond d'une seule annee sous un selecteur qui en propose plusieurs.
 */
export const traitementBorne = (s: SituationBorne, annee: Annee): string => {
  const r = REGLES_BORNE[s];
  if (r.neglige) return "Avantage négligé";
  if (r.tauxExclusion === null) return "Aucune exclusion possible";
  const part = `Exclusion de ${pct(r.tauxExclusion * 100)} des dépenses réelles`;
  return r.clePlafond === null
    ? `${part}, sans plafond en euros`
    : `${part}, dans la limite de ${eurPrecis(PLAFONDS[annee][r.clePlafond])}`;
};

export const usageDe = (u: UsagePrive) => USAGES_PRIVE.find((x) => x.id === u);

export const borner = (v: number, min: number, max: number): number =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : min;

/** Bornage d'un montant en euros SANS arrondi a l'entier : contrairement au
    simulateur TVS, les assiettes d'avantage en nature portent des centimes (un
    loyer de 412,37 EUR par mois n'est pas un cas limite, c'est le cas normal). */
export const bornerMontant = (v: number, min: number, max: number): number =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v * 100) / 100)) : min;

// ─────────────────────────────────────────────────────────────────────────────
// Calendrier
//
// Tout se fait en UTC et en jours entiers. Une soustraction de dates locales
// traverserait les changements d'heure et produirait des periodes de 89,96 jours
// arrondies a 89 — soit un mois de prorata perdu sur un parc de trente lignes.
// ─────────────────────────────────────────────────────────────────────────────

const JOUR_MS = 86400000;

/** ISO `AAAA-MM-JJ` vers timestamp UTC, ou null si la chaine n'est pas une date. */
function jourUTC(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(t) ? null : t;
}

const isoDe = (t: number): string => new Date(t).toISOString().slice(0, 10);

export const premierJour = (annee: Annee): string => `${annee}-01-01`;
export const dernierJour = (annee: Annee): string => `${annee}-12-31`;

/** Rang absolu du mois d'une date : sert au comptage « tout mois commence compte
    pour un mois entier », qui est un comptage de MOIS CIVILS et non de jours. */
function rangMois(t: number): number {
  const d = new Date(t);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/**
 * REGIME applicable, deduit de la seule date qui fait foi : la date d'attribution
 * du vehicule au salarie (BOSS §770). Ni la date d'achat, ni la date de premiere
 * mise en circulation, ni la date de signature du contrat de location.
 *
 * Renvoie null si la date est absente ou illisible : le vehicule devient alors
 * NON CALCULABLE. C'est volontaire — il n'existe aucune valeur de repli
 * acceptable, les deux grilles pouvant differer d'un facteur proche de deux.
 */
export function regimeDe(dateAttribution: string): Regime | null {
  const t = jourUTC(dateAttribution);
  const bascule = jourUTC(BASCULE_REGIME);
  if (t === null || bascule === null) return null;
  return t < bascule ? "avant-2025-02-01" : "depuis-2025-02-01";
}

/**
 * Nombre de MOIS de mise a disposition retenus dans l'annee de calcul, tout mois
 * commence comptant pour un mois entier (BOSS §750).
 *
 * La date d'attribution sert ici de borne de PERIODE ; elle sert par ailleurs de
 * declencheur de REGIME dans `regimeDe`. Les deux usages sont distincts et ne
 * doivent jamais etre confondus : un vehicule attribue le 1er mars 2025 releve
 * des nouvelles grilles ET beneficie de douze mois de mise a disposition sur
 * l'annee 2026.
 */
export function moisMisADisposition(
  dateAttribution: string,
  dateRestitution: string,
  annee: Annee,
): number {
  const a0 = jourUTC(premierJour(annee));
  const a1 = jourUTC(dernierJour(annee));
  if (a0 === null || a1 === null) return 0;
  const attribution = jourUTC(dateAttribution);
  const restitution = dateRestitution ? jourUTC(dateRestitution) : a1;
  if (restitution === null) return 0;
  const debut = attribution === null ? a0 : Math.max(attribution, a0);
  const fin = Math.min(restitution, a1);
  if (fin < debut) return 0;
  return rangMois(fin) - rangMois(debut) + 1;
}

/** Premier jour de la periode reellement evaluee dans l'annee : c'est la date a
    laquelle on apprecie le seuil des cinq ans (voir CONVENTIONS.ageReference). */
export function premierJourEvalue(dateAttribution: string, annee: Annee): string {
  const a0 = jourUTC(premierJour(annee));
  const t = jourUTC(dateAttribution);
  if (a0 === null) return premierJour(annee);
  if (t === null) return premierJour(annee);
  return isoDe(Math.max(t, a0));
}

// `ageEnAnnees` (age en annees PLEINES) a ete supprimee : elle n'avait plus
// qu'un seul appelant, `trancheAgeSuggeree`, et c'est precisement l'arrondi au
// plancher qu'elle imposait qui produisait l'erreur de borne sur toute la
// sixieme annee de detention. La conserver « au cas ou » aurait laisse
// disponible, dans un module de baremes, la primitive exacte qu'il ne faut pas
// employer pour trancher un seuil.

/**
 * Tranche d'age SUGGEREE par une date, jamais imposee. Meme parti pris que la
 * methode suggeree du simulateur TVS : le BOSS emploie deux references
 * differentes selon la methode d'evaluation et ne tranche pas le cas du vehicule
 * d'occasion evalue au forfait, l'utilisateur garde donc la main et la trace de
 * calcul dit toujours ce qui a ete retenu.
 */
export const SEUIL_AGE_ANNEES = 5;

/**
 * Date a laquelle un vehicule d'origine donnee franchit le seuil des cinq ans.
 * Exportee pour que l'interface puisse la montrer plutot que de la deviner.
 */
export function dateSeuilAge(origine: string): string | null {
  const a = jourUTC(origine);
  if (a === null) return null;
  const d = new Date(a);
  d.setUTCFullYear(d.getUTCFullYear() + SEUIL_AGE_ANNEES);
  return isoDe(d.getTime());
}

export function trancheAgeSuggeree(origine: string, reference: string): TrancheAge | null {
  const a = jourUTC(origine);
  const b = jourUTC(reference);
  if (a === null || b === null) return null;
  const seuil = dateSeuilAge(origine);
  const t = seuil === null ? null : jourUTC(seuil);
  if (t === null) return null;
  // COMPARAISON DE DATES, PAS D'ANNEES PLEINES.
  //
  // La version precedente ecrivait `ageEnAnnees(...) > 5`. `ageEnAnnees` rend un
  // PLANCHER : un vehicule achete le 15 juin 2020 apprecie au 1er janvier 2026 a
  // cinq ans et six mois — donc « plus de cinq ans » — et rendait `5`, si bien
  // que `5 > 5` etant faux, l'outil le classait « cinq ans ou moins ». La fenetre
  // d'erreur n'etait pas un cas limite : c'etait TOUTE la sixieme annee de
  // detention. Consequence concrete, l'alerte de divergence contredisait
  // l'utilisateur qui avait raison et se taisait devant celui qui se trompait,
  // c'est-a-dire qu'elle poussait a sur-declarer de 50 % (15 % au lieu de 10 %).
  //
  // « Plus de cinq ans » se lit strictement : le jour meme du cinquieme
  // anniversaire, le vehicule a cinq ans, pas plus de cinq ans.
  return b > t ? "plus-5-ans" : "moins-5-ans";
}

/** Facteur de la tolerance « conges » du BOSS §750 : proratisation en semaines
    des periodes durant lesquelles le salarie ne dispose pas du vehicule. */
export const SEMAINES_ANNEE = 52;

export function facteurSemaines(semainesSansVehicule: number): number {
  const s = borner(semainesSansVehicule, 0, SEMAINES_ANNEE);
  return (SEMAINES_ANNEE - s) / SEMAINES_ANNEE;
}

// ─────────────────────────────────────────────────────────────────────────────
// Modele de saisie
// ─────────────────────────────────────────────────────────────────────────────

export type Vehicule = {
  /** Identifiant stable de ligne : cle React et cible de patch. Jamais derive de
      la saisie, sinon deux vehicules identiques fusionneraient. */
  id: string;
  libelle: string;
  quantite: number;

  /** Qualification prealable : quatre des cinq valeurs ne produisent AUCUN
      avantage en nature. */
  usagePrive: UsagePrive;

  mode: ModeAcquisition;
  methode: MethodeEvaluation;
  energie: Energie;
  /** La version figure-t-elle sur la liste éco-score au jour de la mise a
      disposition ? Question posee a l'utilisateur, jamais devinee : la liste de
      l'arrete du 14 decembre 2023 est revisee en continu par l'ADEME. */
  ecoScore: boolean;
  /** Tranche d'age DECLAREE. Les deux dates ci-dessous ne servent qu'a la
      suggerer et a signaler une divergence. */
  age: TrancheAge;

  /** LA date qui pilote la grille de taux (BOSS §770). */
  dateAttribution: string;
  /** Vide = jusqu'a la fin de l'annee de calcul. */
  dateRestitution: string;
  /** Indicatif : reference du seuil des cinq ans au forfait. */
  dateAchat: string;
  /** Indicatif : reference du seuil des cinq ans au reel pour une occasion. */
  datePremiereMiseEnCirculation: string;

  // ── Vehicule achete ──
  prixAchatTTC: number;
  reprise: number;
  /** Employeur constructeur, concessionnaire ou agent de marque mettant ses
      PROPRES vehicules a disposition de ses salaries. Cas volontairement non
      couvert au forfait, voir POINTS_A_LEVER. */
  employeurConcessionnaire: boolean;
  prixPublicTTC: number;
  rabaisConcessionnaire: number;

  // ── Vehicule loue ──
  loyerAnnuel: number;
  /** Prix d'achat TTC du vehicule PAR LE LOUEUR, communique par celui-ci.
      Zero = non communique : le plafonnement devient inverifiable et l'outil le
      dit, c'est tout l'objet de cette page. */
  prixAchatLoueurTTC: number;
  /** Prix conseille par le constructeur au jour du début du contrat. Sert de
      repli lorsque le loueur ne communique pas, et d'ecretage du rabais. */
  prixConseilleConstructeur: number;

  // ── Communs achat et location ──
  entretienAnnuel: number;
  assuranceAnnuelle: number;

  carburant: PriseEnChargeCarburant;
  /** Frais reels de carburant a usage PERSONNEL, sur factures. */
  carburantPriveAnnuel: number;
  /** Cout global du carburant utilise a des fins professionnelles ET
      personnelles : assiette du seul forfait global majore. */
  carburantTotalAnnuel: number;

  // ── Evaluation au reel ──
  kmTotaux: number;
  kmPrives: number;

  redevanceMensuelle: number;
  semainesSansVehicule: number;
};

/** Bornes de tout champ numerique. Elles servent DEUX fois : au clampage de la
    saisie et a la relecture defensive du stockage. Une saisie corrompue degrade
    la saisie, elle ne produit jamais un montant faux. */
export const BORNES = {
  quantite: { min: 1, max: 99 },
  montant: { min: 0, max: 1000000 },
  km: { min: 0, max: 500000 },
  redevance: { min: 0, max: 20000 },
  semaines: { min: 0, max: 52 },
} as const;

export const MAX_LIGNES = 30;

/**
 * PLANCHER DE PLAUSIBILITE des dates saisies. Le champ date accepte n'importe
 * quelle annee sur quatre chiffres : « 0199 » pour 1999, « 1900 » par defaut de
 * certains selecteurs — et l'outil calculait sans un mot sur ces dates, qui
 * classent silencieusement le vehicule « plus de cinq ans » et choisissent une
 * grille. Aucun vehicule de fonction ne predate 1950 : en deca, la saisie est
 * signalee en alerte (jamais bloquee — le moteur ne corrige pas une saisie, il
 * la montre).
 */
export const DATE_PLANCHER_PLAUSIBLE = "1950-01-01";

/**
 * Le parametre `annee` est conserve pour la stabilite de l'API (relecture du
 * stockage, cas de controle) mais il ne pre-remplit PLUS la date d'attribution.
 *
 * Elle valait `premierJour(annee)` : un defaut plausible sur LA date qui choisit
 * la grille de taux (9 % ou 15 %, du simple au double), si bien que le garde-fou
 * « date d'attribution absente = non calculable » ne se declenchait jamais et
 * qu'un utilisateur pouvait deriver toute une simulation d'une date qu'il
 * n'avait jamais saisie. Le module ecrit lui-meme, dans `regimeDe` : « il
 * n'existe aucune valeur de repli acceptable ». On applique : champ vide, et la
 * ligne reste non calculable tant que la date n'est pas reellement saisie.
 */
export function vehiculeVide(annee: Annee, id: string): Vehicule {
  void annee;
  return {
    id,
    libelle: "",
    quantite: 1,
    usagePrive: "permanent",
    mode: "achat",
    methode: "forfait",
    energie: "thermique",
    ecoScore: false,
    age: "moins-5-ans",
    dateAttribution: "",
    dateRestitution: "",
    dateAchat: "",
    datePremiereMiseEnCirculation: "",
    prixAchatTTC: 0,
    reprise: 0,
    employeurConcessionnaire: false,
    prixPublicTTC: 0,
    rabaisConcessionnaire: 0,
    loyerAnnuel: 0,
    prixAchatLoueurTTC: 0,
    prixConseilleConstructeur: 0,
    entretienAnnuel: 0,
    assuranceAnnuelle: 0,
    carburant: "salarie",
    carburantPriveAnnuel: 0,
    carburantTotalAnnuel: 0,
    kmTotaux: 0,
    kmPrives: 0,
    redevanceMensuelle: 0,
    semainesSansVehicule: 0,
  };
}

/** Ramene une valeur inconnue sur l'une des options d'une enumeration. */
function enumOu<T extends string>(table: ReadonlyArray<{ id: T }>, brut: unknown, repli: T): T {
  return typeof brut === "string" && table.some((x) => x.id === brut) ? (brut as T) : repli;
}

const montantOu = (brut: unknown, repli: number, min: number, max: number): number =>
  typeof brut === "number" && Number.isFinite(brut) ? bornerMontant(brut, min, max) : repli;

const entierOu = (brut: unknown, repli: number, min: number, max: number): number =>
  typeof brut === "number" && Number.isFinite(brut) ? borner(brut, min, max) : repli;

/** Date ISO valide, sinon la valeur de repli. Contrairement au simulateur TVS,
    on NE clampe PAS dans l'annee : la date d'attribution est legitimement
    anterieure a l'annee de calcul (c'est meme le cas general d'un vehicule
    attribue en 2025 et evalue en 2026), et la clamper detruirait le regime. */
function dateOu(brut: unknown, repli: string): string {
  if (typeof brut !== "string") return repli;
  if (brut === "") return "";
  return jourUTC(brut) === null ? repli : brut;
}

/**
 * Relecture defensive d'une ligne venant de `sessionStorage`. Fusion sur le
 * modele vide : on ne recopie qu'une cle qui existe dans le modele ET dont le
 * type correspond.
 */
export function normaliserVehicule(u: unknown, annee: Annee, id: string): Vehicule {
  const base = vehiculeVide(annee, id);
  if (typeof u !== "object" || u === null || Array.isArray(u)) return base;
  const o = u as Record<string, unknown>;
  const m = BORNES.montant;
  return {
    id,
    libelle: typeof o.libelle === "string" ? o.libelle.slice(0, 60) : "",
    quantite: entierOu(o.quantite, base.quantite, BORNES.quantite.min, BORNES.quantite.max),
    usagePrive: enumOu(USAGES_PRIVE, o.usagePrive, base.usagePrive),
    mode: enumOu(MODES, o.mode, base.mode),
    methode: enumOu(METHODES, o.methode, base.methode),
    energie: enumOu(ENERGIES, o.energie, base.energie),
    ecoScore: o.ecoScore === true,
    age: enumOu(TRANCHES_AGE, o.age, base.age),
    dateAttribution: dateOu(o.dateAttribution, base.dateAttribution),
    dateRestitution: dateOu(o.dateRestitution, ""),
    dateAchat: dateOu(o.dateAchat, ""),
    datePremiereMiseEnCirculation: dateOu(o.datePremiereMiseEnCirculation, ""),
    prixAchatTTC: montantOu(o.prixAchatTTC, 0, m.min, m.max),
    reprise: montantOu(o.reprise, 0, m.min, m.max),
    employeurConcessionnaire: o.employeurConcessionnaire === true,
    prixPublicTTC: montantOu(o.prixPublicTTC, 0, m.min, m.max),
    rabaisConcessionnaire: montantOu(o.rabaisConcessionnaire, 0, m.min, m.max),
    loyerAnnuel: montantOu(o.loyerAnnuel, 0, m.min, m.max),
    prixAchatLoueurTTC: montantOu(o.prixAchatLoueurTTC, 0, m.min, m.max),
    prixConseilleConstructeur: montantOu(o.prixConseilleConstructeur, 0, m.min, m.max),
    entretienAnnuel: montantOu(o.entretienAnnuel, 0, m.min, m.max),
    assuranceAnnuelle: montantOu(o.assuranceAnnuelle, 0, m.min, m.max),
    carburant: enumOu(CARBURANTS, o.carburant, base.carburant),
    carburantPriveAnnuel: montantOu(o.carburantPriveAnnuel, 0, m.min, m.max),
    carburantTotalAnnuel: montantOu(o.carburantTotalAnnuel, 0, m.min, m.max),
    kmTotaux: entierOu(o.kmTotaux, 0, BORNES.km.min, BORNES.km.max),
    kmPrives: entierOu(o.kmPrives, 0, BORNES.km.min, BORNES.km.max),
    redevanceMensuelle: montantOu(o.redevanceMensuelle, 0, BORNES.redevance.min, BORNES.redevance.max),
    semainesSansVehicule: entierOu(o.semainesSansVehicule, 0, BORNES.semaines.min, BORNES.semaines.max),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Assiettes : fonctions pures
// ─────────────────────────────────────────────────────────────────────────────

export type LigneTrace = { cle: string; texte: string };

export type AssietteAchat = {
  montant: number;
  /** Rabais effectivement retenu quand l'employeur est du secteur automobile,
      apres ecretage a 30 % du prix public. */
  rabaisRetenu: number | null;
  rabaisEcrete: boolean;
  trace: LigneTrace[];
};

/**
 * COUT D'ACHAT retenu comme assiette, du forfait comme de l'amortissement.
 *
 * Deux chemins, jamais melanges :
 *  - employeur ordinaire : prix TTC regle, diminue de la reprise de l'ancien
 *    vehicule. La remise commerciale est supposee deja deduite du prix saisi,
 *    ce que l'aide du champ dit explicitement.
 *  - employeur du secteur automobile : prix public TTC pratique pour le meme
 *    produit envers un consommateur non salarie, diminue du rabais consenti aux
 *    salaries, ECRETE a 30 % de ce prix public.
 */
export function coutAchatRetenu(v: Vehicule): AssietteAchat {
  const trace: LigneTrace[] = [];
  if (v.employeurConcessionnaire) {
    const prixPublic = Math.max(0, v.prixPublicTTC);
    const plafondRabais = prixPublic * RABAIS_MAX.part;
    const rabaisRetenu = Math.min(Math.max(0, v.rabaisConcessionnaire), plafondRabais);
    const ecrete = v.rabaisConcessionnaire > plafondRabais && prixPublic > 0;
    const montant = Math.max(0, prixPublic - rabaisRetenu);
    trace.push({
      cle: "assiette-concessionnaire",
      texte: `Employeur du secteur automobile : prix public TTC ${eurPrecis(prixPublic)} moins le rabais consenti aux salariés ${eurPrecis(rabaisRetenu)}${
        ecrete ? ` (rabais écrêté à ${pct(RABAIS_MAX.part * 100)} du prix public)` : ""
      }, soit ${eurPrecis(montant)} (${RABAIS_MAX.articleConcessionnaire}, employeur du secteur automobile).`,
    });
    return { montant, rabaisRetenu, rabaisEcrete: ecrete, trace };
  }
  const prix = Math.max(0, v.prixAchatTTC);
  const reprise = Math.min(Math.max(0, v.reprise), prix);
  const montant = prix - reprise;
  trace.push({
    cle: "assiette-achat",
    texte:
      reprise > 0
        ? `Coût d'achat retenu : prix TTC réglé ${eurPrecis(prix)} moins la reprise de l'ancien véhicule ${eurPrecis(reprise)}, soit ${eurPrecis(montant)} (BOSS §630 et §710).`
        : `Coût d'achat retenu : prix TTC réglé par l'entreprise, soit ${eurPrecis(montant)} (BOSS §710 et §810). Ni le bonus écologique ni le malus n'y sont pris en compte (BOSS §600).`,
  });
  return { montant, rabaisRetenu: null, rabaisEcrete: false, trace };
}

/**
 * COUT GLOBAL ANNUEL d'un vehicule loue.
 *
 * Deux assiettes distinctes, et c'est le piege du bareme : le forfait de base
 * porte sur « la location, l'entretien et l'assurance », tandis que le forfait
 * global majore porte sur ces trois postes PLUS le cout global du carburant
 * utilise a des fins professionnelles et personnelles. Les comparer sans
 * distinguer les assiettes revient a comparer deux nombres qui ne mesurent pas
 * la meme chose.
 */
export function coutGlobalLocation(v: Vehicule, avecCarburant: boolean): number {
  const base =
    Math.max(0, v.loyerAnnuel) + Math.max(0, v.entretienAnnuel) + Math.max(0, v.assuranceAnnuelle);
  return avecCarburant ? base + Math.max(0, v.carburantTotalAnnuel) : base;
}

export type OriginePrixReference = "loueur" | "constructeur" | "inconnu";

export type PrixReference = {
  montant: number;
  origine: OriginePrixReference;
  /** Vrai si le rabais consenti au loueur a du etre ecrete a 30 % du prix
      conseille par le constructeur. */
  rabaisEcrete: boolean;
};

/**
 * PRIX DE REFERENCE servant au plafonnement du vehicule loue (BOSS §890).
 *
 * Ordre de preference impose par le texte :
 *  1. le prix d'achat TTC du vehicule par le loueur, rabais compris, ce rabais
 *     etant retenu dans la limite de 30 % du prix conseille par le constructeur
 *     au jour du début du contrat ;
 *  2. a defaut d'information du loueur, le prix conseille par le constructeur au
 *     jour du debut du contrat.
 *
 * Si aucun des deux n'est connu, l'origine vaut « inconnu » et le plafond n'est
 * PAS calcule : afficher un plafond invente serait pire que de ne rien afficher,
 * puisque le plafond ne peut que reduire l'assiette declaree.
 */
export function prixReferencePlafond(v: Vehicule): PrixReference {
  const loueur = Math.max(0, v.prixAchatLoueurTTC);
  const conseille = Math.max(0, v.prixConseilleConstructeur);
  if (loueur > 0) {
    if (conseille > 0) {
      const plancher = conseille * (1 - RABAIS_MAX.part);
      return {
        montant: Math.max(loueur, plancher),
        origine: "loueur",
        rabaisEcrete: loueur < plancher,
      };
    }
    return { montant: loueur, origine: "loueur", rabaisEcrete: false };
  }
  if (conseille > 0) return { montant: conseille, origine: "constructeur", rabaisEcrete: false };
  return { montant: 0, origine: "inconnu", rabaisEcrete: false };
}

/**
 * Correspondance TOTALE entre la prise en charge du carburant et la variante de
 * forfait. Ternaire exhaustif clos par `jamais` : un quatrieme membre ajoute a
 * `PriseEnChargeCarburant` produirait une erreur de compilation, et non un repli
 * silencieux sur le forfait de base.
 */
export function varianteDe(c: PriseEnChargeCarburant): VarianteForfait {
  return c === "salarie"
    ? "sans-carburant"
    : c === "employeur-frais-reels"
      ? "carburant-frais-reels"
      : c === "employeur-forfait"
        ? "carburant-forfait-global"
        : jamais(c, "Prise en charge du carburant");
}

/** Variante alternative offerte a l'employeur quand il paie le carburant. Rend
    null quand il n'y a pas d'option : le salarie paie son carburant. */
export function varianteAlternative(v: VarianteForfait): VarianteForfait | null {
  return v === "carburant-frais-reels"
    ? "carburant-forfait-global"
    : v === "carburant-forfait-global"
      ? "carburant-frais-reels"
      : v === "sans-carburant"
        ? null
        : jamais(v, "Variante de forfait");
}

// ─────────────────────────────────────────────────────────────────────────────
// Moteur de calcul
// ─────────────────────────────────────────────────────────────────────────────

export type Evaluation = {
  methode: MethodeEvaluation;
  /** Null au reel : la notion de variante n'existe qu'au forfait. */
  variante: VarianteForfait | null;
  /** Faux quand une donnee indispensable manque. Le montant vaut alors 0 mais ce
      0 n'est PAS un resultat : `motifIndisponible` dit ce qui manque. */
  disponible: boolean;
  motifIndisponible: string | null;

  assiette: number;
  taux: number | null;
  base: number;

  plafond: number | null;
  plafondApplique: boolean;
  apresPlafond: number;

  mois: number;
  facteurSemaines: number;
  apresProrata: number;

  carburantAjoute: number;
  apresCarburant: number;

  abattementTaux: number | null;
  abattementPlafond: number | null;
  abattement: number;
  apresAbattement: number;

  redevance: number;

  /**
   * ASSIETTE REELLEMENT EVITEE par le plafonnement du vehicule loue, pour une
   * unite et sur la periode evaluee : `annuel sans plafond` moins `annuel`.
   *
   * Ce n'est PAS `base - plafond`. La version precedente sommait cet ecart brut,
   * mesure avant prorata, avant abattement electrique et avant redevance, ce qui
   * pouvait rendre un « evite » superieur a l'assiette de la ligne elle-meme :
   * sur une LLD de 12 000 EUR attribuee le 1er juillet, l'avantage de la ligne
   * valait 1 500 EUR et l'indicateur annoncait 3 000 EUR evites, soit le double.
   * Le chiffre etait affiche en indicateur de tete, imprime sur le document A4
   * et exporte en tableur, sous un intitule qui en faisait un argument de
   * negociation avec le loueur.
   *
   * Vaut 0 quand aucun plafond ne joue.
   */
  economiePlafond: number;

  /** Montant final de l'avantage en nature pour la periode evaluee, une unite. */
  annuel: number;
  /** Montant a porter sur chacun des bulletins de la periode de mise a
      disposition. Ce n'est PAS `annuel / 12` quand la periode est plus courte :
      c'est `annuel / mois`. */
  mensuel: number;

  trace: LigneTrace[];
};

const evaluationIndisponible = (
  methode: MethodeEvaluation,
  variante: VarianteForfait | null,
  motif: string,
): Evaluation => ({
  methode,
  variante,
  disponible: false,
  motifIndisponible: motif,
  assiette: 0,
  taux: null,
  base: 0,
  plafond: null,
  plafondApplique: false,
  apresPlafond: 0,
  mois: 0,
  facteurSemaines: 1,
  apresProrata: 0,
  carburantAjoute: 0,
  apresCarburant: 0,
  abattementTaux: null,
  abattementPlafond: null,
  abattement: 0,
  apresAbattement: 0,
  redevance: 0,
  economiePlafond: 0,
  annuel: 0,
  mensuel: 0,
  trace: [{ cle: "indisponible", texte: motif }],
});

export type DetailAbattement = {
  taux: number | null;
  plafond: number | null;
  montant: number;
  trace: LigneTrace | null;
};

/**
 * ABATTEMENT DU VEHICULE 100 % ELECTRIQUE, applique « au montant de l'evaluation
 * ainsi calculee » (BOSS §910), c'est-a-dire apres plafonnement et apres prorata.
 *
 * Trois portes a franchir, dans cet ordre :
 *  1. le vehicule est-il 100 % electrique ? Un hybride rechargeable n'a droit a
 *     rien, pas meme a l'exclusion des frais d'electricite ;
 *  2. la date d'attribution tombe-t-elle dans la fenetre du regime ? Un vehicule
 *     attribue avant le 1er janvier 2020 n'ouvre droit a aucun abattement ;
 *  3. la condition d'éco-score est-elle requise, et satisfaite ?
 *
 * Le taux depend de la METHODE d'evaluation dans le regime posterieur au
 * 1er fevrier 2025 : 70 % au forfait, 50 % au reel. C'est le piege numero un de
 * la reforme, et il joue a rebours de l'intuition — opter pour le reel sur un
 * vehicule electrique fait perdre vingt points d'abattement.
 */
export function abattementElectrique(
  v: Vehicule,
  regime: Regime,
  methode: MethodeEvaluation,
  montant: number,
  annee: Annee,
): DetailAbattement {
  const aucun = (texte: string): DetailAbattement => ({
    taux: null,
    plafond: null,
    montant: 0,
    trace: { cle: "abattement", texte },
  });

  if (v.energie === "hybride-rechargeable") return aucun(NOTE_HYBRIDE_RECHARGEABLE);
  if (v.energie === "thermique") {
    return { taux: null, plafond: null, montant: 0, trace: null };
  }
  if (v.energie !== "electrique") return jamais(v.energie, "Énergie du véhicule");

  const regle = ELECTRIQUE[regime];
  const t = jourUTC(v.dateAttribution);
  const ouverture = jourUTC(regle.debut);
  if (t !== null && ouverture !== null && t < ouverture) {
    return aucun(
      `Véhicule électrique attribué le ${dateFr(v.dateAttribution)}, soit avant l'ouverture du régime de faveur le ${dateFr(regle.debut)} : aucun abattement. Les frais d'électricité engagés par l'employeur restent hors du calcul (${regle.article}).`,
    );
  }
  const cloture = regle.finOpposable === null ? null : jourUTC(regle.finOpposable);
  if (t !== null && cloture !== null && t > cloture) {
    return aucun(
      `Véhicule électrique attribué le ${dateFr(v.dateAttribution)}, soit après la clôture du régime de faveur le ${dateFr(regle.finOpposable ?? "")} : aucun abattement n'est appliqué tant qu'aucune prorogation n'est publiée. Les frais d'électricité engagés par l'employeur restent hors du calcul (${regle.article}).`,
    );
  }
  if (regle.ecoScoreRequis && !v.ecoScore) {
    return aucun(
      `Véhicule électrique ne satisfaisant pas la condition d'éco-score au jour de la mise à disposition : barèmes normaux, aucun abattement, mais les frais d'électricité engagés par l'employeur restent hors du calcul (BOSS §920).`,
    );
  }

  const taux = methode === "forfait" ? regle.tauxForfait : regle.tauxReel;
  const clePlafond = methode === "forfait" ? regle.clePlafondForfait : regle.clePlafondReel;
  const plafond = PLAFONDS[annee][clePlafond];
  const theorique = montant * taux;
  const retenu = Math.min(theorique, plafond);
  return {
    taux,
    plafond,
    montant: retenu,
    trace: {
      cle: "abattement",
      texte: `Abattement véhicule électrique : ${pct(taux * 100)} de ${eurPrecis(montant)} = ${eurPrecis(theorique)}${
        retenu < theorique
          ? `, ramené au plafond annuel de ${eurPrecis(plafond)} (valeur au 1er janvier ${annee})`
          : `, inférieur au plafond annuel de ${eurPrecis(plafond)}`
      } (${regle.article}). Les frais d'électricité engagés par l'employeur pour la recharge ne sont pas comptés.`,
    },
  };
}

/**
 * PRIX D'ACHAT TTC AU-DELA DUQUEL LA REFORME CESSE D'ETRE NEUTRE pour un
 * vehicule 100 % electrique éco-score, achete, de cinq ans ou moins, evalue au
 * forfait — la seule configuration ou elle l'est.
 *
 * POURQUOI cette fonction existe. Comparer les seuls TAUX donne une egalite
 * exacte : 9 % diminues d'un abattement de 50 % font 4,5 %, et 15 % diminues
 * d'un abattement de 70 % font 4,5 % aussi. Mais les deux abattements ne sont
 * pas plafonnes au meme montant en euros — 2 026,30 EUR contre 4 641,60 EUR en
 * 2026 —, et le plafond ne se voit pas dans les taux. Des que l'un des deux
 * mord, les deux grilles divergent : a 100 000 EUR, l'ecart atteint 3 384,70 EUR
 * par an, soit 48 %. La page affirmait la neutralite sans reserve, en s'appuyant
 * sur une comparaison de taux, alors qu'elle publiait quelques sections plus bas
 * un cas de controle qui la contredit.
 *
 * On rend donc le PRIX de rupture, calcule : l'affirmation devient bornee, et
 * elle suivra toute correction de taux comme de plafond.
 *
 * Le premier plafond qui mord ferme la fenetre : c'est un minimum, pas une
 * moyenne.
 */
export function seuilNeutraliteElectrique(annee: Annee): number {
  const bornes = REGIMES.map(({ id: regime }) => {
    const el = ELECTRIQUE[regime];
    const taux = TAUX_FORFAIT_ACHAT[regime].moins5ans.sansCarburant;
    const plafond = PLAFONDS[annee][el.clePlafondForfait];
    return plafond / (taux * el.tauxForfait);
  });
  return Math.min(...bornes);
}

/**
 * Chaine de finalisation commune au forfait et au reel. Elle materialise
 * l'ordre canonique declare dans CONVENTIONS.ordreCanonique, en un seul endroit :
 * une divergence d'ordre entre deux chemins de calcul serait invisible a l'oeil
 * et fausserait la comparaison forfait / reel, qui est la raison d'etre de la page.
 */
function finaliser(
  v: Vehicule,
  annee: Annee,
  regime: Regime,
  methode: MethodeEvaluation,
  variante: VarianteForfait | null,
  entree: {
    assiette: number;
    taux: number | null;
    base: number;
    plafond: number | null;
    /** Faux au reel : le prorata y est intrinsèque (BOSS §750 ne vise que
        l'evaluation forfaitaire). */
    proratiser: boolean;
    trace: LigneTrace[];
  },
): Evaluation {
  const trace = [...entree.trace];

  // 1. Plafonnement (vehicule loue au forfait, uniquement).
  const plafondApplique = entree.plafond !== null && entree.base > entree.plafond;
  const apresPlafond = plafondApplique && entree.plafond !== null ? entree.plafond : entree.base;
  if (entree.plafond !== null) {
    trace.push({
      cle: "plafond",
      texte: plafondApplique
        ? `Plafonnement : l'évaluation forfaitaire ${eurPrecis(entree.base)} dépasse le montant qui aurait été retenu si l'employeur avait acheté le véhicule, soit ${eurPrecis(entree.plafond)}. Assiette ramenée à ${eurPrecis(entree.plafond)} (BOSS §890).`
        : `Plafonnement vérifié : l'évaluation forfaitaire ${eurPrecis(entree.base)} reste inférieure au montant qui aurait été retenu à l'achat, soit ${eurPrecis(entree.plafond)} (BOSS §890). Le plafond ne joue pas.`,
    });
  }

  // 2. Prorata mensuel et tolerance des semaines de restitution.
  const mois = moisMisADisposition(v.dateAttribution, v.dateRestitution, annee);
  const fSemaines = facteurSemaines(v.semainesSansVehicule);
  const apresProrata = entree.proratiser ? (apresPlafond * mois) / 12 * fSemaines : apresPlafond;
  if (entree.proratiser && mois !== 12) {
    trace.push({
      cle: "prorata",
      texte: `Prorata : ${mois} mois de mise à disposition sur 12, tout mois commencé comptant pour un mois entier (BOSS §750). ${eurPrecis(apresPlafond)} x ${mois} / 12 = ${eurPrecis((apresPlafond * mois) / 12)}.`,
    });
  }
  if (entree.proratiser && fSemaines < 1) {
    trace.push({
      cle: "semaines",
      texte: `Tolérance congés : ${borner(v.semainesSansVehicule, 0, SEMAINES_ANNEE)} semaines durant lesquelles le salarié ne dispose pas du véhicule, soit un facteur de ${pct(fSemaines * 100)} (BOSS §750). Cette proratisation en semaines est une tolérance, à documenter dans le dossier de paie.`,
    });
  }

  // 3. Frais reels de carburant a usage personnel, NON proratises : ce sont des
  //    depenses constatees et non un forfait annuel.
  const ajouteCarburant =
    variante === "carburant-frais-reels" || (methode === "reel" && v.carburant !== "salarie");
  const carburantAjoute = ajouteCarburant ? Math.max(0, v.carburantPriveAnnuel) : 0;
  const apresCarburant = apresProrata + carburantAjoute;
  if (ajouteCarburant) {
    trace.push({
      cle: "carburant",
      texte: `Carburant à usage personnel pris en charge par l'employeur : ${eurPrecis(carburantAjoute)} de frais réels justifiés par factures, ajoutés sans proratisation.`,
    });
  }

  // 4. Abattement du vehicule electrique, plafonne.
  const abat = abattementElectrique(v, regime, methode, apresCarburant, annee);
  if (abat.trace) trace.push(abat.trace);
  const apresAbattement = apresCarburant - abat.montant;

  // 5. Redevance versee par le salarie : minoration a due concurrence, sans
  //    jamais passer sous zero (BOSS §70 et §950).
  //
  //    Le nombre de mois retenu est celui de la mise a disposition, au forfait
  //    COMME au reel. La version precedente comptait douze mois au reel, au
  //    motif que le reel n'est pas proratise : c'etait un contresens de sens
  //    dangereux. Le reel n'est pas proratise parce que son assiette porte deja
  //    sur la seule periode consideree ; deduire douze redevances d'une assiette
  //    de sept mois retranchait cinq mensualites que le salarie n'a jamais
  //    versees, donc minorait l'avantage declare. Une erreur qui minore une
  //    assiette sociale est celle qui coute un redressement.
  const redevance = Math.max(0, v.redevanceMensuelle) * mois;
  const annuel = Math.max(0, apresAbattement - redevance);
  if (redevance > 0) {
    trace.push({
      cle: "redevance",
      texte:
        apresAbattement > redevance
          ? `Redevance versée par le salarié : ${eurPrecis(redevance)} déduits de ${eurPrecis(apresAbattement)}, l'avantage étant évalué par différence (BOSS §950).`
          : `Redevance versée par le salarié (${eurPrecis(redevance)}) supérieure ou égale à l'évaluation (${eurPrecis(apresAbattement)}) : il n'y a pas d'avantage en nature (BOSS §950).`,
    });
  }

  // 6. Assiette REELLEMENT evitee par le plafonnement du vehicule loue.
  //
  //    On rejoue la MEME chaine sans plafond et on compare les deux montants
  //    FINAUX. Mesurer l'ecart sur la base annuelle (`base - plafond`), comme le
  //    faisait la version precedente, revenait a compter une economie avant
  //    prorata, avant abattement electrique et avant redevance : sur une ligne
  //    attribuee en cours d'annee, l'« evite » pouvait valoir le double de
  //    l'assiette de la ligne, et ce chiffre etait publie en indicateur de tete.
  //
  //    La recursion est bornee a un niveau : avec `plafond: null`,
  //    `plafondApplique` est faux et la branche n'est pas reprise.
  const economiePlafond = plafondApplique
    ? Math.max(
        0,
        finaliser(v, annee, regime, methode, variante, { ...entree, plafond: null }).annuel -
          annuel,
      )
    : 0;

  return {
    methode,
    variante,
    disponible: true,
    motifIndisponible: null,
    assiette: entree.assiette,
    taux: entree.taux,
    base: entree.base,
    plafond: entree.plafond,
    plafondApplique,
    apresPlafond,
    mois,
    facteurSemaines: fSemaines,
    apresProrata,
    carburantAjoute,
    apresCarburant,
    abattementTaux: abat.taux,
    abattementPlafond: abat.plafond,
    abattement: abat.montant,
    apresAbattement,
    redevance,
    economiePlafond,
    annuel,
    mensuel: mois > 0 ? annuel / mois : 0,
    trace,
  };
}

export type DetailPlafond = {
  montantAnnuel: number;
  prixReference: number;
  origine: OriginePrixReference;
  taux: number;
  rabaisEcrete: boolean;
};

/**
 * PLAFOND du forfait d'un vehicule loue : le montant qui aurait ete retenu si
 * l'employeur avait achete le vehicule.
 *
 * Deux choix ne sont PAS ecrits par le BOSS et sont declares dans
 * POINTS_A_LEVER : le taux « achat » retenu quand l'employeur paie le carburant
 * (on compare des configurations identiques) et l'age retenu, la distinction
 * d'age n'existant pas cote location.
 *
 * Rend null quand ni le loueur ni le prix constructeur ne sont connus : c'est
 * exactement la situation que le BOSS §890 met a la charge du loueur, et c'est
 * l'information que la page reclame.
 */
export function plafondForfaitLocation(
  v: Vehicule,
  regime: Regime,
  variante: VarianteForfait,
): DetailPlafond | null {
  const ref = prixReferencePlafond(v);
  if (ref.origine === "inconnu" || ref.montant <= 0) return null;
  const couple = TAUX_FORFAIT_ACHAT[regime][v.age === "plus-5-ans" ? "plus5ans" : "moins5ans"];
  const taux =
    variante === "carburant-forfait-global" ? couple.forfaitGlobal : couple.sansCarburant;
  return {
    montantAnnuel: ref.montant * taux,
    prixReference: ref.montant,
    origine: ref.origine,
    taux,
    rabaisEcrete: ref.rabaisEcrete,
  };
}

/** Evaluation FORFAITAIRE d'une variante donnee, sous un regime donne. Le regime
    est un parametre explicite et non deduit dans la fonction : c'est ce qui
    permet de rejouer le meme vehicule sous l'autre grille pour montrer l'effet
    de la reforme. */
export function evaluerForfait(
  v: Vehicule,
  annee: Annee,
  regime: Regime,
  variante: VarianteForfait,
): Evaluation {
  const trace: LigneTrace[] = [];

  if (v.mode === "achat") {
    if (v.employeurConcessionnaire) {
      return evaluationIndisponible(
        "forfait",
        variante,
        "Employeur constructeur, concessionnaire ou agent de marque : le BOSS §760 énonce encore un forfait de 9 % (6 % au-delà de cinq ans) du prix consenti aux salariés, sans bloc « à compter du 1er février 2025 ». Cet outil refuse de trancher entre un oubli de mise à jour et une règle spécifique maintenue : rapprochez-vous de votre URSSAF. L'évaluation au réel, elle, est calculée ci-dessous.",
      );
    }
    const assiette = coutAchatRetenu(v);
    if (assiette.montant <= 0) {
      return evaluationIndisponible(
        "forfait",
        variante,
        "Coût d'achat TTC non renseigné : aucun forfait n'est calculé. Un montant de 0 € affiché sur une assiette vide serait une sous-déclaration silencieuse.",
      );
    }
    trace.push(...assiette.trace);
    // La GRILLE porte l'article et la source ; le COUPLE ne porte que deux taux.
    // Les deux etaient confondus dans une seule variable, ce qui rendait
    // `grille.article` indisponible : on separe, plutot que d'aplatir l'article
    // dans `CoupleTaux` — un couple de taux n'a pas de source propre, c'est la
    // grille entiere qui en a une.
    const grille = TAUX_FORFAIT_ACHAT[regime];
    const couple = grille[v.age === "plus-5-ans" ? "plus5ans" : "moins5ans"];
    const taux =
      variante === "carburant-forfait-global" ? couple.forfaitGlobal : couple.sansCarburant;
    const base = assiette.montant * taux;
    trace.push({
      cle: "forfait",
      texte: `Forfait ${libelleVariante(variante).toLowerCase()} : ${pct(taux * 100)} de ${eurPrecis(assiette.montant)} = ${eurPrecis(base)} pour une année pleine (${grille.article}, véhicule ${libelleAge(v.age).toLowerCase()}).`,
    });
    return finaliser(v, annee, regime, "forfait", variante, {
      assiette: assiette.montant,
      taux,
      base,
      plafond: null,
      proratiser: true,
      trace,
    });
  }

  if (v.mode !== "location") return jamais(v.mode, "Mode d'acquisition");

  const avecCarburant = variante === "carburant-forfait-global";
  const assiette = coutGlobalLocation(v, avecCarburant);
  if (assiette <= 0) {
    return evaluationIndisponible(
      "forfait",
      variante,
      "Coût global annuel non renseigné : saisissez au minimum le loyer annuel toutes taxes comprises, l'entretien et l'assurance.",
    );
  }
  const grille = TAUX_FORFAIT_LOCATION[regime];
  const taux = avecCarburant ? grille.taux.forfaitGlobal : grille.taux.sansCarburant;
  const base = assiette * taux;
  trace.push({
    cle: "forfait",
    texte: `Forfait ${libelleVariante(variante).toLowerCase()} : ${pct(taux * 100)} du coût global annuel de ${eurPrecis(assiette)}${
      avecCarburant
        ? " (location, entretien, assurance et coût global du carburant professionnel et personnel)"
        : " (location, entretien et assurance)"
    } = ${eurPrecis(base)} (${grille.article}). Aucune distinction d'âge ne s'applique à un véhicule loué.`,
  });

  const plafond = plafondForfaitLocation(v, regime, variante);
  if (plafond === null) {
    trace.push({
      cle: "plafond-inconnu",
      texte: NOTE_OBLIGATION_LOUEUR,
    });
  } else {
    trace.push({
      cle: "plafond-reference",
      texte: `Prix de référence du plafonnement : ${eurPrecis(plafond.prixReference)} — ${
        plafond.origine === "loueur"
          ? "prix d'achat TTC du véhicule par le loueur, communiqué par celui-ci"
          : "à défaut d'information du loueur, prix conseillé par le constructeur au jour du début du contrat"
      }${plafond.rabaisEcrete ? `, après écrêtage du rabais à ${pct(RABAIS_MAX.part * 100)} du prix conseillé` : ""} (${RABAIS_MAX.articlePrixReferenceLocation}). Plafond = ${pct(plafond.taux * 100)} x ${eurPrecis(plafond.prixReference)} = ${eurPrecis(plafond.montantAnnuel)}.`,
    });
  }

  return finaliser(v, annee, regime, "forfait", variante, {
    assiette,
    taux,
    base,
    plafond: plafond === null ? null : plafond.montantAnnuel,
    proratiser: true,
    trace,
  });
}

/**
 * Evaluation AU REEL, achat ou location.
 *
 * Achat : amortissement (20 % du cout d'achat TTC, 10 % au-dela de cinq ans),
 * plus l'assurance, plus les frais d'entretien courants, le tout rapporte au
 * rapport des kilomètres prives aux kilomètres totaux de la meme periode.
 *
 * Location : cout global de la location, plus l'entretien, plus l'assurance,
 * meme rapport kilometrique. Il n'existe AUCUN plafonnement du reel : le
 * plafonnement des §860 et §890 est ecrit dans la seule section consacree a
 * l'evaluation forfaitaire.
 */
export function evaluerReel(v: Vehicule, annee: Annee, regime: Regime): Evaluation {
  const trace: LigneTrace[] = [];
  const kmTotaux = Math.max(0, v.kmTotaux);
  const kmPrives = Math.min(Math.max(0, v.kmPrives), kmTotaux);
  if (kmTotaux <= 0) {
    return evaluationIndisponible(
      "reel",
      null,
      "Kilométrage total non renseigné : l'évaluation au réel repose sur le rapport des kilomètres privés aux kilomètres totaux de la même période, justifié par un carnet de bord.",
    );
  }

  let assiette = 0;
  if (v.mode === "achat") {
    const cout = coutAchatRetenu(v);
    if (cout.montant <= 0) {
      return evaluationIndisponible(
        "reel",
        null,
        "Coût d'achat TTC non renseigné : l'amortissement ne peut pas être calculé.",
      );
    }
    trace.push(...cout.trace);
    const tauxAmort =
      v.age === "plus-5-ans" ? AMORTISSEMENT_REEL.plus5ans : AMORTISSEMENT_REEL.moins5ans;
    const amortissement = cout.montant * tauxAmort;
    assiette = amortissement + Math.max(0, v.assuranceAnnuelle) + Math.max(0, v.entretienAnnuel);
    trace.push({
      cle: "reel-achat",
      texte: `Dépenses réelles : amortissement ${pct(tauxAmort * 100)} de ${eurPrecis(cout.montant)} = ${eurPrecis(amortissement)}, plus l'assurance ${eurPrecis(Math.max(0, v.assuranceAnnuelle))} et l'entretien courant ${eurPrecis(Math.max(0, v.entretienAnnuel))}, soit ${eurPrecis(assiette)} (${AMORTISSEMENT_REEL.article}). Les franchises d'assurance et les remises en état consécutives à un sinistre sont exclues.`,
    });
  } else if (v.mode === "location") {
    assiette = coutGlobalLocation(v, false);
    if (assiette <= 0) {
      return evaluationIndisponible(
        "reel",
        null,
        "Coût global de la location non renseigné : saisissez le loyer, l'entretien et l'assurance.",
      );
    }
    trace.push({
      cle: "reel-location",
      texte: `Dépenses réelles : coût global annuel de la location ${eurPrecis(Math.max(0, v.loyerAnnuel))}, plus l'entretien ${eurPrecis(Math.max(0, v.entretienAnnuel))} et l'assurance ${eurPrecis(Math.max(0, v.assuranceAnnuelle))}, soit ${eurPrecis(assiette)} (BOSS §740). Aucun plafonnement ne s'applique à l'évaluation au réel.`,
    });
  } else {
    return jamais(v.mode, "Mode d'acquisition");
  }

  const ratio = kmPrives / kmTotaux;
  const base = assiette * ratio;
  trace.push({
    cle: "reel-ratio",
    // L'EGALITE EST POSEE SUR LA FRACTION, PAS SUR LE TAUX ARRONDI. La redaction
    // precedente ecrivait « 5 800,00 EUR x 33,33 % = 1 933,33 EUR » : le moteur
    // calcule bien 1/3, mais `pct()` arrondit le taux a deux decimales, si bien
    // que la trace posait une egalite fausse de 0,19 EUR. Un gestionnaire de paie
    // qui refait le calcul a la main sur la piece produite a l'URSSAF en conclut
    // que l'outil est faux. Le taux arrondi reste affiche comme INDICATION
    // (« soit 33,33 % »), jamais comme facteur de l'egalite.
    texte: `Quote-part privée : ${kmPrives.toLocaleString("fr-FR")} km privés sur ${kmTotaux.toLocaleString("fr-FR")} km parcourus, soit environ ${pct(ratio * 100)}. ${eurPrecis(assiette)} x ${kmPrives.toLocaleString("fr-FR")} / ${kmTotaux.toLocaleString("fr-FR")} = ${eurPrecis(base)}.`,
  });

  return finaliser(v, annee, regime, "reel", null, {
    assiette,
    taux: ratio,
    base,
    plafond: null,
    // Au reel, aucun prorata mensuel : il est intrinsèque au rapport
    // kilometrique, qui porte « sur la meme periode ». Le proratiser une seconde
    // fois diviserait deux fois le meme montant.
    proratiser: false,
    trace,
  });
}

export type StatutVehicule = "evalue" | "pas-d-avantage" | "non-calculable";

export type ResultatVehicule = {
  id: string;
  statut: StatutVehicule;
  motifStatut: string | null;
  regime: Regime | null;
  mois: number;
  /** Une ou deux variantes forfaitaires : deux des que l'employeur prend le
      carburant en charge, puisque les deux options sont a son choix. */
  forfaits: ReadonlyArray<Evaluation>;
  forfaitRetenu: Evaluation | null;
  reel: Evaluation | null;
  /** L'evaluation qui correspond a la methode declaree par l'employeur. */
  retenu: Evaluation | null;
  /** Forfait retenu moins reel, en euros sur la periode. Positif = le reel est
      plus favorable. Null si l'une des deux evaluations est indisponible OU si
      la periode ne couvre pas l'annee entiere : les deux methodes ne portent
      alors pas la meme convention de periode et leur difference ne mesurerait
      qu'un ecart de convention (voir CONVENTIONS.prorataReel). */
  ecartForfaitReel: number | null;
  /** Ce que l'employeur aurait declare s'il avait achete le vehicule : c'est la
      valeur du plafond, et donc la comparaison achat / location. */
  equivalentAchat: DetailPlafond | null;
  /** Le meme vehicule sous l'AUTRE grille de dates : mesure l'effet de l'arrete
      du 25 fevrier 2025 sur ce dossier precis. */
  contrefactuel: { regime: Regime; annuel: number } | null;
  quantite: number;
  totalAnnuel: number;
  totalMensuel: number;
  /** Incoherences de SAISIE. La ligne est calculee quand meme, mais le resultat
      n'est pas opposable en l'etat. Rendues a l'ecran ET sur le recapitulatif
      imprime : un 0 EUR silencieux sur une saisie plausible est le seul chemin
      qui produit une sous-declaration. */
  alertes: string[];
  trace: LigneTrace[];
};

/**
 * Calcul d'UNE ligne. Fonction pure : memes entrees, memes sorties, aucun acces
 * au DOM ni au stockage. C'est ce qui permet de la rejouer dans
 * `verifierBaremes()` au build, et la raison pour laquelle rien de normatif ne
 * vit dans le JSX.
 */
export function calculerVehicule(v: Vehicule, annee: Annee): ResultatVehicule {
  const trace: LigneTrace[] = [];
  const alertes: string[] = [];
  const quantite = borner(v.quantite, BORNES.quantite.min, BORNES.quantite.max);
  const mois = moisMisADisposition(v.dateAttribution, v.dateRestitution, annee);

  // ── 0. Plausibilite des dates ──────────────────────────────────────────────
  // Une date lisible mais invraisemblable (01/01/1900) est une faute de frappe
  // dans l'immense majorite des cas, et elle pilote la tranche d'age comme la
  // grille. On la signale sur TOUS les chemins, y compris les lignes non
  // calculables : `vide()` reprend `alertes`.
  const plancherPlausible = jourUTC(DATE_PLANCHER_PLAUSIBLE);
  for (const [libelleDate, brutDate] of [
    ["d'attribution au salarié", v.dateAttribution],
    ["de restitution", v.dateRestitution],
    ["d'achat par l'employeur", v.dateAchat],
    ["de première mise en circulation", v.datePremiereMiseEnCirculation],
  ] as ReadonlyArray<[string, string]>) {
    const t = jourUTC(brutDate);
    if (plancherPlausible !== null && t !== null && t < plancherPlausible) {
      alertes.push(
        `Date ${libelleDate} saisie au ${dateFr(brutDate)}, antérieure au ${dateFr(DATE_PLANCHER_PLAUSIBLE)} : vraisemblablement une erreur de saisie (année tronquée ou faute de frappe). Le calcul l'utilise telle quelle — vérifiez-la avant de déclarer.`,
      );
    }
  }

  const vide = (statut: StatutVehicule, motif: string): ResultatVehicule => ({
    id: v.id,
    statut,
    motifStatut: motif,
    regime: regimeDe(v.dateAttribution),
    mois,
    forfaits: [],
    forfaitRetenu: null,
    reel: null,
    retenu: null,
    ecartForfaitReel: null,
    equivalentAchat: null,
    contrefactuel: null,
    quantite,
    totalAnnuel: 0,
    totalMensuel: 0,
    alertes,
    trace: [...trace, { cle: "statut", texte: motif }],
  });

  // ── 1. Y a-t-il seulement un avantage en nature ? ───────────────────────────
  // Quatre des cinq situations n'en produisent aucun. « Pas d'avantage en
  // nature » et « avantage de 0 EUR » ne sont pas la meme chose sur un bulletin
  // de paie : le premier ne s'y inscrit pas, le second devrait y figurer.
  const usage = usageDe(v.usagePrive);
  if (usage && !usage.avantage) {
    return vide(
      "pas-d-avantage",
      `Aucun avantage en nature : ${usage.label.toLowerCase()} (${usage.article}). Rien n'est à porter au bulletin de paie à ce titre.`,
    );
  }

  // ── 2. Le regime, et rien d'autre que la date d'attribution ────────────────
  const regime = regimeDe(v.dateAttribution);
  if (regime === null) {
    return vide(
      "non-calculable",
      "Date d'attribution du véhicule au salarié absente ou illisible. C'est la seule date qui détermine la grille applicable (BOSS §770) : sans elle, aucun calcul n'est possible, les deux grilles pouvant différer de près du simple au double.",
    );
  }
  trace.push({
    cle: "regime",
    texte: `Grille applicable : ${libelleRegime(regime)}, déterminée par la date d'attribution au salarié du ${dateFr(v.dateAttribution)} — ni la date d'achat, ni la date de première mise en circulation, ni la date de signature du contrat de location (BOSS §770).`,
  });
  const tRest = jourUTC(v.dateRestitution);
  const tAttr = jourUTC(v.dateAttribution);
  if (tRest !== null && tAttr !== null && tRest < tAttr) {
    alertes.push(
      `Saisie incohérente : la restitution (${dateFr(v.dateRestitution)}) précède l'attribution (${dateFr(v.dateAttribution)}).`,
    );
  }

  // ── 2 bis. AUCUN MOIS DANS L'ANNEE DE CALCUL ───────────────────────────────
  //
  // La ligne devient NON CALCULABLE, et non « evaluee a 0 EUR ». C'est le
  // correctif le plus important de cette revision.
  //
  // Avant : `mois === 0` ne levait qu'une alerte, et le calcul continuait. Au
  // forfait, le prorata ramenait bien l'assiette a zero ; au REEL, le prorata
  // n'est pas applique (il est cense etre intrinsèque au rapport kilometrique),
  // si bien qu'un vehicule totalement absent de l'annee sortait avec son
  // assiette PLEINE — 3 000 EUR sur un vehicule de 30 000 EUR restitue l'annee
  // precedente — accompagnee d'une alerte affirmant « le 0 EUR affiche n'est pas
  // opposable » alors que l'outil n'affichait pas 0 EUR, et d'un recapitulatif
  // A4 portant « Mois : 0 · Mensuel : 0,00 EUR · Total periode : 3 000,00 EUR ».
  // Le chemin n'avait rien d'exotique : le selecteur d'annee est le premier
  // controle de la page et le parc est restaure depuis sessionStorage, si bien
  // qu'une simple bascule de 2026 vers 2025 suffisait a fabriquer une assiette.
  //
  // Refuser de calculer est la seule sortie honnete : sans mois dans l'annee, il
  // n'y a pas de periode a evaluer, donc rien a porter en DSN a ce titre, et la
  // ligne ne doit pas entrer dans le total du parc.
  if (mois === 0) {
    return vide(
      "non-calculable",
      `Aucun mois de mise à disposition sur l'année ${annee} : la date d'attribution (${dateFr(v.dateAttribution)}) et la date de restitution (${dateFr(v.dateRestitution) === "—" ? "non renseignée" : dateFr(v.dateRestitution)}) ne laissent aucun mois dans l'année de calcul. Rien n'est évalué à ce titre pour ${annee} : vérifiez les dates, ou changez d'année de référence.`,
    );
  }

  // ── 2 ter. Tolerance conges portee a l'annee entiere ───────────────────────
  // 52 semaines sans vehicule est une valeur admise par les bornes de saisie et
  // elle annule l'evaluation forfaitaire. Le resultat est alors 0 EUR avec le
  // statut « evalue », ce qui est defendable — mais un 0 EUR silencieux sur une
  // saisie plausible est exactement le chemin qui produit une sous-declaration.
  if (borner(v.semainesSansVehicule, 0, SEMAINES_ANNEE) >= SEMAINES_ANNEE) {
    alertes.push(
      `Tolérance congés portée à ${SEMAINES_ANNEE} semaines, soit l'année entière : l'évaluation forfaitaire est ramenée à 0 €. Un salarié qui ne dispose du véhicule aucune semaine de l'année n'est pas dans le champ de la tolérance du BOSS §750, qui vise des périodes de restitution : il n'y a alors pas de mise à disposition du tout. Vérifiez cette saisie avant de porter 0 € au bulletin de paie.`,
    );
  }

  // ── 3. Divergence du seuil des cinq ans ────────────────────────────────────
  // Le BOSS ecrit « achete depuis plus de cinq ans » au forfait (§770 et §810)
  // et apprecie l'age « par rapport a la date de premiere mise en circulation »
  // au reel pour une occasion (§630) — verbatims confrontes au texte original le
  // 5 aout 2026. La divergence est textuelle, et le BOSS ne tranche pas le cas
  // de l'occasion evaluee au forfait. On ne choisit pas a la place de
  // l'utilisateur : on lui montre l'ecart.
  const reference = premierJourEvalue(v.dateAttribution, annee);
  const parAchat = v.dateAchat ? trancheAgeSuggeree(v.dateAchat, reference) : null;
  const parCirculation = v.datePremiereMiseEnCirculation
    ? trancheAgeSuggeree(v.datePremiereMiseEnCirculation, reference)
    : null;
  if (parAchat !== null && parCirculation !== null && parAchat !== parCirculation) {
    alertes.push(
      `Seuil des cinq ans divergent : la date d'achat par l'employeur (${dateFr(v.dateAchat)}) donne « ${libelleAge(parAchat).toLowerCase()} », la première mise en circulation (${dateFr(v.datePremiereMiseEnCirculation)}) donne « ${libelleAge(parCirculation).toLowerCase()} ». Le BOSS écrit « acheté depuis plus de cinq ans » au forfait (§770 et §810) et retient la première mise en circulation au réel pour un véhicule d'occasion (§630), sans trancher le cas de l'occasion évaluée au forfait. Vous avez déclaré « ${libelleAge(v.age).toLowerCase()} ».`,
    );
  } else if (v.mode === "achat" && parAchat !== null && parAchat !== v.age) {
    alertes.push(
      `Le seuil des cinq ans déclaré (« ${libelleAge(v.age).toLowerCase()} ») ne correspond pas à la date d'achat saisie (${dateFr(v.dateAchat)}), qui donnerait « ${libelleAge(parAchat).toLowerCase()} » au ${dateFr(reference)}.`,
    );
  }

  // ── 4. Coherence de la saisie carburant ────────────────────────────────────
  if (v.carburant === "employeur-forfait" && v.methode === "reel") {
    alertes.push(
      "L'option du forfait global majoré n'existe qu'au forfait. Au réel, la prise en charge du carburant se traduit par l'ajout des frais réels de carburant à usage personnel, sur factures.",
    );
  }
  if (v.carburant === "employeur-forfait" && v.mode === "location" && v.carburantTotalAnnuel <= 0) {
    alertes.push(
      "Forfait global majoré retenu sans coût global de carburant : l'assiette de ce forfait intègre le carburant utilisé à des fins professionnelles ET personnelles (BOSS §880). Sans ce montant, le forfait affiché est sous-évalué.",
    );
  }
  if (v.carburant === "employeur-frais-reels" && v.carburantPriveAnnuel <= 0) {
    alertes.push(
      "Prise en charge du carburant déclarée sans frais réels de carburant à usage personnel : cette option ajoute au forfait de base les dépenses justifiées par factures. Sans elles, l'évaluation est incomplète.",
    );
  }
  if (v.energie === "electrique" && v.carburant !== "salarie") {
    alertes.push(
      "Véhicule 100 % électrique : les frais d'électricité engagés par l'employeur pour la recharge ne sont jamais comptés (BOSS §900, §910 et §920). Les montants de carburant saisis sont ignorés, et le forfait retenu est celui SANS prise en charge du carburant — retenir le forfait majoré reviendrait à tenir compte de ces mêmes frais d'électricité. Ce raisonnement est déduit du texte, il n'y est pas écrit : voir le point « electrique-forfait-majore ».",
    );
  }
  if (v.energie === "hybride-rechargeable") {
    alertes.push(NOTE_HYBRIDE_RECHARGEABLE);
  }

  // Un vehicule electrique n'a jamais de carburant a ajouter : on neutralise la
  // saisie plutot que de la laisser gonfler l'assiette. La regle vit ICI, dans
  // le module de donnees, et non dans l'interface : deux affichages de la meme
  // regle ne doivent pas pouvoir diverger.
  //
  // On neutralise AUSSI le mode de prise en charge, et pas seulement les
  // montants. Laisser `carburant` a « employeur-forfait » aurait applique le
  // taux majore (20 % au lieu de 15 % a l'achat, 67 % au lieu de 50 % en
  // location) a une assiette dont on vient precisement de retirer l'electricite :
  // on aurait paye le taux du carburant sans en avoir l'assiette, alors que le
  // BOSS ecrit que l'evaluation « ne tient pas compte des frais d'electricite
  // engages par l'employeur pour la recharge du vehicule ». C'est une lecture,
  // pas une citation — elle est declaree dans POINTS_A_LEVER et figee par un cas
  // de controle.
  const vc: Vehicule =
    v.energie === "electrique"
      ? { ...v, carburant: "salarie", carburantPriveAnnuel: 0, carburantTotalAnnuel: 0 }
      : v;

  // ── 4 bis. Plafonnement inverifiable : une ALERTE, pas seulement une note ──
  // Sans prix d'achat du loueur ni prix constructeur, le forfait d'un vehicule
  // loue est evalue SANS le plafond du BOSS §890, c'est-a-dire au plus haut —
  // sur le cas de controle du module, l'ecart atteint un tiers de l'assiette.
  // La situation n'etait dite que dans la trace et dans une note de synthese :
  // un montant mecaniquement majore merite le meme traitement `role="alert"`
  // que les autres saisies a verifier.
  const varianteRetenue = varianteDe(vc.carburant);
  if (
    vc.mode === "location" &&
    vc.methode === "forfait" &&
    prixReferencePlafond(vc).origine === "inconnu" &&
    coutGlobalLocation(vc, varianteRetenue === "carburant-forfait-global") > 0
  ) {
    alertes.push(
      `Plafonnement invérifiable : ni le prix d'achat TTC du véhicule par le loueur, ni le prix conseillé par le constructeur ne sont renseignés. L'évaluation forfaitaire de ce véhicule loué est donc retenue SANS le plafond du BOSS §890, c'est-à-dire au plus haut, et l'assiette déclarée est mécaniquement trop élevée. Réclamez le prix d'achat à votre loueur : le BOSS §890 met cette communication à sa charge ; à défaut, saisissez le prix conseillé par le constructeur au jour du début du contrat.`,
    );
  }

  // ── 5. Les evaluations ─────────────────────────────────────────────────────
  const alternative = varianteAlternative(varianteRetenue);
  const forfaits: Evaluation[] = [evaluerForfait(vc, annee, regime, varianteRetenue)];
  if (alternative !== null) forfaits.push(evaluerForfait(vc, annee, regime, alternative));
  const forfaitRetenu = forfaits[0];
  const reel = evaluerReel(vc, annee, regime);

  const retenu = vc.methode === "forfait" ? forfaitRetenu : reel;

  if (!retenu.disponible) {
    const r = vide("non-calculable", retenu.motifIndisponible ?? "Données insuffisantes.");
    // On expose tout de meme les evaluations calculables : un concessionnaire ne
    // peut pas obtenir de forfait, mais son evaluation au reel est parfaitement
    // etablie par le BOSS §730, et la lui refuser n'aiderait personne.
    return {
      ...r,
      forfaits: forfaits.filter((f) => f.disponible),
      forfaitRetenu: forfaitRetenu.disponible ? forfaitRetenu : null,
      reel: reel.disponible ? reel : null,
      // `vide()` a DEJA repris `trace` : le respreader ici doublait chaque ligne
      // de trace a l'ecran et sur le recapitulatif imprime.
      trace: r.trace,
      alertes,
    };
  }

  const equivalentAchat =
    vc.mode === "location" ? plafondForfaitLocation(vc, regime, varianteRetenue) : null;

  // ── 6. Comparabilite du forfait et du reel ─────────────────────────────────
  //
  // Les deux evaluations ne portent pas la meme convention de periode. Le
  // forfait part de montants ANNUELS et applique le prorata mensuel du BOSS
  // §750 ; le reel part de couts DE LA PERIODE et n'est jamais proratise, le
  // prorata y etant cense intrinsèque au rapport kilometrique. Les deux sont
  // justes chacune sous sa convention — mais leur DIFFERENCE ne l'est que si la
  // periode couvre l'annee entiere. Sur une mise a disposition de six mois, un
  // meme jeu de saisies produisait « le forfait est plus favorable de
  // 1 875,00 EUR » alors que l'ecart mesurait le facteur 12 / mois et non un
  // arbitrage. L'option forfait / reel ne se rattrape pas retroactivement
  // (NOTE_OPTION_ANNUELLE) : un arbitrage faux se paie une annee entiere.
  //
  // On ne devine donc pas : quand la periode n'est pas pleine, l'ecart n'est PAS
  // produit, et l'utilisateur est averti de la raison.
  const comparable = mois === 12;
  if (!comparable && forfaitRetenu.disponible && reel.disponible) {
    alertes.push(
      `Comparaison forfait / réel non produite pour cette ligne : la période retenue couvre ${mois} mois sur 12. L'évaluation forfaitaire part de montants annuels puis les proratise (BOSS §750), tandis que l'évaluation au réel part des coûts de la seule période considérée et n'est pas proratisée. Les deux montants sont justes chacun dans sa convention, mais leur différence ne mesurerait ici que l'écart de convention. Pour arbitrer, rejouez la ligne sur une année pleine.`,
    );
  }

  const autreRegime: Regime =
    regime === "avant-2025-02-01" ? "depuis-2025-02-01" : "avant-2025-02-01";
  const contrefactuelEval =
    vc.methode === "forfait"
      ? evaluerForfait(vc, annee, autreRegime, varianteRetenue)
      : evaluerReel(vc, annee, autreRegime);
  const contrefactuel = contrefactuelEval.disponible
    ? { regime: autreRegime, annuel: contrefactuelEval.annuel }
    : null;

  return {
    id: vc.id,
    statut: "evalue",
    motifStatut: null,
    regime,
    mois,
    forfaits: forfaits.filter((f) => f.disponible),
    forfaitRetenu: forfaitRetenu.disponible ? forfaitRetenu : null,
    reel: reel.disponible ? reel : null,
    retenu,
    ecartForfaitReel:
      comparable && forfaitRetenu.disponible && reel.disponible
        ? forfaitRetenu.annuel - reel.annuel
        : null,
    equivalentAchat,
    contrefactuel,
    quantite,
    totalAnnuel: retenu.annuel * quantite,
    totalMensuel: retenu.mensuel * quantite,
    alertes,
    trace: [...trace, ...retenu.trace],
  };
}

export type ResultatParc = {
  lignes: ResultatVehicule[];
  totalAnnuel: number;
  totalMensuel: number;
  nbEvalues: number;
  nbSansAvantage: number;
  nbNonCalculables: number;
  /** Assiette annuelle economisee grace au plafonnement des vehicules loues.
      C'est le chiffre qui justifie la page : sans le prix d'achat du loueur, ce
      montant est declare en trop, chaque annee. */
  economiePlafond: number;
  /** Nombre de lignes en location dont le plafond n'a pas pu etre verifie faute
      d'information du loueur. */
  nbPlafondsInverifiables: number;
  /** Ecart cumule entre l'evaluation forfaitaire et l'evaluation au reel :
      positif quand le reel est globalement plus favorable. Ne porte QUE sur les
      lignes comparables (annee pleine) : voir `nbLignesComparees`. */
  ecartForfaitReel: number;
  /** Lignes reellement entrees dans `ecartForfaitReel`, et lignes ecartees faute
      de porter sur une annee pleine. Publier l'ecart sans dire sur combien de
      lignes il porte reviendrait a laisser croire qu'il couvre le parc. */
  nbLignesComparees: number;
  nbLignesNonComparables: number;
  /**
   * Lignes ecartees de l'ecart parce que la SECONDE evaluation n'existe pas,
   * et non parce que la periode serait partielle.
   *
   * Ces lignes tombaient auparavant dans aucun des deux compteurs : sur un parc
   * ou toutes les lignes portaient sur une annee pleine mais ou aucun
   * kilometrage n'etait saisi, `nbLignesComparees` valait 0 et l'interface
   * affichait « aucune ligne ne porte sur une annee pleine », motif faux — le
   * kilometrage manquait, pas les mois.
   *
   * `nbLignesSansReel` : le forfait est etabli, l'evaluation au reel ne l'est
   * pas. Le reel ne depend que d'une donnee que le forfait n'exige pas, le
   * rapport kilometrique ; l'invite « saisissez le kilometrage » est donc
   * exacte, et utile.
   *
   * `nbLignesSansForfait` : le cas inverse, dont le seul representant connu est
   * l'employeur du secteur automobile, pour lequel le module REFUSE de produire
   * un forfait (voir POINTS_A_LEVER, « boss-760-concessionnaire-forfait »).
   */
  nbLignesSansReel: number;
  nbLignesSansForfait: number;
  /** Vrai des qu'une ligne porte une alerte de saisie. */
  aDesAlertes: boolean;
};

/**
 * Calcul du PARC. Ce n'est pas qu'une somme de lignes : le nombre de plafonds
 * inverifiables et l'economie d'assiette procuree par le plafonnement sont des
 * agregats, et c'est sur eux que se joue l'argument de la page.
 */
export function calculerParc(vehicules: readonly Vehicule[], annee: Annee): ResultatParc {
  const lignes = vehicules.map((v) => calculerVehicule(v, annee));

  let totalAnnuel = 0;
  let totalMensuel = 0;
  let nbEvalues = 0;
  let nbSansAvantage = 0;
  let nbNonCalculables = 0;
  let economiePlafond = 0;
  let nbPlafondsInverifiables = 0;
  let ecartForfaitReel = 0;
  let nbLignesComparees = 0;
  let nbLignesNonComparables = 0;
  let nbLignesSansReel = 0;
  let nbLignesSansForfait = 0;
  let aDesAlertes = false;

  for (const r of lignes) {
    if (r.alertes.length > 0) aDesAlertes = true;
    if (r.statut === "pas-d-avantage") {
      nbSansAvantage += r.quantite;
      continue;
    }
    if (r.statut === "non-calculable") {
      nbNonCalculables += r.quantite;
      continue;
    }
    if (r.statut !== "evalue") return jamais(r.statut, "Statut de ligne");
    nbEvalues += r.quantite;
    totalAnnuel += r.totalAnnuel;
    totalMensuel += r.totalMensuel;
    if (r.ecartForfaitReel !== null) {
      ecartForfaitReel += r.ecartForfaitReel * r.quantite;
      nbLignesComparees += r.quantite;
    } else if (r.forfaitRetenu !== null && r.reel !== null) {
      // Les deux evaluations existent mais la periode n'est pas pleine : la
      // ligne n'est pas comparable, elle n'est pas non plus « sans donnees ».
      nbLignesNonComparables += r.quantite;
    } else if (r.forfaitRetenu !== null) {
      nbLignesSansReel += r.quantite;
    } else {
      nbLignesSansForfait += r.quantite;
    }
    const f = r.retenu;
    if (f !== null) {
      // Ecart entre l'evaluation finale sans plafond et l'evaluation finale avec
      // plafond, calcule ligne par ligne par `finaliser`. Cet agregat ne peut
      // donc plus depasser l'assiette qu'il est cense avoir evitee.
      economiePlafond += f.economiePlafond * r.quantite;
    }
    if (f !== null && f.methode === "forfait" && f.plafond === null) {
      const source = vehicules.find((x) => x.id === r.id);
      if (source && source.mode === "location") nbPlafondsInverifiables += r.quantite;
    }
  }

  return {
    lignes,
    totalAnnuel,
    totalMensuel,
    nbEvalues,
    nbSansAvantage,
    nbNonCalculables,
    economiePlafond,
    nbPlafondsInverifiables,
    ecartForfaitReel,
    nbLignesComparees,
    nbLignesNonComparables,
    nbLignesSansReel,
    nbLignesSansForfait,
    aDesAlertes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bornes de recharge : avantage distinct
// ─────────────────────────────────────────────────────────────────────────────

export type SaisieBorne = {
  id: string;
  libelle: string;
  situation: SituationBorne;
  depense: number;
};

export type ResultatBorne = {
  id: string;
  exclusion: number;
  tauxExclusion: number | null;
  plafond: number | null;
  avantage: number;
  trace: LigneTrace[];
};

export function borneVide(id: string): SaisieBorne {
  return { id, libelle: "", situation: "lieu-travail", depense: 0 };
}

export function normaliserBorne(u: unknown, id: string): SaisieBorne {
  const base = borneVide(id);
  if (typeof u !== "object" || u === null || Array.isArray(u)) return base;
  const o = u as Record<string, unknown>;
  return {
    id,
    libelle: typeof o.libelle === "string" ? o.libelle.slice(0, 60) : "",
    situation: enumOu(SITUATIONS_BORNE, o.situation, base.situation),
    depense: montantOu(o.depense, 0, BORNES.montant.min, BORNES.montant.max),
  };
}

/**
 * AVANTAGE lie a une borne de recharge (BOSS §930, arrete art. 4).
 *
 * Le plafond retenu est celui de l'annee du FAIT GENERATEUR et non celui de
 * l'annee de la depense : dans l'exemple officiel du BOSS, une borne installee
 * en janvier 2025 mais laissee au salarie un an plus tard se voit appliquer le
 * plafond de 2026. Le BOSS ne l'enonce pas en regle, il le fait — l'annee est
 * donc un parametre explicite de cette fonction, et non deduite d'une date de
 * facture.
 */
export function evaluerBorne(b: SaisieBorne, annee: Annee): ResultatBorne {
  const regle = REGLES_BORNE[b.situation];
  const depense = Math.max(0, b.depense);
  const trace: LigneTrace[] = [];

  if (regle.neglige) {
    trace.push({
      cle: "borne-neglige",
      texte: `${libelleSituationBorne(b.situation)} : l'avantage en nature est négligé (${regle.article}).`,
    });
    return { id: b.id, exclusion: depense, tauxExclusion: null, plafond: null, avantage: 0, trace };
  }

  if (regle.tauxExclusion === null) {
    trace.push({
      cle: "borne-aucune-exclusion",
      texte: `${libelleSituationBorne(b.situation)} : aucune exclusion possible, la totalité des dépenses entre dans le calcul de l'avantage en nature (${regle.article}).`,
    });
    return {
      id: b.id,
      exclusion: 0,
      tauxExclusion: null,
      plafond: null,
      avantage: depense,
      trace,
    };
  }

  const plafond = regle.clePlafond === null ? null : PLAFONDS[annee][regle.clePlafond];
  const part = depense * regle.tauxExclusion;
  const exclusion = plafond === null ? part : Math.min(part, plafond);
  trace.push({
    cle: "borne",
    texte: `${libelleSituationBorne(b.situation)} : exclusion de ${pct(regle.tauxExclusion * 100)} de ${eurPrecis(depense)} = ${eurPrecis(part)}${
      plafond === null
        ? ", sans plafond en euros"
        : `, ${exclusion < part ? `ramenée au plafond de ${eurPrecis(plafond)} (valeur au 1er janvier ${annee})` : `inférieure au plafond de ${eurPrecis(plafond)}`}`
    } (${regle.article}). Avantage en nature = ${eurPrecis(depense)} moins ${eurPrecis(exclusion)} = ${eurPrecis(depense - exclusion)}.`,
  });

  return {
    id: b.id,
    exclusion,
    tauxExclusion: regle.tauxExclusion,
    plafond,
    avantage: depense - exclusion,
    trace,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Export tableur
//
// Valeurs separees par des tabulations, en-tetes compris, MONTANTS EN NOMBRES
// BRUTS : un « 1 240 € » colle dans Excel n'est pas un nombre, c'est du texte, et
// la colonne n'est plus sommable. C'est tout l'interet de ce bouton pour un
// gestionnaire de paie qui recoit un parc entier.
// ─────────────────────────────────────────────────────────────────────────────

/** Separateur decimal virgule : c'est celui qu'attend un Excel en francais. */
const nb = (v: number): string => (Math.round(v * 100) / 100).toString().replace(".", ",");

export function tsvParc(
  vehicules: readonly Vehicule[],
  parc: ResultatParc,
  annee: Annee,
): string {
  const l: string[] = [];
  l.push(
    [
      "Libellé",
      "Quantite",
      "Situation",
      "Mode",
      "Methode",
      "Énergie",
      "Grille applicable",
      "Date d'attribution",
      "Mois retenus",
      "Assiette",
      "Taux",
      "Base annuelle",
      "Plafond location",
      "Abattement",
      "Redevance",
      "Avantage annuel (unité)",
      "Avantage mensuel (unité)",
      "Total ligne (annuel)",
      "Statut",
    ].join("\t"),
  );
  vehicules.forEach((v, i) => {
    const r = parc.lignes[i];
    const e = r.retenu;
    l.push(
      [
        v.libelle || `Véhicule ${i + 1}`,
        String(r.quantite),
        libelleUsage(v.usagePrive),
        libelleMode(v.mode),
        libelleMethode(v.methode),
        libelleEnergie(v.energie),
        r.regime === null ? "" : libelleRegime(r.regime),
        v.dateAttribution,
        String(r.mois),
        e === null ? "" : nb(e.assiette),
        e === null || e.taux === null ? "" : nb(e.taux * 100),
        e === null ? "" : nb(e.base),
        e === null || e.plafond === null ? "" : nb(e.plafond),
        e === null ? "" : nb(e.abattement),
        e === null ? "" : nb(e.redevance),
        e === null ? "" : nb(e.annuel),
        e === null ? "" : nb(e.mensuel),
        e === null ? "" : nb(r.totalAnnuel),
        r.statut === "evalue"
          ? "Évalué"
          : r.statut === "pas-d-avantage"
            ? "Pas d'avantage en nature"
            : "Non calculable",
      ].join("\t"),
    );
  });
  l.push("");
  l.push(["Année de référence des plafonds", String(annee)].join("\t"));
  l.push(["Total avantage annuel", nb(parc.totalAnnuel)].join("\t"));
  l.push(["Total avantage mensuel", nb(parc.totalMensuel)].join("\t"));
  l.push(["Assiette économisée par le plafonnement", nb(parc.economiePlafond)].join("\t"));
  l.push(["Écart cumulé forfait moins réel", nb(parc.ecartForfaitReel)].join("\t"));
  l.push(["Plafonds de location invérifiables", String(parc.nbPlafondsInverifiables)].join("\t"));
  l.push("");
  l.push(
    `Barèmes version ${META.version}, mis à jour le ${META.miseAJour}. Assiette sociale estimative, à reporter sous votre responsabilité. Aucun montant d'impôt sur le revenu n'est produit.`,
  );
  return l.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTOTEST BLOQUANT AU BUILD
//
// Zero dependance : le depot interdit d'ajouter un paquet npm et n'a pas de
// runner de test. On rejoue donc les cas de controle avec les VRAIES fonctions
// de calcul, et la page (Server Component, evaluee au build) leve une exception
// si une divergence apparait. Consequence assumee : un bareme faux fait ECHOUER
// `next build`. Un simulateur d'assiette sociale ne peut pas se deployer avec un
// chiffre faux.
//
// Les cas passants sont en outre destines a etre RENDUS a l'ecran dans une
// section editoriale : c'est du contenu, pas seulement un test. Les quatre cas
// marques `officiel: true` sont recopies chiffre pour chiffre d'exemples publies
// par le BOSS — ils prouvent que le moteur est juste, la ou une regression
// maison ne fait que figer une convention.
// ─────────────────────────────────────────────────────────────────────────────

export type MesureVehicule =
  | "annuelRetenu"
  | "mensuelRetenu"
  /** Montant de la SECONDE variante forfaitaire, celle que l'employeur n'a pas
      retenue. Elle existe des qu'il prend le carburant a sa charge, les deux
      options etant a son choix (BOSS §880). C'est la mesure qui prouve que les
      deux assiettes sont bien distinctes, et non deux taux sur la meme base. */
  | "annuelAlternatif"
  | "baseRetenue"
  | "assietteRetenue"
  | "plafondRetenu"
  /** Assiette REELLEMENT evitee par le plafonnement, mesuree apres prorata,
      abattement electrique et redevance. Sa raison d'etre est de figer le
      correctif : la version precedente mesurait l'ecart brut « base moins
      plafond », qui pouvait depasser l'assiette de la ligne. */
  | "economiePlafondParc"
  | "totalParc";

export type CasDeControle =
  | {
      kind: "vehicule";
      intitule: string;
      annee: Annee;
      entree: ReadonlyArray<Partial<Omit<Vehicule, "id">>>;
      mesure: MesureVehicule;
      attendu: number;
      tolerance?: number;
      officiel: boolean;
      source: string;
    }
  | {
      kind: "borne";
      intitule: string;
      annee: Annee;
      entree: Omit<SaisieBorne, "id">;
      mesure: "avantageBorne";
      attendu: number;
      tolerance?: number;
      officiel: boolean;
      source: string;
    };

export const CAS_DE_CONTROLE: ReadonlyArray<CasDeControle> = [
  // ── Les quatre exemples officiels du BOSS ────────────────────────────────
  {
    kind: "vehicule",
    intitule:
      "Véhicule électrique acheté 30 000 €, éco-score, forfait, attribué le 1er février 2025",
    annee: 2026,
    entree: [
      {
        mode: "achat",
        methode: "forfait",
        energie: "electrique",
        ecoScore: true,
        age: "moins-5-ans",
        prixAchatTTC: 30000,
        dateAttribution: "2025-02-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 1350,
    officiel: true,
    source:
      "BOSS §910, exemple 1 : 15 % de 30 000 = 4 500, abattement de 70 % soit 3 150 (sous le plafond), avantage 1 350 €",
  },
  {
    kind: "vehicule",
    intitule:
      "Même véhicule électrique, mais attribué le 1er janvier 2025 : ancienne grille, abattement de 50 %",
    annee: 2025,
    entree: [
      {
        mode: "achat",
        methode: "forfait",
        energie: "electrique",
        ecoScore: false,
        age: "moins-5-ans",
        prixAchatTTC: 30000,
        dateAttribution: "2025-01-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 1350,
    officiel: true,
    source:
      "BOSS §900, exemple 2 : 9 % de 30 000 = 2 700, abattement de 50 % soit 1 350 (sous le plafond), avantage 1 350 €. Aucune condition d'éco-score dans ce régime",
  },
  {
    kind: "vehicule",
    intitule:
      "Véhicule électrique Loué 10 800 € par an, éco-score, évaluation au Réel, 3 500 km privés sur 15 000",
    annee: 2026,
    entree: [
      {
        mode: "location",
        methode: "reel",
        energie: "electrique",
        ecoScore: true,
        loyerAnnuel: 10800,
        kmTotaux: 15000,
        kmPrives: 3500,
        dateAttribution: "2025-02-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 1260,
    officiel: true,
    source:
      "BOSS §910, exemple 3 : 10 800 x 3 500 / 15 000 = 2 520, abattement de 50 % — et non 70 %, puisque l'évaluation est au réel — soit 1 260 €",
  },
  {
    kind: "vehicule",
    intitule: "Assiette : véhicule acheté 20 000 € avec reprise de l'ancien pour 2 000 €",
    annee: 2026,
    entree: [
      {
        mode: "achat",
        methode: "forfait",
        prixAchatTTC: 20000,
        reprise: 2000,
        dateAttribution: "2026-01-01",
      },
    ],
    mesure: "assietteRetenue",
    attendu: 18000,
    officiel: true,
    source: "BOSS §630 : le montant de la reprise est pris en compte pour déterminer le prix d'achat",
  },
  {
    kind: "vehicule",
    intitule:
      "Concessionnaire au Réel : prix public 30 000 €, rabais salarié 6 000 €, 10 000 km privés sur 30 000",
    annee: 2026,
    entree: [
      {
        mode: "achat",
        methode: "reel",
        employeurConcessionnaire: true,
        prixPublicTTC: 30000,
        rabaisConcessionnaire: 6000,
        assuranceAnnuelle: 700,
        entretienAnnuel: 300,
        kmTotaux: 30000,
        kmPrives: 10000,
        dateAttribution: "2026-01-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 1933.33,
    tolerance: 0.01,
    officiel: true,
    source:
      "BOSS §730 : (30 000 - 6 000) x 20 % + 700 + 300 = 5 800, puis 5 800 x 10 000 / 30 000 = 1 933,33 €. Le BOSS affiche « 1 933 € » : le moteur ne doit pas arrondir",
  },
  {
    kind: "borne",
    intitule: "Borne de recharge de 2 800 € laissée au salarié qui démissionne",
    annee: 2026,
    entree: {
      libelle: "Borne domicile",
      situation: "hors-non-restituee-5ans-ou-moins",
      depense: 2800,
    },
    mesure: "avantageBorne",
    attendu: 1742.9,
    tolerance: 0.01,
    officiel: true,
    source:
      "BOSS §930, exemple 2 : 2 800 - min(50 % de 2 800 = 1 400 ; plafond 1 057,10) = 1 742,90 €. Le plafond retenu est celui de l'année du fait générateur",
  },

  // ── Le coeur de l'outil : le plafonnement du vehicule loue ────────────────
  {
    kind: "vehicule",
    intitule:
      "LLD thermique, forfait 50 %, coût global 6 300 €, prix d'achat loueur 32 000 € : le plafond ne mord pas",
    annee: 2026,
    entree: [
      {
        mode: "location",
        methode: "forfait",
        loyerAnnuel: 4800,
        entretienAnnuel: 600,
        assuranceAnnuelle: 900,
        prixAchatLoueurTTC: 32000,
        age: "moins-5-ans",
        dateAttribution: "2025-03-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 3150,
    officiel: false,
    source:
      "Régression construite : 50 % de 6 300 = 3 150, plafond 15 % de 32 000 = 4 800, non atteint. Attribution au 1er mars 2025 et année pleine 2026, soit douze mois",
  },
  {
    kind: "vehicule",
    intitule: "Même dossier : le plafond « achat » vaut 15 % de 32 000 €",
    annee: 2026,
    entree: [
      {
        mode: "location",
        methode: "forfait",
        loyerAnnuel: 4800,
        entretienAnnuel: 600,
        assuranceAnnuelle: 900,
        prixAchatLoueurTTC: 32000,
        age: "moins-5-ans",
        dateAttribution: "2025-03-01",
      },
    ],
    mesure: "plafondRetenu",
    attendu: 4800,
    officiel: false,
    source:
      "Régression construite. Le taux « sans carburant » est retenu car le forfait de location retenu est celui sans carburant — choix déclaré dans POINTS_A_LEVER",
  },
  {
    kind: "vehicule",
    intitule: "Même dossier : 262,50 € à porter sur chaque bulletin",
    annee: 2026,
    entree: [
      {
        mode: "location",
        methode: "forfait",
        loyerAnnuel: 4800,
        entretienAnnuel: 600,
        assuranceAnnuelle: 900,
        prixAchatLoueurTTC: 32000,
        dateAttribution: "2025-03-01",
      },
    ],
    mesure: "mensuelRetenu",
    attendu: 262.5,
    tolerance: 0.01,
    officiel: false,
    source: "Régression construite : 3 150 / 12",
  },
  {
    kind: "vehicule",
    intitule:
      "LLD avec forfait global de 67 %, coût total 12 000 €, prix d'achat loueur 30 000 €, attribué le 1er juin : le plafond MORD, puis le prorata",
    annee: 2025,
    entree: [
      {
        mode: "location",
        methode: "forfait",
        carburant: "employeur-forfait",
        loyerAnnuel: 9000,
        entretienAnnuel: 500,
        assuranceAnnuelle: 500,
        carburantTotalAnnuel: 2000,
        prixAchatLoueurTTC: 30000,
        age: "moins-5-ans",
        dateAttribution: "2025-06-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 3500,
    officiel: false,
    source:
      "Régression construite : 67 % de 12 000 = 8 040, plafond 20 % de 30 000 = 6 000, puis prorata de 7 mois sur 12 = 3 500 €. Sans le prix d'achat du loueur, l'employeur déclarerait 8 040 x 7 / 12 = 4 690 €",
  },
  {
    kind: "vehicule",
    intitule:
      "Même LLD, mais le loueur ne communique aucun prix : le plafond ne peut pas être vérifié et l'assiette grimpe à 4 690 €",
    annee: 2025,
    entree: [
      {
        mode: "location",
        methode: "forfait",
        carburant: "employeur-forfait",
        loyerAnnuel: 9000,
        entretienAnnuel: 500,
        assuranceAnnuelle: 500,
        carburantTotalAnnuel: 2000,
        dateAttribution: "2025-06-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 4690,
    officiel: false,
    source:
      "Régression construite : 8 040 x 7 / 12 = 4 690 €. C'est exactement le coût de l'information que le BOSS §890 met à la charge du loueur",
  },
  {
    kind: "vehicule",
    intitule:
      "Même LLD sous l'ANCIENNE grille : 30 % de 6 300 = 1 890 € d'assiette, contre 3 150 aujourd'hui",
    annee: 2026,
    entree: [
      {
        mode: "location",
        methode: "forfait",
        loyerAnnuel: 4800,
        entretienAnnuel: 600,
        assuranceAnnuelle: 900,
        prixAchatLoueurTTC: 32000,
        dateAttribution: "2025-01-15",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 1890,
    officiel: false,
    source:
      "Régression construite : un véhicule attribué avant le 1er février 2025 reste à 30 % tant qu'il n'est pas réattribué (BOSS §770). Les deux grilles coexistent",
  },

  // ── Grilles, abattements, prorata, redevance, cas hors champ ──────────────
  {
    kind: "vehicule",
    intitule: "Achat, plus de cinq ans, nouvelle grille, sans carburant : 10 % de 24 000 €",
    annee: 2026,
    entree: [
      {
        mode: "achat",
        methode: "forfait",
        age: "plus-5-ans",
        prixAchatTTC: 24000,
        dateAttribution: "2026-01-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 2400,
    officiel: false,
    source: "Régression construite : BOSS §810, tableau §830",
  },
  {
    kind: "vehicule",
    intitule:
      "Achat de plus de cinq ans, forfait global de 15 % sur 24 000 €, redevance de 100 € par mois",
    annee: 2026,
    entree: [
      {
        mode: "achat",
        methode: "forfait",
        age: "plus-5-ans",
        carburant: "employeur-forfait",
        prixAchatTTC: 24000,
        redevanceMensuelle: 100,
        dateAttribution: "2026-01-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 2400,
    officiel: false,
    source: "Régression construite : 15 % de 24 000 = 3 600, moins 1 200 de redevance (BOSS §950)",
  },
  {
    kind: "vehicule",
    intitule:
      "Même dossier avec une redevance de 350 € par mois : supérieure au forfait, il n'y a pas d'avantage en nature",
    annee: 2026,
    entree: [
      {
        mode: "achat",
        methode: "forfait",
        age: "plus-5-ans",
        carburant: "employeur-forfait",
        prixAchatTTC: 24000,
        redevanceMensuelle: 350,
        dateAttribution: "2026-01-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 0,
    officiel: false,
    source: "Régression construite : 4 200 € de redevance pour un forfait de 3 600 € (BOSS §950)",
  },
  {
    kind: "vehicule",
    intitule:
      "Prorata : véhicule attribué le 15 mars, tout mois commencé compte pour un mois entier, soit 10 mois",
    annee: 2026,
    entree: [
      {
        mode: "achat",
        methode: "forfait",
        prixAchatTTC: 30000,
        dateAttribution: "2026-03-15",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 3750,
    officiel: false,
    source: "Régression construite : 15 % de 30 000 = 4 500, puis 4 500 x 10 / 12 (BOSS §750)",
  },
  {
    kind: "vehicule",
    intitule:
      "Plafond de l'abattement électrique atteint : véhicule de 100 000 €, forfait, éco-score",
    annee: 2026,
    entree: [
      {
        mode: "achat",
        methode: "forfait",
        energie: "electrique",
        ecoScore: true,
        prixAchatTTC: 100000,
        dateAttribution: "2026-01-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 10358.4,
    tolerance: 0.01,
    officiel: false,
    source:
      "Régression construite : 15 % de 100 000 = 15 000, abattement théorique de 70 % soit 10 500, ramené au plafond de 4 641,60 €, avantage 10 358,40 €",
  },
  {
    kind: "vehicule",
    intitule:
      "Véhicule électrique SANS éco-score, nouvelle grille : barèmes normaux, aucun abattement",
    annee: 2026,
    entree: [
      {
        mode: "achat",
        methode: "forfait",
        energie: "electrique",
        ecoScore: false,
        prixAchatTTC: 30000,
        dateAttribution: "2026-01-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 4500,
    officiel: false,
    source: "Régression construite : BOSS §920. Seuls les frais d'électricité restent hors calcul",
  },
  {
    kind: "vehicule",
    intitule: "Hybride rechargeable : aucun abattement, il est traité comme un thermique",
    annee: 2026,
    entree: [
      {
        mode: "achat",
        methode: "forfait",
        energie: "hybride-rechargeable",
        ecoScore: true,
        prixAchatTTC: 30000,
        dateAttribution: "2026-01-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 4500,
    officiel: false,
    source:
      "Régression construite : BOSS §930. L'éco-score déclaré est sans effet, l'abattement étant réservé aux véhicules exclusivement électriques",
  },
  {
    kind: "vehicule",
    intitule:
      "Véhicule électrique attribué en 2019 : antérieur à l'ouverture du régime, aucun abattement",
    annee: 2025,
    entree: [
      {
        mode: "achat",
        methode: "forfait",
        energie: "electrique",
        prixAchatTTC: 30000,
        dateAttribution: "2019-06-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 2700,
    officiel: false,
    source:
      "Régression construite : ancienne grille à 9 %, mais la fenêtre du régime électrique s'ouvre au 1er janvier 2020 (BOSS §900)",
  },
  {
    kind: "vehicule",
    intitule:
      "Forfait de base plus frais réels de carburant privé : les 1 200 € de carburant ne sont pas proratisés",
    annee: 2026,
    entree: [
      {
        mode: "achat",
        methode: "forfait",
        carburant: "employeur-frais-reels",
        prixAchatTTC: 30000,
        carburantPriveAnnuel: 1200,
        dateAttribution: "2026-07-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 3450,
    officiel: false,
    source:
      "Régression construite : 15 % de 30 000 = 4 500, prorata de 6 mois soit 2 250, plus 1 200 € de frais réels constatés",
  },
  {
    kind: "vehicule",
    intitule:
      "Usage privé interdit par écrit : il n'y a pas d'avantage en nature, et ce n'est pas la même chose qu'un avantage nul",
    annee: 2026,
    entree: [
      {
        usagePrive: "interdiction-ecrite",
        mode: "achat",
        methode: "forfait",
        prixAchatTTC: 30000,
        dateAttribution: "2026-01-01",
      },
    ],
    mesure: "totalParc",
    attendu: 0,
    officiel: false,
    source: "Régression construite : BOSS §560",
  },
  {
    kind: "vehicule",
    intitule: "Restitution imposée chaque semaine et pendant les congés : aucun avantage en nature",
    annee: 2026,
    entree: [
      {
        usagePrive: "restitution-hebdo-conges",
        mode: "location",
        methode: "forfait",
        loyerAnnuel: 6000,
        dateAttribution: "2026-01-01",
      },
    ],
    mesure: "totalParc",
    attendu: 0,
    officiel: false,
    source: "Régression construite : BOSS §560, les deux conditions étant cumulatives",
  },
  {
    kind: "vehicule",
    intitule:
      "Prix d'achat non renseigné : aucun forfait n'est produit, et le total du parc reste à zéro sans faire croire à une assiette nulle",
    annee: 2026,
    entree: [{ mode: "achat", methode: "forfait", prixAchatTTC: 0, dateAttribution: "2026-01-01" }],
    mesure: "totalParc",
    attendu: 0,
    officiel: false,
    source:
      "Garde-fou : une assiette vide ne doit jamais produire un montant. La ligne est classée « non calculable » et non « évaluée »",
  },
  {
    kind: "vehicule",
    intitule: "Parc de trois véhicules identiques : le total suit la quantité",
    annee: 2026,
    entree: [
      {
        mode: "achat",
        methode: "forfait",
        quantite: 3,
        prixAchatTTC: 30000,
        dateAttribution: "2026-01-01",
      },
    ],
    mesure: "totalParc",
    attendu: 13500,
    officiel: false,
    source: "Régression construite : 3 x 4 500 €",
  },
  {
    kind: "vehicule",
    intitule:
      "Rabais du prix d'achat du loueur écrêté à 30 % du prix conseillé : 40 000 € conseillés, 20 000 € annoncés",
    annee: 2026,
    entree: [
      {
        mode: "location",
        methode: "forfait",
        loyerAnnuel: 20000,
        prixAchatLoueurTTC: 20000,
        prixConseilleConstructeur: 40000,
        dateAttribution: "2026-01-01",
      },
    ],
    mesure: "plafondRetenu",
    attendu: 4200,
    officiel: false,
    source:
      "Régression construite : le rabais n'est retenu que dans la limite de 30 % du prix conseillé, soit un prix de référence plancher de 28 000 €, et un plafond de 15 % x 28 000 = 4 200 € (BOSS §890)",
  },
  // ── Le plafonnement du vehicule loue, REELLEMENT exerce ──────────────────
  //
  // La fonction la plus chargee en conventions non sourcees etait aussi la moins
  // eprouvee : les cas de location precedents mesuraient la VALEUR du plafond
  // (`plafondRetenu`), aucun ne verifiait qu'il mord effectivement sur le montant
  // retenu, ni ce que vaut alors l'assiette evitee. Les deux cas qui suivent
  // couvrent la chaine complete sur une periode PARTIELLE, c'est-a-dire la
  // configuration exacte ou la mesure precedente de l'economie devenait fausse.
  {
    kind: "vehicule",
    intitule:
      "Plafonnement d'un véhicule loué attribué en cours d'année : le forfait de location est ramené au forfait d'achat, puis proratisé",
    annee: 2026,
    entree: [
      {
        mode: "location",
        methode: "forfait",
        loyerAnnuel: 12000,
        prixAchatLoueurTTC: 20000,
        dateAttribution: "2026-07-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 1500,
    officiel: false,
    source:
      "Régression construite : 50 % de 12 000 = 6 000 €, ramenés au forfait d'achat 15 % de 20 000 = 3 000 € (BOSS §890), puis proratisés sur 6 mois = 1 500 €",
  },
  {
    kind: "vehicule",
    intitule:
      "Assiette évitée par le plafonnement sur une période partielle : elle ne peut pas depasser l'assiette de la ligne",
    annee: 2026,
    entree: [
      {
        mode: "location",
        methode: "forfait",
        loyerAnnuel: 12000,
        prixAchatLoueurTTC: 20000,
        dateAttribution: "2026-07-01",
      },
    ],
    mesure: "economiePlafondParc",
    attendu: 1500,
    officiel: false,
    source:
      "Régression construite : sans plafond, 50 % de 12 000 proratisés sur 6 mois donnent 3 000 € ; avec plafond, 1 500 €. L'écart vaut donc 1 500 €, et non les 3 000 € que donnait l'écart brut « base moins plafond » mesuré avant prorata",
  },
  {
    kind: "vehicule",
    intitule:
      "Loueur muet mais prix constructeur connu : le prix conseillé sert de prix de référence",
    annee: 2026,
    entree: [
      {
        mode: "location",
        methode: "forfait",
        loyerAnnuel: 20000,
        prixConseilleConstructeur: 40000,
        dateAttribution: "2026-01-01",
      },
    ],
    mesure: "plafondRetenu",
    attendu: 6000,
    officiel: false,
    source: "Régression construite : 15 % de 40 000 € (BOSS §890, second alinéa)",
  },
  {
    kind: "vehicule",
    intitule:
      "Tolérance congés : 4 semaines de restitution appliquent un facteur de 48 sur 52 au forfait",
    annee: 2026,
    entree: [
      {
        mode: "achat",
        methode: "forfait",
        prixAchatTTC: 30000,
        semainesSansVehicule: 4,
        dateAttribution: "2026-01-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 4153.85,
    tolerance: 0.01,
    officiel: false,
    source: "Régression construite : 4 500 x 48 / 52 (BOSS §750, tolérance)",
  },
  {
    kind: "vehicule",
    intitule:
      "LLD avec carburant, option « forfait de base plus frais réels » : 50 % de 6 300 € puis 800 € de carburant privé",
    annee: 2026,
    entree: [
      {
        mode: "location",
        methode: "forfait",
        carburant: "employeur-frais-reels",
        loyerAnnuel: 4800,
        entretienAnnuel: 600,
        assuranceAnnuelle: 900,
        carburantTotalAnnuel: 2000,
        carburantPriveAnnuel: 800,
        prixAchatLoueurTTC: 32000,
        dateAttribution: "2026-01-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 3950,
    officiel: false,
    source:
      "Régression construite : 50 % de 6 300 (location, entretien, assurance) = 3 150, plus 800 € de frais réels de carburant à usage personnel. Le carburant global de 2 000 € n'entre PAS dans cette assiette",
  },
  {
    kind: "vehicule",
    intitule:
      "Même dossier, seconde option offerte à l'employeur : 67 % de 8 300 €, carburant global compris",
    annee: 2026,
    entree: [
      {
        mode: "location",
        methode: "forfait",
        carburant: "employeur-frais-reels",
        loyerAnnuel: 4800,
        entretienAnnuel: 600,
        assuranceAnnuelle: 900,
        carburantTotalAnnuel: 2000,
        carburantPriveAnnuel: 800,
        prixAchatLoueurTTC: 32000,
        dateAttribution: "2026-01-01",
      },
    ],
    mesure: "annuelAlternatif",
    attendu: 5561,
    officiel: false,
    source:
      "Régression construite : les deux options « avec carburant » n'ont pas la même assiette (BOSS §880). 67 % de 8 300 = 5 561 €, contre 3 950 € pour l'autre option. Le plafond « achat » de 20 % x 32 000 = 6 400 € ne mord dans aucune des deux",
  },
  {
    kind: "vehicule",
    intitule:
      "Véhicule électrique dont l'employeur paie la recharge : le forfait reste celui SANS carburant",
    annee: 2026,
    entree: [
      {
        mode: "achat",
        methode: "forfait",
        energie: "electrique",
        ecoScore: true,
        carburant: "employeur-forfait",
        prixAchatTTC: 30000,
        carburantTotalAnnuel: 900,
        carburantPriveAnnuel: 400,
        dateAttribution: "2026-01-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 1350,
    officiel: false,
    source:
      "Régression construite : 15 % de 30 000 = 4 500 et non 20 % = 6 000, l'évaluation ne tenant pas compte des frais d'électricité (BOSS §910). Abattement de 70 % soit 3 150, avantage 1 350 € — soit exactement le résultat de l'exemple officiel, la recharge payée par l'employeur étant sans effet",
  },
  {
    kind: "vehicule",
    intitule:
      "Redevance au Réel sur une période de six mois : six mensualités deduites, pas douze",
    annee: 2026,
    entree: [
      {
        mode: "achat",
        methode: "reel",
        prixAchatTTC: 30000,
        kmTotaux: 20000,
        kmPrives: 5000,
        redevanceMensuelle: 100,
        dateAttribution: "2026-07-01",
      },
    ],
    mesure: "annuelRetenu",
    attendu: 900,
    officiel: false,
    source:
      "Régression construite : amortissement 20 % de 30 000 = 6 000, quote-part privée 5 000 / 20 000 = 25 %, soit 1 500 ; moins six redevances de 100 € = 900 €. Compter douze redevances aurait minoré l'avantage de 600 €",
  },
  {
    kind: "borne",
    intitule: "Borne installée sur le lieu de travail : l'avantage est négligé",
    annee: 2026,
    entree: { libelle: "Borne siège", situation: "lieu-travail", depense: 5000 },
    mesure: "avantageBorne",
    attendu: 0,
    officiel: false,
    source: "Régression construite : BOSS §930",
  },
  {
    kind: "borne",
    intitule:
      "Borne non restituée de plus de cinq ans : exclusion de 75 % plafonnée à 1 585,50 €",
    annee: 2026,
    entree: {
      libelle: "Borne ancienne",
      situation: "hors-non-restituee-plus-5ans",
      depense: 4000,
    },
    mesure: "avantageBorne",
    attendu: 2414.5,
    tolerance: 0.01,
    officiel: false,
    source:
      "Régression construite : 75 % de 4 000 = 3 000, ramené au plafond de 1 585,50 €, avantage 2 414,50 €",
  },
  {
    kind: "borne",
    intitule:
      "Forfait d'électricité non isolable : la totalité des dépenses entre dans le calcul",
    annee: 2026,
    entree: { libelle: "Abonnement", situation: "forfait-non-isolable", depense: 600 },
    mesure: "avantageBorne",
    attendu: 600,
    officiel: false,
    source: "Régression construite : BOSS §930",
  },
];

/** Rejoue un cas de controle avec les VRAIES fonctions de calcul, jamais une
    copie. Les deux `switch` sont clos par `jamais(...)` : un membre ajoute a
    `MesureVehicule` sans traitement produirait une erreur de compilation, la ou
    un `default` fourre-tout aurait compare le bon nombre attendu au mauvais
    total et valide en silence une divergence de bareme. */
export function evaluerCas(cas: CasDeControle): number {
  if (cas.kind === "borne") {
    // `mesure` est copiee dans une variable AVANT d'etre testee. Tester
    // `cas.mesure` directement retrecirait `cas` lui-meme a `never` — la variante
    // « borne » n'ayant qu'une seule mesure, l'ecarter ecarte la variante
    // entiere — et le garde d'exhaustivite ne compilait plus. Copier la mesure
    // isole le retrecissement : c'est bien `mesure` qui devient `never`, ce qui
    // est exactement ce qu'on veut mesurer, et l'ajout d'une seconde mesure de
    // borne redeviendra une erreur de compilation.
    const mesure = cas.mesure;
    const b: SaisieBorne = { id: "controle-borne", ...cas.entree };
    if (mesure === "avantageBorne") return evaluerBorne(b, cas.annee).avantage;
    return jamais(mesure, "Mesure de contrôle d'une borne");
  }
  if (cas.kind !== "vehicule") return jamais(cas, "Type de cas de contrôle");

  const vehicules = cas.entree.map((p, i) => ({
    ...vehiculeVide(cas.annee, `controle-${i}`),
    ...p,
    id: `controle-${i}`,
  }));
  const parc = calculerParc(vehicules, cas.annee);
  if (cas.mesure === "totalParc") return parc.totalAnnuel;
  if (cas.mesure === "economiePlafondParc") return parc.economiePlafond;

  const ligne = parc.lignes[0];
  const e = ligne.retenu;
  switch (cas.mesure) {
    case "annuelRetenu":
      return e === null ? 0 : e.annuel;
    case "mensuelRetenu":
      return e === null ? 0 : e.mensuel;
    case "annuelAlternatif":
      // Pas de repli sur 0 quand la seconde variante manque : un 0 pourrait
      // coincider avec un attendu et valider en silence l'absence meme de
      // l'option. On rend une valeur qui ne peut egaler aucun attendu, donc qui
      // fait echouer le controle et le build.
      return ligne.forfaits.length > 1 ? ligne.forfaits[1].annuel : Number.POSITIVE_INFINITY;
    case "baseRetenue":
      return e === null ? 0 : e.base;
    case "assietteRetenue":
      return e === null ? 0 : e.assiette;
    case "plafondRetenu":
      return e === null || e.plafond === null ? 0 : e.plafond;
    default:
      return jamais(cas.mesure, "Mesure de contrôle d'un véhicule");
  }
}

/**
 * Verifie l'integralite des baremes et des cas de controle. Retourne la liste
 * des divergences, vide si tout passe. A appeler dans le Server Component de la
 * page :
 *   const divergences = verifierBaremes();
 *   if (divergences.length) throw new Error("Barèmes avantage en nature incoherents : " + divergences.join(" | "));
 */
export function verifierBaremes(): string[] {
  const erreurs: string[] = [];

  // 1. Coherence structurelle des grilles forfaitaires. Un taux inverse — le
  //    forfait global inferieur au forfait de base, ou le taux « plus de cinq
  //    ans » superieur au taux « cinq ans ou moins » — ne ferait paraitre aucun
  //    total anormal et se traduirait par une DSN fausse pendant un an.
  for (const { id: regime } of REGIMES) {
    const a = TAUX_FORFAIT_ACHAT[regime];
    for (const [nom, couple] of [
      ["cinq ans ou moins", a.moins5ans],
      ["plus de cinq ans", a.plus5ans],
    ] as ReadonlyArray<[string, CoupleTaux]>) {
      if (!(couple.sansCarburant > 0 && couple.sansCarburant < 1))
        erreurs.push(`Forfait achat ${regime} (${nom}) : taux sans carburant hors de ]0 ; 1[`);
      if (!(couple.forfaitGlobal > couple.sansCarburant))
        erreurs.push(
          `Forfait achat ${regime} (${nom}) : le forfait global n'est pas supérieur au forfait sans carburant`,
        );
    }
    if (!(a.plus5ans.sansCarburant < a.moins5ans.sansCarburant))
      erreurs.push(
        `Forfait achat ${regime} : le taux « plus de cinq ans » devrait être inférieur au taux « cinq ans ou moins »`,
      );
    const l = TAUX_FORFAIT_LOCATION[regime];
    if (!(l.taux.sansCarburant > 0 && l.taux.sansCarburant < 1))
      erreurs.push(`Forfait location ${regime} : taux sans carburant hors de ]0 ; 1[`);
    if (!(l.taux.forfaitGlobal > l.taux.sansCarburant))
      erreurs.push(
        `Forfait location ${regime} : le forfait global n'est pas supérieur au forfait sans carburant`,
      );
    // Le regime electrique doit exister pour chaque regime de date, et ses
    // taux rester dans les bornes d'un abattement.
    const el = ELECTRIQUE[regime];
    if (!(el.tauxReel > 0 && el.tauxReel <= 1))
      erreurs.push(`Abattement électrique ${regime} : taux au réel hors de ]0 ; 1]`);
    if (!(el.tauxForfait > 0 && el.tauxForfait <= 1))
      erreurs.push(`Abattement électrique ${regime} : taux au forfait hors de ]0 ; 1]`);
    if (el.regime !== regime)
      erreurs.push(`Abattement électrique ${regime} : la cle et le champ régime divergent`);
  }
  // La reforme du 25 fevrier 2025 durcit les deux grilles : l'inverse
  // signalerait une inversion de blocs A et B de l'arrete.
  if (
    !(
      TAUX_FORFAIT_ACHAT["depuis-2025-02-01"].moins5ans.sansCarburant >
      TAUX_FORFAIT_ACHAT["avant-2025-02-01"].moins5ans.sansCarburant
    )
  )
    erreurs.push("Grilles achat : la grille postérieure au 1er février 2025 n'est pas la plus élevée");
  if (
    !(
      TAUX_FORFAIT_LOCATION["depuis-2025-02-01"].taux.sansCarburant >
      TAUX_FORFAIT_LOCATION["avant-2025-02-01"].taux.sansCarburant
    )
  )
    erreurs.push(
      "Grilles location : la grille postérieure au 1er février 2025 n'est pas la plus élevée",
    );
  if (!(AMORTISSEMENT_REEL.plus5ans < AMORTISSEMENT_REEL.moins5ans))
    erreurs.push("Amortissement au réel : le taux « plus de cinq ans » n'est pas le plus faible");

  // 2. Plafonds en euros. On recalcule la revalorisation annuelle prevue par
  //    l'art. 8 de l'arrete plutot que de faire confiance a huit nombres
  //    recopies a la main : une faute de frappe fait echouer le build.
  const REVALORISATION = 1.013;
  const dizaineCentimes = (v: number): number => Math.round(v * 10) / 10;
  for (let i = 0; i < ANNEES.length; i += 1) {
    const annee = ANNEES[i].id;
    const p = PLAFONDS[annee];
    for (const cle of ["abattement50", "abattement70", "borne50", "borne75"] as const) {
      if (!(p[cle] > 0)) erreurs.push(`Plafonds ${annee} : ${cle} n'est pas strictement positif`);
    }
    if (!(p.abattement70 > p.abattement50))
      erreurs.push(`Plafonds ${annee} : le plafond de l'abattement de 70 % n'est pas le plus élevé`);
    if (!(p.borne75 > p.borne50))
      erreurs.push(`Plafonds ${annee} : le plafond de la borne à 75 % n'est pas le plus élevé`);
    if (i > 0) {
      const precedent = PLAFONDS[ANNEES[i - 1].id];
      for (const cle of ["abattement50", "abattement70", "borne50", "borne75"] as const) {
        const attendu = dizaineCentimes(precedent[cle] * REVALORISATION);
        if (Math.abs(attendu - p[cle]) > 0.005)
          erreurs.push(
            `Plafonds ${annee} : ${cle} vaut ${p[cle]}, alors que la revalorisation de ${
              Math.round((REVALORISATION - 1) * 10000) / 100
            } % du plafond précédent donne ${attendu}`,
          );
      }
    }
  }

  // 3. Regles des bornes de recharge : toute situation offerte au selecteur doit
  //    avoir une regle, et toute regle doit etre offerte au selecteur — un
  //    `Record` garantit le premier sens, pas le second.
  const idsBorne = SITUATIONS_BORNE.map((s) => s.id as string);
  for (const cle of Object.keys(REGLES_BORNE)) {
    if (!idsBorne.includes(cle))
      erreurs.push(`Bornes de recharge : la règle « ${cle} » n'est offerte par aucun libellé`);
  }
  for (const s of SITUATIONS_BORNE) {
    const r = REGLES_BORNE[s.id];
    if (r.tauxExclusion !== null && !(r.tauxExclusion > 0 && r.tauxExclusion <= 1))
      erreurs.push(`Bornes de recharge : taux d'exclusion hors de ]0 ; 1] pour « ${s.id} »`);
    if (r.clePlafond !== null && r.tauxExclusion === null)
      erreurs.push(`Bornes de recharge : « ${s.id} » porte un plafond sans taux d'exclusion`);
  }
  // ASYMETRIE ASSUMEE, ET SURVEILLEE. `abattementElectrique` oppose reellement
  // `finOpposable` a la date d'attribution ; `evaluerBorne`, lui, n'oppose
  // AUCUNE date : il ne recoit qu'une annee. Tant que le selecteur d'annees
  // s'arrete avant la peremption du regime des bornes, la difference est sans
  // effet. Le jour ou une annee posterieure serait ajoutee, le regime de faveur
  // survivrait en silence — d'ou ce controle, qui fait echouer le build a la
  // place. Il vaut instruction : ajouter cette annee suppose d'ecrire d'abord la
  // regle applicable au-dela, ou de porter une date dans `SaisieBorne`.
  for (const { id: annee } of ANNEES) {
    if (dernierJour(annee) > FIN_REGIME_BORNES)
      erreurs.push(
        `Bornes de recharge : l'année ${annee} dépasse le terme du régime de faveur (${FIN_REGIME_BORNES}), qu'aucune règle ne remplace et qu'« evaluerBorne » n'oppose pas`,
      );
  }

  // 4. Les enumerations offertes a l'interface doivent couvrir toutes les
  //    valeurs que le moteur sait traiter, sans quoi une option deviendrait
  //    inatteignable en silence.
  if (USAGES_PRIVE.filter((u) => u.avantage).length !== 1)
    erreurs.push(
      "Usages privés : une seule situation doit produire un avantage en nature (mise à disposition permanente)",
    );
  if (VARIANTES_FORFAIT.length !== 3)
    erreurs.push("Variantes de forfait : les trois formes du barème doivent être libellées");
  for (const c of CARBURANTS) {
    const variante = varianteDe(c.id);
    if (!VARIANTES_FORFAIT.some((x) => x.id === variante))
      erreurs.push(`Carburant « ${c.id} » : variante « ${variante} » non libellée`);
  }

  // 5. La bascule de regime, testee des DEUX cotes. La veille du 1er fevrier
  //    2025 doit relever de l'ancienne grille, le jour meme de la nouvelle : une
  //    inegalite large au lieu d'une stricte deplacerait une journee entiere de
  //    dossiers d'une grille a l'autre, et ne se verrait sur aucun total.
  const bascule = jourUTC(BASCULE_REGIME);
  if (bascule === null) {
    erreurs.push(`Bascule de régime : « ${BASCULE_REGIME} » n'est pas une date ISO lisible`);
  } else {
    if (regimeDe(BASCULE_REGIME) !== "depuis-2025-02-01")
      erreurs.push("Bascule de régime : le 1er février 2025 ne relève pas de la nouvelle grille");
    if (regimeDe(isoDe(bascule - JOUR_MS)) !== "avant-2025-02-01")
      erreurs.push("Bascule de régime : le 31 janvier 2025 ne relève pas de l'ancienne grille");
  }
  if (ELECTRIQUE["depuis-2025-02-01"].debut !== BASCULE_REGIME)
    erreurs.push(
      "Régime électrique : l'ouverture du régime postérieur ne coïncide pas avec la bascule de grille",
    );
  if (bascule !== null && ELECTRIQUE["avant-2025-02-01"].fin !== isoDe(bascule - JOUR_MS))
    erreurs.push(
      "Régime électrique : la fin du régime antérieur ne coïncide pas avec la veille de la bascule",
    );
  for (const { id: regime } of REGIMES) {
    const el = ELECTRIQUE[regime];
    const d = jourUTC(el.debut);
    const f = jourUTC(el.fin);
    if (d === null || f === null || f < d)
      erreurs.push(`Régime électrique ${regime} : fenêtre de dates absente ou inversée`);
    if (el.finOpposable !== null && el.finOpposable !== el.fin)
      erreurs.push(
        `Régime électrique ${regime} : la clôture opposée au moteur diverge de la fin annoncée`,
      );
  }

  // 6. Composition du jeu de regression. La note de cadrage impose deux garde-
  //    fous que rien d'autre ne rattraperait : des exemples OFFICIELS en nombre
  //    suffisant — seuls eux prouvent que le moteur est juste, une regression
  //    maison ne fait que figer une convention — et une couverture reelle du
  //    vehicule LOUE, qui est la raison d'etre de cette page.
  const officiels = CAS_DE_CONTROLE.filter((c) => c.officiel).length;
  if (officiels < 4)
    erreurs.push(
      `Cas de contrôle : ${officiels} exemple(s) officiel(s) publié(s) seulement, quatre au minimum sont attendus`,
    );
  const casLoues = CAS_DE_CONTROLE.filter(
    (c) => c.kind === "vehicule" && c.entree.some((e) => e.mode === "location"),
  ).length;
  if (casLoues < 2)
    erreurs.push(
      `Cas de contrôle : ${casLoues} cas portant sur un véhicule loué, deux au minimum sont attendus`,
    );
  const intitules = new Set(CAS_DE_CONTROLE.map((c) => c.intitule));
  if (intitules.size !== CAS_DE_CONTROLE.length)
    erreurs.push(
      "Cas de contrôle : deux cas portent le même intitulé, ils seraient indiscernables dans le tableau de la page",
    );

  // 7. Cas de controle, rejoues avec les vraies fonctions de calcul.
  for (const cas of CAS_DE_CONTROLE) {
    const obtenu = evaluerCas(cas);
    const tol = cas.tolerance ?? 0.005;
    if (Math.abs(obtenu - cas.attendu) > tol) {
      erreurs.push(
        `${cas.intitule} : attendu ${cas.attendu}, obtenu ${Math.round(obtenu * 100) / 100}`,
      );
    }
  }

  return erreurs;
}
