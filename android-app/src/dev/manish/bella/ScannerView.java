package dev.manish.bella;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Matrix;
import android.graphics.RectF;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.os.Handler;
import android.os.HandlerThread;
import android.view.Surface;
import android.view.TextureView;
import android.widget.FrameLayout;

import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.HybridBinarizer;

import java.util.Collections;
import java.util.EnumMap;
import java.util.Map;

/**
 * Full-screen camera preview + QR decode. Plain camera2 + zxing, no androidx.
 * NOTE: deliberately NO anonymous classes here — d8 (build-tools 34) crashes
 * on anonymous class files produced by modern JDK javac. Lambdas are fine.
 */
public class ScannerView extends FrameLayout {

    public interface OnResult { void onResult(String text); }

    private static final int PREVIEW_W = 1280, PREVIEW_H = 720;

    private final TextureView texture = new TextureView(getContext());
    private final MultiFormatReader reader = new MultiFormatReader();
    private final Map<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
    private CameraDevice camera;
    private CameraCaptureSession session;
    private CaptureRequest.Builder requestBuilder;
    private HandlerThread thread;
    private Handler handler;
    private boolean done;
    private long lastDecode;
    private OnResult callback;

    @SuppressLint("ViewConstructor")
    public ScannerView(Activity activity) {
        super(activity);
        setBackgroundColor(0xFF0A0E1A);
        addView(texture, new LayoutParams(
                LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
    }

    public void start(Activity activity, OnResult cb) {
        if (activity.checkSelfPermission("android.permission.CAMERA")
                != PackageManager.PERMISSION_GRANTED) return;
        callback = cb;
        reader.setHints(hints);
        thread = new HandlerThread("bella-scan");
        thread.start();
        handler = new Handler(thread.getLooper());

        texture.setSurfaceTextureListener(new SurfaceListener());
        handler.postDelayed(new Ticker(), 400);
    }

    private final class Ticker implements Runnable {
        @Override public void run() {
            if (done) return;
            long now = System.currentTimeMillis();
            if (texture.isAvailable() && now - lastDecode > 350) {
                lastDecode = now;
                decodeFrame();
            }
            handler.postDelayed(this, 120);
        }
    }

    private final class SurfaceListener implements TextureView.SurfaceTextureListener {
        @Override public void onSurfaceTextureAvailable(SurfaceTexture st, int w, int h) {
            openCamera(st);
        }
        @Override public void onSurfaceTextureSizeChanged(SurfaceTexture s, int x, int y) {}
        @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture s) { return true; }
        @Override public void onSurfaceTextureUpdated(SurfaceTexture s) {}
    }

    private void openCamera(SurfaceTexture st) {
        try {
            CameraManager cm = (CameraManager)
                    getContext().getSystemService(Context.CAMERA_SERVICE);
            String backId = null;
            for (String id : cm.getCameraIdList()) {
                Integer facing = cm.getCameraCharacteristics(id)
                        .get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    backId = id;
                    break;
                }
            }
            if (backId == null && cm.getCameraIdList().length > 0) {
                backId = cm.getCameraIdList()[0];
            }
            if (backId == null) return;

            st.setDefaultBufferSize(PREVIEW_W, PREVIEW_H);
            cm.openCamera(backId, new OpenCallback(st), handler);
        } catch (Exception ignored) {}
    }

    private final class OpenCallback extends CameraDevice.StateCallback {
        private final SurfaceTexture st;
        OpenCallback(SurfaceTexture st) { this.st = st; }

        @Override public void onOpened(CameraDevice cam) {
            camera = cam;
            try {
                Surface surface = new Surface(st);
                requestBuilder = cam.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                requestBuilder.addTarget(surface);
                cam.createCaptureSession(Collections.singletonList(surface),
                        new SessionCallback(), handler);

                Matrix m = new Matrix();
                RectF src = new RectF(0, 0, PREVIEW_W, PREVIEW_H);
                RectF dst = new RectF(0, 0, getWidth(), getHeight());
                float scale = Math.max(dst.width() / src.width(),
                        dst.height() / src.height());
                m.setScale(scale, scale, getWidth() / 2f, getHeight() / 2f);
                texture.setTransform(m);
            } catch (Exception ignored) {}
        }
        @Override public void onDisconnected(CameraDevice cam) { cam.close(); }
        @Override public void onError(CameraDevice cam, int error) { cam.close(); }
    }

    private final class SessionCallback extends CameraCaptureSession.StateCallback {
        @Override public void onConfigured(CameraCaptureSession s) {
            session = s;
            try {
                requestBuilder.set(CaptureRequest.CONTROL_AF_MODE,
                        CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
                session.setRepeatingRequest(requestBuilder.build(), null, handler);
            } catch (Exception ignored) {}
        }
        @Override public void onConfigureFailed(CameraCaptureSession s) {}
    }

    /** Decode the current TextureView frame; fires callback once on success. */
    private void decodeFrame() {
        try {
            android.graphics.Bitmap bmp = texture.getBitmap(720, 720);
            if (bmp == null || done) return;
            int w = bmp.getWidth(), h = bmp.getHeight();
            int[] px = new int[w * h];
            bmp.getPixels(px, 0, w, 0, 0, w, h);
            byte[] lum = new byte[w * h];
            for (int i = 0; i < px.length; i++) {
                int c = px[i];
                lum[i] = (byte) (((c >> 16 & 0xFF) * 77
                        + (c >> 8 & 0xFF) * 150 + (c & 0xFF) * 29) >> 8);
            }
            // Center square crop — QRs get framed centrally.
            int side = Math.min(w, h);
            PlanarYUVLuminanceSource src = new PlanarYUVLuminanceSource(
                    lum, w, h, (w - side) / 2, (h - side) / 2, side, side, false);
            try {
                Result result = reader.decodeWithState(
                        new BinaryBitmap(new HybridBinarizer(src)));
                String text = result.getText();
                reader.reset();
                if (!done) {
                    done = true;
                    post(() -> { stop(); callback.onResult(text); });
                }
            } catch (Exception notFound) {
                reader.reset();
            }
        } catch (Exception ignored) {}
    }

    public void stop() {
        done = true;
        try {
            if (session != null) { session.close(); session = null; }
            if (camera != null) { camera.close(); camera = null; }
        } catch (Exception ignored) {}
        if (thread != null) { thread.quitSafely(); thread = null; }
        removeAllViews();
    }

    @Override protected void onDetachedFromWindow() { stop(); super.onDetachedFromWindow(); }
}
