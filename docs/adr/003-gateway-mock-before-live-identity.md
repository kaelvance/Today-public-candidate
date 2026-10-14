# ADR 003 — 端末認証と保存契約をoffline Mockで検証する

2026-10-11。状態: alpha.2のMockに採用。production認証方式・永続DBの採用決定ではない。

## 基準と今回の権限

Ownerは、無料・安全優先の段階計画と、次の単位「端末認証とGatewayWorkspaceの契約・Mock実装」の開始を承認した。alpha.1の未commit変更39ファイルをhash付きで `../evidence/alpha1-baseline.json` に記録し、独立した `work/v3.0.0-alpha.2/source`、branch `dev/v3-gateway-alpha2` へ継承した。公開V2.1.0とalpha.1を編集対象にしない。

## 決定

1. 既存署名browser cookieを端末・Owner・tenant認証へ拡張しない。
2. Node標準cryptoを使う架空端末のEd25519鍵所持証明を、trustedなMock Owner承認と分離する。鍵はfixtureで生成しRAMだけに置く。
3. Owner portはtest harnessのみ。HTTP、iOS、MCP、modelから呼び出せる製品ルートを追加しない。
4. 登録・readを異なるpurpose/issuer/nonceで束縛する。workspace、scope、query、期限はGateway側で固定し、一度使用したread proofを再利用しない。
5. GatewayWorkspaceは選択projectionとreceiptを保管するMock。V2 Domainの新しい正本として扱わない。古いcaptureを読み取り時刻に更新しない。
6. StorePortはFIRST_USE/PRESENT/UNAVAILABLE/CORRUPTを区別する。同一Mock Store objectのwriter leaseとqueue、revision CAS、状態とreceiptのatomic commitを検証する。
7. disk、実データ移行、実device pairing、TLS、Keychain/Secure Enclave、外部サービスと公開は後続gate。

## 選択理由

無料で架空データの反例を先に検証でき、V2の保存・権限を変えずに実装契約を固定できる。loopbackをLANへ公開してcookieを流用する方式は、Owner/device/tenantの真正性を満たさない。全面DB移行は、バックアップ・単一writer・競合・削除の検証より先に実行しない。

## 実機の鍵方式は未決

MockのEd25519をそのままハードウェア保護鍵として宣伝しない。[Node crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback) のEd25519は `sign/verify(null, …)` で検証した。[Apple Curve25519](https://developer.apple.com/documentation/cryptokit/curve25519) はEd25519署名を扱う一方、[SecureEnclave.P256](https://developer.apple.com/documentation/cryptokit/secureenclave/p256) は別の鍵方式である。実iPhoneではハードウェア保護・Keychain・鍵の失効/再登録・署名byte互換を比較し、別ADRで決める。Mock署名の成功をSwiftやSecure EnclaveのPASSへ流用しない。

## 後続の承認・停止境界

架空fixtureとlocal testは進める。実データの移行、OS権限、実端末への鍵永続化/接続、外部送信、公開、費用が必要になる時は具体的な範囲・risk・testを提示する。本人判断が必要な手順だけOwnerへ依頼し、認証情報の貼り付けや抽出を要求しない。

参照: [Protocol](../v3/GATEWAY_PROTOCOL.md) / [Workspace](../v3/GATEWAY_WORKSPACE_SPEC.md) / [実装と試験](../v3/IMPLEMENTATION_STATUS.md)。
