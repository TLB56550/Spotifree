// Assemble le dossier « Ma Bibliotheque » prêt à l'emploi sous Windows, puis le compresse.
//
//   node scripts/package.mjs            (compile puis assemble)
//   node scripts/package.mjs --skip-build
//
// Le dossier final contient tout : l'application, l'interface et Node.js (node.exe),
// de sorte qu'il n'y a RIEN à installer sur le PC.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'release');
const cacheDir = path.join(root, '.cache');
const name = 'Ma Bibliotheque';
const stage = path.join(releaseDir, name);
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

// Node.js pour Windows, publié sur npm sous « node-win-x64 » (binaire officiel signé OpenJS Foundation).
const NODE_VERSION = '24.22.0';
const NODE_EXE_SHA256 = 'ba93f9a70bd86fce3ebbb39ec758501458453467aa92a34a0a3602d1e3fc2b9c';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const crlf = (text) => text.replace(/\r?\n/g, '\r\n');
const step = (msg) => console.log(`\n▸ ${msg}`);

// 1. Compilation -----------------------------------------------------------------------
if (!process.argv.includes('--skip-build')) {
  step('Compilation de l’interface et du serveur');
  run('npm', ['run', 'build']);
}
const serverBundle = path.join(root, 'server', 'dist', 'server.mjs');
const webDist = path.join(root, 'web', 'dist');
for (const p of [serverBundle, path.join(webDist, 'index.html')]) {
  if (!fs.existsSync(p)) throw new Error(`Fichier manquant : ${p} (lance d’abord « npm run build »)`);
}

// 2. node.exe --------------------------------------------------------------------------
step(`Récupération de Node.js ${NODE_VERSION} pour Windows`);
fs.mkdirSync(cacheDir, { recursive: true });
const nodeExe = path.join(cacheDir, `node-${NODE_VERSION}-win-x64.exe`);
if (!fs.existsSync(nodeExe)) {
  const tmp = fs.mkdtempSync(path.join(cacheDir, 'dl-'));
  run('npm', ['pack', `node-win-x64@${NODE_VERSION}`, '--silent', '--pack-destination', tmp]);
  const tgz = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'));
  if (!tgz) throw new Error('npm pack n’a produit aucune archive');
  run('tar', ['-xzf', path.join(tmp, tgz), '-C', tmp, 'package/bin/node.exe']);
  fs.copyFileSync(path.join(tmp, 'package', 'bin', 'node.exe'), nodeExe);
  fs.rmSync(tmp, { recursive: true, force: true });
}
const got = sha256(nodeExe);
if (got !== NODE_EXE_SHA256) {
  fs.rmSync(nodeExe, { force: true });
  throw new Error(`Empreinte de node.exe inattendue (${got}). Fichier supprimé, rien n’a été assemblé.`);
}
console.log(`  node.exe vérifié (sha256 ${got.slice(0, 16)}…)`);

// 3. Assemblage ------------------------------------------------------------------------
step('Assemblage du dossier');
fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'app'), { recursive: true });
fs.mkdirSync(path.join(stage, 'runtime'), { recursive: true });
fs.copyFileSync(serverBundle, path.join(stage, 'app', 'server.mjs'));
fs.cpSync(webDist, path.join(stage, 'app', 'public'), { recursive: true });
fs.copyFileSync(nodeExe, path.join(stage, 'runtime', 'node.exe'));

const launcher = `@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Ma Bibliotheque
set OPEN_BROWSER=1

echo.
echo   Ma Bibliotheque demarre...
echo   Garde cette fenetre ouverte pendant que tu ecoutes ta musique.
echo   Pour quitter : bouton "Arreter" dans Parametres, ou ferme cette fenetre.
echo.

:demarrage
"runtime\\node.exe" --no-warnings "app\\server.mjs"
set CODE=%ERRORLEVEL%

rem Code 75 = une mise a jour vient d'etre installee : on relance (la fenetre deja ouverte se recharge seule).
if "%CODE%"=="75" (
  echo.
  echo   Mise a jour installee. Redemarrage...
  set OPEN_BROWSER=0
  goto demarrage
)

if not "%CODE%"=="0" (
  echo.
  echo   Une erreur est survenue. Le message ci-dessus explique pourquoi.
  echo   Appuie sur une touche pour fermer.
  pause >nul
)
`;
fs.writeFileSync(path.join(stage, 'Lancer Ma Bibliotheque.bat'), crlf(launcher));

