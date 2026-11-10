package expo.modules.jarvistelegram

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.drinkless.tdlib.TdApi
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

/**
 * Telegram for JARVIS through TDLib, logged in as the user.
 * JS talks TDLib's JSON API: send() takes a request like
 * {"@type": "getMe"} and resolves with the result, and onUpdate delivers
 * updateAuthorizationState plus the update types JS asked for.
 */
class JarvisTelegramModule : Module() {
  // TDLib sends thousands of updates at startup; JS only gets the ones it uses.
  private val forwarded: MutableSet<String> = ConcurrentHashMap.newKeySet()

  private val sink: (TdApi.Object) -> Unit = { update ->
    val type = TdJson.typeOf(update)
    if (type == "updateAuthorizationState" || type in forwarded) {
      sendEvent("onUpdate", mapOf("json" to TdJson.toJson(update).toString()))
    }
  }

  override fun definition() = ModuleDefinition {
    Name("JarvisTelegram")

    Events("onUpdate")

    OnCreate { Telegram.sink = sink }

    OnDestroy { if (Telegram.sink === sink) Telegram.sink = null }

    /** Creates the TDLib client if there isn't one; safe to call again. */
    Function("start") { apiId: Int, apiHash: String ->
      val context = appContext.reactContext ?: throw IOException("No Android context")
      Telegram.start(context.applicationContext, apiId, apiHash)
    }

    /** Update @types to deliver through onUpdate, besides auth state. */
    Function("setForwardedUpdates") { types: List<String> ->
      forwarded.clear()
      forwarded.addAll(types)
    }

    /** Resolves with the result as a JSON string; TDLib errors reject. */
    AsyncFunction("send") { request: String, promise: Promise ->
      val function = try {
        TdJson.fromJson(JSONObject(request)) as? TdApi.Function<*>
          ?: throw IllegalArgumentException("Not a TDLib function")
      } catch (e: Exception) {
        promise.reject("ERR_TG_REQUEST", e.message, e)
        return@AsyncFunction
      }
      val client = Telegram.client
      if (client == null) {
        promise.reject("ERR_TG_NOT_STARTED", "Telegram is not started", null)
        return@AsyncFunction
      }
      try {
        client.send(
          function,
          { result ->
            if (result is TdApi.Error) {
              promise.reject("ERR_TG_${result.code}", result.message, null)
            } else {
              promise.resolve(TdJson.toJson(result).toString())
            }
          },
          // TDLib routes exceptions thrown in the result handler here too.
          { e -> promise.reject("ERR_TG", e.message, e) }
        )
      } catch (e: Exception) {
        promise.reject("ERR_TG", e.message, e)
      }
    }
  }
}
