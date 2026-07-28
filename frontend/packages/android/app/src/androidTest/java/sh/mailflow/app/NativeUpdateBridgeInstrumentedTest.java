package sh.mailflow.app;

import static org.junit.Assert.assertTrue;

import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.lang.reflect.Field;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class NativeUpdateBridgeInstrumentedTest {
    @Test
    public void javascriptInterfaceStartsTheNativeUpdater() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            String started = evaluate(scenario, "window.MailFlowAndroid.checkForUpdates(true)");
            assertTrue("Native updater did not start: " + started, started.contains("\\\"started\\\":true"));

            String state = "";
            for (int attempt = 0; attempt < 40; attempt += 1) {
                state = evaluate(scenario, "window.MailFlowAndroid.getUpdateState()");
                if (state.contains("\\\"type\\\":\\\"up-to-date\\\"")) break;
                assertTrue("Native updater reported an error: " + state, !state.contains("\\\"type\\\":\\\"error\\\""));
                Thread.sleep(250);
            }

            assertTrue("Native updater did not finish: " + state, state.contains("\\\"type\\\":\\\"up-to-date\\\""));
            String opened = evaluate(scenario, "window.MailFlowAndroid.openUpdateInBrowser()");
            assertTrue("Release page did not open: " + opened, opened.contains("\\\"opened\\\":true"));
        }
    }

    private static String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch evaluated = new CountDownLatch(1);

        scenario.onActivity(activity -> {
            try {
                Field bridgeField = BridgeActivity.class.getDeclaredField("bridge");
                bridgeField.setAccessible(true);
                Bridge bridge = (Bridge) bridgeField.get(activity);
                WebView webView = bridge.getWebView();
                webView.evaluateJavascript(
                    script,
                    value -> {
                        result.set(value);
                        evaluated.countDown();
                    }
                );
            } catch (Exception error) {
                result.set(String.valueOf(error));
                evaluated.countDown();
            }
        });

        assertTrue("JavaScript evaluation timed out", evaluated.await(10, TimeUnit.SECONDS));
        return result.get();
    }
}