// Lanceurs sans fenêtre noire (VBScript, ASCII uniquement : les chemins sont calculés à l'exécution).
const vbsHead = `Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
node = """" & root & "\\runtime\\node.exe"" --no-warnings """ & root & "\\app\\server.mjs"" "
`;
const playerVbs = `' Ouvre le lecteur Ma Bibliotheque. Le serveur est demarre en arriere-plan s'il ne tourne pas deja.
' Fermer la fenetre du lecteur n'arrete pas le serveur.
${vbsHead}sh.Run node & "player", 0, False
`;
const chooseVbs = `' Choisit le serveur que ce lecteur utilise (ce PC par defaut, ou un NAS plus tard).
${vbsHead}addr = InputBox("Adresse du serveur Ma Bibliotheque utilise par ce lecteur." & vbCrLf & vbCrLf & "Ce PC : http://127.0.0.1:4242" & vbCrLf & "Un NAS ou un autre PC : par exemple http://192.168.1.20:4242", "Ma Bibliotheque - serveur", "http://127.0.0.1:4242")
If addr <> "" Then
  rc = sh.Run(node & "player --set-server """ & addr & """", 0, True)
  If rc = 0 Then
    MsgBox "C'est enregistre. Rouvre Ma Bibliotheque pour utiliser ce serveur.", 64, "Ma Bibliotheque"
  Else
    MsgBox "Adresse invalide : elle doit commencer par http:// ou https://", 48, "Ma Bibliotheque"
  End If
End If
`;
fs.mkdirSync(path.join(stage, 'app', 'launchers'), { recursive: true });
for (const [file, text] of [['Ma Bibliotheque.vbs', playerVbs], ['Choisir le serveur.vbs', chooseVbs]]) {
  fs.writeFileSync(path.join(stage, file), crlf(text));
  fs.writeFileSync(path.join(stage, 'app', 'launchers', file), crlf(text));
}

const installer = `@echo off
setlocal
chcp 65001 >nul
title Installation de Ma Bibliotheque
set "SRC=%~dp0"
set "DEST=%LOCALAPPDATA%\\Programs\\Ma Bibliotheque"

echo.
echo   Installation de Ma Bibliotheque
echo   Emplacement : %DEST%
echo.

if not exist "%SRC%runtime\\node.exe" goto incomplet
if not exist "%SRC%app\\server.mjs" goto incomplet

rem 1. Fermer une version deja lancee (sinon ses fichiers sont verrouilles)
powershell -NoProfile -Command "try { $t = (Get-Content -Raw (Join-Path $env:APPDATA 'MaBibliotheque\\server.token')).Trim(); Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:4242/api/shutdown' -Headers @{ 'x-mb' = '1'; 'x-mb-token' = $t } -TimeoutSec 5 | Out-Null } catch { }" >nul 2>&1
timeout /t 2 /nobreak >nul

rem 2. Copier l'application (sauf le code source)
if /I "%SRC%"=="%DEST%\\" goto raccourcis
echo   Copie des fichiers...
robocopy "%SRC%." "%DEST%" /E /XD "code-source" /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto echec_copie

:raccourcis
rem 3. Raccourcis : Bureau + menu Demarrer
echo   Creation des raccourcis...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $dest = $env:DEST; $icone = Join-Path $dest 'app\\icone.ico'; foreach ($dossier in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) { $l = $ws.CreateShortcut((Join-Path $dossier 'Ma Bibliotheque.lnk')); $l.TargetPath = Join-Path $env:SystemRoot 'System32\\wscript.exe'; $l.Arguments = ([char]34 + (Join-Path $dest 'Ma Bibliotheque.vbs') + [char]34); $l.WorkingDirectory = $dest; $l.WindowStyle = 1; $l.Description = 'Ma Bibliotheque'; if (Test-Path $icone) { $l.IconLocation = $icone }; $l.Save() }"
if errorlevel 1 goto echec_raccourcis

echo.
echo   C'est installe !
echo.
echo   - Un raccourci "Ma Bibliotheque" est sur ton bureau et dans le menu Demarrer.
echo   - L'application est rangee ici : %DEST%
echo   - Tes playlists et tes likes sont conserves (dossier %APPDATA%\\MaBibliotheque).
echo.
echo   Tu peux maintenant supprimer le dossier d'origine (celui de Telechargements)
echo   ainsi que le fichier .zip.
echo.
echo   L'application va s'ouvrir...
start "" wscript.exe "%DEST%\\Ma Bibliotheque.vbs"
echo.
pause
exit /b 0

:incomplet
echo   Ce fichier doit rester dans le dossier "Ma Bibliotheque", a cote du dossier
echo   "runtime" et du dossier "app". Remets-le la puis relance l'installation.
echo.
pause
exit /b 1

:echec_copie
echo.
echo   La copie a echoue. Ferme Ma Bibliotheque si elle est ouverte, puis relance.
echo.
pause
exit /b 1

:echec_raccourcis
echo.
echo   L'application est copiee dans : %DEST%
echo   mais les raccourcis n'ont pas pu etre crees. Tu peux lancer l'application
echo   avec "Lancer Ma Bibliotheque.bat" dans ce dossier.
echo.
pause
exit /b 1
`;
fs.writeFileSync(path.join(stage, 'Installer Ma Bibliotheque.bat'), crlf(installer));

