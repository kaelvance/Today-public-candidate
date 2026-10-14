# ADR 001 — V2正本を保持した読み取り投影

状態: 最初のローカル縦切りに採用。V3 production全体の最終判断ではない。

## 根拠

`src/storage.ts` の正本はbrowser IndexedDB。`server/index.mjs` はこのDBへアクセスできない。V2 cookieは署名済みlocal browser sessionであり、ユーザーやリモート端末を認証しない。無料・安全・既存保存互換性を維持したままV3のAPI契約を確立する必要がある。

## 決定

Web上の明示選択 + 同意後に、最大250項目・入力64KiBの最小projectionをloopbackサーバーへ登録する。task/eventへの新しい変更APIは作らない。projectionはCoreへ書き戻さない。snapshot/grantはRAMのみ、最大5分でアクセスを失効し参照を破棄する。runtime timerが停止・遅延してもread時刻による失効検証を行う。JSメモリの物理的ゼロ化は保証しない。

読み取りは署名session、same-origin、固定read scopeのgrantを要求する。queryからtenantやscopeを指定できない。max32session・publication12回/分の上限。scopeは `brief:read`, `tasks:read`, `agenda:read`。アカウント/端末認証とは呼ばない。

`GET /v3/overview?date=...&tz=...` が基本契約。旧SWとの互換性からWebは `/api/v3/overview` alias を使用する。どちらも `no-store`。POST/DELETE snapshotもaliasあり。HTML・説明・メール本文・OAuth情報をDTOへ含めず、unknown fieldsを拒否する。

## データ・時刻

`sourceTime` はrecord更新時刻、`capturedAt` はbrowser取得時刻、provider `retrievedAt` は最終sync時刻。upload時刻でproviderを新鮮に見せない。`coverage=selected_only`。missing/partialのprovider件数はnull。model outageでも同じサマリーを生成するが、モデル能力を評価したという意味ではない。

将来のGatewayWorkspace/同期は、単一writer・revision/ETag・outbox・削除・export/revoke・バックアップ移行を決めてから設計する。ブラウザを閉じた後、期限内のprojectionを読むことはできても、最新状態へ自動更新することはない。

## 代替案と未解決

全面DB移行は高い互換性/復旧検証コストがある。MacによるIndexedDBファイル直接読取はbrowserの権限・lock・データ整合性を壊す。現在の方式は取得範囲が手動選択で、接続済みproviderを完全取得するV3本体には達していない。localhostをLANやpublic endpointへ開放してこの設計を使ってはいけない。
