# Today カスタム機能の悪用リスク低減計画

Owner指示に基づく計画。**この文書の新しい対策はV2.0.2では実装しない。**

## 目標と限界

公式Todayを、任意コード実行、shell操作、端末制御、攻撃用network scan、資格情報取得、無許可の大量送信等をカスタム設定から実行できる基盤へ拡張しない。利用目的はtask／calendar／選択した情報の整理に限定する。

OSSのソースを利用者自身がfork・書き換え、別programとして実行することまで技術的に禁止することはできない。公式配布物の機能制限とidentity検証、運営するserver側の制限を保証対象にする。Web Locks、TypeScript型、manifest、artifact hashはsandboxや改変禁止の代わりにならない。

## 計画する設計

1. **データ設定だけを受け付ける。** JSON schemaを固定し、未知field、script、command、executable、任意module URL、任意HTTP headerを拒否する。provider presetと必要なpublic設定だけを選べるようにする。
2. **操作を列挙する。** Calendar読み取り等のAPI操作をserver allowlistに固定し、endpoint/method/認可scope/bodyを操作ごとに検証する。機能を拒否したときはCoreを維持する。
3. **AIに実行権を渡さない。** 出力は型付き提案としてのみ扱い、tool callやcommandを実行しない。外部文書・メール内の指示はデータとして扱う。将来のwrite／sendには対象・内容のpreviewとuser確認、冪等性を要求する。
4. **外部接続を制限する。** preset domain／TLS／redirect／DNS／IP／egress policyを検証。任意proxyやnetwork scannerを提供しない。SSRF対策は実backend構成の監査を経て実装する。
5. **拡張codeを信頼境界の外へ置く。** 動的pluginの前にisolated Worker/processと能力別brokerを設計する。filesystem、shell、任意network、tokenへの直接アクセスを渡さず、timeout・memory・record・call上限と強制停止を設ける。
6. **秘密情報の操作を限定する。** browserへsecretやrefresh tokenを永続化しない。認可code、token、cookie、keychain、個人原文をログ・backup・diagnosticへ出さない。設定testはfictionalな小さいrequestを使う。
7. **resource悪用を制限する。** アカウント／操作／server全体のrate、並列数、batch、body byte、処理時間を制限し、連続失敗は停止する。課金連携は予算通知だけに依存せずrequest停止手段を持つ。
8. **配布の改変検出を強化する。** protected branch／required CI／固定action SHA／dependency inventory／SBOM／archive hashを保持。署名・provenanceの導入は別検証し、改変版を公式版として表示しない。
9. **監査情報を最小化する。** 許可／拒否の操作ID、理由、時刻等を記録し、私的本文を保存しない。警告のために秘密を外部AIへ送らない。

## 実装前の受入基準

- 設定やbackupに実行file／shell命令を含めてもコードとして解釈しない。
- AI出力にtool call／危険な操作を含めてもproposal validator／operation policyで拒否する。
- allowlist外の通信、private IP、redirect先への資格情報転送を止める。
- 不正pluginをtimeoutで停止でき、既存保存と他providerを維持する。
- 無許可のwrite／send／大量処理をclientだけでなくserverで拒否する。
- 再認可・拒否・停止・削除の操作が一般利用者に理解できる。

## 調査資料

- [Web Locks仕様](https://www.w3.org/TR/web-locks/): 協調する同じ保存領域のscript間の調停であり、悪意ある同origin scriptの隔離ではない。
- [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html): 将来のserver接続設定の検証基準候補。
- [OWASP LLM Prompt Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html): 外部入力と実行権を分離する設計レビューの参考。

個々の対策は将来の構成と公式仕様を再確認して実装する。現在のTodayがこれらすべての新対策に合格したとは記載しない。
