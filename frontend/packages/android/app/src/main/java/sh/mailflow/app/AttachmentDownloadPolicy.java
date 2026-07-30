package sh.mailflow.app;

import java.net.URI;

final class AttachmentDownloadPolicy {
    private AttachmentDownloadPolicy() {}

    static boolean isAllowed(String configuredHost, String candidateUrl) {
        try {
            URI configured = URI.create(configuredHost);
            URI candidate = URI.create(candidateUrl);
            if (!isHttp(configured.getScheme()) || !isHttp(candidate.getScheme())) return false;
            if (!sameOrigin(configured, candidate) || candidate.getUserInfo() != null) return false;

            String path = candidate.getRawPath();
            return path != null && path.matches(
                "^/api/mail/messages/[0-9a-fA-F-]{36}/attachments(?:\\.zip|/[^/]+)$"
            );
        } catch (RuntimeException error) {
            return false;
        }
    }

    static String safeFilename(String filename) {
        String value = filename == null ? "" : filename;
        value = value
            .replaceAll("[\\\\/\\p{Cntrl}\\u202A-\\u202E\\u2066-\\u2069\\u200F\\u061C]", "_")
            .trim();
        if (value.length() > 180) value = value.substring(0, 180);
        return value.isEmpty() ? "attachment" : value;
    }

    private static boolean isHttp(String scheme) {
        return "https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme);
    }

    private static boolean sameOrigin(URI first, URI second) {
        return first.getScheme().equalsIgnoreCase(second.getScheme())
            && first.getHost() != null
            && first.getHost().equalsIgnoreCase(second.getHost())
            && effectivePort(first) == effectivePort(second);
    }

    private static int effectivePort(URI uri) {
        if (uri.getPort() >= 0) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }
}
