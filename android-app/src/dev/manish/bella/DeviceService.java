package dev.manish.bella;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

import org.json.JSONObject;

import java.util.List;

/**
 * Foreground service: polls the PC for device commands every few seconds and
 * executes them — this is how desktop BELLA controls the phone (open apps,
 * read notifications, ring, locate, battery) and pushes notes that land as
 * real Android notifications even with the app closed.
 */
public class DeviceService extends Service {

    private static final String TAG = "BellaDevice";
    private static final String CHANNEL_SERVICE = "bella_service";
    private static final String CHANNEL_ALERTS = "bella_alerts";
    private static final long POLL_MS = 4000;

    private HandlerThread thread;
    private Handler worker;
    private Ringtone ringing;
    private Vibrator vibrating;

    public static void start(Context c) {
        Intent i = new Intent(c, DeviceService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
            else c.startService(i);
        } catch (Exception e) {
            Log.w(TAG, "start", e);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL_SERVICE,
                "BELLA link", NotificationManager.IMPORTANCE_MIN));
        NotificationChannel alerts = new NotificationChannel(CHANNEL_ALERTS,
                "From BELLA", NotificationManager.IMPORTANCE_HIGH);
        alerts.enableVibration(true);
        nm.createNotificationChannel(alerts);

        Notification n = new Notification.Builder(this, CHANNEL_SERVICE)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("BELLA")
                .setContentText("Connected to your PC")
                .setOngoing(true)
                .build();
        try {
            startForeground(1, n);
        } catch (Exception e) {
            Log.w(TAG, "startForeground", e);
        }

