package expo.modules.jarvistelegram

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The key TDLib encrypts its database (the Telegram session) with.
 * A random 32-byte key is stored in [file], wrapped by an AES key that never
 * leaves the Android Keystore, so a copy of the app's files is useless on
 * another device.
 */
internal object DatabaseKey {
  private const val ALIAS = "jarvis-telegram-db"
  private const val IV_BYTES = 12

  /** Returns the key, or null if [file] exists but can no longer be unwrapped. */
  fun load(file: File): ByteArray? {
    if (!file.exists()) {
      val key = ByteArray(32).also { SecureRandom().nextBytes(it) }
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, wrappingKey())
      file.parentFile?.mkdirs()
      file.writeBytes(cipher.iv + cipher.doFinal(key))
      return key
    }
    return try {
      val data = file.readBytes()
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(
        Cipher.DECRYPT_MODE,
        existingWrappingKey() ?: return null,
        GCMParameterSpec(128, data, 0, IV_BYTES)
      )
      cipher.doFinal(data, IV_BYTES, data.size - IV_BYTES)
    } catch (e: Exception) {
      null
    }
  }

  private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun existingWrappingKey(): SecretKey? = keyStore().getKey(ALIAS, null) as? SecretKey

  private fun wrappingKey(): SecretKey =
    existingWrappingKey() ?: KeyGenerator
      .getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
      .apply {
        init(
          KeyGenParameterSpec
            .Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        )
      }
      .generateKey()
}
