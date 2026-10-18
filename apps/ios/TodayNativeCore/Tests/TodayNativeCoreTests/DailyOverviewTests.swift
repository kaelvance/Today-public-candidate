import Foundation
import XCTest
@testable import TodayNativeCore

final class DailyOverviewTests: XCTestCase {
    private func fixture() throws -> Data {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "fictional-overview", withExtension: "json", subdirectory: "Fixtures"))
        return try Data(contentsOf: url)
    }
    private func changed(_ update: (inout [String: Any]) -> Void) throws -> Data {
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: fixture()) as? [String: Any])
        update(&object)
        return try JSONSerialization.data(withJSONObject: object)
    }
    func testActualJavaScriptAssemblerFixtureDecodesWithoutLosingUnknownProviderState() throws {
        let overview = try DailyOverview.decode(fixture())
        XCTAssertEqual(overview.counts.tasksSelected, 2)
        XCTAssertEqual(overview.counts.dueToday, 1)
        XCTAssertNil(overview.counts.calendarEvents)
        XCTAssertNil(overview.counts.mail)
        XCTAssertNil(overview.counts.weather)
        XCTAssertEqual(overview.sources.calendar.state, .unconfigured)
    }
    func testExpiredProjectionRemainsReadableButIsNeverCurrent() throws {
        let overview = try DailyOverview.decode(fixture())
        XCTAssertFalse(overview.isExpired(at: Date(timeIntervalSince1970: 1_791_590_399)))
        XCTAssertTrue(overview.isExpired(at: Date(timeIntervalSince1970: 1_791_676_800)))
    }
    func testFutureSchemaAndUnknownCoverageAreRejected() throws {
        for changes in [{ (v: inout [String: Any]) in v["schemaVersion"] = 2 },
                        { (v: inout [String: Any]) in v["coverage"] = "complete" }] {
            XCTAssertThrowsError(try DailyOverview.decode(changed(changes)))
        }
    }
    func testExcessiveExpiryAndInvalidDateAreRejected() throws {
        XCTAssertThrowsError(try DailyOverview.decode(changed { $0["expiresAt"] = "2026-10-10T00:10:00.000Z" }))
        XCTAssertThrowsError(try DailyOverview.decode(changed { $0["date"] = "2026-02-30" }))
        XCTAssertThrowsError(try DailyOverview.decode(changed { $0["timeZone"] = "fictional/zone" }))
    }
    func testMissingProviderIsNotForgedIntoZero() throws {
        XCTAssertThrowsError(try DailyOverview.decode(changed {
            var counts = $0["counts"] as! [String: Any]
            counts["calendarEvents"] = 0
            $0["counts"] = counts
        }))
    }
    func testFutureCaptureOrProviderClockCannotClaimCurrentData() throws {
        let parser = ISO8601DateFormatter()
        let clock = try XCTUnwrap(parser.date(from: "2026-10-09T23:00:00Z"))
        XCTAssertThrowsError(try DailyOverview.decode(fixture(), now: clock))
        XCTAssertThrowsError(try DailyOverview.decode(changed {
            var sources = $0["sources"] as! [String: Any]
            sources["calendar"] = ["state": "stale", "retrievedAt": "2040-01-01T00:00:00.000Z"]
            $0["sources"] = sources
        }))
    }
    func testContradictoryCountsAndTaskGroupsAreRejected() throws {
        XCTAssertThrowsError(try DailyOverview.decode(changed {
            var counts = $0["counts"] as! [String: Any]
            counts["dueToday"] = 99
            $0["counts"] = counts
        }))
        XCTAssertThrowsError(try DailyOverview.decode(changed {
            var tasks = $0["tasks"] as! [[String: Any]]
            tasks[0]["group"] = "overdue"
            $0["tasks"] = tasks
        }))
    }
    func testDuplicateIDsAndControlCharactersAreRejected() throws {
        XCTAssertThrowsError(try DailyOverview.decode(changed {
            var tasks = $0["tasks"] as! [[String: Any]]
            tasks[1]["id"] = tasks[0]["id"]
            $0["tasks"] = tasks
        }))
        XCTAssertThrowsError(try DailyOverview.decode(changed {
            var tasks = $0["tasks"] as! [[String: Any]]
            tasks[0]["title"] = "unsafe\u{0000}control"
            $0["tasks"] = tasks
        }))
    }
    func testEventEndOrderingAndOutOfDayEventsAreRejected() throws {
        XCTAssertThrowsError(try DailyOverview.decode(changed {
            var events = $0["events"] as! [[String: Any]]
            events[0]["endAt"] = "2026-10-10T01:00:00.000Z"
            $0["events"] = events
        }))
        XCTAssertThrowsError(try DailyOverview.decode(changed {
            var events = $0["events"] as! [[String: Any]]
            events[0]["startAt"] = "2026-10-11T03:00:00.000Z"
            events[0]["endAt"] = NSNull()
            $0["events"] = events
        }))
    }
    func testBoundedFileAndTruncatedJSONAreRejected() throws {
        XCTAssertThrowsError(try DailyOverview.decode(Data(repeating: 32, count: DailyOverview.maxImportBytes + 1)))
        XCTAssertThrowsError(try DailyOverview.decode(Data("{".utf8)))
    }
    func testDuplicateWarningsAreRejectedForStableViewIdentity() throws {
        XCTAssertThrowsError(try DailyOverview.decode(changed { value in
            let warnings = value["warnings"] as! [String]
            value["warnings"] = warnings + [warnings[0]]
        }))
    }
}
