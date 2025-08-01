// DOM elements
const permissionPopup = document.getElementById('permissionPopup');
const authorizeBtn = document.getElementById('authorizeBtn');
const playerSection = document.getElementById('playerSection');
const status = document.getElementById('status');
const loadingMessage = document.getElementById('loadingMessage');
const audioList = document.getElementById('audioList');

// API configuration
const API_BASE_URL = 'https://duc-speacker-tts.onrender.com';
let audioContext = null;
let isAuthorized = false;
let currentAudio = null;
let audioFiles = [];
let previousAudioFiles = []; // Pour stocker la liste précédente
let refreshInterval = null; // Pour le rafraîchissement automatique
let playedFiles = new Set(); // Pour suivre les fichiers déjà lus automatiquement
let audioQueue = []; // Queue pour les fichiers audio à lire
let isPlaying = false; // État de lecture actuel

// Show permission popup on load
window.addEventListener('load', () => {
    permissionPopup.classList.add('show');
});

// Handler for authorization button
authorizeBtn.addEventListener('click', async () => {
    try {
        // Create audio context to request permission
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Request permission
        await audioContext.resume();
        
        // Test playback to trigger permission with a silent audio
        const testAudio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUarm7blmGgU7k9n1unEiBC13yO/eizEIHWq+8+OWT');
        testAudio.volume = 0;
        
        // Try to play the silent audio to trigger permission
        try {
            await testAudio.play();
            testAudio.pause();
        } catch (playError) {
            console.log('Silent audio play failed, trying alternative method');
        }
        
        isAuthorized = true;
        
        // Hide popup and show player
        permissionPopup.classList.remove('show');
        playerSection.classList.add('show');
        
        // Pas de message de statut pour éviter l'apparition/disparition
        
        // Load audio files from API
        await loadAudioFiles();
        
        // Démarrer le rafraîchissement automatique
        startAutoRefresh();
        
        // Démarrer le résumé périodique
        startPeriodicSummary();
        
    } catch (error) {
        console.error('Authorization error:', error);
        showStatus('Authorization error. Please try again.', 'error');
    }
});

// Fonction pour charger les fichiers audio depuis l'API
async function loadAudioFiles() {
    try {
        // Pas d'affichage du message de chargement
        audioList.innerHTML = '';
        
        const response = await fetch(`${API_BASE_URL}/api/files`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error('Erreur de l\'API');
        }
        
        // Sauvegarder la liste précédente avant de la mettre à jour
        previousAudioFiles = [...audioFiles];
        audioFiles = data.files;
        
        if (!Array.isArray(audioFiles) || audioFiles.length === 0) {
            // Pas de message visible
            audioList.innerHTML = '';
        } else {
            displayAudioFiles(audioFiles);
            
                                // Vérifier s'il y a de nouveaux fichiers et les ajouter à la queue
            if (previousAudioFiles.length > 0) {
                const newFiles = findNewFiles(audioFiles, previousAudioFiles);
                if (newFiles.length > 0) {
                    console.log(`${newFiles.length} nouveau(x) fichier(s) détecté(s)`);
                    // Traiter les fichiers en lot
                    processBatchFiles(newFiles);
                }
            }
        }
        
        // Pas de message de statut pour éviter l'apparition/disparition
        
    } catch (error) {
        console.error('Erreur lors du chargement des fichiers:', error);
        // Message d'erreur discret
        console.error('Erreur lors du chargement des fichiers audio');
    }
}

// Fonction pour trouver tous les nouveaux fichiers
function findNewFiles(currentFiles, previousFiles) {
    // Créer un set des noms de fichiers précédents pour une recherche rapide
    const previousFileNames = new Set(previousFiles.map(file => file.filename));
    
    // Filtrer les nouveaux fichiers
    const newFiles = currentFiles.filter(file => !previousFileNames.has(file.filename));
    
    // Trier par date de création (le plus ancien en premier pour respecter l'ordre d'arrivée)
    return newFiles.sort((a, b) => {
        const dateA = new Date(a.created || 0);
        const dateB = new Date(b.created || 0);
        return dateA - dateB; // Ordre chronologique
    });
}

// Fonction pour vérifier si un fichier a déjà été lu automatiquement
function isFileAlreadyPlayed(filename) {
    return playedFiles.has(filename);
}

// Fonction pour marquer un fichier comme lu
function markFileAsPlayed(filename) {
    playedFiles.add(filename);
}

