# Configuration

通常起動には設定ファイルが不要です。任意の設定は`.env.local`またはプロセス環境変数へ入れます。`.env.example`の値は空または公開の既定値です。Nodeのdotenv形式で、shellの`$PWD`展開をファイル内へそのまま書かないでください。相対パスは起動時のリポジトリrootから解決されるため、README通りrootで実行します。

| 項目                                                              | 用途 / 必要条件                                                   |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET                           | 任意Calendar OAuth client                                         |
| GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET                             | 任意Gmail OAuth。未指定はGoogle clientを利用                      |
| TODAY_TOKEN_KEY                                                   | 32bytesのbase64鍵。Google接続時のみ必須                           |
| TODAY_TOKEN_STORE                                                 | Git外の暗号化保存ファイル。Google接続時のみ必須                   |
| OPENAI_API_KEY / TODAY_AI_MODEL                                   | 任意legacy手動入力補助。両方必要、UIオンが別途必要                |
| TODAY_LOCAL_MODEL_DIR / TODAY_LOCAL_PYTHON                        | 別取得モデルのdirectoryとPython実行ファイル                       |
| TODAY_LOCAL_MODEL_MANIFEST                                        | baseファイルのsha256/bytes/id。64KiB以下                          |
| TODAY_LOCAL_ADAPTER_DIR / TODAY_LOCAL_ADAPTER_MANIFEST            | 別取得Adapterとmanifest。今回非同梱                               |
| TODAY_LOCAL_MODEL_PORT                                            | MLX loopback port。既定8092                                       |
| TODAY_REMOTE_ENDPOINT / TODAY_REMOTE_MODEL / TODAY_REMOTE_API_KEY | 任意operator指定HTTPS JSON endpoint。ブラウザに鍵を返さない       |
| TODAY_REMOTE_PROTOCOL                                             | today-json（既定）またはopenai-chat                               |
| TODAY_REMOTE_ALLOW_LOCAL_PRIVATE                                  | trueの場合だけUIの手動項目remote許可が有効                        |
| TODAY_OLLAMA_MODEL / TODAY_OLLAMA_ENDPOINT                        | 既に別導入したmodel/daemon。既定127.0.0.1:11434、pull自動実行なし |

開発・試験向けにTODAY_LOCAL_MODEL_SHA256 / TODAY_LOCAL_ADAPTER_SHA256と、既存loopback runtimeのTODAY_LOCAL_MODEL_URLもあります。通常はmanifestによる全ファイル検証を使います。hash未設定や欠損・不整合は利用不可です。サーバーの構成エラーはモデルだけを無効にし、Coreは継続します。

ポートは`pnpm start -- --port 4273`（devの場合は`pnpm dev -- --port 5273`）。Google callbackも同じportへ合わせます。モデルのportはCoreと別です。HTTP origin/Hostは厳密に`127.0.0.1:port`で、LAN公開や任意Host名をサポートしません。

全AI停止は**AIアシスト＝オフ＋処理方法＝AIを使用しない**。provider statusの取得は同一originで続きますが、推論やモデル取得は実行しません。
