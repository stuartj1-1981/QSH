/**
 * URL utilities for HA ingress compatibility.
 *
 * Behind HA ingress the page is served at a subpath like
 * /api/hassio_ingress/abc123def/. All fetch and WebSocket URLs
 * must be resolved relative to that base so they route correctly
 * through the Supervisor proxy.
 */

/** Build a fetch-ready URL for an API path (e.g. "api/status"). */
export function apiUrl(path: string): string {
  return `./${path.replace(/^\//, '')}`
}

/** Build an absolute WebSocket URL for a WS path (e.g. "ws/live"). */
export function wsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const base = `${proto}//${window.location.host}`
  const wsPath = path.replace(/^\//, '')
  const pagePath = window.location.pathname.replace(/\/[^/]*$/, '')
  return `${base}${pagePath}/${wsPath}`
}
