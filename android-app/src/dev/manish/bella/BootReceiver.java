package dev.manish.bella;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Relaunches the device link after a reboot when a pairing exists. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())
                && Prefs.isConnected(context)) {
            DeviceService.start(context);
        }
    }
}
