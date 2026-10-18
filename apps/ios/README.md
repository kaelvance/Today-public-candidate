# Today Native — 読み取り専用の開発プレビュー

V3 RC1はこのreadonly previewを含む。Node生成の架空Ed25519署名/AES-GCM ciphertextをCryptoKitで確認する `GatewayProofTests` を追加した。byte互換の試験であり、live Mac接続・本人認証・鍵管理・Native AIの完成ではない。現在のscopeと実行済み結果は [RC実装記録](../../docs/v3/IMPLEMENTATION_STATUS.md) を参照。

Xcodeで `TodayNative.xcodeproj` を開き、`TodayNative` schemeとインストール済みiPhone Simulatorを選択してRun。deployment targetはiOS17。今回確認した環境はXcode27 / iOS27 Simulatorであり、iOS17実機のPASSではない。

初期状態は未接続。**架空データで試す**を押すと固定日時の架空サマリーが表示される。期限切れ表示は正しい動作であり、古い予定を現在として扱わない。**表示データを消去**はメモリ表示だけを消し、元JSONを消さない。

## Webからの手動プレビュー

1. 独立したV3作業コピーを `TODAY_V3_OVERVIEW=1` でloopback起動。
2. **V3 日次サマリー実験** → 項目の選択・共有同意 → 生成。
3. 内容とファイルに残る情報を確認して **iPhoneプレビュー用JSONを書き出す**。
4. iOSのFilesから本人がそのJSONを選択する。アプリは選択ファイル以外を探索しない。

アプリ自身のDocumentsはFilesに表示できます。将来のDB・秘密情報をこの公開用フォルダーに置く設計ではありません。試験では新しいSimulatorアプリのDocumentsに架空JSONだけを入れて選択します。

これは手動のファイルプレビューで、ユーザー認証・同期・Mac常駐・iMessage・AI ChatのNative実装ではない。128KiBまでの対応契約のみ。出所/真正性は未検証。import失敗時は古い内容をクリアし、最新取得に成功したように扱わない。

## ローカル検証・生成

プロジェクトを追加の有料ツールなしで再生成するにはrootから:

```sh
node scripts/v3-contract-fixture.mjs
node scripts/v3-ios-project.mjs
swift test --package-path apps/ios/TodayNativeCore --scratch-path /private/tmp/today-native-core --jobs 2
xcodebuild -project apps/ios/TodayNative.xcodeproj -scheme TodayNative \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -derivedDataPath /private/tmp/today-native-build -jobs 2 build CODE_SIGNING_ALLOWED=NO
```

コード署名と外部依存取得は不要。iCloud/Files管理下の生成bundleにFinder metadataが付く環境では、build先を`/private/tmp`など管理外へ置く。現在のbuildログ・xcresultはsource外の `../evidence` に残す。

MIT / Kaito Kuonは既存TodayソースのLICENSEを継承する。モデル重みは含まない。

監査、段階計画、安全性、未実装範囲は [V3監査](../../docs/v3/INITIAL_AUDIT_AND_PR_PLAN.md) と [実装状況](../../docs/v3/IMPLEMENTATION_STATUS.md) を参照。
