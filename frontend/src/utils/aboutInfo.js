export const CUSTOM_PROJECT_URL = 'https://github.com/YunQue0912/mailflow';

export function isPackagedMailFlow(target) {
  return Boolean(
    target?.mailflowNative
    || target?.MailFlowAndroid
    || target?.Capacitor?.isNativePlatform?.(),
  );
}

export function selectAboutVersion({ packaged, installedVersion, serverVersion }) {
  if (packaged) return installedVersion || '…';
  return serverVersion || '…';
}

export function getDeploymentWebsiteUrl(location) {
  const origin = String(location?.origin || '').trim();
  return /^https?:\/\//i.test(origin) ? origin : CUSTOM_PROJECT_URL;
}
