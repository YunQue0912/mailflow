package sh.mailflow.app;

import java.net.URI;
import java.net.URL;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

final class UpdateUrlPolicy {
    private static final Set<String> ALLOWED_HOSTS = new HashSet<>(Arrays.asList(
        "api.github.com",
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
        "github-production-release-asset-2e65be.s3.amazonaws.com"
    ));

    private UpdateUrlPolicy() {}

    static void validate(String value) throws Exception {
        URI uri = new URI(value);
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        if (!"https".equalsIgnoreCase(uri.getScheme())
            || !ALLOWED_HOSTS.contains(host)
            || uri.getUserInfo() != null
            || (uri.getPort() != -1 && uri.getPort() != 443)) {
            throw new Exception("Update URL is not an allowed HTTPS GitHub URL.");
        }
    }

    static String resolveRedirect(String current, String location) throws Exception {
        if (location == null || location.trim().isEmpty()) throw new Exception("Update redirect is missing.");
        String resolved = new URL(new URL(current), location).toString();
        validate(resolved);
        return resolved;
    }
}
