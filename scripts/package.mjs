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

"runtime\\node.exe" --no-warnings "app\\server.mjs"

if errorlevel 1 (
  echo.
  echo   Une erreur est survenue. Le message ci-dessus explique pourquoi.
  echo   Appuie sur une touche pour fermer.
  pause >nul
)
`;
fs.writeFileSync(path.join(stage, 'Lancer Ma Bibliotheque.bat'), crlf(launcher));

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
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:4242/api/shutdown' -Headers @{ 'x-mb' = '1' } -TimeoutSec 5 | Out-Null } catch { }" >nul 2>&1
timeout /t 2 /nobreak >nul

rem 2. Copier l'application (sauf le code source)
if /I "%SRC%"=="%DEST%\\" goto raccourcis
echo   Copie des fichiers...
robocopy "%SRC%." "%DEST%" /E /XD "code-source" /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto echec_copie

:raccourcis
rem 3. Raccourcis : Bureau + menu Demarrer
echo   Creation des raccourcis...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $dest = $env:DEST; $icone = Join-Path $dest 'app\\icone.ico'; foreach ($dossier in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) { $l = $ws.CreateShortcut((Join-Path $dossier 'Ma Bibliotheque.lnk')); $l.TargetPath = Join-Path $dest 'Lancer Ma Bibliotheque.bat'; $l.WorkingDirectory = $dest; $l.WindowStyle = 7; $l.Description = 'Ma Bibliotheque'; if (Test-Path $icone) { $l.IconLocation = $icone }; $l.Save() }"
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
start "" /min "%DEST%\\Lancer Ma Bibliotheque.bat"
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
fs.copyFileSync(path.join(root, 'assets', 'icone.ico'), path.join(stage, 'app', 'icone.ico'));

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

Pour lancer l'application, utilise ensuite le raccourci du bureau.
Une fenetre reduite dans la barre des taches est le moteur : laisse-la
tranquille, elle se ferme avec "Parametres" > "Arreter".

Si Windows affiche "Windows a protege votre ordinateur" :
clique sur "Informations complementaires" puis "Executer quand meme".
C'est normal pour un programme qui n'a pas ete telecharge depuis le Store.

Sans installer : "Lancer Ma Bibliotheque.bat" fonctionne aussi directement
depuis ce dossier.


PREMIERE UTILISATION
--------------------
Au premier lancement, choisis le dossier qui contient ta musique
(par exemple C:\\Users\\TonNom\\Music). Formats lus : MP3, FLAC, M4A/AAC,
OGG/Opus, WAV. Les pochettes sont reconnues (integrees aux fichiers, ou
fichiers "cover.jpg" / "folder.jpg" dans le dossier de l'album).

L'analyse se fait en arriere-plan : les premiers titres apparaissent tout de
suite. Ensuite, les fichiers ajoutes, renommes ou supprimes sont detectes
automatiquement. Tu peux ajouter plusieurs dossiers dans "Parametres".
Deplacer ou renommer un fichier ne fait pas perdre ses likes ni ses playlists.


SUR TON TELEPHONE ANDROID
-------------------------
Deux possibilites, au choix. Dans les deux cas, la musique est lue depuis
ton PC et rien n'est copie sur le telephone.

A) Application Spotifree (fichier .apk, recommandee)
   Sur le telephone, ouvre ce lien dans Chrome, puis installe le fichier :
   https://github.com/TLB56550/Spotifree/releases/latest/download/Spotifree.apk
   (Android demande d'autoriser l'installation depuis Chrome la 1re fois.)
   Au premier lancement, saisis l'adresse de ton PC : celle qui commence par
   100. dans "Parametres" > "Telephone" (pastille Tailscale), puis le code
   d'association. La musique continue ecran eteint, avec les commandes sur
   l'ecran verrouille. Il faut Tailscale actif sur le PC et le telephone
   (voir plus bas). Si tu changes d'adresse : "Parametres" > "Changer
   l'adresse du PC" dans l'application.

B) Application web dans Chrome (sans installer de fichier)
   Elle s'installe depuis Chrome (elle apparait ensuite sur l'ecran d'accueil,
   en plein ecran, avec sa propre icone). Etapes ci-dessous.

Sur le PC :
1. Lance Ma Bibliotheque, ouvre "Parametres" > "Telephone".
2. Active "Autoriser l'acces depuis mon telephone".
3. Windows demande une autorisation "Pare-feu Windows Defender" pour
   node.exe : coche "Reseaux prives" puis "Autoriser l'acces".
   (Si tu as clique sur Annuler : desactive puis reactive l'acces, ou
   autorise "Ma Bibliotheque / node.exe" dans les parametres du pare-feu.)

Sur le telephone (connecte au meme Wi-Fi que le PC) :
4. Ouvre l'appareil photo et scanne le QR code affiche sur le PC, ou ouvre
   dans Chrome l'adresse indiquee (http://192.168.x.x:4243) et saisis le code.
   Le code est valable 10 minutes et ne sert qu'une fois.
5. Dans Chrome, menu (3 points) > "Ajouter a l'ecran d'accueil" (ou
   "Installer l'application").

A savoir :
- Le PC doit etre allume et Ma Bibliotheque lancee : la musique est lue
  depuis le PC, rien n'est copie sur le telephone.
- Chaque telephone doit etre associe une fois. Pour couper l'acces d'un
  telephone : "Parametres" > "Telephone" > icone corbeille a cote de son nom.
  Pour tout couper : desactive l'interrupteur.
- Les dossiers de musique, l'analyse et l'arret du programme ne se
  controlent que depuis le PC, jamais depuis le telephone.
- Hors de chez toi : installe Tailscale (gratuit, tailscale.com) sur le PC
  et sur le telephone avec le meme compte. Une adresse "Tailscale" apparait
  alors dans "Parametres" > "Telephone" : choisis-la, puis scanne le QR code.
  Sans Tailscale, n'ouvre pas ton PC sur Internet (pas de redirection de port).
- Sans https, Chrome installe l'application comme un raccourci en plein
  ecran, mais sans mode "hors ligne". Pour une installation complete,
  avec Tailscale tape dans PowerShell sur le PC :  tailscale serve --bg 4243
  puis ouvre sur le telephone l'adresse https:// qu'il affiche.


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


QUITTER
-------
"Parametres" > "Arreter", ou ferme la fenetre noire. La musique s'arrete.


OU SONT MES DONNEES ?
---------------------
Playlists, likes et historique sont dans :
    %APPDATA%\\MaBibliotheque
(tape ca dans la barre d'adresse de l'Explorateur). Tes fichiers de musique
ne sont jamais modifies ni deplaces : l'application ne fait que les lire.

Pour mettre a jour : extrais la nouvelle version et relance son installateur :
il remplace l'ancienne version, tes playlists et tes likes sont gardes.
Pour tout effacer : supprime  %LOCALAPPDATA%\\Programs\\Ma Bibliotheque,
les deux raccourcis, et le dossier %APPDATA%\\MaBibliotheque.


CONFIDENTIALITE
---------------
Par defaut, l'application n'est joignable que depuis ce PC (adresse
127.0.0.1) : personne d'autre sur ton reseau ni sur Internet ne peut y
acceder, et elle n'envoie rien nulle part. Windows ne demande alors aucune
autorisation pare-feu.
Si tu actives "Telephone", elle devient joignable depuis ton reseau local,
mais seulement par les telephones que tu as associes avec le code. Tu peux
les retirer a tout moment.


EN CAS DE PROBLEME
------------------
- Si l'application est deja lancee, relancer le .bat rouvre simplement sa
  fenetre. Si le message "Le port 4242 est deja utilise par un autre programme"
  apparait, un autre logiciel occupe ce port : ferme-le (ou redemarre le PC).
- Une chanson ne se lit pas : verifie qu'elle s'ouvre dans un autre lecteur ;
  les fichiers abimes sont ignores et comptes dans "Parametres" > Analyse.
- Ta musique est sur un disque externe ou reseau absent : les titres restent
  dans la bibliotheque et redeviennent lisibles quand le disque est rebranche.
- Le telephone n'arrive pas a joindre le PC : verifie le meme Wi-Fi (pas le
  "reseau invite" de la box), l'autorisation du pare-feu (etape 3), et que
  l'adresse affichee dans "Parametres" > "Telephone" est bien celle de ton
  reseau. Le code a expire ? Clique sur "Nouveau code".
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
