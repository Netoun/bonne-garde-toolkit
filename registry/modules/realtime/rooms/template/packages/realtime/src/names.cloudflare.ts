/** What the Worker and the Node side of a test agree on: no runtime import, so Node can load it. */

/** The path prefix the upgrade is registered under; a socket opens `/realtime/<room>?ticket=<ticket>`. */
export const REALTIME_PREFIX = "/realtime";

/** The binding of the objects in `apps/api/wrangler.jsonc`. */
export const ROOM_BINDING = "REALTIME_ROOM";
