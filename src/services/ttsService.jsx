import * as Speech from 'expo-speech';

export const speakJarvisResponse = async ({
                                              text,
                                              selectedVoiceId,
                                              availableVoices,
                                              scrollRef,
                                              setDisplayedText,
                                              setSelectedVoiceId,
                                              englishVoiceId,
                                              russianVoiceId,
                                          }) => {
    if (!text) return;

    const isEnglish = /^[\x00-\x7F]+$/.test(text);
    const language = isEnglish ? 'en-US' : 'ru-RU';

    const voiceToUse =
        selectedVoiceId ||
        availableVoices.find((v) => v.language === language)?.identifier;

    setSelectedVoiceId(isEnglish ? englishVoiceId : russianVoiceId);

    Speech.speak(text, {
        language,
        voice: voiceToUse,
        rate: 0.9,
        pitch: 1.1,
        onStart: () => setDisplayedText(''),
        onBoundary: ({ charIndex, charLength }) => {
            setDisplayedText(text.substring(0, charIndex + charLength));
            scrollRef?.current?.scrollToEnd({ animated: true });
        },
        onDone: () => {
            setDisplayedText(text);
            scrollRef?.current?.scrollToEnd({ animated: true });
        },
        onError: (e) => {
            console.error('TTS error:', e);
            setDisplayedText(text);
        },
    });
};