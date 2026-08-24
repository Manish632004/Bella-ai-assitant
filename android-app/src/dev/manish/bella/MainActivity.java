package dev.manish.bella;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.http.SslError;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.InputStream;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {

    private static final int REQ_CAMERA = 41;
    private static final int REQ_MIC = 42;
    private static final int REQ_POSTNOTIF = 43;
    private static final int REQ_FILE = 44;

    private static final Pattern LINK_URL =
            Pattern.compile("^(https?)://([\\w.-]+|\\d{1,3}(\\.\\d{1,3}){3})(?::(\\d+))?/api/phone/link\\?t=([A-Za-z0-9]+)$");

    private LinearLayout connectScreen;
    private TextView status;
    private EditText manualBase, manualToken;
    private ScannerView scanner;
    private WebView web;

    private String pendingToken, pendingHost, pendingPort;
    private java.security.PublicKey caPublicKey;

    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        loadEmbeddedCa();
        buildConnectScreen();
        setContentView(connectScreen);

        if (Prefs.isConnected(this)) {
            enterApp();
        } else {
            setStatus("Scan the QR shown by BELLA on your PC.\n(Settings → Phone Link)", false);
        }

        handleShare(getIntent());
        askRuntimePerms();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleShare(intent);
    }

    // ------------------------------------------------------------------ UI --

    private void buildConnectScreen() {
        connectScreen = new LinearLayout(this);
        connectScreen.setOrientation(LinearLayout.VERTICAL);
        connectScreen.setBackgroundColor(Color.parseColor("#0a0e1a"));
        int pad = dp(24);
        connectScreen.setPadding(pad, pad * 2, pad, pad);

        TextView logo = new TextView(this);
        logo.setText("🔔");
        logo.setTextSize(52);
        logo.setGravity(Gravity.CENTER);

        TextView title = new TextView(this);
        title.setText("BELLA");
        title.setTextSize(30);
        title.setTextColor(Color.WHITE);
        title.setGravity(Gravity.CENTER);

        status = new TextView(this);
        status.setTextColor(Color.parseColor("#8b95b3"));
        status.setTextSize(15);
        status.setGravity(Gravity.CENTER);
        status.setLineSpacing(dp(2), 1f);

        Button scan = new Button(this);
        scan.setText("📷  Scan QR to connect");
        scan.setTextColor(Color.WHITE);
        scan.getBackground().setColorFilter(Color.parseColor("#5b6cff"),
                android.graphics.PorterDuff.Mode.SRC_ATOP);
        scan.setOnClickListener(v -> startScan());

        manualBase = new EditText(this);
        manualBase.setHint("or PC address e.g. 192.168.1.10");
        styleInput(manualBase);

        manualToken = new EditText(this);
        manualToken.setHint("pairing code (under the QR)");
        styleInput(manualToken);

        Button manualGo = new Button(this);
        manualGo.setText("Connect manually");
        manualGo.setTextColor(Color.WHITE);
        manualGo.getBackground().setColorFilter(Color.parseColor("#232c4d"),
                android.graphics.PorterDuff.Mode.SRC_ATOP);
        manualGo.setOnClickListener(v -> {
            String host = manualBase.getText().toString().trim()
                    .replaceFirst("^https?://", "").replace("/api/phone/link", "");
            String token = manualToken.getText().toString().trim();
            if (!host.matches("[\\w.-]+(:\\d+)?") || token.isEmpty()) {
                setStatus("Enter a plain IP/address and the pairing code.", true);
                return;
            }
            String[] parts = host.split(":");
            register(parts[0], parts.length > 1 ? parts[1] : null, token);
        });

        connectScreen.addView(logo);
        connectScreen.addView(title);
        connectScreen.addView(status);
        connectScreen.addView(scan, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(54)));
        connectScreen.addView(spacer(18));
        TextView small = new TextView(this);
        small.setText("Manual setup");
        small.setTextColor(Color.parseColor("#8b95b3"));
        small.setTextSize(12);
        connectScreen.addView(small);
        connectScreen.addView(manualBase);
        connectScreen.addView(manualToken);
        connectScreen.addView(manualGo, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(50)));
        connectScreen.addView(spacer(14));
        TextView notifHint = new TextView(this);
        notifHint.setText("Tip: enable BELLA in Settings → Notification access\nso I can read your phone's notifications.");
        notifHint.setTextColor(Color.parseColor("#54607f"));
        notifHint.setTextSize(11.5f);
        notifHint.setGravity(Gravity.CENTER);
        notifHint.setOnClickListener(v ->
                startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        connectScreen.addView(notifHint);
    }

    private View spacer(int h) {
        View v = new View(this);
        v.setLayoutParams(new LinearLayout.LayoutParams(1, h));
        return v;
    }

    private void styleInput(EditText e) {
        e.setTextColor(Color.WHITE);
        e.setHintTextColor(Color.parseColor("#54607f"));
        e.setBackgroundTintList(android.content.res.ColorStateList.valueOf(
                Color.parseColor("#2a3557")));
    }

    private void setStatus(String s, boolean error) {
        runOnUiThread(() -> status.setText(error ? "⚠️ " + s : s));
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    // -------------------------------------------------------------- pairing --

    private void startScan() {
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
            return;
        }
        showScanner();
    }

    private void showScanner() {
        scanner = new ScannerView(this);
        addContentView(scanner, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        scanner.start(this, text -> {
            removeScanner();
            if (text == null || !onQrScanned(text.trim())) {
                setStatus("That wasn't a BELLA QR — scan the one under Settings → Phone Link.", true);
            }
        });
    }

    private void removeScanner() {
        if (scanner != null) {
            scanner.stop();
            ((ViewGroup) scanner.getParent()).removeView(scanner);
            scanner = null;
        }
    }

    /** @return true when the string parsed as a BELLA pair link. */
    private boolean onQrScanned(String text) {
        Matcher m = LINK_URL.matcher(text);
        if (!m.find()) return false;
        register(m.group(2), m.group(4), m.group(5));
        return true;
    }

    /** Try HTTPS :4443 first (mic/push/geo unlocked inside our own TLS), fall back to HTTP. */
    private void register(String host, String port, String token) {
        pendingHost = host;
        pendingPort = port;
        pendingToken = token;
        setStatus("Connecting to " + host + " …", false);

        new Thread(() -> {
            String name = Build.MANUFACTURER + " " + Build.MODEL;
            JSONObject body = new JSONObject();
            try {
                body.put("pairToken", token == null ? "" : token).put("name", name);
            } catch (Exception ignored) {}

            String[] candidates;
            if (port != null && !"3000".equals(port)) {
                candidates = new String[]{"https://" + host + ":" + port,
                        "http://" + host + ":" + port};
            } else if (port != null) {
                candidates = new String[]{"https://" + host + ":4443",
                        "http://" + host + ":" + port};
            } else {
                candidates = new String[]{"https://" + host + ":4443",
                        "http://" + host + ":3000"};
            }

            Net.Resp ok = null;
            String usedBase = null;
            for (String base : candidates) {
                Net.Resp r = Net.post(base + "/api/phone/register", body);
                if (r.code == 200) {
                    JSONObject j = r.json();
                    if (!j.optString("deviceId").isEmpty()) {
                        Prefs.saveConnection(this, base,
                                j.optString("deviceId"), j.optString("token"));
                        usedBase = base;
                        ok = r;
                        break;
                    }
                } else if (r.code == 403) {
                    ui.post(() -> setStatus("Wrong pairing code — get the fresh one from the PC.", true));
                    return;
                }
            }

            if (ok != null) {
                final String pairedBase = usedBase;
                ui.post(() -> {
                    Toast.makeText(this, "Paired ✓ (" + pairedBase + ")", Toast.LENGTH_SHORT).show();
                    enterApp();
                });
            } else if (!isFinishing()) {
                ui.post(() -> setStatus(
                        "Couldn't reach " + host + ". Check both devices are on the same Wi-Fi.",
                        true));
            }
        }, "bella-pair").start();
    }

    // --------------------------------------------------------------- webapp --

    private void enterApp() {
        DeviceService.start(this);
        nudgeNotificationAccess();

        String url = Prefs.base(this) + "/api/phone/app?"
                + Prefs.authQuery(this)
                + "&name=" + Prefs.urlEnc(Build.MANUFACTURER + " " + Build.MODEL)
                + "&native=1";

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        root.addView(buildWebView(url), new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        connectScreen = null;
    }

    private WebView buildWebView(String url) {
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " BellaNative/1.0");
        CookieManager.getInstance().setAcceptCookie(true);

        // NOTE: named classes, not anonymous — see DeviceService note re d8.
        web.setWebChromeClient(new BellaChromeClient());
        web.setWebViewClient(new BellaWebViewClient(Prefs.base(this)));

        web.loadUrl(url);
        return web;
    }

    private String hostOf(String base) {
        return base.replaceAll("^https?://", "").split(":")[0];
    }

    private final class BellaChromeClient extends WebChromeClient {
        @Override public void onPermissionRequest(final PermissionRequest request) {
            runOnUiThread(() -> {
                try { request.grant(request.getResources()); } catch (Exception ignored) {}
            });
        }
        @Override public void onGeolocationPermissionsShowPrompt(String origin,
                GeolocationPermissions.Callback cb) {
            cb.invoke(origin, true, false);
        }
        // NOTE: no onShowFileChooser override — its signature references
        // WebChromeClient$FileChooserParams and that trips an r8/d8 bug when
        // compiled by modern JDK javac. Photo/file upload still works from the
        // PWA in a browser; native share covers the common case in the APK.
    }

    private final class BellaWebViewClient extends WebViewClient {
        private final String myBase;
        BellaWebViewClient(String base) { myBase = base; }

        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            String scheme = u.getScheme() == null ? "" : u.getScheme();
            if (scheme.equals("http") || scheme.equals("https")) {
                return !(u.getHost() + "").contains(hostOf(myBase));
            }
            try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
            return true;
        }

        @Override
        public void onReceivedSslError(WebView view,
                android.webkit.SslErrorHandler handler, SslError error) {
            // Accept ONLY certificates issued by BELLA's own embedded local
            // CA — anything else (rogue network hijacks etc.) stays blocked.
            if (caPublicKey != null && certMatches(error.getCertificate())) {
                handler.proceed();
            } else {
                handler.cancel();
            }
        }
    }

    private void loadEmbeddedCa() {
        try (InputStream in = getResources().openRawResource(R.raw.bella_ca)) {
            CertificateFactory cf = CertificateFactory.getInstance("X.509");
            Certificate ca = cf.generateCertificate(in);
            caPublicKey = ca.getPublicKey();
        } catch (Exception e) {
            caPublicKey = null;
        }
    }

    /** Unwraps the X509 behind an SslCertificate and verifies it against our CA. */
    private boolean certMatches(android.net.http.SslCertificate sc) {
        try {
            android.os.Bundle state = android.net.http.SslCertificate.saveState(sc);
            byte[] bytes = state.getByteArray("certificate");
            if (bytes == null) return false;
            CertificateFactory cf = CertificateFactory.getInstance("X.509");
            java.security.cert.X509Certificate cert =
                    (java.security.cert.X509Certificate) cf.generateCertificate(
                            new java.io.ByteArrayInputStream(bytes));
            cert.checkValidity();
            cert.verify(caPublicKey);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private boolean launchFileChooser(android.webkit.ValueCallback<Uri[]> cb,
            android.webkit.WebChromeClient.FileChooserParams params) {
        try {
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            fileCallback = cb;
            startActivityForResult(
                    Intent.createChooser(i, "Send to BELLA"), REQ_FILE);
            return true;
        } catch (Exception e) {
            cb.onReceiveValue(null);
            return false;
        }
    }

    private android.webkit.ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE && fileCallback != null) {
            Uri uri = data != null && data.getData() != null ? data.getData() : null;
            fileCallback.onReceiveValue(uri == null ? null : new Uri[]{uri});
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    // ------------------------------------------------------------- plumbing --

    private void askRuntimePerms() {
        java.util.List<String> need = new java.util.ArrayList<>();
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) need.add(Manifest.permission.RECORD_AUDIO);
        if (need.isEmpty()) return;
        requestPermissions(need.toArray(new String[0]), REQ_MIC);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == REQ_CAMERA) {
            boolean granted = results.length > 0
                    && results[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) showScanner();
            else setStatus("Camera permission is needed to scan the pairing QR.", true);
        }
    }

    private void handleShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        String title = intent.getStringExtra(Intent.EXTRA_TITLE);
        if (!Prefs.isConnected(this)) {
            Toast.makeText(this, "Pair with your PC first — then shares land instantly.",
                    Toast.LENGTH_LONG).show();
            return;
        }
        JSONObject body = new JSONObject();
        try {
            body.put("kind", "share").put("title", title == null ? "" : title)
                    .put("text", text == null ? "" : text);
            body.put("deviceId", Prefs.deviceId(this)).put("deviceToken", Prefs.deviceToken(this));
        } catch (Exception ignored) {}
        final String url = Prefs.eventUrl(this);
        new Thread(() -> Net.post(url, body), "bella-share").start();
        Toast.makeText(this, "Shared to BELLA ✓", Toast.LENGTH_SHORT).show();
    }

    private void nudgeNotificationAccess() {
        try {
            String enabled = Settings.Secure.getString(getContentResolver(),
                    "enabled_notification_listeners");
            if (enabled != null && enabled.contains(getPackageName())) return;
            new AlertDialog.Builder(this)
                    .setTitle("Read phone notifications?")
                    .setMessage("Let BELLA read this phone's notifications aloud on your PC "
                            + "(\"read my notifications\"). You can change this anytime.")
                    .setPositiveButton("Open settings", (d, w) ->
                            startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)))
                    .setNegativeButton("Not now", null)
                    .show();
        } catch (Exception ignored) {}
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }
}
