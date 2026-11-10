# LocalAI - Extension Navigateur IA Locale (Liquid AI LFM3)

LocalAI est une extension de navigateur qui exécute **LFM3-1.7B Q8_0 GGUF** de [Liquid AI](https://www.liquid.ai/) directement dans votre navigateur grâce à **wllama**, **llama.cpp** et **WebGPU**. Transformers.js et ONNX Runtime restent utilisés pour les images et la dictée.

Inférence locale, sans clé API. Lors d'une recherche web, la requête est envoyée aux moteurs et les pages sont téléchargées depuis les sites consultés.

![LocalAI Banner](./assets/banner-v2.png)

## ✨ Fonctionnalités

- **Exécution 100 % locale (WebGPU)** : Toute l'inférence tourne sur votre carte graphique dans un Web Worker dédié sans bloquer l'interface.
- **Modèle texte (`LiquidAI/LFM3-1.7B-GGUF`) pour le chat** :
  - Architecture tri-hybride de Liquid AI (convolutions courtes + attention glissante + attention globale).
  - Fichier `LFM3-1.7B-Q8_0.gguf` (~1,85 Go), identique à celui testé dans le banc wllama. Import local ou téléchargement explicite, puis conservation sur l’appareil.
- **Paramètres de cohérence calibrés** :
  - Échantillonnage recommandé par Liquid AI (`temperature = 0.1`, `top_k = 50`, `repetition_penalty = 1.1`).
  - Contexte de 8 192 tokens, quatre threads, Flash Attention et déport GPU complet demandés, comme dans les réglages de chargement LM Studio récupérés. Batch 256, microbatch 128.
  - Gestion automatique du contexte : par défaut, 4 096 tokens maximum de prompt texte et 4 096 réservés à la génération ; 3 072 tokens avec image, tokens visuels inclus. Le contexte texte et le budget de sortie sont modifiables dans les paramètres.
  - Instruction système vide par défaut : aucune consigne générale ni rappel de langue n’est ajouté au dialogue. Une instruction personnelle peut être enregistrée par modèle. Les résultats de recherche et les documents restent du contexte propre à la demande concernée.
- **Analyse d'images à la demande** : `onnx-community/LFM3-VL-2B-ONNX` est réservé aux images ; un seul modèle LFM est chargé à la fois pour limiter la mémoire GPU. Le passage texte/image peut entraîner un téléchargement initial puis un rechargement depuis le cache.
- **Rapide / Thinking** : sélecteur dans la zone de saisie. Thinking active le raisonnement natif du GGUF (`enable_thinking`), affiché replié par défaut. Le budget initial de réflexion est de 1 024 tokens ; il est modifiable, y compris sans limite spécifique, dans le budget total de sortie. Rapide est le mode initial ; le choix est mémorisé. Aucune réponse commencée n’est effacée pour une nouvelle tentative silencieuse.
- **Conversations** : volet compact avec recherche, épinglage, renommage, export JSON et suppression depuis le menu de chaque conversation.
- **Paramètres en pleine page** : français ou anglais, langue initiale déterminée par Chrome (anglais pour les autres langues), sans choix « automatique ». Le changement manuel est mémorisé. Choix du modèle et import d’un GGUF personnel ; les fichiers sont stockés séparément sur cet appareil. Leur architecture et leurs exigences mémoire doivent être compatibles avec la version embarquée de wllama ; l’import ne convertit pas les modèles. Les réglages sont enregistrés immédiatement et séparément par modèle : contexte, instruction système, température, top-k, top-p, min-p, pénalités, graine, séquences d’arrêt, budget de réflexion, threads, batch et Flash Attention. Ils s’appliquent à la prochaine génération ; modifier les options de chargement entraîne un rechargement depuis le cache.
- **Gestion des données** : confirmation avant chaque réinitialisation ou suppression. Réinitialiser les paramètres restaure les réglages de tous les modèles, LFM3 et Whisper Small par défaut, la langue de Chrome, le thème sombre et le mode Rapide, sans effacer les modèles ni les conversations. Les commandes de suppression permettent de retirer un modèle texte ou audio, tous les fichiers de modèles (GGUF/ONNX, y compris les anciens caches) ou toutes les conversations. Les moteurs concernés sont arrêtés pour libérer leur mémoire. Une erreur de suppression est signalée ; elle n’est pas présentée comme une réussite.
- **Mesures des réponses** : la montre affiche au survol ou au clavier les tokens/s, les tokens générés et d’entrée, le temps de génération, le délai du premier token et la raison d’arrêt. Les temps comprennent la préparation du prompt et la génération, à partir du modèle chargé ; ils excluent le téléchargement, le chargement des poids et la recherche web préalable. Les anciennes réponses dépourvues de mesures ne présentent pas de statistiques inventées.
- **Analyse de documents** : Joignez des fichiers `.txt`, `.md`, `.json`, `.csv`, du code ou des **`.pdf`** (extraction locale via PDF.js).
- **Rendu Markdown & Code** : Coloration syntaxique, copie rapide et téléchargement des extraits de code.

## 🚀 Installation (Développement)

### Prérequis
- Chrome ou Edge récent, compatible **WebGPU**, **WebAssembly JSPI** et **Memory64**. Une ancienne version qui ne gère que WebGPU ne suffit pas. Le modèle visuel nécessite aussi `shader-f16`.
- Node.js 20+.

### Étapes
1. Installer les dépendances :
   ```bash
   npm install
   ```
2. Compiler l'extension :
   ```bash
   npm run build
   ```
   La première compilation prépare le moteur officiel wllama épinglé, contrôle ses empreintes et regroupe ses workers et son WASM dans `dist/wllama`. Aucun code n’est chargé depuis un CDN pendant l’utilisation.
3. Charger l'extension dans Chrome :
   - Ouvrir `chrome://extensions/`
   - Activer le **Mode développeur** (en haut à droite)
   - Cliquer sur **Charger l'extension non empaquetée** et sélectionner le dossier `dist`.
4. Au premier lancement, choisir **Importer mon fichier Q8_0.gguf** pour réutiliser le fichier de LM Studio, ou télécharger le modèle. Le cache ONNX précédent ne remplace pas le nouveau cache GGUF.

## 🛠️ Stack Technique

### Mémoire graphique et audio

- Au premier lancement, un écran modal sur fond grisé demande explicitement le téléchargement du modèle texte. Les actions restent bloquées jusqu'à sa préparation. Si les fichiers sont déjà en cache, la préparation démarre automatiquement sans redemander un téléchargement.
- Les images et captures demandent séparément le téléchargement du modèle visuel s'il manque ; cette activation peut être reportée. La demande en cours est conservée pendant la préparation.
- Le micro propose « Télécharger Whisper » avant tout premier enregistrement du modèle choisi. Après cette confirmation, la dictée commence automatiquement dès que Whisper est prêt, sous réserve d’autoriser le microphone. Le téléchargement et les informations de transcription apparaissent au-dessus de la zone de saisie. La forme d’onde défile à partir du son réellement capté, avec les échantillons récents à droite, sans texte ni pictogramme supplémentaire. La croix annule réellement le chargement ou la transcription : le worker est arrêté, les résultats tardifs sont ignorés, la saisie redevient disponible. Une annulation pendant le décodage audio empêche également toute transcription différée. Whisper sert aussi à la capture audio d'onglet en l’absence de sous-titres.
- Les moteurs de génération et de transcription refusent un premier usage sans préparation explicite. Un échec de téléchargement laisse une possibilité de réessayer.

- Les anciennes paires de messages sortent du contexte d'inférence quand le budget est dépassé, sans disparaître de la conversation affichée. Un dernier message encore trop long est refusé avec une explication. Les images sont redimensionnées avant traitement (409 600 pixels maximum, côté le plus long de 1 024 pixels maximum). Ces limites réduisent les allocations WebGPU ; elles ne garantissent pas la compatibilité avec tous les GPU.
- Dictée : choix entre `onnx-community/whisper-tiny`, `whisper-base` et `whisper-small` multilingues, quantifiés en q8 et exécutés sur CPU/WASM. Small reste le choix initial. Le changement libère l’ancien moteur et vérifie le cache du modèle choisi, sans téléchargement implicite. La langue est détectée acoustiquement à chaque enregistrement : un passage encodeur/décodeur avec le seul token de début classe les tokens de langue de Whisper, avant la transcription avec `task: 'transcribe'`. Cette étape compense la détection non implémentée de Transformers.js 4.3.2, qui sinon choisit l’anglais quand aucune langue n’est fournie. Aucune langue de navigateur ou de conversation n’est imposée. La détection utilise les 30 premières secondes ; un enregistrement mêlant plusieurs langues ou contenant très peu de parole peut rester imparfait.
- La conversation vocale continue est supprimée. Le bouton micro démarre et termine la dictée ; le texte transcrit est inséré dans la zone de saisie pour relecture avant envoi.
- La lecture utilise encore les voix disponibles dans `speechSynthesis` (Windows/Chrome), avec un débit normal et une langue stable pendant chaque réponse. Aucun moteur neuronal de synthèse vocale supplémentaire n'est installé.

- [React 19](https://react.dev/) & [Tailwind CSS v4](https://tailwindcss.com/) - Interface utilisateur
- [Transformers.js v4](https://huggingface.co/docs/transformers.js) & [ONNX Runtime Web (WebGPU)](https://onnxruntime.ai/) - Moteur d'inférence local
- [LiquidAI/LFM3-1.7B-ONNX](https://huggingface.co/LiquidAI/LFM3-1.7B-ONNX) - Modèle de langage
- [PDF.js](https://mozilla.github.io/pdf.js/) - Extraction de texte PDF côté client
- [Vite](https://vitejs.dev/) & [@crxjs/vite-plugin](https://crxjs.dev/vite-plugin) - Bundler d'extension Chrome Manifest V3

### Recherche web

Par défaut, LocalAI interroge DuckDuckGo et Wikipédia, avec Brave en secours lorsque les résultats pertinents sont insuffisants. Si la lecture directe échoue, Jina Reader peut recevoir jusqu'à deux URL publiques par recherche. Les paramètres proposent aussi le mode LocalAI uniquement et des fournisseurs externes, dont Tavily, Brave Search API, Exa et SearXNG. La requête est transmise au fournisseur choisi pour la recherche. [Fonctionnement et configuration](docs/web-research.md).

Les pages sont extraites avec Mozilla Readability, les résultats sont dédoublonnés et les passages pertinents sont sélectionnés localement par BM25 dans un budget limité. Les pages lues et les simples extraits de moteur sont explicitement distingués.

Les moteurs HTML peuvent changer, limiter les requêtes ou bloquer l'accès ; une API de recherche dédiée serait plus stable mais nécessiterait un fournisseur et une clé. La recherche améliore l'accès aux connaissances, sans garantir la véracité ou le raisonnement du modèle. Voir [l'analyse des choix et les limites](docs/web-research.md).

Validation : `node --test tests/*.test.mjs` et `npm run build`. Test réseau facultatif : `node tests/liveWebSmoke.mjs "votre requête publique"`. Aperçu de l'interface avec inférence simulée : `npx vite --config tests/ui.vite.config.ts`, puis `/tests/ui-preview.html` (hors bundle de production).

Test audio réel avec ce serveur : `/tests/audio-evaluation.html`, puis chargement explicite de Whisper Tiny et transcription des échantillons publics anglais/français de Hugging Face. Validé le 9 novembre 2026 : l’échantillon anglais est transcrit en anglais, puis le français en français, avec le même moteur de production et sans langue imposée. L’aperçu simule uniquement le microphone pour vérifier la forme d’onde et l’annulation ; le microphone physique n’a pas été utilisé pour ces essais. La présentation pour la boutique est préparée dans [chrome-web-store.md](docs/chrome-web-store.md).

Comparaison manuelle sur le GPU réel : avec ce même serveur, ouvrir `/tests/model-evaluation.html`. Trois demandes identiques sont exécutées sans puis avec raisonnement. Le premier lancement télécharge le modèle texte. Cette petite série permet de détecter des régressions ; elle ne constitue pas un benchmark représentatif. Le rechargement automatique du serveur de test est désactivé pour ne pas interrompre les téléchargements ; recharger manuellement après les modifications.
