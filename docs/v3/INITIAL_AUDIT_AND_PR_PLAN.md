# V3 実装開始監査と作業順序

2026-10-10。対象はXcodeで開かれていた [Owner設計書](OWNER_ARCHITECTURE_SPEC.md)。V3全体の完了報告ではない。

本書はalpha.1開始時の監査記録。2026-10-11のalpha.2は端末認証・GatewayWorkspaceのoffline Mockへ進んだ。新しい範囲は [ADR 003](../adr/003-gateway-mock-before-live-identity.md)、現在の試験・未検証事項は [実装状況](IMPLEMENTATION_STATUS.md) を参照。本書の実機/E2E gateをalpha.2で再実行済みとして流用しない。

## 1. 確認した基準

- 公開V2.1.0のReleaseを匿名で読み取り確認した。[一次資料](https://github.com/kaelvance/Today-public-candidate/releases/tag/v2.1.0)。公開ページ上のidentityとローカル基準HEADが一致。
- commit: `3e3b6a25c9053090373ef1d7d91dd87439be3a6a`。tree: `dea7060b6bda7d7ea6a7c8670774ff9b280a998f`。
- 管理済みsource ZIP SHA-256: `3fa42c3db5b12d83c547b892c328c879fad5b7935e346702206f508ab4237086`。今回ZIPを再取得・再qualificationしたという意味ではない。
- 作業コピーは `work/v3.0.0-alpha.1/source`、ブランチは `dev/v3-overview-alpha1`。新しい正式tag、commit、Release、push、デプロイは行わない。
- 変更前の基準ソースにSwift・Xcodeプロジェクトはなかった。Xcodeに開かれていたのはDownloadsの設計書であり、既存iOS製品ではなかった。
- 基準の実ユーザーIndexedDB、バックアップ、メール、Messages、Notion、Drive、資格情報は読み取らない。

## 2. 確認済みファイルマップ

| 範囲                    | 実装の位置                                                                       | 現状                                                                         |
| ----------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 4画面・入力・変更・完了 | `src/App.tsx`, `src/Navigation.tsx`, `src/TodaySurface.tsx`, `src/TodayItem.tsx` | Web製品コード                                                                |
| Domain / Context        | `src/domain/`, `src/domain/context-engine.ts`, `src/application/today.ts`        | 既存Coreを維持                                                               |
| 保存                    | `src/storage.ts`, `src/PersistenceGate.tsx`                                      | schema v3、IndexedDB + localStorage鏡、単一writer。サーバーDBではない        |
| サーバー                | `server/index.mjs`                                                               | loopbackのみ。署名cookieはブラウザセッションでありユーザーアカウントではない |
| Google                  | `server/calendar.mjs`, `server/gmail.mjs`, `src/adapters/google-calendar.ts`     | OAuth・取得構造あり。今回実アカウントは接続しない                            |
| AI Chat                 | `src/chat/`, `src/ChatPanel.tsx`, `server/chat-*.mjs`                            | WebLLM / local / API optional。既存Gammaを汎用Chatと見なさない               |
| AI操作                  | `src/application/chat-commands.ts`                                               | 既存の承認付きCore操作                                                       |
| Messaging               | `src/chat/messaging.ts`, `server/telegram-preview.mjs`                           | Mock / injected fixture。実iMessageではない                                  |
| Service Worker          | `public/sw.js`, `src/main.tsx`                                                   | 静的キャッシュ・更新。新しい個人情報APIは別途除外が必要                      |
| V3設計7点               | `docs/TODAY_V3_*.md`                                                             | 過去の設計と将来構想。記載された実験結果を現在の新実装のPASSとして流用しない |
| CI・公開証跡            | `.github/workflows/`, `docs/qualification/`                                      | V2の履歴。今回の新identityの公開qualificationではない                        |

パスが過去設計と異なるときは、実コードと本書を優先する。実アカウント接続、iPhone実機、外部AIの評価を今回確認済みとは扱わない。

## 3. ギャップ

V3の恒久的なユーザー認証・端末登録・tenant分離・正本DB・同期・outbox・MCP・ネイティブAI・Messages extension・常駐Bridgeは基準V2にない。ブラウザIndexedDBをMac Gatewayから直接読む方法も実装されていない。既存署名cookieはこれらの代替にならない。

## 4. ADRと選択肢

[ADR 001](../adr/001-v3-readonly-projection.md) は明示的な短期スナップショットと将来の正本移行を比較する。[ADR 002](../adr/002-native-readonly-contract.md) はファイル型ネイティブプレビューと端末認証を分ける。

1. IndexedDBの無断直読 / 常時コピー: 採用しない。ブラウザ権限・データ正本・競合・削除の契約がない。
2. V2を全面的にサーバーDBへ移す: 今回は採用しない。移行/復旧/オフラインのリスクが大きい。
3. 明示選択の読み取り用projection: 最初の縦切りに採用。永続同期、完全な日程取得、閉ブラウザ常駐とは区別する。

## 5. 実装順序（ローカルで作成する単位。GitHub PRは未作成）

| 順序 | 内容                                            | 依存                          | 完了ゲート                                               |
| ---- | ----------------------------------------------- | ----------------------------- | -------------------------------------------------------- |
| 1    | readonly DTO / 日付・鮮度 / 決定的サマリー      | V2の読み取り投影              | DST・暦日・null・不正形式の契約試験                      |
| 2    | ローカルsession政策 / GET overview / 選択と破棄 | 1                             | 匿名・別session・外部origin拒否、TTL、保存不変、SW非保存 |
| 3    | Xcode / SwiftUI readonly preview                | 1                             | JS→Swift fixture、Simulator buildと画面操作              |
| 4    | 端末認証 / GatewayWorkspaceの正本 / revocation  | 1–3、所有者との権限・配布方針 | tenant・端末間のnegative auth、削除と復旧                |
| 5    | MCP readonly / controlled Core commands         | 4                             | 実クライアント2種、scope/confirmation/replay/監査        |
| 6    | App Intents / Messages extension                | 3–5、実機とApple要件          | user initiated操作・拡張生命周期・実機検証               |
| 7    | Mac Bridge実験・自動返信                        | 4–6、個別承認                 | 本人会話の認証、誤送信/loop/再送、緊急停止               |
| 8    | 正式release qualification                       | 上記の対象範囲固定            | 新source identityの全gate、Owner公開承認                 |

## 6. リスク・移行・試験

- 既存schema、task状態遷移、Domain正本は変更しない。Webから明示選択した最小DTOを作るだけ。
- 旧WorkerのAPIキャッシュ問題には `/api/v3/*` alias と新Workerの `/v3/*` 除外で対処する。
- 終日予定はV2のUTC変換時点で元の浮動暦日が失われている。正式な暦日移行を設計するまでWeb投影から除外する。
- 同じbrowser sessionを共有するタブは同じ短期grantを共有する。タブ単位・アカウント単位の隔離を実装したとは扱わない。
- 別マシン/実iPhoneへのHTTP接続は無効。loopbackをLAN公開したりCORSを緩めたりしない。
- `TODAY_V3_OVERVIEW=0` または未設定でAPIを停止できる。プロセス終了で全snapshot/grantを破棄する。V2の保存データを戻すmigrationは不要。
- 新APIのproviderは直接取得しない。メール・天気は明示的に未確認。AIも使わない。
- 型/単体/認可/既存security・Chat回帰、Service WorkerとWeb E2E、axe、JS→Swift契約、Simulator操作を今回のgateとする。
- Ubuntu・実Safari・実iPhone・MCP・モデル品質・実OAuth・App Store審査・production SLOは今回未実施。

実行ログと結果は [実装状況](IMPLEMENTATION_STATUS.md) に記録する。費用・危険性の停止条件は [安全・費用境界](SAFETY_AND_COST.md) を参照。
