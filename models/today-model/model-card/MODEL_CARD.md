# Today Model Gamma — Experimental / not bundled

GammaはQwen3-1.7B-MLX-4bit固定baseと別LoRA Adapterの組合せです。V1.8にMLXの量子化base上でLoRA SFT（rank8、8layers、840iterations、checkpoint420選択）を実行し、base重みを更新していません。Qwenを教師モデルにした蒸留はしていません。Adapterを融合した重みも、このsourceにはありません。詳細のhashはmanifestsにあります。

## Frozen evaluation

| sealed V4              | 結果  |
| ---------------------- | ----- |
| Context False Merge    | 0/40  |
| Context Recall         | 40/40 |
| Fact Extraction        | 12/32 |
| Temporal Understanding | 9/32  |

Fact/Temporal gateは不合格。これらはV1.8での実測であり、V1.9で新たに学習/評価して改善した数値ではありません。Gammaをdefaultへ昇格させません。model出力はproposalで、schema検証とContext方針を経由します。実メール/Calendarへ自動操作を行う権限はありません。

V1.9はモデル研究を凍結。Base、Adapter、training/evaluation研究artifactはソース配布外です。任意local runtimeはApple Siliconに限定した実験的機能です。data/provenanceの独立公開審査は未完了で、Adapter公開licenseを推測しません。[setup](../../../docs/MODELS.md) と [rights](../../../docs/licensing/RIGHTS_PROVENANCE.md) を参照してください。
