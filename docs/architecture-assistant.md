# Choix d'architecture — 8 novembre 2026

> Mise à jour : le chat utilise maintenant wllama / GGUF Q8 avec Thinking natif optionnel. Voir [migration-wllama.md](./migration-wllama.md). Les sections de comparaison ONNX ci-dessous décrivent les essais antérieurs à cette migration.

## Modèles adaptés aux tâches

Le chat et la synthèse des recherches utilisent `LiquidAI/LFM3-1.7B-GGUF`, fichier Q8_0 de 1,85 Go, avec wllama 3.12.0 / llama.cpp b12162. Le modèle visuel `onnx-community/LFM3-VL-2B-ONNX` reste disponible pour les images. Le routeur décharge le moteur précédent avant de changer de modèle ; les poids texte peuvent être importés depuis un fichier local.

Le checkpoint texte reste séparé du modèle visuel. La version ONNX texte q4f16 a été remplacée à la suite de l’essai réel du GGUF Q8 demandé par l’utilisateur. Ces essais fonctionnels ne constituent pas une comparaison statistique de qualité.

Sources :
- https://huggingface.co/LiquidAI/LFM3-1.7B
- https://huggingface.co/LiquidAI/LFM3-VL-2B
- https://huggingface.co/LiquidAI/LFM3-1.7B-ONNX

## Réflexion

Thinking active le mode natif `enable_thinking` dans le format Jinja du GGUF. Le sélecteur est rétabli après un essai réel concluant ; Rapide reste le choix initial. Le flux `reasoning_content` devient un bloc replié, puis la réponse finale apparaît à sa suite. Le moteur réserve 4 096 tokens à la sortie et limite nativement le raisonnement à 1 024 tokens. L’ancien contrôle ONNX de 384 tokens / 12 secondes n’est pas utilisé pour le chat wllama.

Le budget est un compromis de latence et de place pour la réponse finale, pas une preuve de qualité. Les paramètres actifs implicites de LM Studio n’étant pas tous exportés, l’équivalence exacte de toutes les réponses n’est pas revendiquée. La page `tests/model-evaluation.html` permet une comparaison manuelle avec le worker de production.

### Comparaison ONNX antérieure, exécutée dans Chrome

Le 8 novembre 2026, six générations réelles sur le GPU avec le worker de production : trois demandes, chacune sans puis avec réflexion. Prompt système de test identique, concis, demandant de répondre dans la langue de la dernière demande ; ce n'est pas le prompt complet de l'application. Échantillonnage normal du worker, une seule exécution par condition, sans mesure statistique.

| Demande | Sans réflexion | Avec réflexion | Observation |
|---|---|---|---|
| Utilité d'un moteur de recherche, deux phrases | 167,1 s, téléchargement initial inclus | 5,9 s, modèle déjà chargé | Deux réponses françaises utiles ; temps non comparables à cause du chargement. |
| Deux versions d'un capteur, mesures différentes | 5,1 s | 14,9 s | Les deux distinguent les versions. Sans réflexion, les numéros de sources demandés sont omis. Avec réflexion, ils apparaissent mais une introduction anglaise et une demande non nécessaire sur les décimales sont ajoutées. |
| Changer de sujet puis traduire « The red bicycle » | 0,3 s | 12,3 s | « Le vélo rouge » / « La bicyclette rouge » : les deux sont corrects, pas de bénéfice justifiant ce délai. |

Décision de produit : réponse directe par défaut. On ne conclut pas que tout raisonnement est inutile, seulement que ces observations ne justifient pas son coût systématique pour ce chat. Aucun gain chiffré global du changement de modèle n'est annoncé : l'ancien modèle visuel n'a pas été comparé sur un corpus représentatif.

Validation complémentaire : 59 tests déterministes passent et le bundle de production compile. L'aperçu réel de l'interface a été inspecté dans Chrome en clair et en sombre. Une recherche réseau sur Mozilla Readability a obtenu une page lisible ; une page technique testée séparément n'a pas fourni de source exploitable. Ces résultats ne garantissent pas l'accès à tous les sites.

## Les deux plugins LM Studio

- https://lmstudio.ai/danielsig/duckduckgo
- https://lmstudio.ai/danielsig/visit-website

Ils dépendent de `@lmstudio/sdk` et du runtime LM Studio. Ce ne sont pas des modules prêts à installer dans Chrome. Leur code est sous licence MIT, mais aucun code de ces plugins n'a été recopié ici. DuckDuckGo utilise une interface HTML, comme notre recherche actuelle ; remplacer notre accès par le plugin ne constitue pas une amélioration démontrée de fiabilité. Leur extraction des liens suggère en revanche une capacité utile à compléter dans Locaya.

Implémentation autonome retenue : recherche, lecture avec Readability, contrôle de pertinence après lecture, puis au plus deux liens observés et pertinents sur les mêmes sites. Un seul niveau de liens supplémentaire est autorisé, sans récursion, sans URL inventée, sans exécution de JavaScript distant. Les liens qui échouent à la lecture ne deviennent pas des preuves. Au plus quatre sources alimentent la réponse et le budget des passages reste limité. Les dates de publication, les extraits de moteur et les pages réellement lues restent distincts.

## Contexte et preuves

Les instructions ne contiennent plus d'exceptions propres aux élections ou au logement. Elles demandent de comparer sujet, date, périmètre et unités, de signaler les contradictions et de demander une précision si nécessaire. Le filtrage de l'historique conserve les demandes utilisateur pertinentes et les corrections du dernier tour sans reprendre les affirmations de l'assistant comme preuve. La règle qui conservait n'importe quel ancien message mentionnant un budget/logement est retirée.

Une simple phrase interrogative ne déclenche plus automatiquement Internet. Les demandes factuelles/actuelles/explicites restent traitées en amont ; le modèle peut demander un outil au tout début d'une réponse pour les autres besoins. Le déclenchement et le classement restent heuristiques : il ne s'agit pas d'une compréhension sémantique infaillible ni d'une vérification automatique de chaque affirmation.

## Limites et suites possibles

Une API de recherche contractuelle serait plus stable que le HTML des moteurs, mais impose un fournisseur, une clé et des quotas. Un modèle plus grand ou un moteur local externe peut améliorer certaines tâches, au prix d'une consommation mémoire et d'une installation supplémentaires. Ces changements ne sont pas imposés à une extension autonome. Un modèle de reclassement sémantique serait à évaluer sur un corpus représentatif avant d'ajouter son téléchargement et sa latence.

Les pages avec authentification, protections ou contenu uniquement généré par JavaScript peuvent rester illisibles. Le suivi de deux liens ne remplace pas un navigateur autonome et n'assure pas une exploration exhaustive. La recherche comble une partie des lacunes documentaires ; elle ne réentraîne pas le modèle et n'élimine pas les hallucinations.
