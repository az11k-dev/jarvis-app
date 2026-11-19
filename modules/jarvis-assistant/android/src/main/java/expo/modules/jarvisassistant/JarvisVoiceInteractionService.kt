package expo.modules.jarvisassistant

import android.service.voice.VoiceInteractionService

/**
 * Registers JARVIS as a digital assistant. Android binds it while JARVIS is
 * the selected assistant; the real work happens in JarvisSession.
 */
class JarvisVoiceInteractionService : VoiceInteractionService()
