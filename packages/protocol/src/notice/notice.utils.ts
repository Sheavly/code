import { NOTICE_LIFETIMES } from './notice.constants.js';
import type { HarnessNotice, NoticeLifetime, PersistentNotice } from './notice.types.js';

/** The lifetime the registry gives a notice's kind. */
export function noticeLifetime(notice: HarnessNotice): NoticeLifetime {
  return NOTICE_LIFETIMES[notice.kind];
}

/** True for a notice that is kept in history as well as sent to the model and the stream. */
export function isPersistentNotice(notice: HarnessNotice): notice is PersistentNotice {
  return noticeLifetime(notice) === 'persistent';
}
