/**
 * Bind addresses that listen on every interface, as the URL parser writes a host: a client cannot
 * connect to them, only to loopback. Every spelling of one (`0`, `::0`, `::ffff:0.0.0.0`) parses
 * to one of these.
 */
export const WILDCARD_HOSTS: readonly string[] = ['0.0.0.0', '[::]', '[::ffff:0:0]'];

/** A host written as a bracketed IPv6 literal (`[::1]`); group 1 is the address. */
export const BRACKETED_HOST = /^\[(.*)\]$/;

/** Where a client reaches a server that listens on a wildcard address: this machine. */
export const LOOPBACK_HOST = '127.0.0.1';
