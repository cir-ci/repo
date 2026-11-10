/** Web push: this server's key, the signed-in person's devices, and turning a device on or off. */
export namespace Push {
  /** `GET /api/push/public-key`: what the browser passes as `applicationServerKey` (base64url). */
  export interface PublicKey {
    publicKey: string
  }

  /** `POST /api/push/subscribe`: the browser's `PushSubscription` as JSON. */
  export interface SubscribeBody {
    endpoint: string
    keys: { p256dh: string; auth: string }
  }

  /** `POST /api/push/unsubscribe`: turns push off for this browser. */
  export interface UnsubscribeBody {
    endpoint: string
  }

  /** A browser of the person that takes push. */
  export interface Device {
    id: string
    /** Lets a browser tell which row is itself. */
    endpoint: string
    /** E.g. "Chrome on Android". */
    label: string
    /** ISO date. */
    createdAt: string
    /** The last time the push service accepted a push for it; null before the first. */
    lastUsedAt: string | null
  }

  /** `GET /api/push/devices`, `POST /api/push/subscribe`. */
  export interface Devices {
    devices: Device[]
  }
}
