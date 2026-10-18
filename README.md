# Spotifree

Ta musique, sur ton PC, avec une interface à la Spotify. Deux applications Windows : le **lecteur** (écouter) et le **serveur** (comptes, appareils, musique).

- **PC** : un serveur (Node.js) qui lit les fichiers musicaux de ton PC, et une interface web inspirée de Spotify
  (`server/`, `web/`, `shared/`). `npm run package` fabrique le dossier à installer sous Windows.
- **Android** : une application native légère (`android/`) qui affiche cette interface, joue la musique en
  arrière-plan et affiche les commandes sur l'écran verrouillé. Elle se connecte à ton PC par Tailscale.

## Installer l'APK sur le téléphone

Sur le téléphone, ouvre ce lien dans Chrome puis installe le fichier téléchargé (Android demandera d'autoriser
l'installation depuis Chrome la première fois) :

https://github.com/TLB56550/Spotifree/releases/latest/download/Spotifree.apk

L'APK est construit automatiquement par GitHub Actions à chaque modification du dossier `android/`
(onglet **Actions**, ou **Run workflow** pour le relancer à la main).

## Remarque sur la signature

`android/app/spotifree.keystore` est la clé qui signe l'APK. Elle sert uniquement à ce que les mises à jour
s'installent par-dessus la version précédente. Elle est volontairement dans le dépôt : ne l'utilise pas pour
une autre application.
