package sh.mailflow.app;

import static org.junit.Assert.assertTrue;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.atomic.AtomicReference;
import com.getcapacitor.JSObject;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class NativeUpdateBridgeInstrumentedTest {
    @Test
    public void originScopedMessageRouterStartsTheNativeUpdater() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            JSObject started = route(scenario, "checkForUpdates", new JSONObject().put("verbose", true));
            assertTrue("Native updater did not start: " + started, started.optBoolean("started", false));

            JSObject state = new JSObject();
            for (int attempt = 0; attempt < 40; attempt += 1) {
                state = route(scenario, "getUpdateState", new JSONObject());
                String type = state.optString("type");
                if ("up-to-date".equals(type) || "available".equals(type)) break;
                assertTrue("Native updater reported an error: " + state, !"error".equals(state.optString("type")));
                Thread.sleep(250);
            }

            String finalType = state.optString("type");
            assertTrue(
                "Native updater did not finish: " + state,
                "up-to-date".equals(finalType) || "available".equals(finalType)
            );
        }
    }

    private static JSObject route(ActivityScenario<MainActivity> scenario, String method, JSONObject args) {
        AtomicReference<JSObject> result = new AtomicReference<>();
        scenario.onActivity(activity -> {
            try {
                result.set(MailFlowNativePlugin.handleNativeBridgeRequest(activity, method, args));
            } catch (Exception error) {
                throw new AssertionError(error);
            }
        });
        return result.get();
    }
}
