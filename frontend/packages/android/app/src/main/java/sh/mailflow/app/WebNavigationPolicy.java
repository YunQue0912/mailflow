package sh.mailflow.app;

import java.net.URI;

final class WebNavigationPolicy {
    private WebNavigationPolicy() {}

    static boolean isConfiguredOrigin(String configuredHost, String candidateUrl) {
        try {
            URI configured = new URI(configuredHost);
            URI candidate = new URI(candidateUrl);
            if (!isHttp(configured) || !isHttp(candidate)) return false;
            if (configured.getUserInfo() != null || candidate.getUserInfo() != null) return false;
            if (configured.getHost() == null || candidate.getHost() == null) return false;

            return configured.getScheme().equalsIgnoreCase(candidate.getScheme())
                && configured.getHost().equalsIgnoreCase(candidate.getHost())
                && effectivePort(configured) == effectivePort(candidate);
        } catch (Exception ignored) {
            return false;
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
