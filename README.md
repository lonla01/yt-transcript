# Transcription YouTube en PDF

Application web : on colle l'URL d'une vidéo YouTube, on obtient la transcription, on la télécharge en PDF.

## Comment ça marche

1. L'URL est validée (youtube.com, youtu.be, shorts, embed, live).
2. **Sous-titres d'abord** : `yt-dlp` lit les métadonnées, l'app choisit la meilleure piste
   (manuelle > automatique, langue parlée de la vidéo en priorité) et la met en paragraphes.
3. **Repli audio** : sans sous-titres, l'audio est extrait (mono, 32 kb/s) puis envoyé à l'API
   de transcription d'OpenAI (`whisper-1` par défaut).
4. Le PDF est généré côté serveur (PDFKit) : titre, chaîne, lien, source de la transcription, pagination.

## Lancer en local

Prérequis : Node 20+, [yt-dlp](https://github.com/yt-dlp/yt-dlp) et `ffmpeg` dans le PATH.

```bash
npm install
cp .env.example .env        # puis renseigne OPENAI_API_KEY pour le repli audio
export $(grep -v '^#' .env | xargs)
npm start                   # http://localhost:3000
npm test                    # tests unitaires (URL, sous-titres, PDF)
```

Sans `OPENAI_API_KEY`, les vidéos **avec** sous-titres fonctionnent ; les autres renvoient un message clair.

## Déployer

Un `Dockerfile` est fourni (Node + yt-dlp + ffmpeg + polices). Il fonctionne tel quel sur Railway, Render, Fly.io…
Variables à définir : `OPENAI_API_KEY` (optionnelle), `TRANSCRIPTION_MODEL`, `MAX_AUDIO_MINUTES`.

## Limites à connaître

- **YouTube peut bloquer les IP de serveurs** (erreur « YouTube bloque temporairement le serveur »).
  Si ça arrive en production, il faudra passer par un proxy ou des cookies yt-dlp.
- Repli audio limité à ~100 min (limite de 25 Mo de l'API). Au-delà, l'app l'explique à l'utilisateur.
- Le PDF utilise DejaVu Serif (présente dans le Docker) : accents et alphabets courants OK.
  Sans cette police, repli sur Times (accents français OK, alphabets non latins non).
- 8 requêtes par minute et par IP (limiteur en mémoire, à remplacer par Redis si plusieurs instances).
