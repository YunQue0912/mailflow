import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CUSTOM_PROJECT_URL,
  getDeploymentWebsiteUrl,
  isPackagedMailFlow,
  selectAboutVersion,
} from './aboutInfo.js';

describe('about information', () => {
  it('uses only the installed version inside packaged apps', () => {
    assert.equal(selectAboutVersion({
      packaged: true,
      installedVersion: '2.9.0-custom.1',
      serverVersion: '3.3.0-custom.2',
    }), '2.9.0-custom.1');
    assert.equal(selectAboutVersion({
      packaged: true,
      installedVersion: '',
      serverVersion: '3.3.0-custom.2',
    }), '…');
  });

  it('uses the server version only in the browser', () => {
    assert.equal(selectAboutVersion({
      packaged: false,
      installedVersion: '',
      serverVersion: '3.3.0-custom.2',
    }), '3.3.0-custom.2');
  });

  it('detects desktop and Android native containers', () => {
    assert.equal(isPackagedMailFlow({ mailflowNative: {} }), true);
    assert.equal(isPackagedMailFlow({ MailFlowAndroid: {} }), true);
    assert.equal(isPackagedMailFlow({ Capacitor: { isNativePlatform: () => true } }), true);
    assert.equal(isPackagedMailFlow({}), false);
  });

  it('uses the active deployment as the website and the custom project as fallback', () => {
    assert.equal(getDeploymentWebsiteUrl({ origin: 'https://mail.example.com' }), 'https://mail.example.com');
    assert.equal(getDeploymentWebsiteUrl({ origin: 'capacitor://localhost' }), CUSTOM_PROJECT_URL);
  });
});
