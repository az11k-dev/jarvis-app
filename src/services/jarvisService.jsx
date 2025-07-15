import { Alert } from 'react-native';
import { speakJarvisResponse } from './ttsService';
import { SYSTEM_MESSAGE } from '../utils/constants';

const openaiApiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

if (!openaiApiKey) {
    Alert.alert('OpenAI API Key Missing', 'Please set your OpenAI API key in app.json');
}

export const processAudioWithOpenAI = async ({
                                                 audioUri,
                                                 chatHistory,
                                                 setChatHistory,
                                                 setDisplayedText,
                                                 setJarvisResponseText,
                                                 speak,
                                                 openCamera,
                                                 openTelegram,
                                                 setIsLoading,
                                             }) => {
    setIsLoading(true);
    setJarvisResponseText('Думаю...');
    setDisplayedText('Думаю...');

    try {
        const formData = new FormData();
        formData.append('file', {
            uri: audioUri,
            name: 'recording.m4a',
            type: 'audio/m4a',
        });
        formData.append('model', 'whisper-1');

        const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${openaiApiKey}`,
                'Content-Type': 'multipart/form-data',
            },
            body: formData,
        });

        const whisperData = await whisperResponse.json();

        if (!whisperResponse.ok) {
            throw new Error(whisperData.error?.message || 'Whisper API Error');
        }

        const userMessage = whisperData.text;
        setDisplayedText(`Вы сказали: "${userMessage}"\nJARVIS думает...`);
        setJarvisResponseText(`Вы сказали: "${userMessage}"\nJARVIS думает...`);

        const updatedHistory = [...chatHistory, { role: 'user', content: userMessage }];
        setChatHistory(updatedHistory);

        const completion = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${openaiApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: updatedHistory,
            }),
        });

        const responseData = await completion.json();

        const jarvisReply = responseData.choices?.[0]?.message?.content || '...';

        if (jarvisReply.toLowerCase().includes('open_camera')) {
            setJarvisResponseText('Сэр, открываю камеру...');
            setDisplayedText('Сэр, открываю камеру...');
            await speak('Сэр, открываю камеру.');
            await openCamera();
            return;
        }

        if (jarvisReply.toLowerCase().includes('open_telegram')) {
            setJarvisResponseText('Сэр, открываю Telegram...');
            setDisplayedText('Сэр, открываю Telegram...');
            await openTelegram();
            return;
        }

        setJarvisResponseText(jarvisReply);
        await speak(jarvisReply);
    } catch (err) {
        console.error('Jarvis error:', err);
        setJarvisResponseText('Произошла ошибка при обработке аудио.');
        setDisplayedText('Произошла ошибка при обработке аудио.');
        Alert.alert('Ошибка', err.message);
    } finally {
        setIsLoading(false);
    }
};