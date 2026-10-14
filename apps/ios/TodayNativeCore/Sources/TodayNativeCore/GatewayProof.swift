import Foundation
import CryptoKit

public enum GatewayProofError: Error { case invalidInput, invalidProof }

/// Cryptographic byte compatibility only. Does not establish Owner/device identity or scopes.
public enum GatewayProof {
    public static func verifyEd25519(message: Data, signature: Data, publicKey: Data) throws {
        guard message.count <= 32_768, !message.isEmpty, signature.count == 64, publicKey.count == 32
        else { throw GatewayProofError.invalidInput }
        let key = try Curve25519.Signing.PublicKey(rawRepresentation: publicKey)
        guard key.isValidSignature(signature, for: message) else { throw GatewayProofError.invalidProof }
    }

    /// The caller must provide independently trusted binding and key; no keys are persisted here.
    public static func openAESGCM(nonce: Data, ciphertext: Data, tag: Data, key: Data, binding: Data) throws -> Data {
        guard nonce.count == 12, tag.count == 16, key.count == 32, ciphertext.count <= 2_200_000,
              binding.count <= 32_768 else { throw GatewayProofError.invalidInput }
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce), ciphertext: ciphertext, tag: tag)
        return try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: binding)
    }
}
