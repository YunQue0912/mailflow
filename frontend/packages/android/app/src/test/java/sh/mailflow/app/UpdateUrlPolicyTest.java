package sh.mailflow.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;

import org.junit.Test;

public class UpdateUrlPolicyTest {
    @Test
    public void acceptsExpectedGitHubHttpsHosts() throws Exception {
        UpdateUrlPolicy.validate("https://api.github.com/repos/YunQue0912/mailflow/releases/latest");
        UpdateUrlPolicy.validate("https://github.com/YunQue0912/mailflow/releases/download/v1/file.apk");
        UpdateUrlPolicy.validate("https://release-assets.githubusercontent.com/file.apk?token=value");
    }

    @Test
    public void rejectsHttpCredentialsPortsAndUnknownHosts() {
        assertRejected("http://github.com/file.apk");
        assertRejected("https://user@github.com/file.apk");
        assertRejected("https://github.com:444/file.apk");
        assertRejected("https://github.com.example.com/file.apk");
    }

    @Test
    public void validatesEveryRedirectTargetIncludingRelativeLocations() throws Exception {
        assertEquals(
            "https://github.com/YunQue0912/file.apk",
            UpdateUrlPolicy.resolveRedirect("https://github.com/YunQue0912/mailflow", "file.apk")
        );
        try {
            UpdateUrlPolicy.resolveRedirect("https://github.com/YunQue0912/mailflow", "https://example.com/file.apk");
            fail("Expected an untrusted redirect target to be rejected.");
        } catch (Exception expected) {
            // Expected.
        }
    }

    private static void assertRejected(String value) {
        try {
            UpdateUrlPolicy.validate(value);
            fail("Expected URL to be rejected: " + value);
        } catch (Exception expected) {
            // Expected.
        }
    }
}
