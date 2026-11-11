# sherpa-onnx config/result classes are constructed and read from native code
# (libsherpa-onnx-jni.so, e.g. OfflineTts_newFromFile reads OfflineTtsConfig.model
# of type OfflineTtsModelConfig). R8 can't see those JNI references, so without
# these keeps it strips/renames the classes and the app crashes with
# NoSuchFieldError / ClassNotFoundException at startup in release builds.
-keep class com.k2fsa.sherpa.onnx.** { *; }
-keepclassmembers class com.k2fsa.sherpa.onnx.** { *; }
