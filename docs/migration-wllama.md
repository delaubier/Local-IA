# Migration de Locaya vers wllama / LFM3 Q8

Le moteur texte de l’extension est remplacé par **wllama 3.12.0**, embarquant **llama.cpp b12162-d38bea3**, et `LFM3-1.7B-Q8_0.gguf`. Il s’agit du même fichier de 1 846 238 496 octets que celui présent dans le dossier LM Studio de l’utilisateur et testé dans le banc indépendant.

## Réglages

Réglages de chargement retrouvés dans la configuration enregistrée de LM Studio : contexte 8 192 tokens, quatre threads CPU, Flash Attention, déport GPU complet. Le template Jinja est lu directement dans le GGUF. Le projet utilise un batch de 256 et un microbatch de 128.

Échantillonnage explicite : température 0,1, top-k 50, pénalité de répétition 1,1, top-p 1, min-p 0. Les trois premiers correspondent aux recommandations incluses dans le GGUF. La configuration LM Studio consultée ne contenait pas de valeurs explicites d’échantillonnage ; on ne prétend donc pas avoir reproduit tous ses défauts actifs. La graine n’est pas fixée dans le chat.

**Thinking** utilise `chat_template_kwargs.enable_thinking: true` et le raisonnement natif de llama.cpp. Rapide utilise `false`. Le choix est mémorisé dans l’interface ; les demandes visuelles gardent leur mode direct. Le bloc de réflexion reste fermé jusqu’au clic. Les canaux séparés `reasoning_content` et `content` sont réunis sans remplacer une réponse déjà affichée.

Différence volontaire pour l’extension : budget natif de raisonnement **1 024 tokens**, pour préserver une réponse finale dans la limite de **4 096 tokens de génération**. Aucun forçage ONNX de fermeture à 384 tokens / 12 secondes. Ce budget n’est pas présenté comme un paramètre récupéré de LM Studio. Le prompt est compté par le moteur avec une requête bornée à un seul token, jamais affichée ; les anciennes paires de messages sont retirées si le prompt dépasse 4 096 tokens. Un dernier message trop long provoque une erreur explicite. Le contexte affiché dans l’historique est conservé.

À la demande de l’utilisateur, l’instruction système est désormais vide. L’interface n’ajoute plus de rappel de langue aux messages et les workers n’injectent plus de consignes générales sur les outils. Les requêtes de recherche et les documents peuvent encore enrichir le contexte utilisateur : cela reste une différence avec un chat LM Studio hors ligne. Température 0,1, top-k 50 et pénalité de répétition 1,1 sont identiques en Rapide et en Thinking.

## Stockage et sécurité Chrome

- Le premier démarrage demande un téléchargement ou l’import du GGUF existant. L’import ne fait aucun appel à LM Studio et n’envoie pas le fichier à un serveur.
- Les octets sont écrits progressivement dans OPFS. Le marqueur de cache n’est écrit qu’après réception complète et contrôle du format. Une copie partielle n’est jamais déclarée prête.
- Le cache GGUF est distinct de l’ancien cache ONNX. Aucune suppression de l’historique ni des modèles existants n’est effectuée.
- `scripts/prepare-wllama.mjs` prépare les sources et le WASM officiels épinglés et vérifiés par SHA-256. Les workers sont adaptés sous forme de fichiers statiques, y compris les pthreads.
- Le moteur n’utilise ni worker construit à partir d’un blob, ni compatibilité chargée depuis un CDN. La politique `script-src 'self' 'wasm-unsafe-eval'` reste active.
- Le manifeste active COOP/COEP pour les threads. Chrome doit prendre en charge WebGPU, JSPI et Memory64.

Les images conservent LFM3-VL-2B / ONNX dans un worker séparé. Le routeur libère wllama avant les images et termine le worker visuel avant le retour au texte. Whisper et les outils Web restent disponibles.

## Vérifications

- Essai indépendant Thinking natif, sans Internet : problème de deux billes de même couleur, résultat correct **2/5 = 40 %**, réponse finale complète, environ **19,51 secondes** au total. Ce test précédait l’ajout du budget de 1 024 tokens.
- Vraie interface React, vrais workers et même politique de scripts que le manifeste : import du fichier local, chargement depuis le cache après rechargement, réponse directe, réponse Thinking correcte au problème de probabilités, bloc replié par défaut, arrêt d’une réflexion longue sans relance automatique.
- Après application du budget natif, réponse finale vérifiée : **2/5 = 40 %**. Retour au mode Rapide vérifié sur le tour suivant : réponse « Bonjour. », sans réflexion affichée. La barre de saisie a été vérifiée à 400 pixels de largeur.
- Tests automatisés : acquisition obligatoire, cache complet/incomplet, import sans réseau, contexte avant affichage, flux de réflexion séparé, interruption limitée à la requête active, outils, citations et dictée.
- Compilation de production réussie et **62 tests automatisés validés**. Capture : [wllama-extension.png](./wllama-extension.png).

La vérification du chat est réalisée sur une origine HTTP locale avec la politique de scripts de l’extension. Le rechargement de `chrome://extensions` reste à effectuer dans le profil Chrome de l’utilisateur pour activer le nouveau bundle `dist`.
