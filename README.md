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

## Lancer avec Docker (en local)

Prérequis : Docker (Docker Desktop sur Windows ou macOS, Docker Engine sur Linux). Depuis le dossier du projet :

```bash
docker build -t yt-transcript .
cp .env.example .env     # puis renseigne OPENAI_API_KEY si tu veux le repli audio
docker run -d --name yt-transcript --restart unless-stopped \
  -p 3000:3000 --env-file .env yt-transcript
```

L'application est disponible sur http://localhost:3000. Le premier build prend quelques minutes
(Node, ffmpeg, yt-dlp et les polices du PDF). Le `.env` n'est pas copié dans l'image (voir `.dockerignore`) :
il est transmis au démarrage par `--env-file`. Les variables vides comme `YTDLP_PROXY=` sont sans effet.

Commandes utiles :

```bash
docker logs -f yt-transcript                  # logs, y compris les erreurs de yt-dlp
docker exec yt-transcript yt-dlp --version    # version de yt-dlp dans le conteneur
docker stop yt-transcript && docker rm yt-transcript
```

**Mettre yt-dlp à jour** : Docker met chaque étape en cache, un build simple ne retélécharge donc pas
la dernière version. Il faut forcer :

```bash
docker build --no-cache -t yt-transcript .
docker rm -f yt-transcript
# puis relancer la commande docker run ci-dessus
```

Depuis un autre appareil du même réseau : `http://ADRESSE-IP-DE-TON-PC:3000`.
Exécuté depuis une connexion domestique, le conteneur est en général traité par YouTube comme un visiteur normal.

## Déployer

Le même `Dockerfile` fonctionne tel quel sur Railway, Render, Fly.io… (Node + yt-dlp + ffmpeg + polices).
Variables à définir : `OPENAI_API_KEY` (optionnelle), `TRANSCRIPTION_MODEL`, `MAX_AUDIO_MINUTES`.

## Si YouTube bloque le serveur

Erreur affichée : « YouTube bloque temporairement le serveur ». Dans l'ordre :

1. **Mettre yt-dlp à jour** : YouTube change souvent. Sur Docker, relance simplement un build (l'image télécharge la dernière version).
2. **Cookies** (variable `YTDLP_COOKIES_B64`) :
   - Ouvre une fenêtre de navigation privée, connecte-toi à YouTube avec un compte dédié (pas ton compte principal).
   - Dans cette même fenêtre, ouvre `https://www.youtube.com/robots.txt`, puis exporte les cookies de youtube.com
     au format `cookies.txt` avec une extension comme « Get cookies.txt LOCALLY ». Ferme ensuite la fenêtre
     sans rouvrir YouTube dans ce navigateur (pour que la session ne soit pas renouvelée).
   - Encode le fichier : `base64 -w0 cookies.txt` (Linux) ou `base64 -i cookies.txt` (macOS), puis colle le résultat
     dans la variable `YTDLP_COOKIES_B64` du service. En local, `YTDLP_COOKIES_FILE=/chemin/cookies.txt` suffit.
3. **Proxy** (variable `YTDLP_PROXY`, ex. `http://utilisateur:motdepasse@hote:port`) : privilégie un proxy résidentiel ;
   les proxys de datacenter sont souvent bloqués aussi.
4. **Options yt-dlp libres** (`YTDLP_EXTRA_ARGS`) : par exemple `--js-runtimes node` si ta version de yt-dlp
   demande un runtime JavaScript (Node est déjà dans l'image Docker). Voir le wiki de yt-dlp pour les options à jour.

Les cookies expirent : si les blocages reviennent, il faut les ré-exporter.

## Limites à connaître

- **YouTube peut bloquer les IP de serveurs** : voir la section ci-dessus.
- Repli audio limité à ~100 min (limite de 25 Mo de l'API). Au-delà, l'app l'explique à l'utilisateur.
- Le PDF utilise DejaVu Serif (présente dans le Docker) : accents et alphabets courants OK.
  Sans cette police, repli sur Times (accents français OK, alphabets non latins non).
- 8 requêtes par minute et par IP (limiteur en mémoire, à remplacer par Redis si plusieurs instances).
