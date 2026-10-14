import Foundation

public enum OverviewValidationError: Error, Equatable, Sendable {
    case oversized, invalidContract, invalidTime, invalidCounts, invalidRecord
}

public enum SourceState: String, Codable, Sendable {
    case ready, partial, stale, unavailable, disconnected, unconfigured

    public var label: String {
        switch self {
        case .ready: "取得済み"
        case .partial: "一部のみ"
        case .stale: "古いデータ"
        case .unavailable: "未確認"
        case .disconnected: "未接続"
        case .unconfigured: "未設定"
        }
    }
}
public struct SourceFreshness: Codable, Equatable, Sendable {
    public let state: SourceState
    public let retrievedAt: String?
}
public struct OverviewSources: Codable, Equatable, Sendable {
    public let local: SourceFreshness
    public let calendar: SourceFreshness
    public let mail: SourceFreshness
    public let weather: SourceFreshness
}
public struct OverviewCounts: Codable, Equatable, Sendable {
    public let overdue: Int
    public let dueToday: Int
    public let tasksSelected: Int
    public let manualEvents: Int
    public let calendarEvents: Int?
    public let mail: Int?
    public let weather: Int?
}
public enum TaskGroup: String, Codable, Sendable {
    case overdue, dueToday = "due_today", unscheduled, later
}
public struct OverviewTask: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let dueAt: String?
    public let sourceTime: String
    public let importance: Int
    public let group: TaskGroup
    public let reason: String
}
public enum EventSource: String, Codable, Sendable {
    case manual, googleCalendar = "google-calendar"
}
public struct OverviewEvent: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let sourceTime: String
    public let source: EventSource
    public let allDay: Bool
    public let startAt: String?
    public let endAt: String?
    public let startDate: String?
    public let endDate: String?
}

