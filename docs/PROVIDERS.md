# Providers

## Sourceの接続

Google OAuthのWeb clientを利用者自身の管理で用意します。Google Consoleへ使用する正確なredirect URIを登録します。通常起動は`http://127.0.0.1:4173/api/calendar/callback`と`http://127.0.0.1:4173/api/gmail/callback`、devはport5173です。必要なCalendar/Gmail APIを有効にし、アプリの公開状態・test user・Googleの同意画面要件を自身の環境で確認します。TodayのSource権限は読み取り専用です。Gmailはgmail.readonly、Calendarはcalendar.events.readonlyです。

`TODAY_TOKEN_KEY`は32bytesのbase64を端末上で生成し、`TODAY_TOKEN_STORE`をGit外へ指定します。例: `node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"`。鍵は表示・共有・コミットしないでください。`.env.local`を所有者のみ読める権限に設定します。設定後、再起動しUIの接続ボタンから本人が同意します。設定だけで勝手にOAuthログインしません。

暗号化tokenはAES-256-GCM、書込み0600・directory0700（新規作成時）、一時ファイルとrenameで保存します。既存directoryの権限は利用者が確認してください。Gmail/Calendarのtokenをブラウザへ返さず、ログへ記録しません。接続解除はローカルtoken削除とproviderへの取消を試みます。再起動しても鍵・保存先が同じ場合はsession署名を検証できますが、別origin/ブラウザは別sessionです。

## Model Provider

MLXは[MODELS](MODELS.md)、Ollamaは別のdaemonと既導入modelを指定します。Remoteはoperatorが信頼するHTTPS endpointのみを構成し、redirectを追いません。today-jsonは`{ model, messages, maxOutputChars }`に`{ text, modelId?, usage? }`、openai-chatはchat completionのchoicesを受けます。API keyはNode側で付与します。入力は16KiB、HTTP応答は64KiB、推論には期限があります。

RemoteへCONNECTED_SERVICE_DATA / SENSITIVE_CONTEXTを送る要求はサーバーが拒否します。LOCAL_PRIVATEはserver permissionとUI consentの両方が必要です。自由入力に含まれる秘密情報すべてを分類できる保証はありません。

## 今回の実接続状況

| Provider                 | 実環境                     | 契約/Mock                     |
| ------------------------ | -------------------------- | ----------------------------- |
| Google Calendar          | NOT_CONFIGURED             | MOCK_VERIFIED_ONLY            |
| Gmail                    | NOT_CONFIGURED             | MOCK_VERIFIED_ONLY            |
| Remote JSON / OpenAI互換 | NOT_CONFIGURED             | MOCK_VERIFIED_ONLY            |
| legacy OpenAI入力補助    | NOT_CONFIGURED             | MOCK_VERIFIED_ONLY            |
| Ollama                   | NOT_CONFIGURED             | MOCK_VERIFIED_ONLY            |
| MLX                      | ソース非同梱・Experimental | hash/起動/期限/停止を別途検証 |

Mockの成功は実アカウントや任意modelの品質を証明しません。資格情報なしで接続を強行しません。
