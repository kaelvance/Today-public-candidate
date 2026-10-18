# ADR 002 — Nativeは同一DTOの読み取りから始める

状態: ローカルXcode/Simulator開発に採用。

## 決定

SwiftUIのiOSアプリとローカルSwift package `TodayNativeCore` を追加する。packageはDTOのdecode/validationのみで、Domain task DBの第2正本ではない。JS assemblerから生成した架空JSONを両側の契約fixtureに使う。既存CoreをSwiftへ全面移植しない。

初期画面は未接続。user-selected JSONをbounded read（128KiB）で読み込み、enum、schema、日時、件数、ID重複、期限、provider欠損を検証する。無効な取込で旧snapshotを新データに見せない。expiredは表示できても必ず古いと示す。ファイルの出所・hash真正性は未検証で、命令/操作/本人認証に使わない。アプリが無断でユーザーファイルを探索しない。JSONはメモリのみで、元のファイル削除・コピー保存を行わない。

## 範囲

同期、OAuth、URLSession、MCP、App Groups、通知、AI、Messages権限、署名アカウント、有料APIは今回追加しない。iPhoneにlive接続するためにMac cookieを抽出する方法も採用しない。独立した認証とscope/revocation/通信暗号化を先に作る。

Simulatorは署名・Apple Developer Programへの加入なしで利用する。正式配布/実機/Storeの条件や料金は別途確認し、Ownerの0円条件を満たせない手段は実行しない。

## Apple一次資料の確認

[App Intents](https://developer.apple.com/documentation/appintents/creating-your-first-app-intent) はSiri/Shortcuts等にapp actionを公開する枠組み。今回のアプリにはまだIntentがない。

[MSMessagesAppViewController](https://developer.apple.com/documentation/messages/msmessagesappviewcontroller) はMessages extensionのprincipal controllerで、現在のconversationとextension lifecycleを扱う。これを一般的な常駐iMessage Botや全会話読取APIだとは解釈しない。未検証のBridgeやSIP無効化を製品の前提にしない。

実機のbackground/lock screen/Files/extension/privacy/accessibilityは、Simulator試験からPASSを推定しない。
