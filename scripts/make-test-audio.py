#!/usr/bin/env python3
"""Génère une petite bibliothèque de test (sons de synthèse + tags + pochettes) avec ffmpeg."""
import os
import subprocess
import sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)

COLORS = ["c0392b", "2980b9", "27ae60", "8e44ad", "d35400", "16a085", "f39c12", "2c3e50"]


def run(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def cover(path, color, size=500):
    run("-f", "lavfi", "-i", f"color=c=0x{color}:s={size}x{size}", "-frames:v", "1", path)


def track(path, freq, secs, tags, codec, cover_path=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cmd = ["-f", "lavfi", "-i", f"sine=frequency={freq}:duration={secs}"]
    if cover_path:
        cmd += ["-i", cover_path, "-map", "0:a", "-map", "1:v", "-c:v", "copy", "-disposition:v", "attached_pic"]
    cmd += codec
    for k, v in tags.items():
        cmd += ["-metadata", f"{k}={v}"]
    run(*cmd, path)


MP3 = ["-c:a", "libmp3lame", "-b:a", "96k", "-id3v2_version", "3"]
FLAC = ["-c:a", "flac"]
M4A = ["-c:a", "aac", "-b:a", "96k"]
OGG = ["-c:a", "libvorbis", "-q:a", "2"]

albums = [
    # (dossier, artiste, album, année, genre, ext, nb titres, avec pochette intégrée)
    ("Beyoncé/Lemonade", "Beyoncé", "Lemonade", 2016, "R&B", "mp3", 5, True),
    ("Étienne Daho/Éden", "Étienne Daho", "Éden", 1996, "Pop", "flac", 4, True),
    ("Daft Punk/Discovery", "Daft Punk", "Discovery", 2001, "Electronic", "mp3", 4, False),  # pochette dossier
    ("Daft Punk/Random Access Memories", "Daft Punk", "Random Access Memories", 2013, "Electronic", "m4a", 3, True),
    ("Nina Simone/Pastel Blues", "Nina Simone", "Pastel Blues", 1965, "Jazz", "ogg", 4, True),
    ("Nina Simone/Wild Is the Wind", "Nina Simone", "Wild Is the Wind", 1966, "Jazz", "flac", 3, False),
    ("Alt-J/An Awesome Wave", "alt-J", "An Awesome Wave", 2012, "Indie", "mp3", 4, True),
]

freq = 220
n = 0
for i, (folder, artist, album, year, genre, ext, count, embed) in enumerate(albums):
    cov = os.path.join(out, f"_cover{i}.png")
    cover(cov, COLORS[i % len(COLORS)])
    for t in range(1, count + 1):
        n += 1
        freq += 17
        title = f"{album} - Titre {t}" if t % 2 else f"Chanson {t} de {album}"
        feat = " feat. Invité" if t == 2 else ""
        tags = {
            "title": title,
            "artist": artist + feat,
            "album_artist": artist,
            "album": album,
            "track": f"{t}/{count}",
            "date": str(year),
            "genre": genre,
        }
        codec = {"mp3": MP3, "flac": FLAC, "m4a": M4A, "ogg": OGG}[ext]
        path = os.path.join(out, folder, f"{t:02d} - {title}.{ext}")
        track(path, freq, 12 + t, tags, codec, cov if embed and ext != "ogg" else None)
    if not embed:
        os.replace(cov, os.path.join(out, folder, "folder.png"))
    else:
        os.remove(cov)

# Compilation sans artiste d'album : artistes différents, même album
for t, art in enumerate(["Artiste A", "Artiste B", "Artiste C"], start=1):
    freq += 17
    track(
        os.path.join(out, "Compilation", f"{t:02d}.mp3"),
        freq,
        10,
        {"title": f"Hit {t}", "artist": art, "album": "Now That's Music", "album_artist": "Various Artists", "track": str(t), "date": "2020", "genre": "Pop"},
        MP3,
    )

# Fichier sans aucune étiquette
track(os.path.join(out, "Vrac", "07 - mystère.mp3"), 330, 8, {}, MP3)
# Fichier corrompu (doit être ignoré sans planter l'analyse)
with open(os.path.join(out, "Vrac", "corrompu.mp3"), "wb") as f:
    f.write(b"ceci n'est pas de l'audio")
# Fichier ignoré
with open(os.path.join(out, "Vrac", "notes.txt"), "w") as f:
    f.write("pas de la musique")

print("fichiers audio :", sum(len(fs) for _, _, fs in os.walk(out)))
