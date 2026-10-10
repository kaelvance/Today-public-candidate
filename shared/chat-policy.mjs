/** Deterministic capability boundary; this is not an LLM safety guarantee. */
export const chatDeniedReply = Object.freeze({
  text: 'このChatではメール送信・データ削除・外部サービス変更・コード実行は未対応です。実行していません。Googleの内容もChatには共有されていません。対応する操作はToday画面で確認してください。',
  citations: [],
  proposal: null,
})
export function unsupportedChatRequest(text) {
  return /削除|消去|メール.{0,40}(?:送信|送って)|(?:コード|スクリプト|コマンド|shell).{0,40}実行|(?:Google|Gmail|iMessage).{0,40}(?:読|取得|送|変更|接続)|(?:token|トークン|秘密鍵|パスワード).{0,40}(?:表示|教え|送|出力)/i.test(
    text,
  )
}
export function unsupportedExecutionClaim(text) {
  return /メール(?:を)?送信(?:します|しました|済み)|(?:保存|削除|変更|完了|作成)(?:しました|済み)/.test(
    text,
  )
}
