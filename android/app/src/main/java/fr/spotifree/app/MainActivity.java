package fr.spotifree.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import java.lang.ref.WeakReference;
import java.util.Locale;

/**
 * Spotifree : une coque Android autour de l'application Spotifree qui tourne sur le PC.
 * L'adresse du PC est demandée une fois, puis l'interface s'affiche dans une WebView.
 * La lecture continue en arrière-plan grâce à PlaybackService (notification et écran verrouillé).
 */
public class MainActivity extends Activity {
    private static final String PREFS = "spotifree";
    private static final String KEY_URL = "server_url";

    private static final int BG = 0xFF07080A;
    private static final int FIELD = 0xFF12151A;
    private static final int FG = 0xFFF2EFE9;
    private static final int MUTED = 0xFFB4B0A8;
    private static final int ACCENT = 0xFFF2B134;
    private static final int ERROR = 0xFFFF8F7A;

    private static volatile WeakReference<MainActivity> current;
    /** Adresse du PC (« http://100.x.x.x:4243 »), lue par le service pour récupérer les pochettes. */
    static volatile String serverOrigin;

    private FrameLayout root;
    private WebView web;
    private View overlay;
    private boolean overlayIsSetup;
    private boolean overlayIsLoading;
    private static final int REQ_PICK_AUDIO = 4243;
    /** Réponse attendue par la page quand elle a demandé de choisir des fichiers (envoi vers le PC). */
    private ValueCallback<Uri[]> filePicker;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = () -> showError("Le PC ne répond pas (délai dépassé).");
    private String serverUrl;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        current = new WeakReference<>(this);
        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        setContentView(root);

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {"android.permission.POST_NOTIFICATIONS"}, 1);
        }

        serverUrl = prefs().getString(KEY_URL, null);
        serverOrigin = serverUrl;
        if (serverUrl == null) {
            showSetup(null);
        } else {
            openServer();
        }
        Updater.checkOnStart(this);
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    // ---------------------------------------------------------------- adresse du PC

    /** « 100.64.1.2 » devient « http://100.64.1.2:4243 » ; une adresse https:// est gardée telle quelle. */
    static String normalize(String input) {
        if (input == null) return null;
        String s = input.trim();
        if (s.isEmpty() || s.contains(" ")) return null;
        if (!s.toLowerCase(Locale.ROOT).startsWith("http://") && !s.toLowerCase(Locale.ROOT).startsWith("https://")) {
            s = "http://" + s;
        }
        Uri u = Uri.parse(s);
        String host = u.getHost();
        String scheme = u.getScheme();
        if (host == null || host.isEmpty() || scheme == null) return null;
        scheme = scheme.toLowerCase(Locale.ROOT);
        int port = u.getPort();
        if (port < 0 && scheme.equals("http")) port = 4243;
        return scheme + "://" + host + (port > 0 ? ":" + port : "");
    }

    private static int portOf(Uri u) {
        if (u.getPort() > 0) return u.getPort();
        return "https".equalsIgnoreCase(u.getScheme()) ? 443 : 80;
    }

    private boolean sameServer(Uri u) {
        if (serverUrl == null || u == null) return false;
        Uri s = Uri.parse(serverUrl);
        return s.getScheme() != null && s.getScheme().equalsIgnoreCase(u.getScheme())
                && s.getHost() != null && s.getHost().equalsIgnoreCase(u.getHost())
                && portOf(s) == portOf(u);
    }

    // ---------------------------------------------------------------- écrans natifs

    private TextView text(String value, int sp, int color, boolean bold, int gravity) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(sp);
        t.setTextColor(color);
        t.setGravity(gravity);
        t.setLineSpacing(0, 1.25f);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private Button button(String label, boolean primary, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(16);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(primary ? 0xFF1A1305 : FG);
        GradientDrawable shape = new GradientDrawable();
        shape.setCornerRadius(dp(28));
        shape.setColor(primary ? ACCENT : FIELD);
        b.setBackground(shape);
        b.setOnClickListener(onClick);
        return b;
    }

    private LinearLayout.LayoutParams stack(int topDp) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        p.topMargin = dp(topDp);
        return p;
    }

    private void setOverlay(View view, boolean setup) {
        removeOverlay();
        overlay = view;
        overlayIsSetup = setup;
        overlayIsLoading = false;
        root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void removeOverlay() {
        if (overlay != null) {
            root.removeView(overlay);
            overlay = null;
        }
    }

    private LinearLayout column() {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        col.setPadding(dp(24), dp(56), dp(24), dp(32));
        return col;
    }

    private void showSetup(String error) {
        handler.removeCallbacks(timeout);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);
        LinearLayout col = column();

        col.addView(text("Spotifree", 32, FG, true, Gravity.CENTER_HORIZONTAL));
        col.addView(text("Écoute la musique de ton PC sur ton téléphone.", 16, MUTED, false, Gravity.CENTER_HORIZONTAL), stack(8));
        col.addView(text("Adresse de ton PC", 15, FG, true, Gravity.START), stack(36));

        final EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint("100.x.x.x  ou  mon-pc.xxxx.ts.net");
        input.setHintTextColor(0xFF6E6B65);
        input.setTextColor(FG);
        input.setTextSize(17);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setImeOptions(EditorInfo.IME_ACTION_GO);
        input.setPadding(dp(16), dp(14), dp(16), dp(14));
        GradientDrawable fieldShape = new GradientDrawable();
        fieldShape.setCornerRadius(dp(14));
        fieldShape.setColor(FIELD);
        fieldShape.setStroke(dp(1), 0xFF2A2F3A);
        input.setBackground(fieldShape);
        if (serverUrl != null) input.setText(serverUrl);
        col.addView(input, stack(8));

        final TextView message = text(error == null ? "" : error, 14, ERROR, false, Gravity.START);
        col.addView(message, stack(8));

        final View.OnClickListener connect = v -> {
            String url = normalize(input.getText().toString());
            if (url == null) {
                message.setText("Cette adresse n'est pas valable. Exemple : 100.64.1.2");
                return;
            }
            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) imm.hideSoftInputFromWindow(input.getWindowToken(), 0);
            serverUrl = url;
            serverOrigin = url;
            prefs().edit().putString(KEY_URL, url).apply();
            openServer();
        };
        input.setOnEditorActionListener((v, actionId, event) -> {
            connect.onClick(v);
            return true;
        });
        col.addView(button("Se connecter", true, connect), stack(8));

        if (serverUrl != null) {
            col.addView(button("Annuler", false, v -> removeOverlay()), stack(10));
        }

        col.addView(text(
                "Où trouver cette adresse ?\n"
                        + "Sur le PC, ouvre Spotifree Serveur, puis Appareils > Ajouter un téléphone ou un autre appareil. Choisis l'adresse « Tailscale » : "
                        + "elle commence par 100. (le port 4243 est ajouté tout seul). "
                        + "Avec « tailscale serve », tu peux aussi saisir l'adresse https:// complète.\n\n"
                        + "Le téléphone et le serveur doivent tous les deux avoir Tailscale activé. "
                        + "Ensuite, connecte-toi avec ton adresse e-mail et ton mot de passe (ou crée ton compte).",
                14, MUTED, false, Gravity.START), stack(28));
        col.addView(text("Version " + Updater.installedName(this), 12, MUTED, false, Gravity.CENTER_HORIZONTAL), stack(24));

        scroll.addView(col, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setOverlay(scroll, true);
    }

    private void showLoading() {
        handler.removeCallbacks(timeout);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER);
        col.setBackgroundColor(BG);
        col.setPadding(dp(24), dp(24), dp(24), dp(24));
        ProgressBar bar = new ProgressBar(this);
        bar.setIndeterminate(true);
        col.addView(bar, new LinearLayout.LayoutParams(dp(48), dp(48)));
        col.addView(text("Connexion à ton PC…", 16, MUTED, false, Gravity.CENTER_HORIZONTAL), stack(16));
        col.addView(button("Changer l'adresse", false, v -> {
            handler.removeCallbacks(timeout);
            showSetup(null);
        }), stack(32));
        setOverlay(col, false);
        overlayIsLoading = true;
        handler.postDelayed(timeout, 20000);
    }

    private void showError(String detail) {
        handler.removeCallbacks(timeout);
        if (web != null) web.stopLoading();
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);
        LinearLayout col = column();
        col.setGravity(Gravity.CENTER);
        col.addView(text("Impossible de joindre ton PC", 22, FG, true, Gravity.CENTER_HORIZONTAL));
        col.addView(text(detail, 15, ERROR, false, Gravity.START), stack(12));
        col.addView(text(
                "Vérifie que :\n"
                        + "• le PC est allumé et Spotifree est lancé (version 0.9 ou plus) ;\n"
                        + "• l'accès depuis les autres appareils est activé dans Spotifree Serveur > Appareils ;\n"
                        + "• Tailscale est activé sur ton téléphone et sur ton PC ;\n"
                        + "• l'adresse est correcte :\n" + serverUrl,
                15, MUTED, false, Gravity.START), stack(16));
        col.addView(button("Réessayer", true, v -> openServer()), stack(24));
        col.addView(button("Changer l'adresse", false, v -> showSetup(null)), stack(10));
        scroll.addView(col, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setOverlay(scroll, false);
    }

    // ---------------------------------------------------------------- WebView

    private void openServer() {
        if (web == null) createWebView();
        showLoading();
        web.loadUrl(serverUrl + "/");
    }

    private void createWebView() {
        web = new WebView(this);
        web.setBackgroundColor(BG);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " SpotifreeApp/1");
        CookieManager.getInstance().setAcceptCookie(true);
        web.addJavascriptInterface(new Bridge(), "SpotifreeAndroid");
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                // Une demande précédente restée sans réponse est annulée.
                if (filePicker != null) filePicker.onReceiveValue(null);
                filePicker = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("audio/*");
                pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params != null && params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(Intent.createChooser(pick, "Choisir de la musique"), REQ_PICK_AUDIO);
                } catch (Exception e) {
                    filePicker = null;
                    callback.onReceiveValue(null);
                    return false;
                }
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (sameServer(u)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {
                    // Aucune application pour ouvrir ce lien.
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError("Connexion impossible : " + error.getDescription());
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) {
                    showError("Le PC a répondu par une erreur (code " + response.getStatusCode() + ").");
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                if (overlayIsLoading) {
                    handler.removeCallbacks(timeout);
                    removeOverlay();
                }
            }
        });
        root.addView(web, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    /** Appelé depuis le service quand on touche la notification ou l'écran verrouillé. */
    static void sendCommand(final String command, final Double value) {
        WeakReference<MainActivity> ref = current;
        final MainActivity a = ref == null ? null : ref.get();
        if (a == null) return;
        a.runOnUiThread(() -> {
            if (a.web == null) return;
            String arg = value == null ? "" : "," + value;
            a.web.evaluateJavascript("window.__mbNative&&window.__mbNative.command('" + command + "'" + arg + ")", null);
        });
    }

    @SuppressWarnings("deprecation")
    private void applyBars(String color, boolean light) {
        try {
            int c = Color.parseColor(color);
            getWindow().setStatusBarColor(c);
            getWindow().setNavigationBarColor(c);
            root.setBackgroundColor(c);
            if (web != null) web.setBackgroundColor(c);
            int flags = 0;
            if (light) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            getWindow().getDecorView().setSystemUiVisibility(flags);
        } catch (IllegalArgumentException ignored) {
            // Couleur illisible : les barres gardent leur teinte.
        }
    }

    /** Ce que la page peut demander à l'application (la page est toujours celle de ton PC). */
    public class Bridge {
        @JavascriptInterface
        public void update(String title, String artist, String album, String artwork, boolean playing, long positionMs, long durationMs) {
            PlaybackService.post(MainActivity.this, new PlaybackService.State(title, artist, album, artwork, playing, positionMs, durationMs));
        }

        @JavascriptInterface
        public void stop() {
            PlaybackService.halt();
        }

        /** Colore la barre d'état et la barre de navigation comme le thème choisi dans l'application. */
        @JavascriptInterface
        public void setBars(final String color, final boolean light) {
            runOnUiThread(() -> applyBars(color, light));
        }

        @JavascriptInterface
        public void changeServer() {
            runOnUiThread(() -> showSetup(null));
        }
    }

    // ---------------------------------------------------------------- cycle de vie

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_PICK_AUDIO || filePicker == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                result = new Uri[n];
                for (int i = 0; i < n; i++) result[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                result = new Uri[] { data.getData() };
            }
        }
        filePicker.onReceiveValue(result);
        filePicker = null;
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (overlay != null) {
            if (overlayIsSetup && serverUrl != null && web != null) {
                removeOverlay();
            } else {
                moveTaskToBack(true);
            }
            return;
        }
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            // La musique continue : on met seulement l'application en arrière-plan.
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(timeout);
        WeakReference<MainActivity> ref = current;
        if (ref != null && ref.get() == this) current = null;
        if (isFinishing()) PlaybackService.halt();
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
