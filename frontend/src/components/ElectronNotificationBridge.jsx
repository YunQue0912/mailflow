import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/index.js';
import { api } from '../utils/api.js';
import { installCapacitorNativeBridge } from '../utils/capacitorNativeBridge.js';
import {
  NATIVE_UPDATE_CHECK_INTERVAL_MS,
  NATIVE_UPDATE_KEYS,
  NATIVE_UPDATE_RETRY_INTERVAL_MS,
  shouldRecordNativeUpdateCheck,
  shouldRunAutomaticNativeUpdateCheck,
} from '../utils/nativeUpdatePolicy.js';
import { createBoundedActionIdTracker, isTrustedNativeMessage } from '../utils/nativeActionSecurity.js';

function linuxInstructionPath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  if (!normalized) return null;
  return normalized.replace(/^\/home\/[^/]+(?=\/)/, '$HOME');
}

function getLinuxInstallCommandFromPath(filePath) {
  const normalized = linuxInstructionPath(filePath);
  if (!normalized) return null;

  const escaped = normalized.startsWith('$HOME/')
    ? normalized.replace(/(["\\`])/g, '\\$1')
    : normalized.replace(/(["\\$`])/g, '\\$1');
  const quotedPath = `"${escaped}"`;

  if (/\.deb$/i.test(normalized)) return `sudo apt install ${quotedPath}`;
  if (/\.rpm$/i.test(normalized)) return `sudo dnf install ${quotedPath}`;
  return null;
}

function isLinuxPackagePath(filePath) {
  return /\.(deb|rpm)$/i.test(String(filePath || ''));
}

export default function ElectronNotificationBridge() {
  const { t } = useTranslation();
  const addNotification = useStore(state => state.addNotification);
  const openCompose = useStore(state => state.openCompose);
  const setSelectedAccount = useStore(state => state.setSelectedAccount);
  const setSelectedMessage = useStore(state => state.setSelectedMessage);
  const setSearchQuery = useStore(state => state.setSearchQuery);
  const totalUnread = useStore(state => state.unreadCounts.total);
  const lastActionRef = useRef({ action: null, time: 0 });
  const lastUpdateNoticeRef = useRef('');
  const processedActionIdsRef = useRef(createBoundedActionIdTracker());
  const [nativeBridgeReady, setNativeBridgeReady] = useState(() => Boolean(window.mailflowNative));

  useEffect(() => {
    let cancelled = false;
    installCapacitorNativeBridge().then(() => {
      if (!cancelled) setNativeBridgeReady(Boolean(window.mailflowNative));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!nativeBridgeReady) return undefined;
    window.__mailflowNativeBridgeReady = true;

    return () => {
      window.__mailflowNativeBridgeReady = false;
    };
  }, [nativeBridgeReady]);

  useEffect(() => {
    if (!nativeBridgeReady) return;
    window.mailflowNative?.badges?.setUnreadCount?.(totalUnread || 0);
  }, [nativeBridgeReady, totalUnread]);

  useEffect(() => {
    if (!nativeBridgeReady) return undefined;
    const unsubscribe = window.mailflowNative?.notifications?.onPush?.((notification) => {
      addNotification({
        type: notification.type === 'negative' ? 'error' : notification.type,
        title: notification.title,
        body: notification.body || notification.message,
      });
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [addNotification, nativeBridgeReady]);

  useEffect(() => {
    if (!nativeBridgeReady) return undefined;
    let active = true;
    const handleStatus = (status) => {
      if (status?.type === 'available') {
        if (localStorage.getItem(NATIVE_UPDATE_KEYS.skippedVersion) === status.version) return;
        const deferredVersion = localStorage.getItem(NATIVE_UPDATE_KEYS.deferredVersion);
        if (deferredVersion === status.version
          && Date.now() < Number(localStorage.getItem(NATIVE_UPDATE_KEYS.deferredUntil) || 0)) return;
        const noticeKey = `available:${status.version || ''}`;
        if (lastUpdateNoticeRef.current === noticeKey) return;
        lastUpdateNoticeRef.current = noticeKey;
        addNotification({
          type: 'info',
          title: t('admin.about.updates.notificationAvailableTitle'),
          body: t('admin.about.updates.notificationAvailableBody', { version: status.version }),
          allowWrap: true,
          actionLabel: t('admin.about.updates.download'),
          onAction: () => window.mailflowNative?.updates?.download?.(),
        });
        return;
      }

      if (status?.type === 'error' && status.verbose) {
        addNotification({
          type: 'error',
          title: t('admin.about.updates.notificationErrorTitle'),
          body: t(`admin.about.updates.errors.${status.messageKey || 'genericError'}`),
        });
        return;
      }

      if (status?.type !== 'downloaded') return;
      const noticeKey = `downloaded:${status.version || ''}`;
      if (lastUpdateNoticeRef.current === noticeKey) return;
      lastUpdateNoticeRef.current = noticeKey;

      const platform = window.mailflowNative?.platform;
      const filePath = status?.data?.filePath || status?.data?.updatePath || '';
      const installCommand = status?.data?.installCommand
        || (platform === 'linux' ? getLinuxInstallCommandFromPath(filePath) : null);
      const manualInstall = Boolean(
        status?.data?.manualInstall
        || installCommand
        || (platform === 'linux' && (isLinuxPackagePath(filePath) || status?.data?.manual))
      );
      addNotification({
        type: 'success',
        title: t('admin.about.updates.notificationReadyTitle'),
        body: manualInstall
          ? `MailFlow downloaded and verified the update.${installCommand ? ` Install it from a terminal with:\n${installCommand}` : ''}`
          : t('admin.about.updates.notificationReadyBody', { version: status.version }),
        allowWrap: true,
        persistent: true,
        actionLabel: manualInstall
          ? 'Copy & Quit'
          : platform === 'android'
            ? t('admin.about.updates.installAndroid')
            : t('admin.about.updates.install'),
        onAction: async () => {
          if (manualInstall) {
            const result = await window.mailflowNative?.updates?.copyInstallCommandAndQuit?.({
              installCommand,
              filePath,
            });
            if (!result?.copied) {
              addNotification({
                type: 'error',
                title: 'Copy failed',
                body: 'The update command could not be copied.',
              });
            }
            return;
          }

          const result = await window.mailflowNative?.updates?.installDownloaded?.();
          if (result?.reason === 'manual-install-required' && result.installCommand) {
            addNotification({
              type: 'success',
              title: 'Update ready',
              body: `MailFlow downloaded and verified the update. Install it from a terminal with:\n${result.installCommand}`,
              allowWrap: true,
              persistent: true,
              actionLabel: 'Copy & Quit',
              onAction: async () => {
                await window.mailflowNative?.updates?.copyInstallCommandAndQuit?.({
                  installCommand: result.installCommand,
                  filePath,
                });
              },
            });
            return;
          }

          if (result && result.installed === false) {
            addNotification({
              type: 'error',
              title: t('admin.about.updates.notificationInstallErrorTitle'),
              body: t('admin.about.updates.notificationInstallErrorBody'),
            });
          }
        },
      });
    };
    const unsubscribe = window.mailflowNative?.updates?.onStatus?.(handleStatus);
    window.mailflowNative?.updates?.getState?.()
      ?.then?.((status) => {
        if (active && status) handleStatus(status);
      })
      ?.catch?.(() => {});

    return () => {
      active = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [addNotification, nativeBridgeReady, t]);

  useEffect(() => {
    if (!nativeBridgeReady) return undefined;
    let active = true;
    let checkInFlight = false;
    let timer = null;

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const scheduleNextCheck = (delayOverride) => {
      clearTimer();
      if (!active || localStorage.getItem(NATIVE_UPDATE_KEYS.autoCheck) === 'false') return;
      const lastCheck = Number(localStorage.getItem(NATIVE_UPDATE_KEYS.lastCheck) || 0);
      const elapsed = Number.isFinite(lastCheck) ? Math.max(0, Date.now() - lastCheck) : NATIVE_UPDATE_CHECK_INTERVAL_MS;
      const delay = delayOverride ?? Math.max(1000, NATIVE_UPDATE_CHECK_INTERVAL_MS - elapsed);
      timer = window.setTimeout(runAutomaticCheck, delay);
    };

    const runAutomaticCheck = async ({ force = false, markSession = false } = {}) => {
      if (!active || checkInFlight) return;
      const autoCheck = localStorage.getItem(NATIVE_UPDATE_KEYS.autoCheck) !== 'false';
      const lastCheck = localStorage.getItem(NATIVE_UPDATE_KEYS.lastCheck);
      if (!shouldRunAutomaticNativeUpdateCheck({ autoCheck, force, lastCheck })) {
        scheduleNextCheck();
        return;
      }

      checkInFlight = true;
      if (markSession) {
        sessionStorage.setItem(NATIVE_UPDATE_KEYS.sessionCheck, 'true');
      }
      let completed = false;
      try {
        const result = await window.mailflowNative?.updates?.check?.(false);
        if (shouldRecordNativeUpdateCheck(result)) {
          localStorage.setItem(NATIVE_UPDATE_KEYS.lastCheck, String(Date.now()));
          completed = true;
        }
      } catch {
        // A failed background check is intentionally not a 24-hour throttle point.
      } finally {
        checkInFlight = false;
        scheduleNextCheck(completed ? undefined : NATIVE_UPDATE_RETRY_INTERVAL_MS);
      }
    };

    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') runAutomaticCheck();
    };

    const checkAfterAutoUpdateEnabled = () => {
      runAutomaticCheck({ force: true, markSession: true });
    };

    if (sessionStorage.getItem(NATIVE_UPDATE_KEYS.sessionCheck) === 'true') {
      scheduleNextCheck();
    } else {
      runAutomaticCheck({ force: true, markSession: true });
    }
    document.addEventListener('visibilitychange', checkWhenVisible);
    window.addEventListener('online', runAutomaticCheck);
    window.addEventListener('mailflow:native-auto-update-changed', checkAfterAutoUpdateEnabled);

    return () => {
      active = false;
      clearTimer();
      document.removeEventListener('visibilitychange', checkWhenVisible);
      window.removeEventListener('online', runAutomaticCheck);
      window.removeEventListener('mailflow:native-auto-update-changed', checkAfterAutoUpdateEnabled);
    };
  }, [nativeBridgeReady]);

  useEffect(() => {
    if (!nativeBridgeReady) return undefined;
    const getPayloadMessage = (payload) => {
      const state = useStore.getState();
      return payload?.message || state.messages.find((item) => item.id === payload?.messageId) || null;
    };

    const openMessageFromPayload = (payload) => {
      const messageId = payload?.messageId;
      if (!messageId) return null;

      const folder = payload.folder || 'INBOX';
      const message = getPayloadMessage(payload);
      const state = useStore.getState();

      setSearchQuery('');
      if (payload.accountId) {
        setSelectedAccount(payload.accountId, folder);
      }

      if (message && !state.messages.some((item) => item.id === message.id)) {
        useStore.setState((current) => ({
          messages: [{ ...message, account_id: message.account_id || payload.accountId }, ...current.messages],
        }));
      }

      window.dispatchEvent(new CustomEvent('mailflow:refresh'));
      window.setTimeout(() => setSelectedMessage(messageId), 0);
      return message;
    };

    const normalizeAddressList = (value) => {
      if (Array.isArray(value)) return value;
      try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };

    const openReplyFromPayload = (payload) => {
      const message = getPayloadMessage(payload);
      if (!message) return;

      const replyTo = normalizeAddressList(message.reply_to ?? message.replyTo);
      const replyTarget = replyTo[0]?.email
        ? replyTo[0]
        : {
            name: message.from_name || message.fromName || '',
            email: message.from_email || message.fromEmail || '',
          };
      const sender = replyTarget.email ? [replyTarget] : [];
      const rawSubject = (message.subject || '').trim();
      const subject = rawSubject.startsWith('Re:') ? rawSubject : rawSubject ? `Re: ${rawSubject}` : 'Re:';
      const originalMessageId = message.message_id || message.messageId;
      const priorInReplyTo = message.in_reply_to || message.inReplyTo;

      openCompose({
        to: sender,
        cc: [],
        subject,
        body: '',
        inReplyTo: originalMessageId,
        references: [priorInReplyTo, originalMessageId].filter(Boolean).join(' ').trim() || null,
        accountId: message.account_id || message.accountId || payload.accountId,
        isReply: true,
        originalFrom: sender,
        allRecipients: [],
      });
    };

    const runNativeAction = async (payload) => {
      const action = typeof payload === 'string' ? payload : payload?.action;
      const id = typeof payload === 'object' ? payload?.id : null;

      if (!action) return;
      if (id && !processedActionIdsRef.current.remember(id)) return;

      const now = Date.now();
      const last = lastActionRef.current;

      if (!id && last.action === action && now - last.time < 500) return;
      lastActionRef.current = { action, time: now };

      try {
        if (action === 'new-mail') {
          openCompose(payload?.composeData || {});
          return;
        }

        if (action === 'open-message') {
          openMessageFromPayload(payload);
          return;
        }

        if (action === 'reply-message') {
          openReplyFromPayload(payload);
          return;
        }

        if (action === 'delete-message') {
          const messageId = payload?.messageId;
          if (!messageId) return;

          await api.deleteMessage(messageId);
          useStore.getState().removeMessage(messageId);
          window.dispatchEvent(new CustomEvent('mailflow:refresh'));
          return;
        }

        if (action === 'star-message') {
          const messageId = payload?.messageId;
          if (!messageId) return;

          await api.markStarred(messageId, true);
          useStore.getState().updateMessage(messageId, { is_starred: true });
          return;
        }

        if (action === 'sync') {
          try {
            addNotification({
              type: 'info',
              title: 'Sync started',
              body: 'MailFlow is checking for new mail.',
            });
            await api.syncNow();
          } catch (error) {
            addNotification({
              type: 'error',
              title: 'Sync failed',
              body: error.message || 'Could not sync mail.',
            });
          }
        }
      } finally {
        if (id) {
          window.mailflowNative?.actions?.ack?.(id);
        }
      }
    };

    const handleNativeAction = (event) => {
      runNativeAction(event.detail);
    };

    const handleNativeMessage = (event) => {
      if (!isTrustedNativeMessage(event)) return;
      if (event.data?.type === 'mailflow:native-action') {
        runNativeAction(event.data.payload);
      } else if (event.data?.type === 'mailflow:native-actions-ready') {
        drainInjectedActions();
      }
    };

    const drainInjectedActions = () => {
      const actions = Array.isArray(window.__mailflowPendingNativeActions)
        ? window.__mailflowPendingNativeActions.splice(0)
        : [];
      actions.forEach(runNativeAction);
    };

    const unsubscribe = window.mailflowNative?.actions?.onAction?.((payload) => {
      runNativeAction(payload);
    });

    window.mailflowNative?.actions?.getPending?.()
      .then((actions = []) => {
        actions.forEach(runNativeAction);
      })
      .catch(() => {});

    drainInjectedActions();
    window.addEventListener('mailflow:native-action', handleNativeAction);
    window.addEventListener('mailflow:native-actions-ready', drainInjectedActions);
    window.addEventListener('message', handleNativeMessage);
    return () => {
      window.removeEventListener('mailflow:native-action', handleNativeAction);
      window.removeEventListener('mailflow:native-actions-ready', drainInjectedActions);
      window.removeEventListener('message', handleNativeMessage);
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [addNotification, nativeBridgeReady, openCompose, setSearchQuery, setSelectedAccount, setSelectedMessage]);

  return null;
}
