import { useEffect, useState } from 'react'
export type InterfaceLanguage = 'fr' | 'en'
export function browserLanguage() {
  try { return chrome.i18n.getUILanguage() } catch { return navigator.language || 'en' }
}
export function resolveLanguage(preference: string, browser = browserLanguage()): 'fr' | 'en' {
  return preference === 'fr' || preference === 'en' ? preference : browser.toLowerCase().startsWith('fr') ? 'fr' : 'en'
}
function readPreference(): InterfaceLanguage {
  const stored = localStorage.getItem('localaiLanguage')
  return resolveLanguage(stored ?? '')
}
const en: Record<string, string> = {
  'Recherche web':'Web search','Fournisseur de recherche':'Search provider','LocalAI uniquement':'LocalAI only',
  'Détails de la recherche web':'Web search details','Requête web':'Search query','Sources retenues':'Sources retained',
  'Lecture de liens':'Reading links',
  'Aucune source exploitable':'No usable sources','Échec de la recherche web':'Web search failed',
  'Lecture des sources…':'Reading sources…','Vérification des résultats…':'Checking results…','Lecture des pages liées…':'Reading linked pages…',
  'API JSON personnalisée':'Custom JSON API','Adresse du service':'Service URL','Clé API':'API key','Clé API facultative':'Optional API key',
  'La clé est enregistrée dans ce profil de navigateur.':'The key is saved in this browser profile.',
  'LocalAI interroge les moteurs de recherche et lit les pages directement depuis le navigateur.':'LocalAI queries search engines and reads pages directly from the browser.',
  'Si la lecture directe échoue, Jina Reader reçoit jusqu’à deux URL publiques par recherche pour tenter de lire les pages.':'If direct reading fails, Jina Reader receives up to two public URLs per search to try to read the pages.',
  'La requête de recherche est envoyée à Tavily. Sans clé, le mode d’essai est utilisé.':'The search query is sent to Tavily. Leave the key empty to use trial access.',
  'La requête de recherche est envoyée à Brave. Une clé API est requise.':'The search query is sent to Brave. An API key is required.',
  'La requête de recherche est envoyée à Exa. Une clé API est requise.':'The search query is sent to Exa. An API key is required.',
  'La requête est envoyée à votre instance SearXNG, qui doit autoriser le format JSON.':'The query is sent to your SearXNG instance, which must enable JSON output.',
  'L’API reçoit une requête GET avec le paramètre q et doit renvoyer un objet JSON results contenant des résultats url, title et snippet.':'The API receives a GET request with a q parameter and must return a JSON object with a results array containing url, title and snippet fields.',
  'Format de résultats non reconnu.':'Unrecognized results format.',
  'Renseignez une URL HTTPS valide ou une adresse HTTP sur localhost.':'Enter a valid HTTPS URL or an HTTP address on localhost.',
  'Ajoutez la clé API de ce fournisseur dans les paramètres.':'Add this provider’s API key in Settings.',
  'Le fournisseur de recherche ne répond pas.':'The search provider did not respond.',
  'Les réglages reviendront aux valeurs initiales et les clés API seront effacées. Les modèles téléchargés et les conversations seront conservés.':'Settings will return to their defaults and API keys will be cleared. Downloaded models and conversations will be kept.',
  'Retour à la conversation':'Back to conversation','Modifications appliquées automatiquement.':'Changes apply automatically.',
  'Dictée vocale':'Voice dictation','Modèle de dictée':'Dictation model',
  'Très léger · multilingue':'Very light · multilingual','Équilibré · multilingue':'Balanced · multilingual','Plus précis · multilingue':'More accurate · multilingual',
  'La langue est détectée à partir de votre voix. Le texte reste dans la langue parlée.':'The language is detected from your voice. Text stays in the spoken language.',
  'Données sur cet appareil':'Data on this device','Réinitialiser tous les paramètres':'Reset all settings','Réinitialiser tous les paramètres ?':'Reset all settings?',
  'Supprimer tous les modèles':'Delete all models','Supprimer tous les modèles ?':'Delete all models?',
  'Supprimer toutes les conversations':'Delete all conversations','Supprimer toutes les conversations ?':'Delete all conversations?',
  'Supprimer ce modèle':'Delete this model','Supprimer ce modèle ?':'Delete this model?',
  'Supprimer ce modèle de dictée':'Delete this dictation model','Supprimer ce modèle de dictée ?':'Delete this dictation model?',
  'Les réglages de tous les modèles, la langue, le thème et le mode de réponse reviendront aux valeurs initiales. Les modèles téléchargés et les conversations seront conservés.':'Settings for all models, language, theme and response mode will return to their defaults. Downloaded models and conversations will be kept.',
  'Les modèles téléchargés ou importés seront retirés de cet appareil et libérés de la mémoire. Il faudra les télécharger ou les importer à nouveau.':'Downloaded or imported models will be removed from this device and released from memory. You will need to download or import them again.',
  'Toutes les conversations de cet appareil seront supprimées définitivement. Cette action est irréversible.':'All conversations on this device will be permanently deleted. This cannot be undone.',
  'Les fichiers de ce modèle seront supprimés de cet appareil. Un modèle importé sera aussi retiré de la liste.':'This model’s files will be deleted from this device. An imported model will also be removed from the list.',
  'Les fichiers de ce modèle de dictée seront supprimés. Vous pourrez le télécharger à nouveau.':'This dictation model’s files will be deleted. You can download it again.',
  'Revenir':'Go back','Réinitialiser':'Reset','Annuler le traitement audio':'Cancel audio processing','Forme d’onde du microphone':'Microphone waveform',
  'Le moteur de dictée a rencontré une erreur. Réessayez.':'The dictation engine encountered an error. Try again.',
  'Le cache de tous les modèles de LocalAI sera supprimé et les moteurs arrêtés. Il faudra télécharger ou importer les modèles à nouveau.':'All LocalAI model cache files will be deleted and the engines stopped. Models will need to be downloaded or imported again.',
  'Paramètres':'Settings','Langue de l’interface':'Interface language','Automatique (Chrome)':'Automatic (Chrome)',
  'Modèle de conversation':'Chat model','Importer mon fichier GGUF':'Import my GGUF file','Importer un GGUF':'Import a GGUF',
  'Fichier local uniquement. Le moteur doit prendre en charge son architecture.':'Local file only. Its architecture must be supported by the engine.',
  'Réglages du modèle':'Model settings','Génération':'Generation','Contexte':'Context','Réflexion':'Thinking','Avancé':'Advanced',
  'Instruction système':'System prompt','Vide par défaut':'Empty by default','Température':'Temperature',
  'Top-k':'Top-k','Top-p':'Top-p','Min-p':'Min-p','Pénalité de répétition':'Repeat penalty',
  'Fenêtre de répétition':'Repeat window','Pénalité de présence':'Presence penalty','Pénalité de fréquence':'Frequency penalty',
  'Graine aléatoire':'Random seed','−1 : aléatoire':'−1: random','Tokens de contexte':'Context tokens','Tokens de sortie maximum':'Maximum output tokens',
  'Un contexte plus grand utilise davantage de mémoire.':'A larger context uses more memory.',
  'Budget de réflexion':'Thinking budget','Sans limite spécifique':'No specific limit','Tokens de réflexion maximum':'Maximum thinking tokens',
  'Le budget de sortie inclut la réflexion et la réponse finale.':'The output budget includes thinking and the final answer.',
  'Threads CPU':'CPU threads','Taille de batch':'Batch size','Microbatch':'Microbatch','Flash Attention':'Flash Attention',
  'Séquences d’arrêt':'Stop sequences','Une séquence par ligne':'One sequence per line',
  'Rétablir les valeurs recommandées':'Restore recommended defaults','Enregistrer':'Save','Annuler':'Cancel',
  'Les modifications s’appliquent à la prochaine réponse.':'Changes apply to the next response.',
  'Conversations':'Conversations','Vos conversations':'Your conversations','Nouvelle conversation':'New conversation',
  'Rechercher':'Search','Rechercher une conversation':'Search conversations','Aucune conversation trouvée.':'No conversations found.',
  'Vos conversations apparaîtront ici.':'Your conversations will appear here.','Épinglées':'Pinned',
  'Aujourd’hui':'Today','Hier':'Yesterday','Plus anciennes':'Older','Renommer':'Rename','Exporter':'Export',
  'Épingler':'Pin','Désépingler':'Unpin','Supprimer':'Delete','Supprimer la conversation ?':'Delete this conversation?',
  'Cette conversation sera supprimée de cet appareil.':'This conversation will be removed from this device.',
  'Options de conversation':'Conversation options','Titre de la conversation':'Conversation title',
  'Conservées sur cet appareil':'Stored on this device','Fermer':'Close','Fermer les conversations':'Close conversations',
  'Statistiques de la réponse':'Response statistics','Tokens par seconde':'Tokens per second','Tokens générés':'Generated tokens',
  'Tokens d’entrée':'Input tokens','Temps de réponse':'Response time','Premier token':'First token','Raison d’arrêt':'Stop reason',
  'Fin de réponse (EOS)':'End of response (EOS)','Limite de tokens':'Token limit','Arrêt demandé':'Stopped by user','Appel d’outil':'Tool call','Non disponible':'Unavailable',
  'Prêt quand vous voulez.':'Ready when you are.','Une question, une idée, un document.':'A question, an idea, a document.',
  'Votre message':'Your message','Demander à LocalAI':'Ask LocalAI','Afficher les outils':'Show tools','Ajouter ou utiliser un outil':'Add or use a tool',
  'Mode de réponse':'Response mode','Rapide':'Quick','Thinking':'Thinking','Réponse directe':'Direct response',
  'Réflexion native de LFM3 pour les demandes texte':'Native thinking for text requests','Réflexion en cours…':'Thinking…',
  'Préparation de la réponse…':'Preparing a response…','Recherche en cours…':'Searching…',
  'Copier la réponse':'Copy response','Réponse copiée':'Response copied','Copier le message':'Copy message','Message copié':'Message copied','Copié':'Copied',
  'Modifier la question':'Edit question','Écouter la réponse':'Read response aloud','Arrêter la lecture':'Stop reading',
  'Dicter à la voix':'Dictate','Arrêter la dictée':'Stop dictation','Arrêter la dictée vocale':'Stop dictation',
  'Télécharger Whisper pour la dictée':'Download Whisper for dictation','Télécharger Whisper':'Download Whisper','Charger Whisper':'Load Whisper',
  'Préparation de Whisper…':'Preparing Whisper…','Whisper pour la dictée vocale':'Whisper for dictation',
  'Whisper est disponible sur cet appareil.':'Whisper is available on this device.','Vérification…':'Checking…',
  'Dictée en cours…':'Listening…','Transcription vocale multilingue…':'Transcribing…','Microphone actif':'Microphone active',
  'Niveau sonore du microphone':'Microphone sound level','Annuler le démarrage du microphone':'Cancel microphone start',
  'Fermer les informations de Whisper':'Close Whisper information','Envoyer':'Send','Envoyer le message':'Send message','Arrêter la réponse':'Stop response',
  'Résumer cette page':'Summarize this page','Analyser l’écran':'Analyze screen','Analyser l\'écran':'Analyze screen',
  'Résumer une vidéo ou un audio':'Summarize video or audio','Ajouter un fichier':'Add a file','Ajouter un fichier ou une image':'Add a file or image',
  'Résumer la page ouverte':'Summarize the open page','Écouter ou résumer l\'audio':'Listen to or summarize audio',
  'Outils de conversation':'Conversation tools','Passer en mode clair':'Switch to light mode','Passer en mode sombre':'Switch to dark mode',
  'Votre IA, sur cet appareil':'Your AI, on this device','Activer les images':'Enable images','Vérification des modèles…':'Checking models…',
  'Téléchargez le modèle pour commencer.':'Download the model to get started.','Un téléchargement pour analyser vos images.':'A download to analyze your images.',
  'Préparation du modèle':'Preparing the model','Plus tard':'Later','Importer mon fichier Q8_0.gguf':'Import my Q8_0.gguf file',
  'Choisir le fichier LFM3 Q8 GGUF':'Choose the LFM3 Q8 GGUF file','Discussion':'Conversation','Sources':'Sources',
  'Aucune parole intelligible n\'a été détectée dans l\'enregistrement.':'No intelligible speech was detected in the recording.',
  'Erreur lors de la dictée vocale.':'Dictation failed.','Impossible de copier le message. Réessayez.':'Unable to copy the message. Try again.',
  'Fichier GGUF incompatible ou invalide.':'Incompatible or invalid GGUF file.',
  'Activer le modèle':'Enable model','Chargement de':'Loading','Charger':'Load','Télécharger':'Download',
  'est disponible sur cet appareil.':'is available on this device.',
  'Activez l’accélération graphique de Chrome pour utiliser LocalAI.':'Enable Chrome hardware acceleration to use LocalAI.',
  'Télécharger le modèle d’images':'Download the image model',
  'Écoute en cours… parlez puis cliquez sur le micro':'Listening… speak, then click the microphone',
  "Préparation de l'assistant…":'Preparing the assistant…',
  "Accès au microphone refusé. Autorisez le microphone dans la fenêtre qui s'est ouverte.":'Microphone access denied. Allow it in the window that opened.',
  "Capture de l'écran en cours…":'Capturing the screen…',"Capture automatique de l'écran…":'Capturing the screen…',
  "Impossible de capturer l'écran de cet onglet.":'Unable to capture this tab.',"Impossible de capturer l'écran.":'Unable to capture the screen.',
  "Recherche des sous-titres ou de l'audio de la vidéo…":'Looking for captions or video audio…',
  "Impossible de récupérer l'audio de cet onglet.":'Unable to access this tab’s audio.',
  "Transcription de l'audio écouté…":'Transcribing the audio…',"Erreur lors de l'arrêt de l'écoute audio.":'Unable to finish the audio capture.',
  '📊 Expliquer ce graphique':'📊 Explain this chart',"🌍 Traduire l'écran":'🌍 Translate screen',
  '🌍 Traduire en français':'🌍 Translate into French',"🛠️ Analyser l'interface":'🛠️ Analyze interface',
  "🛠️ Débugger l'interface":'🛠️ Review interface','📑 Résumer le document':'📑 Summarize document',
  '🔍 Analyser en profondeur':'🔍 Analyze in depth','Terminer et résumer':'Finish and summarize',"Écoute de l’onglet":'Tab audio',
  'Chargement de Whisper':'Loading Whisper','Chargement de Whisper…':'Loading Whisper…','Téléchargement de Whisper':'Downloading Whisper',
  'Transcription vocale locale en cours…':'Transcribing locally…','Lecture automatique de la page ouverte…':'Reading the open page…',
  'Fin de réponse':'End of response',
  'Activation du microphone LocalAI':'Enable the LocalAI microphone',
  'Cliquez sur « Autoriser » dans la notification de Chrome. Cette fenêtre se fermera automatiquement.':'Click “Allow” in the Chrome notification. This window will close automatically.',
  'Microphone autorisé ! Retour automatique à LocalAI…':'Microphone enabled! Returning to LocalAI…',
  'Le microphone n’est pas encore autorisé. Réessayez puis cliquez sur « Autoriser ».':'The microphone is not enabled yet. Try again, then click “Allow”.',
  "Réessayer l'autorisation":'Try permission again',
  'L’accélération graphique (WebGPU) est désactivée. Activez-la dans les paramètres de Chrome.':'Hardware acceleration (WebGPU) is disabled. Enable it in Chrome settings.',
  'Choisir un fichier GGUF':'Choose a GGUF file',
}
export function interfaceLocale() { return resolveLanguage(readPreference()) }
export function tr(text: string): string { return interfaceLocale() === 'en' ? en[text] ?? text : text }
export function useInterfaceLanguage() {
  const [preference, setPreference] = useState<InterfaceLanguage>(readPreference)
  const locale = resolveLanguage(preference)
  const setLanguage = (value: InterfaceLanguage) => {
    localStorage.setItem('localaiLanguage', value)
    setPreference(value)
    window.dispatchEvent(new Event('localai-language'))
  }
  const resetLanguage = () => {
    localStorage.removeItem('localaiLanguage')
    setPreference(resolveLanguage(''))
    window.dispatchEvent(new Event('localai-language'))
  }
  useEffect(() => {
    const update = () => setPreference(readPreference())
    window.addEventListener('localai-language', update)
    window.addEventListener('storage', update)
    return () => { window.removeEventListener('localai-language', update); window.removeEventListener('storage', update) }
  }, [])
  useEffect(() => { document.documentElement.lang = locale }, [locale])
  return { preference, locale, setLanguage, resetLanguage }
}