// Fonction pour ajouter un fichier à la queue
function addToQueue(fileObj) {
    // Nettoyer la queue avant d'ajouter
    cleanQueue();
    
    // Vérifier si le fichier n'est pas déjà dans la queue ou déjà lu
    const isInQueue = audioQueue.some(item => item.filename === fileObj.filename);
    const isAlreadyPlayed = playedFiles.has(fileObj.filename);
    
    if (!isInQueue && !isAlreadyPlayed) {
        audioQueue.push(fileObj);
        console.log(`Ajouté à la queue: ${fileObj.filename}`);
        
        // Reprioriser la queue
        prioritizeQueue();
        
        logQueueStatus();
        
        // Si rien n'est en cours de lecture, démarrer la lecture
        if (!isPlaying) {
            processQueue();
        }
    }
}

// Fonction pour traiter la queue
async function processQueue() {
    if (audioQueue.length === 0 || isPlaying) {
        return;
    }
    
    isPlaying = true;
    const nextFile = audioQueue.shift();
    
    try {
        console.log(`Lecture de la queue: ${nextFile.filename}`);
        logQueueStatus();
        await playAudioFromQueue(nextFile.filename);
    } catch (error) {
        console.error('Erreur lors de la lecture de la queue:', error);
        isPlaying = false;
        // Continuer avec le prochain fichier
        processQueue();
    }
}

// Fonction pour lire un fichier depuis la queue
async function playAudioFromQueue(filename) {
    try {
        // Vérifier l'autorisation avant de jouer
        if (!isAuthorized) {
            console.error('Non autorisé à lire l\'audio');
            return;
        }
        
        // Créer un nouvel élément audio
        const audio = new Audio(`${API_BASE_URL}/api/files/${encodeURIComponent(filename)}`);
        
        // Timeout pour éviter qu'un fichier reste bloqué
        const timeout = setTimeout(() => {
            console.warn(`Timeout pour le fichier: ${filename}`);
            isPlaying = false;
            processQueue();
        }, 30000); // 30 secondes de timeout
        
        // Ajouter les événements audio
        audio.addEventListener('ended', () => {
            clearTimeout(timeout);
            console.log(`Fin de lecture: ${filename}`);
            isPlaying = false;
            logQueueStatus();
            // Passer au fichier suivant dans la queue
            processQueue();
        });
        
        audio.addEventListener('error', (e) => {
            clearTimeout(timeout);
            console.error('Erreur audio:', e);
            isPlaying = false;
            logQueueStatus();
            // Passer au fichier suivant dans la queue
            processQueue();
        });
        
        // Démarrer la lecture
        await audio.play();
        console.log(`KeoSpeech parle: ${filename}`);
        logSystemStats();
        
    } catch (error) {
        console.error('Erreur lors de la lecture:', error);
        isPlaying = false;
        // Passer au fichier suivant dans la queue
        processQueue();
    }
}

// Fonction pour afficher l'état de la queue
function logQueueStatus() {
    console.log(`État de la queue: ${audioQueue.length} fichier(s) en attente, Lecture en cours: ${isPlaying}`);
    if (audioQueue.length > 0) {
        console.log('Fichiers en queue:', audioQueue.map(f => f.filename));
    }
}

// Fonction pour afficher les statistiques du système
function logSystemStats() {
    const stats = getSystemStatus();
    console.log('=== Statistiques KeoSpeech ===');
    console.log(`Fichiers en queue: ${stats.queueLength}`);
    console.log(`Lecture en cours: ${stats.isPlaying}`);
    console.log(`Fichiers lus: ${stats.playedFilesCount}`);
    console.log(`Autorisé: ${stats.authorized}`);
    console.log('=============================');
}

// Fonction pour traiter plusieurs fichiers en lot
function processBatchFiles(newFiles) {
    console.log(`Traitement de ${newFiles.length} fichier(s) en lot`);
    
    // Ajouter tous les fichiers à la queue avec un délai progressif
    newFiles.forEach((fileObj, index) => {
        setTimeout(() => {
            addToQueue(fileObj);
        }, index * 50); // 50ms entre chaque ajout
    });
}

// Fonction pour gérer les priorités dans la queue
function prioritizeQueue() {
    // Trier la queue par date de création (le plus ancien en premier)
    audioQueue.sort((a, b) => {
        const dateA = new Date(a.created || 0);
        const dateB = new Date(b.created || 0);
        return dateA - dateB;
    });
    console.log('Queue repriorisée par ordre chronologique');
}

