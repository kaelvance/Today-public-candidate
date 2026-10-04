# 公開ブラウザ版

利用URL: **https://kaelvance.github.io/Today-public-candidate/**

GitHubアカウント・インストール・開発者のMacへの接続は不要です。V2.0.0でソース公開とローカル起動だけを検証し、URLだけで利用できる公開サイトを用意していなかった不備をV2.0.1で修正しました。

## 利用できること

- 手動タスク・予定の作成、編集、完了、一覧から外す・取り消しと既存の決定的な入力解釈。
- Today／やること／カレンダー／ふりかえり、検索、テーマ、Context整理。
- このブラウザへの保存とバックアップの書き出し・読み込み。
- 初回オンライン読込後にキャッシュされたCoreのオフライン利用。

「一覧から外す」は整理済みとして項目を保持する操作です。本文の完全消去ではなく、ふりかえり・取り消しに使用します。バックアップにも保持された項目が含まれます。

## 保存と接続

### V2.0.2候補の保存競合対策

同じブラウザ保存領域で編集できるTodayタブは1つです。他のタブは待機し、編集タブを閉じると最新の保存内容を読み込んで自動再開します。待機中は編集やサービス同期を行いません。安全なタブ間調停ができない環境では編集を開始せず、対応ブラウザの利用を案内します。これは協調する公式ビルド間の保存保護で、同originの悪意あるコードへのsandboxではありません。

旧版の`current`／`today-prototype-state-v1`から、`current-v2`／`today-prototype-state-v2`へ初回移行します。旧コピーは消さず、新版は旧slotへ書き込みません。移行後に旧タブで行った変更は新版へ自動統合されません。更新前にバックアップを書き出し、旧タブをすべて閉じてください。旧版へのrollbackでは新版の項目を自動的に読めないため、手動バックアップを使用します。Web Locks非対応・取得拒否時に安全でないlocalStorage lockへfallbackしません。

項目はIndexedDB／localStorageに平文で保存します。サーバーや他の端末とは同期しません。ブラウザデータを消すと項目が失われます。共有端末では使わず、必要に応じバックアップを保存してください。プライベート／シークレットモードの保存は一時的な場合があります。ローカル版と公開版はoriginが異なる別の保存領域です。移行はバックアップの書き出し・読み込みで行います。同じ`https://kaelvance.github.io` originの他projectとはブラウザ保存のセキュリティ境界を共有します。URLのsubpathやservice workerのscopeはstorageを隔離するものではありません。

公開版は静的ファイルをGitHub Pagesから取得します。ホスティング側はページ取得に伴う通常の接続情報を扱います。Todayの項目・入力・バックアップをホスティング側へ送るAPIや解析機能はありません。

Google Calendar／Gmail・外部AI・ローカルモデルは公開版では利用しません。秘密情報をブラウザへ埋め込まず、存在しないAPIや開発者のMacへ接続しません。これらの任意連携はREADMEのローカル版の設定を使います。

## 配布・検証

`pnpm build:web`は`web` mode、`/Today-public-candidate/` baseで同じUIのCoreをbuildします。local版の通常buildはroot `/` とローカルサーバー連携を維持します。manifestとservice workerは配布先のscopeに合わせ、web buildはhashed assetsをprecacheします。

公開ファイルの`deployment.json`にversion・source commit・主要ファイルのSHA-256を記録します。GitHubの`Public browser` workflowは静的サーバーのsubpathでCore smokeを実行し、成功したdefault branchだけをPagesへ配布します。PRや他branchを自動公開しません。Release qualificationのNode22／24 required checksは維持します。

実公開URLの第三者試験とRelease receiptが公開完了の根拠です。local preview成功をインターネット公開成功とは扱いません。V2.0.0 tag／配布物は履歴として保持し、修正を付け替えません。
