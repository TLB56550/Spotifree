package fr.spotifree.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Mises à jour : au démarrage, compare la version installée à la dernière version publiée sur GitHub.
 * Si une version plus récente existe, propose de la télécharger puis de l'installer.
 * Le numéro de version est celui de la compilation (« apk-12 » = versionCode 12).
 */
final class Updater {
    private static final String LATEST_API = "https://api.github.com/repos/TLB56550/Spotifree/releases/latest";
    private static final String ASSET_NAME = "Spotifree.apk";

    private static boolean checked;
    private static boolean busy;

    private Updater() {}

    /** Une seule vérification par lancement de l'application. */
    static void checkOnStart(Activity activity) {
        if (checked) return;
        checked = true;
        new Thread(() -> check(activity)).start();
    }

    static int installedVersion(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return (int) (Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode);
        } catch (Exception e) {
            return Integer.MAX_VALUE; // inconnue : on ne propose rien
        }
    }

    static String installedName(Context context) {
        try {
            return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "?";
        }
    }

    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(20000);
        c.setRequestProperty("User-Agent", "Spotifree-Android");
        c.setRequestProperty("Accept", "application/vnd.github+json");
        return c;
    }

    private static void check(final Activity activity) {
        try {
            HttpURLConnection c = open(LATEST_API);
            if (c.getResponseCode() != 200) return; // pas de réseau, dépôt privé... : on ne dérange pas
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            try (InputStream in = c.getInputStream()) {
                byte[] chunk = new byte[8192];
                int n;
                while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            }
            c.disconnect();
            JSONObject release = new JSONObject(buf.toString("UTF-8"));
            String tag = release.optString("tag_name", "");
            if (!tag.startsWith("apk-")) return;
            final int latest = Integer.parseInt(tag.substring(4));
            if (latest <= installedVersion(activity)) return;

            String url = null;
            long size = -1;
            JSONArray assets = release.optJSONArray("assets");
            if (assets != null) {
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject asset = assets.getJSONObject(i);
                    if (ASSET_NAME.equals(asset.optString("name"))) {
                        url = asset.optString("browser_download_url", null);
                        size = asset.optLong("size", -1);
                    }
                }
            }
            if (url == null) return;
            final String apkUrl = url;
            final long apkSize = size;
            activity.runOnUiThread(() -> propose(activity, latest, apkUrl, apkSize));
        } catch (Exception ignored) {
            // Vérification impossible (hors ligne, GitHub injoignable) : l'application démarre normalement.
        }
    }

    private static void propose(final Activity activity, final int latest, final String url, final long size) {
        if (activity.isFinishing() || activity.isDestroyed()) return;
        new AlertDialog.Builder(activity)
                .setTitle("Mise à jour disponible")
                .setMessage("Une nouvelle version de Spotifree est disponible (version 1.0." + latest
                        + ", tu as la 1.0." + installedVersion(activity) + ").\n\nLa télécharger et l'installer maintenant ?")
                .setPositiveButton("Mettre à jour", (d, w) -> download(activity, url, size))
                .setNegativeButton("Plus tard", null)
                .show();
    }

    /** Télécharge l'APK directement dans une session d'installation Android, puis lance l'installation. */
    private static void download(final Activity activity, final String url, final long size) {
        if (busy) return;
        busy = true;
        final AlertDialog progress = new AlertDialog.Builder(activity)
                .setTitle("Mise à jour")
                .setMessage("Téléchargement… 0 %")
                .setCancelable(false)
                .create();
        progress.show();

        new Thread(() -> {
            PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
            PackageInstaller.Session session = null;
            try {
                PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                if (size > 0) params.setSize(size);
                int id = installer.createSession(params);
                session = installer.openSession(id);

                HttpURLConnection c = open(url);
                if (c.getResponseCode() != 200) throw new Exception("le serveur a répondu " + c.getResponseCode());
                long total = c.getContentLengthLong() > 0 ? c.getContentLengthLong() : size;
                try (InputStream in = c.getInputStream(); OutputStream out = session.openWrite(ASSET_NAME, 0, total > 0 ? total : -1)) {
                    byte[] chunk = new byte[64 * 1024];
                    long done = 0;
                    int lastPct = -1;
                    int n;
                    while ((n = in.read(chunk)) > 0) {
                        out.write(chunk, 0, n);
                        done += n;
                        if (total > 0) {
                            final int pct = (int) (done * 100 / total);
                            if (pct != lastPct) {
                                lastPct = pct;
                                activity.runOnUiThread(() -> progress.setMessage("Téléchargement… " + pct + " %"));
                            }
                        }
                    }
                    session.fsync(out);
                }
                c.disconnect();

                Intent result = new Intent(activity, UpdateReceiver.class).setAction(UpdateReceiver.ACTION);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                PendingIntent pending = PendingIntent.getBroadcast(activity, id, result, flags);
                activity.runOnUiThread(() -> progress.setMessage("Installation…"));
                session.commit(pending.getIntentSender());
            } catch (final Exception e) {
                if (session != null) {
                    try {
                        session.abandon();
                    } catch (Exception ignored) {
                        // Session déjà fermée.
                    }
                }
                activity.runOnUiThread(() -> Toast.makeText(activity, "Mise à jour impossible : " + e.getMessage(), Toast.LENGTH_LONG).show());
            } finally {
                if (session != null) session.close();
                busy = false;
                activity.runOnUiThread(() -> {
                    try {
                        progress.dismiss();
                    } catch (Exception ignored) {
                        // L'écran a déjà été fermé.
                    }
                });
            }
        }).start();
    }
}
