# Recherche web de LocalAI — choix du 8 novembre 2026

Évolution de l'ensemble de l'assistant, choix des modèles et comparaison réelle de la réflexion : [architecture de l'assistant](architecture-assistant.md).

## Diagnostic

L'ancienne chaîne prenait les cinq premiers résultats, lisait trois pages et transmettait leurs informations deux fois : résumé dans le message et documents joints. Le début des pages était coupé avant la sélection des passages. Les extraits de moteurs et les pages effectivement lues n'étaient pas clairement distingués. Une relance pouvait reprendre un nom présent dans une réponse erronée de l'assistant. Ces choix peuvent aggraver les erreurs d'un petit modèle et saturer son contexte.

## Choix retenu

Une recherche suivie d'une réponse, sans boucle autonome illimitée. Le premier moteur reçoit une question qui conserve noms, dates et négations. Les relances utilisent uniquement les messages utilisateur pour retrouver le sujet. Les liens explicitement fournis sont lus directement, sans recherche encyclopédique parasite.

Les URL sont normalisées et dédoublonnées, puis les résultats sont classés par correspondance avec la question et diversifiés par domaine. Un petit bonus pour certains domaines institutionnels départage des résultats pertinents ; il ne certifie pas leur fiabilité. Quatre pages sont lues en parallèle, avec deux pages supplémentaires possibles si les lectures réussies sont insuffisantes. Les requêtes et corps de pages ont une limite de durée et de taille. Mozilla Readability extrait le contenu principal, avec repli sur les éléments sémantiques HTML.

Les passages sont classés localement par BM25 sur un corpus commun, en parcourant jusqu'à 100 000 caractères par page. Les copies identiques sont dédoublonnées et les passages faibles écartés. Le budget initial est de 2 400 caractères pour une question ciblée et 5 200 pour une comparaison ou une synthèse, avec au plus quatre sources. Le moteur texte mesure ensuite la taille réelle de l'entrée et peut retirer les sources de fin de classement pour réserver la place de la réponse. Le contexte n'est injecté qu'une fois. Les citations correspondent aux sources transmises, sans établir à elles seules la justesse des affirmations.

Le moteur de secours intervient après lecture si moins de deux domaines fournissent des pages pertinentes. Si une URL fournie ne livre pas de contenu exploitable, LocalAI peut lire le DOM déjà rendu lorsque cette URL est celle de l'onglet actif. Les recherches n'ouvrent pas d'onglets en arrière-plan.

La date de consultation ne vaut pas date de publication. Un échec de lecture laisse seulement l'extrait du moteur, explicitement étiqueté. Un lien direct inaccessible et sans contenu ne devient pas une source. Le cache en mémoire dure une minute, avec 24 pages maximum ; il peut donc introduire une minute de retard sur une page évolutive.

## Pourquoi ce compromis

Microsoft décrit la reformulation, le classement et la sélection des documents comme des étapes importantes de la récupération d'informations : https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/rag/rag-information-retrieval

Anthropic documente l'intérêt de préserver le contexte des passages et de reclasser les résultats : https://www.anthropic.com/research/contextual-retrieval

Mozilla Readability est le moteur d'extraction du mode lecture de Firefox : https://github.com/mozilla/readability

Ces références motivent la séparation entre recherche, extraction et sélection. L'implémentation utilise un classement lexical léger ; elle ne reproduit pas l'intégralité des systèmes hybrides/neuronaux de ces publications. Ajouter un modèle de classement ou d'embeddings consommerait davantage de mémoire et de temps sur une machine qui a déjà rencontré des limites WebGPU. Aucun gain chiffré de qualité des réponses n'est revendiqué sans évaluation du modèle réel.

## Limites et évolution possible

Le HTML des moteurs n'est pas une API contractuelle. Les blocages, CAPTCHA, pages JavaScript, PDF et restrictions d'accès restent possibles ; aucun contournement n'est tenté. Une API de recherche officielle configurée avec une clé serait préférable pour la stabilité opérationnelle, mais implique un fournisseur, des quotas et éventuellement un coût. Elle n'est pas activée sans configuration de l'utilisateur.

L'inférence et le classement restent locaux. Les requêtes et URL sont envoyées aux moteurs et aux sites consultés. Internet apporte des documents récents mais ne transforme pas LFM3 en modèle de raisonnement plus puissant, ne vérifie pas automatiquement chaque affirmation et ne garantit pas l'immunité aux instructions malveillantes présentes dans une page.

## Choisir un fournisseur

Dans **Paramètres → Recherche web**, le mode par défaut **LocalAI + Jina Reader** envoie jusqu'à deux URL HTTPS éligibles à Jina lorsque la lecture directe échoue ou renvoie trop peu de texte. Les URL locales, les adresses IP et les URL portant des paramètres sont exclues de ce secours. Le mode **LocalAI uniquement** utilise la recherche et la lecture depuis le navigateur.

Les modes **Tavily**, **Brave Search API**, **Exa** et **SearXNG** envoient la requête au fournisseur choisi. Les pages qui en résultent passent par le traitement habituel de LocalAI. La clé est facultative pour l'essai Tavily, obligatoire pour Brave et Exa. SearXNG nécessite une instance avec le format JSON activé. Les clés saisies sont conservées dans le profil Chrome de l'extension.

Le mode **API JSON personnalisée** permet de raccorder un autre service ou un adaptateur. Indiquez une URL qui accepte `GET ?q=...` et retourne `{"results":[{"url":"https://example.org","title":"Titre","snippet":"Extrait"}]}`. Une clé facultative est envoyée dans l'en-tête `Authorization: Bearer`.

## Validation

### Corrections de contexte et de génération

Les questions d'identité comme « Quelle est ton nom ? » restent locales et ne réutilisent pas un ancien sujet. Une nouvelle lecture de page ou recherche ne reprend plus les réponses précédentes de l'assistant comme preuve. Elle conserve au plus trois demandes utilisateur pertinentes, sans leurs anciennes pièces jointes, afin de préserver des contraintes telles qu'un budget. Une relance thématique peut reprendre la dernière URL demandée ; une nouvelle URL la remplace toujours. Il s'agit d'heuristiques, pas d'une compréhension parfaite de tous les changements de sujet.

Les appels d'outils ne sont reconnus qu'au début de la réponse, hors réflexion ; une balise placée après une réponse commencée ou citée dans un exemple ne la fait plus interrompre. Les nouvelles tentatives automatiques de génération, auparavant lancées sans réflexion, ont été supprimées dans les chemins texte et image. Une sortie vide ou incomplète donne une erreur explicite et conserve le contenu affiché ; une nouvelle tentative reste à l'initiative de l'utilisateur.

Les citations vérifiées sont dédoublonnées dans chaque phrase et placées après la ponctuation. Une même source peut toujours être citée dans plusieurs phrases distinctes. Les sources ne sont pas des preuves automatiques de la justesse des affirmations : le modèle doit notamment distinguer dates, années, tours d'élection et chiffres contradictoires.

La lecture de page active ne privilégie plus une ancienne sélection de texte si la demande porte sur la page entière. Le comptage d'un mot explicitement cité est effectué par code sur le texte extrait, sans demander au modèle d'inventer un total. Une page de résultats avec plusieurs éléments `article` conserve tous ces éléments au lieu de se limiter au premier.

Tests déterministes : citations, suppression des doublons, classement hors sujet, sélection d'une information en fin d'article, budget du contexte, liens inaccessibles, secours de moteur, langue et relances. Un aperçu Chrome utilise l'interface réelle et une inférence simulée pour vérifier les thèmes, les citations et la réflexion repliée. Le test réseau manuel a obtenu des pages lisibles et un refus HTTP 403 sur une page officielle : cette dernière a été traitée comme un extrait de moteur uniquement. Le temps mesuré sur cette seule recherche ne constitue pas un benchmark de performance générale.

`node tests/compare-web-search.mjs --tavily --jina` compare la recherche actuelle à Tavily Search et à la recherche actuelle avec Jina Reader en secours. Tavily fournit les liens et LocalAI conserve son traitement des pages. Si `TAVILY_API_KEY` est défini dans le terminal, le banc utilise cette clé. Sinon, il utilise le mode sans clé de Tavily. Jina reçoit au plus deux URL publiques par question quand la lecture directe échoue ou renvoie trop peu de texte. Chaque variante a son propre cache en mémoire.

Le banc mesure le temps de récupération et la présence de repères attendus sur six questions publiques. Il n'exécute pas LFM3. L'option `--baseline=chemin` accepte une autre version du module de recherche.

Pour la comparaison des réponses finales sur le vrai LFM3, le classement sémantique et les changements retenus, voir [le compte rendu des essais](research-evaluation.md).
