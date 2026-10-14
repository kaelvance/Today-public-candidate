import Foundation
import Observation
import TodayNativeCore

@Observable
@MainActor
final class DailyHubStore {
    private(set) var overview: DailyOverview?
    private(set) var isDemo = false
    private(set) var isImporting = false
    private(set) var errorMessage: String?

    func loadDemo() {
        guard !isImporting else { return }
        guard let url = Bundle.main.url(forResource: "fictional-overview", withExtension: "json"),
              let bytes = try? Data(contentsOf: url), let value = try? DailyOverview.decode(bytes)
        else { errorMessage = "架空データを読み込めませんでした。"; return }
        overview = value
        isDemo = true
        errorMessage = nil
    }

    func importFile(_ url: URL) async {
        guard !isImporting else { return }
        isImporting = true
        errorMessage = nil
        defer { isImporting = false }
        let scope = url.startAccessingSecurityScopedResource()
        defer { if scope { url.stopAccessingSecurityScopedResource() } }
        do {
            // Read at most the contract limit + 1; no unbounded file load, networking or persistence.
            let value = try await Task.detached(priority: .userInitiated) {
                let handle = try FileHandle(forReadingFrom: url)
                defer { try? handle.close() }
                let bytes = try handle.read(upToCount: DailyOverview.maxImportBytes + 1) ?? Data()
                return try DailyOverview.decode(bytes)
            }.value
            overview = value
            isDemo = false
        } catch {
            // Fail closed: a failed import never leaves an old snapshot appearing to be the new one.
            overview = nil
            isDemo = false
            errorMessage = "読み込めませんでした。Todayの日次サマリーJSON（128KB以下・対応形式）を選択してください。"
        }
    }

    func showImportFailure() { errorMessage = "ファイルを選択できませんでした。" }

    func clear() {
        guard !isImporting else { return }
        overview = nil
        isDemo = false
        errorMessage = nil
    }
}