// Fonction pour nettoyer la queue des fichiers invalides
function cleanQueue() {
    const originalLength = audioQueue.length;
    audioQueue = audioQueue.filter(fileObj => {
        // Vérifier si le fichier a un nom valide
        return fileObj && fileObj.filename && fileObj.filename.trim() !== '';
    });
    
    if (originalLength !== audioQueue.length) {
        console.log(`Queue nettoyée: ${originalLength - audioQueue.length} fichier(s) invalide(s) supprimé(s)`);
    }
}

// Fonction pour gérer les erreurs de réseau avec retry
async function retryAudioPlayback(filename, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const audio = new Audio(`${API_BASE_URL}/api/files/${encodeURIComponent(filename)}`);
            
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout'));
                }, 10000); // 10 secondes de timeout
                
                audio.addEventListener('canplaythrough', () => {
                    clearTimeout(timeout);
                    resolve(audio);
                });
                
                audio.addEventListener('error', (e) => {
                    clearTimeout(timeout);
                    reject(e);
                });
                
                audio.load();
            });
        } catch (error) {
            console.warn(`Tentative ${attempt}/${maxRetries} échouée pour ${filename}:`, error);
            if (attempt === maxRetries) {
                throw error;
            }
            // Attendre avant de réessayer
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
}

// Fonction pour afficher un résumé périodique du système
function startPeriodicSummary() {
    setInterval(() => {
        if (audioQueue.length > 0 || isPlaying) {
            logSystemStats();
        }
    }, 60000); // Résumé toutes les minutes si activité
}

// Fonction pour réinitialiser la liste des fichiers lus
function resetPlayedFiles() {
    playedFiles.clear();
}

// Fonction pour réinitialiser complètement le système de queue
function resetQueue() {
    audioQueue = [];
    isPlaying = false;
    playedFiles.clear();
    console.log('Système de queue réinitialisé');
}

// Fonction pour obtenir des informations sur l'état du système
function getSystemStatus() {
    return {
        queueLength: audioQueue.length,
        isPlaying: isPlaying,
        playedFilesCount: playedFiles.size,
        authorized: isAuthorized
    };
}

// Fonction pour lire automatiquement le nouveau fichier
async function autoPlayNewFile(fileObj) {
    try {
        // Ajouter le fichier à la queue au lieu de le lire directement
        addToQueue(fileObj);
        
    } catch (error) {
        console.error('Erreur lors de l\'ajout à la queue:', error);
    }
}

// Fonction pour démarrer le rafraîchissement automatique
function startAutoRefresh() {
    // Arrêter l'intervalle existant s'il y en a un
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    
    // Rafraîchir toutes les 10 secondes
    refreshInterval = setInterval(async () => {
        try {
            await loadAudioFiles();
        } catch (error) {
            console.error('Erreur lors du rafraîchissement automatique:', error);
        }
    }, 10000); // 10 secondes
    
    console.log('Rafraîchissement automatique démarré (toutes les 10 secondes)');
}

// Fonction pour rafraîchir manuellement la liste
async function manualRefresh() {
    try {
        resetQueue(); // Réinitialiser complètement le système
        showStatus('Rafraîchissement en cours...', 'info');
        await loadAudioFiles();
        showStatus('Liste mise à jour manuellement', 'success');
    } catch (error) {
        console.error('Erreur lors du rafraîchissement manuel:', error);
        showStatus('Erreur lors du rafraîchissement', 'error');
    }
}

// Fonction pour arrêter le rafraîchissement automatique
function stopAutoRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
        console.log('Rafraîchissement automatique arrêté');
    }
}

// Nettoyer l'intervalle lors de la fermeture de la page
window.addEventListener('beforeunload', () => {
    stopAutoRefresh();
    // Vider la queue
    audioQueue = [];
    isPlaying = false;
});

// Fonction pour afficher la liste des fichiers audio (simplifiée pour KeoSpeech)
function displayAudioFiles(files) {
    // Masquer la liste des fichiers car elle n'est plus nécessaire
    audioList.style.display = 'none';
    
    // Stocker les fichiers pour la lecture automatique
    audioFiles = files;
    
            // Pas de message de statut pour éviter l'apparition/disparition
}

