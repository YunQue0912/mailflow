package sh.mailflow.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebSettings;

import android.webkit.WebView;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URLDecoder;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;

import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "MailFlowNative",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
        @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
    }
)
public class MailFlowNativePlugin extends Plugin {
    static final String ACTION_OPEN_MESSAGE = "sh.mailflow.app.OPEN_MESSAGE";
    static final String ACTION_REPLY_MESSAGE = "sh.mailflow.app.REPLY_MESSAGE";
    static final String ACTION_DELETE_MESSAGE = "sh.mailflow.app.DELETE_MESSAGE";
    static final String ACTION_STAR_MESSAGE = "sh.mailflow.app.STAR_MESSAGE";
    static final String ACTION_COMPOSE = "sh.mailflow.app.COMPOSE";
    static final String ACTION_SYNC = "sh.mailflow.app.SYNC";
    static final String ACTION_INSTALL_UPDATE = "sh.mailflow.app.INSTALL_UPDATE";
    private static final String EXTRA_INTENT_SECRET = "sh.mailflow.app.INTENT_SECRET";
    private static final String TAG = "MailFlowUpdater";
    private static final String CHANNEL_NEW_MAIL = "mailflow_new_mail";
    private static final String CHANNEL_UPDATES = "mailflow_updates";
    private static final String PREFS_NAME = "mailflow-native";
    private static final String PREF_HOST = "host";
    private static final String PREF_INTENT_SECRET = "intent_secret";
    private static final String PREF_UPDATE_APK_PATH = "update_apk_path";
    private static final String PREF_UPDATE_VERSION = "update_version";
    private static final String PREF_UPDATE_RELEASE_NAME = "update_release_name";
    private static final String PREF_UPDATE_SHA256 = "update_sha256";
    private static final String PREF_UPDATE_VERSION_CODE = "update_version_code";
    private static final String PREF_UPDATE_DIGEST = "update_digest";

    private static final String SETUP_URL = "file:///android_asset/public/index.html";
    private static final String UPDATE_RELEASE_URL = "https://api.github.com/repos/YunQue0912/mailflow/releases/latest";
    private static final int MAX_JSON_BYTES = 1024 * 1024;
    private static final long MAX_APK_BYTES = 250L * 1024L * 1024L;
    private static final int MAX_REDIRECTS = 5;
    private static final List<JSObject> pendingActions = new ArrayList<>();
    private static MailFlowNativePlugin instance;
    private volatile ReleaseInfo updateInfo = null;
    private volatile File downloadedUpdate = null;
    private final AtomicBoolean updateCheckStarted = new AtomicBoolean(false);
    private final AtomicBoolean updateDownloadStarted = new AtomicBoolean(false);
    private boolean installPendingPermission = false;
    private final AtomicBoolean cancelUpdateDownload = new AtomicBoolean(false);
    // Capacitor constructs the plugin before attaching its Bridge. Any field
    // initializer that calls getContext() makes reflection-based registration
    // fail and leaves every native update action unavailable. load() initializes
    // this state after the Bridge has been attached.
    private volatile JSObject lastUpdateStatus = null;

    @Override
    public void load() {
        instance = this;
        createNotificationChannel(getContext());
        restoreDownloadedUpdateState();
        lastUpdateStatus = downloadedUpdate != null && updateInfo != null
            ? updateStatus("downloaded", updateInfo.toStatusData())
            : updateStatus("idle");
    }