/// A read-only projection, not a task database, verified identity, or sync authority.
public struct DailyOverview: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let contractVersion: String
    public let coverage: String
    public let date: String
    public let timeZone: String
    public let generatedAt: String
    public let capturedAt: String
    public let expiresAt: String
    public let snapshotHash: String
    public let sources: OverviewSources
    public let counts: OverviewCounts
    public let summary: String
    public let warnings: [String]
    public let tasks: [OverviewTask]
    public let events: [OverviewEvent]

    public static let maxImportBytes = 131_072

    public static func decode(_ data: Data, now: Date = Date()) throws -> DailyOverview {
        guard data.count <= maxImportBytes else { throw OverviewValidationError.oversized }
        let overview = try JSONDecoder().decode(DailyOverview.self, from: data)
        try overview.validate(at: now)
        return overview
    }

    public func isExpired(at now: Date = Date()) -> Bool {
        guard let expiry = Self.instant(expiresAt) else { return true }
        return expiry <= now
    }

    public func validate(at now: Date = Date()) throws {
        guard schemaVersion == 1, contractVersion == "today.overview.v1", coverage == "selected_only",
              snapshotHash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              !timeZone.isEmpty, timeZone.utf8.count <= 80, let zone = TimeZone(identifier: timeZone),
              Self.validDay(date), Self.safeText(summary, max: 1024), warnings.count <= 20,
              warnings.allSatisfy({ Self.safeText($0, max: 1024) }), Set(warnings).count == warnings.count, tasks.count + events.count <= 250
        else { throw OverviewValidationError.invalidContract }
        guard let captured = Self.instant(capturedAt), let expiry = Self.instant(expiresAt),
              let generated = Self.instant(generatedAt), expiry > captured,
              expiry.timeIntervalSince(captured) <= 300,
              generated.timeIntervalSince(captured) >= -30,
              captured <= now.addingTimeInterval(30), generated <= now.addingTimeInterval(30)
        else { throw OverviewValidationError.invalidTime }
        for freshness in [sources.local, sources.calendar, sources.mail, sources.weather] {
            if let retrieved = freshness.retrievedAt {
                guard let value = Self.instant(retrieved), value <= now.addingTimeInterval(30) else {
                    throw OverviewValidationError.invalidTime
                }
            }
            if [.ready, .partial, .stale].contains(freshness.state), freshness.retrievedAt == nil {
                throw OverviewValidationError.invalidTime
            }
        }
        guard sources.local.retrievedAt == capturedAt,
              [.ready, .stale].contains(sources.local.state),
              sources.mail.state == .unavailable, sources.weather.state == .unavailable,
              sources.mail.retrievedAt == nil, sources.weather.retrievedAt == nil
        else { throw OverviewValidationError.invalidContract }
        var ids = Set<String>()
        for task in tasks {
            guard ids.insert(task.id).inserted, Self.safeID(task.id), Self.safeText(task.title, max: 240),
                  Self.safeText(task.reason, max: 240), (1...3).contains(task.importance),
                  Self.instant(task.sourceTime) != nil
            else { throw OverviewValidationError.invalidRecord }
            if let due = task.dueAt {
                guard let instant = Self.instant(due) else { throw OverviewValidationError.invalidTime }
                let day = Self.day(instant, zone: zone)
                let expected: TaskGroup = day < date ? .overdue : day == date ? .dueToday : .later
                guard task.group == expected else { throw OverviewValidationError.invalidRecord }
            } else if task.group != .unscheduled { throw OverviewValidationError.invalidRecord }
        }
        for event in events {
            guard ids.insert(event.id).inserted, Self.safeID(event.id), Self.safeText(event.title, max: 240),
                  Self.instant(event.sourceTime) != nil else { throw OverviewValidationError.invalidRecord }
            if event.allDay {
                guard event.startAt == nil, event.endAt == nil,
                      let start = event.startDate, let end = event.endDate,
                      Self.validDay(start), Self.validDay(end), start <= date, end > date
                else { throw OverviewValidationError.invalidTime }
            } else {
                guard event.startDate == nil, event.endDate == nil,
                      let rawStart = event.startAt, let start = Self.instant(rawStart)
                else { throw OverviewValidationError.invalidTime }
                let first = Self.day(start, zone: zone)
                var last = first
                if let rawEnd = event.endAt {
                    guard let end = Self.instant(rawEnd), end > start else { throw OverviewValidationError.invalidTime }
                    last = Self.day(end.addingTimeInterval(-0.001), zone: zone)
                }
                guard first <= date, last >= date else { throw OverviewValidationError.invalidRecord }
            }
        }
        let observedCalendar = events.filter { $0.source == .googleCalendar }.count
        guard counts.tasksSelected == tasks.count,
              counts.overdue == tasks.filter({ $0.group == .overdue }).count,
              counts.dueToday == tasks.filter({ $0.group == .dueToday }).count,
              counts.manualEvents == events.filter({ $0.source == .manual }).count,
              counts.mail == nil, counts.weather == nil,
              counts.calendarEvents == (sources.calendar.state == .ready ? observedCalendar : nil)
        else { throw OverviewValidationError.invalidCounts }
        if [.unconfigured, .disconnected].contains(sources.calendar.state), observedCalendar != 0 {
            throw OverviewValidationError.invalidRecord
        }
    }

    private static func safeText(_ text: String, max: Int) -> Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && text.utf16.count <= max
            && !text.unicodeScalars.contains { $0.value < 32 || $0.value == 127 }
    }
    private static func safeID(_ id: String) -> Bool {
        id.utf16.count <= 160 && id.range(of: "^[A-Za-z0-9_.:@/-]+$", options: .regularExpression) != nil
    }
    private static func instant(_ raw: String) -> Date? {
        guard raw.range(of: "^\\d{4}-\\d{2}-\\d{2}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{3})?Z$", options: .regularExpression) != nil,
              validDay(String(raw.prefix(10))) else { return nil }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = raw.contains(".") ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
        return parser.date(from: raw)
    }
    private static func validDay(_ raw: String) -> Bool {
        guard raw.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil,
              (Int(raw.prefix(4)) ?? 0) >= 1000 else { return false }
        let parser = DateFormatter()
        parser.calendar = Calendar(identifier: .gregorian)
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = TimeZone(secondsFromGMT: 0)
        parser.dateFormat = "yyyy-MM-dd"
        parser.isLenient = false
        guard let date = parser.date(from: raw) else { return false }
        return parser.string(from: date) == raw
    }
    private static func day(_ date: Date, zone: TimeZone) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}
