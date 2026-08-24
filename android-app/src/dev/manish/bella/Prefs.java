package dev.manish.bella;

import android.content.Context;
import android.content.SharedPreferences;

/** Tiny wrapper over the single prefs file holding the pairing state. */
final class Prefs {
    private static final String FILE = "bella";

    static SharedPreferences sp(Context c) {
        return c.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    static boolean isConnected(Context c) {
        SharedPreferences p = sp(c);
        return !p.getString("base", "").isEmpty()
                && !p.getString("deviceId", "").isEmpty()
                && !p.getString("deviceToken", "").isEmpty();
    }

    /** Base URL like https://192.168.1.10:4443 (no trailing slash). */
    static String base(Context c) { return sp(c).getString("base", ""); }

    static String deviceId(Context c) { return sp(c).getString("deviceId", ""); }
    static String deviceToken(Context c) { return sp(c).getString("deviceToken", ""); }

    static void saveConnection(Context c, String base, String id, String token) {
        sp(c).edit().putString("base", base)
                .putString("deviceId", id)
                .putString("deviceToken", token)
                .apply();
    }

    static void clear(Context c) {
        sp(c).edit().clear().apply();
    }

    static String authQuery(Context c) {
        return "deviceId=" + urlEnc(deviceId(c)) + "&deviceToken=" + urlEnc(deviceToken(c));
    }

    static String eventUrl(Context c) {
        return isConnected(c) ? base(c) + "/api/phone/device-event" : null;
    }

    static String urlEnc(String s) {
        try {
            return java.net.URLEncoder.encode(s == null ? "" : s, "UTF-8");
        } catch (Exception e) {
            return "";
        }
    }
}