    @PluginMethod
    public void getHost(PluginCall call) {
        JSObject result = new JSObject();
        result.put("host", getSavedHost(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void saveHost(PluginCall call) {
        String host = call.getString("host", "");
        String normalizedHost = normalizeHost(host);

        if (normalizedHost == null) {
            call.reject("Public MailFlow hosts must use https://. HTTP is allowed only for localhost and private IP addresses.");
            return;
        }

        if (normalizedHost.startsWith("http://")) {
            if (getActivity() == null || getActivity().isFinishing()) {
                call.reject("The unencrypted MailFlow host could not be confirmed.");
                return;
            }
            getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity())
                .setTitle("Unencrypted MailFlow connection")
                .setMessage("Traffic to this MailFlow server is not encrypted. Your session cookie and email data can be read or changed by anyone who can observe this network. Continue only on a private network you trust.")
                .setPositiveButton("Use unencrypted connection", (dialog, which) -> persistHost(call, normalizedHost))
                .setNegativeButton("Cancel", (dialog, which) -> call.reject("The unencrypted MailFlow host was not saved."))
                .setOnCancelListener((dialog) -> call.reject("The unencrypted MailFlow host was not saved."))
                .show());
            return;
        }

        persistHost(call, normalizedHost);
    }

    private void persistHost(PluginCall call, String normalizedHost) {
        getPrefs(getContext()).edit().putString(PREF_HOST, normalizedHost).apply();
        if (getActivity() instanceof MainActivity) {
            ((MainActivity) getActivity()).configureNativeMessageBridge(normalizedHost);
        }

        MailFlowBackgroundSync.schedule(getContext());

        JSObject result = new JSObject();
        result.put("host", normalizedHost);
        call.resolve(result);
    }

    @PluginMethod
    public void resetHost(PluginCall call) {
        getPrefs(getContext()).edit().remove(PREF_HOST).apply();
        if (getActivity() instanceof MainActivity) {
            ((MainActivity) getActivity()).configureNativeMessageBridge(null);
        }
        getActivity().runOnUiThread(() -> getBridge().getWebView().loadUrl(SETUP_URL));
        call.resolve();
    }

    @PluginMethod
    public void setUnreadCount(PluginCall call) {
        Integer count = call.getInt("count");
        if (count != null) {
            MailFlowBackgroundWorker.updateUnreadBaseline(getContext(), count);
            MailFlowBackgroundSync.schedule(getContext());
        }
        call.resolve();
    }

    @PluginMethod
    public void downloadAttachment(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
            && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "attachmentStoragePermissionCallback");
            return;
        }
        enqueueAttachmentDownload(call);
    }

    private void enqueueAttachmentDownload(PluginCall call) {
        String url = call.getString("url", "");
        String configuredHost = getSavedHost(getContext());
        if (!AttachmentDownloadPolicy.isAllowed(configuredHost, url)) {
            call.reject("Attachment URL is not allowed");
            return;
        }

        String filename = AttachmentDownloadPolicy.safeFilename(call.getString("filename", "attachment"));
        String mimeType = call.getString("mimeType", "application/octet-stream");
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle(filename);
            request.setDescription("MailFlow attachment");
            request.setMimeType(mimeType);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
            request.addRequestHeader("User-Agent", WebSettings.getDefaultUserAgent(getContext()));

            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null && !cookies.trim().isEmpty()) {
                request.addRequestHeader("Cookie", cookies);
            }

            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) {
                call.reject("System download manager is unavailable");
                return;
            }

            long downloadId = manager.enqueue(request);
            JSObject result = new JSObject();
            result.put("started", true);
            result.put("id", downloadId);
            call.resolve(result);
        } catch (RuntimeException error) {
            Log.e(TAG, "Unable to queue attachment download", error);
            call.reject("Unable to start attachment download", error);
        }
    }

    @PluginMethod
    public void checkForUpdates(PluginCall call) {
        checkForUpdatesInBackground(Boolean.TRUE.equals(call.getBoolean("verbose")), call);
    }

    @PluginMethod
    public void getUpdateState(PluginCall call) {
        call.resolve(currentUpdateState());
    }

    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        call.resolve(beginUpdateDownload());
    }

    private JSObject beginUpdateDownload() {
        if (updateInfo == null || updateInfo.downloadUrl == null) {
            JSObject result = new JSObject();
            result.put("started", false);
            result.put("reason", "not-available");
            return result;
        }
        if (!updateDownloadStarted.compareAndSet(false, true)) {
            JSObject result = new JSObject();
            result.put("started", false);
            result.put("reason", "already-downloading");
            return result;
        }

        startUpdateDownload(updateInfo);
        JSObject result = new JSObject();
        result.put("started", true);
        return result;
    }

    @PluginMethod
    public void cancelUpdateDownload(PluginCall call) {
        call.resolve(cancelUpdateDownloadResult());
    }

    private JSObject cancelUpdateDownloadResult() {
        boolean downloading = updateDownloadStarted.get();
        if (downloading) cancelUpdateDownload.set(true);
        JSObject result = new JSObject();
        result.put("cancelled", downloading);
        return result;
    }

    private JSObject currentUpdateState() {
        JSObject status = lastUpdateStatus;
        if (status != null && status.has("currentVersion")) return status;
        return updateStatus("idle");
    }

    private JSObject beginUpdateCheck(boolean verbose) {
        checkForUpdatesInBackground(verbose, null);
        JSObject result = new JSObject();
        result.put("started", true);
        result.put("state", currentUpdateState());
        return result;
    }

    private void checkForUpdatesInBackground(boolean verbose, PluginCall call) {
        if (!updateCheckStarted.compareAndSet(false, true)) {
            if (call != null) {
                JSObject result = new JSObject();
                result.put("updateAvailable", false);
                result.put("skipped", true);
                call.resolve(result);
            }
            return;
        }

        JSObject checking = updateStatus("checking");
        checking.put("verbose", verbose);
        sendUpdateStatus(checking);

        new Thread(() -> {
            try {
                Log.i(TAG, "Checking for updates from " + UPDATE_RELEASE_URL);
                ReleaseInfo release = fetchLatestRelease();
                Log.i(TAG, "Latest release " + release.version + ", installed " + getInstalledVersion() + ", APK " + release.downloadUrl);
                if (!isNewerVersion(release.version, getInstalledVersion())) {
                    clearDownloadedUpdateState();
                    JSObject upToDate = updateStatus("up-to-date");
                    upToDate.put("verbose", verbose);
                    sendUpdateStatus(upToDate);

                    if (call != null) {
                        JSObject result = new JSObject();
                        result.put("updateAvailable", false);
                        call.resolve(result);
                    }
                    return;
                }

                if (release.downloadUrl == null) {
                    sendUpdateError("invalidRelease", verbose);
                    if (call != null) {
                        JSObject result = new JSObject();
                        result.put("updateAvailable", true);
                        result.put("downloadAvailable", false);
                        call.resolve(result);
                    }
                    return;
                }

                if (downloadedUpdate != null && downloadedUpdate.exists()
                    && updateInfo != null && release.version.equals(updateInfo.version)) {
                    try {
                        verifyDownloadedPackage(downloadedUpdate, release);
                        updateInfo = release;
                        persistDownloadedUpdateState(release, downloadedUpdate);
                        sendUpdateStatus(updateStatus("downloaded", release.toStatusData()));
                        if (call != null) {
                            JSObject result = new JSObject();
                            result.put("updateAvailable", true);
                            result.put("downloadAvailable", true);
                            result.put("downloaded", true);
                            call.resolve(result);
                        }
                        return;
                    } catch (Exception invalidDownload) {
                        Log.w(TAG, "Discarding an invalid persisted update APK", invalidDownload);
                        clearDownloadedUpdateState();
                    }
                } else if (downloadedUpdate != null) {
                    clearDownloadedUpdateState();
                }

                updateInfo = release;
                sendUpdateStatus(updateStatus("available", release.toStatusData()));

                if (call != null) {
                    JSObject result = new JSObject();
                    result.put("updateAvailable", true);
                    result.put("downloadAvailable", true);
                    call.resolve(result);
                }
            } catch (Exception error) {
                Log.e(TAG, "Update check failed", error);
                sendUpdateError("genericError", verbose);
                if (call != null) {
                    JSObject result = new JSObject();
                    result.put("updateAvailable", false);
                    result.put("error", "update-check-failed");
                    call.resolve(result);
                }
            } finally {
                updateCheckStarted.set(false);
            }
        }).start();
    }

    @PluginMethod
    public void installDownloadedUpdate(PluginCall call) {
        JSObject result = showUpdateReadyDialog();
        call.resolve(result);
    }

    @PluginMethod
    public void openDownloadedUpdate(PluginCall call) {
        JSObject result = showUpdateReadyDialog();
        call.resolve(result);
    }

    @PluginMethod
    public void openUpdateInBrowser(PluginCall call) {
        JSObject result = openUpdateReleasePage();
        if (result.optBoolean("opened", false)) {
            call.resolve(result);
        } else {
            call.reject("Could not open the verified Release page.");
        }
    }

    private JSObject openUpdateReleasePage() {
        JSObject result = new JSObject();
        String tag = updateInfo == null ? "" : updateInfo.version;
        if (parseVersion(tag) == null) tag = "";
        String url = tag.isEmpty()
            ? "https://github.com/YunQue0912/mailflow/releases"
            : "https://github.com/YunQue0912/mailflow/releases/tag/" + tag;
        try {
            getContext().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            result.put("opened", true);
            result.put("url", url);
        } catch (Exception error) {
            result.put("opened", false);
            result.put("reason", "unavailable");
        }
        return result;
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (hasNotificationPermission()) {
            call.resolve(notificationPermissionResult("granted"));
            return;
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            call.resolve(notificationPermissionResult("denied"));
            return;
        }

        requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
    }

    @PluginMethod
    public void checkNotificationPermission(PluginCall call) {
        call.resolve(notificationPermissionResult(getNotificationPermissionState()));
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            getContext().startActivity(intent);
        } catch (ActivityNotFoundException err) {
            Intent fallbackIntent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.parse("package:" + getContext().getPackageName()));
            fallbackIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(fallbackIntent);
        }

        call.resolve();
    }

    @PluginMethod
    public void showNewMail(PluginCall call) {
        String title = call.getString("title", "New mail");
        String body = call.getString("body", "You have new mail.");
        String messageId = call.getString("messageId", null);
        String accountId = call.getString("accountId", null);
        String folder = call.getString("folder", "INBOX");
        JSObject message = call.getObject("message");

        postNewMailNotification(getContext(), title, body, messageId, accountId, folder, message);
        call.resolve();
    }

    @SuppressLint("MissingPermission")
    static void postNewMailNotification(Context context, String title, String body, String messageId, String accountId, String folder, JSObject message) {
        if (!hasNotificationPermission(context)) return;

        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(ACTION_OPEN_MESSAGE);
        authenticateIntent(context, intent);
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        putExtra(intent, "messageId", messageId);
        putExtra(intent, "accountId", accountId);
        putExtra(intent, "folder", folder);
        if (message != null) putExtra(intent, "message", message.toString());

        int notificationId = Math.abs(UUID.randomUUID().hashCode());
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            notificationId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        PendingIntent replyPendingIntent = messageActionPendingIntent(
            context,
            notificationId,
            ACTION_REPLY_MESSAGE,
            messageId,
            accountId,
            folder,
            message
        );
        PendingIntent deletePendingIntent = messageActionPendingIntent(
            context,
            notificationId,
            ACTION_DELETE_MESSAGE,
            messageId,
            accountId,
            folder,
            message
        );
        PendingIntent starPendingIntent = messageActionPendingIntent(
            context,
            notificationId,
            ACTION_STAR_MESSAGE,
            messageId,
            accountId,
            folder,
            message
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_NEW_MAIL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pendingIntent)
            .addAction(R.mipmap.ic_launcher, "Reply", replyPendingIntent)
            .addAction(R.mipmap.ic_launcher, "Delete", deletePendingIntent)
            .addAction(R.mipmap.ic_launcher, "Star", starPendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);

        try {
            NotificationManagerCompat.from(context).notify(notificationId, builder.build());
        } catch (SecurityException ignored) {}
    }

    private static PendingIntent messageActionPendingIntent(Context context, int notificationId, String action, String messageId, String accountId, String folder, JSObject message) {
        boolean backgroundAction = ACTION_DELETE_MESSAGE.equals(action) || ACTION_STAR_MESSAGE.equals(action);
        Intent intent = new Intent(
            context,
            backgroundAction ? MailFlowNotificationActionReceiver.class : MainActivity.class
        );
        intent.setAction(action);
        authenticateIntent(context, intent);
        if (!backgroundAction) {
            intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        }
        intent.putExtra("notificationId", notificationId);
        putExtra(intent, "messageId", messageId);
        putExtra(intent, "accountId", accountId);
        putExtra(intent, "folder", folder);
        if (message != null) putExtra(intent, "message", message.toString());

        int requestCode = Math.abs((action + ":" + notificationId).hashCode());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return backgroundAction
            ? PendingIntent.getBroadcast(context, requestCode, intent, flags)
            : PendingIntent.getActivity(context, requestCode, intent, flags);
    }

    @PluginMethod
    public void getPendingActions(PluginCall call) {
        JSObject result = new JSObject();
        synchronized (pendingActions) {
            result.put("actions", new JSArray(new ArrayList<>(pendingActions)));
        }
        call.resolve(result);
    }

    @PluginMethod
    public void ackAction(PluginCall call) {
        String id = call.getString("id", null);
        if (id != null) {
            synchronized (pendingActions) {
                pendingActions.removeIf((action) -> id.equals(action.getString("id")));
            }
        }
        call.resolve();
    }

    static String getSavedHost(Context context) {
        return normalizeHost(getPrefs(context).getString(PREF_HOST, null));
    }

    static boolean isPrivilegedNativeAction(String action) {
        return ACTION_OPEN_MESSAGE.equals(action)
            || ACTION_REPLY_MESSAGE.equals(action)
            || ACTION_DELETE_MESSAGE.equals(action)
            || ACTION_STAR_MESSAGE.equals(action)
            || ACTION_COMPOSE.equals(action)
            || ACTION_SYNC.equals(action)
            || ACTION_INSTALL_UPDATE.equals(action);
    }

    static boolean isTrustedNativeIntent(Context context, Intent intent) {
        if (context == null || intent == null || !isPrivilegedNativeAction(intent.getAction())) {
            return false;
        }
        return NativeSecurity.secretsMatch(
            getIntentSecret(context),
            intent.getStringExtra(EXTRA_INTENT_SECRET)
        );
    }

    private static void authenticateIntent(Context context, Intent intent) {
        intent.putExtra(EXTRA_INTENT_SECRET, getIntentSecret(context));
    }

    private static String getIntentSecret(Context context) {
        SharedPreferences prefs = getPrefs(context);
        String existing = prefs.getString(PREF_INTENT_SECRET, null);
        if (existing != null && !existing.isEmpty()) return existing;

        String generated = UUID.randomUUID().toString();
        prefs.edit().putString(PREF_INTENT_SECRET, generated).apply();
        return generated;
    }

    static String saveHost(Context context, String host) {
        String normalizedHost = normalizeHost(host);
        if (normalizedHost == null) return null;

        // The WebView can navigate as soon as this method returns. Persist the
        // origin synchronously so the navigation policy sees it immediately.
        return getPrefs(context).edit().putString(PREF_HOST, normalizedHost).commit()
            ? normalizedHost
            : null;
    }

    static void injectPendingActions(WebView webView, Context context) {
        if (webView == null || context == null || !isConfiguredHost(context, webView.getUrl())) return;

        injectCapacitorCompat(webView);

        List<JSObject> actions;
        synchronized (pendingActions) {
            if (pendingActions.isEmpty()) return;
            actions = new ArrayList<>(pendingActions);
            pendingActions.clear();
        }

        String actionJson = new JSArray(actions).toString();
        String script = "(function(actions){"
            + "window.__mailflowPendingNativeActions=(window.__mailflowPendingNativeActions||[]).concat(actions);"
            + "var delivered=false;"
            + "var deliver=function(force){"
            + "if(delivered)return true;"
            + "if(!force&&window.__mailflowNativeBridgeReady!==true)return false;"
            + "delivered=true;"
            + "actions.forEach(function(payload){"
            + "window.dispatchEvent(new CustomEvent('mailflow:native-action',{detail:payload}));"
            + "});"
            + "window.dispatchEvent(new CustomEvent('mailflow:native-actions-ready'));"
            + "return true;"
            + "};"
            + "if(!deliver(false)){"
            + "var attempts=0;"
            + "var timer=window.setInterval(function(){attempts+=1;if(deliver(false)||attempts>=100){if(!delivered)deliver(true);window.clearInterval(timer);}},100);"
            + "}"
            + "})( " + actionJson + " );";

        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    static void injectCapacitorCompat(WebView webView) {
        if (webView == null) return;

        String script = "(function(){try{"
            + "window.Capacitor=window.Capacitor||{};"
            + "if(typeof window.Capacitor.triggerEvent!=='function'){"
            + "window.Capacitor.triggerEvent=function(eventName,target,eventData){"
            + "var receiver=target==='document'?document:window;"
            + "var event;"
            + "try{event=new CustomEvent(eventName,{detail:eventData});}"
            + "catch(e){event=document.createEvent('CustomEvent');event.initCustomEvent(eventName,false,false,eventData);}"
            + "receiver.dispatchEvent(event);"
            + "return true;"
            + "};"
            + "}"
            + "var androidBridge=window.MailFlowAndroid;"
            + "var nativeRequests=window.__mailflowAndroidRequests=window.__mailflowAndroidRequests||{};"
            + "if(androidBridge&&typeof androidBridge.postMessage==='function'){androidBridge.onmessage=function(event){try{var response=JSON.parse(event.data||'{}');var resolve=nativeRequests[response.id];if(!resolve)return;delete nativeRequests[response.id];resolve(response.result||null);}catch(e){}};}"
            + "var nativeCall=function(method,args,fallback){if(!androidBridge||typeof androidBridge.postMessage!=='function')return Promise.resolve(fallback||null);return new Promise(function(resolve){var id=String(Date.now())+Math.random();var timer=window.setTimeout(function(){delete nativeRequests[id];resolve(fallback||null);},5000);nativeRequests[id]=function(result){window.clearTimeout(timer);resolve(result);};try{androidBridge.postMessage(JSON.stringify({id:id,method:method,args:args||{}}));}catch(e){window.clearTimeout(timer);delete nativeRequests[id];resolve(fallback||null);}});};"
            + "var plugin=function(){return window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.MailFlowNative;};"
            + "var call=function(method,args,fallback){var p=plugin();if(!p||typeof p[method]!=='function')return Promise.resolve(fallback||null);return p[method](args||{}).catch(function(){return fallback||null;});};"
            + "var nativeOrPlugin=function(method,args,fallback){return nativeCall(method,args,null).then(function(result){return result&&result.reason!=='unavailable'?result:call(method,args,fallback);});};"
            + "window.mailflowNative=window.mailflowNative||{};"
            + "window.mailflowNative.platform='android';"
            + "window.mailflowNative.attachments=window.mailflowNative.attachments||{};"
            + "window.mailflowNative.attachments.download=function(options){return call('downloadAttachment',options||{}, {started:false,reason:'unavailable'});};"
            + "window.mailflowNative.updates=window.mailflowNative.updates||{};"
            + "window.mailflowNative.updates.getState=function(){return nativeOrPlugin(\'getUpdateState\',{}, {type:\'idle\'});};"
            + "window.mailflowNative.updates.check=function(verbose){return nativeOrPlugin(\'checkForUpdates\',{verbose:!!verbose},{started:false});};"
            + "window.mailflowNative.updates.download=function(){return nativeOrPlugin(\'downloadUpdate\',{}, {started:false,reason:\'unavailable\'});};"
            + "window.mailflowNative.updates.cancel=function(){return nativeOrPlugin(\'cancelUpdateDownload\',{}, {cancelled:false});};"
            + "window.mailflowNative.updates.installDownloaded=function(){return nativeOrPlugin(\'installDownloadedUpdate\',{}, {installed:false,reason:\'unavailable\'});};"

            + "window.mailflowNative.updates.installAuto=window.mailflowNative.updates.installDownloaded;"
            + "window.mailflowNative.updates.openDownload=function(){return nativeOrPlugin('openUpdateInBrowser',{}, {opened:false});};"
            + "window.mailflowNative.updates.onStatus=function(callback){if(typeof callback!=='function')return function(){};var handler=function(event){callback(event.detail);};window.addEventListener('mailflow:update-status',handler);return function(){window.removeEventListener('mailflow:update-status',handler);};};"
            + "window.mailflowNative.notifications=window.mailflowNative.notifications||{};"
            + "window.mailflowNative.notifications.showNewMail=function(notification){return nativeCall('showNewMail',notification||{},null).then(function(result){return result||call('showNewMail',notification||{});});};"
            + "window.mailflowNative.notifications.checkPermission=function(){return call('checkNotificationPermission',{},{}).then(function(result){return result&&result.permission||'default';});};"
            + "window.mailflowNative.notifications.requestPermission=function(){return call('requestNotificationPermission',{},{}).then(function(result){return result&&result.permission||'default';});};"
            + "window.mailflowNative.notifications.openSettings=function(){return call('openNotificationSettings',{});};"
            + "}catch(e){}})();";

        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    static void sendOpenMessageAction(Intent intent) {
        JSObject action = newAction("open-message");
        copyStringExtra(intent, action, "messageId");
        copyStringExtra(intent, action, "accountId");
        copyStringExtra(intent, action, "folder");

        String messageJson = intent.getStringExtra("message");
        if (messageJson != null) {
            try {
                action.put("message", new JSObject(messageJson));
            } catch (JSONException ignored) {}
        }

        dispatchAction(action);
    }

    static void sendReplyMessageAction(Intent intent) {
        sendMessageNotificationAction(intent, "reply-message");
    }

    static void sendDeleteMessageAction(Intent intent) {
        sendMessageNotificationAction(intent, "delete-message");
    }

    static void sendStarMessageAction(Intent intent) {
        sendMessageNotificationAction(intent, "star-message");
    }

    private static void sendMessageNotificationAction(Intent intent, String actionName) {
        int notificationId = intent.getIntExtra("notificationId", -1);
        if (notificationId != -1 && instance != null) {
            NotificationManagerCompat.from(instance.getContext()).cancel(notificationId);
        }

        JSObject action = newAction(actionName);
        copyStringExtra(intent, action, "messageId");
        copyStringExtra(intent, action, "accountId");
        copyStringExtra(intent, action, "folder");

        String messageJson = intent.getStringExtra("message");
        if (messageJson != null) {
            try {
                action.put("message", new JSObject(messageJson));
            } catch (JSONException ignored) {}
        }

        dispatchAction(action);
    }

    static void sendMailtoAction(Uri uri) {
        JSObject composeData = parseMailto(uri);
        if (composeData == null) return;

        JSObject action = newAction("new-mail");
        action.put("composeData", composeData);
        action.put("source", "mailto");
        dispatchAction(action);
    }

    static void sendComposeAction() {
        JSObject action = newAction("new-mail");
        action.put("composeData", new JSObject());
        action.put("source", "shortcut");
        dispatchAction(action);
    }

    static void sendSyncAction() {
        JSObject action = newAction("sync");
        action.put("source", "shortcut");
        dispatchAction(action);
    }

    static void installDownloadedUpdateFromIntent() {
        if (instance != null) {
            instance.showUpdateReadyDialog();
        }
    }

    static void resumePendingUpdateInstall() {
        if (instance != null) {
            instance.continuePendingUpdateInstall();
        }
    }

    private static void dispatchAction(JSObject action) {
        synchronized (pendingActions) {
            pendingActions.add(action);
        }

        if (instance != null) {
            instance.injectPendingActionsToWebView();
        }
    }

    private void injectPendingActionsToWebView() {
        if (getBridge() == null) return;
        injectPendingActions(getBridge().getWebView(), getContext());
    }

    private static JSObject newAction(String actionName) {
        JSObject action = new JSObject();
        action.put("id", UUID.randomUUID().toString());
        action.put("action", actionName);
        return action;
    }

    private static JSObject parseMailto(Uri uri) {
        if (uri == null || !"mailto".equalsIgnoreCase(uri.getScheme())) return null;

        String schemeSpecificPart = uri.getEncodedSchemeSpecificPart();
        String[] parts = (schemeSpecificPart == null ? "" : schemeSpecificPart).split("\\?", 2);
        String addressPart = parts.length > 0 ? parts[0] : "";
        String queryPart = parts.length > 1 ? parts[1] : "";

        JSObject composeData = new JSObject();
        composeData.put("to", new JSArray(unique(splitAddresses(decodePath(addressPart)))));
        composeData.put("cc", new JSArray());
        composeData.put("bcc", new JSArray());
        composeData.put("subject", "");
        composeData.put("body", "");

        for (String pair : queryPart.split("&")) {
            if (pair.isEmpty()) continue;

            String[] queryParts = pair.split("=", 2);
            String normalizedName = decodeQuery(queryParts[0]).toLowerCase();
            String value = queryParts.length > 1 ? decodeQuery(queryParts[1]) : "";

            if ("to".equals(normalizedName)) {
                composeData.put("to", new JSArray(unique(merge(composeData.optJSONArray("to"), splitAddresses(value)))));
            } else if ("cc".equals(normalizedName)) {
                composeData.put("cc", new JSArray(unique(splitAddresses(value))));
            } else if ("bcc".equals(normalizedName)) {
                composeData.put("bcc", new JSArray(unique(splitAddresses(value))));
            } else if ("subject".equals(normalizedName)) {
                composeData.put("subject", value);
            } else if ("body".equals(normalizedName)) {
                composeData.put("body", value);
            }
        }

        return composeData;
    }

    private static List<String> splitAddresses(String value) {
        List<String> addresses = new ArrayList<>();
        if (value == null) return addresses;
        for (String item : value.split(",")) {
            String address = item.trim();
            if (!address.isEmpty()) addresses.add(address);
        }
        return addresses;
    }

    private static List<String> merge(org.json.JSONArray current, List<String> next) {
        List<String> merged = new ArrayList<>();
        if (current != null) {
            for (int i = 0; i < current.length(); i++) {
                String value = current.optString(i, "");
                if (!value.isEmpty()) merged.add(value);
            }
        }
        merged.addAll(next);
        return merged;
    }

    private static List<String> unique(List<String> values) {
        Set<String> set = new LinkedHashSet<>(values);
        return new ArrayList<>(set);
    }

    private static String decodePath(String value) {
        return decodeQuery((value == null ? "" : value).replace("+", "%2B"));
    }

    private static String decodeQuery(String value) {
        try {
            return URLDecoder.decode(value == null ? "" : value, "UTF-8");
        } catch (Exception ignored) {
            return value == null ? "" : value;
        }
    }

    private static String normalizeHost(String host) {
        return NativeSecurity.normalizeHost(host);
    }

    private static SharedPreferences getPrefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private ReleaseInfo fetchLatestRelease() throws Exception {
        JSONObject release = requestJson(UPDATE_RELEASE_URL);
        if (release.optBoolean("draft", false) || release.optBoolean("prerelease", false)) {
            throw new Exception("Latest GitHub Release is not on the stable channel.");
        }

        String tag = release.optString("tag_name", "");
        int[] parsedVersion = parseVersion(tag);
        if (parsedVersion == null) throw new Exception("Latest GitHub Release has an invalid custom tag.");

        org.json.JSONArray assets = release.optJSONArray("assets");
        JSONObject manifestAsset = null;

        if (assets != null) {
            for (int i = 0; i < assets.length(); i++) {
                JSONObject asset = assets.optJSONObject(i);
                if (asset == null) continue;

                if ("update-manifest.json".equals(asset.optString("name", ""))) {
                    manifestAsset = asset;
                    break;
                }
            }
        }

        if (manifestAsset == null) throw new Exception("Stable Release is missing update-manifest.json.");
        JSONObject manifest = requestJson(manifestAsset.optString("browser_download_url", ""));
        if (manifest.optInt("schemaVersion", 0) != 1 || !"stable".equals(manifest.optString("channel", ""))) {
            throw new Exception("Unsupported update manifest schema or channel.");
        }
        if (!tag.equals(manifest.optString("tag", ""))) throw new Exception("Release and manifest tags differ.");

        JSONObject android = manifest.optJSONObject("android");
        if (android == null || !getContext().getPackageName().equals(android.optString("packageName", ""))) {
            throw new Exception("Update manifest contains an unexpected Android package.");
        }

        String assetName = android.optString("asset", "");
        JSONObject apkAsset = null;
        if (assets != null) {
            for (int i = 0; i < assets.length(); i++) {
                JSONObject asset = assets.optJSONObject(i);
                if (asset != null && assetName.equals(asset.optString("name", ""))) {
                    apkAsset = asset;
                    break;
                }
            }
        }
        if (apkAsset == null || !assetName.endsWith(".apk")) throw new Exception("Manifest APK asset is missing.");

        ReleaseInfo info = new ReleaseInfo();
        info.version = tag;
        info.releaseName = release.optString("name", info.version);
        info.releaseNotes = release.optString("body", "");
        info.releaseDate = release.optString("published_at", "");
        info.assetName = assetName;
        info.downloadUrl = apkAsset.optString("browser_download_url", null);
        info.assetSize = android.optLong("size", -1L);
        info.sha256 = normalizeFingerprint(android.optString("sha256", ""));
        info.certificateSha256 = normalizeFingerprint(android.optString("certificateSha256", ""));
        info.versionCode = android.optLong("versionCode", -1L);

        long releaseAssetSize = apkAsset.optLong("size", -1L);
        String compiledCertificate = normalizeFingerprint(BuildConfig.MAILFLOW_ANDROID_CERTIFICATE_SHA256);
        if (info.versionCode != toVersionCode(parsedVersion)
            || info.assetSize <= 0L
            || info.assetSize > MAX_APK_BYTES
            || info.assetSize != releaseAssetSize
            || info.sha256.length() != 64
            || compiledCertificate.length() != 64
            || !compiledCertificate.equals(info.certificateSha256)) {
            throw new Exception("Android update manifest verification failed.");
        }
        info.digest = apkAsset.optString("digest", null);

        return info;
    }

    private JSONObject requestJson(String url) throws Exception {
        HttpURLConnection connection = openConnectionFollowingRedirects(url);
        int status = connection.getResponseCode();

        if (status < 200 || status >= 300) {
            connection.disconnect();
            throw new Exception("Update request failed with status " + status);
        }

        long contentLength = connection.getContentLengthLong();
        if (contentLength > MAX_JSON_BYTES) {
            connection.disconnect();
            throw new Exception("Update response exceeded the size limit.");
        }

        try (InputStream stream = connection.getInputStream()) {
            return new JSONObject(readStream(stream, MAX_JSON_BYTES));
        } finally {
            connection.disconnect();
        }
    }

    private void startUpdateDownload(ReleaseInfo release) {
        cancelUpdateDownload.set(false);
        sendUpdateStatus(updateStatus("downloading", release.toStatusData()));

        new Thread(() -> {
            File temporary = null;
            try {
                Log.i(TAG, "Downloading update APK from " + release.downloadUrl);
                File directory = new File(getContext().getCacheDir(), "updates");
                if (!directory.exists()) directory.mkdirs();

                temporary = new File(directory, UUID.randomUUID() + ".part");
                File output = new File(directory, sanitizeApkName(release.assetName));
                HttpURLConnection connection = openConnectionFollowingRedirects(release.downloadUrl);

                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) {
                    connection.disconnect();
                    throw new Exception("APK download failed with status " + status);
                }

                long contentLength = connection.getContentLengthLong();
                if (contentLength <= 0L || contentLength > MAX_APK_BYTES || contentLength != release.assetSize) {
                    connection.disconnect();
                    throw new Exception("APK Content-Length did not match the verified manifest.");
                }

                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long received = 0L;

                try (
                    InputStream input = new BufferedInputStream(connection.getInputStream());
                    FileOutputStream outputStream = new FileOutputStream(temporary)
                ) {
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = input.read(buffer)) != -1) {
                        if (cancelUpdateDownload.get()) throw new UpdateCancelledException();
                        outputStream.write(buffer, 0, read);
                        digest.update(buffer, 0, read);
                        received += read;
                        JSObject progress = release.toStatusData();
                        progress.put("progress", downloadProgress(received, contentLength));
                        sendUpdateStatus(updateStatus("downloading", progress));
                    }
                    outputStream.getFD().sync();
                } finally {
                    connection.disconnect();
                }

                if (received != release.assetSize || !toHex(digest.digest()).equals(release.sha256)) {
                    throw new Exception("Downloaded APK SHA-256 verification failed.");
                }
                verifyDownloadedPackage(temporary, release);
                if (output.exists() && !output.delete()) throw new Exception("Could not replace the previous verified APK.");
                moveAtomically(temporary, output);
                temporary = null;

                downloadedUpdate = output;
                persistDownloadedUpdateState(release, output);
                Log.i(TAG, "Downloaded and verified update APK.");
                sendUpdateStatus(updateStatus("downloaded", release.toStatusData()));
                postUpdateReadyNotification(release);
            } catch (UpdateCancelledException cancelled) {
                sendUpdateStatus(updateStatus("available", release.toStatusData()));
            } catch (Exception error) {
                Log.e(TAG, "Update download failed", error);
                sendUpdateError("downloadError");
            } finally {
                if (temporary != null && temporary.exists()) temporary.delete();
                cancelUpdateDownload.set(false);
                updateDownloadStarted.set(false);
            }
        }).start();
    }

    private HttpURLConnection openConnection(String url) throws Exception {
        validateUpdateUrl(url);

        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        connection.setRequestProperty("User-Agent", "MailFlow/" + getInstalledVersion());
        return connection;
    }

    private HttpURLConnection openConnectionFollowingRedirects(String url) throws Exception {
        String current = url;
        for (int redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
            HttpURLConnection connection = openConnection(current);

            int status = connection.getResponseCode();
            if (status < 300 || status >= 400) return connection;

            String location = connection.getHeaderField("Location");
            connection.disconnect();
            if (location == null || redirects == MAX_REDIRECTS) throw new Exception("Invalid update redirect.");
            current = UpdateUrlPolicy.resolveRedirect(current, location);

        }
        throw new Exception("Too many update redirects.");
    }

    private static void validateUpdateUrl(String value) throws Exception {
        UpdateUrlPolicy.validate(value);
    }

    private void verifyDownloadedPackage(File file, ReleaseInfo release) throws Exception {
        if (file == null || release == null || !file.exists()) throw new Exception("Downloaded APK is missing.");
        if (release.sha256 == null || !sha256(file).equals(release.sha256)) {
            throw new Exception("Downloaded APK SHA-256 mismatch.");
        }

        PackageManager manager = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
        PackageInfo archive = manager.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        if (archive == null || !getContext().getPackageName().equals(archive.packageName)) {
            throw new Exception("Downloaded APK package name mismatch.");
        }

        long archiveVersionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? archive.getLongVersionCode()
            : archive.versionCode;
        if (archiveVersionCode != release.versionCode || archiveVersionCode <= getInstalledVersionCode()) {
            throw new Exception("Downloaded APK versionCode is not an upgrade.");
        }

        Signature[] signatures = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && archive.signingInfo != null
            ? archive.signingInfo.getApkContentsSigners()
            : archive.signatures;
        if (signatures == null || signatures.length != 1) throw new Exception("Downloaded APK signer is missing or ambiguous.");

        String signer = toHex(MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray()));
        String compiledCertificate = normalizeFingerprint(BuildConfig.MAILFLOW_ANDROID_CERTIFICATE_SHA256);
        if (!signer.equals(compiledCertificate) || !signer.equals(release.certificateSha256)) {
            throw new Exception("Downloaded APK signing certificate mismatch.");
        }
    }

    private long getInstalledVersionCode() {

        try {
            PackageInfo installed = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? installed.getLongVersionCode() : installed.versionCode;
        } catch (Exception ignored) {
            return -1L;
        }
    }

    private static JSObject downloadProgress(long received, long total) {
        JSObject progress = new JSObject();
        progress.put("transferred", received);
        progress.put("total", total);
        progress.put("percent", total <= 0L ? 0D : Math.min(100D, (received * 100D) / total));
        return progress;
    }

    private static void moveAtomically(File source, File target) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Files.move(source.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            return;
        }
        if (!source.renameTo(target)) throw new Exception("Could not move verified APK into place.");
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new BufferedInputStream(new java.io.FileInputStream(file))) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        return toHex(digest.digest());
    }

    private static String toHex(byte[] bytes) {
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte item : bytes) value.append(String.format("%02X", item));
        return value.toString();
    }

    private static String normalizeFingerprint(String value) {
        return String.valueOf(value == null ? "" : value).replaceAll("[^A-Fa-f0-9]", "").toUpperCase();
    }

    private static String getInstalledVersion(Context context) {
        try {
            return context
                .getPackageManager()
                .getPackageInfo(context.getPackageName(), 0)
                .versionName;
        } catch (Exception ignored) {
            return "0.0.0";
        }
    }

    private String getInstalledVersion() {
        return getInstalledVersion(getContext());
    }

    private JSObject startDownloadedUpdateInstall() {
        JSObject result = new JSObject();
        restoreDownloadedUpdateState();

        if (downloadedUpdate == null || !downloadedUpdate.exists()) {
            Log.w(TAG, "Install requested with no downloaded APK");
            result.put("installed", false);
            result.put("reason", "missing-download");
            return result;
        }

        try {
            verifyDownloadedPackage(downloadedUpdate, updateInfo);
        } catch (Exception error) {
            Log.e(TAG, "Downloaded APK failed install-time verification", error);
            clearDownloadedUpdateState();
            sendUpdateError("verificationError");
            result.put("installed", false);
            result.put("reason", "verification-failed");
            return result;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Log.i(TAG, "Install requires unknown-apps permission");
            installPendingPermission = true;
            openInstallPermissionSettings();
            result.put("installed", false);
            result.put("reason", "permission-required");
            return result;
        }

        try {
            verifyReleaseDigest(updateInfo, downloadedUpdate);
            installPendingPermission = false;
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                downloadedUpdate
            );
            Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
            intent.setData(uri);
            intent.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true);
            intent.putExtra(Intent.EXTRA_RETURN_RESULT, true);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            getActivity().startActivity(intent);
            Log.i(TAG, "Started Android package installer for " + downloadedUpdate.getAbsolutePath());
            result.put("installed", true);
            return result;
        } catch (Exception error) {
            Log.e(TAG, "Could not start package installer", error);
            sendUpdateError("genericError");
            result.put("installed", false);
            result.put("reason", "launch-failed");
            return result;
        }
    }

    private void continuePendingUpdateInstall() {
        if (!installPendingPermission || downloadedUpdate == null || !downloadedUpdate.exists()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) return;
        installPendingPermission = false;
        sendUpdateStatus(updateStatus("downloaded", updateInfo == null ? new JSObject() : updateInfo.toStatusData()));
    }

    private JSObject showUpdateReadyDialog() {
        JSObject result = new JSObject();
        restoreDownloadedUpdateState();

        if (downloadedUpdate == null || !downloadedUpdate.exists()) {
            Log.w(TAG, "Install dialog requested with no downloaded APK");
            result.put("installed", false);
            result.put("reason", "missing-download");
            return result;
        }

        if (getActivity() == null || getActivity().isFinishing()) {
            return startDownloadedUpdateInstall();
        }

        String version = updateInfo == null || updateInfo.version == null || updateInfo.version.isEmpty()
            ? "update"
            : updateInfo.version;

        getActivity().runOnUiThread(() -> {
            if (getActivity() == null || getActivity().isFinishing()) {
                startDownloadedUpdateInstall();
                return;
            }

            new AlertDialog.Builder(getActivity())
                .setTitle(getContext().getString(R.string.update_ready_title))
                .setMessage(getContext().getString(R.string.update_ready_message, version))
                .setPositiveButton(getContext().getString(R.string.update_install), (dialog, which) -> startDownloadedUpdateInstall())
                .setNegativeButton(getContext().getString(R.string.update_later), null)
                .show();
        });

        result.put("installed", true);
        result.put("dialog", true);
        return result;
    }

    private void persistDownloadedUpdateState(ReleaseInfo release, File file) {
        if (release == null || file == null) return;

        getPrefs(getContext())
            .edit()
            .putString(PREF_UPDATE_APK_PATH, file.getAbsolutePath())
            .putString(PREF_UPDATE_VERSION, release.version == null ? "" : release.version)
            .putString(PREF_UPDATE_RELEASE_NAME, release.releaseName == null ? "" : release.releaseName)
            .putString(PREF_UPDATE_SHA256, release.sha256 == null ? "" : release.sha256)
            .putLong(PREF_UPDATE_VERSION_CODE, release.versionCode)
            .putString(PREF_UPDATE_DIGEST, release.digest == null ? "" : release.digest)

            .apply();
    }

    private void restoreDownloadedUpdateState() {
        if (downloadedUpdate != null && downloadedUpdate.exists()) return;

        SharedPreferences prefs = getPrefs(getContext());
        String path = prefs.getString(PREF_UPDATE_APK_PATH, null);
        if (path == null || path.isEmpty()) return;

        File file = new File(path);
        if (!file.exists()) {
            clearDownloadedUpdateState();
            return;
        }

        downloadedUpdate = file;
        if (updateInfo == null) {
            ReleaseInfo restored = new ReleaseInfo();
            restored.version = prefs.getString(PREF_UPDATE_VERSION, "");
            restored.releaseName = prefs.getString(PREF_UPDATE_RELEASE_NAME, restored.version);
            restored.assetName = file.getName();
            restored.assetSize = file.length();
            restored.sha256 = prefs.getString(PREF_UPDATE_SHA256, "");
            restored.certificateSha256 = normalizeFingerprint(BuildConfig.MAILFLOW_ANDROID_CERTIFICATE_SHA256);
            restored.versionCode = prefs.getLong(PREF_UPDATE_VERSION_CODE, -1L);
            restored.digest = prefs.getString(PREF_UPDATE_DIGEST, "");

            updateInfo = restored;
        }

        if (!isPersistedUpdateNewer(
            updateInfo.version,
            updateInfo.versionCode,
            getInstalledVersion(),
            getInstalledVersionCode()
        )) {
            Log.i(TAG, "Discarding a downloaded APK that is no longer newer than the installed app.");
            clearDownloadedUpdateState();
        }
    }

    private void clearDownloadedUpdateState() {
        File previousDownload = downloadedUpdate;
        downloadedUpdate = null;
        updateInfo = null;
        installPendingPermission = false;
        if (previousDownload != null && previousDownload.exists() && !previousDownload.delete()) {
            Log.w(TAG, "Could not remove stale update APK from the app cache.");
        }
        getPrefs(getContext())
            .edit()
            .remove(PREF_UPDATE_APK_PATH)
            .remove(PREF_UPDATE_VERSION)
            .remove(PREF_UPDATE_RELEASE_NAME)
            .remove(PREF_UPDATE_SHA256)
            .remove(PREF_UPDATE_VERSION_CODE)
            .remove(PREF_UPDATE_DIGEST)

            .apply();
    }

    private void openInstallPermissionSettings() {
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
            .setData(Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    private void sendUpdateError(String message) {
        sendUpdateError(message, false);
    }

    private void sendUpdateError(String message, boolean verbose) {
        JSObject status = updateStatus("error");
        status.put("messageKey", message);
        status.put("retryable", true);
        status.put("verbose", verbose);
        sendUpdateStatus(status);
    }

    @SuppressLint("MissingPermission")
    private void postUpdateReadyNotification(ReleaseInfo release) {
        Intent openIntent = new Intent(getContext(), MainActivity.class);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent openPendingIntent = PendingIntent.getActivity(
            getContext(),
            1002,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent installIntent = new Intent(getContext(), MainActivity.class);
        installIntent.setAction(ACTION_INSTALL_UPDATE);
        authenticateIntent(getContext(), installIntent);
        installIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent installPendingIntent = PendingIntent.getActivity(
            getContext(),
            1003,
            installIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), CHANNEL_UPDATES)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(getContext().getString(R.string.update_ready_title))
            .setContentText(getContext().getString(R.string.update_downloaded, release.version))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(getContext().getString(R.string.update_ready_message, release.version)))
            .setContentIntent(openPendingIntent)
            .addAction(R.mipmap.ic_launcher, getContext().getString(R.string.update_install), installPendingIntent)
            .setAutoCancel(false)
            .setOngoing(false)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);

        if (hasNotificationPermission(getContext())) {
            try {
                NotificationManagerCompat.from(getContext()).notify(1002, builder.build());
            } catch (SecurityException ignored) {}
        }
    }

    private void sendUpdateStatus(JSObject status) {
        lastUpdateStatus = status;
        notifyListeners("updateStatus", status);

        if (getBridge() == null || getBridge().getWebView() == null) return;
        String script = "(function(status){"
            + "window.dispatchEvent(new CustomEvent('mailflow:update-status',{detail:status}));"
            + "})(" + status.toString() + ");";
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(script, null));
    }

    private JSObject updateStatus(String type) {
        JSObject status = new JSObject();
        status.put("type", type);
        status.put("currentVersion", getInstalledVersion());
        return status;
    }

    private JSObject updateStatus(String type, JSObject data) {
        JSObject status = updateStatus(type);
        status.put("data", data);
        return status;
    }

    private static boolean isNewerVersion(String candidate, String current) {
        int[] next = parseVersion(candidate);
        int[] installed = parseVersion(current);
        if (next == null || installed == null) return false;

        for (int i = 0; i < 4; i++) {
            if (next[i] > installed[i]) return true;
            if (next[i] < installed[i]) return false;
        }

        return false;
    }

    static boolean isPersistedUpdateNewer(
        String candidateVersion,
        long candidateVersionCode,
        String installedVersion,
        long installedVersionCode
    ) {
        return candidateVersionCode > installedVersionCode
            && isNewerVersion(candidateVersion, installedVersion);
    }

    private static int[] parseVersion(String value) {
        return CustomReleaseVersion.parse(value);
    }

    private static long toVersionCode(int[] version) {
        return CustomReleaseVersion.versionCode(version);
    }

    private static String readStream(InputStream stream, int maxBytes) throws Exception {
        StringBuilder builder = new StringBuilder();
        byte[] buffer = new byte[8192];
        int read;
        int total = 0;
        while ((read = stream.read(buffer)) != -1) {
            total += read;
            if (total > maxBytes) throw new Exception("Update response exceeded the size limit.");
            builder.append(new String(buffer, 0, read, "UTF-8"));
        }
        return builder.toString();
    }

    private static File uniqueFile(File directory, String filename) {
        File file = new File(directory, filename);
        if (!file.exists()) return file;

        String base = filename.replaceFirst("\\.apk$", "");
        for (int i = 1; i < 1000; i++) {
            file = new File(directory, base + " (" + i + ").apk");
            if (!file.exists()) return file;
        }
        return new File(directory, base + "-" + UUID.randomUUID() + ".apk");
    }

    private static String sanitizeApkName(String value) {
        String name = value == null ? "MailFlow.apk" : value.replaceAll("[^A-Za-z0-9._ -]", "_");
        if (!name.toLowerCase().endsWith(".apk")) name += ".apk";
        return name;
    }

    private static void verifyReleaseDigest(ReleaseInfo release, File file) throws Exception {
        String digest = release == null || release.digest == null ? "" : release.digest.trim();
        if (digest.isEmpty()) return;
        if (!digest.matches("(?i)^sha256:[a-f0-9]{64}$")) {
            throw new Exception("The release asset has an unsupported digest.");
        }

        MessageDigest hasher = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                hasher.update(buffer, 0, read);
            }
        }

        StringBuilder actual = new StringBuilder();
        for (byte value : hasher.digest()) {
            actual.append(String.format("%02x", value & 0xff));
        }
        if (!NativeSecurity.secretsMatch(digest.substring("sha256:".length()).toLowerCase(java.util.Locale.ROOT), actual.toString())) {
            throw new Exception("The update digest does not match the release asset.");
        }
    }

    private static boolean isConfiguredHost(Context context, String url) {
        String host = getSavedHost(context);
        return host != null && NativeSecurity.isSameOrigin(host, url);

    }

    private static class ReleaseInfo {
        String version;
        String releaseName;
        String releaseNotes;
        String releaseDate;
        String assetName;
        String downloadUrl;
        String sha256;
        String certificateSha256;
        long assetSize;
        long versionCode;
        String digest;


        JSObject toStatusData() {
            JSObject data = new JSObject();
            data.put("releaseNotes", releaseNotes);
            data.put("version", version == null ? "" : version.replaceFirst("^v", ""));
            data.put("tag", version);
            data.put("releaseName", releaseName);
            data.put("releaseDate", releaseDate);
            data.put("updateUrl", downloadUrl);
            data.put("size", assetSize);
            data.put("versionCode", versionCode);
            data.put("releaseUrl", version == null ? "https://github.com/YunQue0912/mailflow/releases" : "https://github.com/YunQue0912/mailflow/releases/tag/" + version);
            data.put("manual", true);
            return data;
        }
    }

    private static class UpdateCancelledException extends Exception {}

    private static void createNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_NEW_MAIL,
            "New mail",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("New mail notifications from MailFlow.");
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);

            NotificationChannel updatesChannel = new NotificationChannel(
                CHANNEL_UPDATES,
                context.getString(R.string.update_channel_name),
                NotificationManager.IMPORTANCE_DEFAULT
            );
            updatesChannel.setDescription(context.getString(R.string.update_channel_description));
            manager.createNotificationChannel(updatesChannel);
        }
    }

    @PermissionCallback
    private void attachmentStoragePermissionCallback(PluginCall call) {
        if (getPermissionState("storage") != PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("started", false);
            result.put("reason", "permission-denied");
            call.resolve(result);
            return;
        }
        enqueueAttachmentDownload(call);
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        call.resolve(notificationPermissionResult(getNotificationPermissionState()));
    }

    private boolean hasNotificationPermission() {
        return hasNotificationPermission(getContext());
    }

    private static boolean hasNotificationPermission(Context context) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            return false;
        }

        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED;
    }

    private String getNotificationPermissionState() {
        if (hasNotificationPermission()) {
            return "granted";
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return "denied";

        PermissionState state = getPermissionState("notifications");
        if (state == PermissionState.DENIED) return "denied";
        return "default";
    }

    private JSObject notificationPermissionResult(String permission) {
        JSObject result = new JSObject();
        result.put("permission", permission);
        return result;
    }

    static JSObject handleNativeBridgeRequest(Context context, String method, JSONObject args) throws JSONException {
        if ("showNewMail".equals(method)) {
            JSONObject notification = args == null ? new JSONObject() : args;
            JSONObject messageObject = notification.optJSONObject("message");
            JSObject message = messageObject == null ? null : JSObject.fromJSONObject(messageObject);
            postNewMailNotification(
                context,
                notification.optString("title", "New mail"),
                notification.optString("body", "You have new mail."),
                notification.optString("messageId", null),
                notification.optString("accountId", null),
                notification.optString("folder", "INBOX"),
                message
            );
            JSObject result = new JSObject();
            result.put("shown", true);
            return result;
        }

        if ("installDownloadedUpdate".equals(method) && instance != null) {
            return instance.showUpdateReadyDialog();
        }

        if (instance != null) {
            if ("getUpdateState".equals(method)) {
                return instance.currentUpdateState();
            }
            if ("checkForUpdates".equals(method)) {
                return instance.beginUpdateCheck(args != null && args.optBoolean("verbose", false));
            }
            if ("downloadUpdate".equals(method)) {
                return instance.beginUpdateDownload();
            }
            if ("cancelUpdateDownload".equals(method)) {
                return instance.cancelUpdateDownloadResult();
            }
            if ("openUpdateInBrowser".equals(method)) {
                return instance.openUpdateReleasePage();
            }
        }

        JSObject result = new JSObject();
        if ("getUpdateState".equals(method)) {
            result.put("type", "idle");
            result.put("currentVersion", getInstalledVersion(context));
        } else if ("cancelUpdateDownload".equals(method)) {
            result.put("cancelled", false);
        } else if ("openUpdateInBrowser".equals(method)) {
            result.put("opened", false);
        } else if ("installDownloadedUpdate".equals(method)) {
            result.put("installed", false);
        } else {
            result.put("started", false);
        }
        result.put("reason", "unavailable");
        return result;

    }

    private static void putExtra(Intent intent, String key, String value) {
        if (value != null) intent.putExtra(key, value);
    }

    private static void copyStringExtra(Intent intent, JSObject target, String key) {
        String value = intent.getStringExtra(key);
        if (value != null) target.put(key, value);
    }
}
