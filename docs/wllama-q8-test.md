# Essai LFM3 Q8 dans le navigateur

> Rapport de l’essai initial. Le moteur a ensuite été intégré à l’extension : voir [migration-wllama.md](./migration-wllama.md).

## Résultat du 8 novembre 2026

Le fichier local `LFM3-1.7B-Q8_0.gguf` (1 846 238 496 octets) a été chargé et a produit quatre réponses complètes dans le navigateur Chromium intégré à Codex. Aucun appel à LM Studio, aucun accès au Web pendant les réponses. Le moteur de l’extension distribuée reste inchangé : ce banc d’essai est indépendant.

Configuration effectivement observée :

- wllama 3.12.0, llama.cpp **b12162-d38bea3** ;
- adaptateur WebGPU NVIDIA, architecture Lovelace ;
- **25/25 couches déportées sur le GPU**, poids GPU 1 752,84 Mio, tampon de poids CPU 265,62 Mio (ce ne sont pas des mesures de mémoire totale du navigateur) ;
- contexte 8 192 tokens, quatre threads, batch 256 / microbatch 128 ;
- format Jinja inclus dans le GGUF, `enable_thinking: false`, aucun message système ajouté ;
- température 0,1, top-k 50, top-p 1, min-p 0, répétition 1,1, graine 42, sortie limitée à 512 tokens ;
- chargement initial mesuré **22,52 s**, lecture du fichier local et initialisation incluses.

| Contrôle | Observation | Durée totale | Premier texte |
| --- | --- | ---: | ---: |
| Explication du ciel bleu en français | Deux phrases en français, réponse pertinente, formulation assez longue | 2,74 s | 0,73 s |
| Deux documents avec valeurs différentes | 10 cm en 2023 et 14 cm en 2025 correctement distingués, citations conservées | 3,70 s | 0,49 s |
| Logement puis changement de sujet | Traduction « Le vélo rouge. », sans reprise du logement | 0,39 s | 0,29 s |
| Météo et climat en anglais | Deux phrases en anglais, distinction correcte | 1,04 s | 0,24 s |

Toutes les générations se sont terminées avec `finish_reason: stop`, sans réponse vide ni remplacement de réponse. Le rapport brut contient les requêtes, sorties, réglages, temps et diagnostics : [wllama-q8-evaluation.json](./wllama-q8-evaluation.json).

Il s’agit de quatre vérifications fonctionnelles, pas d’un score général de qualité. Elles ne démontrent pas une supériorité sur ONNX ni une équivalence exacte à LM Studio : les paramètres d’échantillonnage actifs de LM Studio n’ont pas tous été récupérés et aucun A/B simultané avec les mêmes requêtes n’a été réalisé ici. La fidélité au changement de sujet et aux documents peut être testée plus largement à partir de ce banc.

## Relancer et poser ses propres questions

Depuis le dossier du projet :

```powershell
npm run test:wllama
```

Ouvrir [le banc d’essai](http://127.0.0.1:4174/tests/wllama-evaluation.html), puis cliquer sur **Charger le fichier local configuré**. Le lanceur retrouve automatiquement le fichier Q8 à son emplacement actuel dans `.lmstudio/models/LiquidAI/LFM3-1.7B-GGUF/`. Ce dossier sert uniquement d’emplacement de lecture : LM Studio n’a pas besoin de tourner.

On peut aussi choisir un GGUF avec le sélecteur de fichier. Le fichier choisi est lu localement par le navigateur et n’est envoyé à aucun serveur. Pour configurer un autre emplacement du modèle servi en boucle locale :

```powershell
$env:LOCALAI_GGUF = 'C:\chemin\LFM3-1.7B-Q8_0.gguf'
npm run test:wllama
```

**Nouvelle conversation** efface le contexte de dialogue, **Libérer le modèle** libère le moteur. Les cas de contrôle sont indépendants ; les questions envoyées manuellement partagent un historique jusqu’à la prochaine nouvelle conversation. Le mode CPU peut également être sélectionné, mais les mesures ci-dessus concernent WebGPU uniquement.

## Pourquoi une version préparée spécialement ?

Le premier test réel avec la version publiée sur npm, **3.8.1 / b11364**, échoue : `unknown model architecture: 'lfm3'`. Cette version résout même `loadModel` avec un contexte nul ; le banc vérifie donc aussi que le contexte, le vocabulaire et les couches sont réellement présents avant d’afficher « prêt ».

La version récente de la démonstration officielle wllama fournit le moteur requis. Le script `tests/prepare-wllama.mjs` prépare une paire cohérente, sans modifier le paquet npm ni l’extension :

- source officielle : commit [`a24b3564dd3c108af85a79a2c3b08a88bd2e7370`](https://github.com/ngxson/wllama/tree/a24b3564dd3c108af85a79a2c3b08a88bd2e7370), version 3.12.0, worker b12162 ;
- WASM de [l’espace officiel ngxson/wllama](https://huggingface.co/spaces/ngxson/wllama/tree/b4aab287485d231cca6896e614e24362436f49a1), révision immuable `b4aab287485d231cca6896e614e24362436f49a1` ;
- archive et WASM contrôlés par SHA-256 ; préparation dans `.local/wllama-evaluation/`, exclu de Git ;
- aucun exécutable chargé depuis un CDN pendant le test ; compatibilité CDN désactivée ;
- serveur limité à `127.0.0.1`, avec isolation nécessaire aux threads ; son endpoint GGUF ne sert que le fichier explicitement configuré, sans accès à un répertoire arbitraire.

La première préparation télécharge environ 10 Mo de WASM et la source du moteur, **pas les poids du modèle**. Les lancements suivants réutilisent ces fichiers locaux. LFM3 exige au minimum llama.cpp b11960 selon la [fiche officielle du modèle](https://huggingface.co/LiquidAI/LFM3-1.7B-GGUF) ; le moteur effectivement testé est plus récent.

L’intégration dans l’extension est désormais réalisée, avec workers statiques, dictée conservée et traitement séparé des images. Le test historique de ce document porte sur le modèle texte Q8 dans le banc indépendant.