const resetBat = `@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Ma Bibliotheque - mot de passe oublie
echo.
echo   Mot de passe oublie : cree un mot de passe provisoire pour un compte.
echo   (A utiliser surtout si c'est l'administrateur qui l'a oublie ;
echo   sinon, l'administrateur peut le faire dans Administration ^> Comptes.)
echo.
set /p MAIL=  Adresse e-mail du compte : 
echo.
"runtime\\node.exe" --no-warnings "app\\server.mjs" reset-password "%MAIL%"
echo.
pause
`;
fs.writeFileSync(path.join(stage, 'Mot de passe oublie.bat'), crlf(resetBat));
// Les installations mises à jour automatiquement le reçoivent aussi (copié à la racine au démarrage).
fs.writeFileSync(path.join(stage, 'app', 'launchers', 'Mot de passe oublie.bat'), crlf(resetBat));
fs.copyFileSync(path.join(root, 'assets', 'icone.ico'), path.join(stage, 'app', 'icone.ico'));

// Paquet de mise à jour automatique : seulement le dossier « app » (le programme et l'interface, ~1 Mo).
step('Paquet de mise à jour automatique');
const bundle = path.join(releaseDir, 'Ma-Bibliotheque-app.tar.gz');
run('tar', ['-czf', bundle, '-C', stage, 'app']);
fs.writeFileSync(`${bundle}.sha256`, `${sha256(bundle)}  Ma-Bibliotheque-app.tar.gz\n`);
console.log(`  ${bundle} (${(fs.statSync(bundle).size / 1024).toFixed(0)} Ko)`);

