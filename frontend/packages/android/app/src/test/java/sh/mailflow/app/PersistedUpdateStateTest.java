package sh.mailflow.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PersistedUpdateStateTest {
    @Test
    public void rejectsTheVersionThatWasJustInstalled() {
        assertFalse(MailFlowNativePlugin.isPersistedUpdateNewer(
            "v2.8.0-custom.12",
            208000012L,
            "2.8.0-custom.12",
            208000012L
        ));
    }

    @Test
    public void rejectsOlderAndInconsistentPersistedPackages() {
        assertFalse(MailFlowNativePlugin.isPersistedUpdateNewer(
            "v2.8.0-custom.11",
            208000011L,
            "2.8.0-custom.12",
            208000012L
        ));
        assertFalse(MailFlowNativePlugin.isPersistedUpdateNewer(
            "v2.8.0-custom.13",
            208000012L,
            "2.8.0-custom.12",
            208000012L
        ));
        assertFalse(MailFlowNativePlugin.isPersistedUpdateNewer(
            "invalid",
            208000013L,
            "2.8.0-custom.12",
            208000012L
        ));
    }

    @Test
    public void keepsOnlyAnActualUpgrade() {
        assertTrue(MailFlowNativePlugin.isPersistedUpdateNewer(
            "v2.8.0-custom.13",
            208000013L,
            "2.8.0-custom.12",
            208000012L
        ));
    }
}
