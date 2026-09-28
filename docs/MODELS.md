# Model setup

モデルは任意です。Today sourceに重み・Adapterはありません。モデルなしのCoreが標準の検証対象です。Mac Apple Silicon向けのMLX bridgeはExperimentalです。Windows/Linux上のMLX動作は保証しません。

## 明示的な取得と検証

`models/today-model/manifests/`のbase manifestを確認します。対象はQwenの**Qwen3-1.7B-MLX-4bit**、固定revision `21457c6f51ed54a7c16e988c0844db973815c137`です。上流はQwen3-1.7B、約1.72B parameters、MLX4bit/group128。利用者が[固定revision](https://huggingface.co/Qwen/Qwen3-1.7B-MLX-4bit/tree/21457c6f51ed54a7c16e988c0844db973815c137)と[Apache-2.0 LICENSE](https://huggingface.co/Qwen/Qwen3-1.7B-MLX-4bit/blob/21457c6f51ed54a7c16e988c0844db973815c137/LICENSE)を確認し、任意のGit外directoryへ明示的に取得します。取得ツールは自身で導入します。アプリは自動取得しません。

Python3.12の隔離venvに`pip install mlx==0.32.2 mlx-lm==0.31.3`で研究時と同じ版を入れ、`python -m mlx_lm.server --help`が使えることを確認します。ローカル研究で使ったPythonとMLX-LMの固定版はqualification reportに記録します。Python依存はCoreのnpm SBOMには含まれません。任意Python環境のlicense/vulnerabilityは別途監査してください。

`.env.local`へbase dir、venvのPython実行ファイル、同梱base manifestのpathを設定します。Adapterは今回別配布のため、通常はAdapter設定を空のままにします。設定後再起動し、設定画面で整合性確認後に明示的に起動します。Todayは各ファイルのSHA-256をstreamで確認し、hash不一致・欠損・異なるmodel identityを拒否します。推論時は自動downloadを禁止し、thinkingはfalse、temperature0、max_tokens384、同時推論1、期限12秒です。学習はアプリの起動経路にありません。

## Gamma

Gammaは凍結Qwen base + 別LoRA Adapterです。統合した新しいbase重みではありません。V1.8ではMLX上の量子化baseへLoRA SFTを行い、Qwenを教師にした蒸留はしていません。V1.9では学習・蒸留・量子化を行いません。

sealed結果: False Merge0/40、Recall40/40、Fact12/32、Temporal9/32。Fact/Temporal未達を明示し、default昇格はしません。Adapter/研究datasetは今回公開対象外で、取得URLや再配布licenseを推測で案内しません。独立配布にはデータ由来・変更表示・上流義務・品質ゲートの再審査が必要です。
