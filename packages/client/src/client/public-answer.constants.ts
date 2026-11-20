/**
 * The most bytes a public route's answer may have. The two public answers are a few hundred bytes,
 * and whatever answers an address that may not be the server could stream without end, so
 * the client stops reading there instead of buffering it.
 */
export const PUBLIC_ANSWER_MAX_BYTES = 4096;
