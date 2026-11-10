# Comparatif des réponses de LocalAI

Essais du 10 novembre 2026 sur six questions publiques en français et en anglais. Les scores de récupération comptent des repères attendus dans les passages transmis. Les réponses sont ensuite lues avec leurs sources pour vérifier le fait demandé, en distinguant une date d'événement d'une date de publication ou d'une tentative prévue. Le modèle est LFM3 1.7B Q8, exécuté avec le worker de l'extension dans Chrome, graine 42 et 384 tokens de sortie maximum.

| Recherche, avant la correction des tableaux | Repères présents | Réponses complètes de LFM3 |
| --- | ---: | ---: |
| LocalAI | 6 sur 8 | 4 sur 6 |
| LocalAI + Jina | 5 sur 8 | 3 sur 6 |
| Tavily sans clé + lecture LocalAI | 5 sur 8 | 3 sur 6 |
| LocalAI + Jina et une relance pour les dates | 5 sur 8 | 3 sur 6 |

Le moteur a renvoyé des pages différentes selon les exécutions, y compris entre deux modes qui ont interrogé le même moteur. Les résultats ne permettent pas d'attribuer l'écart entre les deux modes LocalAI à Jina. Les essais précédents montrent que Jina peut récupérer une page officielle illisible localement. Il reste le secours par défaut. Tavily reste disponible dans les paramètres. Brave et Exa ont été vérifiés sur des réponses simulées faute de clés de test. Deux instances publiques SearXNG n'ont pas fourni de JSON (HTTP 200 en HTML et HTTP 429). L'adaptateur JSON a aussi été vérifié en simulation et sa qualité dépend du service configuré.

- **Passages datés.** La relance ciblée, le classement donnant un bonus aux dates et une consigne plus courte n'ont pas corrigé les cas difficiles de façon régulière. Les annonces Artemis I et les dates d'autres étapes de la mission Rosetta peuvent encore induire le modèle en erreur. En revanche, séparer les cellules des tableaux a rendu la date d'impact de DART utilisable avec la page NASA déjà trouvée. LFM3 a ensuite donné Dimorphos et le 26 septembre 2022, avec la source appropriée.
- **Classement inspiré de Page Assist.** Sur six petits cas contrôlés, BM25 a placé le passage attendu en premier 1 fois, le modèle sémantique multilingue E5 Small Q8 2 fois, et le classement combiné 1 fois. Le modèle sémantique prend en moyenne 27 ms à chaud pour une question et trois passages sur ce PC, hors chargement. Ce résultat ne justifie pas d'ajouter ce modèle à l'extension.
- **Contexte.** Les deux versions ont correctement traduit « The red bicycle » malgré l'ancien sujet. La séparation explicite des sujets reste utile pour empêcher un ancien lien ou un ancien budget de réapparaître. Elle est contrôlée par un test couvrant le changement de sujet et la relance suivante.
- **Calcul.** LFM3 rapide a atteint la limite de sortie avant de donner le résultat demandé seul. Le mode réflexion a fourni 64,23 € en environ 9,5 secondes, avec plusieurs étapes. L'arithmétique décimale renvoie directement 64,23 € pour cette demande. Elle est utilisée pour les pourcentages autonomes reconnus en français et en anglais, avec arrondi explicite si demandé.
- **Autre modèle.** [Qwen3 1.7B Q8](https://huggingface.co/Qwen/Qwen3-1.7B-GGUF) a obtenu 3 réponses complètes sur 6 avec les mêmes passages LocalAI + Jina et les mêmes réglages que LFM3. Sa génération médiane a pris 3,33 s contre 7,16 s pour LFM3 sur ces six questions. Il a toutefois affirmé deux dates erronées pour DART et Philae, et compté 2 occurrences au lieu de 4. LFM3 reste le modèle par défaut.

Pour rejouer le comparatif web, lancer `node tests/compare-web-search.mjs --tavily --jina --report=.local/research-evaluation.json`. Le contrôle DART utilise `node tests/compare-web-search.mjs --jina --question=DART --report=.local/dart-table.json`. Lancer ensuite `npm run test:wllama` et ouvrir [le banc de réponses](http://127.0.0.1:4174/tests/research-model-evaluation.html). Le classement contrôlé se rejoue avec `node tests/compare-passage-ranking.mjs`.

Le même banc de recherche accepte `--brave`, `--exa`, `--searxng` et `--custom`. Les clés et URL sont lues dans les variables d'environnement du fournisseur, par exemple `EXA_API_KEY` et `SEARXNG_SEARCH_URL`. Le bouton Qwen charge `.local/Qwen3-1.7B-Q8_0.gguf` au besoin.
