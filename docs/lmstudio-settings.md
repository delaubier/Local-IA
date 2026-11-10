# Réglages LM Studio relevés le 8 novembre 2026

Export : [lmstudio-settings.json](./lmstudio-settings.json). Le modèle était déjà chargé ; aucun réglage du modèle ni de LocalAI n’a été modifié. Le SDK officiel 2.1.0 a été installé uniquement dans `.local/lmstudio-export/`, hors des dépendances de l’extension.

## Éléments confirmés

- Modèle : `LiquidAI/LFM3-1.7B-GGUF/LFM3-1.7B-Q8_0.gguf`, 1 846 238 496 octets.
- Contexte chargé : **8 192 tokens** ; quatre threads CPU, Flash Attention activée, déport GPU complet demandé.
- Moteur observé pendant le test : **llama.cpp NVIDIA CUDA12 AVX2, version LM Studio 2.71.0**.
- Conversation sélectionnée : instructions système vides, modification explicite `enableThinking: false`.
- Interface LM Studio : **Reasoning Budget = Unrestricted**.
- Question de contrôle envoyée par l’utilisateur : « Écris uniquement Bonjour. » Réponse observée : « Bonjour. » Métadonnées de cette génération : Thinking désactivé, 43 tokens de prompt, 4 tokens de sortie, arrêt normal `eosFound`, 0,287 s au total.

## Valeurs de base et provenance

Le SDK remplit les champs absents avec les valeurs par défaut de son schéma. Les valeurs suivantes sont donc **celles renvoyées par `getBasePredictionConfig()`**, pas des valeurs d’échantillonnage directement imprimées par le moteur natif pendant la génération.

| Paramètre | Base renvoyée par le SDK LM Studio | LocalAI actuel |
| --- | --- | --- |
| Température | 0,8 | 0,1 |
| Top-k | 40 | 50 |
| Top-p | 0,95 | 1 |
| Min-p | 0,05 | 0 |
| Pénalité de répétition | 1,1 | 1,1 |
| Limite de sortie | `maxTokens: false` | 4 096 tokens |
| Dépassement du contexte | `truncateMiddle` | Retrait des anciens tours avant la génération ; entrée limitée à 4 096 tokens |
| Thinking | `true` dans la base ; **remplacé par `false` dans le chat et le test observés** | `false` en Rapide, `true` en Thinking |
| Budget de réflexion | `false` dans la base, **Unrestricted confirmé dans l’interface** | 1 024 tokens |

Les paramètres bruts du modèle et ceux enregistrés sur le dernier message ne comportent aucune valeur explicite de température, top-k, top-p ou min-p. Ils contiennent notamment le template et les quatre threads ; le message de test ajoute Thinking désactivé et aucun outil. Les journaux capturés donnent le moteur et les temps, mais n’impriment pas les valeurs du sampler.

En conséquence, cet export fournit une base complète pour une comparaison et identifie les valeurs ajoutées par le SDK. Il ne prouve pas à lui seul que le moteur natif a utilisé chacun de ces défauts plutôt qu’une valeur issue des métadonnées du modèle. Cette distinction est enregistrée dans `provenance`.

Le SDK renvoie aussi des tailles de batch de 2 048 et 512 ; elles ne sont pas explicitement présentes dans les métadonnées de chargement enregistrées. LocalAI utilise 256 et 128. Ces paramètres concernent principalement le traitement du contexte et la mémoire ; leur différence ne constitue pas à elle seule une explication des réponses observées.

Le texte complet des messages de l’utilisateur n’est pas exporté. Le rapport conserve les réglages, le template, les métadonnées de génération et la seule question de contrôle autorisée ci-dessus. Les journaux temporaires restent dans `.local/` et leur capture a été arrêtée.
