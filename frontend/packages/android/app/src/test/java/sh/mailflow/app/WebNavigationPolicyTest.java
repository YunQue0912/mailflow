package sh.mailflow.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class WebNavigationPolicyTest {
    @Test
    public void keepsConfiguredOriginInsideTheApp() {
        assertTrue(WebNavigationPolicy.isConfiguredOrigin(
            "https://mail.genoric.com",
            "https://mail.genoric.com/settings/about?tab=updates"
        ));
        assertTrue(WebNavigationPolicy.isConfiguredOrigin(
            "https://mail.genoric.com:443",
            "https://MAIL.GENORIC.COM/inbox"
        ));
    }

    @Test
    public void rejectsDifferentSchemesPortsAndLookalikeHosts() {
        assertFalse(WebNavigationPolicy.isConfiguredOrigin(
            "https://mail.genoric.com",
            "http://mail.genoric.com/inbox"
        ));
        assertFalse(WebNavigationPolicy.isConfiguredOrigin(
            "https://mail.genoric.com",
            "https://mail.genoric.com:444/inbox"
        ));
        assertFalse(WebNavigationPolicy.isConfiguredOrigin(
            "https://mail.genoric.com",
            "https://mail.genoric.com.example.com/inbox"
        ));
        assertFalse(WebNavigationPolicy.isConfiguredOrigin(
            "https://mail.genoric.com",
            "https://user@mail.genoric.com/inbox"
        ));
    }
}
