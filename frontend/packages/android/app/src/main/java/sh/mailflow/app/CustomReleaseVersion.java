package sh.mailflow.app;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class CustomReleaseVersion {
    private static final Pattern PATTERN = Pattern.compile("^v?(\\d+)\\.(\\d+)\\.(\\d+)-custom\\.(\\d+)$");
    private static final long MAX_ANDROID_VERSION_CODE = 2100000000L;

    private CustomReleaseVersion() {}

    static int[] parse(String value) {
        Matcher matcher = PATTERN.matcher(value == null ? "" : value);
        if (!matcher.matches()) return null;

        int[] version = new int[4];
        for (int index = 0; index < version.length; index++) {
            try {
                version[index] = Integer.parseInt(matcher.group(index + 1));
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        if (version[1] >= 100 || version[2] >= 100 || version[3] >= 10000 || versionCode(version) <= 0L) {
            return null;
        }
        return version;
    }

    static int compare(String left, String right) {
        int[] a = parse(left);
        int[] b = parse(right);
        if (a == null || b == null) throw new IllegalArgumentException("Invalid custom release version.");
        for (int index = 0; index < a.length; index++) {
            if (a[index] > b[index]) return 1;
            if (a[index] < b[index]) return -1;
        }
        return 0;
    }

    static long versionCode(int[] version) {
        if (version == null || version.length != 4) return -1L;
        long code = (version[0] * 100000000L) + (version[1] * 1000000L) + (version[2] * 10000L) + version[3];
        return code > 0L && code <= MAX_ANDROID_VERSION_CODE ? code : -1L;
    }
}
