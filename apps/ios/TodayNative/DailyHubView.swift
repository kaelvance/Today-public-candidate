import SwiftUI
import UniformTypeIdentifiers
import TodayNativeCore

struct DailyHubView: View {
    @State private var store = DailyHubStore()
    @State private var showImporter = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("今日を、確かめる。")
                        .font(.title2.weight(.semibold))
                    Text("Today Native · V3 開発プレビュー")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text("読み取り専用です。AI・外部API・iMessageには接続しません。")
                }
                if let overview = store.overview {
                    overviewSections(overview)
                } else {
                    Section("未接続") {
                        Text("Webで明示的に書き出した日次サマリーJSONを選択してください。")
                        Text("端末間の同期・アカウント認証は未実装です。")
                            .foregroundStyle(.secondary)
                    }
                }
                if let error = store.errorMessage {
                    Section("読み込みエラー") { Text(error).foregroundStyle(.red) }
                }
                Section("プレビューの操作") {
                    Button("日次サマリーJSONを読み込む", systemImage: "doc.badge.plus") { showImporter = true }
                        .accessibilityIdentifier("import-overview")
                    Button("架空データで試す", systemImage: "sparkles") { store.loadDemo() }
                        .accessibilityIdentifier("demo-overview")
                    if store.overview != nil {
                        Button("表示データを消去", systemImage: "trash", role: .destructive) { store.clear() }
                            .accessibilityIdentifier("clear-overview")
                    }
                }
                .disabled(store.isImporting)
                Section("データの扱い") {
                    Text("選択したJSONだけをメモリ上で表示します。アプリは保存や外部送信をしません。元のファイルは消去されません。")
                        .font(.footnote)
                    Text("ファイルの出所・ハッシュの真正性は未検証です。操作の根拠や本人認証には使えません。")
                        .font(.footnote)
                }
            }
            .navigationTitle("Today")
            .overlay { if store.isImporting { ProgressView("読み込んでいます…") } }
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.json]) { result in
                switch result {
                case .success(let url): Task { await store.importFile(url) }
                case .failure: store.showImportFailure()
                }
            }
        }
    }

    @ViewBuilder
    private func overviewSections(_ overview: DailyOverview) -> some View {
        Section(store.isDemo ? "架空データ · 接続していません" : "取込ファイル · 出所未検証") {
            Text("\(overview.date) · \(overview.timeZone)").font(.headline)
            Text(overview.summary)
            TimelineView(.periodic(from: .now, by: 1)) { context in
                if overview.isExpired(at: context.date) {
                    Label {
                        Text("期限切れ · 現在の予定として使わないでください").foregroundStyle(.primary)
                    } icon: {
                        Image(systemName: "clock.badge.exclamationmark").foregroundStyle(.orange)
                    }
                        .accessibilityIdentifier("expired-overview")
                } else {
                    Text("失効時刻: \(overview.expiresAt)").font(.caption)
                }
            }
            Text("取得時刻: \(overview.capturedAt)").font(.caption).foregroundStyle(.secondary)
        }
        Section("タスク · 選択した項目だけ") {
            if overview.tasks.isEmpty { Text("選択したタスクは0件です。") }
            ForEach(overview.tasks) { task in
                VStack(alignment: .leading, spacing: 4) {
                    Text(task.title)
                    Text(task.reason).font(.caption).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
            }
        }
        Section("予定 · 選択した項目だけ") {
            if overview.events.isEmpty { Text("選択した予定は0件です。未取得の予定は含みません。") }
            ForEach(overview.events) { event in
                VStack(alignment: .leading, spacing: 4) {
                    Text(event.title)
                    Text(event.startAt ?? event.startDate ?? "日時未確認").font(.caption).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
            }
        }
        Section("取得状態") {
            LabeledContent("手動データ", value: overview.sources.local.state.label)
            LabeledContent("Google Calendar", value: overview.sources.calendar.state.label)
            LabeledContent("メール", value: "未確認")
            LabeledContent("天気", value: "未確認")
            ForEach(overview.warnings, id: \.self) { warning in
                Text(warning).font(.footnote)
            }
        }
    }
}
