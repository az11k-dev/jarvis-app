package expo.modules.jarvisphone

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.CallLog.Calls
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.telecom.TelecomManager
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

private const val SMS_SENT_TIMEOUT_MS = 30_000L

/**
 * The phone for JARVIS: contacts, SMS, the call log and calls. JS asks for
 * the runtime permissions before calling; a missing one rejects with
 * ERR_PHONE_PERMISSION.
 */
class JarvisPhoneModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext
      ?: throw CodedException("ERR_NO_CONTEXT", "Android context is not available", null)

  private val nextSmsId = AtomicInteger(1)

  override fun definition() = ModuleDefinition {
    Name("JarvisPhone")

    AsyncFunction("contacts") {
      guarded { readContacts() }
    }

    AsyncFunction("readSms") { box: String, limit: Int, address: String, query: String, sinceMs: Double ->
      guarded { readSms(box, limit, address, query, sinceMs.toLong()) }
    }

    AsyncFunction("sendSms") { number: String, text: String, promise: Promise ->
      try {
        sendSms(number, text, promise)
      } catch (e: SecurityException) {
        promise.reject("ERR_PHONE_PERMISSION", e.message, e)
      } catch (e: Exception) {
        promise.reject("ERR_SMS", e.message, e)
      }
    }

    AsyncFunction("callLog") { kind: String, limit: Int, number: String ->
      guarded { readCallLog(kind, limit, number) }
    }

    AsyncFunction("call") { number: String, speaker: Boolean ->
      guarded {
        val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
        val extras = Bundle()
        if (speaker) extras.putBoolean(TelecomManager.EXTRA_START_CALL_WITH_SPEAKERPHONE, true)
        // With two SIMs and no default, Android would stop to ask which one.
        val account = telecom.getDefaultOutgoingPhoneAccount("tel")
          ?: telecom.callCapablePhoneAccounts.firstOrNull()
        if (account != null) extras.putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, account)
        telecom.placeCall(Uri.fromParts("tel", number, null), extras)
      }
    }

    AsyncFunction("endCall") {
      guarded {
        val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
        @Suppress("DEPRECATION")
        telecom.endCall()
      }
    }

    AsyncFunction("answerCall") {
      guarded {
        val telecom = context.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
        @Suppress("DEPRECATION")
        telecom.acceptRingingCall()
      }
    }

    AsyncFunction("callState") {
      guarded {
        val telephony = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
        @Suppress("DEPRECATION")
        when (telephony.callState) {
          TelephonyManager.CALL_STATE_RINGING -> "ringing"
          TelephonyManager.CALL_STATE_OFFHOOK -> "in_call"
          else -> "idle"
        }
      }
    }

    /** `count` frames spread over the video, as base64 JPEGs. */
    AsyncFunction("videoFrames") { path: String, count: Int, maxSide: Int ->
      try {
        VideoFrames.extract(path.removePrefix("file://"), count, maxSide)
      } catch (e: Exception) {
        throw CodedException("ERR_VIDEO", e.message ?: e.toString(), e)
      }
    }

    AsyncFunction("encodeVoiceNote") { wavPath: String, oggPath: String ->
      try {
        VoiceNote.encode(File(wavPath.removePrefix("file://")), File(oggPath.removePrefix("file://")))
      } catch (e: Exception) {
        throw CodedException("ERR_ENCODE", e.message ?: e.toString(), e)
      }
    }
  }

  private fun <T> guarded(block: () -> T): T =
    try {
      block()
    } catch (e: SecurityException) {
      throw CodedException("ERR_PHONE_PERMISSION", e.message ?: "Permission denied", e)
    }

  // ── contacts ────────────────────────────────────────────────────────────

  private fun readContacts(): List<Map<String, Any>> {
    val byId = LinkedHashMap<Long, Pair<String, LinkedHashMap<String, String>>>()
    context.contentResolver.query(
      Phone.CONTENT_URI,
      arrayOf(Phone.CONTACT_ID, Phone.DISPLAY_NAME, Phone.NUMBER),
      null,
      null,
      Phone.DISPLAY_NAME + " COLLATE LOCALIZED ASC"
    )?.use { c ->
      while (c.moveToNext()) {
        val number = c.getString(2)?.trim().orEmpty()
        if (number.isEmpty()) continue
        val entry = byId.getOrPut(c.getLong(0)) { (c.getString(1) ?: "") to LinkedHashMap() }
        // "+998 90 123-45-67" and "901234567" are one number.
        entry.second.putIfAbsent(digitsKey(number), number)
      }
    }
    return byId.values.map { (name, numbers) ->
      mapOf("name" to name, "numbers" to numbers.values.toList())
    }
  }

  // ── SMS ─────────────────────────────────────────────────────────────────

  private fun readSms(
    box: String,
    limit: Int,
    address: String,
    query: String,
    sinceMs: Long
  ): List<Map<String, Any?>> {
    val uri = Uri.parse(
      when (box) {
        "inbox" -> "content://sms/inbox"
        "sent" -> "content://sms/sent"
        else -> "content://sms"
      }
    )
    val where = ArrayList<String>()
    val args = ArrayList<String>()
    if (sinceMs > 0) {
      where.add("date > ?")
      args.add(sinceMs.toString())
    }
    if (query.isNotBlank()) {
      where.add("body LIKE ?")
      args.add("%" + query.trim() + "%")
    }
    val wanted = address.trim()
    val wantedDigits = digitsKey(wanted)
    val byNumber = wantedDigits.length >= 5
    val out = ArrayList<Map<String, Any?>>()
    context.contentResolver.query(
      uri,
      arrayOf("_id", "address", "body", "date", "type", "read"),
      where.joinToString(" AND ").ifEmpty { null },
      args.toTypedArray().ifEmpty { null },
      "date DESC"
    )?.use { c ->
      while (c.moveToNext() && out.size < limit) {
        val from = c.getString(1) ?: ""
        if (wanted.isNotEmpty()) {
          val matches =
            if (byNumber) digitsKey(from) == wantedDigits
            else from.contains(wanted, ignoreCase = true)
          if (!matches) continue
        }
        out.add(
          mapOf(
            "id" to c.getLong(0).toDouble(),
            "address" to from,
            "body" to (c.getString(2) ?: ""),
            "date" to c.getLong(3).toDouble(),
            // 1 is the inbox; everything else (sent, outbox, failed) is ours.
            "sent" to (c.getInt(4) != 1),
            "read" to (c.getInt(5) != 0)
          )
        )
      }
    }
    return out
  }

  @Suppress("DEPRECATION")
  private fun smsManager(): SmsManager {
    var id = SmsManager.getDefaultSmsSubscriptionId()
    if (id == SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
      // Two SIMs set to "ask every time": use the first one.
      val subscriptions =
        context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager
      id = try {
        subscriptions.activeSubscriptionInfoList?.firstOrNull()?.subscriptionId
          ?: SubscriptionManager.INVALID_SUBSCRIPTION_ID
      } catch (e: SecurityException) {
        SubscriptionManager.INVALID_SUBSCRIPTION_ID
      }
    }
    return if (id != SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
      SmsManager.getSmsManagerForSubscriptionId(id)
    } else {
      SmsManager.getDefault()
    }
  }

  private fun sendSms(number: String, text: String, promise: Promise) {
    val app = context
    val manager = smsManager()
    val parts = manager.divideMessage(text)
    if (parts.isEmpty()) {
      promise.reject("ERR_SMS", "The message is empty", null)
      return
    }
    val id = nextSmsId.getAndIncrement()
    val action = "${app.packageName}.JARVIS_SMS_SENT.$id"
    val handler = Handler(Looper.getMainLooper())
    var left = parts.size
    var failure: Int? = null
    var settled = false

    lateinit var receiver: BroadcastReceiver
    val finish = { error: String? ->
      if (!settled) {
        settled = true
        handler.removeCallbacksAndMessages(null)
        try {
          app.unregisterReceiver(receiver)
        } catch (e: Exception) {
          // already unregistered
        }
        if (error == null) promise.resolve(parts.size) else promise.reject("ERR_SMS", error, null)
      }
    }
    receiver = object : BroadcastReceiver() {
      override fun onReceive(c: Context?, intent: Intent?) {
        if (resultCode != Activity.RESULT_OK) failure = resultCode
        if (--left <= 0) finish(failure?.let { smsError(it) })
      }
    }
    ContextCompat.registerReceiver(
      app,
      receiver,
      IntentFilter(action),
      ContextCompat.RECEIVER_NOT_EXPORTED
    )
    handler.postDelayed({ finish("The network did not confirm the SMS in time") }, SMS_SENT_TIMEOUT_MS)

    val sent = ArrayList<PendingIntent>()
    for (i in parts.indices) {
      sent.add(
        PendingIntent.getBroadcast(
          app,
          id * 100 + i,
          Intent(action).setPackage(app.packageName),
          PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
        )
      )
    }
    try {
      manager.sendMultipartTextMessage(number, null, parts, sent, null)
    } catch (e: Exception) {
      finish(e.message ?: e.toString())
      if (e is SecurityException) throw e
    }
  }

  private fun smsError(code: Int): String =
    when (code) {
      SmsManager.RESULT_ERROR_NO_SERVICE -> "No mobile network"
      SmsManager.RESULT_ERROR_RADIO_OFF -> "The phone is in flight mode"
      SmsManager.RESULT_ERROR_NULL_PDU -> "The SMS could not be built"
      SmsManager.RESULT_ERROR_LIMIT_EXCEEDED -> "Android blocked the SMS: too many sent in a short time"
      SmsManager.RESULT_ERROR_SHORT_CODE_NOT_ALLOWED,
      SmsManager.RESULT_ERROR_SHORT_CODE_NEVER_ALLOWED -> "Android does not allow SMS to this short number"
      else -> "The network refused the SMS (code $code)"
    }

  // ── calls ───────────────────────────────────────────────────────────────

  private fun readCallLog(kind: String, limit: Int, number: String): List<Map<String, Any?>> {
    val types = when (kind) {
      "missed" -> listOf(Calls.MISSED_TYPE, Calls.REJECTED_TYPE)
      "incoming" -> listOf(Calls.INCOMING_TYPE)
      "outgoing" -> listOf(Calls.OUTGOING_TYPE)
      else -> emptyList()
    }
    val wanted = digitsKey(number)
    val out = ArrayList<Map<String, Any?>>()
    context.contentResolver.query(
      Calls.CONTENT_URI,
      arrayOf(Calls.NUMBER, Calls.CACHED_NAME, Calls.TYPE, Calls.DATE, Calls.DURATION),
      if (types.isEmpty()) null else "${Calls.TYPE} IN (${types.joinToString(",")})",
      null,
      "${Calls.DATE} DESC"
    )?.use { c ->
      while (c.moveToNext() && out.size < limit) {
        val from = c.getString(0) ?: ""
        if (wanted.isNotEmpty() && digitsKey(from) != wanted) continue
        out.add(
          mapOf(
            "number" to from,
            "name" to (c.getString(1) ?: ""),
            "kind" to when (c.getInt(2)) {
              Calls.INCOMING_TYPE -> "incoming"
              Calls.OUTGOING_TYPE -> "outgoing"
              Calls.MISSED_TYPE -> "missed"
              Calls.REJECTED_TYPE -> "rejected"
              Calls.BLOCKED_TYPE -> "blocked"
              else -> "other"
            },
            "date" to c.getLong(3).toDouble(),
            "duration" to c.getInt(4)
          )
        )
      }
    }
    return out
  }

  /** The last 9 digits: the national number, without +998 / 8 / spaces. */
  private fun digitsKey(number: String): String {
    val digits = number.filter { it.isDigit() }
    return if (digits.length > 9) digits.takeLast(9) else digits
  }
}
