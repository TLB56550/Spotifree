#!/usr/bin/env bash
# Lance l'APK dans un émulateur, saisit une adresse, et garde des captures d'écran + le journal.
set -x
APK=android/app/build/outputs/apk/release/app-release.apk
OUT=out
mkdir -p "$OUT"
PKG=fr.spotifree.app

shot() { adb exec-out screencap -p > "$OUT/$1.png"; }

# Trouve un élément de l'écran (par classe ou par texte) et touche son centre.
tap() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb pull /sdcard/ui.xml "$OUT/ui-last.xml" >/dev/null 2>&1
  python3 - "$1" "$2" <<'PY' > "$OUT/tap.txt"
import re, sys
kind, value = sys.argv[1], sys.argv[2]
xml = open('out/ui-last.xml', encoding='utf8').read()
for node in re.findall(r'<node [^>]*>', xml):
    if (kind == 'class' and f'class="{value}"' in node) or (kind == 'text' and f'text="{value.lower()}"' in node.lower()):
        m = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
        x1, y1, x2, y2 = map(int, m.groups())
        print((x1 + x2) // 2, (y1 + y2) // 2)
        break
PY
  read -r X Y < "$OUT/tap.txt"
  if [ -n "$X" ]; then adb shell input tap "$X" "$Y"; else echo "ELEMENT INTROUVABLE: $1 $2"; fi
}

adb install -r "$APK" || exit 1
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS
adb logcat -c

# 0) mise à jour : cet APK porte le numéro 1, la dernière version publiée est plus récente
adb shell am start -n $PKG/.MainActivity
sleep 8
shot 0-maj-dialogue
tap text "Mettre à jour"
sleep 20
shot 0b-maj-installation
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/ui-maj.xml" >/dev/null 2>&1
adb shell input keyevent 4
sleep 2
adb shell am force-stop $PKG
adb shell pm clear $PKG
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS

# 1) premier lancement : l'écran de saisie doit apparaître
adb shell am start -n $PKG/.MainActivity
sleep 8
tap text "Plus tard"
sleep 1
shot 1-lancement
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/ui-1.xml" >/dev/null 2>&1

# 2) saisie d'une adresse qui répond (page de test sur l'hôte)
tap class android.widget.EditText
sleep 1
adb shell input text "10.0.2.2:4243"
sleep 1
shot 2-saisie
adb shell input keyevent 66   # Entrée = « Se connecter »
sleep 3
shot 3a-chargement
sleep 6
shot 3-connexion

# 3) adresse injoignable : un message d'erreur doit apparaître (pas un écran noir)
try_address() {
  adb shell pm clear $PKG
  adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS
  adb shell am start -n $PKG/.MainActivity
  sleep 8
  tap text "Plus tard"
  sleep 1
  tap class android.widget.EditText
  sleep 1
  adb shell input text "$1"
  sleep 1
  adb shell input keyevent 66
  sleep "$2"
  shot "$3"
}
try_address "10.0.2.2:9" 12 4-injoignable
# 4) le PC répond « 403 » (accès téléphone désactivé) : message explicite, pas un écran noir
try_address "10.0.2.2:4244" 6 5-refuse

adb logcat -d > "$OUT/logcat-complet.txt"
grep -iE "AndroidRuntime|spotifree|FATAL|chromium.*(ERR|error)" "$OUT/logcat-complet.txt" | head -200 > "$OUT/logcat.txt"
