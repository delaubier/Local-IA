# Locaya

Locaya est un assistant IA dans le panneau latéral de Chrome. Le chat et la dictée s'exécutent sur votre appareil. Le chat fonctionne hors connexion après le téléchargement du modèle. La recherche web peut consulter des sources externes pour enrichir une réponse.

- **Chat local** avec LFM3 1.7B Q8_0 par défaut, plusieurs modèles Qwen en option et l'import de fichiers GGUF compatibles.
- **Dictée locale** avec Whisper Base par défaut, Whisper Tiny, Whisper Small ou Parakeet v3. La transcription est insérée dans le brouillon pour relecture.
- **Analyse de pages, d'images et de documents**, dont les PDF. Le modèle visuel se télécharge séparément au premier usage.
- **Recherche web avec citations**, historique local, export des conversations, thèmes clair et sombre, interface française et anglaise.
- **Lecture des réponses** avec les voix du navigateur ou avec Pocket TTS pour le français et l'anglais.

## Installer depuis le code source

Il faut une version récente de Chrome avec WebGPU, WebAssembly JSPI et Memory64, ainsi que Node.js 22 ou plus récent et un outil de décompression (`unzip` sur Linux/macOS, PowerShell sur Windows).

```sh
npm ci
npm run build
```

La première compilation récupère la version épinglée du moteur wllama et vérifie les empreintes des fichiers. Dans `chrome://extensions`, activez le mode développeur, cliquez sur **Charger l’extension non empaquetée**, puis sélectionnez le dossier `dist`. Cliquez sur l’icône Locaya pour ouvrir le panneau latéral.

Au premier lancement, téléchargez le modèle suggéré ou importez un GGUF compatible. LFM3 Q8_0 demande environ 1,85 Go de stockage et de la mémoire supplémentaire pour fonctionner. Le sélecteur propose des modèles plus petits si nécessaire. Le premier téléchargement et la recherche web nécessitent une connexion.

## Développement

```sh
node --test tests/*.test.mjs
npm run build
```

La génération utilise [wllama](https://github.com/ngxson/wllama) et llama.cpp. La dictée et l’analyse visuelle utilisent notamment Transformers.js et ONNX Runtime Web. La compatibilité et le débit dépendent du navigateur, du matériel et du modèle choisi.

Consultez [la politique de confidentialité](PRIVACY.md), [le fonctionnement de la recherche web](docs/web-research.md) et [la fiche Chrome Web Store](docs/chrome-web-store.md).
