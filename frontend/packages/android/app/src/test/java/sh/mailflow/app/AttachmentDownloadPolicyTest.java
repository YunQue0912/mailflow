package sh.mailflow.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AttachmentDownloadPolicyTest {
    private static final String HOST = "https://mail.example.test";
    private static final String MESSAGE_ID = "11111111-1111-4111-8111-111111111111";

    @Test
    public void acceptsSingleAndZipAttachmentUrlsOnConfiguredOrigin() {
        assertTrue(AttachmentDownloadPolicy.isAllowed(
            HOST,
            HOST + "/api/mail/messages/" + MESSAGE_ID + "/attachments/2.1"
        ));
        assertTrue(AttachmentDownloadPolicy.isAllowed(
            HOST,
            HOST + "/api/mail/messages/" + MESSAGE_ID + "/attachments.zip"
        ));
    }

    @Test
    public void rejectsOtherOriginsAndNonAttachmentPaths() {
        assertFalse(AttachmentDownloadPolicy.isAllowed(
            HOST,
            "https://evil.example/api/mail/messages/" + MESSAGE_ID + "/attachments/2"
        ));
        assertFalse(AttachmentDownloadPolicy.isAllowed(HOST, HOST + "/api/admin/export"));
        assertFalse(AttachmentDownloadPolicy.isAllowed(
            HOST,
            "http://mail.example.test/api/mail/messages/" + MESSAGE_ID + "/attachments/2"
        ));
    }

    @Test
    public void sanitizesFilenameForTheDownloadsDirectory() {
        assertEquals(".._report___.pdf", AttachmentDownloadPolicy.safeFilename("../report\r\n\u202E.pdf"));
        assertEquals("attachment", AttachmentDownloadPolicy.safeFilename(""));
    }
}
