import { DISCOVERY_FORMAT_VERSION } from '@sheavly/protocol/discovery/discovery.constants';
import type { DiscoveryFile } from '@sheavly/protocol/discovery/discovery.types';
import { BRACKETED_HOST, LOOPBACK_HOST, WILDCARD_HOSTS } from './discovery.constants.js';

/**
 * Whether a server takes the lock and writes the file. One that exits with its parent is a UI's
 * own private backend, and must never be found by another client, nor refused because of one.
 */
export function isDiscoverable(params: { discovery: boolean; exitWithParent: boolean }): boolean {
  return params.discovery && !params.exitWithParent;
}

/**
 * The URL a client connects to for a server that listens on `host`:`port`. A wildcard address, in
 * any spelling the URL parser knows, becomes loopback and an IPv6 literal is bracketed; any other
 * host, even one the parser rejects, is used as given.
 */
export function publishedUrl(params: { host: string; port: number }): string {
  const { port } = params;
  const host = params.host.replace(BRACKETED_HOST, '$1');
  const authority = host.includes(':') ? `[${host}]` : host;
  const canonical = URL.parse(`http://${authority}`)?.hostname;

  if (canonical !== undefined && WILDCARD_HOSTS.includes(canonical)) {
    return `http://${LOOPBACK_HOST}:${String(port)}`;
  }

  return `http://${authority}:${String(port)}`;
}

/** The discovery file of a server that really listens on `host`:`port`, with the token it checks. */
export function discoveryFileFor(params: {
  host: string;
  port: number;
  token: string;
  instanceId: DiscoveryFile['instanceId'];
  serverVersion: DiscoveryFile['serverVersion'];
  protocolVersion: DiscoveryFile['protocolVersion'];
  pid: number;
}): DiscoveryFile {
  const { host, port, token, instanceId, serverVersion, protocolVersion, pid } = params;

  return {
    formatVersion: DISCOVERY_FORMAT_VERSION,
    url: publishedUrl({ host, port }),
    token,
    instanceId,
    pid,
    serverVersion,
    protocolVersion,
  };
}
