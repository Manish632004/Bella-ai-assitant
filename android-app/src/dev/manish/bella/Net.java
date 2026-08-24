package dev.manish.bella;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import org.json.JSONObject;

/** Minimal HTTP helper — HttpURLConnection only, no external deps. */
final class Net {
    private Net() {}

    static class Resp {
        int code;
        String body;

        boolean ok() { return code >= 200 && code < 300; }
        JSONObject json() {
            try { return new JSONObject(body == null || body.isEmpty() ? "{}" : body); }
            catch (Exception e) { return new JSONObject(); }
        }
    }

    static Resp request(String url, String method, JSONObject body, int timeoutMs) {
        Resp r = new Resp();
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(timeoutMs);
            c.setReadTimeout(Math.max(timeoutMs, 8000));
            c.setRequestMethod(method);
            if (body != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] out = body.toString().getBytes(StandardCharsets.UTF_8);
                c.setFixedLengthStreamingMode(out.length);
                try (OutputStream os = c.getOutputStream()) { os.write(out); }
            }
            r.code = c.getResponseCode();
            InputStream is = r.code >= 400 ? c.getErrorStream() : c.getInputStream();
            StringBuilder sb = new StringBuilder();
            if (is != null) {
                try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line).append('\n');
                }
            }
            r.body = sb.toString().trim();
        } catch (Exception e) {
            r.code = -1;
            r.body = String.valueOf(e.getMessage());
        } finally {
            if (c != null) c.disconnect();
        }
        return r;
    }

    static Resp get(String url) { return request(url, "GET", null, 5000); }
    static Resp post(String url, JSONObject body) { return request(url, "POST", body, 6000); }
}
