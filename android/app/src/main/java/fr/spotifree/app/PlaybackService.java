package fr.spotifree.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.webkit.CookieManager;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Garde la musique en vie quand l'écran s'éteint ou que l'application passe en arrière-plan,
 * et affiche la notification de lecture (écran verrouillé, casque, voiture...).
 * Le son lui-même est joué par la page web ; ce service ne fait que l'afficher et relayer les touches.
 */
public class PlaybackService extends Service {
    static final class State {
        final String title;
        final String artist;
        final String album;
        final String artwork;
        final boolean playing;
        final long positionMs;
        final long durationMs;

        State(String title, String artist, String album, String artwork, boolean playing, long positionMs, long durationMs) {
            this.title = title == null ? "" : title;
            this.artist = artist == null ? "" : artist;
            this.album = album == null ? "" : album;
            this.artwork = artwork == null ? "" : artwork;
            this.playing = playing;
            this.positionMs = Math.max(0, positionMs);
            this.durationMs = Math.max(0, durationMs);
        }
    }

    private static final String CHANNEL = "playback";
    private static final int NOTIFICATION_ID = 1;
    private static final String ACT_PLAY = "fr.spotifree.app.PLAY";
    private static final String ACT_PAUSE = "fr.spotifree.app.PAUSE";
    private static final String ACT_NEXT = "fr.spotifree.app.NEXT";
    private static final String ACT_PREV = "fr.spotifree.app.PREV";

    private static volatile PlaybackService instance;
    private static volatile State pending;

    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaSession session;
    private NotificationManager notifications;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private State state;
    private Bitmap art;
    private String artUrl = "";
    private boolean foreground;
    private boolean closing;

    /** Appelé par la page (donc hors du fil principal) à chaque changement de titre ou d'état. */
    static void post(Context context, State s) {
        PlaybackService svc = instance;
        if (svc != null) {
            svc.main.post(() -> svc.apply(s));
            return;
        }
        if (!s.playing) return; // rien à garder en vie
        pending = s;
        try {
            Context app = context.getApplicationContext();
            app.startForegroundService(new Intent(app, PlaybackService.class));
        } catch (RuntimeException e) {
            // Android refuse de démarrer un service depuis l'arrière-plan : la lecture continue sans notification.
            pending = null;
        }
    }

    static void halt() {
        pending = null;
        final PlaybackService svc = instance;
        if (svc != null) svc.main.post(svc::shutdown);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        notifications = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Lecture en cours", NotificationManager.IMPORTANCE_LOW);
        channel.setShowBadge(false);
        notifications.createNotificationChannel(channel);

        session = new MediaSession(this, "Spotifree");
        session.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                MainActivity.sendCommand("play", null);
            }

            @Override
            public void onPause() {
                MainActivity.sendCommand("pause", null);
            }

            @Override
            public void onSkipToNext() {
                MainActivity.sendCommand("next", null);
            }

            @Override
            public void onSkipToPrevious() {
                MainActivity.sendCommand("prev", null);
            }

            @Override
            public void onSeekTo(long pos) {
                MainActivity.sendCommand("seek", pos / 1000.0);
            }
        });
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACT_PLAY.equals(action)) MainActivity.sendCommand("play", null);
        else if (ACT_PAUSE.equals(action)) MainActivity.sendCommand("pause", null);
        else if (ACT_NEXT.equals(action)) MainActivity.sendCommand("next", null);
        else if (ACT_PREV.equals(action)) MainActivity.sendCommand("prev", null);

        State s = pending;
        if (s != null) {
            pending = null;
            state = s;
        }
        if (state == null) state = new State("Spotifree", "", "", "", false, 0, 0);
        refresh();
        return START_NOT_STICKY;
    }

    private void apply(State s) {
        state = s;
        refresh();
    }

    private void refresh() {
        State s = state;
        if (s == null || closing || session == null) return;
        if (!s.artwork.equals(artUrl)) loadArt(s.artwork);

        MediaMetadata.Builder meta = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, s.title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, s.artist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, s.album)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, s.durationMs);
        if (art != null) meta.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art);
        session.setMetadata(meta.build());

        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO;
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(actions)
                .setState(s.playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, s.positionMs,
                        s.playing ? 1f : 0f, SystemClock.elapsedRealtime())
                .build());

        Notification n = buildNotification(s);
        if (!foreground) {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
            foreground = true;
        } else {
            notifications.notify(NOTIFICATION_ID, n);
        }
        setLocks(s.playing);
    }

    private Notification.Action action(int icon, String title, String act) {
        Intent i = new Intent(this, PlaybackService.class).setAction(act);
        PendingIntent pi = PendingIntent.getService(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), title, pi).build();
    }

    private Notification buildNotification(State s) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_note)
                .setContentTitle(s.title)
                .setContentText(s.artist)
                .setContentIntent(contentIntent)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setOngoing(s.playing)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .addAction(action(R.drawable.ic_prev, "Précédent", ACT_PREV))
                .addAction(s.playing ? action(R.drawable.ic_pause, "Pause", ACT_PAUSE) : action(R.drawable.ic_play, "Lecture", ACT_PLAY))
                .addAction(action(R.drawable.ic_next, "Suivant", ACT_NEXT))
                .setStyle(new Notification.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2));
        if (art != null) b.setLargeIcon(art);
        return b.build();
    }

    /** Télécharge la pochette (elle demande la session de l'appareil, donc le cookie de la WebView). */
    private void loadArt(final String url) {
        artUrl = url;
        art = null;
        String origin = MainActivity.serverOrigin;
        if (url.isEmpty() || origin == null || !url.startsWith(origin + "/")) return;
        final String cookie = CookieManager.getInstance().getCookie(url);
        new Thread(() -> {
            Bitmap result = null;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(10000);
                if (cookie != null) c.setRequestProperty("Cookie", cookie);
                if (c.getResponseCode() == 200) {
                    InputStream in = c.getInputStream();
                    Bitmap full = BitmapFactory.decodeStream(in);
                    in.close();
                    if (full != null) {
                        int max = Math.max(full.getWidth(), full.getHeight());
                        if (max > 512) {
                            float k = 512f / max;
                            result = Bitmap.createScaledBitmap(full, Math.round(full.getWidth() * k), Math.round(full.getHeight() * k), true);
                        } else {
                            result = full;
                        }
                    }
                }
                c.disconnect();
            } catch (Throwable ignored) {
                // Pas de pochette : la notification s'affiche sans.
            }
            final Bitmap loaded = result;
            main.post(() -> {
                if (loaded != null && url.equals(artUrl) && instance == this) {
                    art = loaded;
                    refresh();
                }
            });
        }).start();
    }

    private void setLocks(boolean playing) {
        try {
            if (playing) {
                if (wakeLock == null) {
                    PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "spotifree:playback");
                    wakeLock.setReferenceCounted(false);
                }
                if (!wakeLock.isHeld()) wakeLock.acquire(6 * 60 * 60 * 1000L);
                if (wifiLock == null) {
                    WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                    wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "spotifree:playback");
                    wifiLock.setReferenceCounted(false);
                }
                if (!wifiLock.isHeld()) wifiLock.acquire();
            } else {
                releaseLocks();
            }
        } catch (RuntimeException ignored) {
            // Verrous indisponibles : sans conséquence grave.
        }
    }

    private void releaseLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (RuntimeException ignored) {
            // Déjà libérés.
        }
    }

    private void shutdown() {
        closing = true;
        releaseLocks();
        stopForeground(true);
        foreground = false;
        stopSelf();
    }

    @Override
    public void onDestroy() {
        instance = null;
        releaseLocks();
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