// Fonction pour formater la taille des fichiers
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Fonction pour jouer un fichier audio directement (sans interface)
async function playAudioDirectly(filename) {
    try {
        // Vérifier l'autorisation avant de jouer
        if (!isAuthorized) {
            showStatus('Veuillez d\'abord autoriser la lecture audio.', 'error');
            return;
        }
        
        // Arrêter la lecture en cours si il y en a une
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
        
        // Créer un nouvel élément audio
        currentAudio = new Audio(`${API_BASE_URL}/api/files/${encodeURIComponent(filename)}`);
        
        // Ajouter les événements audio
        currentAudio.addEventListener('ended', () => {
            currentAudio = null;
            // Message discret pour la fin de lecture
            console.log('KeoSpeech a fini de parler');
        });
        
        currentAudio.addEventListener('error', (e) => {
            console.error('Erreur audio:', e);
            showStatus('Erreur lors de la lecture du fichier audio', 'error');
            currentAudio = null;
        });
        
        // Démarrer la lecture
        await currentAudio.play();
        
        showStatus(`Lecture de ${filename}`, 'success');
        
    } catch (error) {
        console.error('Erreur lors de la lecture:', error);
        if (error.name === 'NotAllowedError') {
            showStatus('Autorisation audio requise. Veuillez autoriser la lecture.', 'error');
            // Réafficher la popup d'autorisation
            permissionPopup.classList.add('show');
            playerSection.classList.remove('show');
        } else {
            showStatus('Erreur lors de la lecture du fichier audio', 'error');
        }
    }
}

// Fonction pour jouer un fichier audio (version simplifiée pour l'interface)
async function playAudio(filename, audioItem, playBtn) {
    try {
        // Vérifier l'autorisation avant de jouer
        if (!isAuthorized) {
            showStatus('Veuillez d\'abord autoriser la lecture audio.', 'error');
            return;
        }
        
        // Arrêter la lecture en cours si il y en a une
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
            // Réinitialiser tous les boutons
            document.querySelectorAll('.play-btn').forEach(btn => {
                btn.textContent = 'Play';
                btn.classList.remove('playing');
            });
            document.querySelectorAll('.audio-item').forEach(item => {
                item.classList.remove('playing');
            });
        }
        
        // Créer un nouvel élément audio
        currentAudio = new Audio(`${API_BASE_URL}/api/files/${encodeURIComponent(filename)}`);
        
        // Ajouter les événements audio
        currentAudio.addEventListener('ended', () => {
            if (playBtn) {
                playBtn.textContent = 'Play';
                playBtn.classList.remove('playing');
            }
            if (audioItem) {
                audioItem.classList.remove('playing');
            }
            currentAudio = null;
            // Message discret pour la fin de lecture
            console.log('KeoSpeech a fini de parler');
        });
        
        currentAudio.addEventListener('error', (e) => {
            console.error('Erreur audio:', e);
            showStatus('Erreur lors de la lecture du fichier audio', 'error');
            if (playBtn) {
                playBtn.textContent = 'Play';
                playBtn.classList.remove('playing');
            }
            if (audioItem) {
                audioItem.classList.remove('playing');
            }
            currentAudio = null;
        });
        
        // Démarrer la lecture
        await currentAudio.play();
        
        // Mettre à jour l'interface si disponible
        if (playBtn) {
            playBtn.textContent = 'Pause';
            playBtn.classList.add('playing');
        }
        if (audioItem) {
            audioItem.classList.add('playing');
        }
        
        // Message discret pour la lecture
        console.log('KeoSpeech parle');
        
    } catch (error) {
        console.error('Erreur lors de la lecture:', error);
        if (error.name === 'NotAllowedError') {
            showStatus('Autorisation audio requise. Veuillez autoriser la lecture.', 'error');
            // Réafficher la popup d'autorisation
            permissionPopup.classList.add('show');
            playerSection.classList.remove('show');
        } else {
            showStatus('Erreur lors de la lecture du fichier audio', 'error');
        }
    }
}

// Fonction pour afficher le statut
function showStatus(message, type) {
    status.textContent = message;
    status.className = `status ${type}`;
    
    // Masquer le statut après 3 secondes seulement pour certains types
    if (type === 'error' || type === 'info') {
        setTimeout(() => {
            status.textContent = '';
            status.className = 'status';
        }, 3000);
    }
    // Les messages de succès restent affichés plus longtemps ou jusqu'au prochain message
} 