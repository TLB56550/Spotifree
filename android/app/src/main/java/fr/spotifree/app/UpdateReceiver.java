package fr.spotifree.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.widget.Toast;

/** Reçoit le résultat de l'installateur Android : demande de confirmation, réussite ou échec. */
public class UpdateReceiver extends BroadcastReceiver {
    static final String ACTION = "fr.spotifree.app.INSTALL_RESULT";

    @Override
    @SuppressWarnings("deprecation")
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // Android demande à l'utilisateur de confirmer (et d'autoriser l'installation la première fois).
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(confirm);
            }
        } else if (status != PackageInstaller.STATUS_SUCCESS) {
            String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            Toast.makeText(context, "Mise à jour impossible : " + (message == null ? "erreur " + status : message), Toast.LENGTH_LONG).show();
        }
    }
}
