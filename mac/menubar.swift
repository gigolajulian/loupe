// LOUPE menu bar watcher (Mac). Prints one JSON line whenever it changes:
//   {"trusted":true,"right":732,"status":1068}
// right: where the front app's menus end, status: where the menu bar icons start (global points, main screen).
// LOUPE moves its left ear out of the way when an app's menus reach it. Needs Accessibility for LOUPE.
import AppKit
import ApplicationServices

let barHeight: CGFloat = 60
func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
  var v: AnyObject?
  return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}
func frames(_ el: AXUIElement) -> [CGRect] {
  guard let kids = attr(el, kAXChildrenAttribute) as? [AXUIElement] else { return [] }
  return kids.compactMap { k in
    var p = CGPoint.zero, s = CGSize.zero
    guard let pv = attr(k, kAXPositionAttribute), let sv = attr(k, kAXSizeAttribute),
          AXValueGetValue(pv as! AXValue, .cgPoint, &p), AXValueGetValue(sv as! AXValue, .cgSize, &s) else { return nil }
    return CGRect(origin: p, size: s)
  }.filter { $0.minY < barHeight && $0.width > 0 }
}
let screenW = NSScreen.screens.first?.frame.width ?? 0
func menusRight() -> Int {
  guard let app = NSWorkspace.shared.frontmostApplication else { return 0 }
  let el = AXUIElementCreateApplication(app.processIdentifier)
  AXUIElementSetMessagingTimeout(el, 0.25)
  guard let bar = attr(el, kAXMenuBarAttribute) else { return 0 }
  return Int(frames(bar as! AXUIElement).filter { $0.minX < screenW }.map { $0.maxX }.max() ?? 0)
}
var statusCache = 0, statusAt = Date.distantPast
func statusLeft() -> Int {
  if Date().timeIntervalSince(statusAt) < 3 { return statusCache }
  statusAt = Date()
  var xs: [CGFloat] = []
  for app in NSWorkspace.shared.runningApplications where app.activationPolicy != .prohibited || true {
    let el = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(el, 0.1)
    if let extras = attr(el, "AXExtrasMenuBar") {
      xs += frames(extras as! AXUIElement).map { $0.minX }.filter { $0 > screenW / 2 && $0 < screenW }
    }
  }
  statusCache = Int(xs.min() ?? screenW)
  return statusCache
}

var last = ""
var asked = false
func tick() {
  let trusted = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: !asked] as CFDictionary)
  asked = true
  let line = trusted ? "{\"trusted\":true,\"right\":\(menusRight()),\"status\":\(statusLeft())}" : "{\"trusted\":false}"
  if line != last { last = line; print(line); fflush(stdout) }
}
NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { _ in
  DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { tick() } // the new app's menu bar settles
}
Timer.scheduledTimer(withTimeInterval: 0.6, repeats: true) { _ in tick() } // menus also change inside one app
// LOUPE quits: stdin closes, so do we
FileHandle.standardInput.readabilityHandler = { h in if h.availableData.isEmpty { exit(0) } }
tick()
RunLoop.main.run()
