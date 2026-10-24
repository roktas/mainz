// Captures fixture geometry and native screenshots through Simulator Safari and installed web apps.

import XCTest

final class Probe: XCTestCase {
    @MainActor private func typing(_ alert: XCUIElement) -> Bool {
        guard alert.exists && (alert.label.localizedCaseInsensitiveContains("fullscreen") || alert.label.contains("Tam ekrandayken")) else { return false }
        let allow = alert.buttons.allElementsBoundByIndex.first { !["Exit Full Screen", "Leave Full Screen", "Tam Ekrandan Çık"].contains($0.label) }
        guard let allow else { return false }
        allow.tap()
        return true
    }

    @MainActor private func wait(_ element: XCUIElement, _ app: XCUIApplication, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if element.waitForExistence(timeout: 1) { return true }
            _ = typing(app.alerts.firstMatch)
        }
        return false
    }

    @MainActor private func prepare(_ app: XCUIApplication) {
        app.activate()
        let deadline = Date().addingTimeInterval(45)
        while Date() < deadline {
            _ = typing(app.alerts.firstMatch)
            if app.buttons["Close geometry"].exists { app.buttons["Close geometry"].tap() }
            if app.buttons["Geometry"].waitForExistence(timeout: 1) { return }
        }
        XCTFail("The geometry launcher did not become available.")
    }

    @MainActor private func open(_ app: XCUIApplication) {
        // WebKit can report a landscape launcher frame beyond the window; tap its visible leading portion.
        app.buttons["Geometry"].coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.5)).tap()
        XCTAssertTrue(wait(app.buttons["Close geometry"], app, timeout: 45))
    }

    @MainActor private func images(_ app: XCUIApplication, _ prefix: String) {
        for pane in ["Input", "Output"] {
            for density in ["Normal", "Compact"] {
                open(app)
                app.descendants(matching: .any).matching(identifier: "Grid views").firstMatch.tap()
                app.buttons["Show \(pane) \(density)"].tap()
                let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: app.buttons["Geometry"])
                XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 45), .completed)
                XCTAssertFalse(app.buttons["Close geometry"].exists)
                let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
                image.name = "\(prefix)-\(pane)-\(density)"
                image.lifetime = .keepAlways
                add(image)
            }
        }
    }

    @MainActor private func capture(_ standalone: Bool, _ landscape: Bool, _ searching: Bool = false, _ fullscreen: Bool = false) {
        continueAfterFailure = false
        if fullscreen {
            addUIInterruptionMonitor(withDescription: "Safari fullscreen typing") { alert in
                self.typing(alert)
            }
        }
        let app = XCUIApplication(bundleIdentifier: standalone ? "com.apple.webapp" : "com.apple.mobilesafari")
        prepare(app)
        XCUIDevice.shared.orientation = .portrait
        if landscape { XCUIDevice.shared.orientation = .landscapeLeft }
        let rotated = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let frame = app.windows.firstMatch.frame
            return landscape ? frame.width > frame.height : frame.height > frame.width
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [rotated], timeout: 10), .completed)
        if !standalone {
            // Restart Safari after rotation so XCTest does not wait on a stale browser-UI animation.
            app.terminate()
            app.launch()
            prepare(app)
        }
        open(app)
        XCTAssertTrue(wait(app.buttons["Reload fixture"], app, timeout: 20))
        app.buttons["Reload fixture"].tap()
        prepare(app)
        if fullscreen {
            open(app)
            if app.buttons["Exit browser fullscreen"].exists {
                app.buttons["Exit browser fullscreen"].tap()
                open(app)
            }
            XCTAssertTrue(wait(app.buttons["Enter browser fullscreen"], app, timeout: 10))
            app.buttons["Enter browser fullscreen"].tap()
        }
        images(app, "baseline")
        open(app)
        app.buttons[searching ? "Search candidates" : "Capture all views"].tap()
        let copy = app.buttons["Copy JSON"]
        XCTAssertTrue(wait(copy, app, timeout: searching ? 180 : 45))
        copy.tap()
        XCTAssertTrue(app.staticTexts["Geometry copied."].waitForExistence(timeout: 10))
        if searching && app.buttons["Preview candidate"].exists {
            app.buttons["Preview candidate"].tap()
            images(app, "candidate")
        } else { app.buttons["Close geometry"].tap() }
        let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        image.name = "native-grid"
        image.lifetime = .keepAlways
        add(image)
    }

    @MainActor func testSafariPortrait() { capture(false, false) }
    @MainActor func testSafariLandscape() { capture(false, true) }
    @MainActor func testStandalonePortrait() { capture(true, false) }
    @MainActor func testStandaloneLandscape() { capture(true, true) }
    @MainActor func testSearchSafariPortrait() { capture(false, false, true) }
    @MainActor func testSearchSafariLandscape() { capture(false, true, true) }
    @MainActor func testSearchStandalonePortrait() { capture(true, false, true) }
    @MainActor func testSearchStandaloneLandscape() { capture(true, true, true) }
    @MainActor func testFullscreenPortrait() { capture(false, false, false, true) }
    @MainActor func testFullscreenLandscape() { capture(false, true, false, true) }
    @MainActor func testSearchFullscreenPortrait() { capture(false, false, true, true) }
    @MainActor func testSearchFullscreenLandscape() { capture(false, true, true, true) }

    @MainActor func testInstall() {
        continueAfterFailure = false
        XCUIDevice.shared.press(.home)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        springboard.activate()
        let icon = springboard.icons["Mainz geometry"].firstMatch
        if icon.waitForExistence(timeout: 2) {
            for _ in 0..<3 where !icon.isHittable { springboard.swipeLeft() }
            icon.tap()
            prepare(XCUIApplication(bundleIdentifier: "com.apple.webapp"))
            return
        }
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        prepare(safari)
        XCUIDevice.shared.orientation = .portrait
        let share = safari.buttons["ShareButton"]
        if !share.exists && safari.buttons["MoreMenuButton"].exists {
            safari.buttons["MoreMenuButton"].tap()
        }
        XCTAssertTrue(share.waitForExistence(timeout: 10))
        share.tap()
        let sheet = XCUIApplication(bundleIdentifier: "com.apple.SharingUIService")
        let more = sheet.cells.matching(identifier: "actionGroupCell")
            .matching(NSPredicate(format: "label == 'More' OR label == 'Daha Fazla'")).firstMatch
        if more.waitForExistence(timeout: 3) { more.tap() }
        let install = sheet.cells.matching(NSPredicate(format: "label CONTAINS 'Add to Home Screen' OR label CONTAINS 'Ana Ekrana Ekle'")).firstMatch
        if !install.waitForExistence(timeout: 3) { sheet.swipeUp() }
        XCTAssertTrue(install.waitForExistence(timeout: 10))
        install.tap()
        let form = XCUIApplication(bundleIdentifier: "com.apple.SafariViewService")
        let add = form.buttons["AddToHomeScreenAddButton"]
        let ready = add.waitForExistence(timeout: 10)
        if !ready {
            print("MAINZ_INSTALL_FORM\n" + form.debugDescription + "\n" + safari.debugDescription)
            let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            image.name = "install-form"
            image.lifetime = .keepAlways
            self.add(image)
        }
        XCTAssertTrue(ready)
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: add)
        XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 15), .completed)
        add.tap()
        let home = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        home.activate()
        let installed = home.icons["Mainz geometry"].firstMatch
        if !installed.waitForExistence(timeout: 15) {
            print("MAINZ_INSTALL_HOME\n" + home.debugDescription)
            let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            image.name = "install-home"
            image.lifetime = .keepAlways
            self.add(image)
            XCTFail("Installed fixture icon is unavailable.")
        }
        for _ in 0..<3 where !installed.isHittable { home.swipeLeft() }
        installed.tap()
        let webapp = XCUIApplication(bundleIdentifier: "com.apple.webapp")
        prepare(webapp)
    }
}
