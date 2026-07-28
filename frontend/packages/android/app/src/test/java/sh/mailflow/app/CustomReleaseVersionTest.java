package sh.mailflow.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class CustomReleaseVersionTest {
    @Test
    public void parsesVersionAndCalculatesVersionCode() {
        int[] parsed = CustomReleaseVersion.parse("v2.8.0-custom.1");
        assertArrayEquals(new int[] { 2, 8, 0, 1 }, parsed);
        assertEquals(208000001L, CustomReleaseVersion.versionCode(parsed));
    }

    @Test
    public void comparesAllFourComponents() {
        assertEquals(1, CustomReleaseVersion.compare("2.7.1-custom.5", "2.7.1-custom.4"));
        assertEquals(1, CustomReleaseVersion.compare("2.7.2-custom.1", "2.7.1-custom.99"));
        assertEquals(1, CustomReleaseVersion.compare("2.8.0-custom.1", "2.7.9-custom.999"));
        assertEquals(0, CustomReleaseVersion.compare("v2.7.1-custom.5", "2.7.1-custom.5"));
    }

    @Test
    public void rejectsInvalidAndUnboundedVersions() {
        assertNull(CustomReleaseVersion.parse("2.7.1"));
        assertNull(CustomReleaseVersion.parse("v2.7.1-custom"));
        assertNull(CustomReleaseVersion.parse("v2.100.1-custom.1"));
        assertNull(CustomReleaseVersion.parse("v2.7.100-custom.1"));
        assertNull(CustomReleaseVersion.parse("v2.7.1-custom.10000"));
        assertNull(CustomReleaseVersion.parse("v22.0.0-custom.1"));
    }
}