const readme = `MA BIBLIOTHEQUE  -  version ${version}
=====================================

Ta musique, sur ton PC, avec une interface a la Spotify : albums, artistes,
playlists, titres likes, file d'attente, recherche.


INSTALLER (a faire une seule fois)
----------------------------------
1. Si ce dossier est encore dans le fichier .zip : clique droit sur le .zip,
   "Extraire tout...", puis ouvre le dossier extrait. (Ne lance rien depuis
   l'interieur du .zip.)
2. Double-clique sur  "Installer Ma Bibliotheque.bat".
   Il range l'application dans  %LOCALAPPDATA%\\Programs\\Ma Bibliotheque
   et cree un raccourci "Ma Bibliotheque" sur le bureau et dans le menu Demarrer.
3. Tu peux ensuite supprimer le dossier extrait et le .zip.

Pour ouvrir l'application, utilise ensuite le raccourci du bureau : c'est le
LECTEUR. Le SERVEUR (qui garde ta bibliotheque et sert aussi le telephone)
tourne a part, en arriere-plan, sans fenetre : le raccourci le demarre s'il ne
tourne pas deja. Fermer la fenetre du lecteur n'arrete pas le serveur : le
telephone continue de fonctionner. Pour arreter le serveur : "Administration" >
"Serveur" > "Arreter le serveur". Pour qu'il demarre tout seul avec Windows :
"Administration" > "Serveur" > "Demarrer le serveur avec Windows".
Plus tard, si le serveur est deplace sur un NAS : "Choisir le serveur.vbs"
(dans le dossier d'installation) indique au lecteur ou le trouver.

Si Windows affiche "Windows a protege votre ordinateur" :
clique sur "Informations complementaires" puis "Executer quand meme".
C'est normal pour un programme qui n'a pas ete telecharge depuis le Store.

Sans installer : "Ma Bibliotheque.vbs" fonctionne aussi directement depuis ce
dossier. "Lancer Ma Bibliotheque.bat" lance le serveur dans une fenetre visible
(utile seulement pour comprendre un probleme).


APPARENCE
---------
"Parametres" > "Apparence" : mode Sombre, Clair ou Auto (suit le reglage de
l'appareil) et 10 palettes de couleurs (Ambre, Emeraude, Corail, Ocean, Violet,
Rose, Menthe, Citron, Glacier, Graphite). Le choix est garde sur chaque
appareil : le PC et le telephone peuvent avoir le leur.


SON : APPAREIL D'ECOUTE ET AMBIANCE
-----------------------------------
Bouton "Son" (curseurs) dans le lecteur, ou "Parametres" > "Son". Deux choix :
- "J'ecoute avec" : Standard, Casque, Ecouteurs ou Haut-parleur (corrige le
  grave et les aigus selon ce qui diffuse le son) ;
- "Ambiance" : Neutre, Rock, Jazz, Chanson, Techno, Hip-hop, Pop, Classique,
  Acoustique.
Les deux se cumulent. Le choix est garde sur chaque appareil (PC et telephone
separement). "Standard" + "Neutre" = son d'origine, sans aucun traitement.


COMPTES : PLUSIEURS PERSONNES, UN SEUL SERVEUR
----------------------------------------------
Chaque personne se connecte avec son adresse e-mail et un mot de passe (aucun
e-mail n'est envoye : l'adresse sert d'identifiant). Chacun garde ses
propres playlists, likes et historique ; la musique, elle, est commune.

- Premier lancement : le compte que tu crees sur le PC du serveur devient le
  compte ADMINISTRATEUR. Tes playlists, likes et historique d'avant les
  comptes sont rattaches a ce compte.
- Les autres : ils creent eux-memes leur compte depuis leur telephone ou leur
  ordinateur ("Creer un compte") tant que les inscriptions sont ouvertes.
  Une fois ton entourage inscrit, ferme-les : "Administration" > "Comptes".
- Mot de passe oublie : l'administrateur ouvre "Administration" > "Comptes",
  clique sur "Mot de passe" a cote de la personne : un mot de passe
  provisoire s'affiche une seule fois, a lui transmettre. A sa prochaine
  connexion, il choisit le sien.
- L'administrateur peut aussi creer un compte, desactiver ou supprimer un
  compte, et nommer d'autres administrateurs.
- Chacun gere son compte dans "Parametres" > "Mon compte" (nom, mot de passe,
  appareils connectes, deconnexion).
- Seuls les administrateurs gerent le serveur : dossiers de musique,
  importation, analyse, acces reseau, mises a jour, arret. Tout cela se trouve
  dans la page "Administration" (colonne de gauche).


IMPORTER DE LA MUSIQUE (ADMINISTRATEUR)
---------------------------------------
Bouton "Importer des fichiers" en bas de la colonne de gauche (ou
"Administration" > "Importer de la musique"), ou glisse des fichiers audio sur
la fenetre. Depuis un telephone, l'administrateur trouve le meme bouton dans
l'onglet "Bibliotheque". Les fichiers sont copies dans un dossier reserve,
"Importations" (dans le dossier des donnees de l'application, indique dans
"Administration"), a part de ta musique habituelle, puis ajoutes a la
bibliotheque de tout le monde. Renvoyer le meme fichier ne cree pas de doublon.


PREMIERE UTILISATION
--------------------
Au premier lancement, cree ton compte administrateur, puis choisis le
dossier qui contient ta musique
(par exemple C:\\Users\\TonNom\\Music). Formats lus : MP3, FLAC, M4A/AAC,
OGG/Opus, WAV. Les pochettes sont reconnues (integrees aux fichiers, ou
fichiers "cover.jpg" / "folder.jpg" dans le dossier de l'album).

L'analyse se fait en arriere-plan : les premiers titres apparaissent tout de
suite. Ensuite, les fichiers ajoutes, renommes ou supprimes sont detectes
automatiquement. Tu peux ajouter plusieurs dossiers dans "Administration".
Deplacer ou renommer un fichier ne fait pas perdre ses likes ni ses playlists.


SUR UN TELEPHONE OU UN AUTRE APPAREIL
-------------------------------------
L'ajout d'un appareil se fait cote serveur, dans "Administration" > "Acces
depuis d'autres appareils" (et non plus depuis le lecteur). Chaque personne
se connecte ensuite avec son propre compte : il n'y a plus de code a saisir.
La musique est lue depuis le serveur et rien n'est copie sur l'appareil.

Cote serveur (une fois, par l'administrateur) :
1. Lance Ma Bibliotheque, ouvre "Administration" > "Acces depuis d'autres
   appareils" et active "Autoriser l'acces depuis le reseau".
2. Windows demande une autorisation "Pare-feu Windows Defender" pour
   node.exe : coche "Reseaux prives" puis "Autoriser l'acces".
   (Si tu as clique sur Annuler : desactive puis reactive l'acces, ou
   autorise "Ma Bibliotheque / node.exe" dans les parametres du pare-feu.)
3. Donne l'adresse affichee (par exemple http://192.168.x.x:4243) aux
   personnes concernees, ou fais-leur scanner le QR code.

Cote telephone :
A) Application Spotifree (fichier .apk, recommandee)
   Ouvre ce lien dans Chrome, puis installe le fichier :
   https://github.com/TLB56550/Spotifree/releases/latest/download/Spotifree.apk
   (Android demande d'autoriser l'installation depuis Chrome la 1re fois.)
   Au premier lancement, saisis l'adresse du serveur (celle qui commence par
   100. avec Tailscale), puis connecte-toi avec ton adresse e-mail et ton mot
   de passe, ou cree ton compte. La musique continue ecran eteint, avec les
   commandes sur l'ecran verrouille. Pour changer d'adresse : "Parametres" >
   "Application" > "Changer l'adresse du serveur".

B) Application web dans Chrome (sans installer de fichier)
   Ouvre l'adresse du serveur dans Chrome, connecte-toi, puis menu (3 points)
   > "Ajouter a l'ecran d'accueil" (ou "Installer l'application").

A savoir :
- Le serveur doit etre allume et Ma Bibliotheque lancee.
- Pour couper l'acces d'un appareil : la personne le deconnecte dans
  "Parametres" > "Mon compte", ou l'administrateur desactive son compte. Pour
  tout couper : desactive l'interrupteur "Autoriser l'acces depuis le reseau".
- Hors de chez toi : installe Tailscale (gratuit, tailscale.com) sur le
  serveur et sur chaque appareil, avec le meme compte. Une adresse "Tailscale"
  apparait alors dans "Administration" : choisis-la.
  Sans Tailscale, n'ouvre pas ton PC sur Internet (pas de redirection de port).
- Les mots de passe circulent en clair (sans chiffrement) sur ton reseau
  local tant que l'adresse commence par http://. Pour les chiffrer, utilise
  une adresse https:// : avec Tailscale, tape dans PowerShell sur le serveur :
  tailscale serve --bg 4243   puis utilise l'adresse https:// qu'il affiche.
  C'est surtout utile si le serveur est joignable depuis Internet.
- Serveur sans ecran (NAS, Docker) : le premier compte administrateur peut
  etre cree avec les variables MB_ADMIN_EMAIL et MB_ADMIN_PASSWORD (puis
  MB_ADMIN_NAME, facultatif), a la place du formulaire sur le PC.


RACCOURCIS CLAVIER
------------------
  Espace          lecture / pause
  Fleche gauche/droite   reculer / avancer de 5 secondes
  Ctrl + gauche/droite   titre precedent / suivant
  Fleche haut/bas        volume
  M               couper le son
  S               lecture aleatoire        R   repetition
  L               aimer le titre en cours
  Q               ouvrir / fermer la file d'attente
  /               aller a la recherche
  Clic droit      menu d'un titre, d'un album ou d'une playlist


FERMER ET ARRETER
-----------------
- Fermer la fenetre : seul le lecteur se ferme (la musique jouee sur le PC
  s'arrete), le serveur reste allume.
- Arreter le serveur : "Administration" > "Serveur" > "Arreter le serveur".
  Plus personne n'a alors acces a la bibliotheque.
Le journal du serveur est dans %APPDATA%\\MaBibliotheque\\server.log.


OU SONT MES DONNEES ?
---------------------
Comptes, playlists, likes et historique sont dans :
    %APPDATA%\\MaBibliotheque
(tape ca dans la barre d'adresse de l'Explorateur). Tes fichiers de musique
ne sont jamais modifies ni deplaces : l'application ne fait que les lire.

Mise a jour : automatique. A chaque demarrage, l'application regarde si une
version plus recente est publiee (https://github.com/TLB56550/Spotifree/releases),
la telecharge, verifie son empreinte, l'installe et redemarre toute seule
(un ecran "Mise a jour" s'affiche quelques secondes). Rien a faire. Si
internet n'est pas disponible, elle demarre normalement. "Parametres" >
"Application" permet de verifier a la main.
Mise a jour manuelle (en secours) : extrais la nouvelle version et relance son
installateur : il remplace l'ancienne version, tes playlists et tes likes sont
gardes.
Pour tout effacer : supprime  %LOCALAPPDATA%\\Programs\\Ma Bibliotheque,
les deux raccourcis, et le dossier %APPDATA%\\MaBibliotheque.


CONFIDENTIALITE
---------------
Par defaut, l'application n'est joignable que depuis ce PC (adresse
127.0.0.1) : personne d'autre sur ton reseau ni sur Internet ne peut y
acceder, et elle n'envoie rien nulle part. Windows ne demande alors aucune
autorisation pare-feu.
Si tu actives "Autoriser l'acces depuis le reseau", elle devient joignable
depuis ton reseau local, mais seulement par les personnes qui ont un compte.
Les mots de passe sont stockes brouilles (jamais en clair) et les essais de
connexion sont limites. Toute personne qui peut ouvrir l'adresse peut creer
un compte tant que les inscriptions sont ouvertes : ferme-les ensuite.


EN CAS DE PROBLEME
------------------
- Si le serveur est deja lance, le raccourci rouvre simplement la fenetre du
  lecteur. Si un probleme persiste, regarde le journal du serveur (voir plus
  haut). Si le message "Le port 4242 est deja utilise par un autre programme"
  apparait, un autre logiciel occupe ce port : ferme-le (ou redemarre le PC).
- Une chanson ne se lit pas : verifie qu'elle s'ouvre dans un autre lecteur ;
  les fichiers abimes sont ignores et comptes dans "Administration" > Analyse.
- Ta musique est sur un disque externe ou reseau absent : les titres restent
  dans la bibliotheque et redeviennent lisibles quand le disque est rebranche.
- Le telephone n'arrive pas a joindre le serveur : verifie le meme Wi-Fi (pas
  le "reseau invite" de la box), l'autorisation du pare-feu (etape 2), et que
  l'adresse affichee dans "Administration" est bien celle de ton reseau.
- Mot de passe oublie : demande a l'administrateur de le reinitialiser
  ("Administration" > "Comptes"). Si c'est l'administrateur lui-meme qui l'a
  oublie : double-clique sur "Mot de passe oublie.bat" (dans le dossier
  d'installation), saisis son adresse e-mail : un mot de passe provisoire
  s'affiche.
- Rien ne s'affiche : lance le .bat et lis le message dans la fenetre noire.


A PROPOS DU PROGRAMME
---------------------
Le dossier "runtime" contient Node.js ${NODE_VERSION} (node.exe), le moteur qui
fait tourner l'application, pour que tu n'aies rien a installer. Il est publie
par l'OpenJS Foundation (licence MIT, https://nodejs.org). Tu peux verifier son
origine : clique droit sur runtime\\node.exe > Proprietes > Signatures
numeriques : l'auteur doit etre "OpenJS Foundation".
Empreinte SHA-256 attendue :
    ${NODE_EXE_SHA256}
(dans PowerShell :  Get-FileHash runtime\\node.exe)

Le dossier "code-source" contient le code de l'application, pour archive.
Il n'est pas necessaire pour l'utiliser.
`;
fs.writeFileSync(path.join(stage, 'LISEZMOI.txt'), crlf(readme));

// Sources (sans dépendances ni fichiers générés).
const skip = new Set(['node_modules', 'dist', 'release', '.cache', '.git']);
const sourceDir = path.join(stage, 'code-source');
fs.mkdirSync(sourceDir, { recursive: true });
for (const entry of fs.readdirSync(root)) {
  if (skip.has(entry)) continue;
  fs.cpSync(path.join(root, entry), path.join(sourceDir, entry), {
    recursive: true,
    filter: (src) => !skip.has(path.basename(src)),
  });
}

// 4. Archive ---------------------------------------------------------------------------
step('Compression');
const zipPath = path.join(releaseDir, `${name.replace(/ /g, '-')}-${version}.zip`);
run('zip', ['-r', '-q', '-9', zipPath, name], { cwd: releaseDir });
const mb = (fs.statSync(zipPath).size / 1048576).toFixed(1);
console.log(`\n✓ ${zipPath} (${mb} Mo)`);
