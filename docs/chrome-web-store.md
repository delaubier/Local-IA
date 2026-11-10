# Fiche Chrome Web Store — Locaya 1.8.0

## Français

**Nom** — Locaya — Assistant IA local

**Description courte** — Discutez avec une IA locale, dictez vos messages, analysez des pages et documents et trouvez des sources sur le web.

**Description détaillée**

Locaya place un assistant IA dans le panneau latéral de Chrome. Posez vos questions, rédigez, dictez vos messages ou analysez vos documents sans quitter votre page.

- Chat sur votre appareil avec LFM3 1.7B Q8_0, modèles alternatifs et import GGUF compatible.
- Dictée multilingue avec Whisper ou Parakeet v3 et lecture des réponses à voix haute.
- Résumé de pages, analyse d’images et de PDF, et recherche web avec citations.
- Historique local, export des conversations et thèmes clair et sombre.

Une fois le modèle téléchargé, le chat local fonctionne hors connexion. Une connexion est nécessaire pour télécharger les modèles et consulter le web. Les recherches peuvent transmettre le texte de la requête à des fournisseurs externes. Les performances dépendent de l’appareil.

## English

**Name** — Locaya — Local AI Assistant

**Short description** — Chat with AI on your device, dictate messages, analyze pages and documents, and find sources on the web.

**Full description**

Locaya puts an AI assistant in Chrome’s side panel. Ask questions, write, dictate messages or analyze documents without leaving your page.

- On-device chat with LFM3 1.7B Q8_0, alternative models and compatible GGUF imports.
- Multilingual dictation with Whisper or Parakeet v3, plus read-aloud.
- Page summaries, image and PDF analysis, and web search with citations.
- Local chat history, conversation export, and light and dark themes.

Local chat works offline after the model download. Downloading models and using web search require internet access. Search queries may be sent to external providers. Performance depends on your device.

## Tableau de bord éditeur

- **Objectif unique** — Fournir un assistant IA dans le panneau latéral du navigateur pour dialoguer, dicter et analyser du contenu à la demande.
- **sidePanel** — Affiche l’assistant dans le panneau latéral de Chrome.
- **unlimitedStorage** — Conserve les poids des modèles, souvent de plusieurs centaines de Mo ou plus, pour éviter de les retélécharger.
- **activeTab et scripting** — Lisent le contenu de l’onglet actif pour les outils de page.
- **tabs** — Identifie l’onglet actif et lit le titre et l’URL nécessaires aux outils de page.
- **tabCapture** — Capture l’audio de l’onglet pour une transcription demandée par l’utilisateur lorsque les sous-titres ne sont pas disponibles.
- **Accès aux sites** — Récupère des modèles, interroge les moteurs de recherche, lit les sources et permet les outils de page et de capture sur les sites consultés.
- **Politique de confidentialité** — Publier [PRIVACY.md](../PRIVACY.md) à une adresse publique, puis renseigner cette adresse et les coordonnées de l’éditeur.
- **Instructions de test** — Ouvrir le panneau, télécharger LFM3 ou choisir un modèle plus petit, puis envoyer un message. Le téléchargement initial peut prendre plusieurs minutes. Aucun compte ni clé n’est nécessaire pour tester le chat.
- **Éléments à joindre** — ZIP de production, icône 128 × 128 px et au moins une capture de l’interface.

Le ZIP contient les scripts, workers et moteurs WebAssembly de production. Les fichiers de modèles, téléchargés au besoin, sont des données d’inférence. Vérifier les déclarations du tableau de bord en fonction des fonctionnalités décrites dans la politique de confidentialité.