        thread = new HandlerThread("bella-device");
        thread.start();
        worker = new Handler(thread.getLooper());
        // NOTE: no anonymous classes anywhere in the app — d8 (build-tools 34)
        // crashes on javac-23 anonymous class files. Lambdas/method refs are fine.
        worker.post(this::pollCycle);
    }

    private void pollCycle() {
        long next = POLL_MS;
        if (!Prefs.isConnected(this)) next = 15000;
        else {
            try {
                Net.Resp r = Net.get(Prefs.base(this)
                        + "/api/phone/device-poll?" + Prefs.authQuery(this));
                if (r.code == 200 && !r.body.isEmpty()) {
                    JSONObject cmd = new JSONObject(r.body);
                    execute(cmd.optString("id"), cmd.optString("type"),
                            cmd.optJSONObject("params") == null
                                    ? new JSONObject() : cmd.optJSONObject("params"));
                }
            } catch (Exception e) {
                Log.d(TAG, "poll: " + e.getMessage());
                next = POLL_MS * 3;
            }
        }
        worker.postDelayed(this::pollCycle, next);
    }

    private void execute(String id, String type, JSONObject params) {
        String result;
        switch (type) {
            case "notify":
                result = showAlert(params.optString("text", ""));
                break;
            case "openApp":
                result = openApp(params.optString("query", ""));
                break;
            case "readNotifications":
                result = NLService.dumpRecent(10);
                break;
            case "ring":
                result = ring((int) params.optDouble("seconds", 20));
                break;
            case "locate":
                result = reportLocation();
                break;
            case "battery":
                result = reportBattery();
                break;
            default:
                result = "Unknown command: " + type;
        }
        final String out = result;
        worker.post(() -> {
            JSONObject body = new JSONObject();
            try { body.put("id", id).put("result", out == null ? "" : out); } catch (Exception ignored) {}
            Net.post(Prefs.base(DeviceService.this) + "/api/phone/device-result", body);
        });
    }

    // ---- command implementations -------------------------------------------

    private String showAlert(String text) {
        Notification n = new Notification.Builder(this, CHANNEL_ALERTS)
                .setSmallIcon(android.R.drawable.ic_dialog_email)
                .setContentTitle("BELLA")
                .setContentText(text.isEmpty() ? "(empty note)" : text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .build();
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE))
                .notify((int) System.currentTimeMillis(), n);
        return "Notification shown on phone.";
    }

    private String openApp(String query) {
        if (query.isEmpty()) return "No app name given.";
        PackageManager pm = getPackageManager();
        Intent launch = pm.getLaunchIntentForPackage(query);
        if (launch == null) {
            Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> all = pm.queryIntentActivities(main, 0);
            String q = query.toLowerCase().replace(" ", "");
            for (ResolveInfo info : all) {
                String label = String.valueOf(info.loadLabel(pm)).toLowerCase().replace(" ", "");
                String pkg = info.activityInfo.packageName.toLowerCase();
                if (label.contains(q) || q.contains(label) || pkg.contains(q)) {
                    launch = pm.getLaunchIntentForPackage(info.activityInfo.packageName);
                    if (launch != null) break;
                }
            }
        }
        if (launch == null) return "Couldn't find an app called '" + query + "'.";
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(launch);
        return "Opened " + query + ".";
    }

    private String ring(int seconds) {
        try {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            am.setStreamVolume(AudioManager.STREAM_MUSIC,
                    am.getStreamMaxVolume(AudioManager.STREAM_MUSIC), 0);
            Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            ringing = RingtoneManager.getRingtone(this, uri);
            ringing.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM).build());
            ringing.play();
            vibrating = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (vibrating != null && vibrating.hasVibrator()) {
                vibrating.vibrate(VibrationEffect.createWaveform(
                        new long[]{0, 600, 400}, 0));
            }
            int secs = Math.max(5, seconds);
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                if (ringing != null) ringing.stop();
                if (vibrating != null) vibrating.cancel();
            }, secs * 1000L);
            return "Ringing for " + secs + "s at max volume.";
        } catch (Exception e) {
            return "Ring failed: " + e.getMessage();
        }
    }

    private String reportLocation() {
        try {
            android.location.LocationManager lm =
                    (android.location.LocationManager) getSystemService(LOCATION_SERVICE);
            android.location.Location best = null;
            for (String p : new String[]{"gps", "network", "passive"}) {
                try {
                    android.location.Location l = lm.getLastKnownLocation(p);
                    if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
                } catch (SecurityException ignored) {}
            }
            if (best == null) return "No location available yet.";
            JSONObject body = new JSONObject();
            body.put("lat", best.getLatitude()).put("lng", best.getLongitude())
                    .put("acc", best.getAccuracy());
            body.put("deviceId", Prefs.deviceId(this)).put("deviceToken", Prefs.deviceToken(this));
            final String url = Prefs.base(this) + "/api/phone/location";
            new Thread(() -> Net.post(url, body), "bella-geo").start();
            return String.format("Location %.5f, %.5f (+-%dm)",
                    best.getLatitude(), best.getLongitude(), (int) best.getAccuracy());
        } catch (Exception e) {
            return "Locate failed: " + e.getMessage();
        }
    }

    private String reportBattery() {
        try {
            Intent i = registerReceiver(null,
                    new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            int level = i == null ? -1 : i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = i == null ? 100 : i.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
            int pct = Math.round(level * 100f / Math.max(1, scale));
            int status = i == null ? 0 : i.getIntExtra(BatteryManager.EXTRA_STATUS, 0);
            boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING
                    || status == BatteryManager.BATTERY_STATUS_FULL;

            JSONObject body = new JSONObject();
            body.put("battery", pct).put("charging", charging);
            body.put("deviceId", Prefs.deviceId(this)).put("deviceToken", Prefs.deviceToken(this));
            final String url = Prefs.base(this) + "/api/phone/device-status";
            new Thread(() -> Net.post(url, body), "bella-bat").start();
            return "Battery " + pct + "%" + (charging ? ", charging" : "");
        } catch (Exception e) {
            return "Battery read failed.";
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (thread != null) thread.quitSafely();
        super.onDestroy();
    }

    @Override
    public android.os.IBinder onBind(Intent intent) { return null; }
}
