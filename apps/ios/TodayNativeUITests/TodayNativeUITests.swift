import XCTest

final class TodayNativeUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testStartsDisconnectedAndOnlyUsesExplicitFictionalData() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["未接続"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["架空の資料を確認する"].exists)
        let demo = app.buttons["demo-overview"]
        if !demo.isHittable { app.swipeUp() }
        demo.tap()
        XCTAssertTrue(app.staticTexts["架空データ · 接続していません"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "架空の資料を確認する")).firstMatch.exists)
        app.swipeUp()
        app.swipeUp()
        let clear = app.buttons["clear-overview"]
        XCTAssertTrue(clear.waitForExistence(timeout: 5))
        clear.tap()
        app.swipeDown()
        XCTAssertTrue(app.staticTexts["未接続"].exists)
    }
}
