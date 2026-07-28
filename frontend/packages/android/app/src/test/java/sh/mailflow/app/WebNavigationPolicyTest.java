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

    @Test
    public void allowsInitialHostNavigationFromSetupPage() {
        assertTrue(WebNavigationPolicy.isInitialHostNavigation(
            "https://localhost",
            "file:///android_asset/public/index.html",
            "https://localhost/",
            "https://mail.genoric.com/login"
        ));
        assertTrue(WebNavigationPolicy.isInitialHostNavigation(
            "https://localhost",
            "file:///android_asset/public/index.html",
            "file:///android_asset/public/index.html?fresh=1",
            "https://mail.genoric.com"
        ));
    }

    @Test
    public void rejectsInitialNavigationOutsideSetupPageOrToUnsafeSchemes() {
        assertFalse(WebNavigationPolicy.isInitialHostNavigation(
            "https://localhost",
            "file:///android_asset/public/index.html",
            "https://mail.genoric.com/settings",
            "https://external.example.com"
        ));
        assertFalse(WebNavigationPolicy.isInitialHostNavigation(
            "https://localhost",
            "file:///android_asset/public/index.html",
            "https://localhost/",
            "javascript:alert(1)"
        ));
    }
}
