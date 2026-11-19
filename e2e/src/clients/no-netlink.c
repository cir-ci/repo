/*
 * Preloaded (LD_PRELOAD) into the end-to-end browsers on Linux only; see no-netlink.ts.
 *
 * Chromium learns about network changes from a NETLINK_ROUTE socket (AddressTrackerLinux), and on
 * a host running the end-to-end stacks every Docker network or container another worker starts or
 * stops is such a change: Chromium then aborts its requests in flight with net::ERR_NETWORK_CHANGED.
 * Refusing that one kind of socket keeps the host's interface churn away from the browser, which
 * then treats the network as always online. Every other socket (TCP, UDP, Unix) is the real one.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <linux/netlink.h>
#include <sys/socket.h>

int socket(int domain, int type, int protocol) {
  static int (*real_socket)(int, int, int);
  if (domain == AF_NETLINK && protocol == NETLINK_ROUTE) {
    errno = EAFNOSUPPORT;
    return -1;
  }
  if (!real_socket) real_socket = (int (*)(int, int, int))dlsym(RTLD_NEXT, "socket");
  return real_socket(domain, type, protocol);
}
