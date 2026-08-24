package dev.manish.bella;

import android.app.Notification;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import org.json.JSONObject;

import java.util.ArrayDeque;

/**
 * Captures phone notifications so BELLA can read them aloud on the PC
 * ("read my phone notifications") and react live. Requires the user to grant
 * Notification Access once (Settings → Notification access → BELLA).
 */
public class NLService extends NotificationListenerService {

    private static final String TAG = "BellaNL";
    /** Last notifications seen (newest last): [appName, title, text]. */
    private static final ArrayDeque<String[]> RECENT = new ArrayDeque<>();

    public static synchronized String dumpRecent(int max) {
        StringBuilder sb = new StringBuilder();
        int n = 0;
        for (String[] item : RECENT) {
            if (++n > max) break;
            if (sb.length() > 0) sb.append("\n");
            sb.append(item[0]).append(": ").append(item[1]);
            if (!item[2].isEmpty()) sb.append(" — ").append(item[2]);
        }
        return sb.length() == 0 ? "No recent notifications." : sb.toString();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (sbn == null || getPackageName().equals(sbn.getPackageName())) return;
            Notification n = sbn.getNotification();
            if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;

            CharSequence titleCs = n.extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence textCs = n.extras.getCharSequence(Notification.EXTRA_TEXT);
            String title = titleCs == null ? "" : titleCs.toString();
            String text = textCs == null ? "" : textCs.toString();
            if (title.isEmpty() && text.isEmpty()) return;

            String app = sbn.getPackageName()
                    .replace("com.whatsapp", "WhatsApp")
                    .replace("com.android.messaging", "Messages")
                    .replace("com.google.android.apps.messaging", "Messages")
                    .replace("com.instagram.android", "Instagram")
                    .replace("com.google.android.gm", "Gmail")
                    .replace("com.google.android.youtube", "YouTube")
                    .replace("com.spotify.music", "Spotify")
                    .replace("com.android.dialer", "Phone")
                    .replace("com.android.systemui", "System");

            synchronized (RECENT) {
                RECENT.addLast(new String[]{app, title, text});
                while (RECENT.size() > 30) RECENT.removeFirst();
            }

            // Fire-and-forget push to the PC inbox.
            JSONObject body = new JSONObject();
            body.put("kind", "notification");
            body.put("app", app);
            body.put("title", title);
            body.put("text", text);
            final String url = Prefs.eventUrl(this);
            if (url != null) {
                new Thread(() -> Net.post(url, body), "bella-event").start();
            }
        } catch (Exception e) {
            Log.w(TAG, "onNotificationPosted", e);
        }
    }
}
