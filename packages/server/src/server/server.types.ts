import type { Conversations } from '@sheavly/host/conversations/conversations.service';
import type { ServerErrorCode } from '@sheavly/protocol/server/server.types';

/** What the server serves, from the app that starts it. It reads no settings itself. */
export type ServerOptions = {
  /** The live conversations, built the app's way (`new Conversations({ create })`). */
  conversations: Conversations;
  /** Every request must carry it (`Authorization: Bearer <token>`). Never logged. */
  token: string;
};

/** A failure, as the server answers it: an HTTP status and one of the protocol's codes. */
export type ServerFailure = {
  status: 400 | 401 | 404 | 409 | 422 | 500;
  code: ServerErrorCode;
  message: string;
};
