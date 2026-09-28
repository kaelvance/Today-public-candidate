# Plugin and extension contracts

Source Pluginは`src/extensions/source-plugin.ts`のversion1契約です。manifestのid/version/license/capabilities/permissionsを検証し、許可されたread-only recordsを最大200件正規化します。id/sourceId/externalId、日時、文字列長、actionsのtype/risk値を検証します。エラー時はDEGRADEDとなり既存Coreのitemsを変更しません。読書会サンプルはLOCAL_SAMPLE、架空fixture、MITで、実サービスではありません。

作者は`sourcePluginContract`とsource-pluginテストを参照し、health、identity、normalization、重複ID、権限拒否、オフライン、例外を検証してください。NETWORK_READは宣言と許可が必要ですが、同一JSプロセスのコードに対するsandboxではありません。悪意あるPluginはOS/browser権限を使えるため、任意remoteコードの自動download/実行を提供しません。ハングするhealthや同期コードのCPU無限ループはtrusted codeの品質問題で、完全隔離はありません。

Source Provider契約は`provider-contract.ts`と`src/ports/providers.ts`、Model Provider契約は`model-contract.ts`と`src/intelligence/types.ts`。Modelはcapabilities/locality/modelClass、available、inferを提供し、routerが期限・並列数・privacy・schema・source fingerprintを管理します。model出力にtool実行やstate mutationの権限を渡しません。契約を満たすことと実サービスの動作/品質が検証済みであることは別です。
