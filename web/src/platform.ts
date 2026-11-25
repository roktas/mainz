// Identifies Apple touch devices across desktop-class user agent reporting.

export function isAppleTouch(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 0)
  )
}
