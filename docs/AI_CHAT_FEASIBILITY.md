# Today AI Chat 導入検討

調査日: 2026-10-08。**検討のみ。Chat UI、モデル取得・起動・学習、外部AI送信は今回実施していません。** 無料優先、AIなしで使えるCore、明示的なデータ送信を前提にします。

## 既存コード・研究記録で確認したこと

| 対象         | 確認結果と根拠                                                                                                                                                                                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qwen base    | `models/today-model/manifests/qwen3-base-q4.json`: `Qwen/Qwen3-1.7B-MLX-4bit`、revision `21457c6f51ed54a7c16e988c0844db973815c137`。upstream `Qwen/Qwen3-1.7B` revision `70d244cc86ccca08cf5af4e1e306ecf908b1ad5e`。約1.72B、MLX safetensors 4bit、group128。manifest総量930,270,314 bytes、weight914,316,100 bytes。 |
| Gamma        | `models/today-model/model-card/MODEL_CARD.md`と保管済みGamma provenance / adapter config: frozen Qwen base上のLoRA SFT。rank8、8layers、batch1、lr1e-4、seq1024、840iterations、選択checkpoint420。train840 / validation240は自作の架空templateデータ。                                                               |
| 重み・蒸留   | base weights未変更。別Adapterを学習。教師モデルによる蒸留はしていない。fusedモデルでも汎用会話モデルでもない。重み・Adapter・学習データはrepository非同梱。                                                                                                                                                           |
| 研究時の負荷 | provenance記録は学習647秒、peak MLX allocation約2.421GB。全Unified Memoryや本番Chatの測定値ではない。今回の調査で再学習・再benchmarkはしていない。                                                                                                                                                                    |
| 品質         | model card: Context FMR 0/40、recall40/40。一方Fact12/32、Temporal9/32で基準未達。自由対話・教育用途の品質を証明する結果ではない。                                                                                                                                                                                    |
| 現bridge     | `server/local-model.mjs`: operator設定pathとmanifest hash、明示start、loopback、同時1、12秒、max384tokens、thinking無効。messages最大4、roleはsystem/userのみ。assistantを拒否する試験がある。memoryEstimateMiB1800は推定値。                                                                                         |
| 現prompt     | `src/intelligence/prompts.ts`: `/no_think`、capability別JSON schema。Context等の構造化抽出用であり会話履歴用ではない。                                                                                                                                                                                                |
| 公開web      | 静的Core。Node bridge、利用者のMacモデル、Google/外部AIへ自動接続しない。MLX/Ollamaはローカル版の任意機能。                                                                                                                                                                                                           |

「chat/completions」というendpoint名だけでChat実装済みとは判断できません。Gamma Adapterを会話用に転用できることも未確認です。

## 方式の比較（設計案・性能未測定）

| 方式                 | 無料・運用条件                                                          | Todayへの適合                                                                                           |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Mac上MLX + Qwen base | API従量料金なし。利用者による別途weight取得、容量・電力・RAMは必要      | 既存のoperator管理bridgeを発展できる。最初はGamma Adapterなしのbaseを比較対象にする。Mac専用。          |
| 利用者のOllama       | 対応OS・選択modelを利用者が管理。cloudへのfallbackを自動有効にしない    | 任意ローカルChat候補。日本語・速度・licenseをmodelごとに確認。                                          |
| WebLLM / WebGPU      | 外部API不要だがweight downloadとGPU/RAMを要求。無料の全端末保証ではない | Pages利用者向けの別設計。MLC形式が必要でMLX Adapterをそのまま読めない。端末互換性・低メモリを先に評価。 |
| 外部API              | 無料枠・creditsは期限や上限がある。無期限無料のCore依存にしない         | 将来の任意設定。予算0の停止、明示送信、残量表示、送信先の確認が必要。今回追加しない。                   |

初期研究の推奨順は、ローカル版でbase Qwenの日本語対話評価 → Ollama比較 → 公開webでの需要・端末条件を確認してWebGPUを別評価。これは採用決定ではありません。全利用者が開発者のMacを使える構成にはしません。

## 将来実装する場合の最小境界

- Coreと独立した任意機能。初期状態OFF。モデル取得・常駐・外部fallbackは明示操作のみ。
- assistant roleと履歴上限、context budget、cancel、timeout、同時実行数、低メモリ時の停止を専用契約で定義。既存JSON抽出bridgeを無検証で開放しない。
- 最初は読み取り対話だけ。shell、plugin導入、任意コード、Googleへの書込、AIによるタスク変更は実行しない。
- Todayデータ・メールを会話へ自動投入しない。利用者が選択して範囲確認。promptは実行権限を制限するsandboxの代用ではない。
- 出力はtextとして表示。HTMLを実行せず、link schemeを検査。モデル出力の命令をアプリ権限と扱わない。
- 履歴保存は初期OFF。opt-in、上限、削除、backup対象、平文保存の説明を先に設計。診断に本文・tokenを含めない。
- 学校検証は架空データから開始。医療・成績・個人の秘密等の実データで品質試験をしない。

## 採用前に必要な評価（未実施）

日本語の複数turn整合性、日時計算、不明時の応答、捏造、prompt injection、個人情報の境界、長文・取消・offline・低RAM・多タブを固定fixtureで評価します。p50/p95 latency、tokens/sec、実peak RSS/Unified Memory、初回download、低メモリ時のCore継続を機種別に測定します。合格値は用途と端末予算を決めてから固定します。今回のコード回帰成功をモデル品質へ流用しません。

## 配布・license

manifestと公式model cardはApache-2.0を示します。TodayソースのMITとは分け、選択revisionのLICENSE/NOTICE・派生変更表示・Adapter配布条件を公開前に確認します。今回weight/Adapterを公開せず、追加ダウンロードも行いません。法律上の再配布保証をこの技術調査だけで断定しません。

## 一次資料（2026-10-08参照）

- [Qwen公式Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B): thinking/non-thinking、model仕様・license。数値からToday用途の品質は推定しない。
- [既存manifestのMLX版](https://huggingface.co/Qwen/Qwen3-1.7B-MLX-4bit): community配布の別repoと取り違えない。
- [MLX LM](https://github.com/ml-explore/mlx-lm): inference・chat・fine-tuningの基盤。
- [Ollama Chat API](https://docs.ollama.com/api/chat): messages、stream等の独立した対話API。
- [WebLLM](https://github.com/mlc-ai/web-llm): browser内WebGPU inference。MLX形式とは別。

結論: 既存Qwenは将来のローカルChat研究に再利用できる候補ですが、Today Chatが既にあるわけではありません。V2.0.3では保存の信頼性を修正し、Chatを実装・モデル公開しません。
