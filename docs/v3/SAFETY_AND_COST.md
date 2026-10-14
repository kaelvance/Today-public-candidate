# 費用0円と安全性の開発境界

> RC1の現在の実装・検証は [実装記録](IMPLEMENTATION_STATUS.md) と [Mac保存庫](LOCAL_VAULT.md) を参照。以下はalpha基盤の範囲・履歴で、local vaultの試験結果とは区別する。

Ownerの2026-10-10追加指示: お金をかけないこと・安全性優先。危険を確認したら原因/影響を追加調査し、本人判断が必要な時だけ質問する。

## 2026-10-11 alpha.3の追加範囲

新しく生成する0700私有directoryと0600のfixture SQLiteだけに架空projectionを保存する。実IndexedDB/backup/メール/秘密情報は開かない。試験用子processを停止して復旧を検証し、試験が生成したdirectoryだけをcleanupする。追加依存・有料契約・モデルdownload・実API・公開は0。

DBは非暗号化で、実個人情報を投入する資格はない。process crashと停電を区別し、機器durability・retention/delete・暗号鍵・実認証は後続gate。S-01/M-01のfailure保存と修正は [永続化](PERSISTENCE_QUALIFICATION.md) / [移行](V2_MIGRATION_REPORT.md)。実Owner-only判断が必要な工程には進んでいない。

## 2026-10-11 alpha.2の追加範囲

端末の鍵所持証明、scope/tenant/期限/取消、single-writer/receipt/backupをoffline Mockで検証する。Owner portはtrusted test harness専用で、製品routeやAIへ渡さない。実アカウント・iPhone・TLS・永続DB・モデル推論は未接続。追加取得・有料契約・課金APIは0。

Mock Storeの架空entryは同じStore objectが生きている間保持する。Runtimeのcloseはauth RAMを破棄しwriterをdrainするが、再起動/復旧試験のためentryを残す。期限切れはread拒否であり自動削除ではない。alpha.1の短期共有とこの試験用Storeの保持を混同しない。実データのretention/削除/暗号化は製品接続前の未解決gate。

今回G-01（未署名read-initで枠を消費）とG-02（再起動でentry上限超過）を再現し、failure保存→最小修正→targeted→回帰を行った。[安全性レビュー](GATEWAY_SECURITY_REVIEW.md) と [実行結果](IMPLEMENTATION_STATUS.md) を参照。継続監視サービスや外部AIへの送信は作成・実行していない。

## 現在実行するもの

- 既存Node/Xcode/Swift/Simulator、既存のJS依存を使うlocal build/test。
- 独立したsource copy、架空fixture、新規browser test profile、Simulatorの試験アプリ。
- 公開の一次資料の読み取り。実ユーザーDB、メール、Messages、Drive、Notion内容、秘密情報は読み取らない。
- 新APIは決定的な整形のみ。LLM/providerネットワークを呼ばない。E2Eでは外部リクエストを遮断して記録する。
- local sampleの表示、選択したprojectionのRAM共有、explicit export/revoke。

新規課金・API使用料・有料契約・新モデル取得・public service起動・Store加入はこの作業では0。既に契約している開発環境、電力、既存回線の料金を新しく発生させないことと、これら全体が無料であることは別であり、後者は保証しない。

## 停止条件

次のような操作が本当に必要になったら、その操作前で停止し、目的・露出/費用・代替案を示してOwnerへ1アクションで依頼する。

- 課金、無料枠超過で請求の可能性、新しい契約・Store加入。
- OAuthscope、provider権限、実ユーザーデータ送信、private tool/accountアクセスを増やす。
- 本人認証、法的/ライセンス判断、公開、署名、メッセージ実送信。
- OSセキュリティ機構の回避。SIPを無効化する経路は採用しない。

## 危険性の確認方法

この開発中にコードレビュー、negative-auth、CSRF/origin、TTL/revoke、bounded input、malformed/duplicate ID、provider欠損、時刻境界、SW非保存、Core DB不変、DTO誤表示を確認する。継続監視の常駐サービスや外部AI監視契約を自動作成しない。

重大問題は `fail → evidence → 原因調査 → 最小修正 → targeted test → regression` の順で扱う。gateを削除してPASSにしない。現時点の重大な将来課題は、遠隔端末認証、永続workspace正本/同期、権限取消/削除連鎖、MCP client identity、外部操作confirm/replay、iMessage第三者会話の認証と規約。

## alpha.1で見つけた問題（履歴）

1. 新しい `/v3` GETは既存SWの汎用キャッシュに入る可能性。新SWで除外し、旧SWも除外する `/api/v3` aliasをWebに使用。response `no-store` だけでCache Storage保存を防げるとは仮定しない。
2. V2終日eventは元の浮動暦日が失われる。曖昧な日付を作り直さず、今回のWeb共有対象から外す。契約自体は正しいfloating date/end exclusiveを扱える。
3. 署名cookieはアカウント認証ではない。遠隔公開をせずlocal-only policyと明記。
4. Xcode初回のarch不一致とiCloud生成bundleのFinder metadata。failure logを保持し、Debug active archとiCloud外build先で解決。署名検証の保護を緩めて回避していない。
5. Native取込JSONのfuture capture/provider時刻で鮮度を偽装できた。現在時刻からの許容差を検証し、future fileを拒否する試験を追加した。

今後のモデル/外部API採用も、従量課金が無効・停止可能と確認できるまで使用しない。必要なら0円のlocal/mockへ縮小する。
