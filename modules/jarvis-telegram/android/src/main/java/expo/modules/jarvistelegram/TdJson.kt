package expo.modules.jarvistelegram

import android.util.Base64
import org.drinkless.tdlib.TdApi
import org.json.JSONArray
import org.json.JSONObject
import java.lang.reflect.Field
import java.lang.reflect.Modifier
import java.util.concurrent.ConcurrentHashMap

/**
 * Converts between TDLib's JSON interface shape ({"@type": "getChats",
 * "chat_list": …, "limit": 20}) and the Java TdApi classes, so JS can use
 * the documented JSON API while the app ships the Java binding.
 *
 * int64 values go out as numbers when they fit in a JS number, otherwise
 * as strings (TDLib's own JSON convention); both are accepted coming in.
 * bytes are base64.
 */
internal object TdJson {
  private const val MAX_SAFE_INTEGER = 9007199254740991L

  private val classes = ConcurrentHashMap<String, Class<*>>()
  private val fields = ConcurrentHashMap<Class<*>, Map<String, Field>>()

  fun fromJson(json: JSONObject): TdApi.Object {
    val type = json.optString("@type")
    require(type.isNotEmpty()) { "Missing @type" }
    val cls = classFor(type)
    val obj = cls.getDeclaredConstructor().newInstance() as TdApi.Object
    val byName = fieldsOf(cls)
    for (key in json.keys()) {
      if (key.startsWith("@") || json.isNull(key)) continue
      val field = byName[normalize(key)]
        ?: throw IllegalArgumentException("$type has no field $key")
      field.set(obj, convertIn(json.get(key), field.type, "$type.$key"))
    }
    return obj
  }

  /** The JSON @type of a TdApi object, e.g. TdApi.UpdateNewMessage → updateNewMessage. */
  fun typeOf(obj: TdApi.Object): String =
    obj.javaClass.simpleName.replaceFirstChar { it.lowercaseChar() }

  fun toJson(obj: TdApi.Object): JSONObject {
    val json = JSONObject()
    json.put("@type", typeOf(obj))
    for (field in fieldsOf(obj.javaClass).values) {
      val value = field.get(obj) ?: continue
      json.put(snakeCase(field.name), convertOut(value))
    }
    return json
  }

  private fun classFor(type: String): Class<*> =
    classes.getOrPut(type) {
      val name = "org.drinkless.tdlib.TdApi\$" + type.replaceFirstChar { it.uppercaseChar() }
      val cls = try {
        Class.forName(name)
      } catch (e: ClassNotFoundException) {
        throw IllegalArgumentException("Unknown TDLib type $type")
      }
      require(TdApi.Object::class.java.isAssignableFrom(cls) && !Modifier.isAbstract(cls.modifiers)) {
        "$type is not a concrete TDLib type"
      }
      cls
    }

  /** Public instance fields keyed by normalize(name). */
  private fun fieldsOf(cls: Class<*>): Map<String, Field> =
    fields.getOrPut(cls) {
      cls.fields
        .filter { !Modifier.isStatic(it.modifiers) }
        .associateBy { normalize(it.name) }
    }

  // chat_id, chatId and photo_2x/photo2x all map to the same key.
  private fun normalize(name: String) = name.replace("_", "").lowercase()

  private fun snakeCase(name: String) =
    name.replace(Regex("([A-Z])")) { "_" + it.value.lowercase() }

  private fun convertIn(value: Any, type: Class<*>, path: String): Any? =
    when {
      type == Boolean::class.javaPrimitiveType -> value as Boolean
      type == Int::class.javaPrimitiveType -> (value as Number).toInt()
      type == Long::class.javaPrimitiveType ->
        if (value is String) value.toLong() else (value as Number).toLong()
      type == Double::class.javaPrimitiveType -> (value as Number).toDouble()
      type == String::class.java -> value.toString()
      type == ByteArray::class.java -> Base64.decode(value as String, Base64.NO_WRAP)
      type.isArray -> {
        val items = value as JSONArray
        val component = type.componentType!!
        val array = java.lang.reflect.Array.newInstance(component, items.length())
        for (i in 0 until items.length()) {
          if (items.isNull(i)) continue
          java.lang.reflect.Array.set(array, i, convertIn(items.get(i), component, "$path[$i]"))
        }
        array
      }
      TdApi.Object::class.java.isAssignableFrom(type) -> {
        val obj = fromJson(value as JSONObject)
        require(type.isInstance(obj)) { "$path expects ${type.simpleName}, got ${obj.javaClass.simpleName}" }
        obj
      }
      else -> throw IllegalArgumentException("$path has unsupported type ${type.name}")
    }

  private fun convertOut(value: Any): Any =
    when (value) {
      is TdApi.Object -> toJson(value)
      is Long -> if (value in -MAX_SAFE_INTEGER..MAX_SAFE_INTEGER) value else value.toString()
      is Double -> if (value.isFinite()) value else JSONObject.NULL
      is ByteArray -> Base64.encodeToString(value, Base64.NO_WRAP)
      is Boolean, is Int, is String -> value
      else ->
        if (value.javaClass.isArray) {
          val out = JSONArray()
          for (i in 0 until java.lang.reflect.Array.getLength(value)) {
            val item = java.lang.reflect.Array.get(value, i)
            out.put(if (item == null) JSONObject.NULL else convertOut(item))
          }
          out
        } else {
          value.toString()
        }
    }
}
