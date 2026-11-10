package expo.modules.jarvistelegram

import android.content.Context
import android.os.Build
import android.util.Log
import org.drinkless.tdlib.Client
import org.drinkless.tdlib.TdApi
import java.io.File
import java.util.Locale

/**
 * The one TDLib client of the app process. It lives outside the Expo module
 * so it survives JS reloads: TDLib allows only one client per database
 * directory, and the session stays logged in across app restarts.
 */
internal object Telegram {
  private const val TAG = "JarvisTelegram"

  @Volatile
  var client: Client? = null
    private set

  /** Receives every update; set by the Expo module while it is alive. */
  @Volatile
  var sink: ((TdApi.Object) -> Unit)? = null

  private var apiId = 0
  private var apiHash = ""
  private lateinit var root: File
  private lateinit var appVersion: String

  @Synchronized
  fun start(context: Context, apiId: Int, apiHash: String) {
    if (client != null) return
    this.apiId = apiId
    this.apiHash = apiHash
    root = File(context.filesDir, "tdlib")
    appVersion = try {
      context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "1.0"
    } catch (e: Exception) {
      "1.0"
    }
    Client.execute(TdApi.SetLogVerbosityLevel(1))
    client = Client.create(
      { onUpdate(it) },
      { Log.e(TAG, "Update handler failed", it) },
      { Log.e(TAG, "Result handler failed", it) }
    )
  }

  private fun onUpdate(update: TdApi.Object) {
    if (update is TdApi.UpdateAuthorizationState) {
      when (update.authorizationState) {
        is TdApi.AuthorizationStateWaitTdlibParameters -> sendParameters()
        // After logOut/close the client is finished; start() makes a new one.
        is TdApi.AuthorizationStateClosed -> synchronized(this) { client = null }
      }
    }
    sink?.invoke(update)
  }

  private fun sendParameters() {
    // start() may still be inside Client.create; the lock waits for it.
    val c = synchronized(this) { client } ?: return
    val keyFile = File(root, "db.key")
    var key = DatabaseKey.load(keyFile)
    if (key == null) {
      // The wrapping key is gone (app data restored from a backup, Keystore
      // reset): the old database can't be opened, so start over and log in again.
      Log.w(TAG, "Database key can't be unwrapped, resetting the Telegram session")
      root.deleteRecursively()
      key = DatabaseKey.load(keyFile)!!
    }
    val params = TdApi.SetTdlibParameters().apply {
      useTestDc = false
      databaseDirectory = File(root, "db").absolutePath
      filesDirectory = File(root, "files").absolutePath
      databaseEncryptionKey = key
      useFileDatabase = true
      useChatInfoDatabase = true
      useMessageDatabase = true
      useSecretChats = false
      apiId = this@Telegram.apiId
      apiHash = this@Telegram.apiHash
      systemLanguageCode = Locale.getDefault().language.ifEmpty { "en" }
      deviceModel = Build.MODEL ?: "Android"
      systemVersion = "Android ${Build.VERSION.RELEASE}"
      applicationVersion = "JARVIS $appVersion"
    }
    c.send(params) { result ->
      if (result is TdApi.Error) Log.e(TAG, "setTdlibParameters: ${result.code} ${result.message}")
    }
  }
}
