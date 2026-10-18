# Today 3.0.0 — Webと同じMacの保存庫

## 公開対象

AIなしの4画面・Core保存・バックアップを維持し、任意の同一Mac保存庫を追加する。Web Chat、ユーザー承認付きmanual task/event操作、Mock Messagingを継承する。公開Pagesは静的Webであり、Mac保存庫を使うにはソースを取得して同じMacで起動する。

Mac保存庫はCoreの正本ではなく、本人が明示的に共有したコピー。ブラウザIndexedDB/localStorageは平文で、暗号化対象は保存庫の本文・archive・receiptである。保存庫の復元/消去はCoreやdownload済みbackupを変更しない。[詳細](LOCAL_VAULT.md)。

## RCからの修正

GPU Workerが停止要求へ応答しないとChatが取消・30秒timeout後も処理中になる問題を再現した。停止時にWorkerを終了し、待機promiseも明示的に拒否する。モデルの準備状態を再同期して再ロードを可能にする。遅延した推論結果を採用しない。通常のCore操作・保存schema・依存lockfileは変更しない。

Macの一時領域がsymlink表記の場合、保存庫E2Eのfixtureが正しく拒否されて試験を実行できなかった。テストの一時directoryを実pathへ正規化し、製品側のsymlink拒否は維持した。

実モデルで、共有情報が空でも来月の予定を確認したように答える問題を確認した。認識できる個人の予定・タスク照会は、共有が空ならモデルを呼ばず「確認できない」と返す。これは空予定の証明ではなく、自由文全般の幻覚防止保証でもない。モデルの回答は引き続き実験扱いとする。Service Workerのcache版も正式versionへ揃え、旧workerからの更新・下書き維持・offlineの既存gateを実行する。

## リリース判定

既存のMac Node22/24、Ubuntu22/24、format/lint/typecheck/unit/server/security/privacy/source/license/SBOM/dependency/build、全Core/Chat/Vault E2E、保存復旧・更新・offline・fresh source archiveを必須とする。Firefox/WebKitの既存互換suiteを維持する。

実モデルは既存の承認済みQwen cacheで日本語会話・複数ターン・日時・操作案/拒否・取消を評価する。構造化提案は決定的なvalidatorと承認を通し、実行成功は保存結果からだけ表示する。AIはoptional/experimentalで回答の正確性を保証しない。

署名済みローカルsession、Origin検査、同意、TTL、writer/CAS、故障時rollback、応答喪失の照合、バックアップを検証する。clockジャンプ・故障注入・SIGKILLの試験を、物理睡眠/停電/disk-fullの実機保証と呼ばない。

保護branch/required CI/PVR、匿名clone、公開Pagesのversion/commit/assetsとCore動作、managed source ZIPとGit treeの全byte/mode、tag/Release/assetsのSHA-256まで照合して初めて正式公開完了とする。未実行・未照合はPASSにしない。最終結果はRelease添付のreceipt/reportを参照。

## 提供しないもの・既知の限界

- 実iMessage、外部Messaging送信、MCP client、常駐AI、複数端末同期、Core正本移行、LAN/TLS/live iPhone認証は未対応。
- iOSはreadonly JSON previewの実験ソース。Simulator/Swift契約は実iPhone・iOS17の試験やApp Store提供の証明ではない。
- Gmail/Calendarは任意の読み取り専用接続で、実アカウント検証は別。メール送信/外部予定変更は提供しない。
- 対象は個人端末。同じOSの悪意あるprocess、XSS、盗まれたsession、全ディスクrollbackを完全に防ぐものではない。
- 自動a11y検査はWCAG認証ではない。全端末/全言語/全AI回答の正確性は未保証。
- モデル重み・Adapter・学習データは非同梱。追加取得・有料API・外部接続を自動実行しない。

[RCの範囲](RC_SCOPE.md)と[RC実装記録](IMPLEMENTATION_STATUS.md)の数値は履歴。新identityの合否へ自動流用しない。
