import XCTest
@testable import TodayNativeCore

final class GatewayProofTests: XCTestCase {
    private func fixture() throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "gateway-crypto", withExtension: "json", subdirectory: "Fixtures"))
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        XCTAssertEqual(value["fixtureOnly"] as? Bool, true)
        return value
    }
    private func bytes(_ value: Any?) throws -> Data {
        let text = try XCTUnwrap(value as? String).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        return try XCTUnwrap(Data(base64Encoded: text + String(repeating: "=", count: (4 - text.count % 4) % 4)))
    }
    func testActualNodeEd25519BytesVerifyAndTamperingFails() throws {
        let f = try fixture(), message = try bytes(f["message"]), signature = try bytes(f["signature"]), key = try bytes(f["publicKey"])
        try GatewayProof.verifyEd25519(message: message, signature: signature, publicKey: key)
        XCTAssertThrowsError(try GatewayProof.verifyEd25519(message: message + Data([0]), signature: signature, publicKey: key))
        XCTAssertThrowsError(try GatewayProof.verifyEd25519(message: message, signature: Data(repeating: 0, count: 64), publicKey: key))
        XCTAssertThrowsError(try GatewayProof.verifyEd25519(message: Data(repeating: 1, count: 32_769), signature: signature, publicKey: key))
    }
    func testActualNodeAESGCMDecryptsOnlyWithMatchingAADAndKey() throws {
        let f = try fixture(), aes = try XCTUnwrap(f["aes"] as? [String: Any])
        let nonce = try bytes(aes["nonce"]), ciphertext = try bytes(aes["ciphertext"]), tag = try bytes(aes["tag"])
        let key = try bytes(aes["key"]), binding = try bytes(aes["binding"])
        let opened = try GatewayProof.openAESGCM(nonce: nonce, ciphertext: ciphertext, tag: tag, key: key, binding: binding)
        XCTAssertEqual(opened, try bytes(aes["plaintext"]))
        XCTAssertThrowsError(try GatewayProof.openAESGCM(nonce: nonce, ciphertext: ciphertext, tag: tag, key: key, binding: binding + Data([0])))
        XCTAssertThrowsError(try GatewayProof.openAESGCM(nonce: nonce, ciphertext: ciphertext, tag: tag, key: Data(repeating: 0, count: 32), binding: binding))
    }
}
