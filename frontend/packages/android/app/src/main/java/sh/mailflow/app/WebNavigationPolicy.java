package sh.mailflow.app;

import java.net.URI;

final class WebNavigationPolicy {
    private WebNavigationPolicy() {}

    static boolean isConfiguredOrigin(String configuredHost, String candidateUrl) {
        return isSameHttpOrigin(configuredHost, candidateUrl);
    }

    static boolean isInitialHostNavigation(
        String localUrl,
        String setupFileUrl,
        String currentUrl,
        String candidateUrl
    ) {
        if (!isHttpUrl(candidateUrl) || currentUrl == null) return false;
        if (setupFileUrl != null && setupFileUrl.equalsIgnoreCase(stripQueryAndFragment(currentUrl))) {
            return true;
        }

        return isSameHttpOrigin(localUrl, currentUrl) && isSetupPath(currentUrl);
    }

    static boolean isHttpUrl(String value) {
        try {
            URI uri = new URI(value);
            return isHttp(uri) && uri.getUserInfo() == null && uri.getHost() != null;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean isSameHttpOrigin(String firstUrl, String secondUrl) {
        try {
            URI first = new URI(firstUrl);
            URI second = new URI(secondUrl);
            if (!isHttp(first) || !isHttp(second)) return false;
            if (first.getUserInfo() != null || second.getUserInfo() != null) return false;
            if (first.getHost() == null || second.getHost() == null) return false;

            return first.getScheme().equalsIgnoreCase(second.getScheme())
                && first.getHost().equalsIgnoreCase(second.getHost())
                && effectivePort(first) == effectivePort(second);
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean isSetupPath(String value) {
        try {
            String path = new URI(value).getPath();
            return path == null || path.isEmpty() || "/".equals(path) || "/index.html".equalsIgnoreCase(path);
        } catch (Exception ignored) {
            return false;
        }
    }

    private static String stripQueryAndFragment(String value) {
        try {
            URI uri = new URI(value);
            return new URI(uri.getScheme(), uri.getAuthority(), uri.getPath(), null, null).toString();
        } catch (Exception ignored) {
            return value;
        }
    }

    private static boolean isHttp(URI uri) {
        return "http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme());
    }

    private static int effectivePort(URI uri) {
        if (uri.getPort() != -1) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }
}
