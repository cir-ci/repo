export namespace Figma {
  /** The Figma frame a snapshot is linked to (on `Build.DiffItem`). */
  export interface Frame {
    fileKey: string
    /** The API's `12:34` form. */
    nodeId: string
    /** Opens the frame in Figma. */
    url: string
    /** The frame's name when CirCI has seen it. */
    frameName: string | null
  }
}
