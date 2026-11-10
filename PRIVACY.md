# Politique de confidentialité de Locaya

Cette politique décrit le fonctionnement de l’extension Chrome Locaya.

## Données traitées sur l’appareil

Locaya traite les messages, les fichiers joints, les images, les captures d’écran et les données de dictée sur l’appareil pour produire les réponses ou les transcriptions demandées. L’accès au microphone nécessite l’autorisation de l’utilisateur. Les outils de page ou d’onglet lisent le contenu nécessaire à l’action demandée, par exemple pour résumer une page ou transcrire son audio.

L’extension conserve localement les conversations, réglages, modèles téléchargés ou importés et éventuelles clés des fournisseurs de recherche. Les conversations peuvent être exportées ou supprimées. Les réglages, conversations et fichiers des modèles peuvent être gérés séparément dans les paramètres. Locaya n’exige aucun compte et ne contient pas de télémétrie propre.

## Connexions à des services tiers

- **Recherche web.** Locaya peut lancer une recherche si la demande s’y prête. Le texte de la requête, qui peut reprendre des éléments du message ou de son contexte, est transmis aux moteurs consultés. Par défaut, il s’agit de DuckDuckGo et Wikipédia, avec Brave en secours. Si la lecture directe échoue, Jina Reader peut recevoir l’URL d’une page publique à lire. Les liens consultés sont chargés auprès de leurs hébergeurs.
- **Fournisseurs configurés par l’utilisateur.** Si un fournisseur est sélectionné dans les paramètres, il reçoit la requête de recherche et, si nécessaire, la clé configurée pour lui. Ces services appliquent leurs propres règles de confidentialité.
- **Téléchargement des modèles.** Les fichiers des modèles sont récupérés auprès de leurs hébergeurs, notamment Hugging Face. Comme pour toute connexion web, le service peut recevoir l’adresse IP et les informations techniques de la requête.
- **Lecture à voix haute.** Pocket TTS synthétise la voix sur l’appareil après téléchargement. L’autre mode utilise le moteur de voix fourni par Chrome ou le système. Certaines voix disponibles peuvent être fournies par un service distant et recevoir le texte à lire.

Locaya utilise ces données pour exécuter les fonctions demandées par l’utilisateur. L’extension ne vend pas de données, ne les utilise pas pour la publicité et ne les envoie pas à un serveur de Locaya. L’utilisation et le transfert des données reçues via les API Google respectent les exigences d’utilisation limitée du Chrome Web Store.

Pour toute question sur la confidentialité, utilisez les coordonnées de l’éditeur indiquées sur la fiche Chrome Web Store.
