/**
 * The line telling a user that a default port that was taken moved, or undefined when the server
 * listens where it was asked to: on the default port, or on a port the user chose.
 */
export function portMovedNotice(params: {
  portIsDefault: boolean;
  defaultPort: number;
  port: number;
}): string | undefined {
  const { portIsDefault, defaultPort, port } = params;

  if (!portIsDefault || port === defaultPort) return undefined;

  return `→ port ${String(defaultPort)} is taken, so this server listens on ${String(port)} instead (read the discovery file, not a fixed port)`;
}
